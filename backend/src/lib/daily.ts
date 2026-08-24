/**
 * Kueri lintas-modul untuk rangkaian fitur harian.
 *
 * Semua fungsi di sini murni baca dan menerima `today` sebagai argumen, bukan
 * memanggil jakartaToday() sendiri. Alasannya dua: cron dan route memakai
 * fungsi yang sama tanpa risiko beda hari di tengah eksekusi, dan pengujian
 * bisa memilih tanggalnya.
 */

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** Nama hari Indonesia untuk YYYY-MM-DD, cocok dengan kids_schedules.day_of_week. */
export function dayName(date: string): string {
  return DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** Geser YYYY-MM-DD sebanyak n hari. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Selisih hari dari `from` ke `to`, keduanya YYYY-MM-DD. Negatif berarti `to` sebelum `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000
  );
}

export interface DueBill {
  id: string;
  personName: string;
  amount: number;
  dueDate: string;
  /** Sisa hari sampai jatuh tempo; 0 berarti hari ini, negatif berarti telat. */
  daysUntil: number;
}

export interface BillRadar {
  bills: DueBill[];
  total: number;
  /** Rekening dengan saldo cukup untuk menutup seluruh total. */
  coveringAccount: { id: string; name: string; balance: number } | null;
  /** Saldo seluruh rekening, dipakai saat tidak ada satu rekening yang cukup. */
  totalBalance: number;
}

/**
 * Utang yang jatuh tempo dalam `withinDays` hari ke depan, plus rekening mana
 * yang sanggup menutupinya.
 *
 * Yang sudah lewat jatuh tempo ikut disertakan — telat bayar justru paling
 * perlu diingatkan, bukan disembunyikan karena tanggalnya sudah lewat.
 */
export async function getBillRadar(
  db: D1Database,
  userId: string,
  today: string,
  withinDays = 3
): Promise<BillRadar> {
  const horizon = shiftDate(today, withinDays);

  const [billRows, accountRows] = await Promise.all([
    db
      .prepare(
        `SELECT id, person_name, amount_idr, due_date FROM debts
         WHERE user_id = ?1 AND type = 'debt' AND status != 'paid'
           AND due_date IS NOT NULL AND due_date <= ?2
         ORDER BY due_date ASC`
      )
      .bind(userId, horizon)
      .all<{ id: string; person_name: string; amount_idr: number; due_date: string }>(),
    db
      .prepare('SELECT id, name, balance FROM bank_accounts WHERE user_id = ?1 ORDER BY balance DESC')
      .bind(userId)
      .all<{ id: string; name: string; balance: number }>(),
  ]);

  const bills: DueBill[] = (billRows.results ?? []).map((row) => ({
    id: row.id,
    personName: row.person_name,
    amount: row.amount_idr,
    dueDate: row.due_date,
    daysUntil: daysBetween(today, row.due_date),
  }));

  const total = bills.reduce((sum, bill) => sum + bill.amount, 0);
  const accounts = accountRows.results ?? [];

  return {
    bills,
    total,
    // Diurutkan saldo menurun, jadi yang pertama cukup adalah yang terbesar —
    // sengaja: menyarankan rekening paling aman, bukan yang paling pas-pasan.
    coveringAccount: accounts.find((a) => a.balance >= total) ?? null,
    totalBalance: accounts.reduce((sum, a) => sum + a.balance, 0),
  };
}

export interface KidItem {
  kidName: string;
  title: string;
  type: string;
  time: string | null;
  note: string | null;
}

/**
 * Jadwal anak untuk satu tanggal: yang berulang mingguan pada hari itu,
 * ditambah yang sekali jalan bertanggal persis.
 */
export async function getKidsFor(
  db: D1Database,
  userId: string,
  date: string
): Promise<KidItem[]> {
  const rows = await db
    .prepare(
      `SELECT kid_name, title, type, schedule_time, note FROM kids_schedules
       WHERE user_id = ?1 AND (day_of_week = ?2 OR schedule_date = ?3)
       ORDER BY COALESCE(schedule_time, '99:99') ASC, kid_name ASC`
    )
    .bind(userId, dayName(date), date)
    .all<{ kid_name: string; title: string; type: string; schedule_time: string | null; note: string | null }>();

  return (rows.results ?? []).map((row) => ({
    kidName: row.kid_name,
    title: row.title,
    type: row.type,
    time: row.schedule_time,
    note: row.note,
  }));
}

export interface MissedHabit {
  id: string;
  name: string;
  streak: number;
  /** Versi dua menit, bila pengguna sudah menuliskannya. */
  twoMin: string | null;
}

/**
 * Kebiasaan yang terlewat kemarin dan belum dikerjakan hari ini.
 *
 * Inti prinsip "jangan bolos dua kali": yang penting bukan bolosnya, tapi
 * mencegah bolos kedua berturut-turut. Kebiasaan berfrekuensi mingguan
 * dikecualikan — "tidak dikerjakan kemarin" bukan kegagalan bagi kebiasaan
 * yang targetnya per minggu.
 */
export async function getMissedYesterday(
  db: D1Database,
  userId: string,
  today: string
): Promise<MissedHabit[]> {
  const yesterday = shiftDate(today, -1);

  const rows = await db
    .prepare(
      `SELECT h.id, h.name, h.streak, h.two_min
       FROM habits h
       LEFT JOIN habit_frequency hf ON hf.habit_id = h.id
       WHERE h.user_id = ?1
         AND (hf.frequency_type IS NULL OR hf.frequency_type != 'weekly')
         -- Baru pernah dikerjakan sama sekali. Kebiasaan yang belum pernah
         -- disentuh bukan "bolos", ia belum dimulai.
         AND h.last_completed_date IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM habit_completions c
           WHERE c.habit_id = h.id AND c.user_id = ?1 AND c.completed_date = ?2
         )
         AND NOT EXISTS (
           SELECT 1 FROM habit_completions c
           WHERE c.habit_id = h.id AND c.user_id = ?1 AND c.completed_date = ?3
         )
       ORDER BY h.streak DESC`
    )
    .bind(userId, yesterday, today)
    .all<{ id: string; name: string; streak: number; two_min: string | null }>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    streak: row.streak,
    twoMin: row.two_min,
  }));
}

export interface ExpiringItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  expiryDate: string;
  daysLeft: number;
}

/** Stok yang kedaluwarsa dalam `withinDays` hari, termasuk yang sudah lewat. */
export async function getExpiringItems(
  db: D1Database,
  userId: string,
  today: string,
  withinDays = 3
): Promise<ExpiringItem[]> {
  const rows = await db
    .prepare(
      `SELECT id, name, quantity, unit, expiry_date FROM inventory_items
       WHERE user_id = ?1 AND expiry_date IS NOT NULL AND expiry_date <= ?2
       ORDER BY expiry_date ASC`
    )
    .bind(userId, shiftDate(today, withinDays))
    .all<{ id: string; name: string; quantity: number; unit: string; expiry_date: string }>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    expiryDate: row.expiry_date,
    daysLeft: daysBetween(today, row.expiry_date),
  }));
}
