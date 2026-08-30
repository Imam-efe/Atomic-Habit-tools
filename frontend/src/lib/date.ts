/**
 * Tanggal hari ini menurut WIB.
 *
 * `new Date().toISOString().slice(0, 10)` memberi tanggal UTC, bukan tanggal
 * yang sedang dilihat pengguna. Antara tengah malam dan pukul tujuh pagi WIB
 * keduanya berbeda satu hari, dan selisih itu tidak pernah terlihat sebagai
 * error: catatan belanja jam 1 pagi tersimpan bertanggal kemarin, ringkasan
 * "Pagi Ini" memuat agenda kemarin, tugas hari ini tampak sudah lewat.
 *
 * Yang dipakai WIB tetap, bukan waktu perangkat, karena backend menyimpan
 * tanggal dengan `jakartaToday()`. Kalau frontend memakai zona ponsel, dua
 * sisi akan berselisih begitu penggunanya bepergian ke luar negeri — dan
 * catatan yang dikirim akan jatuh di hari yang tidak dia maksud.
 */

const WIB_OFFSET_MS = 7 * 3600000;

/** YYYY-MM-DD hari ini menurut WIB. */
export function todayISO(): string {
  return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * YYYY-MM bulan berjalan menurut WIB.
 *
 * Salahnya lebih jarang daripada tanggal harian tapi lebih membingungkan:
 * hanya pada tanggal 1 sebelum pukul tujuh pagi, dan yang terlihat bukan
 * selisih satu hari melainkan seluruh layar menampilkan bulan yang sudah
 * lewat — termasuk saat separuh layar memakai tanggal WIB dan separuhnya UTC.
 */
export function thisMonthISO(): string {
  return todayISO().slice(0, 7);
}

/** YYYY-MM-DD `n` hari lalu menurut WIB. */
export function daysAgoISO(n: number): string {
  return new Date(Date.now() + WIB_OFFSET_MS - n * 86400000).toISOString().slice(0, 10);
}

/**
 * YYYY-MM-DD dari sebuah Date yang komponennya sudah waktu lokal.
 *
 * Dipakai saat tanggalnya dihitung dengan `setDate()` dan sejenisnya:
 * `toISOString()` akan menggeser hasilnya ke UTC dan membuat seluruh deretan
 * meleset satu hari.
 */
export function toISO(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/**
 * Geser YYYY-MM-DD sebanyak `n` hari.
 *
 * Seluruhnya dihitung di UTC: dibangun di UTC, digeser dengan setter UTC,
 * dibaca kembali sebagai UTC. Mencampur konstruksi UTC dengan `setDate()`
 * waktu lokal meleset sehari begitu pergeserannya melewati batas DST — dan
 * karena tanggal di sini hanya penanda hari, bukan momen, tidak ada alasan
 * untuk melibatkan zona waktu perangkat sama sekali.
 */
export function shiftDate(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Nama hari Indonesia untuk YYYY-MM-DD. Sama dengan `dayName` di backend. */
export function dayName(date: string): string {
  return NAMA_HARI[new Date(`${date}T00:00:00Z`).getUTCDay()];
}
