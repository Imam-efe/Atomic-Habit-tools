/**
 * Tujuan tap notifikasi, dari pathname ke layar.
 *
 * Service worker membuka `origin + data.url` (public/sw.js, notificationclick)
 * dan payload push memakai path seperti "/ternak" atau "/kebun". Router aplikasi
 * memakai catch-all "/*" yang merender AppShell tanpa pernah melihat
 * pathname-nya — jadi tanpa pemetaan ini SETIAP notifikasi mendarat di Beranda,
 * bukan di layar yang dijanjikan judulnya.
 *
 * Berkas ini sumber kebenarannya. Ada tes di backend yang memindai tiap
 * `url: '/...'` di payload push dan menuntutnya ada di sini, supaya pengirim
 * push baru tidak bisa diam-diam menambah tautan yang tidak mendarat di mana
 * pun.
 */

import type { TabName } from '@/types';

export interface DeepLink {
  tab: TabName;
  /** Sub-layar yang dibuka sesudah tabnya, untuk tujuan yang bukan tab sendiri. */
  sub?: string;
}

export const DEEP_LINKS: Record<string, DeepLink> = {
  '/': { tab: 'beranda' },
  '/beranda': { tab: 'beranda' },
  '/kebiasaan': { tab: 'kebiasaan' },
  '/kalender': { tab: 'kalender' },
  '/kebun': { tab: 'kebun' },
  '/ternak': { tab: 'ternak' },
  '/uang': { tab: 'uang' },
  '/lainnya': { tab: 'lainnya' },
  // Goals sekarang sub-layar di bawah Lainnya, bukan tab sendiri. Pengingat
  // custom yang sudah tersimpan pengguna masih menunjuk ke "/goals", jadi
  // tautannya harus tetap mendarat di tempat yang benar alih-alih jatuh
  // diam-diam ke Beranda.
  '/goals': { tab: 'lainnya', sub: 'goals' },
};

/** null untuk path yang tidak dikenal, supaya pemanggilnya tidak menavigasi. */
export function resolveDeepLink(pathname: string): DeepLink | null {
  return DEEP_LINKS[pathname] ?? null;
}
