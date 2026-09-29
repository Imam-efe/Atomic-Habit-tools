/**
 * Uji daftar kategori untuk layar.
 *
 * Yang dijaga terutama satu hal: FORMULIRNYA TIDAK BOLEH PERNAH KOSONG.
 * Aplikasi ini punya antrean offline, jadi mencatat transaksi harus tetap bisa
 * walau daftar kategorinya gagal diambil — pengguna yang sedang di pasar tanpa
 * sinyal justru paling butuh mencatat. Setiap jalan yang bisa membuat daftarnya
 * kosong diuji sendiri: jaringan gagal, jawaban kosong, simpanan rusak.
 *
 * Satu lagi: cadangan di sini harus sama dengan kategori bawaan di backend.
 * Keduanya berkas terpisah dan tidak ada yang memaksa keduanya sejalan, jadi
 * kesamaannya dibaca langsung dari berkas backend-nya.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useKategoriKeuangan, labelOpsi, KATEGORI_CADANGAN } from '../kategoriKeuangan';

const KUNCI = 'kategori-keuangan-v1';

const jawabanServer = {
  expense: [
    {
      id: 'c1', nama: 'Tagihan & Utilitas', emoji: '🧾', bawaan: true,
      anak: [{ id: 'c2', nama: 'Listrik', emoji: '⚡', bawaan: true }],
    },
    { id: 'c3', nama: 'Iuran RT', emoji: null, bawaan: false, anak: [] },
  ],
  income: [{ id: 'c4', nama: 'Gaji', emoji: '💼', bawaan: true, anak: [] }],
};

function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  ));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('useKategoriKeuangan', () => {
  it('memakai cadangan sejak render pertama, sebelum jaringan terjawab', () => {
    stubFetch(jawabanServer);
    const { result } = renderHook(() => useKategoriKeuangan());

    // Bukan daftar kosong lalu terisi: formulir yang sempat tanpa pilihan
    // berarti tombol simpan yang tidak bisa dipakai pada detik-detik pertama.
    expect(result.current.expense.length).toBeGreaterThan(0);
    expect(result.current.income.length).toBeGreaterThan(0);
  });

  it('mengganti cadangan dengan daftar dari server', async () => {
    stubFetch(jawabanServer);
    const { result } = renderHook(() => useKategoriKeuangan());

    await waitFor(() => {
      expect(result.current.expense.map((o) => o.nama)).toContain('Iuran RT');
    });
    expect(result.current.income.map((o) => o.nama)).toEqual(['Gaji']);
  });

  it('meratakan subkategori tepat di bawah induknya dan menandainya', async () => {
    stubFetch(jawabanServer);
    const { result } = renderHook(() => useKategoriKeuangan());

    await waitFor(() => {
      expect(result.current.expense.map((o) => o.nama)).toEqual([
        'Tagihan & Utilitas', 'Listrik', 'Iuran RT',
      ]);
    });
    expect(result.current.expense[0].anak).toBe(false);
    expect(result.current.expense[1].anak).toBe(true);
  });

  it('tetap memakai cadangan saat jaringan gagal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { result } = renderHook(() => useKategoriKeuangan());

    // Ditunggu sejenak supaya kegagalannya benar-benar sudah terjadi, bukan
    // sekadar belum sampai.
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toEqual(KATEGORI_CADANGAN);
  });

  it('tidak mengosongkan daftar saat server menjawab kosong', async () => {
    stubFetch({ expense: [], income: [] });
    const { result } = renderHook(() => useKategoriKeuangan());

    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.expense.length).toBeGreaterThan(0);
  });

  it('memakai simpanan peranti saat mulai tanpa jaringan', async () => {
    localStorage.setItem(KUNCI, JSON.stringify({
      expense: [{ nama: 'Kopi', emoji: '☕', anak: false }],
      income: [{ nama: 'Gaji', emoji: null, anak: false }],
    }));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    const { result } = renderHook(() => useKategoriKeuangan());
    // Terisi sejak render pertama, bukan sesudah jaringan — inilah gunanya
    // disimpan: pengguna yang membuka aplikasi tanpa sinyal tetap melihat
    // kategorinya sendiri, bukan daftar bawaan.
    expect(result.current.expense.map((o) => o.nama)).toEqual(['Kopi']);
  });

  it('mengabaikan simpanan yang rusak dan jatuh ke cadangan', () => {
    localStorage.setItem(KUNCI, '{bukan json');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    const { result } = renderHook(() => useKategoriKeuangan());
    expect(result.current).toEqual(KATEGORI_CADANGAN);
  });

  it('mengabaikan simpanan kosong, karena formulir tanpa pilihan lebih buruk', () => {
    localStorage.setItem(KUNCI, JSON.stringify({ expense: [], income: [] }));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    const { result } = renderHook(() => useKategoriKeuangan());
    expect(result.current.expense.length).toBeGreaterThan(0);
  });

  it('menyimpan daftar dari server untuk pembukaan berikutnya', async () => {
    stubFetch(jawabanServer);
    const { result } = renderHook(() => useKategoriKeuangan());

    await waitFor(() => {
      expect(result.current.expense.map((o) => o.nama)).toContain('Iuran RT');
    });
    const tersimpan = JSON.parse(localStorage.getItem(KUNCI)!) as { expense: Array<{ nama: string }> };
    expect(tersimpan.expense.map((o) => o.nama)).toContain('Iuran RT');
  });
});

describe('labelOpsi', () => {
  it('menempelkan emoji bila ada', () => {
    expect(labelOpsi({ nama: 'Listrik', emoji: '⚡', anak: false })).toBe('⚡ Listrik');
    expect(labelOpsi({ nama: 'Iuran RT', emoji: null, anak: false })).toBe('Iuran RT');
  });

  it('menjorokkan subkategori supaya sarangnya terlihat di dalam <select>', () => {
    expect(labelOpsi({ nama: 'Listrik', emoji: '⚡', anak: true })).toContain('↳ ⚡ Listrik');
  });
});

describe('cadangan dan kategori bawaan backend', () => {
  it('berisi nama yang sama persis dengan induk bawaan di backend', () => {
    // Dua berkas terpisah tanpa apa pun yang memaksanya sejalan. Kalau
    // menyimpang, pengguna offline akan mengirim nama kategori yang tidak
    // dikenal server, dan server akan membuatkan kategori baru untuknya —
    // tanpa galat, hanya kolom yang pecah dua.
    // `__dirname`, sama seperti uji sw.js di direktori ini: `import.meta.dirname`
    // tidak terisi pada penyiapan vitest yang dipakai frontend ini.
    const sumber = readFileSync(
      join(__dirname, '../../../../backend/src/lib/finance_kategori.ts'),
      'utf8'
    );

    const potong = (jenis: 'expense' | 'income') => {
      const awal = sumber.indexOf(`  ${jenis}: [`);
      expect(awal).toBeGreaterThan(-1);
      const akhir = sumber.indexOf('\n  ],', awal);
      expect(akhir).toBeGreaterThan(awal);
      const blok = sumber.slice(awal, akhir);
      // Induk saja: barisnya yang mengandung `emoji:` pada tingkat teratas
      // selalu diikuti `anak:` atau menutup objeknya sendiri. Yang membedakan
      // anak dari induk adalah kedalaman indentasinya.
      return [...blok.matchAll(/^ {4}\{?\s*nama: '([^']+)'/gm)].map((m) => m[1]);
    };

    expect(KATEGORI_CADANGAN.expense.map((o) => o.nama)).toEqual(potong('expense'));
    expect(KATEGORI_CADANGAN.income.map((o) => o.nama)).toEqual(potong('income'));
  });
});
