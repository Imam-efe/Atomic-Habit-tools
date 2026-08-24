import { describe, it, expect } from 'vitest';
import { findPatterns, MIN_DAYS_PER_SIDE, type DayRecord } from './patterns';

/** Bikin n hari dengan tidur dan tingkat penyelesaian yang ditentukan. */
function days(specs: Array<[sleepMinutes: number, completionRate: number]>): DayRecord[] {
  return specs.map(([sleepMinutes, completionRate], i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    completionRate,
    sleepMinutes,
  }));
}

describe('findPatterns', () => {
  it('menemukan hubungan tidur dengan kebiasaan bila selisihnya jelas', () => {
    // 6 malam pendek dengan penyelesaian rendah, 6 malam panjang dengan tinggi.
    const result = findPatterns(
      days([
        [300, 0.2], [310, 0.3], [290, 0.2], [305, 0.25], [295, 0.3], [300, 0.2],
        [480, 0.9], [470, 0.8], [490, 0.9], [475, 0.85], [485, 0.9], [480, 0.8],
      ])
    );

    const sleep = result.patterns.find((p) => p.id === 'sleep');
    expect(sleep).toBeDefined();
    expect(sleep!.gapPoints).toBeGreaterThan(50);
    // Jumlah hari penopang harus ikut dilaporkan supaya bisa dinilai bobotnya.
    expect(sleep!.support.low).toBe(6);
    expect(sleep!.support.high).toBe(6);
  });

  it('menolak menyimpulkan saat harinya belum cukup', () => {
    const result = findPatterns(days([[300, 0.2], [480, 0.9], [310, 0.3]]));

    expect(result.patterns).toEqual([]);
    const skipped = result.skipped.find((s) => s.id === 'sleep');
    expect(skipped?.reason).toContain('Butuh minimal');
  });

  it('menyebut berapa hari yang sudah terkumpul, bukan sekadar bilang kurang', () => {
    const result = findPatterns(days([[300, 0.2], [480, 0.9], [310, 0.3]]));
    expect(result.skipped.find((s) => s.id === 'sleep')?.reason).toContain('baru ada 3');
  });

  it('menolak selisih yang terlalu kecil untuk disebut pola', () => {
    // Data cukup banyak, tapi penyelesaiannya hampir sama di kedua sisi.
    const result = findPatterns(
      days([
        [300, 0.50], [305, 0.52], [295, 0.48], [310, 0.51], [290, 0.49], [300, 0.50],
        [480, 0.55], [470, 0.54], [490, 0.56], [475, 0.53], [485, 0.55], [480, 0.54],
      ])
    );

    expect(result.patterns.find((p) => p.id === 'sleep')).toBeUndefined();
    expect(result.skipped.find((s) => s.id === 'sleep')?.reason).toContain('terlalu kecil');
  });

  it('menolak membandingkan saat semua nilainya sama', () => {
    // Contoh nyata: integrasi langkah belum jalan, jadi tercatat 0 tiap hari.
    const flat: DayRecord[] = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      completionRate: i < 6 ? 0.2 : 0.9,
      steps: 0,
    }));

    const result = findPatterns(flat);
    expect(result.patterns.find((p) => p.id === 'steps')).toBeUndefined();
    expect(result.skipped.find((s) => s.id === 'steps')?.reason).toContain('sama di semua hari');
  });

  it('melaporkan arah hubungan yang berlawanan apa adanya', () => {
    // Tidur panjang justru berbarengan dengan penyelesaian rendah. Polanya
    // tetap dilaporkan, tidak dibalik agar terdengar seperti nasihat umum.
    const result = findPatterns(
      days([
        [300, 0.9], [310, 0.85], [290, 0.9], [305, 0.88], [295, 0.9], [300, 0.86],
        [480, 0.2], [470, 0.3], [490, 0.2], [475, 0.25], [485, 0.2], [480, 0.3],
      ])
    );

    expect(result.patterns.find((p) => p.id === 'sleep')?.text).toContain('justru');
  });

  it('mengabaikan hari tanpa data kebiasaan', () => {
    const mixed: DayRecord[] = [
      ...days([[300, 0.2], [310, 0.3], [290, 0.2], [305, 0.25], [295, 0.3], [300, 0.2]]),
      ...days([[480, 0.9], [470, 0.8], [490, 0.9], [475, 0.85], [485, 0.9], [480, 0.8]]),
      { date: '2026-08-20', completionRate: null, sleepMinutes: 400 },
    ];

    const result = findPatterns(mixed);
    expect(result.daysAnalysed).toBe(12);
  });

  it('mengurutkan pola dari selisih terbesar', () => {
    const records: DayRecord[] = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      completionRate: i < 6 ? 0.2 : 0.9,
      sleepMinutes: i < 6 ? 300 : 480,
      // Selisih belanja dibuat lebih tipis daripada tidur.
      spend: i < 6 ? 100_000 : 120_000,
    }));

    const result = findPatterns(records);
    if (result.patterns.length > 1) {
      expect(result.patterns[0].gapPoints).toBeGreaterThanOrEqual(result.patterns[1].gapPoints);
    }
    expect(MIN_DAYS_PER_SIDE).toBe(5);
  });
});
