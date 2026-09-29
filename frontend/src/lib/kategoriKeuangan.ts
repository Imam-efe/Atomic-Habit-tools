/**
 * Kategori keuangan untuk layar, dari server dengan cadangan yang selalu ada.
 *
 * Sampai sekarang daftar kategori ditulis dua kali: di routes/budget.ts dan di
 * screens/Budget.tsx. Keduanya kebetulan masih sama persis, dan itu memang
 * hanya kebetulan — menambah satu kategori di backend tidak memunculkannya di
 * formulir, dan tidak ada satu pun uji yang gagal karenanya.
 *
 * Yang dikirim ke server tetap NAMA kategorinya, bukan idnya. Server yang
 * memetakan teks itu ke id lewat tabel alias (lihat backend/migrasi 0043), dan
 * nama unik per jenis, jadi teksnya tetap kunci yang tidak ambigu. Artinya
 * layar ini tidak perlu tahu-menahu soal id sama sekali.
 *
 * CADANGANNYA WAJIB ADA. Aplikasi ini punya antrean offline: mencatat
 * transaksi harus tetap bisa walau daftar kategorinya gagal diambil. Kalau
 * formulirnya bergantung penuh pada satu permintaan jaringan, pengguna yang
 * sedang di pasar tanpa sinyal tidak bisa mencatat apa pun — padahal justru
 * itu saat yang paling butuh dicatat.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from './api';

export interface OpsiKategori {
  /** Yang dikirim ke server, dan yang tersimpan di baris transaksi. */
  nama: string;
  emoji: string | null;
  /** Subkategori ditampilkan menjorok di bawah induknya. */
  anak: boolean;
}

export interface DaftarKategori {
  expense: OpsiKategori[];
  income: OpsiKategori[];
}

/**
 * Cadangan kalau server belum terjawab.
 *
 * Isinya sama dengan induk bawaan di backend (ada uji di sana yang menjaga
 * kesamaannya), tanpa subkategori — subkategori hanya muncul setelah daftar
 * dari server masuk.
 */
export const KATEGORI_CADANGAN: DaftarKategori = {
  expense: [
    'Makanan & Minuman',
    'Transportasi & Bensin',
    'Kebutuhan Rumah Tangga',
    'Belanja Bulanan',
    'Tagihan & Utilitas',
    'Pendidikan & Anak',
    'Kesehatan & Obat',
    'Hiburan & Rekreasi',
    'Cicilan & Utang',
    'Investasi & Tabungan',
    'Lainnya',
  ].map((nama) => ({ nama, emoji: null, anak: false })),
  income: ['Gaji', 'Freelance', 'Investasi', 'Bisnis', 'Lainnya']
    .map((nama) => ({ nama, emoji: null, anak: false })),
};

interface IndukServer {
  id: string;
  nama: string;
  emoji: string | null;
  bawaan: boolean;
  anak: Array<{ id: string; nama: string; emoji: string | null; bawaan: boolean }>;
}

const KUNCI_SIMPAN = 'kategori-keuangan-v1';

/** Induk lalu anaknya, dalam satu daftar rata siap jadi <option>. */
function ratakan(induk: IndukServer[]): OpsiKategori[] {
  return induk.flatMap((k) => [
    { nama: k.nama, emoji: k.emoji, anak: false },
    ...k.anak.map((a) => ({ nama: a.nama, emoji: a.emoji, anak: true })),
  ]);
}

function bacaSimpanan(): DaftarKategori | null {
  try {
    const mentah = localStorage.getItem(KUNCI_SIMPAN);
    if (!mentah) return null;
    const isi = JSON.parse(mentah) as DaftarKategori;
    // Daftar kosong diperlakukan sebagai tidak ada: lebih baik memakai cadangan
    // daripada memberi formulir tanpa satu pun pilihan.
    if (!isi.expense?.length || !isi.income?.length) return null;
    return isi;
  } catch {
    return null;
  }
}

/**
 * Daftar kategori untuk formulir.
 *
 * Urutan sumbernya: yang tersimpan di peranti (supaya formulir langsung terisi
 * tanpa menunggu jaringan), lalu jawaban server menggantikannya, dan cadangan
 * dipakai kalau keduanya tidak ada.
 */
export function useKategoriKeuangan(): DaftarKategori {
  const [daftar, setDaftar] = useState<DaftarKategori>(() => bacaSimpanan() ?? KATEGORI_CADANGAN);

  useEffect(() => {
    let dibatalkan = false;

    apiFetch<{ expense: IndukServer[]; income: IndukServer[] }>('/budget/categories')
      .then((r) => {
        const segar: DaftarKategori = { expense: ratakan(r.expense), income: ratakan(r.income) };
        if (!segar.expense.length || !segar.income.length) return;
        if (!dibatalkan) setDaftar(segar);
        try {
          localStorage.setItem(KUNCI_SIMPAN, JSON.stringify(segar));
        } catch { /* kuota penuh atau mode privat: formulirnya tetap jalan */ }
      })
      .catch(() => {
        // Sengaja diam. Formulirnya sudah punya daftar yang bisa dipakai, dan
        // memunculkan galat di sini hanya menakuti pengguna soal hal yang
        // tidak menghalangi apa pun.
      });

    return () => { dibatalkan = true; };
  }, []);

  return daftar;
}

/** Label <option>: emoji bila ada, dan menjorok bila subkategori. */
export function labelOpsi(o: OpsiKategori): string {
  const isi = o.emoji ? `${o.emoji} ${o.nama}` : o.nama;
  return o.anak ? `   ↳ ${isi}` : isi;
}
