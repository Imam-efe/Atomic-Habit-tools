-- Bank Accounts / E-Wallets
CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'Bank', -- 'Bank' | 'E-Wallet' | 'Tunai'
  balance INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Inventory Items / Control
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'pcs', -- 'pcs', 'kg', 'gr', 'liter', 'ml', 'box', etc.
  expiry_date TEXT, -- YYYY-MM-DD
  purchase_date TEXT, -- YYYY-MM-DD
  category TEXT NOT NULL DEFAULT 'Bahan Makanan', -- 'Bahan Makanan' | 'Bahan Dapur' | 'Obat-obatan' | 'Kebutuhan Mandi' | 'Lainnya'
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Kids Schedule
CREATE TABLE IF NOT EXISTS kids_schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kid_name TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'pelajaran', -- 'pelajaran' | 'aktivitas' | 'rutinitas'
  day_of_week TEXT, -- 'Senin' | 'Selasa' | 'Rabu' | 'Kamis' | 'Jumat' | 'Sabtu' | 'Minggu'
  schedule_time TEXT, -- HH:MM (e.g. 08:00)
  schedule_date TEXT, -- YYYY-MM-DD (optional, if one-off)
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Debts & Piutang
CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'debt', -- 'debt' (Hutang kita ke orang) | 'receivable' (Piutang orang ke kita)
  person_name TEXT NOT NULL,
  amount_idr INTEGER NOT NULL,
  due_date TEXT, -- YYYY-MM-DD
  note TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid', -- 'unpaid' | 'paid'
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Debt Payments Schedule
CREATE TABLE IF NOT EXISTS debt_payments (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_idr INTEGER NOT NULL,
  payment_date TEXT NOT NULL, -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled' | 'paid'
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Alter budget_entries to allocate to a bank account and support receipts
ALTER TABLE budget_entries ADD COLUMN bank_account_id TEXT REFERENCES bank_accounts(id);
ALTER TABLE budget_entries ADD COLUMN receipt_img TEXT;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON bank_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_user ON inventory_items(user_id);
CREATE INDEX IF NOT EXISTS idx_kids_schedules_user ON kids_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_debts_user ON debts(user_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments(debt_id);
CREATE INDEX IF NOT EXISTS idx_budget_entries_bank ON budget_entries(bank_account_id);
