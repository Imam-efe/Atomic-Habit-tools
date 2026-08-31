/**
 * Jadwal pangkas.
 *
 * `pangkas` sudah bisa dicatat sebagai aksi perawatan sejak awal, tapi tidak
 * pernah dijadwalkan — jadi ia hanya tercatat kalau pengguna kebetulan ingat.
 * Untuk tomat, cabai, dan pohon buah, pangkas adalah salah satu tindakan yang
 * paling menentukan hasil, dan justru yang paling mudah terlupa karena tidak
 * mendesak: tanaman yang tidak dipangkas tidak terlihat sakit, ia hanya
 * berbuah lebih sedikit beberapa bulan kemudian.
 *
 * Aturannya berasal dari kolom `pruning` di katalog, yang sengaja opsional —
 * lihat komentarnya di data/plants.ts.
 */

export interface AturanPangkas {
  /** Hari sejak tanam sebelum pangkas pertama masuk akal. */
  mulaiHari: number;
  /** Jarak antar pangkas sesudahnya, hari. */
  ulangHari: number;
  catatan: string;
}

export interface JadwalPangkas {
  berikutnya: string;
  /** Hari terlewat dari tanggal jatuh tempo; 0 bila belum jatuh tempo. */
  telat: number;
}

function geser(tanggal: string, hari: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

function selisihHari(dari: string, ke: string): number {
  const a = Date.parse(`${dari}T00:00:00Z`);
  const b = Date.parse(`${ke}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Kapan tanaman ini pantas dipangkas berikutnya, atau null bila memang tidak
 * dipangkas sama sekali.
 *
 * Sebelum pernah dipangkas, hitungannya dari tanggal tanam plus `mulaiHari` —
 * bukan `ulangHari`. Tanaman muda yang dipangkas terlalu dini kehilangan daun
 * yang justru dibutuhkannya untuk tumbuh.
 */
export function jadwalPangkas(
  aturan: AturanPangkas | undefined,
  plantedDate: string,
  lastPangkas: string | null,
  hariIni: string
): JadwalPangkas | null {
  if (!aturan) return null;

  const berikutnya = lastPangkas
    ? geser(lastPangkas, aturan.ulangHari)
    : geser(plantedDate, aturan.mulaiHari);

  return {
    berikutnya,
    // Tepat pada hari jatuh tempo belum telat — hari itu masih miliknya.
    telat: Math.max(0, selisihHari(berikutnya, hariIni)),
  };
}
