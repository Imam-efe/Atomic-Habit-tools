/**
 * Uji perilaku periode laporan di layar Uang.
 *
 * Yang dijaga di sini adalah hal-hal yang membuat periodenya hanya SETENGAH
 * berlaku — dan setengah berlaku lebih buruk daripada tidak berlaku, karena
 * sebagian angka mengikuti periode pengguna dan sebagian lagi tidak:
 *
 * 1. Rentang "Periode" tidak boleh mengirim from/to. Kalau layar menghitung
 *    batasnya sendiri, ada dua salinan rumus periode dan keduanya akan
 *    menyimpang — persis yang fitur ini dibuat untuk menghapus.
 * 2. Permintaan limit tidak boleh mengirim bulan kalender. Labelnya ditentukan
 *    server; mengirim bulan kalender akan menanyakan periode yang bukan
 *    periode berjalan, dan limitnya tidak pernah terlihat.
 * 3. Rentang bawaan dari pengaturan harus benar-benar dipakai.
 * 4. Batas periodenya harus tersebut di layar. Tanpa itu, "Periode" cuma
 *    tombol yang mengubah angka tanpa penjelasan.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Budget } from '../Budget';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const PERIODE = {
  mulai: '2026-09-25', selesai: '2026-10-24', label: '2026-10', hariMulai: 25, dipakai: true,
};

function stub(nilaiPengaturan: Record<string, unknown> = {}) {
  const f = vi.fn(async (url: string, _init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/settings')) return json({ values: nilaiPengaturan });
    if (u.includes('/budget/categories')) {
      return json({
        expense: [{ id: 'c1', nama: 'Makanan & Minuman', emoji: '🍚', bawaan: true, anak: [] }],
        income: [{ id: 'c2', nama: 'Gaji', emoji: '💼', bawaan: true, anak: [] }],
      });
    }
    if (u.includes('/budget/limits')) return json([]);
    if (u.includes('/budget')) {
      return json({
        entries: [],
        summary: { income: 0, expense: 0, balance: 0 },
        periode: PERIODE,
      });
    }
    if (u.includes('/bank-accounts')) return json([]);
    return json({});
  });
  vi.stubGlobal('fetch', f);
  return f;
}

/** Semua URL budget yang diminta, tanpa mengikutkan panggilan lain. */
const panggilanBudget = (f: ReturnType<typeof stub>) =>
  f.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/budget?') || u.endsWith('/budget'));

const panggilanLimit = (f: ReturnType<typeof stub>) =>
  f.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/budget/limits'));

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('rentang Periode', () => {
  it('tidak mengirim from/to, supaya server yang menentukan batasnya', async () => {
    const f = stub({ 'money.default_range': 'periode' });
    render(<Budget />);

    await waitFor(() => { expect(panggilanBudget(f).length).toBeGreaterThan(0); });
    // Satu pun permintaan budget tidak boleh membawa from/to: batas periode
    // hanya boleh dihitung di satu tempat, dan tempat itu server.
    expect(panggilanBudget(f).every((u) => !u.includes('from='))).toBe(true);
  });

  it('menyebutkan batas periodenya di layar', async () => {
    stub({ 'money.default_range': 'periode' });
    render(<Budget />);

    expect(await screen.findByText(/2026-09-25 s\/d 2026-10-24/)).toBeInTheDocument();
  });

  it('menandai bahwa itu siklus gajian saat cut-off bukan tanggal 1', async () => {
    stub({ 'money.default_range': 'periode' });
    render(<Budget />);

    expect(await screen.findByText(/siklus gajian/)).toBeInTheDocument();
  });

  it('tidak menyebut siklus gajian saat masih bulan kalender', async () => {
    const f = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/settings')) return json({ values: {} });
      if (u.includes('/budget/categories')) return json({ expense: [], income: [] });
      if (u.includes('/budget/limits')) return json([]);
      if (u.includes('/budget')) {
        return json({
          entries: [], summary: { income: 0, expense: 0, balance: 0 },
          periode: { ...PERIODE, mulai: '2026-10-01', selesai: '2026-10-31', hariMulai: 1 },
        });
      }
      return json([]);
    });
    vi.stubGlobal('fetch', f);
    render(<Budget />);

    await screen.findByText(/2026-10-01 s\/d 2026-10-31/);
    expect(screen.queryByText(/siklus gajian/)).not.toBeInTheDocument();
  });

  it('mengirim from/to begitu pengguna memilih rentang lain', async () => {
    const f = stub({ 'money.default_range': 'periode' });
    render(<Budget />);

    await waitFor(() => { expect(panggilanBudget(f).length).toBeGreaterThan(0); });
    fireEvent.click(screen.getByText('7 Hari'));

    // Pemilih rentang harus tetap berarti apa yang dikatakannya, bukan
    // diam-diam dijepit ke periode laporan.
    await waitFor(() => {
      expect(panggilanBudget(f).some((u) => u.includes('from='))).toBe(true);
    });
  });
});

describe('permintaan limit anggaran', () => {
  it('tidak mengirim bulan kalender dari layar', async () => {
    const f = stub({ 'money.default_range': 'periode' });
    render(<Budget />);

    await waitFor(() => { expect(panggilanLimit(f).length).toBeGreaterThan(0); });
    // `?month=` dari sini akan menanyakan periode yang bukan periode berjalan
    // begitu cut-off bukan tanggal 1.
    expect(panggilanLimit(f).every((u) => !u.includes('month='))).toBe(true);
  });
});

describe('rentang bawaan dari pengaturan', () => {
  it('membuka layar pada rentang 7 hari bila itu yang disetel', async () => {
    const f = stub({ 'money.default_range': '7d' });
    render(<Budget />);

    await waitFor(() => {
      expect(panggilanBudget(f).some((u) => u.includes('from='))).toBe(true);
    });
  });

  it('memetakan 90d dari registry ke tombol 3 Bulan di layar', async () => {
    // Registry menyebutnya 90 hari, layar ini menamainya 3 Bulan. Kalau
    // pemetaannya lupa, pengaturan itu diam-diam tidak berlaku.
    const f = stub({ 'money.default_range': '90d' });
    render(<Budget />);

    await waitFor(() => { expect(panggilanBudget(f).length).toBeGreaterThan(0); });
    const dipakai = panggilanBudget(f).find((u) => u.includes('from='));
    expect(dipakai).toBeTruthy();

    // 3 bulan = 89 hari ke belakang. Dibandingkan dengan 7 dan 30 hari supaya
    // ujinya benar-benar membedakan, bukan sekadar "ada from=".
    const from = new Date(`${dipakai!.match(/from=([\d-]+)/)![1]}T00:00:00Z`);
    const to = new Date(`${dipakai!.match(/to=([\d-]+)/)![1]}T00:00:00Z`);
    const selisih = Math.round((to.getTime() - from.getTime()) / 86400000);
    expect(selisih).toBe(89);
  });
});
