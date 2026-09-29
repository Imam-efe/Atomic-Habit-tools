/**
 * Periode pelaporan keuangan yang bisa diatur, bukan selalu bulan kalender.
 *
 * Banyak orang di Indonesia hidup pada siklus gajian, bukan siklus kalender.
 * Kalau gajian tanggal 25, "bulan ini" yang berarti bagi mereka adalah 25
 * September sampai 24 Oktober — dan laporan yang memaksa 1 sampai 31 memotong
 * satu siklus jadi dua, lalu menampilkan separuh belanja di dua bulan berbeda.
 *
 * Berkas ini satu-satunya tempat yang menentukan batas periode. Alasannya
 * bukan kerapian: ada delapan tempat di backend yang menghitung "bulan ini"
 * sendiri-sendiri, dan satu saja yang tidak ikut akan menampilkan angka yang
 * BERBEDA untuk hal yang sama di layar yang berbeda — tanpa galat apa pun,
 * cuma dua angka yang sama-sama terlihat masuk akal.
 *
 * LABELNYA ADALAH BULAN TEMPAT PERIODE BERAKHIR. Jadi 25 Sep–24 Okt disebut
 * "2026-10", sesuai cara orang menyebutnya ("gajian Oktober"). Ini juga yang
 * membuat `hariMulai = 1` runtuh tepat jadi perilaku lama: 1–30 September
 * berakhir di September, labelnya "2026-09", sama persis dengan sebelumnya.
 * Itu penting — `budget_limits.month` yang sudah ada di produksi tetap
 * menunjuk periode yang sama tanpa migrasi data apa pun.
 */

import { shiftDate } from './daily';
// `bulanKe` sudah ada dan sudah diuji di sana (maju sebulan, menjepit akhir
// bulan). Dipakai ulang alih-alih menulis aritmetika bulan kedua kalinya —
// dua salinan aritmetika tanggal adalah cara paling pasti melahirkan selisih
// sehari yang cuma muncul di sebagian bulan.
import { bulanKe } from './finance_tagihan';

export interface Periode {
  /** YYYY-MM-DD, inklusif. */
  mulai: string;
  /** YYYY-MM-DD, inklusif. */
  selesai: string;
  /** YYYY-MM, bulan tempat periode ini BERAKHIR. Kunci `budget_limits.month`. */
  label: string;
  /** Tanggal mulai yang dipakai, supaya pemanggil tidak perlu membawanya sendiri. */
  hariMulai: number;
}

/**
 * Batas atas 28, bukan 31, dan itu keputusan yang disengaja.
 *
 * Tanggal mulai 29-31 tidak ada di semua bulan, jadi batas periodenya jadi
 * ambigu: periode yang mulai "tanggal 31" harus dijepit di Februari, dan
 * periode sebelumnya berakhir di tanggal yang berpindah-pindah. Menjepitnya
 * bisa dilakukan, tapi hasilnya adalah periode yang panjangnya berubah tanpa
 * pengguna bisa memperkirakan. 28 menghapus seluruh persoalan itu.
 */
export const HARI_MULAI_MIN = 1;
export const HARI_MULAI_MAX = 28;

const duaAngka = (n: number) => String(n).padStart(2, '0');

/** Menjepit nilai dari pengaturan ke rentang yang sah. */
export function bersihkanHariMulai(nilai: unknown): number {
  const n = Math.round(Number(nilai));
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(n, HARI_MULAI_MIN), HARI_MULAI_MAX);
}

/** Periode yang memuat `tanggal`. */
export function periodeUntuk(tanggal: string, hariMulai: number): Periode {
  const hari = bersihkanHariMulai(hariMulai);
  const [y, m, d] = tanggal.split('-').map(Number);

  // Kalau tanggalnya sudah melewati hari mulai, periodenya dimulai bulan ini;
  // kalau belum, ia masih di dalam periode yang dimulai bulan lalu.
  const bulanAwal = d >= hari
    ? `${y}-${duaAngka(m)}`
    : bulanKe(`${y}-${duaAngka(m)}-01`, -1, 1).slice(0, 7);

  const mulai = `${bulanAwal}-${duaAngka(hari)}`;
  // Sehari sebelum hari mulai bulan berikutnya. Untuk hari mulai 1, ini jatuh
  // tepat di hari terakhir bulan kalender.
  const selesai = shiftDate(bulanKe(mulai, 1, hari), -1);

  return { mulai, selesai, label: selesai.slice(0, 7), hariMulai: hari };
}

/**
 * Periode yang labelnya `label` (YYYY-MM).
 *
 * Dipakai saat layar mengirim `?month=2026-10`. Diturunkan dengan memilih satu
 * tanggal yang pasti ada di dalam periode itu lalu memakai `periodeUntuk`,
 * bukan dengan rumus terpisah — supaya keduanya tidak mungkin menyimpang.
 */
export function periodeDariLabel(label: string, hariMulai: number): Periode {
  const hari = bersihkanHariMulai(hariMulai);
  // Hari terakhir periode selalu ada di bulan labelnya: hari-1 untuk hari
  // mulai > 1, dan tanggal 1 untuk hari mulai 1.
  return periodeUntuk(`${label}-${duaAngka(Math.max(1, hari - 1))}`, hari);
}

/** Periode `langkah` periode sebelum (negatif) atau sesudah (positif). */
export function geserPeriode(periode: Periode, langkah: number): Periode {
  const mulaiBaru = bulanKe(periode.mulai, langkah, periode.hariMulai);
  return periodeUntuk(mulaiBaru, periode.hariMulai);
}

/**
 * Label periode yang sedang berjalan pada `hariIni`.
 *
 * Menggantikan `jakartaMonth()`, yang dihapus bersamaan dengan perubahan ini.
 * Ia dihapus, bukan dibiarkan: begitu tidak ada lagi yang memakainya, ia jadi
 * perangkap — siapa pun yang menambah fitur uang berikutnya akan
 * memanggilnya, mendapat bulan kalender, dan diam-diam melewati pengaturan
 * periode pengguna. Yang benar-benar butuh bulan kalender memanggil
 * `jakartaToday().slice(0, 7)` dan terlihat sedang melakukannya.
 */
export function labelPeriodeBerjalan(hariIni: string, hariMulai: number): string {
  return periodeUntuk(hariIni, hariMulai).label;
}

/**
 * Sisa hari dalam periode, termasuk hari ini.
 *
 * Dipakai "sisa aman per hari". Minimal 1: pembagian dengan nol pada hari
 * terakhir periode akan mengembalikan Infinity, yang tampil sebagai sisa
 * harian tak terbatas — salah yang paling meyakinkan bentuknya.
 */
export function sisaHariPeriode(hariIni: string, periode: Periode): number {
  const { selesai } = periode;
  const hari = Math.round(
    (new Date(`${selesai}T00:00:00Z`).getTime() - new Date(`${hariIni}T00:00:00Z`).getTime()) / 86400000
  ) + 1;
  return Math.max(hari, 1);
}
