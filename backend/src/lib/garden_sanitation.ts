/**
 * Pengingat sterilisasi pot/alat antar tanam.
 *
 * Penyakit tanah dan hama menular menumpang di pot atau bedengan yang sama
 * kalau tidak dibersihkan antar siklus tanam. Ini bukan pelacakan hama
 * reaktif seperti garden_pest_risk.ts — ini pencegahan yang harus dijawab
 * SEBELUM menanam ulang di tempat yang sama, bukan sesudah gejalanya
 * muncul.
 *
 * Definisinya sengaja hanya soal urutan waktu, bukan soal jenis penyakit
 * apa yang mungkin menular — aplikasi ini tidak punya cara memastikan itu:
 * tanaman sebelumnya di lokasi ini berakhir (gagal/selesai) pada tanggal X;
 * kalau tidak ada catatan pembersihan SETELAH tanggal X dan SEBELUM tanaman
 * baru mulai, lokasi itu ditandai perlu dibersihkan dulu.
 */

export interface RiwayatLokasi {
  /** bed_id atau location (teks bebas) — kunci yang menyamakan "tempat yang sama". */
  lokasiId: string;
  lokasiLabel: string;
  /** Tanggal tanaman sebelumnya berakhir (gagal/selesai) di lokasi ini. */
  prevEndDate: string;
  /** Tanggal tanaman baru mulai di lokasi yang sama. */
  newStartDate: string;
}

export interface PeringatanSanitasi {
  lokasiId: string;
  lokasiLabel: string;
  prevEndDate: string;
  newStartDate: string;
}

/**
 * Benar kalau tidak ada pembersihan tercatat di antara akhir tanaman lama
 * dan mulai tanaman baru.
 */
export function perluSanitasi(
  prevEndDate: string,
  newStartDate: string,
  lastCleanedDate: string | null
): boolean {
  if (lastCleanedDate === null) return true;
  return !(lastCleanedDate >= prevEndDate && lastCleanedDate <= newStartDate);
}

/** Saring riwayat lokasi jadi daftar yang benar-benar perlu peringatan. */
export function cariPerluSanitasi(
  riwayat: ReadonlyArray<RiwayatLokasi>,
  lastCleanedByLokasi: ReadonlyMap<string, string>
): PeringatanSanitasi[] {
  return riwayat
    .filter((r) => perluSanitasi(r.prevEndDate, r.newStartDate, lastCleanedByLokasi.get(r.lokasiId) ?? null))
    .map((r) => ({
      lokasiId: r.lokasiId,
      lokasiLabel: r.lokasiLabel,
      prevEndDate: r.prevEndDate,
      newStartDate: r.newStartDate,
    }));
}
