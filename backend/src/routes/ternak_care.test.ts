/**
 * Uji jadwal gabungan, log perawatan, dan penyesuaian tugas.
 *
 * Yang paling penting di sini bukan bentuk JSON-nya, melainkan dua hal:
 * (1) tugas kandang muncul sekali per kandang, tidak sekali per penghuni —
 * itu inti seluruh desain dua lapis — dan (2) setiap kueri membawa user_id,
 * jadi jadwal, log, dan penyesuaian milik satu pengguna tidak pernah bocor
 * ke pengguna lain.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import ternak from './ternak';
import care from './ternak_care';
import { Hono } from 'hono';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';
import { jakartaToday } from '../lib/validate';

const JWT_SECRET = 'rahasia-untuk-test';
let db: FakeD1;
let app: Hono<never>;
let token: string;
let otherToken: string;

async function mint(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJWT({ sub, name: 'Penguji', role: 'user', iat: now, exp: now + 3600 }, JWT_SECRET);
}

function req(path: string, init: RequestInit = {}, auth = token) {
  return app.request(
    `http://test${path}`,
    { ...init, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } },
    { DB: db, JWT_SECRET } as never
  );
}

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  seedUser(db, 'user-2');
  token = await mint('user-1');
  otherToken = await mint('user-2');
  app = new Hono() as Hono<never>;
  app.route('/api/ternak', ternak as never);
  app.route('/api/ternak', care as never);
});

afterEach(() => db.__close());

async function buatKandang(body: Record<string, unknown> = {}, auth = token) {
  const res = await req('/api/ternak/kandang', {
    method: 'POST',
    body: JSON.stringify({
      nama: 'Akuarium depan', jenis: 'akuarium', habitat: 'air-tawar',
      volumeLiter: 60, tanggalMulai: '2026-01-01', ...body,
    }),
  }, auth);
  return { res, id: res.status === 201 ? (await res.json() as { id: string }).id : '' };
}

async function buatHewan(body: Record<string, unknown> = {}, auth = token) {
  const res = await req('/api/ternak/hewan', {
    method: 'POST',
    body: JSON.stringify({ jumlah: 1, tanggalMasuk: '2026-01-01', ...body }),
  }, auth);
  return { res, id: res.status === 201 ? (await res.json() as { id: string }).id : '' };
}

interface TugasRow {
  kodeTugas: string;
  subjekTipe: string;
  subjekId: string;
  labelTugas: string;
  berikutnya: string;
  telat: number;
  sumberInterval: string;
  penting: boolean;
}

async function jadwal(auth = token): Promise<{ today: string; tugas: TugasRow[]; jatuhTempo: TugasRow[]; penting: TugasRow[] }> {
  return (await (await req('/api/ternak/jadwal', {}, auth)).json()) as never;
}

describe('GET /api/ternak/jadwal', () => {
  it('menggabungkan tugas kandang dan tugas hewan dalam satu daftar', async () => {
    // Kandang akuarium + satu kura-kura brazil di dalamnya. Spesies ini punya
    // tugas 'ganti-air' bersasaran kandang dan 'jemur' bersasaran hewan, jadi
    // hasilnya harus memuat sekurangnya satu tugas bersubjek kandang dan satu
    // bersubjek hewan.
    const { id: kandangId } = await buatKandang({ habitat: 'air-tawar' });
    const { id: hewanId } = await buatHewan({
      kandangId, animalId: 'kura-kura-brazil', namaPanggilan: 'Kura',
    });

    const body = await jadwal();
    const kandangTugas = body.tugas.filter((t) => t.subjekTipe === 'kandang' && t.subjekId === kandangId);
    const hewanTugas = body.tugas.filter((t) => t.subjekTipe === 'hewan' && t.subjekId === hewanId);
    expect(kandangTugas.length).toBeGreaterThan(0);
    expect(hewanTugas.length).toBeGreaterThan(0);
  });

  it('tugas kandang muncul sekali walau kandangnya berisi delapan ikan', async () => {
    // Inti seluruh desain dua lapis. Kalau tes ini gagal, penyaringan sasaran
    // di jadwalSubjek bocor dan satu pekerjaan ditagih delapan kali.
    const { id: kandangId } = await buatKandang({ habitat: 'air-tawar', volumeLiter: 60 });
    for (let i = 0; i < 8; i++) {
      await req('/api/ternak/hewan', {
        method: 'POST',
        body: JSON.stringify({
          kandangId, animalId: 'cupang', namaPanggilan: `Cupang ${i + 1}`,
          jumlah: 1, tanggalMasuk: '2026-01-01',
        }),
      });
    }

    const body = await (await req('/api/ternak/jadwal')).json() as {
      tugas: Array<{ kodeTugas: string; subjekTipe: string; subjekId: string }>;
    };
    const gantiAir = body.tugas.filter((t) => t.kodeTugas === 'ganti-air');
    expect(gantiAir).toHaveLength(1);
    expect(gantiAir[0].subjekTipe).toBe('kandang');
    expect(gantiAir[0].subjekId).toBe(kandangId);
  });

  it('hewan berstatus mati tidak menagih apa pun', async () => {
    const { id: hewanId } = await buatHewan({ animalId: 'cupang' });
    const patch = await req(`/api/ternak/hewan/${hewanId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'mati' }),
    });
    expect(patch.status).toBe(200);

    const body = await jadwal();
    expect(body.tugas.filter((t) => t.subjekId === hewanId)).toHaveLength(0);
  });

  it('kandang berstatus nonaktif tidak menagih apa pun', async () => {
    // cupang: kedua tugasnya bersasaran kandang, jadi kalau kandangnya
    // nonaktif seharusnya tidak ada tugas sama sekali untuk penghuni ini.
    const { id: kandangId } = await buatKandang();
    await buatHewan({ kandangId, animalId: 'cupang' });

    const patch = await req(`/api/ternak/kandang/${kandangId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'nonaktif' }),
    });
    expect(patch.status).toBe(200);

    const body = await jadwal();
    expect(body.tugas.filter((t) => t.subjekId === kandangId)).toHaveLength(0);
  });

  it('hewan di luar katalog tidak menagih apa pun', async () => {
    await buatHewan({ namaKustom: 'Burung hantu warisan' });
    const body = await jadwal();
    expect(body.tugas).toHaveLength(0);
  });

  it('jadwal pengguna lain tidak pernah bocor', async () => {
    await buatKandang({}, otherToken);
    await buatHewan({ animalId: 'cupang' }, otherToken);

    const body = await jadwal();
    expect(body.tugas).toHaveLength(0);
  });
});

describe('POST /api/ternak/log', () => {
  it('mencatat tugas selesai dan menggeser jatuh temponya', async () => {
    // Baca /jadwal, catat log untuk salah satu kodeTugas dengan tanggal hari
    // ini, baca ulang: `berikutnya` untuk tugas itu harus maju dan `telat`
    // kembali 0.
    const { id: kandangId } = await buatKandang();
    await buatHewan({ kandangId, animalId: 'cupang' });

    const sebelum = await jadwal();
    const tugasSebelum = sebelum.tugas.find((t) => t.subjekId === kandangId && t.kodeTugas === 'ganti-air');
    expect(tugasSebelum).toBeDefined();
    expect(tugasSebelum!.telat).toBeGreaterThan(0);

    const logRes = await req('/api/ternak/log', {
      method: 'POST',
      body: JSON.stringify({ subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air' }),
    });
    expect(logRes.status).toBe(201);

    const sesudah = await jadwal();
    const tugasSesudah = sesudah.tugas.find((t) => t.subjekId === kandangId && t.kodeTugas === 'ganti-air');
    expect(tugasSesudah).toBeDefined();
    expect(tugasSesudah!.telat).toBe(0);
    expect(tugasSesudah!.berikutnya > tugasSebelum!.berikutnya).toBe(true);
  });

  it('menolak subjek milik orang lain', async () => {
    const { id: kandangId } = await buatKandang({}, otherToken);
    const res = await req('/api/ternak/log', {
      method: 'POST',
      body: JSON.stringify({ subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air' }),
    });
    expect(res.status).toBe(404);
  });

  it('menolak subjekTipe di luar kandang|hewan', async () => {
    const { id: kandangId } = await buatKandang();
    const res = await req('/api/ternak/log', {
      method: 'POST',
      body: JSON.stringify({ subjekTipe: 'lemari', subjekId: kandangId, kodeTugas: 'ganti-air' }),
    });
    expect(res.status).toBe(400);
  });

  it('menolak kodeTugas kosong', async () => {
    const { id: kandangId } = await buatKandang();
    const res = await req('/api/ternak/log', {
      method: 'POST',
      body: JSON.stringify({ subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('tanggal tidak valid jatuh ke hari ini, bukan ditolak', async () => {
    const { id: kandangId } = await buatKandang();
    const res = await req('/api/ternak/log', {
      method: 'POST',
      body: JSON.stringify({
        subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air', tanggal: 'bukan-tanggal',
      }),
    });
    expect(res.status).toBe(201);

    const riwayat = await (await req(`/api/ternak/log/kandang/${kandangId}`)).json() as {
      log: Array<{ tanggal: string }>;
    };
    expect(riwayat.log[0].tanggal).toBe(jakartaToday());
  });
});

describe('GET /api/ternak/log/:subjekTipe/:subjekId', () => {
  it('mengembalikan riwayat terbaru lebih dulu', async () => {
    const { id: kandangId } = await buatKandang();
    await req('/api/ternak/log', {
      method: 'POST',
      body: JSON.stringify({
        subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air', tanggal: '2026-01-05',
      }),
    });
    await req('/api/ternak/log', {
      method: 'POST',
      body: JSON.stringify({
        subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air', tanggal: '2026-03-20',
      }),
    });
    await req('/api/ternak/log', {
      method: 'POST',
      body: JSON.stringify({
        subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air', tanggal: '2026-02-10',
      }),
    });

    const riwayat = await (await req(`/api/ternak/log/kandang/${kandangId}`)).json() as {
      log: Array<{ tanggal: string }>;
    };
    expect(riwayat.log.map((r) => r.tanggal)).toEqual(['2026-03-20', '2026-02-10', '2026-01-05']);
  });

  it('milik orang lain 404', async () => {
    const { id: kandangId } = await buatKandang({}, otherToken);
    const res = await req(`/api/ternak/log/kandang/${kandangId}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/ternak/tugas', () => {
  it('mengubah interval dan jadwalnya ikut berubah', async () => {
    const { id: kandangId } = await buatKandang();
    await buatHewan({ kandangId, animalId: 'cupang' });

    // Perlu satu log supaya `berikutnya` dihitung dari tiapHari, bukan dari
    // mulaiHari katalog yang tidak berubah oleh override interval.
    await req('/api/ternak/log', {
      method: 'POST',
      body: JSON.stringify({
        subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air', tanggal: '2026-06-01',
      }),
    });
    const sebelum = await jadwal();
    const tugasSebelum = sebelum.tugas.find((t) => t.subjekId === kandangId && t.kodeTugas === 'ganti-air')!;

    const patch = await req('/api/ternak/tugas', {
      method: 'PATCH',
      body: JSON.stringify({ subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air', tiapHari: 30 }),
    });
    expect(patch.status).toBe(200);

    const sesudah = await jadwal();
    const tugasSesudah = sesudah.tugas.find((t) => t.subjekId === kandangId && t.kodeTugas === 'ganti-air')!;
    expect(tugasSesudah.sumberInterval).toBe('ubahan');
    expect(tugasSesudah.berikutnya > tugasSebelum.berikutnya).toBe(true);
  });

  it('nonaktif menghilangkan tugas dari jadwal tapi lognya tetap terbaca', async () => {
    const { id: kandangId } = await buatKandang();
    await buatHewan({ kandangId, animalId: 'cupang' });
    await req('/api/ternak/log', {
      method: 'POST',
      body: JSON.stringify({
        subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air', tanggal: '2026-06-01',
      }),
    });

    const patch = await req('/api/ternak/tugas', {
      method: 'PATCH',
      body: JSON.stringify({ subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air', nonaktif: true }),
    });
    expect(patch.status).toBe(200);

    const body = await jadwal();
    expect(body.tugas.filter((t) => t.subjekId === kandangId && t.kodeTugas === 'ganti-air')).toHaveLength(0);

    const riwayat = await (await req(`/api/ternak/log/kandang/${kandangId}`)).json() as {
      log: Array<{ tanggal: string }>;
    };
    expect(riwayat.log).toHaveLength(1);
    expect(riwayat.log[0].tanggal).toBe('2026-06-01');
  });

  it('mengirim tiapHari null menghapus penyesuaian, kembali ke katalog', async () => {
    const { id: kandangId } = await buatKandang();
    await buatHewan({ kandangId, animalId: 'cupang' });

    await req('/api/ternak/tugas', {
      method: 'PATCH',
      body: JSON.stringify({ subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air', tiapHari: 30 }),
    });
    const setelahUbah = await jadwal();
    const tugasUbah = setelahUbah.tugas.find((t) => t.subjekId === kandangId && t.kodeTugas === 'ganti-air')!;
    expect(tugasUbah.sumberInterval).toBe('ubahan');

    const patch = await req('/api/ternak/tugas', {
      method: 'PATCH',
      body: JSON.stringify({ subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air', tiapHari: null }),
    });
    expect(patch.status).toBe(200);

    const setelahReset = await jadwal();
    const tugasReset = setelahReset.tugas.find((t) => t.subjekId === kandangId && t.kodeTugas === 'ganti-air')!;
    expect(tugasReset.sumberInterval).toBe('katalog');
  });

  it('subjek milik orang lain 404', async () => {
    const { id: kandangId } = await buatKandang({}, otherToken);
    const res = await req('/api/ternak/tugas', {
      method: 'PATCH',
      body: JSON.stringify({ subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air', tiapHari: 10 }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/ternak/tugas/custom', () => {
  it('tugas buatan sendiri masuk jadwal', async () => {
    const { id: kandangId } = await buatKandang();
    const res = await req('/api/ternak/tugas/custom', {
      method: 'POST',
      body: JSON.stringify({
        subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'sifon-khusus',
        nama: 'Sifon dasar khusus', tiapHari: 5, cara: 'Pakai selang kecil.',
      }),
    });
    expect(res.status).toBe(201);

    const body = await jadwal();
    const custom = body.tugas.find((t) => t.subjekId === kandangId && t.kodeTugas === 'sifon-khusus');
    expect(custom).toBeDefined();
    expect(custom!.labelTugas).toBe('Sifon dasar khusus');
    expect(custom!.sumberInterval).toBe('ubahan');
  });

  it('menolak tanpa nama atau tanpa interval', async () => {
    const { id: kandangId } = await buatKandang();

    const tanpaNama = await req('/api/ternak/tugas/custom', {
      method: 'POST',
      body: JSON.stringify({ subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'x', tiapHari: 5 }),
    });
    expect(tanpaNama.status).toBe(400);

    const tanpaInterval = await req('/api/ternak/tugas/custom', {
      method: 'POST',
      body: JSON.stringify({ subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'y', nama: 'Sesuatu' }),
    });
    expect(tanpaInterval.status).toBe(400);
  });

  it('menolak kode yang bentrok dengan kode katalog spesies itu', async () => {
    // Kalau dibiarkan bentrok, PATCH berikutnya akan mengubah dua hal
    // sekaligus tanpa pengguna tahu yang mana.
    const { id: kandangId } = await buatKandang();
    await buatHewan({ kandangId, animalId: 'cupang' });

    const res = await req('/api/ternak/tugas/custom', {
      method: 'POST',
      body: JSON.stringify({
        subjekTipe: 'kandang', subjekId: kandangId, kodeTugas: 'ganti-air',
        nama: 'Ganti air (dobel)', tiapHari: 5,
      }),
    });
    expect(res.status).toBe(400);
  });
});
