/**
 * Antrean tulis offline.
 *
 * Perawatan kebun dicatat justru di tempat sinyal paling buruk — di kebun,
 * di belakang rumah, dengan ponsel di satu tangan dan selang di tangan lain.
 * Sebelum ini, satu ketukan yang gagal karena jaringan hilang begitu saja:
 * bukan hanya catatannya, tapi juga rentetan merawat, kalibrasi umur panen,
 * dan hitungan HPP yang semuanya berdiri di atas log itu.
 *
 * Yang diantre hanya tulisan yang aman dikirim ulang. Itu batas yang sengaja
 * ketat: mengulang catatan siram tidak berbahaya karena servernya menolak id
 * yang sama, sedangkan mengulang pembayaran atau penghapusan bisa merugikan
 * secara permanen. Jadi modul ini tidak menerima sembarang permintaan.
 *
 * Antrean selalu terikat pada satu akun. Aplikasi ini mendukung pindah akun
 * tanpa keluar, dan antrean bersama akan mengirim catatan milik akun A dengan
 * token akun B — ditolak 404, lalu catatannya hilang untuk selamanya.
 */

import { ApiError } from './api';

const STORAGE_PREFIX = 'fayolla:offline-queue';

/** Batas antrean, supaya penyimpanan tidak terus tumbuh saat lama offline. */
const MAX_ENTRIES = 200;

/**
 * Batas percobaan untuk kegagalan yang mungkin sembuh sendiri (5xx, 401).
 *
 * Tanpa batas ini satu entri yang selalu ditolak akan menahan seluruh antrean
 * selamanya, karena flush berhenti di kegagalan pertama.
 */
const MAX_ATTEMPTS = 6;

export interface QueuedWrite {
  /** Id unik, dipakai server sebagai kunci utama agar kiriman ulang tak menggandakan. */
  clientId: string;
  path: string;
  body: Record<string, unknown>;
  queuedAt: number;
  /** Berapa kali entri ini sudah ditolak server dengan kesalahan sementara. */
  attempts?: number;
}

/** Id acak yang aman dipakai sebagai kunci utama di server. */
export function newClientId(): string {
  // crypto.randomUUID tidak ada di semua konteks lama; tanda hubung dibuang
  // supaya cocok dengan pola id yang diterima server.
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return uuid.replace(/-/g, '').slice(0, 32);
}

/**
 * Benar bila `import()` malas gagal mengambil chunk-nya.
 *
 * Nama berkas chunk mengandung hash isi, jadi tiap deploy melahirkan nama
 * baru dan membuang yang lama. Tab yang sudah lama terbuka — atau PWA yang
 * shell-nya tersaji dari cache — masih memegang nama lama, dan chunk yang
 * belum pernah diambil akan 404. Ini BUKAN masalah jaringan: menyuruh
 * pengguna "coba lagi setelah tersambung" tidak akan pernah menolongnya,
 * karena yang dibutuhkan justru memuat ulang aplikasi.
 */
export function isStaleChunkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const pesan = err.message.toLowerCase();
  return pesan.includes('dynamically imported module')
    || pesan.includes('importing a module script failed')
    || pesan.includes('error loading dynamically imported module');
}

/**
 * Benar bila permintaan gagal karena jaringan, bukan karena server menolak.
 *
 * Pesannya diperiksa, bukan cuma tipenya. `fetch` memang melempar TypeError
 * saat jaringan tidak tercapai, tapi TypeError juga jenis galat pemrograman
 * yang paling umum — "cannot read properties of undefined" dan kawan-kawan.
 * Menyamakan keduanya membuat bug biasa dilaporkan ke pengguna sebagai "tidak
 * ada jaringan" di perangkat yang jelas online, dan membuat antrean offline
 * menyimpan lalu mengulang selamanya permintaan yang sebenarnya tidak akan
 * pernah berhasil.
 */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (!(err instanceof TypeError)) return false;
  // Gagal memuat chunk juga datang sebagai TypeError, tapi punya penanganan
  // sendiri — jangan diklaim sebagai masalah jaringan.
  if (isStaleChunkError(err)) return false;

  const pesan = err.message.toLowerCase();
  return pesan.includes('failed to fetch')      // Chrome
    || pesan.includes('networkerror')            // Firefox
    || pesan.includes('load failed')             // Safari
    || pesan.includes('network request failed')  // WebKit lama
    || pesan.includes('connection');
}

/**
 * Benar bila permintaan mungkin berhasil kalau diulang nanti.
 *
 * Yang menentukan bukan "4xx atau bukan", melainkan apakah pengulangan punya
 * peluang: 500 saat deploy, 429 saat dibatasi, dan 401 saat token kedaluwarsa
 * semuanya sembuh sendiri dalam hitungan menit. Membuang catatan panen karena
 * kebetulan servernya sedang di-deploy adalah kehilangan data, bukan
 * pembersihan antrean.
 */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof ApiError)) {
    // Kesalahan yang tidak dikenal: disimpan, tapi tetap dihitung percobaannya
    // supaya tidak menyumbat antrean selamanya.
    return true;
  }
  return err.status >= 500 || err.status === 401 || err.status === 408 || err.status === 429;
}

/** Dua permintaan dianggap sama bila tujuan dan seluruh isinya sama. */
function sameRequest(a: QueuedWrite, b: QueuedWrite): boolean {
  if (a.path !== b.path) return false;
  const ka = Object.keys(a.body).sort();
  const kb = Object.keys(b.body).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => kb[i] === k && a.body[k] === b.body[k]);
}

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
}

/**
 * Antrean yang sedang di-flush, dikunci per akun.
 *
 * Penjaganya harus di tingkat modul, bukan di dalam `queueFor`: panel AI ada
 * di sepuluh layar dan layar Kebun punya flush-nya sendiri, jadi satu
 * peristiwa `online` membangunkan belasan pemanggil sekaligus. Kalau tiap
 * pemanggil memegang penjaganya sendiri, semuanya mengira dialah satu-satunya
 * dan antrean yang sama dikirim berkali-kali.
 *
 * Server memang menolak kiriman ulang lewat clientId, jadi tidak ada baris
 * ganda — tapi mengandalkan itu berarti setiap endpoint baru yang diantre
 * harus ikut mengingat aturannya, dan yang lupa akan menulis dua kali.
 */
const flushingKeys = new Set<string>();

export interface OfflineQueue {
  size(): number;
  /** Benar bila entri baru masuk; salah bila permintaan yang sama sudah antre. */
  enqueue(entry: QueuedWrite): boolean;
  flush(send: (path: string, body: Record<string, unknown>) => Promise<unknown>): Promise<FlushResult>;
  clear(): void;
}

/**
 * Antrean milik satu akun.
 *
 * `userId` wajib supaya tidak ada jalan diam-diam memakai antrean bersama:
 * kunci penyimpanannya ikut berbeda per akun.
 */
export function queueFor(userId: string): OfflineQueue {
  const storageKey = `${STORAGE_PREFIX}:${userId}`;

  function read(): QueuedWrite[] {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as QueuedWrite[]) : [];
    } catch {
      // Penyimpanan rusak atau diblokir: antrean kosong lebih baik daripada
      // seluruh aplikasi gagal dimuat.
      return [];
    }
  }

  function write(entries: QueuedWrite[]): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    } catch {
      // Kuota penuh atau mode privat — tidak ada yang bisa dilakukan selain
      // membiarkan permintaan ini hilang, dan itu sudah keadaan sebelumnya.
    }
  }

  // Versi sebelumnya menyimpan satu antrean bersama tanpa nama akun. Isinya
  // dipindahkan sekali ke akun yang sedang aktif alih-alih ditinggalkan:
  // catatan yang salah akun akan ditolak server dan dibuang di flush pertama,
  // sedangkan membiarkannya berarti catatan yang benar pun tidak pernah
  // terkirim dan tidak pernah terlihat lagi oleh siapa pun.
  try {
    const legacy = localStorage.getItem(STORAGE_PREFIX);
    if (legacy) {
      localStorage.removeItem(STORAGE_PREFIX);
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const mine = read();
        const known = new Set(mine.map((e) => e.clientId));
        write([...mine, ...(parsed as QueuedWrite[]).filter((e) => e?.clientId && !known.has(e.clientId))]);
      }
    }
  } catch {
    // Penyimpanan diblokir: tidak ada yang bisa dipindahkan, dan itu sudah
    // keadaan sebelumnya.
  }

  return {
    size: () => read().length,

    enqueue(entry) {
      const entries = read();
      // Id yang sama tidak pernah diantre dua kali, misalnya saat pengguna
      // menekan tombol berulang kali karena mengira tidak terjadi apa-apa.
      if (entries.some((e) => e.clientId === entry.clientId)) return false;
      // Permintaan yang isinya persis sama juga tidak. Ini yang menyelamatkan
      // kasus paling mudah terjadi: pengguna mencatat siram saat offline, lalu
      // menutup aplikasi. Saat dibuka lagi layar memuat data lama dari server
      // (yang memang belum tahu apa-apa), tanamannya kembali terlihat belum
      // disiram, dan pengguna mengetuk lagi. Tanpa penjagaan ini kiriman kedua
      // punya clientId berbeda dan tercatat sebagai siram kedua — merusak
      // rentetan merawat dan hitungan HPP yang berdiri di atas log itu.
      if (entries.some((e) => sameRequest(e, entry))) return false;
      entries.push(entry);
      write(entries);
      return true;
    },

    async flush(send) {
      if (flushingKeys.has(storageKey)) return { sent: 0, failed: 0, remaining: read().length };
      const snapshot = read();
      if (snapshot.length === 0) return { sent: 0, failed: 0, remaining: 0 };

      flushingKeys.add(storageKey);
      const done = new Set<string>();
      const attempted = new Map<string, number>();
      let sent = 0;
      let failed = 0;

      try {
        for (const entry of snapshot) {
          try {
            await send(entry.path, { ...entry.body, clientId: entry.clientId });
            done.add(entry.clientId);
            sent++;
          } catch (err) {
            failed++;
            if (isNetworkError(err)) {
              // Masih offline: entri dipertahankan tanpa menambah hitungan
              // percobaan — lama offline bukan salah catatannya — dan sisanya
              // tidak dicoba, karena itu hanya menghabiskan baterai.
              break;
            }
            if (isRetryableError(err)) {
              const attempts = (entry.attempts ?? 0) + 1;
              if (attempts >= MAX_ATTEMPTS) done.add(entry.clientId);
              else attempted.set(entry.clientId, attempts);
              // Server sedang tidak sehat: sisanya akan gagal dengan alasan
              // yang sama, jadi berhenti dan coba lagi nanti.
              break;
            }
            // Ditolak permanen (4xx selain 401/408/429): dibuang. Permintaan
            // yang memang salah tidak akan pernah berhasil seberapa pun sering
            // diulang, dan menyimpannya berarti antrean tak pernah kosong.
            done.add(entry.clientId);
          }
        }
      } finally {
        flushingKeys.delete(storageKey);
      }

      // Dibaca ulang, bukan memakai `snapshot`: pengguna bisa mencatat
      // perawatan baru selagi flush berjalan, dan menulis balik snapshot lama
      // akan menghapus catatan itu sebelum sempat terkirim sekali pun.
      const remaining = read()
        .filter((e) => !done.has(e.clientId))
        .map((e) => {
          const attempts = attempted.get(e.clientId);
          return attempts === undefined ? e : { ...e, attempts };
        });
      write(remaining);
      return { sent, failed, remaining: remaining.length };
    },

    clear() {
      write([]);
    },
  };
}
