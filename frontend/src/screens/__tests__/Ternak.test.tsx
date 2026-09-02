import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import TernakScreen from '../Ternak';

afterEach(() => {
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Jawab tiap endpoint berdasarkan potongan URL-nya — kunci lebih spesifik harus lebih dulu. */
function routeFetch(routes: Record<string, unknown | { status: number }>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return json({ error: 'not_found' }, 404);
    const v = routes[key];
    if (v && typeof v === 'object' && 'status' in v && typeof (v as { status: unknown }).status === 'number') {
      return json({ error: 'gagal' }, (v as { status: number }).status);
    }
    return json(v);
  });
}

const dataDasar = {
  today: '2026-06-01',
  kandang: [{
    id: 'k1', nama: 'Akuarium depan', jenis: 'akuarium', habitat: 'air-tawar',
    volumeLiter: 60, lokasi: null, tanggalMulai: '2026-01-01', status: 'aktif', jumlahPenghuni: 1,
  }],
  hewan: [{
    id: 'h1', kandangId: 'k1', animalId: 'cupang', nama: 'Cupang', emoji: '🐟',
    jumlah: 1, status: 'hidup', tanggalMasuk: '2026-01-01', kesulitan: 'mudah',
    tugasKandangDorman: false, tugasKandangDormanPenting: false,
  }],
  ringkasan: { kandangAktif: 1, hewanHidup: 1, ekorTotal: 1 },
};

const jadwalKosong = { today: '2026-06-01', tugas: [], jatuhTempo: [], penting: [] };

const rutePenuh = {
  '/ternak/kepadatan': { kepadatan: [] },
  '/ternak/karantina': { today: '2026-06-01', karantina: [] },
  '/ternak/air/': { air: [] },
  '/ternak/jadwal': jadwalKosong,
  '/ternak': dataDasar,
};

describe('Ternak — gagal muat peringatan tambahan', () => {
  it('tidak menunjukkan garis gagal ketika semua peringatan tambahan berhasil dimuat', async () => {
    vi.stubGlobal('fetch', routeFetch(rutePenuh));
    render(<TernakScreen />);

    // Tunggu layar selesai memuat sebelum menegaskan ketiadaan sesuatu.
    expect(await screen.findByText('Tidak ada jadwal rawat dalam 14 hari ke depan.')).toBeInTheDocument();
    expect(screen.queryByText(/Gagal memuat/)).not.toBeInTheDocument();
  });

  it('kepadatan dan tes amonia gagal dimuat tampil sebagai galat, bukan "tidak ada masalah"', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...rutePenuh,
      '/ternak/kepadatan': { status: 500 },
      '/ternak/air/': { status: 500 },
    }));
    render(<TernakScreen />);

    expect(await screen.findByText('Tidak ada jadwal rawat dalam 14 hari ke depan.')).toBeInTheDocument();
    const garis = await screen.findByText(/Gagal memuat/);
    expect(garis.textContent).toContain('kepadatan kandang');
    expect(garis.textContent).toContain('tes amonia');
    expect(garis.textContent).not.toContain('status karantina');
  });

  it('karantina gagal dimuat tampil sebagai galat sendiri', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...rutePenuh,
      '/ternak/karantina': { status: 500 },
    }));
    render(<TernakScreen />);

    expect(await screen.findByText('Tidak ada jadwal rawat dalam 14 hari ke depan.')).toBeInTheDocument();
    const garis = await screen.findByText(/Gagal memuat/);
    expect(garis.textContent).toContain('status karantina');
    expect(garis.textContent).not.toContain('kepadatan kandang');
  });
});

describe('Ternak — banner hewan tanpa kandang (C1)', () => {
  it('menampilkan banner kelima untuk hewan yang tugas kandang dormannya penting (mis. hamster)', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...rutePenuh,
      '/ternak': {
        ...dataDasar,
        hewan: [{
          ...dataDasar.hewan[0], nama: 'Hamster', kandangId: null,
          tugasKandangDorman: true, tugasKandangDormanPenting: true,
        }],
      },
    }));
    render(<TernakScreen />);

    expect(await screen.findByText(/belum punya kandang — tugasnya belum terjadwal/)).toBeInTheDocument();
    expect(screen.getByText(/Hamster/)).toBeInTheDocument();
  });

  it('tidak menampilkan banner kelima kalau tidak ada hewan yang dorman', async () => {
    vi.stubGlobal('fetch', routeFetch(rutePenuh));
    render(<TernakScreen />);

    expect(await screen.findByText('Tidak ada jadwal rawat dalam 14 hari ke depan.')).toBeInTheDocument();
    expect(screen.queryByText(/tugasnya belum terjadwal/)).not.toBeInTheDocument();
  });

  it('tidak menampilkan banner kelima untuk hewan yang dorman tapi tugasnya tidak penting (mis. kucing)', async () => {
    // kucing-domestik: satu-satunya tugas kandangnya adalah litter, penting:
    // false — dorman secara luas, tapi bukan ancaman nyawa. Banner ini
    // khusus ancaman nyawa, jadi kucing seperti ini tidak boleh muncul di
    // sini walau tugasKandangDorman (populasi luas) tetap true.
    vi.stubGlobal('fetch', routeFetch({
      ...rutePenuh,
      '/ternak': {
        ...dataDasar,
        hewan: [{
          ...dataDasar.hewan[0], nama: 'Mimi', kandangId: null,
          tugasKandangDorman: true, tugasKandangDormanPenting: false,
        }],
      },
    }));
    render(<TernakScreen />);

    expect(await screen.findByText('Tidak ada jadwal rawat dalam 14 hari ke depan.')).toBeInTheDocument();
    expect(screen.queryByText(/tugasnya belum terjadwal/)).not.toBeInTheDocument();
  });
});

describe('Ternak — banner penting telat menyebut sisa (T9-minor)', () => {
  it('menyebut jumlah sisa ketika lebih dari lima tugas penting telat', async () => {
    const banyakPenting = Array.from({ length: 7 }, (_, i) => ({
      subjekTipe: 'hewan' as const, subjekId: `h${i}`, nama: `Hewan ${i}`,
      kodeTugas: 'vaksin', labelTugas: 'Vaksin', cara: 'x', penting: true,
      berikutnya: '2026-05-01', telat: 10 + i, sumberInterval: 'katalog' as const,
    }));
    vi.stubGlobal('fetch', routeFetch({
      ...rutePenuh,
      '/ternak/jadwal': { today: '2026-06-01', tugas: banyakPenting, jatuhTempo: banyakPenting, penting: banyakPenting },
    }));
    render(<TernakScreen />);

    expect(await screen.findByText('+2 lainnya')).toBeInTheDocument();
  });
});

describe('Ternak — refresh gagal sesudah muat pertama berhasil', () => {
  it('menandai data yang tampil sebagai data lama, bukan diam-diam menyajikannya sebagai terbaru', async () => {
    const fetchMock = routeFetch(rutePenuh);
    vi.stubGlobal('fetch', fetchMock);
    render(<TernakScreen />);
    expect(await screen.findByText('Tidak ada jadwal rawat dalam 14 hari ke depan.')).toBeInTheDocument();
    expect(screen.queryByText(/Gagal menyegarkan/)).not.toBeInTheDocument();

    // Refresh berikutnya gagal total. Layar tetap terisi data lama — itu
    // benar, tapi harus mengaku bahwa isinya lama.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await act(async () => {
      window.dispatchEvent(new CustomEvent('fayolla:tab-shown', { detail: 'ternak' }));
    });

    expect(await screen.findByText(/Gagal menyegarkan/)).toBeInTheDocument();
    // Data lama tetap dirender, bukan diganti layar kosong.
    expect(screen.getByText('Tidak ada jadwal rawat dalam 14 hari ke depan.')).toBeInTheDocument();
  });
});
