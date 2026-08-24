import { describe, it, expect } from 'vitest';
import { computeSafeToSpend, daysInMonth } from './safe_to_spend';

/**
 * Stub D1 yang menjawab tiap query berdasarkan potongan SQL yang khas.
 * Cukup untuk menguji aritmetikanya tanpa menyalakan database.
 */
function stubDb(totals: {
  limit?: number;
  spent?: number;
  today?: number;
  bills?: number;
}): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            first: async () => {
              if (sql.includes('budget_limits')) return { total: totals.limit ?? 0 };
              if (sql.includes('debts')) return { total: totals.bills ?? 0 };
              if (sql.includes('entry_date = ?2')) return { total: totals.today ?? 0 };
              return { total: totals.spent ?? 0 };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('daysInMonth', () => {
  it('menghitung panjang bulan biasa', () => {
    expect(daysInMonth('2026-01')).toBe(31);
    expect(daysInMonth('2026-04')).toBe(30);
  });

  it('menangani Februari tahun kabisat', () => {
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
  });
});

describe('computeSafeToSpend', () => {
  it('membagi sisa dengan hari tersisa termasuk hari ini', async () => {
    // Limit 3.000.000, terpakai 1.000.000, tanpa tagihan, tanggal 21 Agustus.
    // Sisa 2.000.000 dibagi 11 hari (21..31) = 181.818.
    const result = await computeSafeToSpend(stubDb({ limit: 3_000_000, spent: 1_000_000 }), 'u', '2026-08-21');

    expect(result.remaining).toBe(2_000_000);
    expect(result.daysLeft).toBe(11);
    expect(result.perDay).toBe(181_818);
    expect(result.overBudget).toBe(false);
  });

  it('mengurangi tagihan yang belum jatuh tempo dari sisa', async () => {
    const result = await computeSafeToSpend(
      stubDb({ limit: 3_000_000, spent: 1_000_000, bills: 500_000 }),
      'u',
      '2026-08-21'
    );

    expect(result.upcomingBills).toBe(500_000);
    expect(result.remaining).toBe(1_500_000);
    expect(result.perDay).toBe(136_363);
  });

  it('menandai jebol dan menahan jatah di nol, bukan negatif', async () => {
    const result = await computeSafeToSpend(
      stubDb({ limit: 1_000_000, spent: 900_000, bills: 300_000 }),
      'u',
      '2026-08-21'
    );

    expect(result.remaining).toBe(-200_000);
    expect(result.overBudget).toBe(true);
    // Jatah negatif tidak bisa ditindaklanjuti — pengguna cuma perlu tahu jebol.
    expect(result.perDay).toBe(0);
  });

  it('memperlakukan hari terakhir bulan sebagai satu hari tersisa', async () => {
    const result = await computeSafeToSpend(stubDb({ limit: 1_000_000 }), 'u', '2026-08-31');

    expect(result.daysLeft).toBe(1);
    expect(result.perDay).toBe(1_000_000);
  });

  it('mengembalikan nol bila belum ada limit yang diatur', async () => {
    const result = await computeSafeToSpend(stubDb({}), 'u', '2026-08-21');

    expect(result.monthlyLimit).toBe(0);
    expect(result.perDay).toBe(0);
    expect(result.overBudget).toBe(false);
  });

  it('melaporkan realisasi hari ini terpisah dari realisasi bulan', async () => {
    const result = await computeSafeToSpend(
      stubDb({ limit: 3_000_000, spent: 1_000_000, today: 150_000 }),
      'u',
      '2026-08-21'
    );

    expect(result.spentToday).toBe(150_000);
    expect(result.spent).toBe(1_000_000);
  });
});
