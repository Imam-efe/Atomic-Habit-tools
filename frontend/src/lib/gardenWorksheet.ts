/**
 * Lembar kerja kebun mingguan — jadwal yang sama, disusun untuk dicetak.
 *
 * Aplikasi ini sudah tahu apa yang harus dikerjakan minggu ini; yang belum
 * bisa dilakukannya adalah ikut ke kebun. Tangan yang basah dan berlumpur
 * tidak bisa membuka ponsel, dan justru di situlah daftarnya dibutuhkan.
 * Satu halaman A4 dengan kotak centang menyelesaikan itu tanpa perangkat apa
 * pun.
 *
 * Yang disusun di sini hanya BENTUKnya — pengelompokan per hari, urutan, dan
 * kotak centang. Menggambarnya jadi PDF terjadi di layar, memakai mesin yang
 * sama dengan cetak label.
 */

import { dayName, shiftDate } from './date';

export interface TugasKebun {
  plantingId: string;
  /** Nama tampil tanaman: panggilan kalau ada, kalau tidak nama katalognya. */
  label: string;
  location: string | null;
  /** siram | pupuk | panen — aksi perawatan dari jadwal. */
  action: string;
  dueDate: string;
  overdueDays: number;
}

export interface HariLembarKerja {
  date: string;
  /** Nama hari Indonesia, mis. "Senin". */
  dayName: string;
  tugas: TugasKebun[];
}

export interface LembarKerja {
  mulai: string;
  selesai: string;
  /** Tepat tujuh hari, termasuk yang kosong. */
  hari: HariLembarKerja[];
  /**
   * Tugas yang tanggalnya sudah lewat sebelum minggu ini dimulai.
   *
   * Dipisah ke bagiannya sendiri, bukan ditumpuk ke hari pertama: menaruhnya
   * di Senin membuatnya terlihat seperti pekerjaan Senin, padahal itu utang
   * dari minggu lalu yang layak diputuskan sendiri — dikerjakan, atau
   * direlakan.
   */
  terlewat: TugasKebun[];
  totalTugas: number;
}

const URUTAN_AKSI = ['siram', 'pupuk', 'panen'];

/** Urutan tetap supaya lembar cetak minggu ini dan minggu depan terbaca sama. */
function bandingkanTugas(a: TugasKebun, b: TugasKebun): number {
  const ai = URUTAN_AKSI.indexOf(a.action);
  const bi = URUTAN_AKSI.indexOf(b.action);
  const aRank = ai === -1 ? URUTAN_AKSI.length : ai;
  const bRank = bi === -1 ? URUTAN_AKSI.length : bi;
  if (aRank !== bRank) return aRank - bRank;
  return a.label.localeCompare(b.label, 'id');
}

/**
 * Susun tugas jadi tujuh hari berurutan mulai dari `mulai`.
 *
 * Hari kosong tetap ikut. Lembar tujuh baris yang salah satunya kosong
 * memberi tahu "Kamis memang tidak ada kerjaan"; lembar yang melompati Kamis
 * hanya menyisakan pertanyaan apakah datanya hilang.
 */
export function susunLembarKerja(
  tugas: ReadonlyArray<TugasKebun>,
  mulai: string
): LembarKerja {
  const selesai = shiftDate(mulai, 6);

  const hari: HariLembarKerja[] = [];
  for (let i = 0; i < 7; i++) {
    const date = shiftDate(mulai, i);
    hari.push({
      date,
      dayName: dayName(date),
      tugas: tugas.filter((t) => t.dueDate === date).sort(bandingkanTugas),
    });
  }

  const terlewat = tugas.filter((t) => t.dueDate < mulai).sort(bandingkanTugas);

  return {
    mulai,
    selesai,
    hari,
    terlewat,
    totalTugas: terlewat.length + hari.reduce((n, h) => n + h.tugas.length, 0),
  };
}
