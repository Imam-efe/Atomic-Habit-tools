/**
 * Uji layar transfer.
 *
 * Dua hal yang dijaga di sini pernah jadi bug nyata di aplikasi ini:
 * gagal memuat yang terlihat sama dengan "belum ada data" (pengguna mencatat
 * ulang sesuatu yang sebenarnya masih aman di server), dan formulir yang
 * menutup diri setelah gagal sehingga isinya harus diketik ulang.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BudgetTransfer } from '../BudgetTransfer';

afterEach(() => { vi.restoreAllMocks(); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const rekening = [
  { id: 'a', name: 'BCA', account_type: 'Bank', balance: 1_000_000 },
  { id: 'b', name: 'Dompet', account_type: 'Tunai', balance: 200_000 },
];

function routeFetch(routes: Record<string, unknown>) {
  // `init` ikut diterima meski tidak dipakai menjawab: beberapa tes memeriksa
  // method permintaan yang terkirim, dan itu hanya terbaca kalau argumennya
  // ada di tanda tangan mock-nya.
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return json({ error: 'not_found' }, 404);
    return json(routes[key]);
  });
}

const rutePenuh = (transfer: unknown[] = []) => ({
  '/bank-accounts': rekening,
  '/transfer': { transfer },
});

describe('BudgetTransfer', () => {
  it('membedakan gagal muat dari belum ada transfer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<BudgetTransfer />);

    expect(await screen.findByText(/Gagal memuat transfer/)).toBeInTheDocument();
    // Kalimat kondisi kosong tidak boleh ikut muncul — itu justru yang dulu
    // membuat kegagalan terlihat seperti "memang belum ada".
    expect(screen.queryByText(/Belum ada transfer/)).not.toBeInTheDocument();
  });

  it('menyebut keadaan kosong apa adanya saat memang belum ada', async () => {
    vi.stubGlobal('fetch', routeFetch(rutePenuh()));
    render(<BudgetTransfer />);

    expect(await screen.findByText(/Belum ada transfer/)).toBeInTheDocument();
    expect(screen.queryByText(/Gagal memuat/)).not.toBeInTheDocument();
  });

  it('menampilkan kedua nama rekening pada tiap baris', async () => {
    vi.stubGlobal('fetch', routeFetch(rutePenuh([{
      id: 't1', dariRekeningId: 'a', keRekeningId: 'b',
      dariNama: 'BCA', keNama: 'Dompet',
      jumlah: 300_000, tanggal: '2026-09-20', catatan: 'tarik tunai',
    }])));
    render(<BudgetTransfer />);

    expect(await screen.findByText('BCA → Dompet')).toBeInTheDocument();
    expect(screen.getByText(/tarik tunai/)).toBeInTheDocument();
  });

  it('menyebut rekening yang sudah terhapus, bukan menampilkan baris kosong', async () => {
    vi.stubGlobal('fetch', routeFetch(rutePenuh([{
      id: 't1', dariRekeningId: 'x', keRekeningId: 'b',
      dariNama: null, keNama: 'Dompet',
      jumlah: 50_000, tanggal: '2026-09-20', catatan: null,
    }])));
    render(<BudgetTransfer />);

    expect(await screen.findByText('Rekening terhapus → Dompet')).toBeInTheDocument();
  });

  it('tidak menawarkan rekening asal sebagai tujuan', async () => {
    const f = routeFetch(rutePenuh());
    vi.stubGlobal('fetch', f);
    render(<BudgetTransfer />);

    fireEvent.click(await screen.findByText(/Pindahkan uang antar rekening/));
    const pilihan = await screen.findAllByRole('combobox');
    fireEvent.change(pilihan[0], { target: { value: 'a' } });

    // Perlindungan yang sebenarnya ada di sini, bukan di validasi saat simpan:
    // rekening yang sudah jadi asal tidak muncul di daftar tujuan, jadi
    // transfer ke diri sendiri tidak bisa dipilih sejak awal. Validasinya
    // tetap ada sebagai jaring, dan server menolaknya sekali lagi.
    const opsiTujuan = Array.from(pilihan[1].querySelectorAll('option')).map((o) => o.textContent);
    expect(opsiTujuan.some((t) => t?.includes('Dompet'))).toBe(true);
    expect(opsiTujuan.some((t) => t?.includes('BCA'))).toBe(false);
  });

  it('tidak mengirim apa pun ke server saat rekening belum dipilih', async () => {
    const f = routeFetch(rutePenuh());
    vi.stubGlobal('fetch', f);
    render(<BudgetTransfer />);

    fireEvent.click(await screen.findByText(/Pindahkan uang antar rekening/));
    fireEvent.click(screen.getByText('Pindahkan'));

    expect(await screen.findByText('Pilih rekening asal dan tujuan.')).toBeInTheDocument();
    expect(f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
  });

  it('memperingatkan saat jumlahnya melebihi saldo rekening asal', async () => {
    vi.stubGlobal('fetch', routeFetch(rutePenuh()));
    render(<BudgetTransfer />);

    fireEvent.click(await screen.findByText(/Pindahkan uang antar rekening/));
    const pilihan = await screen.findAllByRole('combobox');
    fireEvent.change(pilihan[0], { target: { value: 'b' } });
    fireEvent.change(screen.getByPlaceholderText(/Jumlah/), { target: { value: '500000' } });

    // Peringatan, bukan larangan: server yang berhak menolak.
    expect(await screen.findByText(/membuatnya minus/)).toBeInTheDocument();
  });

  it('meminta menambah rekening dulu bila baru punya satu', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/bank-accounts': [rekening[0]],
      '/transfer': { transfer: [] },
    }));
    render(<BudgetTransfer />);

    fireEvent.click(await screen.findByText(/Pindahkan uang antar rekening/));
    expect(await screen.findByText(/butuh dua rekening/i)).toBeInTheDocument();
  });

  it('membiarkan formulir terbuka dengan isinya utuh saat penyimpanan gagal', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('offline');
      if (String(url).includes('bank-accounts')) return json(rekening);
      return json({ transfer: [] });
    });
    vi.stubGlobal('fetch', f);
    render(<BudgetTransfer />);

    fireEvent.click(await screen.findByText(/Pindahkan uang antar rekening/));
    const pilihan = await screen.findAllByRole('combobox');
    fireEvent.change(pilihan[0], { target: { value: 'a' } });
    fireEvent.change(pilihan[1], { target: { value: 'b' } });
    fireEvent.change(screen.getByPlaceholderText(/Jumlah/), { target: { value: '100000' } });
    fireEvent.click(screen.getByText('Pindahkan'));

    await waitFor(() => {
      // Tombolnya kembali normal, dan isian masih ada — bukan formulir kosong
      // yang harus diketik ulang.
      expect(screen.getByText('Pindahkan')).toBeInTheDocument();
    });
    expect((screen.getByPlaceholderText(/Jumlah/) as HTMLInputElement).value).not.toBe('');
  });
});
