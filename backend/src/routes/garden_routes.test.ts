/**
 * Uji rute kebun sungguhan: SQL, kepemilikan, dan bentuk respons.
 *
 * Semua test lain di backend ini menguji logika murni, yang berarti lapisan
 * paling rawan justru yang paling tidak terjaga. Bug yang lolos belakangan ini
 * semuanya berbentuk sama: TypeScript senang, SQL-nya salah, dan hasilnya
 * bukan error melainkan data kosong yang terlihat wajar.
 *
 * Karena itu yang diperiksa di sini bukan "apakah fungsi mengembalikan angka
 * benar" — itu sudah ada tempatnya — melainkan:
 *   1. Setiap kueri benar-benar jalan di skema produksi.
 *   2. Data pengguna lain tidak pernah ikut terbawa.
 *   3. Kolom yang dipakai memang ada namanya.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import garden from './garden';
import gardenExtra from './garden_extra';
import exportRoute from './export';
import { Hono } from 'hono';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';

const JWT_SECRET = 'rahasia-untuk-test';

let db: FakeD1;
let app: Hono<never>;
let token: string;
let otherToken: string;

/** Env tiruan; AI sengaja gagal supaya rute non-AI tidak diam-diam memanggilnya. */
function makeEnv() {
  return {
    DB: db,
    JWT_SECRET,
    AI: { run: async () => { throw new Error('AI tidak dipakai di test ini'); } },
  } as unknown as Record<string, unknown>;
}

async function mint(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJWT({ sub, name: 'Penguji', role: 'user', iat: now, exp: now + 3600 }, JWT_SECRET);
}

function req(path: string, init: RequestInit = {}, auth = token) {
  return app.request(
    `http://test${path}`,
    { ...init, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } },
    makeEnv()
  );
}

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  seedUser(db, 'user-2');
  token = await mint('user-1');
  otherToken = await mint('user-2');

  // Urutan mount ditiru persis dari index.ts: gardenExtra lebih dulu, supaya
  // rute /:id milik garden.ts tidak menelan jalur literal seperti /sowings.
  app = new Hono() as Hono<never>;
  app.route('/api/garden', gardenExtra as never);
  app.route('/api/garden', garden as never);
  app.route('/api/export', exportRoute as never);
});

afterEach(() => db.__close());

/** Satu penanaman milik `userId`, mengembalikan id-nya. */
function seedPlanting(userId: string, id: string, plantId: string | null = 'bayam', planted = '2026-01-01') {
  db.prepare(
    `INSERT INTO garden_plantings (id, user_id, plant_id, custom_name, quantity, planted_date, status)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, 'tumbuh')`
  ).bind(id, userId, plantId, plantId ? null : 'Kemangi', planted).run();
  return id;
}

/** Satu baris stok benih milik `userId`. */
function seedStock(userId: string, id: string, quantity: number, unit: string) {
  db.prepare(
    `INSERT INTO garden_seeds (id, user_id, plant_id, name, quantity, unit)
     VALUES (?1, ?2, 'bayam', 'Benih bayam', ?3, ?4)`
  ).bind(id, userId, quantity, unit).run();
  return id;
}

async function seedQuantity(id: string): Promise<number | null> {
  const row = await db.prepare('SELECT quantity FROM garden_seeds WHERE id = ?1').bind(id)
    .first<{ quantity: number }>();
  return row ? row.quantity : null;
}

// ───────────────────────── AUTH ─────────────────────────

describe('penjagaan auth', () => {
  it('menolak permintaan tanpa token', async () => {
    const res = await app.request('http://test/api/garden', {}, makeEnv());
    expect(res.status).toBe(401);
  });

  it('menolak token yang ditandatangani rahasia lain', async () => {
    const palsu = await signJWT(
      { sub: 'user-1', name: 'x', role: 'user', iat: 0, exp: 9999999999 },
      'rahasia-salah'
    );
    expect((await req('/api/garden', {}, palsu)).status).toBe(401);
  });
});

// ──────────────────── KEPEMILIKAN DATA ────────────────────

describe('pemisahan data antar pengguna', () => {
  it('tidak menampilkan tanaman milik orang lain', async () => {
    seedPlanting('user-2', 'milik-orang-lain');
    const res = await req('/api/garden');
    expect(res.status).toBe(200);
    const body = await res.json() as { plantings: unknown[] };
    expect(body.plantings).toHaveLength(0);
  });

  it('menolak mencatat perawatan pada tanaman orang lain', async () => {
    seedPlanting('user-2', 'bukan-punyaku');
    const res = await req('/api/garden/bukan-punyaku/care', {
      method: 'POST',
      body: JSON.stringify({ action: 'siram' }),
    });
    expect(res.status).toBe(404);

    // Yang penting bukan kode statusnya saja, tapi bahwa tidak ada baris
    // yang benar-benar tertulis ke kebun orang lain.
    const rows = await db.prepare('SELECT COUNT(*) AS n FROM garden_care_log').first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it('menolak menaruh tanaman orang lain ke denah sendiri', async () => {
    seedPlanting('user-2', 'tanaman-orang-lain');
    const bed = await req('/api/garden/beds', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bedeng A', widthCm: 100, lengthCm: 200 }),
    });
    const { id: bedId } = await bed.json() as { id: string };

    const res = await req(`/api/garden/beds/${bedId}/slots`, {
      method: 'PUT',
      body: JSON.stringify({ plantingId: 'tanaman-orang-lain', posX: 10, posY: 10 }),
    });
    expect(res.status).toBe(404);
  });
});

// ──────────── KUERI BERJALAN DI SKEMA SUNGGUHAN ────────────

describe('endpoint kebun berjalan di skema produksi', () => {
  // Inilah jaring yang selama ini tidak ada: nama kolom yang salah ketik akan
  // melempar "no such column" di sini, bukan mengembalikan data kosong yang
  // tampak wajar di layar pengguna.
  const endpoints = [
    '/api/garden',
    '/api/garden/schedule',
    '/api/garden/fertilize-plan',
    '/api/garden/sowings',
    '/api/garden/harvest-forecast',
    '/api/garden/supplies',
    '/api/garden/treatments',
    '/api/garden/beds',
    '/api/garden/kitchen',
    '/api/garden/annual-report',
    '/api/garden/calibration',
    '/api/garden/streak',
    '/api/garden/unit-cost',
    '/api/garden/next-season',
    '/api/garden/economics',
    '/api/garden/seeds',
    '/api/garden/pests',
    '/api/garden/succession',
    '/api/garden/yield-prediction',
    '/api/garden/failure-patterns',
    '/api/garden/rotation-check',
    '/api/garden/costs',
  ];

  it.each(endpoints)('%s menjawab tanpa error SQL saat kebun kosong', async (path) => {
    const res = await req(path);
    expect(res.status).toBeLessThan(500);
  });

  it.each(endpoints)('%s menjawab tanpa error SQL saat ada data', async (path) => {
    const id = seedPlanting('user-1', 'tanamanku');
    db.prepare(
      `INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date, amount, unit)
       VALUES ('log-1', 'user-1', ?1, 'panen', '2026-02-01', 2, 'kg')`
    ).bind(id).run();
    db.prepare(
      `INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date)
       VALUES ('log-2', 'user-1', ?1, 'siram', '2026-02-02')`
    ).bind(id).run();
    db.prepare(
      `INSERT INTO garden_costs (id, user_id, planting_id, kind, amount_idr, cost_date)
       VALUES ('cost-1', 'user-1', ?1, 'benih', 25000, '2026-01-01')`
    ).bind(id).run();
    db.prepare(
      `INSERT INTO garden_plant_price (user_id, plant_key, price_idr, unit)
       VALUES ('user-1', 'bayam', 20000, 'kg')`
    ).run();

    const res = await req(path);
    expect(res.status).toBeLessThan(500);
  });
});

// ───────────── HARGA: KUNCI YANG PERNAH SALAH ─────────────

describe('kunci harga tanaman', () => {
  it('menilai panen memakai plant_key, bukan kolom lain', async () => {
    // Bug yang pernah lolos: kueri membaca `plant_id` dari garden_plant_price,
    // padahal kolomnya bernama `plant_key`. Akibatnya bukan error, melainkan
    // panen yang selamanya dilaporkan tanpa harga.
    const id = seedPlanting('user-1', 'tanaman-harga');
    db.prepare(
      `INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date, amount, unit)
       VALUES ('h1', 'user-1', ?1, 'panen', ?2, 3, 'kg')`
    ).bind(id, `${new Date().toISOString().slice(0, 7)}-05`).run();
    db.prepare(
      `INSERT INTO garden_plant_price (user_id, plant_key, price_idr, unit)
       VALUES ('user-1', 'bayam', 10000, 'kg')`
    ).run();

    const body = await (await req('/api/garden/kitchen')).json() as { harvestValueIdr: number };
    expect(body.harvestValueIdr).toBe(30000);
  });

  it('memakai nama kustom sebagai kunci untuk tanaman di luar katalog', async () => {
    const id = seedPlanting('user-1', 'tanpa-katalog', null);
    db.prepare(
      `INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date, amount, unit)
       VALUES ('h2', 'user-1', ?1, 'panen', ?2, 2, 'ikat')`
    ).bind(id, `${new Date().toISOString().slice(0, 7)}-05`).run();
    db.prepare(
      `INSERT INTO garden_plant_price (user_id, plant_key, price_idr, unit)
       VALUES ('user-1', 'kemangi', 5000, 'ikat')`
    ).run();

    const body = await (await req('/api/garden/kitchen')).json() as { harvestValueIdr: number };
    expect(body.harvestValueIdr).toBe(10000);
  });
});

// ──────────────── EKSPOR: CAKUPAN DAN KEAMANAN ────────────────

describe('ekspor data', () => {
  it('menyertakan tabel kebun', async () => {
    seedPlanting('user-1', 'ikut-backup');
    const body = await (await req('/api/export')).json() as { data: Record<string, unknown[]> };

    expect(body.data.garden_plantings).toHaveLength(1);
    // Modul-modul yang dulu ikut hilang dari backup.
    for (const table of ['notes', 'calendar_events', 'user_settings', 'garden_sowings', 'garden_beds']) {
      expect(body.data[table], `${table} harus ikut diekspor`).toBeDefined();
    }
  });

  it('tidak pernah menyertakan kredensial', async () => {
    const body = await (await req('/api/export')).json() as { data: Record<string, unknown[]> };
    for (const table of ['refresh_tokens', 'push_subscriptions', 'shortcut_tokens']) {
      expect(body.data[table], `${table} tidak boleh ikut diekspor`).toBeUndefined();
    }
  });

  it('melewati foto kecuali diminta, dan mengaku melewatinya', async () => {
    const tanpa = await (await req('/api/export')).json() as { skipped_tables: string[]; data: Record<string, unknown[]> };
    expect(tanpa.skipped_tables).toContain('garden_photos');
    expect(tanpa.data.garden_photos).toBeUndefined();

    const dengan = await (await req('/api/export?photos=1')).json() as { data: Record<string, unknown[]> };
    expect(dengan.data.garden_photos).toBeDefined();
  });

  it('membawa isi habit stack, bukan hanya stack-nya', async () => {
    // Tabel anak tanpa user_id: sebelumnya stack ikut ter-backup sementara
    // isinya hilang tanpa satu pun pesan error.
    db.prepare(
      `INSERT INTO habits (id, user_id, name, created_at) VALUES ('h-1', 'user-1', 'Olahraga', 0)`
    ).run();
    db.prepare(
      `INSERT INTO habit_stacks (id, user_id, name, created_at) VALUES ('s-1', 'user-1', 'Rutinitas pagi', 0)`
    ).run();
    db.prepare(
      `INSERT INTO habit_stack_items (id, stack_id, habit_id, position, created_at)
       VALUES ('i-1', 's-1', 'h-1', 1, 0)`
    ).run();

    const body = await (await req('/api/export')).json() as { data: Record<string, unknown[]> };
    expect(body.data.habit_stack_items).toHaveLength(1);
  });

  it('menolak impor baris milik pengguna lain', async () => {
    const res = await req('/api/export', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          garden_plantings: [{
            id: 'selundupan', user_id: 'user-2', plant_id: 'bayam',
            quantity: 1, planted_date: '2026-01-01', status: 'tumbuh',
          }],
        },
      }),
    });
    expect(res.status).toBe(200);

    const row = await db.prepare("SELECT COUNT(*) AS n FROM garden_plantings WHERE id = 'selundupan'")
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('menolak baris anak yang induknya milik pengguna lain', async () => {
    db.prepare(
      `INSERT INTO habits (id, user_id, name, created_at) VALUES ('h-2', 'user-2', 'Lari', 0)`
    ).run();
    db.prepare(
      `INSERT INTO habit_stacks (id, user_id, name, created_at) VALUES ('s-2', 'user-2', 'Punya orang lain', 0)`
    ).run();

    await req('/api/export', {
      method: 'POST',
      body: JSON.stringify({
        data: { habit_stack_items: [{ id: 'i-9', stack_id: 's-2', habit_id: 'h-2', position: 1, created_at: 0 }] },
      }),
    });

    const row = await db.prepare("SELECT COUNT(*) AS n FROM habit_stack_items WHERE id = 'i-9'")
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

// ──────────────── ALUR TULIS: SEMAI DAN PERAWATAN ────────────────

describe('alur tulis', () => {
  it('mencatat perawatan lalu menampilkannya di riwayat', async () => {
    const id = seedPlanting('user-1', 'tanamanku');
    const post = await req(`/api/garden/${id}/care`, {
      method: 'POST',
      body: JSON.stringify({ action: 'siram' }),
    });
    // 201: mencatat perawatan memang membuat sumber daya baru.
    expect(post.status).toBe(201);

    // Endpoint riwayat mengembalikan array telanjang, bukan objek berpembungkus.
    const logs = await (await req(`/api/garden/${id}/care`)).json() as Array<{ action: string }>;
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('siram');
  });

  it('menolak jumlah benih nol saat mencatat semai', async () => {
    const res = await req('/api/garden/sowings', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bayam', seedCount: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it('menerima nol kecambah sebagai jawaban sah, bukan tidak ada data', async () => {
    const created = await req('/api/garden/sowings', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bayam', seedCount: 20 }),
    });
    const { id } = await created.json() as { id: string };

    const patch = await req(`/api/garden/sowings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ germinatedCount: 0 }),
    });
    expect(patch.status).toBe(200);

    const body = await (await req('/api/garden/sowings')).json() as {
      sowings: Array<{ germinatedCount: number | null }>;
      summary: { pendingCount: number };
    };
    expect(body.sowings[0].germinatedCount).toBe(0);
    // Gagal total tetap terhitung sudah dinilai — bukan menggantung.
    expect(body.summary.pendingCount).toBe(0);
  });

  it('mengurangi stok benih saat semai memakai benih dari laci', async () => {
    // Dua fitur yang jelas berpasangan: menyemai 20 butir harus terlihat di
    // laci, kalau tidak angka di layar berhenti berhubungan dengan isi laci.
    seedStock('user-1', 'benih-1', 100, 'butir');

    const res = await req('/api/garden/sowings', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bayam', seedCount: 20, seedId: 'benih-1' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ seedStockAdjusted: true });
    expect(await seedQuantity('benih-1')).toBe(80);
  });

  it('tidak pernah membuat stok benih minus', async () => {
    seedStock('user-1', 'benih-1', 5, 'butir');

    await req('/api/garden/sowings', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bayam', seedCount: 20, seedId: 'benih-1' }),
    });
    expect(await seedQuantity('benih-1')).toBe(0);
  });

  it('membiarkan stok bersatuan bukan butir', async () => {
    // Konversi bungkus-ke-butir tidak pernah benar, jadi tidak dikarang.
    seedStock('user-1', 'benih-1', 3, 'bungkus');

    const res = await req('/api/garden/sowings', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bayam', seedCount: 20, seedId: 'benih-1' }),
    });
    expect(await res.json()).toMatchObject({ seedStockAdjusted: false });
    expect(await seedQuantity('benih-1')).toBe(3);
  });

  it('tidak mengurangi stok benih milik pengguna lain', async () => {
    seedStock('user-2', 'benih-2', 100, 'butir');

    const res = await req('/api/garden/sowings', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bayam', seedCount: 20, seedId: 'benih-2' }),
    });
    expect(res.status).toBe(404);
    expect(await seedQuantity('benih-2')).toBe(100);
  });

  it('tidak mengurangi stok kalau catatan semainya gagal disimpan', async () => {
    // Stok berkurang tanpa catatan semai adalah benih yang hilang dari laci
    // menurut aplikasi tapi tidak pernah ditanam menurut catatan — dan tidak
    // ada layar yang bisa menjelaskan selisihnya.
    seedStock('user-1', 'benih-1', 100, 'butir');
    db.prepare('DROP TABLE garden_sowings').run();

    const res = await req('/api/garden/sowings', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bayam', seedCount: 20, seedId: 'benih-1' }),
    });
    expect(res.status).toBe(500);
    expect(await seedQuantity('benih-1')).toBe(100);
  });

  it('mengabaikan kiriman ulang dengan clientId sama', async () => {
    // Inti antrean offline: permintaan yang sudah sampai tapi jawabannya tidak
    // pernah diterima klien akan dikirim ulang. Tanpa idempotensi, itu jadi
    // catatan siram kedua di hari yang sama — dan streak ikut salah.
    const id = seedPlanting('user-1', 'tanamanku');
    const body = JSON.stringify({ action: 'siram', clientId: 'aaaabbbbccccdddd' });

    const first = await req(`/api/garden/${id}/care`, { method: 'POST', body });
    expect(first.status).toBe(201);

    const second = await req(`/api/garden/${id}/care`, { method: 'POST', body });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });

    const rows = await db.prepare('SELECT COUNT(*) AS n FROM garden_care_log').first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it('tidak menjalankan ulang efek samping panen saat kiriman diulang', async () => {
    // Panen menaikkan status dan menambah stok Inventaris. Keduanya tidak
    // boleh terjadi dua kali hanya karena jaringan sempat putus.
    const id = seedPlanting('user-1', 'tanamanku');
    const body = JSON.stringify({ action: 'panen', amount: 2, unit: 'kg', clientId: 'eeeeffff00001111' });

    await req(`/api/garden/${id}/care`, { method: 'POST', body });
    await req(`/api/garden/${id}/care`, { method: 'POST', body });

    const stok = await db.prepare('SELECT COUNT(*) AS n FROM inventory_items').first<{ n: number }>();
    expect(stok?.n).toBe(1);
  });

  it('mengabaikan clientId berformat aneh dan tetap membuat id sendiri', async () => {
    const id = seedPlanting('user-1', 'tanamanku');
    const res = await req(`/api/garden/${id}/care`, {
      method: 'POST',
      body: JSON.stringify({ action: 'siram', clientId: "'; DROP TABLE garden_care_log; --" }),
    });
    expect(res.status).toBe(201);

    const row = await db.prepare('SELECT id FROM garden_care_log').first<{ id: string }>();
    expect(row?.id).not.toContain('DROP');
  });

  it('menolak ukuran bedengan yang tidak masuk akal', async () => {
    const res = await req('/api/garden/beds', {
      method: 'POST',
      body: JSON.stringify({ name: 'Aneh', widthCm: 0, lengthCm: 200 }),
    });
    expect(res.status).toBe(400);
  });
});
