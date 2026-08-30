/**
 * Kompos rumahan: dari sisa dapur/kebun sampai siap dipakai.
 *
 * Estimasi siapnya dari metode, bukan dari mengukur suhu tumpukan
 * sungguhan — aplikasi ini tidak punya sensor itu. Tiga metode mewakili
 * rentang nyata pengomposan rumahan: kompos panas yang rajin dibalik selesai
 * dalam hitungan minggu, kompos dingin yang dibiarkan bisa berbulan-bulan.
 * Angka yang kasar tapi jujur lebih berguna daripada tanggal yang terlihat
 * presisi padahal dikarang.
 */

export type MetodeKompos = 'cepat' | 'sedang' | 'lambat';
export type StatusKompos = 'proses' | 'siap' | 'terpakai';

/** Perkiraan lama pengomposan per metode, dalam hari. */
export const HARI_KOMPOS: Record<MetodeKompos, number> = {
  cepat: 21,
  sedang: 45,
  lambat: 90,
};

export const LABEL_METODE: Record<MetodeKompos, string> = {
  cepat: 'Cepat (panas, rajin dibalik) — ±3 minggu',
  sedang: 'Sedang — ±1,5 bulan',
  lambat: 'Lambat (dingin, dibiarkan) — ±3 bulan',
};

function geser(iso: string, hari: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + hari * 86400000).toISOString().slice(0, 10);
}

/** Tanggal perkiraan siap, dari tanggal mulai dan metode. */
export function estimasiSiap(startedDate: string, metode: MetodeKompos): string {
  return geser(startedDate, HARI_KOMPOS[metode] ?? HARI_KOMPOS.sedang);
}

export interface RingkasanBatch {
  status: StatusKompos;
  /** Positif berarti sudah lewat perkiraan siap; negatif berarti masih berapa hari lagi. */
  hariSejakEstimasi: number;
  siapDiterapkan: boolean;
}

/**
 * Ringkas status satu batch untuk ditampilkan.
 *
 * `status` dari basis data selalu menang atas tanggal — begitu pengguna
 * menandai "terpakai", batch itu terpakai selamanya, tidak peduli apakah
 * tanggal estimasinya baru lewat kemarin atau tahun lalu.
 */
export function ringkasBatch(readyDateEstimasi: string, today: string, status: StatusKompos): RingkasanBatch {
  const hariSejakEstimasi = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${readyDateEstimasi}T00:00:00Z`)) / 86400000
  );

  return {
    status,
    hariSejakEstimasi,
    siapDiterapkan: status === 'proses' && hariSejakEstimasi >= 0,
  };
}
