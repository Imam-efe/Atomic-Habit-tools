/**
 * Uji ternak di dalam ringkasan harian.
 *
 * Sebelum ini, ternak — sama seperti kebun sebelumnya — tidak pernah muncul
 * di Pagi Ini maupun Tutup Hari. `getTernakToday` di sini memanggil
 * `jadwalPengguna`, bukan menghitung ulang sendiri: dua hitungan untuk
 * pertanyaan yang sama pasti menyimpang, dan ringkasan yang tidak cocok
 * dengan layar Ternak membuat keduanya diragukan.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import daily, { getTernakToday } from './daily';
import { Hono } from 'hono';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';

const JWT_SECRET = 'rahasia-untuk-test';
let db: FakeD1;
let app: Hono<never>;
let token: string;

async function mint(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJWT({ sub, name: 'Penguji', role: 'user', iat: now, exp: now + 3600 }, JWT_SECRET);
}

function req(path: string) {
  return app.request(
    `http://test${path}`,
    { headers: { Authorization: `Bearer ${token}` } },
    { DB: db, JWT_SECRET } as never
  );
}

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  token = await mint('user-1');
  app = new Hono() as Hono<never>;
  app.route('/api/daily', daily as never);
});

afterEach(() => db.__close());

function seedKandang(
  id: string,
  volumeLiter: number | null = null,
  habitat = 'air-tawar',
  status = 'aktif',
  tanggalMulai = '2026-01-01'
) {
  db.prepare(
    `INSERT INTO ternak_kandang (id, user_id, nama, jenis, habitat, volume_liter, tanggal_mulai, status)
     VALUES (?1, 'user-1', ?2, 'akuarium', ?3, ?4, ?5, ?6)`
  ).bind(id, `Kandang ${id}`, habitat, volumeLiter, tanggalMulai, status).run();
}

/** Ditanam jauh di masa lalu supaya semua tugas katalog pasti sudah jatuh tempo. */
function seedHewan(
  id: string,
  animalId: string | null,
  opts: { kandangId?: string | null; jumlah?: number; status?: string; tanggalMasuk?: string } = {}
) {
  const { kandangId = null, jumlah = 1, status = 'hidup', tanggalMasuk = '2026-01-01' } = opts;
  db.prepare(
    `INSERT INTO ternak_hewan (id, user_id, kandang_id, animal_id, jumlah, tanggal_masuk, status)
     VALUES (?1, 'user-1', ?2, ?3, ?4, ?5, ?6)`
  ).bind(id, kandangId, animalId, jumlah, tanggalMasuk, status).run();
}

describe('getTernakToday', () => {
  it('tanpa hewan menghasilkan nol, bukan melempar', async () => {
    const t = await getTernakToday(db as never, 'user-1', '2026-08-31');
    expect(t).toEqual({ tugasJatuhTempo: 0, penting: 0, kandangSesak: 0, contoh: [] });
  });

  it('menghitung tugas yang jatuh tempo', async () => {
    // kucing-domestik punya tugas hewan (vaksin, cacing, kutu, kuku, timbang)
    // dan tugas kandang (litter) — ditanam jauh di masa lalu supaya semuanya
    // jatuh tempo.
    seedHewan('h1', 'kucing-domestik');

    const t = await getTernakToday(db as never, 'user-1', '2026-08-31');
    expect(t.tugasJatuhTempo).toBeGreaterThan(0);
    expect(t.contoh.length).toBeGreaterThan(0);
  });

  it('memisahkan hitungan tugas penting', async () => {
    // vaksin dan cacing bertanda penting; kutu, kuku, timbang, litter tidak.
    seedHewan('h1', 'kucing-domestik');

    const t = await getTernakToday(db as never, 'user-1', '2026-08-31');
    expect(t.penting).toBeGreaterThan(0);
    expect(t.penting).toBeLessThan(t.tugasJatuhTempo);
  });

  it('menghitung kandang yang sesak', async () => {
    // cupang butuh 5 liter/ekor; 50 ekor di akuarium 10 liter jelas sesak.
    seedKandang('k1', 10);
    seedHewan('h1', 'cupang', { kandangId: 'k1', jumlah: 50 });

    const t = await getTernakToday(db as never, 'user-1', '2026-08-31');
    expect(t.kandangSesak).toBe(1);
  });

  it('hewan mati dan kandang nonaktif tidak ikut', async () => {
    seedHewan('h1', 'kucing-domestik', { status: 'mati' });
    seedKandang('k1', 5, 'air-tawar', 'nonaktif');
    seedHewan('h2', 'cupang', { kandangId: 'k1', jumlah: 50, status: 'hidup' });

    const t = await getTernakToday(db as never, 'user-1', '2026-08-31');
    expect(t).toEqual({ tugasJatuhTempo: 0, penting: 0, kandangSesak: 0, contoh: [] });
  });

  it('contoh dibatasi tiga nama supaya teksnya tidak meluber', async () => {
    for (let i = 1; i <= 6; i++) {
      seedHewan(`h${i}`, 'kucing-domestik');
    }

    const t = await getTernakToday(db as never, 'user-1', '2026-08-31');
    expect(t.contoh).toHaveLength(3);
  });
});

describe('ternak di endpoint harian', () => {
  it('/brief membawa kunci ternak', async () => {
    seedHewan('h1', 'kucing-domestik');
    const body = await (await req('/api/daily/brief')).json() as { ternak?: { tugasJatuhTempo: number } };
    expect(body.ternak).toBeDefined();
    expect(typeof body.ternak!.tugasJatuhTempo).toBe('number');
  });

  it('/shutdown membawa kunci ternak', async () => {
    seedHewan('h1', 'kucing-domestik');
    const body = await (await req('/api/daily/shutdown')).json() as { ternak?: { tugasJatuhTempo: number } };
    expect(body.ternak).toBeDefined();
  });
});
