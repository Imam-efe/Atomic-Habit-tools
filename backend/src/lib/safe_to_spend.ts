/**
 * "Sisa Aman Hari Ini" — satu angka: boleh habis berapa hari ini tanpa jebol.
 *
 * Dihitung ulang tiap dibaca, tidak disimpan. Angka ini turunan murni dari
 * limit, realisasi, dan tagihan; menyimpannya berarti punya salinan yang bisa
 * basi tiap kali ada entri baru.
 */

export interface SafeToSpend {
  /** Total limit bulan ini dari semua kategori. */
  monthlyLimit: number;
  /** Sudah terpakai bulan ini. */
  spent: number;
  /** Tagihan yang jatuh tempo sisa bulan ini dan belum dibayar. */
  upcomingBills: number;
  /** Sisa yang benar-benar bebas dipakai sampai akhir bulan. */
  remaining: number;
  /** Termasuk hari ini. */
  daysLeft: number;
  /** remaining / daysLeft, tidak pernah negatif. */
  perDay: number;
  /** True kalau tagihan + realisasi sudah melewati limit. */
  overBudget: boolean;
  /** Sudah dihabiskan hari ini, untuk dibandingkan dengan perDay. */
  spentToday: number;
}

/** Jumlah hari dalam bulan YYYY-MM. */
export function daysInMonth(month: string): number {
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

/**
 * @param today Tanggal Jakarta YYYY-MM-DD — sumber kebenaran untuk bulan
 *              berjalan dan sisa hari, supaya tidak ikut zona waktu server.
 */
export async function computeSafeToSpend(
  db: D1Database,
  userId: string,
  today: string
): Promise<SafeToSpend> {
  const month = today.slice(0, 7);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;

  const [limitRow, spentRow, todayRow, billRow] = await Promise.all([
    db
      .prepare('SELECT COALESCE(SUM(monthly_limit_idr), 0) AS total FROM budget_limits WHERE user_id = ?1 AND month = ?2')
      .bind(userId, month)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_idr), 0) AS total FROM budget_entries
         WHERE user_id = ?1 AND type = 'expense' AND entry_date BETWEEN ?2 AND ?3`
      )
      .bind(userId, monthStart, monthEnd)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_idr), 0) AS total FROM budget_entries
         WHERE user_id = ?1 AND type = 'expense' AND entry_date = ?2`
      )
      .bind(userId, today)
      .first<{ total: number }>(),
    // Hanya utang (bukan piutang) yang belum lunas dan jatuh tempo sisa bulan
    // ini — uang yang secara efektif sudah punya tujuan.
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_idr), 0) AS total FROM debts
         WHERE user_id = ?1 AND type = 'debt' AND status != 'paid'
           AND due_date IS NOT NULL AND due_date BETWEEN ?2 AND ?3`
      )
      .bind(userId, today, monthEnd)
      .first<{ total: number }>(),
  ]);

  const monthlyLimit = limitRow?.total ?? 0;
  const spent = spentRow?.total ?? 0;
  const spentToday = todayRow?.total ?? 0;
  const upcomingBills = billRow?.total ?? 0;

  const remaining = monthlyLimit - spent - upcomingBills;
  const daysLeft = daysInMonth(month) - Number(today.slice(8, 10)) + 1;

  return {
    monthlyLimit,
    spent,
    upcomingBills,
    remaining,
    daysLeft,
    // Jatah negatif tidak berarti apa-apa bagi pengguna; batasnya nol dan
    // kondisi jebolnya dilaporkan lewat overBudget.
    perDay: remaining > 0 ? Math.floor(remaining / daysLeft) : 0,
    overBudget: remaining < 0,
    spentToday,
  };
}
