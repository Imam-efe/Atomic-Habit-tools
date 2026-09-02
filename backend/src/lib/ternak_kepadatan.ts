/**
 * Kepadatan kandang.
 *
 * Kelebihan penghuni tidak pernah muncul sebagai tugas yang telat — ia tidak
 * punya jadwal. Yang terjadi hanya ikan yang mati satu per satu selama
 * berbulan-bulan tanpa sebab yang kelihatan, karena amonia naik lebih cepat
 * daripada filternya sanggup mengurai.
 */

export interface Penghuni {
  animalId: string | null;
  jumlah: number;
  /** Kebutuhan ruang per ekor, liter; null bila katalog tidak menyebut angka. */
  literPerEkor: number | null;
}

export interface Kepadatan {
  butuhLiter: number;
  tersedia: number;
  /** Selisih kekurangan; 0 bila cukup. */
  kelebihan: number;
  sesak: boolean;
}

export function cekKepadatan(
  volumeLiter: number | null,
  penghuni: Penghuni[]
): Kepadatan | null {
  // Kandang tanpa volume tidak bisa dinilai. Menebak angkanya akan
  // menghasilkan peringatan yang salah ke dua arah sekaligus.
  if (volumeLiter == null || volumeLiter <= 0) return null;

  // Penghuni tanpa angka kebutuhan dilewati, bukan dihitung nol: nol akan
  // membuat kandang penuh terlihat lapang.
  const butuhLiter = penghuni.reduce(
    (n, p) => n + (p.literPerEkor == null ? 0 : p.literPerEkor * p.jumlah),
    0
  );

  return {
    butuhLiter,
    tersedia: volumeLiter,
    kelebihan: Math.max(0, butuhLiter - volumeLiter),
    sesak: butuhLiter > volumeLiter,
  };
}
