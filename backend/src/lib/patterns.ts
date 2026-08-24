/**
 * "Pencari Pola" — mencari hubungan antar modul, misalnya kebiasaan yang lebih
 * sering bolos saat tidur kurang.
 *
 * Aturan yang menentukan bentuk seluruh modul ini: **tidak pernah mengarang
 * pola.** Setiap perbandingan menyebut jumlah hari yang menopangnya, dan
 * apa pun yang di bawah ambang dikembalikan sebagai "belum cukup data",
 * bukan disajikan sebagai temuan. Insight yang salah tentang kebiasaan
 * sendiri lebih merugikan daripada tidak ada insight.
 */

/** Minimal hari di TIAP sisi perbandingan sebelum layak disebut pola. */
export const MIN_DAYS_PER_SIDE = 5;

/** Selisih tingkat penyelesaian minimal (poin persen) agar dianggap berarti. */
export const MIN_GAP_POINTS = 15;

export interface DayRecord {
  date: string;
  /** Kebiasaan selesai / total pada hari itu, 0..1. Null kalau tidak ada kebiasaan. */
  completionRate: number | null;
  sleepMinutes?: number | null;
  steps?: number | null;
  spend?: number | null;
}

export interface Pattern {
  id: string;
  /** Kalimat siap tampil dalam Bahasa Indonesia. */
  text: string;
  /** Jumlah hari yang menopang tiap sisi, supaya pengguna bisa menilai bobotnya. */
  support: { low: number; high: number };
  /** Selisih poin persen antara dua sisi. */
  gapPoints: number;
}

export interface PatternResult {
  patterns: Pattern[];
  /** Hari yang punya data kebiasaan sama sekali. */
  daysAnalysed: number;
  /**
   * Alasan tiap perbandingan yang dilewati, supaya UI bisa mengatakan apa yang
   * masih kurang alih-alih diam.
   */
  skipped: Array<{ id: string; reason: string }>;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Bandingkan tingkat penyelesaian kebiasaan pada hari bernilai rendah versus
 * tinggi untuk satu metrik, dibelah di mediannya.
 *
 * Median, bukan rata-rata: satu malam begadang ekstrem tidak boleh menggeser
 * garis pemisah sehingga hampir semua hari jatuh ke satu sisi.
 */
function comparAtMedian(
  days: DayRecord[],
  minDays: number,
  minGap: number,
  pick: (d: DayRecord) => number | null | undefined,
  id: string,
  phrase: (lowPct: number, highPct: number, threshold: number) => string,
  formatThreshold: (v: number) => string
): Pattern | { id: string; reason: string } {
  const usable = days.filter(
    (d) => d.completionRate !== null && pick(d) !== null && pick(d) !== undefined
  );

  if (usable.length < minDays * 2) {
    return {
      id,
      reason: `Butuh minimal ${minDays * 2} hari dengan data lengkap, baru ada ${usable.length}.`,
    };
  }

  const sorted = [...usable].sort((a, b) => (pick(a) as number) - (pick(b) as number));
  const mid = Math.floor(sorted.length / 2);
  const low = sorted.slice(0, mid);
  const high = sorted.slice(sorted.length % 2 === 1 ? mid + 1 : mid);

  if (low.length < minDays || high.length < minDays) {
    return { id, reason: `Butuh minimal ${minDays} hari di tiap sisi.` };
  }

  // Semua nilai sama berarti tidak ada yang bisa dibandingkan — misalnya
  // langkah tercatat 0 tiap hari karena integrasinya belum jalan.
  const threshold = pick(sorted[mid]) as number;
  if ((pick(sorted[0]) as number) === (pick(sorted[sorted.length - 1]) as number)) {
    return { id, reason: 'Nilainya sama di semua hari, tidak ada yang bisa dibandingkan.' };
  }

  const lowPct = Math.round(mean(low.map((d) => d.completionRate as number)) * 100);
  const highPct = Math.round(mean(high.map((d) => d.completionRate as number)) * 100);
  const gap = Math.abs(highPct - lowPct);

  if (gap < minGap) {
    return { id, reason: `Selisihnya cuma ${gap} poin, terlalu kecil untuk disebut pola.` };
  }

  return {
    id,
    text: phrase(lowPct, highPct, threshold) + ` (${formatThreshold(threshold)})`,
    support: { low: low.length, high: high.length },
    gapPoints: gap,
  };
}

function isPattern(value: Pattern | { id: string; reason: string }): value is Pattern {
  return 'text' in value;
}

/**
 * Semua perbandingan yang tersedia. Yang lolos ambang jadi pola; sisanya
 * dilaporkan sebagai kekurangan data, bukan dihilangkan diam-diam.
 */
export function findPatterns(
  days: DayRecord[],
  limits: { minDaysPerSide?: number; minGapPoints?: number } = {}
): PatternResult {
  const minDays = limits.minDaysPerSide ?? MIN_DAYS_PER_SIDE;
  const minGap = limits.minGapPoints ?? MIN_GAP_POINTS;
  const daysAnalysed = days.filter((d) => d.completionRate !== null).length;

  const candidates = [
    comparAtMedian(
      days,
      minDays,
      minGap,
      (d) => d.sleepMinutes,
      'sleep',
      (lowPct, highPct) =>
        highPct > lowPct
          ? `Kebiasaanmu ${highPct}% selesai saat tidur lebih lama, dibanding ${lowPct}% saat tidur lebih pendek`
          : `Kebiasaanmu justru ${lowPct}% selesai saat tidur lebih pendek, dibanding ${highPct}% saat tidur lebih lama`,
      (v) => `batas ${Math.floor(v / 60)} jam ${v % 60} menit`
    ),
    comparAtMedian(
      days,
      minDays,
      minGap,
      (d) => d.steps,
      'steps',
      (lowPct, highPct) =>
        highPct > lowPct
          ? `Hari dengan langkah lebih banyak menyelesaikan ${highPct}% kebiasaan, dibanding ${lowPct}% saat kurang bergerak`
          : `Hari dengan langkah lebih sedikit justru menyelesaikan ${lowPct}%, dibanding ${highPct}% saat banyak bergerak`,
      (v) => `batas ${Math.round(v)} langkah`
    ),
    comparAtMedian(
      days,
      minDays,
      minGap,
      (d) => d.spend,
      'spend',
      (lowPct, highPct) =>
        lowPct > highPct
          ? `Kebiasaanmu ${lowPct}% selesai di hari belanja hemat, turun ke ${highPct}% di hari boros`
          : `Kebiasaanmu ${highPct}% selesai di hari pengeluaran besar, dibanding ${lowPct}% di hari hemat`,
      (v) => `batas Rp${Math.round(v).toLocaleString('id-ID')}`
    ),
  ];

  return {
    patterns: candidates.filter(isPattern).sort((a, b) => b.gapPoints - a.gapPoints),
    daysAnalysed,
    skipped: candidates.filter((c): c is { id: string; reason: string } => !isPattern(c)),
  };
}
