/**
 * Uji agen dan modul Masakan terhadap skema sungguhan.
 *
 * Yang diperiksa di sini bukan kepintaran model — itu tidak bisa diuji dan
 * tidak stabil. Yang diuji adalah semua yang terjadi SETELAH model menjawab:
 * nama alat divalidasi, argumen ngawur ditolak, alat berisiko tidak pernah
 * jalan sendiri, data pengguna lain tidak tersentuh, dan barisnya benar-benar
 * masuk ke tabel yang benar.
 *
 * AI-nya distub dengan jawaban tetap, jadi rencana yang diuji adalah rencana
 * yang persis dikirim ke eksekutor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import agent from './agent';
import cooking from './cooking';
import search from './search';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';
import { parsePlan, MAX_ACTIONS } from '../lib/agent_plan';
import { TOOLS, toolsFor, planSchema, describeTools, cocokkanTanaman } from '../lib/agent_tools';
import { PLANT_BY_ID } from '../data/plants';
import { MODULES } from '../lib/ai_context';

const JWT_SECRET = 'rahasia-untuk-test';

let db: FakeD1;
let app: Hono<never>;
let token: string;
let otherToken: string;
/** Jawaban yang akan dipura-purakan model pada permintaan berikutnya. */
let aiReply: unknown;
let aiCalls: Array<{ model: string; input: Record<string, unknown> }>;

function makeEnv() {
  return {
    DB: db,
    JWT_SECRET,
    AI: {
      run: async (model: string, input: Record<string, unknown>) => {
        aiCalls.push({ model, input });
        if (aiReply instanceof Error) throw aiReply;
        return { response: aiReply };
      },
    },
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
  aiReply = { jawaban: 'oke' };
  aiCalls = [];

  app = new Hono() as Hono<never>;
  app.route('/api/agent', agent as never);
  app.route('/api/cooking', cooking as never);
  app.route('/api/search', search as never);
});

afterEach(() => db.__close());

async function count(table: string, userId = 'user-1'): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?1`)
    .bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

// ───────────────────────── registry alat ─────────────────────────

describe('registry alat', () => {
  it('tidak punya nama alat ganda', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('setiap alat memakai modul yang dikenal', () => {
    for (const t of TOOLS) expect(MODULES).toContain(t.module);
  });

  it('setiap argumen wajib benar-benar ada di skemanya', () => {
    // Wajib yang tidak terdaftar tidak akan pernah diisi model, dan alatnya
    // gagal setiap kali dipanggil.
    for (const t of TOOLS) {
      for (const key of t.required) expect(Object.keys(t.args)).toContain(key);
    }
  });

  it.each(TOOLS.map((t) => [t.name, t.table] as const))(
    '%s menulis ke tabel yang benar-benar ada: %s',
    async (_name, table) => {
      // Nama tabel disisipkan langsung ke SQL pembatalan. Ia berasal dari
      // daftar tertutup di registry, bukan dari masukan siapa pun — tapi
      // salah ketik di sini membuat pembatalan gagal, diam-diam, hanya untuk
      // alat itu saja.
      const rows = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      const cols = (rows.results ?? []).map((r) => r.name);
      expect(cols).toContain('id');
      expect(cols).toContain('user_id');
    }
  );

  it('hanya alat uang yang berisiko', () => {
    const berisiko = TOOLS.filter((t) => t.risk === 'konfirmasi').map((t) => t.name);
    expect(berisiko).toEqual(['uang.catat']);
  });

  it('membatasi alat sesuai layar', () => {
    const kebun = toolsFor('kebun').map((t) => t.name);
    expect(kebun).toContain('kebun.tanam');
    expect(kebun).not.toContain('uang.catat');
  });

  it('menawarkan semua alat kalau layarnya tidak disebut', () => {
    expect(toolsFor()).toHaveLength(TOOLS.length);
  });

  it.each(MODULES)('modul %s punya alatnya sendiri', (modul) => {
    // Modul tanpa alat akan jatuh ke daftar cadangan, dan panel di layar itu
    // menawarkan aksi yang tidak ada hubungannya dengan apa yang dilihat
    // pengguna.
    expect(TOOLS.some((t) => t.module === modul)).toBe(true);
  });

  it('cadangan untuk modul tanpa alat tidak pernah membawa alat berisiko', () => {
    // Kalau modul baru ditambahkan tanpa alat, layarnya tidak boleh
    // tiba-tiba bisa menulis ke buku kas.
    const cadangan = toolsFor('modul-baru' as never);
    expect(cadangan.every((t) => t.risk === 'aman')).toBe(true);
  });

  it('menuliskan setiap alat ke prompt beserta argumennya', () => {
    const teks = describeTools(toolsFor('kebun'));
    expect(teks).toContain('kebun.tanam');
    expect(teks).toContain('tanaman (wajib)');
  });

  it('skema hanya mengizinkan alat yang tersedia', () => {
    const schema = planSchema(toolsFor('kebun')) as {
      properties: { aksi: { items: { properties: { alat: { enum: string[] } } } } };
    };
    expect(schema.properties.aksi.items.properties.alat.enum).not.toContain('uang.catat');
  });
});

describe('cocokkanTanaman', () => {
  it('mengenali nama katalog apa adanya', () => {
    expect(cocokkanTanaman('Kangkung')).toBe('kangkung');
  });

  it('memilih varietas yang lebih spesifik saat katalog punya keduanya', () => {
    // Katalog memuat 'bayam' dan 'bayam-merah'. Menjatuhkan "bayam merah" ke
    // 'bayam' akan memberi jadwal panen varietas yang salah.
    expect(cocokkanTanaman('bayam merah')).toBe('bayam-merah');
  });

  it('mengenali nama yang lebih panjang dari katalog', () => {
    // Model menulis "cabai rawit merah"; katalog menyimpan "Cabai rawit".
    // Tanpa pencocokan longgar tanamannya masuk sebagai nama kustom dan
    // kehilangan jadwal siram serta perkiraan panen.
    expect(cocokkanTanaman('Cabai rawit')).not.toBeNull();
  });

  it('mengembalikan null untuk yang tidak ada di katalog', () => {
    expect(cocokkanTanaman('pohon uang')).toBeNull();
  });

  it('tidak menyeret nama katalog yang kebetulan jadi bagian kata lain', () => {
    // Katalog memuat 'bit' (umbi). Tanpa batas kata, "bibit cabai" cocok ke
    // Bit dan tanamannya memakai jadwal siram serta umur panen umbi-umbian.
    expect(cocokkanTanaman('bibit cabai')).not.toBe('bit');
  });
});

// ───────────────────────── parsePlan ─────────────────────────

describe('parsePlan', () => {
  const kebun = toolsFor('kebun');

  it('membaca jawaban dan aksi yang sah', () => {
    const plan = parsePlan(
      { jawaban: 'siap', aksi: [{ alat: 'kebun.tanam', argumen: { tanaman: ['Bayam'] } }] },
      kebun
    );
    expect(plan.jawaban).toBe('siap');
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].tool.name).toBe('kebun.tanam');
  });

  it('menolak alat di luar cakupan layar dan melaporkannya', () => {
    // Panel Kebun tidak boleh menulis ke buku kas hanya karena model
    // menyebut namanya.
    const plan = parsePlan(
      { jawaban: 'x', aksi: [{ alat: 'uang.catat', argumen: { jumlah: 50000 } }] },
      kebun
    );
    expect(plan.actions).toHaveLength(0);
    expect(plan.unknownTools).toEqual(['uang.catat']);
  });

  it('menolak alat yang tidak ada sama sekali', () => {
    const plan = parsePlan({ jawaban: 'x', aksi: [{ alat: 'hapus.semua', argumen: {} }] }, kebun);
    expect(plan.actions).toHaveLength(0);
    expect(plan.unknownTools).toEqual(['hapus.semua']);
  });

  it('membatasi jumlah aksi per permintaan', () => {
    const aksi = Array.from({ length: 20 }, () => ({ alat: 'kebun.tanam', argumen: { tanaman: ['Bayam'] } }));
    expect(parsePlan({ jawaban: 'x', aksi }, kebun).actions).toHaveLength(MAX_ACTIONS);
  });

  it('menggantikan argumen yang bukan objek dengan objek kosong', () => {
    const plan = parsePlan({ jawaban: 'x', aksi: [{ alat: 'kebun.tanam', argumen: 'bayam' }] }, kebun);
    expect(plan.actions[0].args).toEqual({});
  });

  it('mengembalikan rencana kosong untuk jawaban tak berbentuk', () => {
    for (const raw of [null, undefined, 'teks', 42, []]) {
      expect(parsePlan(raw, kebun).actions).toEqual([]);
    }
  });

  it('mengabaikan entri aksi yang rusak tanpa membuang yang sah', () => {
    const plan = parsePlan(
      { jawaban: 'x', aksi: [null, { alat: '' }, { alat: 'kebun.tanam', argumen: { tanaman: ['Bayam'] } }] },
      kebun
    );
    expect(plan.actions).toHaveLength(1);
  });
});

// ───────────────────────── rute agen ─────────────────────────

describe('POST /api/agent', () => {
  it('menolak tanpa token', async () => {
    const res = await app.request('http://test/api/agent', { method: 'POST', body: '{}' }, makeEnv());
    expect(res.status).toBe(401);
  });

  it('menolak pertanyaan kosong', async () => {
    const res = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: '  ' }) });
    expect(res.status).toBe(400);
  });

  it('menolak pertanyaan yang terlalu panjang', async () => {
    const res = await req('/api/agent', {
      method: 'POST',
      body: JSON.stringify({ message: 'a'.repeat(2001) }),
    });
    expect(res.status).toBe(400);
  });

  it('menjawab tanpa menulis apa pun saat pengguna hanya bertanya', async () => {
    aiReply = { jawaban: 'Kangkung kamu belum disiram dua hari.' };
    const res = await req('/api/agent', {
      method: 'POST',
      body: JSON.stringify({ message: 'kebunku gimana?', module: 'kebun' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ jawaban: 'Kangkung kamu belum disiram dua hari.', aksi: [] });
    expect(await count('garden_plantings')).toBe(0);
  });

  it('menjalankan alat aman dan benar-benar menulis barisnya', async () => {
    aiReply = {
      jawaban: 'Sudah saya buatkan.',
      aksi: [{ alat: 'kebun.tanam', argumen: { tanaman: ['Kangkung', 'Bayam', 'Cabai rawit'], lokasi: 'polybag' } }],
    };

    const res = await req('/api/agent', {
      method: 'POST',
      body: JSON.stringify({ message: 'buatkan daftar tanaman', module: 'kebun' }),
    });

    const body = await res.json() as { aksi: Array<{ status: string; ids?: string[] }> };
    expect(body.aksi[0].status).toBe('dijalankan');
    expect(body.aksi[0].ids).toHaveLength(3);
    expect(await count('garden_plantings')).toBe(3);
  });

  it('mengisi plant_id dari katalog supaya jadwal rawat ikut hidup', async () => {
    aiReply = { jawaban: 'ok', aksi: [{ alat: 'kebun.tanam', argumen: { tanaman: ['Kangkung'] } }] };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'tanam', module: 'kebun' }) });

    const row = await db.prepare(
      'SELECT plant_id, expected_harvest_date FROM garden_plantings WHERE user_id = ?1'
    ).bind('user-1').first<{ plant_id: string | null; expected_harvest_date: string | null }>();

    expect(row?.plant_id).toBe('kangkung');
    expect(row?.expected_harvest_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('memakai batas bawah rentang panen katalog, sama dengan rute manual', async () => {
    // Batas atas membuat penanda siap-panen dan push-nya telat sampai dua
    // bulan untuk tanaman yang dibuat AI.
    aiReply = {
      jawaban: 'ok',
      aksi: [{ alat: 'kebun.tanam', argumen: { tanaman: ['Kangkung'], tanggal: '2026-01-01' } }],
    };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'tanam', module: 'kebun' }) });

    const row = await db.prepare(
      'SELECT expected_harvest_date FROM garden_plantings WHERE user_id = ?1'
    ).bind('user-1').first<{ expected_harvest_date: string }>();

    const plant = PLANT_BY_ID.get('kangkung')!;
    const harap = new Date(Date.parse('2026-01-01T00:00:00Z') + plant.daysToHarvest[0] * 86400000)
      .toISOString().slice(0, 10);
    expect(row?.expected_harvest_date).toBe(harap);
  });

  it('panen lewat AI menaikkan status dan masuk Inventaris', async () => {
    // Panen lewat kalimat harus punya akibat yang sama persis dengan panen
    // lewat tombol; kalau tidak, HPP dan Selamatkan Bahan melewatkannya.
    await db.prepare(
      `INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status)
       VALUES ('p1', 'user-1', 'kangkung', 5, '2026-01-01', 'tumbuh')`
    ).run();

    aiReply = {
      jawaban: 'ok',
      aksi: [{ alat: 'kebun.rawat', argumen: { tanaman: 'kangkung', aksi: 'panen', jumlah: 2, satuan: 'kg' } }],
    };
    const res = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'panen', module: 'kebun' }) });

    const body = await res.json() as { aksi: Array<{ status: string; ringkasan: string }> };
    expect(body.aksi[0].status).toBe('dijalankan');
    expect(body.aksi[0].ringkasan).toContain('Inventaris');

    const planting = await db.prepare('SELECT status FROM garden_plantings WHERE id = ?1')
      .bind('p1').first<{ status: string }>();
    expect(planting?.status).toBe('panen');

    const stok = await db.prepare(
      'SELECT name, quantity, unit FROM inventory_items WHERE user_id = ?1'
    ).bind('user-1').first<{ name: string; quantity: number; unit: string }>();
    expect(stok).toMatchObject({ quantity: 2, unit: 'kg' });
  });

  it('panen tanpa jumlah tetap menaikkan status tanpa membuat stok karangan', async () => {
    await db.prepare(
      `INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status)
       VALUES ('p1', 'user-1', 'kangkung', 5, '2026-01-01', 'tumbuh')`
    ).run();

    aiReply = { jawaban: 'ok', aksi: [{ alat: 'kebun.rawat', argumen: { tanaman: 'kangkung', aksi: 'panen' } }] };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'panen', module: 'kebun' }) });

    const planting = await db.prepare('SELECT status FROM garden_plantings WHERE id = ?1')
      .bind('p1').first<{ status: string }>();
    expect(planting?.status).toBe('panen');
    expect(await count('inventory_items')).toBe(0);
  });

  it('tanaman yang sudah panen masih bisa dirawat', async () => {
    // Yang panennya berulang tetap disiram setelah panen pertama.
    await db.prepare(
      `INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status)
       VALUES ('p1', 'user-1', 'kangkung', 5, '2026-01-01', 'panen')`
    ).run();

    aiReply = { jawaban: 'ok', aksi: [{ alat: 'kebun.rawat', argumen: { tanaman: 'kangkung', aksi: 'siram' } }] };
    const res = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'siram', module: 'kebun' }) });

    const body = await res.json() as { aksi: Array<{ status: string }> };
    expect(body.aksi[0].status).toBe('dijalankan');
  });

  it('tugas yang dibuat AI memakai status yang sama dengan rute manual', async () => {
    aiReply = {
      jawaban: 'ok',
      aksi: [{ alat: 'proyek.tambah_tugas', argumen: { proyek: 'Renovasi', tugas: ['Ukur ruangan'] } }],
    };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'x', module: 'proyek' }) });

    const task = await db.prepare('SELECT status FROM tasks WHERE user_id = ?1').bind('user-1')
      .first<{ status: string }>();
    expect(task?.status).toBe('backlog');
  });

  it('tidak pernah menjalankan alat uang sendiri', async () => {
    // Angka pengeluaran yang salah ikut ke rekap bulanan dan proyeksi;
    // menghemat satu ketukan tidak sepadan.
    aiReply = {
      jawaban: 'Mau saya catat?',
      aksi: [{ alat: 'uang.catat', argumen: { jenis: 'expense', jumlah: 50000 } }],
    };

    const res = await req('/api/agent', {
      method: 'POST',
      body: JSON.stringify({ message: 'catat jajan 50rb', module: 'uang' }),
    });

    const body = await res.json() as { aksi: Array<{ status: string; argumen?: unknown }> };
    expect(body.aksi[0].status).toBe('perlu_konfirmasi');
    expect(body.aksi[0].argumen).toMatchObject({ jumlah: 50000 });
    expect(await count('budget_entries')).toBe(0);
  });

  it('melaporkan aksi yang gagal tanpa membatalkan yang berhasil', async () => {
    aiReply = {
      jawaban: 'ok',
      aksi: [
        { alat: 'kebun.tanam', argumen: { tanaman: ['Kangkung'] } },
        { alat: 'kebun.rawat', argumen: { tanaman: 'tanaman siluman', aksi: 'siram' } },
      ],
    };

    const res = await req('/api/agent', {
      method: 'POST',
      body: JSON.stringify({ message: 'tanam lalu siram', module: 'kebun' }),
    });

    const body = await res.json() as { aksi: Array<{ status: string; ringkasan: string }> };
    expect(body.aksi[0].status).toBe('dijalankan');
    expect(body.aksi[1].status).toBe('gagal');
    expect(body.aksi[1].ringkasan).toContain('tidak menemukan tanaman');
    // Yang berhasil tetap tersimpan.
    expect(await count('garden_plantings')).toBe(1);
  });

  it('menolak alat di luar modul layar dan melaporkannya', async () => {
    aiReply = { jawaban: 'ok', aksi: [{ alat: 'uang.catat', argumen: { jenis: 'expense', jumlah: 1000 } }] };

    const res = await req('/api/agent', {
      method: 'POST',
      body: JSON.stringify({ message: 'catat', module: 'kebun' }),
    });

    const body = await res.json() as { aksi: unknown[]; alatTidakDikenal: string[] };
    expect(body.aksi).toEqual([]);
    expect(body.alatTidakDikenal).toEqual(['uang.catat']);
    expect(await count('budget_entries')).toBe(0);
  });

  it('memasukkan data nyata pengguna ke prompt', async () => {
    // Inti dari "AI tidak menjawab generik": angka yang dikirim ke model
    // adalah angka pengguna, bukan contoh.
    await db.prepare(
      `INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status)
       VALUES ('p1', 'user-1', 'kangkung', 5, '2026-01-01', 'tumbuh')`
    ).run();

    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'apa kabar kebun', module: 'kebun' }) });

    const prompt = JSON.stringify(aiCalls[0].input);
    expect(prompt).toContain('kangkung');
    expect(prompt).toContain('1 tanaman sedang tumbuh');
  });

  it('tidak membocorkan data pengguna lain ke prompt', async () => {
    await db.prepare(
      `INSERT INTO garden_plantings (id, user_id, custom_name, quantity, planted_date, status)
       VALUES ('p2', 'user-2', 'RahasiaTetangga', 1, '2026-01-01', 'tumbuh')`
    ).run();

    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'kebunku', module: 'kebun' }) });
    expect(JSON.stringify(aiCalls[0].input)).not.toContain('RahasiaTetangga');
  });

  it('tidak menyentuh data pengguna lain saat merawat', async () => {
    await db.prepare(
      `INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status)
       VALUES ('milik-2', 'user-2', 'kangkung', 1, '2026-01-01', 'tumbuh')`
    ).run();

    aiReply = { jawaban: 'ok', aksi: [{ alat: 'kebun.rawat', argumen: { tanaman: 'kangkung', aksi: 'siram' } }] };
    const res = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'siram', module: 'kebun' }) });

    const body = await res.json() as { aksi: Array<{ status: string }> };
    expect(body.aksi[0].status).toBe('gagal');
    expect(await count('garden_care_log', 'user-2')).toBe(0);
  });

  it('membalas 503 saat AI tidak bisa dihubungi', async () => {
    aiReply = new Error('binding mati');
    const res = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'halo' }) });
    expect(res.status).toBe(503);
  });

  it('membalas 502 saat jawaban model tidak terbaca', async () => {
    aiReply = 'bukan json sama sekali';
    const res = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'halo' }) });
    expect(res.status).toBe(502);
  });

  it('memakai konteks lintas modul kalau layarnya tidak disebut', async () => {
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'ringkas hariku' }) });
    const prompt = JSON.stringify(aiCalls[0].input);
    expect(prompt).toContain('KEUANGAN');
    expect(prompt).toContain('KEBUN');
  });
});

describe('alat lintas modul', () => {
  it.each([
    ['kebiasaan.buat', 'kebiasaan', { kebiasaan: [{ nama: 'Baca 10 menit', pemicu: 'setelah sarapan' }] }, 'habits'],
    ['inventaris.tambah', 'inventaris', { barang: [{ nama: 'Telur', jumlah: 10, satuan: 'butir' }] }, 'inventory_items'],
    ['kalender.tambah', 'kalender', { judul: 'Rapat', tanggal: '2026-09-01', jenis: 'event' }, 'calendar_events'],
    ['catatan.buat', 'catatan', { isi: 'Ide untuk minggu depan' }, 'notes'],
  ])('%s menulis ke %s', async (alat, modul, argumen, table) => {
    aiReply = { jawaban: 'ok', aksi: [{ alat, argumen }] };
    const res = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'x', module: modul }) });

    const body = await res.json() as { aksi: Array<{ status: string; ringkasan: string }> };
    expect(body.aksi[0].status).toBe('dijalankan');
    expect(await count(table)).toBe(1);
  });

  it('proyek.tambah_tugas membuat proyeknya kalau belum ada', async () => {
    aiReply = {
      jawaban: 'ok',
      aksi: [{ alat: 'proyek.tambah_tugas', argumen: { proyek: 'Renovasi', tugas: ['Ukur ruangan', 'Cari tukang'] } }],
    };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'x', module: 'proyek' }) });

    expect(await count('projects')).toBe(1);
    expect(await count('tasks')).toBe(2);
  });

  it('proyek.tambah_tugas memakai proyek yang sudah ada, bukan membuat kembar', async () => {
    await db.prepare(
      "INSERT INTO projects (id, user_id, name, created_at) VALUES ('pr1', 'user-1', 'Renovasi', 0)"
    ).run();

    aiReply = {
      jawaban: 'ok',
      aksi: [{ alat: 'proyek.tambah_tugas', argumen: { proyek: 'renovasi', tugas: ['Beli cat'] } }],
    };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'x', module: 'proyek' }) });

    expect(await count('projects')).toBe(1);
  });

  it.each([
    ['kebun.tanam', { tanaman: [] }],
    ['kebun.tanam', { tanaman: 'bukan daftar' }],
    ['kebiasaan.buat', { kebiasaan: [] }],
    ['inventaris.tambah', { barang: [{ nama: '   ' }] }],
    ['catatan.buat', { isi: '' }],
    ['kalender.tambah', { tanggal: '2026-09-01' }],
  ])('%s menolak argumen ngawur tanpa menulis apa pun', async (alat, argumen) => {
    aiReply = { jawaban: 'ok', aksi: [{ alat, argumen }] };
    const res = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'x' }) });

    const body = await res.json() as { aksi: Array<{ status: string }> };
    expect(body.aksi[0].status).toBe('gagal');
  });
});

describe('pencarian global', () => {
  it('menemukan resep lewat nama dan lewat bahannya', async () => {
    // "Ada resep pakai tempe?" adalah cara paling wajar orang mencari masakan.
    await req('/api/cooking/recipes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Orek tempe', have: ['Tempe'], missing: ['kecap'], minutes: 20 }),
    });

    for (const q of ['orek', 'tempe']) {
      const body = await (await req(`/api/search?q=${q}`)).json() as {
        hits: Array<{ type: string; title: string; subScreen?: string }>;
      };
      const hit = body.hits.find((h) => h.type === 'recipe');
      expect(hit, `pencarian "${q}"`).toMatchObject({ title: 'Orek tempe', subScreen: 'masakan' });
    }
  });

  it('tidak menemukan resep pengguna lain', async () => {
    await db.prepare(
      "INSERT INTO cooking_recipes (id, user_id, name) VALUES ('r2', 'user-2', 'Rahasia')"
    ).run();

    const body = await (await req('/api/search?q=rahasia')).json() as { hits: unknown[] };
    expect(body.hits).toEqual([]);
  });
});

describe('masakan.simpan_resep', () => {
  it('menghitung ulang bahan ada/kurang terhadap inventaris, bukan klaim model', async () => {
    // Model boleh mengarang resep, tapi tidak boleh mengarang isi kulkas.
    // Kalau klaimnya diterima apa adanya, resep tersimpan bisa mengatakan
    // "bahan lengkap" untuk sesuatu yang bahannya tidak pernah dibeli.
    await db.prepare(
      `INSERT INTO inventory_items (id, user_id, name, quantity, unit)
       VALUES ('i1', 'user-1', 'Telur', 5, 'butir')`
    ).run();

    aiReply = {
      jawaban: 'ok',
      aksi: [{
        alat: 'masakan.simpan_resep',
        argumen: { nama: 'Telur dadar', bahan_ada: ['telur', 'wagyu'], bahan_kurang: [] },
      }],
    };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'simpan', module: 'masakan' }) });

    const row = await db.prepare('SELECT have_json, missing_json FROM cooking_recipes WHERE user_id = ?1')
      .bind('user-1').first<{ have_json: string; missing_json: string }>();

    expect(JSON.parse(row!.have_json)).toEqual(['Telur']);
    expect(JSON.parse(row!.missing_json)).toEqual(['wagyu']);
  });
});

describe('batas pemakaian dan cache AI', () => {
  /** Setel jatah harian pengguna uji. */
  async function setLimit(n: number) {
    await db.prepare(
      "INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES ('user-1', 'ai.daily_limit', ?1)"
    ).bind(String(n)).run();
  }

  async function matikanCache() {
    await db.prepare(
      "INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES ('user-1', 'ai.cache_enabled', 'false')"
    ).run();
  }

  it('menghitung tiap panggilan AI', async () => {
    await matikanCache();
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'satu' }) });
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'dua' }) });

    const row = await db.prepare('SELECT calls FROM ai_usage WHERE user_id = ?1').bind('user-1')
      .first<{ calls: number }>();
    expect(row?.calls).toBe(2);
  });

  it('menolak dengan 429 setelah jatah habis', async () => {
    await setLimit(5);
    await matikanCache();
    await db.prepare(
      "INSERT INTO ai_usage (user_id, day, calls) VALUES ('user-1', ?1, 5)"
    ).bind(new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)).run();

    const res = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'halo' }) });
    expect(res.status).toBe(429);
    // AI tidak dipanggil sama sekali — itu seluruh gunanya batas ini.
    expect(aiCalls).toHaveLength(0);
  });

  it('memperingatkan sebelum habis, bukan sesudah', async () => {
    await setLimit(5);
    await matikanCache();
    await db.prepare(
      "INSERT INTO ai_usage (user_id, day, calls) VALUES ('user-1', ?1, 3)"
    ).bind(new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)).run();

    const body = await (await req('/api/agent', {
      method: 'POST', body: JSON.stringify({ message: 'halo' }),
    })).json() as { catatanKuota: string | null; sisa: number };

    expect(body.catatanKuota).toContain('Sisa 2');
    expect(body.sisa).toBe(1);
  });

  it('tidak menghitung panggilan yang gagal', async () => {
    // Permintaan yang gagal karena binding mati bukan pemakaian; menghitungnya
    // membuat pengguna kehilangan jatah untuk sesuatu yang tidak ia terima.
    await matikanCache();
    aiReply = new Error('binding mati');
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'halo' }) });

    const row = await db.prepare('SELECT calls FROM ai_usage WHERE user_id = ?1').bind('user-1')
      .first<{ calls: number }>();
    expect(row?.calls ?? 0).toBe(0);
  });

  it('memakai ulang jawaban untuk pertanyaan yang sama', async () => {
    aiReply = { jawaban: 'Kebunmu baik.' };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'kebunku?', module: 'kebun' }) });

    const kedua = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'kebunku?', module: 'kebun' }) });
    const body = await kedua.json() as { jawaban: string; dariSimpanan: boolean };

    expect(body).toMatchObject({ jawaban: 'Kebunmu baik.', dariSimpanan: true });
    // Model hanya dipanggil sekali.
    expect(aiCalls).toHaveLength(1);
  });

  it('menghitung ulang begitu datanya berubah', async () => {
    // Cache yang menjawab pertanyaan hari ini dengan data kemarin jauh lebih
    // membingungkan daripada menunggu.
    aiReply = { jawaban: 'Belum ada tanaman.' };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'kebunku?', module: 'kebun' }) });

    await db.prepare(
      `INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status)
       VALUES ('p1', 'user-1', 'kangkung', 1, '2026-01-01', 'tumbuh')`
    ).run();

    aiReply = { jawaban: 'Ada satu kangkung.' };
    const kedua = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'kebunku?', module: 'kebun' }) });
    expect(await kedua.json()).toMatchObject({ jawaban: 'Ada satu kangkung.' });
    expect(aiCalls).toHaveLength(2);
  });

  it('tidak pernah memakai ulang jawaban yang membawa aksi', async () => {
    // Mengulang aksi yang sama berarti menulis dua kali.
    aiReply = { jawaban: 'ok', aksi: [{ alat: 'catatan.buat', argumen: { isi: 'halo' } }] };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'catat halo', module: 'catatan' }) });
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'catat halo', module: 'catatan' }) });

    expect(aiCalls).toHaveLength(2);
    expect(await count('notes')).toBe(2);
  });

  it('tidak mencampur cache antar pengguna', async () => {
    aiReply = { jawaban: 'punya user-1' };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'halo', module: 'kebun' }) });

    aiReply = { jawaban: 'punya user-2' };
    const lain = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'halo', module: 'kebun' }) }, otherToken);
    expect(await lain.json()).toMatchObject({ jawaban: 'punya user-2' });
  });

  it('jatah dihitung terpisah per pengguna', async () => {
    await setLimit(5);
    await matikanCache();
    await db.prepare(
      "INSERT INTO ai_usage (user_id, day, calls) VALUES ('user-1', ?1, 5)"
    ).bind(new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)).run();

    expect((await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'x' }) })).status).toBe(429);
    expect((await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'x' }) }, otherToken)).status).toBe(200);
  });
});

describe('pembatalan aksi', () => {
  /** Jalankan satu aksi lewat agen, kembalikan id catatannya. */
  async function jalankan(alat: string, argumen: unknown, modul: string): Promise<string> {
    aiReply = { jawaban: 'ok', aksi: [{ alat, argumen }] };
    const res = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'x', module: modul }) });
    const body = await res.json() as { aksi: Array<{ actionId?: string; status: string }> };
    expect(body.aksi[0].status).toBe('dijalankan');
    return body.aksi[0].actionId!;
  }

  it('mengembalikan id catatan supaya UI bisa menawarkan pembatalan', async () => {
    const actionId = await jalankan('kebun.tanam', { tanaman: ['Kangkung'] }, 'kebun');
    expect(actionId).toBeTruthy();
  });

  it('menghapus baris yang dibuat aksi itu', async () => {
    const actionId = await jalankan('kebun.tanam', { tanaman: ['Kangkung', 'Bayam'] }, 'kebun');
    expect(await count('garden_plantings')).toBe(2);

    const res = await req('/api/agent/undo', { method: 'POST', body: JSON.stringify({ actionId }) });
    expect(res.status).toBe(200);
    expect(await count('garden_plantings')).toBe(0);
  });

  it('tidak menyentuh baris yang bukan dibuat aksi itu', async () => {
    // Tanaman yang ditanam sendiri lewat form tidak boleh ikut hilang.
    await db.prepare(
      `INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status)
       VALUES ('punya-sendiri', 'user-1', 'bayam', 1, '2026-01-01', 'tumbuh')`
    ).run();
    const actionId = await jalankan('kebun.tanam', { tanaman: ['Kangkung'] }, 'kebun');

    await req('/api/agent/undo', { method: 'POST', body: JSON.stringify({ actionId }) });
    expect(await count('garden_plantings')).toBe(1);
  });

  it('tidak bisa membatalkan aksi pengguna lain', async () => {
    const actionId = await jalankan('kebun.tanam', { tanaman: ['Kangkung'] }, 'kebun');

    const res = await req('/api/agent/undo', { method: 'POST', body: JSON.stringify({ actionId }) }, otherToken);
    expect(res.status).toBe(404);
    expect(await count('garden_plantings')).toBe(1);
  });

  it('menolak pembatalan kedua', async () => {
    const actionId = await jalankan('catatan.buat', { isi: 'halo' }, 'catatan');
    expect((await req('/api/agent/undo', { method: 'POST', body: JSON.stringify({ actionId }) })).status).toBe(200);

    const kedua = await req('/api/agent/undo', { method: 'POST', body: JSON.stringify({ actionId }) });
    expect(kedua.status).toBe(400);
    expect(await kedua.json()).toMatchObject({ error: 'aksi ini sudah dibatalkan' });
  });

  it('membatalkan panen mengembalikan status dan menghapus stoknya', async () => {
    // Panen menyentuh tiga hal; membatalkan hanya log-nya menghasilkan
    // tanaman berstatus panen tanpa catatan panen, dan stok dapur yang
    // asalnya sudah tidak ada.
    await db.prepare(
      `INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status)
       VALUES ('p1', 'user-1', 'kangkung', 5, '2026-01-01', 'tumbuh')`
    ).run();

    const actionId = await jalankan(
      'kebun.rawat', { tanaman: 'kangkung', aksi: 'panen', jumlah: 2, satuan: 'kg' }, 'kebun'
    );
    expect(await count('inventory_items')).toBe(1);

    await req('/api/agent/undo', { method: 'POST', body: JSON.stringify({ actionId }) });

    const planting = await db.prepare('SELECT status FROM garden_plantings WHERE id = ?1')
      .bind('p1').first<{ status: string }>();
    expect(planting?.status).toBe('tumbuh');
    expect(await count('inventory_items')).toBe(0);
    expect(await count('garden_care_log')).toBe(0);
  });

  it('tidak menurunkan status tanaman yang memang sudah panen sebelumnya', async () => {
    await db.prepare(
      `INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status)
       VALUES ('p1', 'user-1', 'kangkung', 5, '2026-01-01', 'panen')`
    ).run();

    const actionId = await jalankan('kebun.rawat', { tanaman: 'kangkung', aksi: 'panen', jumlah: 1 }, 'kebun');
    await req('/api/agent/undo', { method: 'POST', body: JSON.stringify({ actionId }) });

    const planting = await db.prepare('SELECT status FROM garden_plantings WHERE id = ?1')
      .bind('p1').first<{ status: string }>();
    expect(planting?.status).toBe('panen');
  });

  it('menolak id aksi yang tidak ada', async () => {
    const res = await req('/api/agent/undo', { method: 'POST', body: JSON.stringify({ actionId: 'ngawur' }) });
    expect(res.status).toBe(404);
  });

  it('menolak tanpa id aksi', async () => {
    const res = await req('/api/agent/undo', { method: 'POST', body: '{}' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/agent/history', () => {
  it('menolak tanpa token', async () => {
    const res = await app.request('http://test/api/agent/history', {}, makeEnv());
    expect(res.status).toBe(401);
  });

  it('mencatat permintaan aslinya, bukan cuma hasilnya', async () => {
    // Riwayat harus bisa menjelaskan KENAPA sebuah baris muncul.
    aiReply = { jawaban: 'ok', aksi: [{ alat: 'kebun.tanam', argumen: { tanaman: ['Kangkung'] } }] };
    await req('/api/agent', {
      method: 'POST',
      body: JSON.stringify({ message: 'buatkan daftar tanaman pemula', module: 'kebun' }),
    });

    const body = await (await req('/api/agent/history')).json() as {
      actions: Array<{ tool: string; message: string; summary: string; undoable: boolean }>;
    };
    expect(body.actions[0]).toMatchObject({
      tool: 'kebun.tanam',
      message: 'buatkan daftar tanaman pemula',
      undoable: true,
    });
    expect(body.actions[0].summary).toContain('Kangkung');
  });

  it('tidak menampilkan aksi pengguna lain', async () => {
    aiReply = { jawaban: 'ok', aksi: [{ alat: 'catatan.buat', argumen: { isi: 'rahasia' } }] };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'x', module: 'catatan' }) });

    const body = await (await req('/api/agent/history', {}, otherToken)).json() as { actions: unknown[] };
    expect(body.actions).toEqual([]);
  });

  it('menandai aksi yang sudah dibatalkan sebagai tidak bisa dibatalkan lagi', async () => {
    aiReply = { jawaban: 'ok', aksi: [{ alat: 'catatan.buat', argumen: { isi: 'halo' } }] };
    const res = await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'x', module: 'catatan' }) });
    const { aksi } = await res.json() as { aksi: Array<{ actionId: string }> };

    await req('/api/agent/undo', { method: 'POST', body: JSON.stringify({ actionId: aksi[0].actionId }) });

    const body = await (await req('/api/agent/history')).json() as {
      actions: Array<{ status: string; undoable: boolean; undoneAt: number | null }>;
    };
    expect(body.actions[0]).toMatchObject({ status: 'dibatalkan', undoable: false });
    expect(body.actions[0].undoneAt).toBeTruthy();
  });

  it('tidak mencatat aksi yang hanya menjawab tanpa menulis', async () => {
    aiReply = { jawaban: 'Kebunmu baik-baik saja.' };
    await req('/api/agent', { method: 'POST', body: JSON.stringify({ message: 'kebunku?', module: 'kebun' }) });

    const body = await (await req('/api/agent/history')).json() as { actions: unknown[] };
    expect(body.actions).toEqual([]);
  });

  it('mencatat aksi uang yang dikonfirmasi, beserta id pembatalannya', async () => {
    const res = await req('/api/agent/confirm', {
      method: 'POST',
      body: JSON.stringify({ tool: 'uang.catat', args: { jenis: 'expense', jumlah: 50000 } }),
    });
    const { actionId } = await res.json() as { actionId: string };
    expect(actionId).toBeTruthy();

    await req('/api/agent/undo', { method: 'POST', body: JSON.stringify({ actionId }) });
    expect(await count('budget_entries')).toBe(0);
  });
});

describe('POST /api/agent/confirm', () => {
  it('menjalankan aksi yang tadi ditahan', async () => {
    const res = await req('/api/agent/confirm', {
      method: 'POST',
      body: JSON.stringify({ tool: 'uang.catat', args: { jenis: 'expense', jumlah: 50000, kategori: 'Makan' } }),
    });

    expect(res.status).toBe(200);
    expect(await count('budget_entries')).toBe(1);
  });

  it('menolak alat yang tidak dikenal', async () => {
    const res = await req('/api/agent/confirm', {
      method: 'POST',
      body: JSON.stringify({ tool: 'rm -rf', args: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('menolak nominal yang tidak masuk akal', async () => {
    const res = await req('/api/agent/confirm', {
      method: 'POST',
      body: JSON.stringify({ tool: 'uang.catat', args: { jenis: 'expense', jumlah: -5 } }),
    });
    expect(res.status).toBe(400);
    expect(await count('budget_entries')).toBe(0);
  });

  it('menolak tanpa token', async () => {
    const res = await app.request(
      'http://test/api/agent/confirm',
      { method: 'POST', body: JSON.stringify({ tool: 'uang.catat', args: {} }) },
      makeEnv()
    );
    expect(res.status).toBe(401);
  });

  it('mengabaikan kiriman ulang dengan clientId sama', async () => {
    // Inti antrean offline: permintaan yang sudah sampai tapi jawabannya tak
    // pernah diterima klien akan dikirim ulang. Yang lewat sini adalah aksi
    // uang, dan pengeluaran ganda merusak rekap berbulan-bulan.
    const payload = JSON.stringify({
      tool: 'uang.catat',
      args: { jenis: 'expense', jumlah: 50000 },
      clientId: 'aaaabbbbccccdddd',
    });

    const pertama = await req('/api/agent/confirm', { method: 'POST', body: payload });
    expect(pertama.status).toBe(200);

    const kedua = await req('/api/agent/confirm', { method: 'POST', body: payload });
    expect(await kedua.json()).toMatchObject({ duplicate: true });

    expect(await count('budget_entries')).toBe(1);
  });

  it('clientId milik pengguna lain tidak menghalangi aksinya sendiri', async () => {
    const payload = JSON.stringify({
      tool: 'uang.catat',
      args: { jenis: 'expense', jumlah: 50000 },
      clientId: 'aaaabbbbccccdddd',
    });

    await req('/api/agent/confirm', { method: 'POST', body: payload });
    await req('/api/agent/confirm', { method: 'POST', body: payload }, otherToken);

    expect(await count('budget_entries', 'user-1')).toBe(1);
    expect(await count('budget_entries', 'user-2')).toBe(1);
  });

  it('mengabaikan clientId yang bentuknya tidak sah, tanpa menolak aksinya', async () => {
    const res = await req('/api/agent/confirm', {
      method: 'POST',
      body: JSON.stringify({ tool: 'uang.catat', args: { jenis: 'expense', jumlah: 1000 }, clientId: 'x' }),
    });
    expect(res.status).toBe(200);
    expect(await count('budget_entries')).toBe(1);
  });
});

// ───────────────────────── modul Masakan ─────────────────────────

async function seedStok(name: string, quantity = 5, unit = 'pcs', userId = 'user-1', expiry: string | null = null) {
  await db.prepare(
    `INSERT INTO inventory_items (id, user_id, name, quantity, unit, expiry_date)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(`inv-${name}-${userId}`, userId, name, quantity, unit, expiry).run();
}

describe('modul Masakan', () => {
  it.each(['/api/cooking/ingredients', '/api/cooking/recipes'])('%s menolak tanpa token', async (path) => {
    const res = await app.request(`http://test${path}`, {}, makeEnv());
    expect(res.status).toBe(401);
  });

  it('hanya mengembalikan bahan milik sendiri', async () => {
    await seedStok('Telur');
    await seedStok('RahasiaTetangga', 1, 'pcs', 'user-2');

    const body = await (await req('/api/cooking/ingredients')).json() as { ingredients: Array<{ name: string }> };
    expect(body.ingredients.map((i) => i.name)).toEqual(['Telur']);
  });

  it('memilah bahan yang ada dan yang kurang dari jawaban model', async () => {
    await seedStok('Telur');
    await seedStok('Nasi');
    aiReply = { resep: [{ nama: 'Nasi goreng', bahan: ['nasi', 'telur', 'kecap'], langkah: ['tumis'] }] };

    const res = await req('/api/cooking/suggest', { method: 'POST', body: JSON.stringify({}) });
    const body = await res.json() as { recipes: Array<{ have: string[]; missing: string[] }> };

    expect(body.recipes[0].have.sort()).toEqual(['Nasi', 'Telur']);
    expect(body.recipes[0].missing).toEqual(['kecap']);
  });

  it('hanya memakai bahan yang dicentang pengguna', async () => {
    await seedStok('Telur');
    await seedStok('Nasi');
    aiReply = { resep: [{ nama: 'Telur dadar', bahan: ['telur'], langkah: ['kocok'] }] };

    await req('/api/cooking/suggest', { method: 'POST', body: JSON.stringify({ ingredients: ['Telur'] }) });

    const prompt = JSON.stringify(aiCalls[0].input);
    expect(prompt).toContain('Telur');
    expect(prompt).not.toContain('Nasi');
  });

  it('menerima bahan yang diketik walau belum ada di inventaris', async () => {
    aiReply = { resep: [{ nama: 'Tumis kangkung', bahan: ['kangkung'], langkah: ['tumis'] }] };

    const res = await req('/api/cooking/suggest', {
      method: 'POST',
      body: JSON.stringify({ extra: ['Kangkung'] }),
    });

    const body = await res.json() as { recipes: Array<{ have: string[]; missing: string[] }> };
    expect(body.recipes[0].have).toEqual(['Kangkung']);
    expect(body.recipes[0].missing).toEqual([]);
  });

  it('memberi pesan, bukan error, saat tidak ada bahan sama sekali', async () => {
    const res = await req('/api/cooking/suggest', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    const body = await res.json() as { recipes: unknown[]; message: string };
    expect(body.recipes).toEqual([]);
    expect(body.message).toContain('Inventaris');
    // AI tidak dipanggil kalau tidak ada yang bisa ditanyakan.
    expect(aiCalls).toHaveLength(0);
  });

  it('menyimpan lalu mengembalikan resep', async () => {
    const created = await req('/api/cooking/recipes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Nasi goreng', have: ['Nasi'], missing: ['kecap'], steps: ['tumis'], minutes: 15 }),
    });
    expect(created.status).toBe(201);

    const body = await (await req('/api/cooking/recipes')).json() as {
      recipes: Array<{ name: string; have: string[]; missing: string[]; cookedCount: number }>;
    };
    expect(body.recipes[0]).toMatchObject({ name: 'Nasi goreng', have: ['Nasi'], missing: ['kecap'], cookedCount: 0 });
  });

  it('menolak resep tanpa nama', async () => {
    const res = await req('/api/cooking/recipes', { method: 'POST', body: JSON.stringify({ have: ['Nasi'] }) });
    expect(res.status).toBe(400);
  });

  it('tidak menampilkan resep pengguna lain', async () => {
    await db.prepare(
      "INSERT INTO cooking_recipes (id, user_id, name) VALUES ('r2', 'user-2', 'Rahasia')"
    ).run();

    const body = await (await req('/api/cooking/recipes')).json() as { recipes: unknown[] };
    expect(body.recipes).toEqual([]);
  });

  it('menandai sudah dimasak dan mengurangi stok sesuai yang dipakai', async () => {
    await seedStok('Telur', 10, 'butir');
    const { id } = await (await req('/api/cooking/recipes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Telur dadar', have: ['Telur'] }),
    })).json() as { id: string };

    const res = await req(`/api/cooking/recipes/${id}/cook`, {
      method: 'POST',
      body: JSON.stringify({ used: [{ name: 'Telur', quantity: 3 }] }),
    });
    expect(res.status).toBe(200);

    const stok = await db.prepare('SELECT quantity FROM inventory_items WHERE id = ?1')
      .bind('inv-Telur-user-1').first<{ quantity: number }>();
    expect(stok?.quantity).toBe(7);

    const resep = await db.prepare('SELECT cooked_count, last_cooked_date FROM cooking_recipes WHERE id = ?1')
      .bind(id).first<{ cooked_count: number; last_cooked_date: string }>();
    expect(resep?.cooked_count).toBe(1);
    expect(resep?.last_cooked_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('tidak pernah membuat stok minus', async () => {
    await seedStok('Telur', 2, 'butir');
    const { id } = await (await req('/api/cooking/recipes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Telur dadar', have: ['Telur'] }),
    })).json() as { id: string };

    await req(`/api/cooking/recipes/${id}/cook`, {
      method: 'POST',
      body: JSON.stringify({ used: [{ name: 'Telur', quantity: 99 }] }),
    });

    const stok = await db.prepare('SELECT quantity FROM inventory_items WHERE id = ?1')
      .bind('inv-Telur-user-1').first<{ quantity: number }>();
    expect(stok?.quantity).toBe(0);
  });

  it('tidak mengurangi stok pengguna lain yang namanya kebetulan sama', async () => {
    await seedStok('Telur', 10, 'butir');
    await seedStok('Telur', 10, 'butir', 'user-2');

    const { id } = await (await req('/api/cooking/recipes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Telur dadar', have: ['Telur'] }),
    })).json() as { id: string };

    await req(`/api/cooking/recipes/${id}/cook`, {
      method: 'POST',
      body: JSON.stringify({ used: [{ name: 'Telur', quantity: 4 }] }),
    });

    const lain = await db.prepare('SELECT quantity FROM inventory_items WHERE id = ?1')
      .bind('inv-Telur-user-2').first<{ quantity: number }>();
    expect(lain?.quantity).toBe(10);
  });

  it('tidak mengurangi apa pun kalau pengguna tidak menyebut takaran', async () => {
    // Resep menyebut "bawang merah" tanpa takaran; menebak angka lalu
    // mengurangi stok orang dengan angka itu adalah kesalahan yang diam.
    await seedStok('Telur', 10, 'butir');
    const { id } = await (await req('/api/cooking/recipes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Telur dadar', have: ['Telur'] }),
    })).json() as { id: string };

    await req(`/api/cooking/recipes/${id}/cook`, { method: 'POST', body: JSON.stringify({}) });

    const stok = await db.prepare('SELECT quantity FROM inventory_items WHERE id = ?1')
      .bind('inv-Telur-user-1').first<{ quantity: number }>();
    expect(stok?.quantity).toBe(10);
  });

  it('hanya mengurangi satu baris stok walau namanya kembar', async () => {
    // Nama barang tidak unik: belanja dua kali menghasilkan dua baris "Telur"
    // dengan kedaluwarsa berbeda. UPDATE yang menyaring dengan nama akan
    // mengurangi dari keduanya sekaligus — memakai tiga telur menghapus enam.
    await db.prepare(
      `INSERT INTO inventory_items (id, user_id, name, quantity, unit, expiry_date)
       VALUES ('lama', 'user-1', 'Telur', 10, 'butir', '2026-09-01')`
    ).run();
    await db.prepare(
      `INSERT INTO inventory_items (id, user_id, name, quantity, unit, expiry_date)
       VALUES ('baru', 'user-1', 'Telur', 10, 'butir', '2026-12-01')`
    ).run();

    const { id } = await (await req('/api/cooking/recipes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Telur dadar', have: ['Telur'] }),
    })).json() as { id: string };

    await req(`/api/cooking/recipes/${id}/cook`, {
      method: 'POST',
      body: JSON.stringify({ used: [{ name: 'Telur', quantity: 3 }] }),
    });

    // Yang paling dekat kedaluwarsa yang dipakai — itu juga yang sungguhan
    // diambil orang dari kulkas lebih dulu.
    const lama = await db.prepare('SELECT quantity FROM inventory_items WHERE id = ?1')
      .bind('lama').first<{ quantity: number }>();
    const baru = await db.prepare('SELECT quantity FROM inventory_items WHERE id = ?1')
      .bind('baru').first<{ quantity: number }>();

    expect(lama?.quantity).toBe(7);
    expect(baru?.quantity).toBe(10);
  });

  it('memakai hanya bahan yang diketik saat tidak ada yang dicentang', async () => {
    // Mencentang nol barang lalu mengetik "tempe" berarti "pakai tempe saja".
    await seedStok('Telur');
    await seedStok('Nasi');
    aiReply = { resep: [{ nama: 'Tempe goreng', bahan: ['tempe'], langkah: ['goreng'] }] };

    await req('/api/cooking/suggest', {
      method: 'POST',
      body: JSON.stringify({ ingredients: [], extra: ['Tempe'] }),
    });

    const prompt = JSON.stringify(aiCalls[0].input);
    expect(prompt).toContain('Tempe');
    expect(prompt).not.toContain('Nasi');
  });

  it('mencatat porsinya ke log makan saat gizinya diisi', async () => {
    // Masak lalu makan adalah satu peristiwa; mencatatnya dua kali membuat
    // yang kedua hampir selalu terlewat.
    const { id } = await (await req('/api/cooking/recipes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Nasi goreng', servings: 2 }),
    })).json() as { id: string };

    const res = await req(`/api/cooking/recipes/${id}/cook`, {
      method: 'POST',
      body: JSON.stringify({ meal: { portion: '1 porsi', calories: 420, protein: 12 } }),
    });
    expect(await res.json()).toMatchObject({ mealLogged: true });

    const log = await db.prepare(
      'SELECT food_name, portion, calories, protein_g, log_date FROM food_logs WHERE user_id = ?1'
    ).bind('user-1').first<{ food_name: string; portion: string; calories: number; protein_g: number }>();

    expect(log).toMatchObject({ food_name: 'Nasi goreng', portion: '1 porsi', calories: 420, protein_g: 12 });
  });

  it('tidak mencatat log makan kalau gizinya tidak diisi', async () => {
    // Mengarang kalori lebih buruk daripada tidak mencatat.
    const { id } = await (await req('/api/cooking/recipes', {
      method: 'POST', body: JSON.stringify({ name: 'Nasi goreng' }),
    })).json() as { id: string };

    const res = await req(`/api/cooking/recipes/${id}/cook`, { method: 'POST', body: '{}' });
    expect(await res.json()).toMatchObject({ mealLogged: false });
    expect(await count('food_logs')).toBe(0);
  });

  it('menolak memasak resep pengguna lain', async () => {
    await db.prepare(
      "INSERT INTO cooking_recipes (id, user_id, name) VALUES ('r2', 'user-2', 'Rahasia')"
    ).run();

    const res = await req('/api/cooking/recipes/r2/cook', { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
  });

  it('mengubah bahan yang kurang jadi tugas belanja di kalender', async () => {
    const { id } = await (await req('/api/cooking/recipes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Nasi goreng', missing: ['kecap', 'bawang'] }),
    })).json() as { id: string };

    const res = await req(`/api/cooking/recipes/${id}/shop`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);

    const event = await db.prepare(
      "SELECT title, note, kind FROM calendar_events WHERE user_id = ?1"
    ).bind('user-1').first<{ title: string; note: string; kind: string }>();

    expect(event?.kind).toBe('task');
    expect(event?.title).toContain('Nasi goreng');
    expect(event?.note).toBe('kecap, bawang');
    // Yang belum dibeli tidak masuk inventaris — itu akan membuat semua
    // hitungan yang berdiri di atas stok jadi bohong.
    expect(await count('inventory_items')).toBe(0);
  });

  it('menolak membuat tugas belanja kalau tidak ada yang kurang', async () => {
    const { id } = await (await req('/api/cooking/recipes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Telur dadar', have: ['Telur'], missing: [] }),
    })).json() as { id: string };

    const res = await req(`/api/cooking/recipes/${id}/shop`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(400);
  });

  it('menghapus resep sendiri, bukan milik orang lain', async () => {
    const { id } = await (await req('/api/cooking/recipes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Nasi goreng' }),
    })).json() as { id: string };

    expect((await req(`/api/cooking/recipes/${id}`, { method: 'DELETE' }, otherToken)).status).toBe(404);
    expect((await req(`/api/cooking/recipes/${id}`, { method: 'DELETE' })).status).toBe(200);
  });
});
