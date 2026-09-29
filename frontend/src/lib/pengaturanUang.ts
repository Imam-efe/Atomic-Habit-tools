/**
 * Pengaturan uang untuk layar, dari server dengan cadangan yang selalu ada.
 *
 * Bawaannya ADA DUA KALI: di registry backend (sumber kebenaran) dan di sini
 * sebagai cadangan. Itu disengaja, dan alasannya sama dengan daftar kategori:
 * aplikasi ini punya antrean offline, jadi layar Uang harus tetap terbuka dan
 * tetap bisa dipakai walau pengaturannya gagal diambil. Ada uji yang membaca
 * registry backend langsung dan membandingkannya dengan cadangan di sini,
 * supaya keduanya tidak bisa menyimpang tanpa ada yang gagal.
 *
 * Yang TIDAK ada di sini: aritmetika periode. Batas periode dihitung server
 * dan dikirim bersama datanya. Salinan kedua rumus periode di frontend akan
 * melahirkan dua angka berbeda untuk hal yang sama — persis yang fitur ini
 * dibuat untuk menghapus.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from './api';

export interface PengaturanUang {
  /** Tanggal mulai periode laporan, 1-28. */
  hariMulaiPeriode: number;
  /** Horizon proyeksi saldo, dalam hari. */
  hariProyeksi: number;
  /** Persentase limit yang memicu penandaan kategori. */
  persenPeringatan: number;
  /** Rentang yang terbuka lebih dulu di layar Uang. */
  rentangBawaan: string;
}

export const PENGATURAN_UANG_CADANGAN: PengaturanUang = {
  hariMulaiPeriode: 1,
  hariProyeksi: 30,
  persenPeringatan: 80,
  rentangBawaan: 'periode',
};

const KUNCI_SIMPAN = 'pengaturan-uang-v1';

/** Kunci di registry backend, dipetakan ke bentuk yang dipakai layar. */
const KUNCI = {
  hariMulaiPeriode: 'money.period_start_day',
  hariProyeksi: 'money.projection_days',
  persenPeringatan: 'money.budget_warn_percent',
  rentangBawaan: 'money.default_range',
} as const;

function dariNilaiServer(values: Record<string, unknown>): PengaturanUang {
  const angka = (kunci: string, cadangan: number): number => {
    const v = values[kunci];
    return typeof v === 'number' && Number.isFinite(v) ? v : cadangan;
  };
  const teks = (kunci: string, cadangan: string): string => {
    const v = values[kunci];
    return typeof v === 'string' && v ? v : cadangan;
  };

  return {
    hariMulaiPeriode: angka(KUNCI.hariMulaiPeriode, PENGATURAN_UANG_CADANGAN.hariMulaiPeriode),
    hariProyeksi: angka(KUNCI.hariProyeksi, PENGATURAN_UANG_CADANGAN.hariProyeksi),
    persenPeringatan: angka(KUNCI.persenPeringatan, PENGATURAN_UANG_CADANGAN.persenPeringatan),
    rentangBawaan: teks(KUNCI.rentangBawaan, PENGATURAN_UANG_CADANGAN.rentangBawaan),
  };
}

function bacaSimpanan(): PengaturanUang | null {
  try {
    const mentah = localStorage.getItem(KUNCI_SIMPAN);
    if (!mentah) return null;
    const isi = JSON.parse(mentah) as Partial<PengaturanUang>;
    if (typeof isi.hariMulaiPeriode !== 'number') return null;
    return { ...PENGATURAN_UANG_CADANGAN, ...isi };
  } catch {
    return null;
  }
}

/**
 * Pengaturan uang yang berlaku.
 *
 * `siap` menandai jawaban server sudah masuk. Layar memakainya untuk menunda
 * pemuatan pertama sampai rentang bawaannya diketahui — kalau tidak, layar
 * akan memuat sekali dengan rentang cadangan lalu memuat ulang begitu
 * pengaturannya datang, dan pengguna melihat angkanya berkedip berubah.
 */
export function usePengaturanUang(): { pengaturan: PengaturanUang; siap: boolean } {
  const tersimpan = bacaSimpanan();
  const [pengaturan, setPengaturan] = useState<PengaturanUang>(
    tersimpan ?? PENGATURAN_UANG_CADANGAN
  );
  // Yang tersimpan di peranti sudah cukup untuk memuat dengan rentang yang
  // benar, jadi dianggap siap tanpa menunggu jaringan.
  const [siap, setSiap] = useState(tersimpan !== null);

  useEffect(() => {
    let dibatalkan = false;

    apiFetch<{ values: Record<string, unknown> }>('/settings')
      .then((r) => {
        const segar = dariNilaiServer(r.values ?? {});
        if (!dibatalkan) setPengaturan(segar);
        try {
          localStorage.setItem(KUNCI_SIMPAN, JSON.stringify(segar));
        } catch { /* kuota penuh atau mode privat: layarnya tetap jalan */ }
      })
      .catch(() => {
        // Sengaja diam. Layarnya sudah punya nilai yang bisa dipakai, dan
        // memunculkan galat di sini hanya menakuti pengguna soal hal yang
        // tidak menghalangi apa pun.
      })
      .finally(() => { if (!dibatalkan) setSiap(true); });

    return () => { dibatalkan = true; };
  }, []);

  return { pengaturan, siap };
}
