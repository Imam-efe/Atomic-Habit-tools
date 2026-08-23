/**
 * nutrition_insight.ts — %AKG terhadap Acuan Label Gizi (ALG) BPOM.
 *
 * Sumber: Peraturan BPOM No. 26/2021 ttg Informasi Nilai Gizi pada Label
 * Pangan Olahan. calories/protein/fat/carbs SUDAH diverifikasi lewat
 * pencarian web saat brainstorming fitur ini. saturatedFat/sugar/sodium
 * BELUM dicocokkan ke teks regulasi asli — jaringan sesi penulisan
 * memblokir situs BPOM (tabel-gizi.pom.go.id, peraturan.go.id). Nilai di
 * bawah dari ingatan model, dipilih konservatif. Cross-check ke dokumen
 * primer sebelum dipakai untuk klaim kesehatan; jangan hapus catatan ini
 * sampai itu dilakukan.
 *
 * ALG tidak mendefinisikan acuan serat — sengaja tidak ada di sini, serat
 * ditampilkan di UI apa adanya tanpa persentase.
 */

export interface AlgNutrients {
  calories: number;
  protein: number;
  fat: number;
  saturatedFat: number;
  carbs: number;
  sugar: number;
  sodium: number; // mg
}

export const ALG_UMUM: AlgNutrients = {
  calories: 2150,     // kkal — terverifikasi
  protein: 60,        // g — terverifikasi
  fat: 67,             // g — terverifikasi
  saturatedFat: 20,    // g — BELUM TERVERIFIKASI, lihat catatan di atas
  carbs: 325,          // g — terverifikasi
  sugar: 50,           // g — BELUM TERVERIFIKASI
  sodium: 1500,        // mg — BELUM TERVERIFIKASI
};

/** Peringatan muncul kalau satu sajian sudah lewat ini dari acuan harian. */
const WARNING_THRESHOLD_PCT = 20;

export function computeAlgPercent(perServing: AlgNutrients): AlgNutrients {
  const pct = (value: number, ref: number) => Math.round((value / ref) * 100);
  return {
    calories: pct(perServing.calories, ALG_UMUM.calories),
    protein: pct(perServing.protein, ALG_UMUM.protein),
    fat: pct(perServing.fat, ALG_UMUM.fat),
    saturatedFat: pct(perServing.saturatedFat, ALG_UMUM.saturatedFat),
    carbs: pct(perServing.carbs, ALG_UMUM.carbs),
    sugar: pct(perServing.sugar, ALG_UMUM.sugar),
    sodium: pct(perServing.sodium, ALG_UMUM.sodium),
  };
}

const WARNING_NUTRIENTS: { key: keyof AlgNutrients; label: string }[] = [
  { key: 'sodium', label: 'Natrium' },
  { key: 'sugar', label: 'Gula' },
  { key: 'saturatedFat', label: 'Lemak jenuh' },
];

export function buildWarnings(percentAlg: AlgNutrients): string[] {
  const warnings: string[] = [];
  for (const { key, label } of WARNING_NUTRIENTS) {
    const pct = percentAlg[key];
    if (pct > WARNING_THRESHOLD_PCT) {
      warnings.push(`${label} ${pct}% ALG dalam satu sajian`);
    }
  }
  return warnings;
}

/** Kalikan tiap field numerik dengan servingsPerPack. null kalau count tidak valid — pemanggil tahu tidak usah menampilkan kolom "per kemasan". */
export function scaleServing<T extends Record<string, number>>(
  perServing: T,
  servingsPerPack?: number
): T | null {
  if (!servingsPerPack || servingsPerPack <= 0) return null;
  const scaled = {} as T;
  for (const k of Object.keys(perServing) as (keyof T)[]) {
    scaled[k] = (Math.round(perServing[k] * servingsPerPack * 10) / 10) as T[keyof T];
  }
  return scaled;
}
