import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import HarianScreen from '../Harian';
import PolaScreen from '../Pola';
import TutupHariScreen from '../TutupHari';

afterEach(() => {
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Jawab tiap endpoint berdasarkan potongan URL-nya. */
function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    return key ? json(routes[key]) : json({ error: 'not_found' }, 404);
  });
}

const emptyBrief = {
  date: '2026-08-24',
  habits: { items: [], pending: 0, total: 0 },
  events: [],
  safeToSpend: {
    monthlyLimit: 0, spent: 0, upcomingBills: 0, remaining: 0,
    daysLeft: 8, perDay: 0, overBudget: false, spentToday: 0,
  },
  bills: { bills: [], total: 0, coveringAccount: null, totalBalance: 0 },
  missed: [],
  expiring: [],
  kids: [],
};

describe('Pagi Ini', () => {
  it('menampilkan jatah harian dan sisa hari', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/daily/brief': {
        ...emptyBrief,
        safeToSpend: {
          monthlyLimit: 3_000_000, spent: 1_050_000, upcomingBills: 400_000,
          remaining: 1_550_000, daysLeft: 8, perDay: 193_750, overBudget: false, spentToday: 150_000,
        },
      },
      '/daily/reschedule': { suggestions: [] },
    }));

    render(<HarianScreen />);

    expect(await screen.findByText('Rp193.750')).toBeInTheDocument();
    expect(screen.getByText(/Sisa Rp1.550.000 untuk 8 hari/)).toBeInTheDocument();
  });

  it('menandai kondisi jebol, bukan menampilkan jatah negatif', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/daily/brief': {
        ...emptyBrief,
        safeToSpend: {
          monthlyLimit: 1_000_000, spent: 900_000, upcomingBills: 300_000,
          remaining: -200_000, daysLeft: 8, perDay: 0, overBudget: true, spentToday: 0,
        },
      },
      '/daily/reschedule': { suggestions: [] },
    }));

    render(<HarianScreen />);

    expect(await screen.findByText('Lewat Rp200.000')).toBeInTheDocument();
    expect(screen.queryByText(/^Rp0$/)).not.toBeInTheDocument();
  });

  it('menawarkan versi 2 menit untuk kebiasaan yang terlewat', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/daily/brief': {
        ...emptyBrief,
        missed: [{ id: 'h1', name: 'Olahraga', streak: 12, twoMin: 'Pakai sepatu lari' }],
      },
      '/daily/reschedule': { suggestions: [] },
    }));

    render(<HarianScreen />);

    expect(await screen.findByText('🔁 Jangan bolos dua kali')).toBeInTheDocument();
    expect(screen.getByText('Versi 2 menit: Pakai sepatu lari')).toBeInTheDocument();
  });

  it('menyebut tagihan telat dan rekening yang menutupi', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/daily/brief': {
        ...emptyBrief,
        bills: {
          bills: [{ id: 'b1', personName: 'Budi', amount: 600_000, dueDate: '2026-08-23', daysUntil: -1 }],
          total: 600_000,
          coveringAccount: { id: 'a1', name: 'BCA', balance: 2_000_000 },
          totalBalance: 2_300_000,
        },
      },
      '/daily/reschedule': { suggestions: [] },
    }));

    render(<HarianScreen />);

    expect(await screen.findByText(/telat 1 hari/)).toBeInTheDocument();
    expect(screen.getByText('Saldo cukup di BCA.')).toBeInTheDocument();
  });

  it('mengatakan terus terang saat tak ada satu rekening pun yang cukup', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/daily/brief': {
        ...emptyBrief,
        bills: {
          bills: [{ id: 'b1', personName: 'Budi', amount: 600_000, dueDate: '2026-08-25', daysUntil: 1 }],
          total: 600_000, coveringAccount: null, totalBalance: 200_000,
        },
      },
      '/daily/reschedule': { suggestions: [] },
    }));

    render(<HarianScreen />);
    expect(await screen.findByText(/kurang Rp400.000/)).toBeInTheDocument();
  });

  it('menampilkan usulan geser jadwal saat bentrok', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/daily/brief': emptyBrief,
      '/daily/reschedule': {
        suggestions: [{
          habitId: 'h1', habitName: 'Olahraga', currentTime: '06:00',
          clashesWith: 'Antar sekolah', suggestedTime: '05:30', fallbackTwoMin: 'Pakai sepatu lari',
        }],
      },
    }));

    render(<HarianScreen />);
    expect(await screen.findByText(/bentrok dengan Antar sekolah/)).toBeInTheDocument();
    expect(screen.getByText('Coba geser ke 05:30.')).toBeInTheDocument();
  });

  it('tetap menampilkan ringkasan walau pengecekan bentrok gagal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/daily/reschedule')
        ? json({ error: 'server_error' }, 500)
        : json(emptyBrief)
    ));

    render(<HarianScreen />);
    // Bagian yang paling bisa dikorbankan tidak boleh menjatuhkan seluruh layar.
    expect(await screen.findByText('✅ Kebiasaan hari ini')).toBeInTheDocument();
  });
});

describe('Pola', () => {
  it('menampilkan pola beserta jumlah hari penopangnya', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/daily/patterns': {
        patterns: [{
          id: 'sleep',
          text: 'Kebiasaanmu 100% selesai saat tidur lebih lama, dibanding 0% saat tidur lebih pendek',
          support: { low: 6, high: 6 },
          gapPoints: 100,
        }],
        daysAnalysed: 13,
        skipped: [],
      },
    }));

    render(<PolaScreen />);

    expect(await screen.findByText(/saat tidur lebih lama/)).toBeInTheDocument();
    // Bobot buktinya harus terlihat, bukan cuma kesimpulannya.
    expect(screen.getByText(/6 hari rendah dan 6 hari tinggi/)).toBeInTheDocument();
  });

  it('mengakui datanya kurang alih-alih mengarang pola', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/daily/patterns': {
        patterns: [],
        daysAnalysed: 3,
        skipped: [{ id: 'sleep', reason: 'Butuh minimal 10 hari dengan data lengkap, baru ada 3.' }],
      },
    }));

    render(<PolaScreen />);

    expect(await screen.findByText('Belum ada pola yang cukup kuat')).toBeInTheDocument();
    expect(screen.getByText(/baru ada 3/)).toBeInTheDocument();
  });
});

describe('Tutup Hari', () => {
  it('mengirim jurnal, mood, dan prioritas', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? json({ date: '2026-08-24', done: true, topPriorities: ['Kirim laporan'] })
        : json({ date: '2026-08-24', done: false, journal: null, mood: null, topPriorities: [] })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<TutupHariScreen />);
    const user = userEvent.setup();

    await user.type(await screen.findByPlaceholderText(/Apa yang paling berkesan/), 'Hari padat');
    await user.click(screen.getByText('Baik'));
    await user.type(screen.getByPlaceholderText('Prioritas 1'), 'Kirim laporan');
    await user.click(screen.getByRole('button', { name: /Simpan & Tutup Hari/i }));

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(post).toBeDefined();
    const body = JSON.parse((post![1] as RequestInit).body as string);
    expect(body).toMatchObject({ journal: 'Hari padat', mood: 4, topPriorities: ['Kirim laporan'] });
  });

  it('memuat catatan yang sudah tersimpan', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/daily/shutdown': {
        date: '2026-08-24', done: true, journal: 'Catatan kemarin', mood: 5,
        topPriorities: ['Olahraga', 'Belanja'],
      },
    }));

    render(<TutupHariScreen />);

    expect(await screen.findByDisplayValue('Catatan kemarin')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Olahraga')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Perbarui Tutup Hari/i })).toBeInTheDocument();
  });
});
