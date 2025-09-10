import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database | null = null;

export function getDb() {
  if (db) return db;
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
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
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
