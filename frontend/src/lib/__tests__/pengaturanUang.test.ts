/**
 * Uji pembaca pengaturan uang.
 *
 * Tiga hal yang dijaga:
 *
 * 1. Layar tidak boleh pernah kosong atau macet karena pengaturannya gagal
 *    diambil. Aplikasi ini punya antrean offline — mencatat transaksi harus
 *    tetap bisa tanpa jaringan.
 * 2. Cadangan di frontend harus sama dengan bawaan di registry backend.
 *    Keduanya berkas terpisah dan tidak ada yang memaksa keduanya sejalan,
 *    jadi nilainya dibaca langsung dari berkas backend-nya.
 * 3. `siap` harus menjadi true pada SEMUA jalur, termasuk saat jaringan gagal.
 *    Layar menunda pemuatan pertamanya sampai `siap`; kalau ia tidak pernah
 *    true, layar Uang menggantung selamanya di "Memuat…" saat offline — dan
 *    itu kegagalan yang jauh lebih buruk daripada memakai nilai cadangan.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { usePengaturanUang, PENGATURAN_UANG_CADANGAN } from '../pengaturanUang';

const KUNCI = 'pengaturan-uang-v1';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const NILAI_SERVER = {
  'money.period_start_day': 25,
  'money.projection_days': 90,
  'money.budget_warn_percent': 60,
  'money.default_range': '7d',
};

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('usePengaturanUang', () => {
  it('memakai cadangan sejak render pertama', () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ values: NILAI_SERVER })));
    const { result } = renderHook(() => usePengaturanUang());
    expect(result.current.pengaturan).toEqual(PENGATURAN_UANG_CADANGAN);
  });

  it('mengganti dengan nilai dari server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ values: NILAI_SERVER })));
    const { result } = renderHook(() => usePengaturanUang());

    await waitFor(() => {
      expect(result.current.pengaturan.hariMulaiPeriode).toBe(25);
    });
    expect(result.current.pengaturan.hariProyeksi).toBe(90);
    expect(result.current.pengaturan.persenPeringatan).toBe(60);
    expect(result.current.pengaturan.rentangBawaan).toBe('7d');
  });

  it('menjadi siap walau jaringan gagal', async () => {
    // Kalau `siap` tidak pernah true, layar Uang menggantung selamanya di
    // "Memuat…" saat offline — jauh lebih buruk daripada memakai cadangan.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { result } = renderHook(() => usePengaturanUang());

    await waitFor(() => { expect(result.current.siap).toBe(true); });
    expect(result.current.pengaturan).toEqual(PENGATURAN_UANG_CADANGAN);
  });

  it('nilai server yang bukan angka tidak merusak pengaturannya', async () => {
    // Nilai rusak di sini akan lolos sebagai NaN ke `?days=NaN`, dan servernya
    // menjepitnya balik — tapi layar akan menampilkan "Proyeksi NaN hari".
    vi.stubGlobal('fetch', vi.fn(async () => json({
      values: { 'money.projection_days': 'sembilan puluh', 'money.period_start_day': null },
    })));
    const { result } = renderHook(() => usePengaturanUang());

    await waitFor(() => { expect(result.current.siap).toBe(true); });
    expect(result.current.pengaturan.hariProyeksi).toBe(PENGATURAN_UANG_CADANGAN.hariProyeksi);
    expect(result.current.pengaturan.hariMulaiPeriode).toBe(1);
  });

  it('jawaban tanpa values tidak menjatuhkan hook-nya', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    const { result } = renderHook(() => usePengaturanUang());

    await waitFor(() => { expect(result.current.siap).toBe(true); });
    expect(result.current.pengaturan).toEqual(PENGATURAN_UANG_CADANGAN);
  });

  it('memakai simpanan peranti sejak render pertama, dan langsung siap', async () => {
    localStorage.setItem(KUNCI, JSON.stringify({
      hariMulaiPeriode: 25, hariProyeksi: 60, persenPeringatan: 70, rentangBawaan: 'periode',
    }));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    const { result } = renderHook(() => usePengaturanUang());
    // Terisi DAN siap tanpa menunggu jaringan: pengguna yang membuka aplikasi
    // tanpa sinyal langsung melihat periodenya sendiri, bukan bawaan.
    expect(result.current.pengaturan.hariMulaiPeriode).toBe(25);
    expect(result.current.siap).toBe(true);
  });

  it('mengabaikan simpanan yang rusak', () => {
    localStorage.setItem(KUNCI, '{bukan json');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    const { result } = renderHook(() => usePengaturanUang());
    expect(result.current.pengaturan).toEqual(PENGATURAN_UANG_CADANGAN);
  });

  it('menyimpan nilai server untuk pembukaan berikutnya', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ values: NILAI_SERVER })));
    const { result } = renderHook(() => usePengaturanUang());

    await waitFor(() => { expect(result.current.pengaturan.hariMulaiPeriode).toBe(25); });
    const tersimpan = JSON.parse(localStorage.getItem(KUNCI)!) as { hariMulaiPeriode: number };
    expect(tersimpan.hariMulaiPeriode).toBe(25);
  });
});

describe('cadangan dan registry backend', () => {
  it('nilainya sama dengan bawaan di registry backend', () => {
    // Dua berkas terpisah tanpa apa pun yang memaksanya sejalan. Kalau
    // menyimpang, pengguna offline melihat periode yang berbeda dari yang
    // dipakai server saat menghitung angkanya — tanpa galat apa pun.
    const sumber = readFileSync(
      join(__dirname, '../../../../backend/src/lib/settings_schema.ts'),
      'utf8'
    );

    const bawaan = (kunci: string): string => {
      const i = sumber.indexOf(`key: '${kunci}'`);
      expect(i, `pengaturan ${kunci} tidak ada di registry backend`).toBeGreaterThan(-1);
      // `default:` pertama setelah kuncinya, di dalam objek yang sama.
      const potong = sumber.slice(i, i + 700);
      const m = potong.match(/default:\s*('([^']*)'|[\d.]+)/);
      expect(m, `default untuk ${kunci} tidak terbaca`).toBeTruthy();
      return m![2] ?? m![1];
    };

    expect(Number(bawaan('money.period_start_day')))
      .toBe(PENGATURAN_UANG_CADANGAN.hariMulaiPeriode);
    expect(Number(bawaan('money.projection_days')))
      .toBe(PENGATURAN_UANG_CADANGAN.hariProyeksi);
    expect(Number(bawaan('money.budget_warn_percent')))
      .toBe(PENGATURAN_UANG_CADANGAN.persenPeringatan);
    expect(bawaan('money.default_range'))
      .toBe(PENGATURAN_UANG_CADANGAN.rentangBawaan);
  });
});
