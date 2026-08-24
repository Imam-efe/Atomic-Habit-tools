import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { GardenPlanner, GardenRecords, type PlantingOption } from '../GardenExtras';

afterEach(() => {
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    return key ? json(routes[key]) : json({ error: 'not_found' }, 404);
  });
}

const plantings: PlantingOption[] = [
  { id: 'p1', label: 'Bedeng A', plantId: 'kangkung' },
  { id: 'p2', label: 'Cabai pot', plantId: 'cabai-rawit' },
];

const emptyPlannerRoutes = {
  '/garden/calendar': { month: 8, season: 'kemarau', windows: [] },
  '/garden/weather': { configured: false, message: 'Atur lokasi kebun dulu.' },
  '/garden/succession': { due: [] },
  '/garden/conflicts': { conflicts: [] },
  '/garden/pest-risk': { condition: null, reason: '', warnings: [] },
};

describe('GardenPlanner', () => {
  it('meminta lokasi saat cuaca belum diatur', async () => {
    vi.stubGlobal('fetch', routeFetch(emptyPlannerRoutes));
    render(<GardenPlanner plantings={plantings} />);

    expect(await screen.findByText('Atur lokasi kebun dulu.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pakai lokasi saya/i })).toBeInTheDocument();
    // Selalu ada jalan keluar tanpa GPS.
    expect(screen.getByText('atau pilih kota terdekat')).toBeInTheDocument();
  });

  it('membedakan GPS mati dari izin yang ditolak', async () => {
    vi.stubGlobal('fetch', routeFetch(emptyPlannerRoutes));
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_ok: unknown, fail: (e: GeolocationPositionError) => void) =>
          fail({ code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError),
      },
    });

    render(<GardenPlanner plantings={plantings} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Pakai lokasi saya/i }));

    // Melaporkan ini sebagai "izin ditolak" membuat pengguna sia-sia mencari
    // pengaturan izin yang sebetulnya sudah benar.
    expect(await screen.findByText(/mode pesawat/)).toBeInTheDocument();
    expect(screen.queryByText(/Izin lokasi ditolak/)).not.toBeInTheDocument();
  });

  it('menyebut izin ditolak hanya saat memang ditolak', async () => {
    vi.stubGlobal('fetch', routeFetch(emptyPlannerRoutes));
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_ok: unknown, fail: (e: GeolocationPositionError) => void) =>
          fail({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError),
      },
    });

    render(<GardenPlanner plantings={plantings} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Pakai lokasi saya/i }));

    expect(await screen.findByText(/Izin lokasi ditolak/)).toBeInTheDocument();
  });

  it('menyimpan lokasi dari kota pilihan tanpa GPS', async () => {
    const fetchMock = routeFetch({ ...emptyPlannerRoutes, '/garden/location': { latitude: -6.9175 } });
    vi.stubGlobal('fetch', fetchMock);

    render(<GardenPlanner plantings={plantings} />);
    const user = userEvent.setup();

    // Ada dua dropdown di tab ini; yang dicari adalah yang punya opsi kota.
    const citySelect = (await screen.findAllByRole('combobox')).find((el) =>
      el.textContent?.includes('Bandung')
    )!;
    await user.selectOptions(citySelect, 'Bandung');

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(post).toBeDefined();
    expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
      latitude: -6.9175,
      longitude: 107.6191,
      label: 'Bandung',
    });
  });

  it('mengatakan siram jalan seperti biasa saat cuaca tak bisa diambil', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyPlannerRoutes,
      '/garden/weather': {
        configured: true,
        available: false,
        message: 'Data cuaca belum bisa diambil. Pengingat siram tetap berjalan seperti biasa.',
      },
    }));

    render(<GardenPlanner plantings={plantings} />);
    // Tidak tahu cuaca tidak boleh terbaca sebagai "tidak perlu menyiram".
    expect(await screen.findByText(/tetap berjalan seperti biasa/)).toBeInTheDocument();
    expect(screen.queryByText(/Tidak perlu menyiram/)).not.toBeInTheDocument();
  });

  it('menampilkan curah hujan dan putusan melewati siram', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyPlannerRoutes,
      '/garden/weather': {
        configured: true,
        available: true,
        rain: { yesterday: 24, today: 2, tomorrow: 0 },
        skipWatering: true,
        reason: 'Kemarin hujan 24 mm — tanah masih jenuh, menyiram sekarang berisiko busuk akar.',
        note: null,
      },
    }));

    render(<GardenPlanner plantings={plantings} />);

    expect(await screen.findByText('✓ Tidak perlu menyiram hari ini')).toBeInTheDocument();
    expect(screen.getByText(/berisiko busuk akar/)).toBeInTheDocument();
    expect(screen.getByText('Kemarin 24 mm')).toBeInTheDocument();
  });

  it('menawarkan ubah lokasi begitu lokasi sudah diatur — dulu jalan buntu', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyPlannerRoutes,
      '/garden/weather': {
        configured: true,
        available: true,
        label: 'Bandung',
        rain: { yesterday: 0, today: 0, tomorrow: 0 },
        skipWatering: false,
        reason: null,
        note: null,
      },
    }));

    render(<GardenPlanner plantings={plantings} />);
    const user = userEvent.setup();

    expect(await screen.findByText('📍 Bandung')).toBeInTheDocument();
    // Bug yang diperbaiki: begitu lokasi tersimpan, dulu tidak ada jalan
    // untuk memilih lokasi lain lagi.
    expect(screen.queryByText('atau pilih kota terdekat')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ubah lokasi' }));
    expect(screen.getByText('atau pilih kota terdekat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pakai lokasi saya/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Batal' })).toBeInTheDocument();
  });

  it('tetap menawarkan ubah lokasi walau cuaca belum bisa diambil', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyPlannerRoutes,
      '/garden/weather': {
        configured: true,
        available: false,
        label: 'Bandung',
        message: 'Data cuaca belum bisa diambil. Pengingat siram tetap berjalan seperti biasa.',
      },
    }));

    render(<GardenPlanner plantings={plantings} />);
    expect(await screen.findByText(/tetap berjalan seperti biasa/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ubah lokasi' })).toBeInTheDocument();
  });

  it('menampilkan perkiraan kebutuhan air dari evapotranspirasi', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyPlannerRoutes,
      '/garden/weather': {
        configured: true,
        available: true,
        label: 'Bandung',
        rain: { yesterday: 0, today: 2, tomorrow: 0 },
        waterBalance: { et0Today: 5, rainToday: 2, recommendedMm: 3 },
        skipWatering: false,
        reason: null,
        note: null,
      },
    }));

    render(<GardenPlanner plantings={plantings} />);
    expect(await screen.findByText(/~3 mm/)).toBeInTheDocument();
  });

  it('tidak menampilkan kebutuhan air kalau hujan sudah mencukupi', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyPlannerRoutes,
      '/garden/weather': {
        configured: true,
        available: true,
        label: 'Bandung',
        rain: { yesterday: 0, today: 20, tomorrow: 0 },
        waterBalance: { et0Today: 4, rainToday: 20, recommendedMm: 0 },
        skipWatering: true,
        reason: 'Hari ini diperkirakan hujan 20 mm — cukup menggantikan siram.',
        note: null,
      },
    }));

    render(<GardenPlanner plantings={plantings} />);
    await screen.findByText('✓ Tidak perlu menyiram hari ini');
    expect(screen.queryByText(/kebutuhan air/)).not.toBeInTheDocument();
  });

  it('memperingatkan risiko hama musim lembap untuk tanaman relevan', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyPlannerRoutes,
      '/garden/pest-risk': {
        condition: 'lembap',
        reason: 'Curah hujan tinggi (35 mm dalam 3 hari) — kondisi lembap mendukung jamur, busuk, dan siput.',
        warnings: [{ plantingId: 'p1', label: 'Bedeng A', matchedPests: ['siput'] }],
      },
    }));

    render(<GardenPlanner plantings={plantings} />);
    expect(await screen.findByText('🍄 Waspada hama musim lembap')).toBeInTheDocument();
    expect(screen.getByText(/Bedeng A — cek siput/)).toBeInTheDocument();
  });

  it('diam soal risiko hama kalau tidak ada tanaman yang relevan', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyPlannerRoutes,
      '/garden/pest-risk': {
        condition: 'kering',
        reason: 'Tidak ada hujan sama sekali dalam 3 hari.',
        warnings: [],
      },
    }));

    render(<GardenPlanner plantings={plantings} />);
    await screen.findByText(/Bagus ditanam bulan ini/);
    expect(screen.queryByText(/Waspada hama/)).not.toBeInTheDocument();
  });

  it('mengecek kecocokan susun-tanam dari tanaman yang dipilih', async () => {
    const fetchMock = routeFetch({
      ...emptyPlannerRoutes,
      '/garden/layout': {
        totalAreaNeededM2: 0.72,
        fitsInBed: null,
        conflicts: [{ plantId: 'cabai-rawit', name: 'Cabai Rawit', withPlantId: 'kangkung', withName: 'Kangkung' }],
        goodPairs: [],
        isolate: ['cabai-rawit', 'kangkung'],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<GardenPlanner plantings={plantings} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Bedeng A' }));
    await user.click(screen.getByRole('button', { name: 'Cabai pot' }));
    await user.click(screen.getByRole('button', { name: 'Cek kecocokan' }));

    const post = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes('/garden/layout') && (init as RequestInit)?.method === 'POST'
    );
    expect(post).toBeDefined();
    expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
      candidates: [
        { plantId: 'kangkung', quantity: 1 },
        { plantId: 'cabai-rawit', quantity: 1 },
      ],
    });

    expect(await screen.findByText(/Cabai Rawit sebaiknya dipisah dari Kangkung/)).toBeInTheDocument();
  });

  it('tombol cek kecocokan nonaktif dengan kurang dari dua pilihan', async () => {
    vi.stubGlobal('fetch', routeFetch(emptyPlannerRoutes));
    render(<GardenPlanner plantings={plantings} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Bedeng A' }));
    expect(screen.getByRole('button', { name: 'Cek kecocokan' })).toBeDisabled();
  });

  it('menandai semai yang sudah terlewat', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyPlannerRoutes,
      '/garden/succession': {
        due: [{
          plantingId: 'p1', label: 'Bayam bedeng D', emoji: '🥬',
          harvestDate: '2026-09-04', sowDate: '2026-08-22', daysUntilSow: -2,
        }],
      },
    }));

    render(<GardenPlanner plantings={plantings} />);
    expect(await screen.findByText(/semai sudah lewat 2 hari/)).toBeInTheDocument();
  });

  it('menampilkan pasangan tanaman yang bertentangan', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyPlannerRoutes,
      '/garden/conflicts': { conflicts: [{ plantName: 'Tomat', withPlantName: 'Kentang' }] },
    }));

    render(<GardenPlanner plantings={plantings} />);
    expect(await screen.findByText('Tomat — Kentang')).toBeInTheDocument();
  });

  it('membedakan tanaman ideal musim ini dari yang bisa kapan saja', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyPlannerRoutes,
      '/garden/calendar': {
        month: 8, season: 'kemarau',
        windows: [
          { plantId: 'bayam', name: 'Bayam Hijau', emoji: '🥬', season: 'Kemarau', fit: 'ideal', daysToHarvest: [25, 30], difficulty: 'mudah' },
          { plantId: 'kangkung', name: 'Kangkung', emoji: '🥬', season: 'Sepanjang tahun', fit: 'bisa', daysToHarvest: [25, 30], difficulty: 'mudah' },
        ],
      },
    }));

    render(<GardenPlanner plantings={plantings} />);

    expect(await screen.findByText(/Bagus ditanam bulan ini/)).toBeInTheDocument();
    expect(screen.getByText(/bisa kapan saja/)).toBeInTheDocument();
  });

  it('tetap menampilkan kalender walau bagian lain gagal dimuat', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/garden/calendar')
        ? json({ month: 8, season: 'kemarau', windows: [] })
        : json({ error: 'server_error' }, 500)
    ));

    render(<GardenPlanner plantings={plantings} />);
    expect(await screen.findByText(/Bagus ditanam bulan ini/)).toBeInTheDocument();
  });
});

// Urutan pencocokan penting: '/garden/economics/yearly' sebelum
// '/garden/economics' — keduanya awalan yang sama, dan routeFetch mencocokkan
// dengan substring pertama yang cocok berurutan.
const emptyRecordRoutes = {
  '/garden/economics/yearly': { years: [], breakEvenYear: null, cumulativeNet: 0 },
  '/garden/economics': {
    perPlanting: [], totalCost: 0, totalValue: 0, totalNet: 0, sharedCost: 0, missingPrices: [],
  },
  '/garden/pests': { incidents: [], provenTreatments: [] },
  '/garden/seeds': { seeds: [] },
  '/garden/yield-prediction': { predictions: [] },
  '/garden/failure-patterns': { patterns: [] },
  '/garden/rotation-check': { warnings: [] },
};

describe('GardenRecords', () => {
  it('menampilkan untung bersih kebun', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyRecordRoutes,
      '/garden/economics': {
        perPlanting: [{
          plantingId: 'p1', label: 'Bedeng A', cost: 15_000, harvested: 6,
          unit: 'kg', value: 72_000, net: 57_000, unitMismatch: false,
        }],
        totalCost: 15_000, totalValue: 72_000, totalNet: 57_000, sharedCost: 0, missingPrices: [],
      },
    }));

    render(<GardenRecords plantings={plantings} />);
    expect(await screen.findByText('+Rp57.000')).toBeInTheDocument();
  });

  it('mengatakan panen tidak dihitung saat harga belum diisi', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyRecordRoutes,
      '/garden/economics': {
        perPlanting: [{
          plantingId: 'p2', label: 'Cabai pot', cost: 20_000, harvested: 1,
          unit: 'kg', value: null, net: null, unitMismatch: false,
        }],
        totalCost: 20_000, totalValue: 0, totalNet: -20_000, sharedCost: 0,
        missingPrices: ['cabai-rawit'],
      },
    }));

    render(<GardenRecords plantings={plantings} />);

    expect(await screen.findByText(/belum bisa dinilai/)).toBeInTheDocument();
    expect(screen.getByText(/supaya angkanya tidak menyesatkan/)).toBeInTheDocument();
  });

  it('menonjolkan tindakan hama yang terbukti berhasil', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyRecordRoutes,
      '/garden/pests': {
        incidents: [{
          id: 'h1', plantLabel: 'Bedeng A', pest: 'ulat grayak', severity: 'sedang',
          treatment: 'semprot neem', spottedDate: '2026-08-24', worked: true,
        }],
        provenTreatments: [{ pest: 'ulat grayak', treatment: 'semprot neem', times: 1 }],
      },
    }));

    render(<GardenRecords plantings={plantings} />);

    expect(await screen.findByText('Terbukti berhasil')).toBeInTheDocument();
    expect(screen.getByText('ulat grayak: semprot neem (1×)')).toBeInTheDocument();
  });

  it('menawarkan penilaian untuk hama yang belum dinilai', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyRecordRoutes,
      '/garden/pests': {
        incidents: [{
          id: 'h1', plantLabel: 'Bedeng A', pest: 'kutu daun', severity: 'ringan',
          treatment: null, spottedDate: '2026-08-24', worked: null,
        }],
        provenTreatments: [],
      },
    }));

    render(<GardenRecords plantings={plantings} />);

    expect(await screen.findByRole('button', { name: 'Berhasil' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gagal' })).toBeInTheDocument();
  });

  it('menandai benih kedaluwarsa tanpa menyembunyikannya', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyRecordRoutes,
      '/garden/seeds': {
        seeds: [{
          id: 's1', name: 'Benih Bayam lama', quantity: 1, unit: 'bungkus',
          expiry_date: '2026-07-01', daysLeft: -54, status: 'kedaluwarsa',
        }],
      },
    }));

    render(<GardenRecords plantings={plantings} />);

    expect(await screen.findByText('Benih Bayam lama')).toBeInTheDocument();
    expect(screen.getByText('Kedaluwarsa')).toBeInTheDocument();
    // Benih lewat tanggal masih bisa tumbuh — itu dijelaskan, bukan dibuang.
    expect(screen.getByText(/daya tumbuhnya turun/)).toBeInTheDocument();
  });

  it('menampilkan perkiraan panen dari riwayat sendiri', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyRecordRoutes,
      '/garden/yield-prediction': {
        predictions: [{
          plantingId: 'p2', name: 'Cabai pot', emoji: '🌶️',
          predictedAmount: 2.5, unit: 'kg', confidence: 'sedang', sampleSize: 4,
        }],
      },
    }));

    render(<GardenRecords plantings={plantings} />);

    // Judul kartu unik; "Cabai pot" sendiri juga muncul di opsi dropdown lain
    // di layar yang sama, jadi pencarian dipersempit ke dalam kartu ini saja.
    const heading = await screen.findByText('🔮 Perkiraan panen berikutnya');
    const card = within(heading.parentElement!);
    expect(card.getByText('🌶️ Cabai pot')).toBeInTheDocument();
    expect(card.getByText(/keyakinan sedang/)).toBeInTheDocument();
    expect(card.getByText(/4 panen tercatat/)).toBeInTheDocument();
  });

  it('menampilkan hipotesis pola gagal panen berulang', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyRecordRoutes,
      '/garden/failure-patterns': {
        patterns: [{
          plantId: 'cabai-rawit', label: 'Cabai Rawit', failureCount: 3,
          commonLocation: 'Bedeng A', commonMonth: null, pestShare: 0,
          hypotheses: ['Gagal 3 kali, hampir semuanya di lokasi "Bedeng A".'],
        }],
      },
    }));

    render(<GardenRecords plantings={plantings} />);

    const heading = await screen.findByText('🔍 Pola gagal panen');
    const card = within(heading.parentElement!);
    expect(card.getByText(/Cabai Rawit — gagal 3×/)).toBeInTheDocument();
    expect(card.getByText(/Bedeng A/)).toBeInTheDocument();
  });

  it('memperingatkan rotasi tanam famili sama di lokasi sama', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyRecordRoutes,
      '/garden/rotation-check': {
        warnings: [{
          plantingId: 'p2', label: 'Cabai', location: 'Bedeng A',
          familyLabel: 'terong-terongan', previousLabel: 'Tomat', previousPlantedDate: '2026-01-01',
          message: 'Cabai di lokasi "Bedeng A" satu famili (terong-terongan) dengan Tomat.',
        }],
      },
    }));

    render(<GardenRecords plantings={plantings} />);
    expect(await screen.findByText(/satu famili \(terong-terongan\) dengan Tomat/)).toBeInTheDocument();
  });

  it('tidak menampilkan kartu perkiraan panen tanpa riwayat', async () => {
    vi.stubGlobal('fetch', routeFetch(emptyRecordRoutes));
    render(<GardenRecords plantings={plantings} />);

    await screen.findByText('🧾 Catat biaya');
    expect(screen.queryByText(/Perkiraan panen berikutnya/)).not.toBeInTheDocument();
  });

  it('menampilkan status balik modal tahunan', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyRecordRoutes,
      '/garden/economics': {
        perPlanting: [], totalCost: 100_000, totalValue: 500_000, totalNet: 400_000, sharedCost: 0, missingPrices: [],
      },
      '/garden/economics/yearly': {
        years: [{ year: 2026, cost: 100_000, value: 500_000, net: 400_000, cumulativeNet: 400_000 }],
        breakEvenYear: 2026,
        cumulativeNet: 400_000,
      },
    }));

    render(<GardenRecords plantings={plantings} />);
    expect(await screen.findByText(/Sudah balik modal sejak 2026/)).toBeInTheDocument();
  });

  it('menampilkan belum balik modal dengan kumulatif negatif yang benar', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...emptyRecordRoutes,
      '/garden/economics': {
        perPlanting: [], totalCost: 500_000, totalValue: 100_000, totalNet: -400_000, sharedCost: 0, missingPrices: [],
      },
      '/garden/economics/yearly': {
        years: [{ year: 2026, cost: 500_000, value: 100_000, net: -400_000, cumulativeNet: -400_000 }],
        breakEvenYear: null,
        cumulativeNet: -400_000,
      },
    }));

    render(<GardenRecords plantings={plantings} />);
    expect(await screen.findByText(/Belum balik modal — kumulatif masih −Rp400\.000/)).toBeInTheDocument();
  });

  it('mengirim biaya umum tanpa penanaman tertentu', async () => {
    const fetchMock = routeFetch({ ...emptyRecordRoutes, '/garden/costs': { id: 'c1' } });
    vi.stubGlobal('fetch', fetchMock);

    render(<GardenRecords plantings={plantings} />);
    const user = userEvent.setup();

    await user.type(await screen.findByPlaceholderText('Rp'), '50000');
    await user.click(screen.getByRole('button', { name: /Simpan biaya/i }));

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(post).toBeDefined();
    expect(JSON.parse((post![1] as RequestInit).body as string)).toMatchObject({
      plantingId: null,
      kind: 'benih',
      amount: 50000,
    });
  });
});
