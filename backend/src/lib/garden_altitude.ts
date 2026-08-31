/**
 * Cocokkan ketinggian kebun dengan ketinggian yang diminta tanaman.
 *
 * Katalog menyimpan `altitude` sebagai teks bebas, tapi kosakatanya hanya tiga
 * kata — rendah, menengah, tinggi — dengan satu penghubung 'sampai'. Cukup
 * dicocokkan kata kunci, sama seperti garden_season.ts membaca kolom `season`;
 * tidak perlu AI untuk membaca sesuatu yang sudah tertulis jelas.
 *
 * Pembagiannya mengikuti yang lazim dipakai penyuluh pertanian dan sudah
 * ditulis di kepala data/plants.ts, jadi angkanya tidak boleh berbeda:
 *   rendah   = 0–400 mdpl
 *   menengah = 400–700 mdpl
 *   tinggi   = di atas 700 mdpl
 *
 * Gunanya: menandai tanaman yang tidak akan pernah berhasil di ketinggian ini
 * SEBELUM ditanam. Kentang di pesisir dan kangkung di 1.500 mdpl sama-sama
 * gagal pelan-pelan tanpa gejala yang jelas, dan penyebabnya hampir tidak
 * pernah ditebak dengan benar.
 */

export type Band = 'rendah' | 'menengah' | 'tinggi';

/**
 * Batas atas 'tinggi' dipatok 2000, bukan tak hingga: di atas itu tidak ada
 * pekarangan rumah di Indonesia, dan angka berhingga membuat perbandingan
 * rentang tidak perlu menangani Infinity di setiap pemanggil.
 */
export const BAND_MDPL: Record<Band, [number, number]> = {
  rendah: [0, 400],
  menengah: [400, 700],
  tinggi: [700, 2000],
};

const URUT: Band[] = ['rendah', 'menengah', 'tinggi'];

/** Rentang mdpl yang diminta sebuah tanaman, dari teks bebas di katalog. */
export function parseAltitude(text: string): [number, number] {
  const lower = (text ?? '').toLowerCase();
  const ada = URUT.filter((b) => lower.includes(b));

  // Tidak ada kata kunci yang dikenal: perlakukan sebagai cocok di mana saja.
  // Menandai tanaman "tidak cocok" karena teksnya tidak terbaca adalah
  // peringatan palsu, dan peringatan palsu membuat semua peringatan diabaikan.
  if (ada.length === 0) return [BAND_MDPL.rendah[0], BAND_MDPL.tinggi[1]];

  return [BAND_MDPL[ada[0]][0], BAND_MDPL[ada[ada.length - 1]][1]];
}

/** Apakah kebun di ketinggian `mdpl` cocok untuk tanaman ini. */
export function cocokKetinggian(
  text: string,
  mdpl: number
): 'cocok' | 'terlalu-rendah' | 'terlalu-tinggi' {
  const [min, max] = parseAltitude(text);
  if (mdpl < min) return 'terlalu-rendah';
  if (mdpl > max) return 'terlalu-tinggi';
  return 'cocok';
}
