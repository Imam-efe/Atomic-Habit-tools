-- Link debt payments to budget entries for double-entry-style tracking
ALTER TABLE debt_payments ADD COLUMN bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE debt_payments ADD COLUMN budget_entry_id TEXT REFERENCES budget_entries(id) ON DELETE SET NULL;
