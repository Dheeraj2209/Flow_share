import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createClient, Client as LibsqlClient } from '@libsql/client';

type Row = Record<string, unknown>;

type Stmt = {
  run: (...args: unknown[]) => { lastInsertRowid?: number | bigint } | void;
  get: (...args: unknown[]) => Row | undefined;
  all: (...args: unknown[]) => Row[];
};

type DBLike = {
  prepare: (sql: string) => Stmt;
  pragma?: (sql: string) => void;
};

let db: DBLike | null = null;

export function getDb(): DBLike {
  if (db) return db;
  // Prefer remote libSQL (Turso) if configured
  const libsqlUrl = process.env.LIBSQL_URL;
  const libsqlToken = process.env.LIBSQL_AUTH_TOKEN;
  if (libsqlUrl) {
    const client: LibsqlClient = createClient({ url: libsqlUrl, authToken: libsqlToken });
    db = libsqlAdapter(client);
    migrate(db);
    return db;
  }
  const cfg = process.env.DATA_DIR;
  let dataDir = cfg
    ? (path.isAbsolute(cfg) ? cfg : path.join(process.cwd(), cfg))
    : path.join(process.cwd(), 'data');
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
  } catch (e: any) {
    if (e?.code === 'EACCES' || e?.code === 'EPERM') {
      const fallback = path.join('/tmp', 'flowshare-data');
      if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
      dataDir = fallback;
    } else {
      throw e;
    }
  }
  const file = path.join(dataDir, 'app.db');
  const native = new Database(file);
  native.pragma('journal_mode = WAL');
  db = betterSqliteAdapter(native);
  migrate(db);
  return db;
}

function migrate(db: DBLike) {
  // people table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  // tasks table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      person_id INTEGER,
      status TEXT NOT NULL DEFAULT 'todo',
      due_date TEXT,
      due_time TEXT,
      bucket_type TEXT, -- 'day' | 'week' | 'month'
      bucket_date TEXT, -- anchor date (YYYY-MM-DD)
      recurrence TEXT NOT NULL DEFAULT 'none', -- 'none' | 'daily' | 'weekly' | 'monthly'
      interval INTEGER NOT NULL DEFAULT 1,
      byweekday TEXT, -- JSON array of numbers 0-6 for weekly
      until TEXT, -- ISO date string
      sort INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
    )
  `).run();

  // trigger to update updated_at
  db.prepare(`
    CREATE TRIGGER IF NOT EXISTS tasks_updated_at
    AFTER UPDATE ON tasks
    FOR EACH ROW
    BEGIN
      UPDATE tasks SET updated_at = datetime('now') WHERE id = OLD.id;
    END;
  `).run();

  // external sources table (connectors)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS external_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      url TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      scope TEXT,
      account TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
    )
  `).run();

  // Backfill migrations for older DBs
  try {
    const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
    const names = new Set(cols.map(c => c.name));
    if (!names.has('due_time')) {
      db.prepare(`ALTER TABLE tasks ADD COLUMN due_time TEXT`).run();
    }
    if (!names.has('sort')) {
      db.prepare(`ALTER TABLE tasks ADD COLUMN sort INTEGER NOT NULL DEFAULT 0`).run();
    }
    if (!names.has('color')) {
      db.prepare(`ALTER TABLE tasks ADD COLUMN color TEXT`).run();
    }
    if (!names.has('priority')) {
      db.prepare(`ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`).run();
    }
    if (!names.has('external_id')) {
      db.prepare(`ALTER TABLE tasks ADD COLUMN external_id TEXT`).run();
    }
    if (!names.has('source_id')) {
      db.prepare(`ALTER TABLE tasks ADD COLUMN source_id INTEGER`).run();
    }
  } catch {}

  // Backfill external_sources oauth columns
  try {
    const scols = db.prepare(`PRAGMA table_info(external_sources)`).all() as { name: string }[];
    const snames = new Set(scols.map(c => c.name));
    if (!snames.has('access_token')) db.prepare(`ALTER TABLE external_sources ADD COLUMN access_token TEXT`).run();
    if (!snames.has('refresh_token')) db.prepare(`ALTER TABLE external_sources ADD COLUMN refresh_token TEXT`).run();
    if (!snames.has('expires_at')) db.prepare(`ALTER TABLE external_sources ADD COLUMN expires_at INTEGER`).run();
    if (!snames.has('scope')) db.prepare(`ALTER TABLE external_sources ADD COLUMN scope TEXT`).run();
    if (!snames.has('account')) db.prepare(`ALTER TABLE external_sources ADD COLUMN account TEXT`).run();
  } catch {}

  // Backfill people.color
  try {
    const pcols = db.prepare(`PRAGMA table_info(people)`).all() as { name: string }[];
    const pnames = new Set(pcols.map(c => c.name));
    if (!pnames.has('color')) {
      db.prepare(`ALTER TABLE people ADD COLUMN color TEXT`).run();
    }
  } catch {}
}

function betterSqliteAdapter(native: Database.Database): DBLike {
  return {
    prepare(sql: string): Stmt {
      const s = native.prepare(sql);
      return {
        run: (...args: unknown[]) => s.run(...(args as any[])),
        get: (...args: unknown[]) => s.get(...(args as any[])) as Row | undefined,
        all: (...args: unknown[]) => s.all(...(args as any[])) as Row[],
      };
    },
    pragma: (sql: string) => native.pragma(sql),
  };
}

function libsqlAdapter(client: LibsqlClient): DBLike {
  return {
    prepare(sql: string): Stmt {
      return {
        run: (...args: unknown[]) => {
          const res = client.execute({ sql, args: args as any[] });
          // libsql returns a Promise; keep API symmetric by blocking callers? Our routes are async.
          // But current code calls .run() synchronously. Wrap with deasync? Instead, run synchronously-like by throwing if called.
          // To keep minimal changes, we must make execute sync-like. Since that's not possible, we switch to a simple shim:
          // We execute synchronously by calling execSync via Atomics? Not safe. Simpler: use .executeSync if available.
          throw new Error('Synchronous run() used with libsql. Please use GET/POST handlers that call .all/.get via async path.');
        },
        get: (...args: unknown[]) => {
          throw new Error('Synchronous get() used with libsql. Please refactor to async or use better-sqlite3.');
        },
        all: (...args: unknown[]) => {
          throw new Error('Synchronous all() used with libsql. Please refactor to async or use better-sqlite3.');
        },
      };
    },
  } as DBLike;
}

export type Person = {
  id: number;
  name: string;
  email?: string | null;
  color?: string | null;
  created_at: string;
};

export type Task = {
  id: number;
  title: string;
  description?: string | null;
  person_id?: number | null;
  status: 'todo' | 'in_progress' | 'done';
  due_date?: string | null; // ISO date
  due_time?: string | null; // HH:mm
  bucket_type?: 'day' | 'week' | 'month' | null;
  bucket_date?: string | null; // ISO date
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
  interval: number;
  byweekday?: string | null; // JSON
  until?: string | null;
  sort?: number;
  color?: string | null;
  priority?: number; // 0..3
  external_id?: string | null;
  source_id?: number | null;
  created_at: string;
  updated_at: string;
};

export type ExternalSource = {
  id: number;
  person_id: number;
  provider: string;
  url?: string | null;
  created_at: string;
};
