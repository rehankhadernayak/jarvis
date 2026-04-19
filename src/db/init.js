require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(require('os').homedir(), '.jarvis-v2', 'jarvis.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS memory (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS google_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    refresh_token TEXT,
    access_token TEXT,
    token_expiry INTEGER,
    label TEXT DEFAULT 'personal',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    attempted INTEGER,
    score INTEGER,
    weak_areas TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ml_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day INTEGER,
    built TEXT,
    score INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    due_date TEXT,
    priority TEXT DEFAULT 'medium',
    source TEXT DEFAULT 'manual',
    done INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS health_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE,
    steps INTEGER,
    heart_rate INTEGER,
    calories INTEGER,
    distance_km REAL,
    active_minutes INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL,
    category TEXT,
    description TEXT,
    date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS time_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    start_time TEXT,
    end_time TEXT,
    block_type TEXT DEFAULT 'focus',
    calendar_event_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS news_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    url TEXT UNIQUE,
    source TEXT,
    category TEXT,
    published_at TEXT,
    summary TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT,
    content TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sleep_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    logged_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    context TEXT,
    decision TEXT NOT NULL,
    outcome TEXT,
    tags TEXT,
    date TEXT DEFAULT (date('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    content_text TEXT,
    summary TEXT,
    tags TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS github_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo TEXT,
    event_type TEXT,
    title TEXT,
    sha TEXT UNIQUE,
    author TEXT,
    url TEXT,
    event_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS research_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    result TEXT,
    sources TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS transcriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    transcript TEXT,
    summary TEXT,
    duration_s REAL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS repair_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    errors TEXT,
    fix_applied TEXT,
    status TEXT DEFAULT 'pending',
    output TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS mood_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mood INTEGER,
    notes TEXT,
    context TEXT,
    stress_level INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS telegram_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    description TEXT NOT NULL,
    steps TEXT,
    status TEXT DEFAULT 'pending',
    result TEXT,
    progress TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    frequency TEXT DEFAULT 'daily',
    target_days INTEGER DEFAULT 30,
    streak INTEGER DEFAULT 0,
    total_completed INTEGER DEFAULT 0,
    last_done TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS habit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL,
    done_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(habit_id, done_date)
  );
  CREATE TABLE IF NOT EXISTS reading_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    type TEXT DEFAULT 'book',
    url TEXT,
    status TEXT DEFAULT 'unread',
    notes TEXT,
    added_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS university_deadlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school TEXT NOT NULL,
    program TEXT,
    deadline_date TEXT NOT NULL,
    type TEXT DEFAULT 'application',
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS gametime_crm (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_info TEXT,
    family_size INTEGER,
    source TEXT,
    status TEXT DEFAULT 'prospect',
    last_contact TEXT,
    next_followup TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS crm_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL,
    note TEXT,
    outcome TEXT,
    logged_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_type TEXT DEFAULT 'meal',
    description TEXT NOT NULL,
    calories INTEGER,
    protein_g REAL,
    date TEXT DEFAULT (date('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pomodoro_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task TEXT,
    duration_min INTEGER DEFAULT 25,
    completed INTEGER DEFAULT 0,
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT
  );
`);

// Seed Google account with existing refresh token
const existing = db.prepare('SELECT id FROM google_accounts WHERE email=?').get('rehan.khadernayak.2009@gmail.com');
if (!existing) {
  db.prepare('INSERT INTO google_accounts (email, refresh_token, label) VALUES (?,?,?)').run(
    'rehan.khadernayak.2009@gmail.com',
    '1//0g-R6PHC-gmtVCgYIARAAGBASNwF-L9IrFh8TlC-F6KQlacaZmHeS89TpGe3jqGhs-i1Id2QP3dxbEO9ZG5NIutKG9roinj3gWgg',
    'personal'
  );
}

// Seed key memory values from v1
const seedMemory = (key, value) => {
  const exists = db.prepare('SELECT key FROM memory WHERE key=?').get(key);
  if (!exists) db.prepare('INSERT INTO memory (key, value) VALUES (?,?)').run(key, value);
};
seedMemory('gametime_beta_users', '3');
seedMemory('gametime_next_milestone', 'reach 10 beta families');
seedMemory('ml_current_day', '1');
seedMemory('sat_last_session', JSON.stringify({date:'2026-03-20',attempted:20,score:14,weakAreas:'transition words, comma splices'}));

const setMemory = (key, value) => db.prepare("INSERT OR REPLACE INTO memory (key, value, updated_at) VALUES (?,?,strftime('%s','now'))").run(key, String(value));
const getMemory = (key) => { const r = db.prepare('SELECT value FROM memory WHERE key=?').get(key); return r?.value ?? null; };
const getAllMemory = () => db.prepare('SELECT key, value FROM memory').all();

module.exports = { db, setMemory, getMemory, getAllMemory };
