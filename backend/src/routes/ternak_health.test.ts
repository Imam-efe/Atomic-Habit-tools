/**
 * Uji ukur pertumbuhan, tes air, kepadatan kandang, dan karantina hewan baru.
 *
 * Empat kasus yang paling penting untuk dibuktikan benar, bukan cuma
 * dijalankan:
 *   1. Tes air pada kandang berhabitat darat ditolak dengan alasan yang
 *      disebutkan, bukan disimpan diam-diam sebagai baris yang tidak akan
 *      pernah dibaca.
 *   2. Riwayat air yang dibaca kembali membawa penilaiannya (dari `nilaiAir`),
 *      bukan cuma angka mentah — amonia 0,5 harus tampil berstatus `bahaya`.
 *   3. Akuarium 20 liter yang kelebihan penghuni ditandai sesak.
 *   4. Karantina hanya bicara soal hewan yang punya siapa pun untuk ditulari,
 *      dan hanya selama jendela 14 harinya belum lewat.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import ternak from './ternak';
import health from './ternak_health';
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
  app.route('/api/ternak', health as never);
  app.route('/api/ternak', ternak as never);
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

/** Geser tanggal YYYY-MM-DD sejumlah hari, di UTC — sama pola dengan lib/ternak_biosekuriti.ts. */
function geser(tanggal: string, hari: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

// ────────────────────────────── PERTUMBUHAN ──────────────────────────────

describe('POST /api/ternak/ukur/:hewanId', () => {
  it('menyimpan lalu GET membacanya kembali', async () => {
    const { id: hewanId } = await buatHewan({ animalId: 'kucing-domestik' });

    const post = await req(`/api/ternak/ukur/${hewanId}`, {
      method: 'POST',
      body: JSON.stringify({ tanggal: '2026-02-01', beratGram: 4200, panjangCm: 45, catatan: 'sehat' }),
    });
    expect(post.status).toBe(201);

    const get = await req(`/api/ternak/ukur/${hewanId}`);
    expect(get.status).toBe(200);
    const body = await get.json() as {
      ukur: Array<{ tanggal: string; beratGram: number | null; panjangCm: number | null; catatan: string | null }>;
    };
    expect(body.ukur).toHaveLength(1);
    expect(body.ukur[0]).toMatchObject({
      tanggal: '2026-02-01', beratGram: 4200, panjangCm: 45, catatan: 'sehat',
    });
  });

  it('hewan milik orang lain 404 pada POST maupun GET', async () => {
    const { id: hewanId } = await buatHewan({ animalId: 'kucing-domestik' }, otherToken);

    const post = await req(`/api/ternak/ukur/${hewanId}`, {
      method: 'POST', body: JSON.stringify({ beratGram: 100 }),
    });
    expect(post.status).toBe(404);

    const get = await req(`/api/ternak/ukur/${hewanId}`);
    expect(get.status).toBe(404);
  });

  it('menolak berat dan panjang yang dua-duanya kosong', async () => {
    const { id: hewanId } = await buatHewan({ animalId: 'kucing-domestik' });
    const res = await req(`/api/ternak/ukur/${hewanId}`, {
      method: 'POST', body: JSON.stringify({ catatan: 'cuma catatan, tanpa angka' }),
    });
    expect(res.status).toBe(400);
  });

  it('menolak berat <= 0', async () => {
    const { id: hewanId } = await buatHewan({ animalId: 'kucing-domestik' });
    const res = await req(`/api/ternak/ukur/${hewanId}`, {
      method: 'POST', body: JSON.stringify({ beratGram: 0 }),
    });
    expect(res.status).toBe(400);

    const negatif = await req(`/api/ternak/ukur/${hewanId}`, {
      method: 'POST', body: JSON.stringify({ beratGram: -5 }),
    });
    expect(negatif.status).toBe(400);
  });
});

// ──────────────────────────────── TES AIR ────────────────────────────────

describe('POST/GET /api/ternak/air/:kandangId', () => {
  it('menyimpan lalu GET mengembalikan riwayat beserta penilaiannya dari nilaiAir', async () => {
    const { id: kandangId } = await buatKandang({ habitat: 'air-tawar' });
    await buatHewan({ kandangId, animalId: 'koi' });

    const post = await req(`/api/ternak/air/${kandangId}`, {
      method: 'POST',
      body: JSON.stringify({ tanggal: '2026-02-01', suhuC: 24, ph: 7.5, amoniaPpm: 0, catatan: 'rutin' }),
    });
    expect(post.status).toBe(201);

    const get = await req(`/api/ternak/air/${kandangId}`);
    expect(get.status).toBe(200);
    const body = await get.json() as {
      air: Array<{
        tanggal: string; amoniaPpm: number | null;
        penilaian: Array<{ parameter: string; status: string; nilai: number }>;
      }>;
    };
    expect(body.air).toHaveLength(1);
    expect(body.air[0].tanggal).toBe('2026-02-01');
    // koi: phAir [7.0, 8.0] — 7.5 di dalam rentang, jadi aman. amonia 0 aman.
    // Tetap harus ADA penilaian, bukan cuma angka mentahnya.
    expect(body.air[0].penilaian.length).toBeGreaterThan(0);
    expect(body.air[0].penilaian.every((p) => p.status === 'aman')).toBe(true);
  });

  it('amonia 0.5 menghasilkan satu entri berstatus bahaya', async () => {
    const { id: kandangId } = await buatKandang({ habitat: 'air-tawar' });

    const post = await req(`/api/ternak/air/${kandangId}`, {
      method: 'POST',
      body: JSON.stringify({ amoniaPpm: 0.5 }),
    });
    expect(post.status).toBe(201);

    const get = await req(`/api/ternak/air/${kandangId}`);
    const body = await get.json() as {
      air: Array<{ penilaian: Array<{ parameter: string; status: string; nilai: number }> }>;
    };
    const amonia = body.air[0].penilaian.filter((p) => p.parameter === 'amonia');
    expect(amonia).toHaveLength(1);
    expect(amonia[0].status).toBe('bahaya');
    expect(amonia[0].nilai).toBe(0.5);
  });

  it('kandang milik orang lain 404', async () => {
    const { id: kandangId } = await buatKandang({}, otherToken);

    const post = await req(`/api/ternak/air/${kandangId}`, {
      method: 'POST', body: JSON.stringify({ amoniaPpm: 0.2 }),
    });
    expect(post.status).toBe(404);

    const get = await req(`/api/ternak/air/${kandangId}`);
    expect(get.status).toBe(404);
  });

  it('tes air pada kandang berhabitat darat ditolak 400 dengan alasan yang disebutkan', async () => {
    const { id: kandangId } = await buatKandang({ habitat: 'darat', jenis: 'kandang' });

    const res = await req(`/api/ternak/air/${kandangId}`, {
      method: 'POST', body: JSON.stringify({ amoniaPpm: 0.2 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/darat/);
    expect(body.error.length).toBeGreaterThan(10);
  });

  it('menolak bila tidak ada satu pun parameter diisi', async () => {
    const { id: kandangId } = await buatKandang({ habitat: 'air-tawar' });
    const res = await req(`/api/ternak/air/${kandangId}`, {
      method: 'POST', body: JSON.stringify({ catatan: 'lupa isi angkanya' }),
    });
    expect(res.status).toBe(400);
  });
});

// ────────────────────────────── KEPADATAN ──────────────────────────────

describe('GET /api/ternak/kepadatan', () => {
  it('menandai akuarium 20 liter yang kelebihan penghuni sebagai sesak', async () => {
    // Katalog gelombang pertama tidak memuat mas koki (delapan spesies
    // sampel), jadi angka "20 liter, sepuluh ekor" dari kasus wajib dipakai
    // dengan cupang (literPerEkor: 5) — sepuluh ekor butuh 50 liter, jauh
    // melebihi tangki 20 liter, persis skenario sesak yang dimaksud.
    const { id: kandangId } = await buatKandang({ habitat: 'air-tawar', volumeLiter: 20 });
    await buatHewan({ kandangId, animalId: 'cupang', jumlah: 10 });

    const res = await req('/api/ternak/kepadatan');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      kepadatan: Array<{ kandangId: string; volumeLiter: number; butuhLiter: number; sesak: boolean }>;
    };
    const entri = body.kepadatan.find((k) => k.kandangId === kandangId)!;
    expect(entri).toBeDefined();
    expect(entri.volumeLiter).toBe(20);
    expect(entri.butuhLiter).toBe(50);
    expect(entri.sesak).toBe(true);
  });

  it('kandang tanpa volume_liter tidak muncul sama sekali', async () => {
    const { id: kandangId } = await buatKandang({ volumeLiter: undefined });
    // volumeLiter undefined -> tidak dikirim -> kolom NULL di DB.
    await buatHewan({ kandangId, animalId: 'cupang' });

    const res = await req('/api/ternak/kepadatan');
    const body = await res.json() as { kepadatan: Array<{ kandangId: string }> };
    expect(body.kepadatan.find((k) => k.kandangId === kandangId)).toBeUndefined();
  });

  it('kandang orang lain tidak pernah muncul', async () => {
    const { id: kandangId } = await buatKandang({ habitat: 'air-tawar', volumeLiter: 20 }, otherToken);
    await buatHewan({ kandangId, animalId: 'cupang', jumlah: 10 }, otherToken);

    const res = await req('/api/ternak/kepadatan');
    const body = await res.json() as { kepadatan: Array<{ kandangId: string }> };
    expect(body.kepadatan.find((k) => k.kandangId === kandangId)).toBeUndefined();
  });
});

// ────────────────────────────── KARANTINA ──────────────────────────────

describe('GET /api/ternak/karantina', () => {
  it('menampilkan hewan yang masuk kurang dari 14 hari lalu dan sekandang dengan penghuni lain', async () => {
    const today = jakartaToday();
    const masukBaru = geser(today, -5); // 5 hari lalu, di dalam jendela 14 hari

    const { id: kandangId } = await buatKandang({ habitat: 'air-tawar' });
    const { id: hewanBaru } = await buatHewan({ kandangId, animalId: 'cupang', tanggalMasuk: masukBaru });
    // Teman sekandang, supaya hewanBaru tidak sendirian.
    await buatHewan({ kandangId, animalId: 'cupang', tanggalMasuk: today });

    const res = await req('/api/ternak/karantina');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      karantina: Array<{ hewanId: string; sisaHari: number; selesai: string }>;
    };
    const entri = body.karantina.find((k) => k.hewanId === hewanBaru);
    expect(entri).toBeDefined();
    expect(entri!.sisaHari).toBe(9); // selesai di hari ke-14 sejak masukBaru, 5 hari sudah lewat
  });

  it('hewan yang sendirian di kandangnya tidak muncul', async () => {
    const today = jakartaToday();
    const masukBaru = geser(today, -5);

    const { id: kandangId } = await buatKandang({ habitat: 'air-tawar' });
    const { id: hewanSendiri } = await buatHewan({ kandangId, animalId: 'cupang', tanggalMasuk: masukBaru });

    const res = await req('/api/ternak/karantina');
    const body = await res.json() as { karantina: Array<{ hewanId: string }> };
    expect(body.karantina.find((k) => k.hewanId === hewanSendiri)).toBeUndefined();
  });

  it('hewan yang sudah lewat 14 hari tidak muncul', async () => {
    const today = jakartaToday();
    const masukLama = geser(today, -20); // lebih dari 14 hari lalu

    const { id: kandangId } = await buatKandang({ habitat: 'air-tawar' });
    const { id: hewanLama } = await buatHewan({ kandangId, animalId: 'cupang', tanggalMasuk: masukLama });
    await buatHewan({ kandangId, animalId: 'cupang', tanggalMasuk: today });

    const res = await req('/api/ternak/karantina');
    const body = await res.json() as { karantina: Array<{ hewanId: string }> };
    expect(body.karantina.find((k) => k.hewanId === hewanLama)).toBeUndefined();
  });
});
