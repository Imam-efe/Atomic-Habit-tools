/**
 * Uji rute kebun lanjutan (garden_extra2.ts): SQL sungguhan, kepemilikan,
 * dan bentuk respons — sama seperti garden_routes.test.ts, disiplin yang
 * sama karena rute baru ini sama rawannya: TypeScript senang, SQL salah.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import gardenExtra2 from './garden_extra2';
import { Hono } from 'hono';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';

const JWT_SECRET = 'rahasia-untuk-test';

let db: FakeD1;
let app: Hono<never>;
let token: string;
let otherToken: string;

function makeEnv() {
  return { DB: db, JWT_SECRET } as unknown as Record<string, unknown>;
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

  app = new Hono() as Hono<never>;
  app.route('/api/garden', gardenExtra2 as never);
});

afterEach(() => db.__close());

function seedPlanting(userId: string, id: string, status = 'tumbuh', plantId: string | null = 'bayam') {
  db.prepare(
    `INSERT INTO garden_plantings (id, user_id, plant_id, custom_name, quantity, planted_date, status)
     VALUES (?1, ?2, ?3, ?4, 1, '2026-01-01', ?5)`
  ).bind(id, userId, plantId, plantId ? null : 'Kemangi', status).run();
  return id;
}

// ───────────────────────── #1 KOMPOS ─────────────────────────

describe('kompos rumahan', () => {
  it('membuat batch lalu menampilkannya dengan estimasi siap', async () => {
    const create = await req('/api/garden/compost', {
      method: 'POST',
      body: JSON.stringify({ name: 'Kompos dapur', metode: 'cepat', startedDate: '2026-01-01' }),
    });
    expect(create.status).toBe(201);

    const list = await req('/api/garden/compost');
    const body = await list.json() as { batches: Array<{ name: string; metode: string; readyDateEstimasi: string; status: string }> };
    expect(body.batches).toHaveLength(1);
    expect(body.batches[0].name).toBe('Kompos dapur');
    expect(body.batches[0].metode).toBe('cepat');
    expect(body.batches[0].readyDateEstimasi).toBe('2026-01-22'); // +21 hari
    expect(body.batches[0].status).toBe('proses');
  });

  it('metode tak dikenal jatuh ke sedang, bukan error', async () => {
    await req('/api/garden/compost', {
      method: 'POST',
      body: JSON.stringify({ name: 'Batch aneh', metode: 'ngasal' }),
    });
    const list = await req('/api/garden/compost');
    const body = await list.json() as { batches: Array<{ metode: string }> };
    expect(body.batches[0].metode).toBe('sedang');
  });

  it('menolak tanpa nama', async () => {
    const res = await req('/api/garden/compost', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  it('PATCH ke siap hanya berhasil dari status proses', async () => {
    const create = await req('/api/garden/compost', { method: 'POST', body: JSON.stringify({ name: 'A' }) });
    const { id } = await create.json() as { id: string };

    const ok = await req(`/api/garden/compost/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'siap' }) });
    expect(ok.status).toBe(200);

    // sudah siap, tidak bisa "siap" lagi
    const again = await req(`/api/garden/compost/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'siap' }) });
    expect(again.status).toBe(404);
  });

  it('apply mencatat pemupukan dan mengunci batch jadi terpakai', async () => {
    const plantingId = seedPlanting('user-1', 'p-1');
    const create = await req('/api/garden/compost', { method: 'POST', body: JSON.stringify({ name: 'Kompos A' }) });
    const { id } = await create.json() as { id: string };

    const apply = await req(`/api/garden/compost/${id}/apply`, { method: 'POST', body: JSON.stringify({ plantingId }) });
    expect(apply.status).toBe(200);

    const care = await db.prepare(`SELECT action, note FROM garden_care_log WHERE planting_id = ?1`).bind(plantingId).first<{ action: string; note: string }>();
    expect(care?.action).toBe('pupuk');
    expect(care?.note).toContain('Kompos A');

    // batch terpakai tidak bisa diterapkan lagi
    const again = await req(`/api/garden/compost/${id}/apply`, { method: 'POST', body: JSON.stringify({ plantingId }) });
    expect(again.status).toBe(400);
  });

  it('apply menolak tanaman milik pengguna lain', async () => {
    const otherPlanting = seedPlanting('user-2', 'p-2');
    const create = await req('/api/garden/compost', { method: 'POST', body: JSON.stringify({ name: 'A' }) });
    const { id } = await create.json() as { id: string };

    const apply = await req(`/api/garden/compost/${id}/apply`, { method: 'POST', body: JSON.stringify({ plantingId: otherPlanting }) });
    expect(apply.status).toBe(404);
  });

  it('DELETE tidak menyentuh batch pengguna lain', async () => {
    const create = await req('/api/garden/compost', { method: 'POST', body: JSON.stringify({ name: 'Milik user-1' }) }, token);
    const { id } = await create.json() as { id: string };

    await req(`/api/garden/compost/${id}`, { method: 'DELETE' }, otherToken);
    const stillThere = await db.prepare('SELECT id FROM garden_compost_batches WHERE id = ?1').bind(id).first();
    expect(stillThere).toBeTruthy();

    await req(`/api/garden/compost/${id}`, { method: 'DELETE' }, token);
    const gone = await db.prepare('SELECT id FROM garden_compost_batches WHERE id = ?1').bind(id).first();
    expect(gone).toBeFalsy();
  });
});

// ───────────────────────── #2 SKOR KESULITAN ─────────────────────────

describe('skor kesulitan pribadi', () => {
  it('mengembalikan skor hanya untuk tanaman dengan cukup percobaan', async () => {
    seedPlanting('user-1', 'p-1', 'gagal', 'bayam');
    seedPlanting('user-1', 'p-2', 'gagal', 'bayam');
    seedPlanting('user-1', 'p-3', 'panen', 'cabai'); // cuma 1 percobaan, tidak cukup

    const res = await req('/api/garden/difficulty');
    const body = await res.json() as { scores: Array<{ plantId: string; name: string }> };
    expect(body.scores).toHaveLength(1);
    expect(body.scores[0].plantId).toBe('bayam');
    expect(body.scores[0].name).toBeTruthy();
  });

  it('mengabaikan data pengguna lain', async () => {
    seedPlanting('user-2', 'p-x', 'gagal', 'bayam');
    seedPlanting('user-2', 'p-y', 'gagal', 'bayam');

    const res = await req('/api/garden/difficulty', {}, token);
    const body = await res.json() as { scores: unknown[] };
    expect(body.scores).toHaveLength(0);
  });
});

// ───────────────────────── #3 SUSULAN → KALENDER ─────────────────────────

describe('susulan tanam ke kalender', () => {
  it('membuat tugas kalender dari label dan tanggal', async () => {
    const res = await req('/api/garden/succession/schedule', {
      method: 'POST',
      body: JSON.stringify({ label: 'Bayam', sowDate: '2026-03-01' }),
    });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };

    const row = await db.prepare('SELECT title, kind, event_date, user_id FROM calendar_events WHERE id = ?1').bind(id)
      .first<{ title: string; kind: string; event_date: string; user_id: string }>();
    expect(row?.title).toBe('Semai ulang: Bayam');
    expect(row?.kind).toBe('task');
    expect(row?.event_date).toBe('2026-03-01');
    expect(row?.user_id).toBe('user-1');
  });

  it('menolak sowDate yang tidak berformat YYYY-MM-DD', async () => {
    const res = await req('/api/garden/succession/schedule', {
      method: 'POST',
      body: JSON.stringify({ label: 'Bayam', sowDate: '01-03-2026' }),
    });
    expect(res.status).toBe(400);
  });

  it('menolak tanpa label', async () => {
    const res = await req('/api/garden/succession/schedule', {
      method: 'POST',
      body: JSON.stringify({ sowDate: '2026-03-01' }),
    });
    expect(res.status).toBe(400);
  });
});

// ───────────────────────── #4 WISHLIST ─────────────────────────

describe('wishlist tanaman musim depan', () => {
  it('menyimpan dari katalog maupun nama kustom', async () => {
    await req('/api/garden/wishlist', { method: 'POST', body: JSON.stringify({ plantId: 'bayam' }) });
    await req('/api/garden/wishlist', { method: 'POST', body: JSON.stringify({ customName: 'Tanaman Langka' }) });

    const list = await req('/api/garden/wishlist');
    const body = await list.json() as { items: Array<{ plantId: string | null; name: string }> };
    expect(body.items).toHaveLength(2);
    const custom = body.items.find((i) => i.plantId === null);
    expect(custom?.name).toBe('Tanaman Langka');
  });

  it('plantId palsu (bukan katalog) diperlakukan seperti nama kustom, bukan disimpan mentah', async () => {
    await req('/api/garden/wishlist', { method: 'POST', body: JSON.stringify({ plantId: 'tidak-ada-di-katalog', customName: 'Fallback' }) });
    const row = await db.prepare('SELECT plant_id, custom_name FROM garden_wishlist').first<{ plant_id: string | null; custom_name: string | null }>();
    expect(row?.plant_id).toBeNull();
    expect(row?.custom_name).toBe('Fallback');
  });

  it('menolak tanpa plantId maupun customName', async () => {
    const res = await req('/api/garden/wishlist', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  it('DELETE hanya menghapus milik sendiri', async () => {
    const create = await req('/api/garden/wishlist', { method: 'POST', body: JSON.stringify({ plantId: 'bayam' }) });
    const { id } = await create.json() as { id: string };

    await req(`/api/garden/wishlist/${id}`, { method: 'DELETE' }, otherToken);
    expect(await db.prepare('SELECT id FROM garden_wishlist WHERE id = ?1').bind(id).first()).toBeTruthy();

    await req(`/api/garden/wishlist/${id}`, { method: 'DELETE' }, token);
    expect(await db.prepare('SELECT id FROM garden_wishlist WHERE id = ?1').bind(id).first()).toBeFalsy();
  });
});

// ───────────────────────── #5 TREN TAHUN-KE-TAHUN ─────────────────────────

describe('dashboard tahun-ke-tahun', () => {
  it('kosong kalau belum ada data', async () => {
    const res = await req('/api/garden/yearly-trend');
    const body = await res.json() as { years: unknown[]; breakEvenYear: number | null };
    expect(body.years).toEqual([]);
    expect(body.breakEvenYear).toBeNull();
  });

  it('menghitung total per tahun dari panen dan biaya', async () => {
    const p1 = seedPlanting('user-1', 'p-1', 'panen', 'bayam');
    db.prepare(
      `INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date, amount, unit)
       VALUES ('log-1', 'user-1', ?1, 'panen', '2025-06-01', 2, 'kg')`
    ).bind(p1).run();
    db.prepare(
      `INSERT INTO garden_costs (id, user_id, planting_id, kind, amount_idr, cost_date)
       VALUES ('cost-1', 'user-1', ?1, 'benih', 10000, '2025-01-01')`
    ).bind(p1).run();
    db.prepare(
      `INSERT INTO garden_plant_price (user_id, plant_key, price_idr, unit) VALUES ('user-1', 'bayam', 15000, 'kg')`
    ).run();

    const res = await req('/api/garden/yearly-trend');
    const body = await res.json() as { years: Array<{ year: number; cost: number; value: number }>; breakEvenYear: number | null; cumulativeNet: number };
    expect(body.years).toHaveLength(1);
    expect(body.years[0].year).toBe(2025);
    expect(body.years[0].cost).toBe(10000);
    expect(body.years[0].value).toBe(30000); // 2kg * 15000
  });
});

// ───────────────────────── #7 PANEN VS TERBUANG ─────────────────────────

describe('panen vs terbuang', () => {
  it('menghitung status dari stok inventaris hasil panen', async () => {
    db.prepare(
      `INSERT INTO inventory_items (id, user_id, name, quantity, expiry_date) VALUES ('inv-1', 'user-1', 'Bayam', 0, NULL)`
    ).run();
    db.prepare(
      `INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status) VALUES ('p-1', 'user-1', 'bayam', 1, '2026-01-01', 'panen')`
    ).run();
    db.prepare(
      `INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date) VALUES ('log-1', 'user-1', 'p-1', 'panen', '2026-01-05')`
    ).run();
    db.prepare(
      `INSERT INTO garden_harvest_stock (care_log_id, user_id, inventory_item_id) VALUES ('log-1', 'user-1', 'inv-1')`
    ).run();

    const res = await req('/api/garden/waste-report');
    const body = await res.json() as { terpakai: number; terbuang: number; masihStok: number };
    expect(body.terpakai).toBe(1);
  });
});

// ───────────────────────── #8 SANITASI ─────────────────────────

describe('pengingat sterilisasi pot/alat', () => {
  it('mencatat pembersihan lalu bisa dibaca lagi', async () => {
    const res = await req('/api/garden/sanitation', { method: 'POST', body: JSON.stringify({ location: 'Rak A' }) });
    expect(res.status).toBe(201);

    const row = await db.prepare('SELECT location, cleaned_date FROM garden_sanitation_log WHERE user_id = ?1').bind('user-1')
      .first<{ location: string; cleaned_date: string }>();
    expect(row?.location).toBe('Rak A');
    expect(row?.cleaned_date).toBeTruthy();
  });

  it('menolak tanpa bedId maupun location', async () => {
    const res = await req('/api/garden/sanitation', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  it('GET tidak error walau belum ada riwayat', async () => {
    const res = await req('/api/garden/sanitation');
    expect(res.status).toBe(200);
    const body = await res.json() as { warnings: unknown[] };
    expect(Array.isArray(body.warnings)).toBe(true);
  });
});

// ───────────────────────── #9 AIR HUJAN ─────────────────────────

describe('tampungan air hujan', () => {
  it('mencatat entri dan meringkas', async () => {
    await req('/api/garden/rainwater', { method: 'POST', body: JSON.stringify({ date: '2026-01-01', litersCollected: 50 }) });
    await req('/api/garden/rainwater', { method: 'POST', body: JSON.stringify({ date: '2026-01-02', litersUsed: 20 }) });

    const res = await req('/api/garden/rainwater');
    const body = await res.json() as { log: unknown[]; ringkasan: { sisaTampungan: number } };
    expect(body.log).toHaveLength(2);
    expect(body.ringkasan.sisaTampungan).toBe(30);
  });

  it('menolak entri kosong', async () => {
    const res = await req('/api/garden/rainwater', { method: 'POST', body: JSON.stringify({ date: '2026-01-01' }) });
    expect(res.status).toBe(400);
  });

  it('tarif dipakai untuk menghitung penghematan setelah diatur', async () => {
    await req('/api/garden/rainwater/tarif', { method: 'PUT', body: JSON.stringify({ tarifRpPerLiter: 100 }) });
    await req('/api/garden/rainwater', { method: 'POST', body: JSON.stringify({ litersUsed: 10 }) });

    const res = await req('/api/garden/rainwater');
    const body = await res.json() as { ringkasan: { hematRupiah: number | null } };
    expect(body.ringkasan.hematRupiah).toBe(1000);
  });

  it('DELETE hanya menghapus entri milik sendiri', async () => {
    const create = await req('/api/garden/rainwater', { method: 'POST', body: JSON.stringify({ litersCollected: 5 }) });
    const { id } = await create.json() as { id: string };

    await req(`/api/garden/rainwater/${id}`, { method: 'DELETE' }, otherToken);
    expect(await db.prepare('SELECT id FROM garden_rainwater_log WHERE id = ?1').bind(id).first()).toBeTruthy();

    await req(`/api/garden/rainwater/${id}`, { method: 'DELETE' }, token);
    expect(await db.prepare('SELECT id FROM garden_rainwater_log WHERE id = ?1').bind(id).first()).toBeFalsy();
  });
});
