/**
 * foods_id.ts — katalog makanan Indonesia yang paling sering dicatat.
 *
 * Bundled, sama seperti data/plants.ts: data referensi yang ditinjau seperti
 * kode, tidak perlu di-seed ulang tiap deploy. Ini tier pertama resolver gizi
 * (lihat food_search.ts) — dicoba sebelum cache, Open Food Facts, dan AI.
 *
 * Angka adalah estimasi praktis per porsi rumah tangga lazim (bukan porsi
 * laboratorium), disusun dari pengetahuan gizi umum saat penulisan file ini.
 * BUKAN hasil pengambilan langsung dari basis data TKPI Kemenkes — jaringan
 * sesi penulisan memblokir situs tersebut. Cross-check terhadap TKPI kalau
 * dipakai untuk keputusan kesehatan presisi tinggi; untuk pelacakan kasar
 * harian, akurasinya cukup.
 */

export interface CuratedFood {
  /** Slug stabil — dipakai sebagai lookup_key di food_facts_cache kalau perlu. */
  id: string;
  name: string;
  /** Nama dagang/sebutan lain yang dicocokkan pencarian. */
  aliases: string[];
  servingLabel: string;
  calories: number;
  protein: number;   // gram
  carbs: number;      // gram
  fat: number;         // gram
  fiber: number;       // gram
  sodium: number;      // mg
  sugar: number;       // gram
}

export const CURATED_FOODS: CuratedFood[] = [
  // ────────────────────────────── POKOK ──────────────────────────────
  { id: 'nasi-putih', name: 'Nasi Putih', aliases: ['nasi', 'sebakul nasi'], servingLabel: '1 centong (100 g)', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sodium: 1, sugar: 0.1 },
  { id: 'nasi-goreng', name: 'Nasi Goreng', aliases: ['nasgor'], servingLabel: '1 piring (250 g)', calories: 350, protein: 8, carbs: 45, fat: 14, fiber: 2, sodium: 600, sugar: 3 },
  { id: 'lontong', name: 'Lontong', aliases: [], servingLabel: '1 potong (100 g)', calories: 130, protein: 2.5, carbs: 28, fat: 0.2, fiber: 0.5, sodium: 2, sugar: 0 },
  { id: 'ketupat', name: 'Ketupat', aliases: [], servingLabel: '1 buah (100 g)', calories: 130, protein: 2.5, carbs: 28, fat: 0.2, fiber: 0.5, sodium: 2, sugar: 0 },
  { id: 'bubur-ayam', name: 'Bubur Ayam', aliases: [], servingLabel: '1 mangkuk (300 g)', calories: 250, protein: 12, carbs: 35, fat: 6, fiber: 1, sodium: 700, sugar: 1 },
  { id: 'mie-goreng-instan', name: 'Mie Goreng Instan', aliases: ['indomie', 'indomie goreng', 'mie instan goreng'], servingLabel: '1 bungkus (85 g)', calories: 380, protein: 8, carbs: 52, fat: 15, fiber: 2, sodium: 900, sugar: 5 },
  { id: 'mie-kuah-instan', name: 'Mie Kuah Instan', aliases: ['indomie kuah', 'mie rebus instan'], servingLabel: '1 bungkus (75 g)', calories: 320, protein: 7, carbs: 45, fat: 12, fiber: 2, sodium: 1200, sugar: 3 },
  { id: 'roti-tawar', name: 'Roti Tawar', aliases: ['roti'], servingLabel: '2 lembar (60 g)', calories: 160, protein: 5, carbs: 30, fat: 2, fiber: 1.5, sodium: 250, sugar: 3 },

  // ────────────────────────────── LAUK ──────────────────────────────
  { id: 'telur-rebus', name: 'Telur Rebus', aliases: [], servingLabel: '1 butir (55 g)', calories: 78, protein: 6.3, carbs: 0.6, fat: 5.3, fiber: 0, sodium: 62, sugar: 0.6 },
  { id: 'telur-goreng', name: 'Telur Ceplok', aliases: ['telur goreng', 'telur mata sapi'], servingLabel: '1 butir (60 g)', calories: 120, protein: 6.5, carbs: 0.5, fat: 10, fiber: 0, sodium: 95, sugar: 0.4 },
  { id: 'telur-dadar', name: 'Telur Dadar', aliases: [], servingLabel: '1 butir (65 g)', calories: 130, protein: 7, carbs: 1, fat: 11, fiber: 0, sodium: 120, sugar: 0.5 },
  { id: 'ayam-goreng', name: 'Ayam Goreng', aliases: ['ayam goreng paha', 'fried chicken'], servingLabel: '1 potong paha (100 g)', calories: 260, protein: 22, carbs: 6, fat: 16, fiber: 0.3, sodium: 380, sugar: 0.5 },
  { id: 'ayam-bakar', name: 'Ayam Bakar', aliases: [], servingLabel: '1 potong (100 g)', calories: 200, protein: 24, carbs: 4, fat: 9, fiber: 0.2, sodium: 420, sugar: 3 },
  { id: 'rendang', name: 'Rendang Daging', aliases: ['rendang sapi'], servingLabel: '1 porsi (100 g)', calories: 280, protein: 18, carbs: 6, fat: 21, fiber: 1, sodium: 450, sugar: 2 },
  { id: 'sate-ayam', name: 'Sate Ayam', aliases: ['sate'], servingLabel: '10 tusuk + bumbu kacang (200 g)', calories: 380, protein: 28, carbs: 15, fat: 24, fiber: 2, sodium: 650, sugar: 8 },
  { id: 'tempe-goreng', name: 'Tempe Goreng', aliases: ['tempe'], servingLabel: '2 potong (50 g)', calories: 130, protein: 9, carbs: 8, fat: 8, fiber: 3, sodium: 5, sugar: 0.5 },
  { id: 'tahu-goreng', name: 'Tahu Goreng', aliases: ['tahu'], servingLabel: '2 potong (60 g)', calories: 110, protein: 8, carbs: 4, fat: 7, fiber: 1, sodium: 8, sugar: 0.5 },
  { id: 'ikan-goreng', name: 'Ikan Goreng', aliases: [], servingLabel: '1 ekor sedang (100 g)', calories: 190, protein: 22, carbs: 2, fat: 10, fiber: 0, sodium: 200, sugar: 0 },
  { id: 'bakso', name: 'Bakso', aliases: ['bakso sapi'], servingLabel: '1 mangkuk, 5 butir + kuah (300 g)', calories: 260, protein: 16, carbs: 25, fat: 10, fiber: 2, sodium: 900, sugar: 3 },
  { id: 'soto-ayam', name: 'Soto Ayam', aliases: ['soto'], servingLabel: '1 mangkuk (350 g)', calories: 220, protein: 18, carbs: 14, fat: 10, fiber: 2, sodium: 850, sugar: 2 },

  // ────────────────────────────── SAYUR & PELENGKAP ──────────────────────────────
  { id: 'gado-gado', name: 'Gado-Gado', aliases: [], servingLabel: '1 piring (300 g)', calories: 300, protein: 12, carbs: 28, fat: 16, fiber: 6, sodium: 550, sugar: 8 },
  { id: 'capcay', name: 'Cap Cay', aliases: ['capcai'], servingLabel: '1 piring (200 g)', calories: 130, protein: 6, carbs: 12, fat: 6, fiber: 4, sodium: 400, sugar: 3 },
  { id: 'sayur-asem', name: 'Sayur Asem', aliases: [], servingLabel: '1 mangkuk (250 g)', calories: 90, protein: 3, carbs: 15, fat: 2, fiber: 4, sodium: 300, sugar: 4 },
  { id: 'tumis-kangkung', name: 'Tumis Kangkung', aliases: [], servingLabel: '1 porsi (150 g)', calories: 90, protein: 3, carbs: 8, fat: 5, fiber: 3, sodium: 250, sugar: 1 },
  { id: 'sambal', name: 'Sambal', aliases: [], servingLabel: '2 sdm (30 g)', calories: 25, protein: 0.5, carbs: 4, fat: 1, fiber: 1, sodium: 200, sugar: 2 },
  { id: 'kerupuk', name: 'Kerupuk', aliases: [], servingLabel: '3 keping (15 g)', calories: 75, protein: 0.5, carbs: 9, fat: 4, fiber: 0.2, sodium: 150, sugar: 0.5 },

  // ────────────────────────────── BUAH & CAMILAN ──────────────────────────────
  { id: 'pisang', name: 'Pisang', aliases: [], servingLabel: '1 buah sedang (100 g)', calories: 90, protein: 1.1, carbs: 23, fat: 0.3, fiber: 2.6, sodium: 1, sugar: 12 },
  { id: 'pepaya', name: 'Pepaya', aliases: [], servingLabel: '1 potong (150 g)', calories: 65, protein: 1, carbs: 17, fat: 0.2, fiber: 3, sodium: 5, sugar: 12 },
  { id: 'semangka', name: 'Semangka', aliases: [], servingLabel: '1 potong (150 g)', calories: 45, protein: 0.9, carbs: 11, fat: 0.2, fiber: 0.6, sodium: 1, sugar: 9 },
  { id: 'gorengan', name: 'Gorengan', aliases: ['bakwan', 'tahu isi'], servingLabel: '1 buah (40 g)', calories: 110, protein: 2, carbs: 12, fat: 6, fiber: 1, sodium: 150, sugar: 1 },
  { id: 'keripik-singkong', name: 'Keripik Singkong', aliases: ['keripik'], servingLabel: '1 genggam (30 g)', calories: 150, protein: 1, carbs: 18, fat: 8, fiber: 1, sodium: 120, sugar: 1 },

  // ────────────────────────────── MINUMAN ──────────────────────────────
  { id: 'teh-manis', name: 'Teh Manis', aliases: [], servingLabel: '1 gelas (250 ml)', calories: 90, protein: 0, carbs: 22, fat: 0, fiber: 0, sodium: 5, sugar: 20 },
  { id: 'kopi-hitam', name: 'Kopi Hitam', aliases: ['kopi tanpa gula'], servingLabel: '1 cangkir (200 ml)', calories: 5, protein: 0.3, carbs: 0, fat: 0, fiber: 0, sodium: 5, sugar: 0 },
  { id: 'es-teh', name: 'Es Teh Manis', aliases: [], servingLabel: '1 gelas (350 ml)', calories: 120, protein: 0, carbs: 30, fat: 0, fiber: 0, sodium: 5, sugar: 28 },
  { id: 'jus-alpukat', name: 'Jus Alpukat', aliases: [], servingLabel: '1 gelas + susu kental manis (300 ml)', calories: 320, protein: 5, carbs: 35, fat: 18, fiber: 5, sodium: 40, sugar: 28 },
  { id: 'air-putih', name: 'Air Putih', aliases: [], servingLabel: '1 gelas (250 ml)', calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, sugar: 0 },
];

/** Cocokkan nama/alias, case-insensitive, includes() — cukup untuk ~36 entri, fuzzy matching berlebihan (YAGNI). */
export function searchCuratedFoods(query: string, foods: CuratedFood[] = CURATED_FOODS): CuratedFood[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return foods.filter(f =>
    f.name.toLowerCase().includes(q) || f.aliases.some(a => a.toLowerCase().includes(q))
  );
}
