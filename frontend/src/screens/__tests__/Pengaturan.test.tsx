import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import PengaturanScreen from '../Pengaturan';

afterEach(() => {
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const schema = {
  groups: [
    { id: 'notifikasi', label: 'Notifikasi', icon: '🔔' },
    { id: 'uang', label: 'Uang', icon: '💰' },
  ],
  settings: [
    { key: 'notify.morning_brief', group: 'notifikasi', label: 'Pagi Ini', type: 'boolean', default: true },
    {
      key: 'notify.morning_brief.hour',
      group: 'notifikasi',
      label: 'Jam kirim Pagi Ini',
      type: 'hour',
      default: 6,
      min: 0,
      max: 23,
    },
    {
      key: 'money.bill_horizon_days',
      group: 'uang',
      label: 'Radar tagihan',
      hint: 'Berapa hari sebelum jatuh tempo mulai diingatkan.',
      type: 'number',
      default: 3,
      min: 1,
      max: 30,
      unit: 'hari',
    },
  ],
  values: {
    'notify.morning_brief': true,
    'notify.morning_brief.hour': 6,
    'money.bill_horizon_days': 3,
  },
};

const emptyDb = { tables: [], empty: [], photoBytes: 0, purgeable: [] };

function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    return key ? json(routes[key]) : json({ error: 'not_found' }, 404);
  });
}

/** Urutan pencocokan penting: '/settings/database' sebelum '/settings'. */
const defaultRoutes = { '/settings/database': emptyDb, '/settings': schema };

describe('Pengaturan', () => {
  it('merender kontrol dari skema backend, bukan daftar tetap', async () => {
    vi.stubGlobal('fetch', routeFetch(defaultRoutes));
    render(<PengaturanScreen />);

    expect(await screen.findByText(/Notifikasi/)).toBeInTheDocument();
    expect(screen.getByText('Pagi Ini')).toBeInTheDocument();
    expect(screen.getByText('Jam kirim Pagi Ini')).toBeInTheDocument();
  });

  it('menampilkan penjelasan pengaturan bila ada', async () => {
    vi.stubGlobal('fetch', routeFetch(defaultRoutes));
    render(<PengaturanScreen />);
    const user = userEvent.setup();

    await user.click(await screen.findByText(/💰 Uang/));
    expect(screen.getByText(/Berapa hari sebelum jatuh tempo/)).toBeInTheDocument();
  });

  it('tidak menampilkan tombol simpan sebelum ada yang diubah', async () => {
    vi.stubGlobal('fetch', routeFetch(defaultRoutes));
    render(<PengaturanScreen />);

    await screen.findByText('Pagi Ini');
    expect(screen.queryByText(/Simpan \d+ perubahan/)).not.toBeInTheDocument();
  });

  it('mengirim hanya yang berubah, bukan seluruh pengaturan', async () => {
    const fetchMock = routeFetch({
      ...defaultRoutes,
      '/settings': schema,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PengaturanScreen />);
    const user = userEvent.setup();

    const hourSelect = (await screen.findAllByRole('combobox'))[0];
    await user.selectOptions(hourSelect, '5');
    await user.click(screen.getByText(/Simpan 1 perubahan/));

    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(put).toBeDefined();
    // Mengirim semuanya akan menulis ulang baris yang tidak disentuh dan
    // membuat pengguna berhenti ikut perbaikan nilai bawaan.
    expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
      'notify.morning_brief.hour': 5,
    });
  });

  it('menyebut pengaturan mana yang ditolak beserta alasannya', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          return json({
            saved: [],
            rejected: [{ key: 'money.bill_horizon_days', reason: 'nilai tidak valid (harus 1–30)' }],
            values: schema.values,
          });
        }
        return String(url).includes('/settings/database') ? json(emptyDb) : json(schema);
      })
    );

    render(<PengaturanScreen />);
    const user = userEvent.setup();

    await user.click(await screen.findByText(/💰 Uang/));
    const input = screen.getByDisplayValue('3');
    await user.clear(input);
    await user.type(input, '99');
    await user.click(screen.getByText(/Simpan 1 perubahan/));

    // "Gagal menyimpan" saja tidak memberi tahu apa yang harus diperbaiki.
    expect(await screen.findByText(/Radar tagihan — nilai tidak valid/)).toBeInTheDocument();
  });

  it('menandai pengaturan yang bukan bawaan lagi', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/settings/database': emptyDb,
        '/settings': { ...schema, values: { ...schema.values, 'notify.morning_brief.hour': 5 } },
      })
    );

    render(<PengaturanScreen />);
    expect(await screen.findByText('diubah')).toBeInTheDocument();
    expect(screen.getByText(/1 diubah/)).toBeInTheDocument();
  });

  it('tetap membuka pengaturan walau statistik database gagal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/settings/database')
          ? json({ error: 'server_error' }, 500)
          : json(schema)
      )
    );

    render(<PengaturanScreen />);
    expect(await screen.findByText('Pagi Ini')).toBeInTheDocument();
    expect(screen.queryByText(/Data tersimpan/)).not.toBeInTheDocument();
  });

  it('menampilkan jumlah baris dan ukuran foto', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/settings/database': {
          tables: [{ table: 'habits', label: 'Kebiasaan', group: 'Kebiasaan', rows: 12 }],
          empty: [],
          photoBytes: 2_097_152,
          purgeable: [],
        },
        '/settings': schema,
      })
    );

    render(<PengaturanScreen />);

    expect(await screen.findByText(/Data tersimpan/)).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText(/2.0 MB/)).toBeInTheDocument();
  });

  it('menampilkan lokasi kebun dan membuka ulang pemilih lewat "Ubah"', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...defaultRoutes,
      '/garden/location': { latitude: -6.9175, longitude: 107.6191, label: 'Bandung' },
    }));

    render(<PengaturanScreen />);
    const user = userEvent.setup();

    expect(await screen.findByText('Bandung')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ubah' }));
    expect(screen.getByText('atau pilih kota terdekat')).toBeInTheDocument();
  });

  it('menghapus lokasi kebun setelah konfirmasi', async () => {
    const fetchMock = routeFetch({
      ...defaultRoutes,
      '/garden/location': { latitude: -6.9175, longitude: 107.6191, label: 'Bandung' },
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(<PengaturanScreen />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Hapus' }));

    const del = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'DELETE');
    expect(del).toBeDefined();
    // Lokasi hilang, jalan pilih ulang muncul lagi — bukan jalan buntu.
    expect(await screen.findByText('atau pilih kota terdekat')).toBeInTheDocument();
  });

  it('langsung menawarkan pemilih lokasi bila belum pernah diatur', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...defaultRoutes,
      '/garden/location': { latitude: null, longitude: null, label: null },
    }));

    render(<PengaturanScreen />);
    expect(await screen.findByText('atau pilih kota terdekat')).toBeInTheDocument();
  });
});
