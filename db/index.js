const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'mcarbon.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'billing_officer',   -- admin | billing_officer | viewer
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  account_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  tin TEXT,
  status TEXT NOT NULL DEFAULT 'Ongoing Data Collection',
  addr_unit TEXT, addr_building TEXT, addr_street TEXT, addr_barangay TEXT,
  addr_city TEXT, addr_region TEXT, addr_country TEXT DEFAULT 'Philippines', addr_zip TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, position TEXT, phone TEXT, email TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  lighting_type TEXT,
  lighting_qty INTEGER,
  operating_brightness TEXT,
  saving_brightness TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  device_type TEXT, device_no TEXT
);

-- One active contract / billing configuration per project.
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_date TEXT, end_date TEXT,
  late_interest_rate REAL DEFAULT 0,          -- % per month on overdue balance
  settlement_day INTEGER DEFAULT 25,          -- cut-off day of month
  bill_day INTEGER DEFAULT 1,
  payment_terms_days INTEGER DEFAULT 15,
  baseline_method TEXT DEFAULT 'fixed',       -- fixed | savings_pct | operating_hours
  dashboard_daily_baseline REAL,              -- kWh/day
  agreed_savings_pct REAL,                    -- e.g. 67.5 (percent)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sharing_ratios (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  label TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  ines_pct REAL NOT NULL,
  client_pct REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS rates (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                        -- e.g. "Solar 07:00-15:00"
  rate REAL NOT NULL,                         -- PHP per kWh
  time_from TEXT, time_to TEXT,
  effective_from TEXT, effective_to TEXT
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY,
  statement_no TEXT UNIQUE NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  days INTEGER NOT NULL,
  bill_date TEXT, due_date TEXT,
  source TEXT NOT NULL DEFAULT 'manual',      -- manual | dashboard
  baseline_method TEXT NOT NULL,
  inputs_json TEXT NOT NULL DEFAULT '{}',     -- frozen calculation inputs
  baseline_kwh REAL DEFAULT 0,
  actual_kwh REAL DEFAULT 0,
  energy_savings_kwh REAL DEFAULT 0,
  rate_breakdown_json TEXT NOT NULL DEFAULT '[]',
  gross_savings REAL DEFAULT 0,
  ines_pct REAL DEFAULT 0,
  client_pct REAL DEFAULT 0,
  amount_billed REAL DEFAULT 0,
  client_retained REAL DEFAULT 0,
  previous_balance REAL DEFAULT 0,
  interest_charged REAL DEFAULT 0,
  total_due REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',       -- draft|for_review|approved|final|issued|void
  notes TEXT,
  revises_bill_id INTEGER REFERENCES bills(id),
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finalized_at TEXT, issued_at TEXT
);

CREATE TABLE IF NOT EXISTS bill_days (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  day_date TEXT NOT NULL,
  actual_kwh REAL DEFAULT 0,
  operating_hours REAL,
  baseline_kwh REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  paid_on TEXT NOT NULL,
  amount REAL NOT NULL,
  reference TEXT, method TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS adjustments (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  adjusted_on TEXT NOT NULL,
  amount REAL NOT NULL,                       -- negative = credit
  reason TEXT NOT NULL,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  username TEXT,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_bills_client ON bills(client_id, period_start);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
`);

// --- Migrations: columns added after the initial schema, applied on boot ---
// SQLite has no "ADD COLUMN IF NOT EXISTS", so these are wrapped in try/catch
// and simply no-op once the column already exists.
function addColumn(table, def) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`); } catch (e) { /* already exists */ }
}
addColumn('projects', 'family_id TEXT');
addColumn('projects', 'family_id_name TEXT');       // snapshot of the dashboard site's name at link time
addColumn('projects', 'family_id_district TEXT');   // snapshot of its district at link time, for display + drift checks
addColumn('bills', 'dashboard_synced_at TEXT');     

// Seed a first administrator so the app is usable on first run.
const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (count === 0) {
  const pw = process.env.ADMIN_PASSWORD || 'changeme123';
  db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)'
  ).run('admin', bcrypt.hashSync(pw, 10), 'System Administrator', 'admin');
  console.log(`[db] Seeded administrator "admin" with password "${pw}" — change it after first login.`);
}

module.exports = db;