/**
 * Uji katalog hewan.
 *
 * Yang paling penting di sini bukan isinya (delapan spesies gelombang
 * pertama), melainkan bentuknya: daftar harus ringkas, bukan seluruh objek
 * `Animal` dengan `tugas[].cara` yang panjang-panjang, dan filter dengan
 * nilai yang tidak dikenal harus mengembalikan daftar kosong — bukan diam-diam
 * mengabaikan filternya dan mengembalikan semua.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import catalog from './ternak_catalog';
import { Hono } from 'hono';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';
import { ANIMALS, ANIMAL_BY_ID } from '../data/animals';

const JWT_SECRET = 'rahasia-untuk-test';
let db: FakeD1;
let app: Hono<never>;
let token: string;

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
  token = await mint('user-1');
  app = new Hono() as Hono<never>;
  app.route('/api/ternak', catalog as never);
});

afterEach(() => db.__close());

interface Ringkas {
  id: string; nama: string; emoji: string; grup: string; habitat: string;
  peran: string; kesulitan: string; jumlahTugas: number;
}

describe('GET /api/ternak/katalog', () => {
  it('membutuhkan otentikasi seperti seluruh API ini', async () => {
    const res = await app.request(
      'http://test/api/ternak/katalog', {}, { DB: db, JWT_SECRET } as never
    );
    expect(res.status).toBe(401);
  });

  it('mengembalikan seluruh entri dalam bentuk ringkas, bukan objek Animal penuh', async () => {
    const res = await req('/api/ternak/katalog');
    expect(res.status).toBe(200);
    const body = await res.json() as { hewan: Ringkas[] };
    expect(body.hewan).toHaveLength(ANIMALS.length);

    const kucing = body.hewan.find((h) => h.id === 'kucing-domestik')!;
    expect(kucing).toEqual({
      id: 'kucing-domestik',
      nama: 'Kucing domestik',
      emoji: '🐱',
      grup: 'mamalia',
      habitat: 'darat',
      peran: 'peliharaan',
      kesulitan: 'mudah',
      jumlahTugas: 6,
    });
    // Bentuk ringkas tidak pernah membawa tugas[].cara — itulah yang membuatnya ringkas.
    expect(kucing).not.toHaveProperty('tugas');
    expect(kucing).not.toHaveProperty('penyakit');
  });

  it('filter grup', async () => {
    // Bentuk katalognya sengaja bertambah dari waktu ke waktu (lihat
    // data/animals.ts) — tes ini menguji sifat filternya ("menyaring
    // grup ini, bukan grup lain"), bukan jumlah/id persis hasilnya, supaya
    // tidak ikut gagal tiap kali spesies baru ditambah.
    const res = await req('/api/ternak/katalog?grup=ikan-tawar');
    const body = await res.json() as { hewan: Ringkas[] };
    expect(body.hewan.length).toBeGreaterThan(0);
    expect(body.hewan.every((h) => h.grup === 'ikan-tawar')).toBe(true);
    const ids = body.hewan.map((h) => h.id);
    expect(ids).toContain('cupang');
    expect(ids).not.toContain('ayam-kampung'); // grup unggas, harus tersaring keluar
  });

  it('filter habitat', async () => {
    const res = await req('/api/ternak/katalog?habitat=air-laut');
    const body = await res.json() as { hewan: Ringkas[] };
    expect(body.hewan.length).toBeGreaterThan(0);
    expect(body.hewan.every((h) => h.habitat === 'air-laut')).toBe(true);
    const ids = body.hewan.map((h) => h.id);
    expect(ids).toContain('ikan-badut');
    expect(ids).not.toContain('kucing-domestik'); // habitat darat, harus tersaring keluar
  });

  it('filter peran', async () => {
    const res = await req('/api/ternak/katalog?peran=keduanya');
    const body = await res.json() as { hewan: Ringkas[] };
    expect(body.hewan.length).toBeGreaterThan(0);
    expect(body.hewan.every((h) => h.peran === 'keduanya')).toBe(true);
    const ids = body.hewan.map((h) => h.id);
    expect(ids).toContain('ayam-kampung');
    expect(ids).not.toContain('cupang'); // peran peliharaan, harus tersaring keluar
  });

  it('filter kesulitan', async () => {
    const res = await req('/api/ternak/katalog?kesulitan=sulit');
    const body = await res.json() as { hewan: Ringkas[] };
    expect(body.hewan.length).toBeGreaterThan(0);
    expect(body.hewan.every((h) => h.kesulitan === 'sulit')).toBe(true);
    const ids = body.hewan.map((h) => h.id);
    expect(ids).toContain('ikan-badut');
    expect(ids).not.toContain('kucing-domestik'); // kesulitan mudah, harus tersaring keluar
  });

  it('filter q cocok pada nama, tidak peka huruf besar-kecil', async () => {
    const res = await req('/api/ternak/katalog?q=KUCING');
    const body = await res.json() as { hewan: Ringkas[] };
    expect(body.hewan.map((h) => h.id)).toContain('kucing-domestik');
    // Tiap hasil harus benar-benar mengandung query di nama atau latinnya —
    // bukan cuma daftar tidak kosong, itu tidak membuktikan apa-apa soal
    // penyaringannya.
    for (const h of body.hewan) {
      const penuh = ANIMAL_BY_ID.get(h.id)!;
      const cocok = penuh.nama.toLowerCase().includes('kucing') || penuh.latin.toLowerCase().includes('kucing');
      expect(cocok, `${h.id} tidak benar-benar cocok query "kucing"`).toBe(true);
    }
  });

  it('filter q cocok pada latin, tidak peka huruf besar-kecil', async () => {
    const res = await req('/api/ternak/katalog?q=felis');
    const body = await res.json() as { hewan: Ringkas[] };
    expect(body.hewan.map((h) => h.id)).toContain('kucing-domestik');
    for (const h of body.hewan) {
      const penuh = ANIMAL_BY_ID.get(h.id)!;
      const cocok = penuh.nama.toLowerCase().includes('felis') || penuh.latin.toLowerCase().includes('felis');
      expect(cocok, `${h.id} tidak benar-benar cocok query "felis"`).toBe(true);
    }
  });

  it('filter dengan nilai yang tidak dikenal mengembalikan daftar kosong, bukan seluruh katalog', async () => {
    const res = await req('/api/ternak/katalog?grup=dinosaurus');
    expect(res.status).toBe(200);
    const body = await res.json() as { hewan: Ringkas[] };
    expect(body.hewan).toEqual([]);
  });

  it('q tanpa hasil juga mengembalikan daftar kosong', async () => {
    const res = await req('/api/ternak/katalog?q=zzz-tidak-ada');
    const body = await res.json() as { hewan: Ringkas[] };
    expect(body.hewan).toEqual([]);
  });
});

describe('GET /api/ternak/katalog/:animalId', () => {
  it('mengembalikan objek penuh beserta tugas', async () => {
    const res = await req('/api/ternak/katalog/kucing-domestik');
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; tugas: Array<{ kode: string; cara: string }> };
    expect(body.id).toBe('kucing-domestik');
    expect(body.tugas.length).toBeGreaterThan(0);
    expect(body.tugas[0].cara.length).toBeGreaterThan(0);
  });

  it('id yang tidak ada 404', async () => {
    const res = await req('/api/ternak/katalog/tidak-ada-spesies-ini');
    expect(res.status).toBe(404);
  });
});
