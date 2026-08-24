/**
 * Efektivitas penanganan hama (#9).
 *
 * `garden_pest_log` sudah menyimpan `treatment` dan kolom `worked`, tapi tidak
 * pernah ada yang menanyakan hasilnya, jadi kolom itu selalu kosong. Padahal di
 * situlah nilainya: musim depan yang berguna bukan "dulu kena kutu daun",
 * melainkan "yang berhasil waktu itu apa".
 *
 * Yang dinilai adalah penanganan pada hama tertentu, bukan penanganan secara
 * umum — neem oil bisa manjur untuk kutu daun dan sia-sia untuk ulat.
 */

export interface TreatmentRecord {
  pest: string;
  treatment: string | null;
  /** null berarti belum dinilai. */
  worked: number | null;
  spottedDate: string;
  resolvedDate: string | null;
}

export interface TreatmentScore {
  pest: string;
  treatment: string;
  tried: number;
  worked: number;
  successPercent: number;
  /** Rata-rata hari dari terlihat sampai teratasi, bila tercatat. */
  avgDaysToResolve: number | null;
}

export interface PendingReview {
  pest: string;
  treatment: string | null;
  spottedDate: string;
  daysSince: number;
}

/** Setelah sekian hari, hasil penanganan sudah bisa dinilai. */
export const REVIEW_AFTER_DAYS = 7;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000
  );
}

/** Normalisasi ringan supaya "Neem oil" dan "neem oil " tidak jadi dua baris. */
function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Peringkat penanganan per hama, dari yang paling sering berhasil.
 *
 * Catatan tanpa treatment atau yang belum dinilai dilewati: keduanya tidak
 * mengandung informasi tentang apa yang bekerja.
 */
export function rankTreatments(records: TreatmentRecord[]): TreatmentScore[] {
  const groups = new Map<string, {
    pest: string; treatment: string; tried: number; worked: number; resolveDays: number[];
  }>();

  for (const r of records) {
    if (r.worked === null) continue;
    const treatment = r.treatment?.trim();
    if (!treatment) continue;

    const key = `${normalize(r.pest)}|${normalize(treatment)}`;
    const entry = groups.get(key) ?? {
      pest: r.pest.trim(), treatment, tried: 0, worked: 0, resolveDays: [],
    };
    entry.tried += 1;
    if (r.worked === 1) {
      entry.worked += 1;
      if (r.resolvedDate) {
        const d = daysBetween(r.spottedDate, r.resolvedDate);
        if (d >= 0) entry.resolveDays.push(d);
      }
    }
    groups.set(key, entry);
  }

  const scores: TreatmentScore[] = [];
  for (const e of groups.values()) {
    scores.push({
      pest: e.pest,
      treatment: e.treatment,
      tried: e.tried,
      worked: e.worked,
      successPercent: Math.round((e.worked / e.tried) * 100),
      avgDaysToResolve: e.resolveDays.length > 0
        ? Math.round(e.resolveDays.reduce((s, d) => s + d, 0) / e.resolveDays.length)
        : null,
    });
  }

  // Diurut per hama dulu supaya tampilannya mengelompok, baru keberhasilan.
  // Jumlah percobaan jadi pemecah seri: 3 dari 3 lebih meyakinkan dari 1 dari 1.
  return scores.sort((a, b) => {
    if (a.pest !== b.pest) return a.pest.localeCompare(b.pest);
    if (b.successPercent !== a.successPercent) return b.successPercent - a.successPercent;
    return b.tried - a.tried;
  });
}

/**
 * Catatan hama yang sudah waktunya ditanya "berhasil atau tidak".
 *
 * Inilah yang menutup lingkarannya — tanpa daftar ini kolom `worked` akan
 * tetap kosong selamanya.
 */
export function pendingReviews(records: TreatmentRecord[], today: string): PendingReview[] {
  const out: PendingReview[] = [];

  for (const r of records) {
    if (r.worked !== null) continue;
    const daysSince = daysBetween(r.spottedDate, today);
    if (daysSince < REVIEW_AFTER_DAYS) continue;
    out.push({ pest: r.pest, treatment: r.treatment, spottedDate: r.spottedDate, daysSince });
  }

  // Yang paling lama menggantung ditanya lebih dulu.
  return out.sort((a, b) => b.daysSince - a.daysSince);
}

/** Saran penanganan untuk hama yang baru terlihat, dari riwayat sendiri. */
export function bestTreatmentFor(pest: string, scores: TreatmentScore[]): TreatmentScore | null {
  const target = normalize(pest);
  const candidates = scores.filter((s) => normalize(s.pest) === target && s.worked > 0);
  return candidates.length > 0 ? candidates[0] : null;
}
