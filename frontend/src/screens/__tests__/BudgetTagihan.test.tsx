/**
 * Uji layar tagihan terjadwal.
 *
 * Empat hal yang dijaga, dan semuanya pernah jadi bug nyata di aplikasi ini
 * atau di modul ini:
 *
 * 1. Gagal memuat yang terlihat sama dengan "belum ada data" — pengguna
 *    mencatat ulang sesuatu yang sebenarnya masih aman di server.
 * 2. Peringatan saldo menembus nol harus muncul walau saldo akhirnya positif.
 *    Itu seluruh guna proyeksinya; menyembunyikannya membuat fiturnya hiasan.
 * 3. Telat harus terbaca sebagai telat, bukan sebagai "beberapa hari lagi".
 * 4. Formulir tidak menutup diri setelah gagal menyimpan.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BudgetTagihan } from '../BudgetTagihan';

afterEach(() => { vi.restoreAllMocks(); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const PROYEKSI_AMAN = {
  mulai: '2026-10-01', hingga: '2026-10-31', hari: 30,
  saldoAwal: 1_000_000, saldoAkhir: 700_000,
  totalKeluar: 300_000, totalMasuk: 0, tanggalMinus: null,
};

const tagihan = (ubah: Record<string, unknown> = {}) => ({
  id: 't1', nama: 'Listrik PLN', jumlah: 300_000, jatuhTempo: '2026-10-05',
  ulang: 'monthly', jenis: 'expense', kategori: 'Tagihan & Utilitas',
  bankAccountId: 'rek-1', rekeningNama: 'BCA', aktif: true, catatan: null,
  jumlahBayar: 0, sisaHari: 4, ...ubah,
});

function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return json({ error: 'not_found' }, 404);
    return json(routes[key]);
  });
}

const rute = (daftar: unknown[] = [], proyeksi: unknown = PROYEKSI_AMAN) => ({
  // '/tagihan' harus diperiksa sebelum '/budget/categories' tidak masalah:
  // keduanya tidak saling mengandung.
  '/tagihan': { tagihan: daftar },
  '/proyeksi': proyeksi,
  '/bank-accounts': [{ id: 'rek-1', name: 'BCA', account_type: 'Bank' }],
  '/budget/categories': {
    expense: [{ id: 'c1', nama: 'Tagihan & Utilitas', emoji: '🧾', bawaan: true, anak: [] }],
    income: [{ id: 'c2', nama: 'Gaji', emoji: '💼', bawaan: true, anak: [] }],
  },
});

describe('BudgetTagihan', () => {
  it('membedakan gagal muat dari belum ada tagihan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<BudgetTagihan />);

    expect(await screen.findByText(/Gagal memuat tagihan/)).toBeInTheDocument();
    expect(screen.queryByText(/Belum ada tagihan terjadwal/)).not.toBeInTheDocument();
  });

  it('menyebut keadaan kosong apa adanya saat memang belum ada', async () => {
    vi.stubGlobal('fetch', routeFetch(rute()));
    render(<BudgetTagihan />);

    expect(await screen.findByText(/Belum ada tagihan terjadwal/)).toBeInTheDocument();
    expect(screen.queryByText(/Gagal memuat tagihan/)).not.toBeInTheDocument();
  });

  it('memperingatkan saldo menembus nol meski saldo akhirnya positif', async () => {
    // Inti fiturnya. Saldo akhir 4,7 juta menyembunyikan minus di tanggal 5,
    // dan tanggal itulah yang bisa ditindaklanjuti.
    vi.stubGlobal('fetch', routeFetch(rute([tagihan()], {
      ...PROYEKSI_AMAN, saldoAkhir: 4_700_000, tanggalMinus: '2026-10-05',
    })));
    render(<BudgetTagihan />);

    expect(await screen.findByText(/menembus nol pada 2026-10-05/)).toBeInTheDocument();
  });

  it('tidak memperingatkan apa pun saat saldonya aman sepanjang horizon', async () => {
    vi.stubGlobal('fetch', routeFetch(rute([tagihan()])));
    render(<BudgetTagihan />);

    await screen.findByText('Listrik PLN');
    expect(screen.queryByText(/menembus nol/)).not.toBeInTheDocument();
  });

  it('menyebut telat sebagai telat, bukan sebagai hari yang akan datang', async () => {
    vi.stubGlobal('fetch', routeFetch(rute([tagihan({ sisaHari: -5 })])));
    render(<BudgetTagihan />);

    expect(await screen.findByText('telat 5 hari')).toBeInTheDocument();
  });

  it('menyebut jatuh tempo hari ini secara khusus, bukan "0 hari lagi"', async () => {
    vi.stubGlobal('fetch', routeFetch(rute([tagihan({ sisaHari: 0 })])));
    render(<BudgetTagihan />);

    expect(await screen.findByText('jatuh tempo hari ini')).toBeInTheDocument();
  });

  it('tidak menawarkan tombol bayar untuk tagihan yang tidak aktif', async () => {
    vi.stubGlobal('fetch', routeFetch(rute([tagihan({ aktif: false, jumlahBayar: 1 })])));
    render(<BudgetTagihan />);

    await screen.findByText('Listrik PLN');
    expect(screen.queryByText('Sudah bayar')).not.toBeInTheDocument();
    // Yang sudah pernah dibayar tetap bisa dibatalkan.
    expect(screen.getByText('Batalkan bayar')).toBeInTheDocument();
  });

  it('tidak menawarkan batal bayar sebelum pernah dibayar', async () => {
    vi.stubGlobal('fetch', routeFetch(rute([tagihan({ jumlahBayar: 0 })])));
    render(<BudgetTagihan />);

    await screen.findByText('Sudah bayar');
    expect(screen.queryByText('Batalkan bayar')).not.toBeInTheDocument();
  });

  it('mengirim nominal yang dikonfirmasi, bukan perkiraannya', async () => {
    // Tagihan listrik jarang sama tiap bulan; yang tercatat harus yang dibayar.
    const f = routeFetch(rute([tagihan()]));
    vi.stubGlobal('fetch', f);
    vi.stubGlobal('prompt', vi.fn(() => '345000'));
    render(<BudgetTagihan />);

    fireEvent.click(await screen.findByText('Sudah bayar'));

    await waitFor(() => {
      const post = f.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'POST' && String(c[0]).includes('/bayar')
      );
      expect(post).toBeTruthy();
      expect(JSON.parse((post![1] as RequestInit).body as string).jumlah).toBe(345_000);
    });
  });

  it('tidak mengirim apa pun kalau konfirmasi nominalnya dibatalkan', async () => {
    // Catatan kejujuran: uji ini tidak bisa membedakan "dijaga" dari "jatuh".
    // Tanpa penjaga `jawab === null`, kodenya melempar di `null.replace` dan
    // permintaannya juga tidak terkirim. Yang benar-benar menguji penjagaan
    // nominal adalah uji berikutnya, dengan isian kosong.
    const f = routeFetch(rute([tagihan()]));
    vi.stubGlobal('fetch', f);
    vi.stubGlobal('prompt', vi.fn(() => null));
    render(<BudgetTagihan />);

    fireEvent.click(await screen.findByText('Sudah bayar'));

    expect(f.mock.calls.filter((c) => String(c[0]).includes('/bayar'))).toHaveLength(0);
  });

  it('tidak mengirim nominal nol saat isiannya dikosongkan', async () => {
    // Isian dibersihkan lalu OK ditekan. Tanpa penjaga `dibayar < 1`, yang
    // terkirim adalah pembayaran nol rupiah — tercatat, mengunci periodenya
    // lewat indeks unik, dan tidak menggeser saldo sama sekali.
    const f = routeFetch(rute([tagihan()]));
    vi.stubGlobal('fetch', f);
    vi.stubGlobal('prompt', vi.fn(() => ''));
    render(<BudgetTagihan />);

    fireEvent.click(await screen.findByText('Sudah bayar'));

    await waitFor(() => {
      expect(f.mock.calls.filter((c) => String(c[0]).includes('/bayar'))).toHaveLength(0);
    });
  });

  it('menolak menyimpan tagihan tanpa nama, tanpa menghubungi server', async () => {
    const f = routeFetch(rute());
    vi.stubGlobal('fetch', f);
    render(<BudgetTagihan />);

    fireEvent.click(await screen.findByText(/Tambah tagihan terjadwal/));
    fireEvent.click(screen.getByText('Tambah tagihan'));

    expect(await screen.findByText('Isi nama tagihannya.')).toBeInTheDocument();
    expect(f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST'))
      .toHaveLength(0);
  });

  it('membiarkan formulir terbuka dengan isinya utuh saat penyimpanan gagal', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('offline');
      if (String(url).includes('/bank-accounts')) return json([{ id: 'rek-1', name: 'BCA', account_type: 'Bank' }]);
      if (String(url).includes('/proyeksi')) return json(PROYEKSI_AMAN);
      if (String(url).includes('/budget/categories')) return json(rute()['/budget/categories']);
      return json({ tagihan: [] });
    });
    vi.stubGlobal('fetch', f);
    render(<BudgetTagihan />);

    fireEvent.click(await screen.findByText(/Tambah tagihan terjadwal/));
    fireEvent.change(screen.getByPlaceholderText(/Nama \(misal/), { target: { value: 'Listrik' } });
    fireEvent.change(screen.getByPlaceholderText(/Perkiraan nominal/), { target: { value: '300000' } });
    fireEvent.click(screen.getByText('Tambah tagihan'));

    await waitFor(() => {
      expect(screen.getByText('Tambah tagihan')).toBeInTheDocument();
    });
    expect((screen.getByPlaceholderText(/Nama \(misal/) as HTMLInputElement).value).toBe('Listrik');
  });

  it('mengisi formulir dengan nilai tagihan yang sedang diubah', async () => {
    vi.stubGlobal('fetch', routeFetch(rute([tagihan()])));
    render(<BudgetTagihan />);

    fireEvent.click(await screen.findByText('Ubah'));

    expect((await screen.findByPlaceholderText(/Nama \(misal/) as HTMLInputElement).value)
      .toBe('Listrik PLN');
    // Tombolnya ikut berubah: menyimpan perubahan, bukan menambah yang baru.
    expect(screen.getByText('Simpan perubahan')).toBeInTheDocument();
  });

  it('menampilkan pemasukan terjadwal dengan penanda arah masuk', async () => {
    vi.stubGlobal('fetch', routeFetch(rute([
      tagihan({ id: 't2', nama: 'Gaji', jenis: 'income', kategori: 'Gaji' }),
    ])));
    render(<BudgetTagihan />);

    expect(await screen.findByText(/↓ Gaji/)).toBeInTheDocument();
  });
});
