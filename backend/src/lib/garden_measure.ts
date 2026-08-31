/**
 * Ukuran tanaman yang diukur sendiri, dan laju tumbuh yang diturunkan darinya.
 *
 * Sampai sekarang satu-satunya penilaian pertumbuhan adalah membandingkan foto
 * lewat AI. Itu menjawab "kelihatan lebih besar?", bukan "berapa". Bedanya
 * terasa justru pada kasus yang paling penting: tanaman yang BERHENTI tumbuh.
 * Dua foto berjarak dua pekan dari tanaman yang mandek terlihat mirip dengan
 * dua foto tanaman yang tumbuh pelan — angka membedakan keduanya seketika.
 */

/** Di atas ini bukan tanaman pekarangan, itu salah ketik satuan. */
export const MAX_HEIGHT_CM = 500;
export const MAX_LEAF = 2000;

/** Pertambahan tinggi nol atau minus baru disebut mandek sesudah rentang ini. */
const HARI_MANDEK = 14;

export interface Ukuran {
  measuredDate: string;
  heightCm: number | null;
  leafCount: number | null;
}

export interface LajuTumbuh {
  /** null bila belum ada dua pengukuran bertinggi pada tanggal berbeda. */
  cmPerPekan: number | null;
  /** Rentang antar pengukuran terjauh, dibulatkan ke pekan. */
  pekan: number;
  mandek: boolean;
}

/**
 * Angka pengukuran yang sah, atau null.
 *
 * Nol ditolak: dalam formulir, 0 hampir selalu berarti bidang yang tidak diisi,
 * bukan tanaman setinggi nol sentimeter. Menyimpannya akan menarik kurva
 * pertumbuhan ke bawah pada titik yang sebenarnya tidak diukur.
 */
export function bersihkanUkuran(nilai: unknown, maks: number): number | null {
  const n = typeof nilai === 'string' ? Number(nilai) : nilai;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n <= 0 || n > maks) return null;
  return n;
}

function selisihHari(dari: string, ke: string): number {
  const a = Date.parse(`${dari}T00:00:00Z`);
  const b = Date.parse(`${ke}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Laju tumbuh dari pengukuran pertama ke terakhir yang punya tinggi.
 *
 * Dipakai titik terjauh, bukan rata-rata semua selisih: pengukuran rumahan
 * tidak presisi — pita ukur bergeser sesentimeter tiap kali — dan merata-rata
 * selisih pendek justru memperbesar deraunya. Rentang panjang meredamnya.
 */
export function lajuTumbuh(riwayat: Ukuran[]): LajuTumbuh {
  const bertinggi = riwayat
    .filter((u) => typeof u.heightCm === 'number' && Number.isFinite(u.heightCm))
    .sort((a, b) => a.measuredDate.localeCompare(b.measuredDate));

  if (bertinggi.length < 2) return { cmPerPekan: null, pekan: 0, mandek: false };

  const awal = bertinggi[0];
  const akhir = bertinggi[bertinggi.length - 1];
  const hari = selisihHari(awal.measuredDate, akhir.measuredDate);

  // Dua pengukuran di hari yang sama bukan rentang; membaginya akan
  // menghasilkan Infinity yang lolos diam-diam ke layar.
  if (hari <= 0) return { cmPerPekan: null, pekan: 0, mandek: false };

  const tumbuh = (akhir.heightCm as number) - (awal.heightCm as number);

  return {
    cmPerPekan: Math.round(((tumbuh / hari) * 7) * 10) / 10,
    pekan: Math.round(hari / 7),
    // Mandek hanya dinyatakan kalau rentangnya cukup panjang untuk berarti.
    // Tanaman memang tidak tumbuh terukur dalam tiga hari, dan menyebutnya
    // mandek akan membuat peringatan ini diabaikan dalam sepekan.
    mandek: hari >= HARI_MANDEK && tumbuh <= 0,
  };
}
