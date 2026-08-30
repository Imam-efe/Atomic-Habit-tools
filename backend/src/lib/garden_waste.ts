/**
 * Panen vs terbuang: dari hasil kebun yang masuk Inventaris, berapa yang
 * benar-benar terpakai dan berapa yang kedaluwarsa begitu saja.
 *
 * Definisi "terbuang" di sini sengaja sempit dan bisa dipertanggungjawabkan
 * dari data yang sudah ada — bukan tebakan. Inventaris tidak mencatat
 * peristiwa "dipakai", hanya jumlah yang tersisa. Jadi:
 *
 *   terpakai   — jumlahnya sudah nol (satu-satunya cara jumlah berkurang
 *                adalah lewat aksi pemakaian di aplikasi ini).
 *   terbuang   — tanggal kedaluwarsa sudah lewat DAN jumlahnya masih ada.
 *   masih stok — belum kedaluwarsa dan belum habis; belum tentu apa-apa.
 *
 * Item tanpa tanggal kedaluwarsa tidak pernah dihitung "terbuang" — tanpa
 * tanggal, aplikasi tidak punya dasar untuk mengklaim itu sudah basi.
 */

export type StatusPanen = 'terpakai' | 'terbuang' | 'masih-stok';

export interface ItemPanen {
  quantity: number;
  expiryDate: string | null;
}

export interface LaporanTerbuang {
  totalItem: number;
  terpakai: number;
  terbuang: number;
  masihStok: number;
  /** Persen dari total yang berakhir terbuang; null kalau belum ada data. */
  wastePercent: number | null;
}

export function statusPanen(item: ItemPanen, today: string): StatusPanen {
  if (item.quantity <= 0) return 'terpakai';
  if (item.expiryDate !== null && item.expiryDate < today) return 'terbuang';
  return 'masih-stok';
}

export function laporanTerbuang(items: ReadonlyArray<ItemPanen>, today: string): LaporanTerbuang {
  let terpakai = 0;
  let terbuang = 0;
  let masihStok = 0;

  for (const item of items) {
    const status = statusPanen(item, today);
    if (status === 'terpakai') terpakai++;
    else if (status === 'terbuang') terbuang++;
    else masihStok++;
  }

  const total = items.length;
  return {
    totalItem: total,
    terpakai,
    terbuang,
    masihStok,
    wastePercent: total > 0 ? Math.round((terbuang / total) * 100) : null,
  };
}
