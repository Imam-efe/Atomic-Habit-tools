-- Indeks untuk kueri yang dijalankan cron tiap menit.
--
-- Semua kueri di bawah ini terbukti memindai tabel penuh lewat
-- EXPLAIN QUERY PLAN, dan semuanya dijalankan 1440 kali sehari oleh cron. D1
-- menagih BARIS YANG DIBACA, bukan jumlah kueri, jadi pemindaian penuh pada
-- tabel yang tumbuh adalah cara tercepat menghabiskan kuota harian tanpa ada
-- yang kelihatan salah.
--
-- Contoh paling tajam: `SELECT * FROM budget_entries WHERE recurrence IS NOT
-- NULL AND next_recurrence_date <= ?`. Tanpa indeks ia membaca SELURUH tabel
-- transaksi tiap menit. Pada 5.000 transaksi — dua tahun pencatatan harian —
-- itu 7,2 juta baris dibaca per hari dari satu kueri saja, melewati kuota
-- gratis 5 juta/hari sendirian.
--
-- Hanya CREATE INDEX IF NOT EXISTS: tidak ada ALTER, tidak ada DROP, aman
-- diulang tiap deploy seperti berkas migrasi lainnya.

-- Pembersihan berkala. Indeksnya pada kolom waktu yang dipakai WHERE-nya;
-- indeks yang sudah ada tidak terpakai karena kolom waktunya bukan kolom
-- pertama (notification_deliveries) atau kolomnya lain sama sekali
-- (notification_events memakai indeks (user_id, consumed)).
CREATE INDEX IF NOT EXISTS idx_notification_events_created
  ON notification_events(created_at);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_fired
  ON notification_deliveries(fired_at);

CREATE INDEX IF NOT EXISTS idx_garden_care_alert_sent_at
  ON garden_care_alert_sent(sent_at);

CREATE INDEX IF NOT EXISTS idx_daily_alert_sent_at
  ON daily_alert_sent(sent_at);

-- `SELECT DISTINCT user_id FROM push_subscriptions` dipanggil berkali-kali
-- tiap menit. Indeks satu kolom ini membuatnya jadi pembacaan indeks
-- (covering), bukan pemindaian tabel beserta seluruh endpoint dan kuncinya
-- yang panjang.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);

-- Indeks PARSIAL, dan itu intinya.
--
-- Transaksi berulang cuma segelintir baris di antara ribuan transaksi biasa.
-- Indeks biasa atas `next_recurrence_date` akan memuat semua baris termasuk
-- yang NULL; klausa WHERE di sini membuat indeksnya hanya memuat baris yang
-- benar-benar berulang. Jadi kuerinya berubah dari memindai seluruh tabel
-- transaksi jadi menyentuh beberapa baris saja — dan ukurannya tidak ikut
-- tumbuh seiring riwayat transaksi bertambah.
CREATE INDEX IF NOT EXISTS idx_budget_entries_recurring
  ON budget_entries(next_recurrence_date) WHERE recurrence IS NOT NULL;
