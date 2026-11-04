-- Indeks putaran kedua: jalur permintaan, bukan cron.
--
-- Migrasi 0045 memperbaiki cron, yang biayanya tetap 1440 kali sehari apa pun
-- yang pengguna lakukan. Berkas ini memperbaiki sisanya: kueri yang berjalan
-- saat aplikasi dibuka, dan pemindaian yang muncul saat sebuah baris dihapus.
--
-- Semuanya ditemukan dengan EXPLAIN QUERY PLAN atas 560 kueri statis di
-- src/, lalu disilangkan dengan PRAGMA foreign_key_list dan PRAGMA index_list
-- untuk menemukan kolom yang dirujuk tapi tidak terindeks.
--
-- Bentuk indeksnya mengikuti bentuk kueri yang benar-benar ada, bukan satu
-- kolom asal-asalan: indeks `(user_id, tanggal)` melayani `WHERE user_id = ?`
-- DAN `WHERE user_id = ? AND tanggal = ?`, sementara indeks `(user_id)` saja
-- memaksa yang kedua tetap memeriksa tiap baris pengguna itu.

-- ───────────────── user_id yang tidak terindeks ─────────────────
--
-- Tiap `WHERE user_id = ?` pada tabel ini memindai seluruh tabel. Yang paling
-- menentukan `habit_completions`: ia bertambah satu baris per kebiasaan per
-- hari — tabel yang tumbuh paling cepat di aplikasi pelacak kebiasaan — dan
-- dibaca dasbor setiap kali aplikasi dibuka.
CREATE INDEX IF NOT EXISTS idx_habit_completions_user_date
  ON habit_completions(user_id, completed_date);

CREATE INDEX IF NOT EXISTS idx_debt_payments_user_date
  ON debt_payments(user_id, payment_date);

CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_bundle_completions_user ON bundle_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_garden_harvest_stock_user ON garden_harvest_stock(user_id);
CREATE INDEX IF NOT EXISTS idx_garden_photos_user ON garden_photos(user_id);
CREATE INDEX IF NOT EXISTS idx_garden_bed_markers_user ON garden_bed_markers(user_id);
CREATE INDEX IF NOT EXISTS idx_garden_sowing_seed_source_user ON garden_sowing_seed_source(user_id);
CREATE INDEX IF NOT EXISTS idx_ternak_ukur_user ON ternak_ukur(user_id);
CREATE INDEX IF NOT EXISTS idx_ternak_air_user_kandang ON ternak_air(user_id, kandang_id);

-- Keduanya ada di jalur autentikasi: dibaca tiap kali sesi disegarkan dan tiap
-- permintaan dari Shortcut iOS, jadi pemindaiannya dibayar sebelum permintaan
-- apa pun mulai dikerjakan.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_shortcut_tokens_user ON shortcut_tokens(user_id);

-- ───────────── kolom foreign key yang tidak terindeks ─────────────
--
-- SQLite menegakkan ON DELETE CASCADE dan SET NULL dengan MENCARI baris anak
-- yang menunjuk induk yang dihapus. Tanpa indeks pada kolom penunjuknya,
-- pencarian itu memindai seluruh tabel anak — jadi menghapus satu rekening
-- memindai seluruh riwayat pembayaran hutang dan seluruh tagihan terjadwal,
-- dan menghapus satu transaksi memindai seluruh tabel pembayaran.
CREATE INDEX IF NOT EXISTS idx_debt_payments_budget_entry
  ON debt_payments(budget_entry_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_bank
  ON debt_payments(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_finance_tagihan_bank
  ON finance_tagihan(bank_account_id);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_projects_goal ON projects(goal_id);

CREATE INDEX IF NOT EXISTS idx_notes_linked_goal ON notes(linked_goal_id);
CREATE INDEX IF NOT EXISTS idx_notes_linked_habit ON notes(linked_habit_id);

CREATE INDEX IF NOT EXISTS idx_habit_bundles_desire ON habit_bundles(desire_habit_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notif
  ON notification_deliveries(notification_id);

CREATE INDEX IF NOT EXISTS idx_garden_sowings_planting ON garden_sowings(planting_id);
CREATE INDEX IF NOT EXISTS idx_garden_compost_applied
  ON garden_compost_batches(applied_planting_id);
CREATE INDEX IF NOT EXISTS idx_garden_propagation_planting
  ON garden_propagation(planting_id);
CREATE INDEX IF NOT EXISTS idx_garden_propagation_source
  ON garden_propagation(source_planting_id);
CREATE INDEX IF NOT EXISTS idx_garden_sanitation_bed
  ON garden_sanitation_log(bed_id);
