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
  /**
   * Kalimat siap tampil. Dirakit di sini, bukan di layar, mengikuti pola
   * peringatan rotasi tanam: satu tempat yang menentukan kata-katanya, dan
   * layar tidak bisa lupa merender bagian yang menjelaskan kenapa.
   */
  message: string;
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

/**
 * Saring riwayat lokasi jadi daftar yang benar-benar perlu peringatan.
 *
 * Satu peringatan per lokasi, bukan per pasangan tanaman: tiga tanaman yang
 * berakhir di bedengan yang sama menghasilkan satu pekerjaan membersihkan,
 * bukan tiga. Yang dipertahankan adalah pasangan dengan tanggal berakhir
 * paling baru — itu yang menentukan apakah pembersihan terakhir sudah cukup.
 */
export function cariPerluSanitasi(
  riwayat: ReadonlyArray<RiwayatLokasi>,
  lastCleanedByLokasi: ReadonlyMap<string, string>
): PeringatanSanitasi[] {
  const perLokasi = new Map<string, RiwayatLokasi>();
  for (const r of riwayat) {
    if (!perluSanitasi(r.prevEndDate, r.newStartDate, lastCleanedByLokasi.get(r.lokasiId) ?? null)) continue;
    const ada = perLokasi.get(r.lokasiId);
    if (!ada || r.prevEndDate > ada.prevEndDate) perLokasi.set(r.lokasiId, r);
  }

  return [...perLokasi.values()].map((r) => ({
    lokasiId: r.lokasiId,
    lokasiLabel: r.lokasiLabel,
    prevEndDate: r.prevEndDate,
    newStartDate: r.newStartDate,
    message:
      `${r.lokasiLabel}: tanaman sebelumnya berakhir ${r.prevEndDate} dan tanaman baru mulai ` +
      `${r.newStartDate}, tanpa catatan pembersihan di antaranya. Cuci pot atau bedengannya ` +
      `dulu supaya penyakit tanah tidak menular ke tanaman baru.`,
  }));
}
