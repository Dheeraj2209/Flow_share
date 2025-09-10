import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createClient, Client as LibsqlClient } from '@libsql/client';

export type Row = Record<string, unknown>;
export type RunResult = { lastInsertRowid: number | null; rowsAffected: number };
export type DB = {
  query: (sql: string, params?: any[]) => Promise<Row[]>;
  get: (sql: string, params?: any[]) => Promise<Row | undefined>;
  run: (sql: string, params?: any[]) => Promise<RunResult>;
};

let db: DB | null = null;

export function getDb(): DB {
  if (db) return db;
  const url = process.env.LIBSQL_URL;
  if (url) {
    const client: LibsqlClient = createClient({ url, authToken: process.env.LIBSQL_AUTH_TOKEN });
    db = {
      async query(sql, params = []) {
        const res = await client.execute({ sql, args: params });
        if (!('columns' in res)) return [];
        const cols = res.columns.map((c: any) => (typeof c === 'string' ? c : (c?.name || '')));
        return res.rows.map((r: any) => Object.fromEntries(cols.map((c: string, i: number) => [c, r[i] as unknown])));
      },
      async get(sql, params = []) {
        const res = await client.execute({ sql, args: params });
        if (!('columns' in res) || res.rows.length === 0) return undefined;
        const cols = res.columns.map((c: any) => (typeof c === 'string' ? c : (c?.name || '')));
        const row = res.rows[0];
        return Object.fromEntries(cols.map((c: string, i: number) => [c, row[i] as unknown]));
      },
      async run(sql, params = []) {
        const res = await client.execute({ sql, args: params });
        const lid = (res as any).lastInsertRowid != null ? Number((res as any).lastInsertRowid) : null;
        const ra = (res as any).rowsAffected != null ? Number((res as any).rowsAffected) : 0;
        return { lastInsertRowid: lid, rowsAffected: ra };
      },
    };
    void migrate(db).catch(() => {});
    return db;
  }

  // Local SQLite fallback (ephemeral on cloud hosts)
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
  db = {
    async query(sql, params = []) {
      return native.prepare(sql).all(...params) as Row[];
    },
    async get(sql, params = []) {
      return native.prepare(sql).get(...params) as Row | undefined;
    },
    async run(sql, params = []) {
      const info = native.prepare(sql).run(...params);
      return { lastInsertRowid: info.lastInsertRowid ? Number(info.lastInsertRowid) : null, rowsAffected: Number((info as any).changes || 0) };
    },
  };
  void migrate(db).catch(() => {});
  return db;
}

async function migrate(db: DB) {
  await db.run(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      person_id INTEGER,
      status TEXT NOT NULL DEFAULT 'todo',
      due_date TEXT,
      due_time TEXT,
      bucket_type TEXT,
      bucket_date TEXT,
      recurrence TEXT NOT NULL DEFAULT 'none',
      interval INTEGER NOT NULL DEFAULT 1,
      byweekday TEXT,
      until TEXT,
      sort INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
    )
  `);

  await db.run(`
    CREATE TRIGGER IF NOT EXISTS tasks_updated_at
    AFTER UPDATE ON tasks
    FOR EACH ROW
    BEGIN
      UPDATE tasks SET updated_at = datetime('now') WHERE id = OLD.id;
    END;
  `);

  await db.run(`
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
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS task_done_dates (
      task_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      PRIMARY KEY (task_id, date),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `);

  try {
    const cols = await db.query(`PRAGMA table_info(tasks)`);
    const names = new Set(cols.map(c => String(c.name)));
    if (!names.has('due_time')) await db.run(`ALTER TABLE tasks ADD COLUMN due_time TEXT`);
    if (!names.has('sort')) await db.run(`ALTER TABLE tasks ADD COLUMN sort INTEGER NOT NULL DEFAULT 0`);
    if (!names.has('color')) await db.run(`ALTER TABLE tasks ADD COLUMN color TEXT`);
    if (!names.has('priority')) await db.run(`ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`);
    if (!names.has('external_id')) await db.run(`ALTER TABLE tasks ADD COLUMN external_id TEXT`);
    if (!names.has('source_id')) await db.run(`ALTER TABLE tasks ADD COLUMN source_id INTEGER`);
  } catch {}

  try {
    const scols = await db.query(`PRAGMA table_info(external_sources)`);
    const snames = new Set(scols.map(c => String(c.name)));
    if (!snames.has('access_token')) await db.run(`ALTER TABLE external_sources ADD COLUMN access_token TEXT`);
    if (!snames.has('refresh_token')) await db.run(`ALTER TABLE external_sources ADD COLUMN refresh_token TEXT`);
    if (!snames.has('expires_at')) await db.run(`ALTER TABLE external_sources ADD COLUMN expires_at INTEGER`);
    if (!snames.has('scope')) await db.run(`ALTER TABLE external_sources ADD COLUMN scope TEXT`);
    if (!snames.has('account')) await db.run(`ALTER TABLE external_sources ADD COLUMN account TEXT`);
  } catch {}

  try {
    const pcols = await db.query(`PRAGMA table_info(people)`);
    const pnames = new Set(pcols.map(c => String(c.name)));
    if (!pnames.has('color')) await db.run(`ALTER TABLE people ADD COLUMN color TEXT`);
  } catch {}
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
  due_date?: string | null;
  due_time?: string | null;
  bucket_type?: 'day' | 'week' | 'month' | null;
  bucket_date?: string | null;
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
  interval: number;
  byweekday?: string | null;
  until?: string | null;
  sort?: number;
  color?: string | null;
  priority?: number;
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

