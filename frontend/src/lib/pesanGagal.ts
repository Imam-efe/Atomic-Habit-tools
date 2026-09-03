/**
 * Satu kalimat kegagalan yang menyebut sebab sebenarnya.
 *
 * Sebelumnya tiap layar menulis sendiri percabangan "jaringan atau bukan",
 * dan semuanya memakai `isNetworkError` versi lama yang menganggap SETIAP
 * TypeError sebagai offline. Akibatnya bug pemrograman biasa dan chunk yang
 * gagal dimuat sama-sama dilaporkan sebagai "tidak ada jaringan" — di
 * perangkat yang jelas tersambung. Pengguna diberi tahu untuk menunggu
 * jaringan yang tidak pernah bermasalah, dan penyebab aslinya tidak pernah
 * terlihat.
 *
 * Tiga sebab, tiga saran yang berbeda; itu inti berkas ini.
 */

import { isNetworkError, isStaleChunkError } from './offlineQueue';

/**
 * @param aksi Kalimat pembuka tanpa titik, mis. "Gagal membuat lembar kerja".
 */
export function pesanGagal(aksi: string, err: unknown): string {
  if (isStaleChunkError(err)) {
    // Memuat ulang benar-benar memperbaikinya: shell baru menunjuk nama chunk
    // yang memang ada. Menyuruh "coba lagi" tanpa memuat ulang justru
    // mengulang kegagalan yang sama persis.
    return `${aksi}: aplikasi baru diperbarui. Muat ulang halaman lalu coba lagi.`;
  }
  if (isNetworkError(err)) {
    return `${aksi}: tidak ada jaringan. Coba lagi setelah tersambung.`;
  }
  return `${aksi}. Coba lagi sebentar lagi.`;
}
