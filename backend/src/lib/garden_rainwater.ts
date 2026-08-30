/**
 * Tampungan air hujan: liter yang masuk vs liter yang dipakai menyiram.
 *
 * Sisi suplai, bukan sisi kebutuhan — itu sudah dijawab evapotranspirasi di
 * garden_weather.ts. Yang dijawab di sini: dari air yang tertampung, berapa
 * yang benar-benar dipakai, dan berapa hemat air ledeng yang berarti.
 *
 * Tarif Rp per liter TIDAK ditebak — diisi pengguna sendiri, karena berbeda
 * tiap daerah dan tidak ada API gratis untuk itu. Tanpa tarif, hasilnya
 * tetap liter (angka yang pasti), bukan rupiah (angka yang akan dikarang).
 */

export interface CatatanAirHujan {
  litersCollected: number;
  litersUsed: number;
}

export interface RingkasanAirHujan {
  totalTertampung: number;
  totalTerpakai: number;
  /** Liter yang tertampung tapi belum terpakai — masih ada di tampungan. */
  sisaTampungan: number;
  /** null kalau tarif belum diisi (0 atau tidak ada). */
  hematRupiah: number | null;
}

export function ringkasAirHujan(
  log: ReadonlyArray<CatatanAirHujan>,
  tarifRpPerLiter: number
): RingkasanAirHujan {
  const totalTertampung = log.reduce((sum, l) => sum + Math.max(0, l.litersCollected), 0);
  const totalTerpakai = log.reduce((sum, l) => sum + Math.max(0, l.litersUsed), 0);

  return {
    totalTertampung: Math.round(totalTertampung * 10) / 10,
    totalTerpakai: Math.round(totalTerpakai * 10) / 10,
    sisaTampungan: Math.max(0, Math.round((totalTertampung - totalTerpakai) * 10) / 10),
    hematRupiah: tarifRpPerLiter > 0 ? Math.round(totalTerpakai * tarifRpPerLiter) : null,
  };
}
