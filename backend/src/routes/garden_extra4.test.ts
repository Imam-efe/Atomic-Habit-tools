/**
 * Uji rute uji tanah, perbanyakan, mangsa, jadwal semai, media, dan
 * ketinggian: SQL sungguhan terhadap skema produksi, kepemilikan antar
 * pengguna, dan bentuk respons yang dipakai layar.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import gardenExtra4 from './garden_extra4';
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
  app.route('/api/garden', gardenExtra4 as never);
});

afterEach(() => db.__close());

function seedPlanting(userId: string, id: string, plantId: string | null, location: string | null) {
  db.prepare(
    `INSERT INTO garden_plantings (id, user_id, plant_id, custom_name, quantity, planted_date, status, location)
     VALUES (?1, ?2, ?3, ?4, 1, '2026-01-01', 'tumbuh', ?5)`
  ).bind(id, userId, plantId, plantId ? null : 'Tanaman kustom', location).run();
  return id;
}

function setSetting(userId: string, key: string, value: string) {
  db.prepare(
    'INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?1, ?2, ?3)'
  ).bind(userId, key, value).run();
}

// ───────────────────────────── UJI TANAH ─────────────────────────────

describe('uji tanah', () => {
  it('menyimpan lalu mengembalikan satu hasil uji', async () => {
    const res = await req('/api/garden/soil', {
      method: 'POST',
      body: JSON.stringify({
        lokasiId: 'loc:Bedengan depan', lokasiLabel: 'Bedengan depan',
        ph: 5.2, texture: 'liat', testedDate: '2026-08-20',
      }),
    });
    expect(res.status).toBe(200);

    const body = await (await req('/api/garden/soil')).json() as {
      riwayat: Array<{ ph: number; texture: string | null; terbaru: boolean }>;
    };
    expect(body.riwayat).toHaveLength(1);
    expect(body.riwayat[0].ph).toBe(5.2);
    expect(body.riwayat[0].texture).toBe('liat');
    expect(body.riwayat[0].terbaru).toBe(true);
  });

  it('menolak pH di luar rentang alat ukur', async () => {
    for (const ph of [0, 14, -1, 'asam']) {
      const res = await req('/api/garden/soil', {
        method: 'POST',
        body: JSON.stringify({ lokasiId: 'loc:A', ph }),
      });
      expect(res.status, `ph=${ph}`).toBe(400);
    }
  });

  it('menolak uji tanpa lokasi', async () => {
    const res = await req('/api/garden/soil', {
      method: 'POST',
      body: JSON.stringify({ ph: 6.0 }),
    });
    expect(res.status).toBe(400);
  });

  it('menandai tanaman yang berdiri di tanah terlalu masam', async () => {
    // Sawi minta pH 6.0-7.0 di katalog; tanahnya diukur 4.6.
    seedPlanting('user-1', 'p1', 'sawi-hijau', 'Bedengan depan');
    await req('/api/garden/soil', {
      method: 'POST',
      body: JSON.stringify({
        lokasiId: 'loc:Bedengan depan', lokasiLabel: 'Bedengan depan',
        ph: 4.6, texture: 'liat', testedDate: '2026-08-20',
      }),
    });

    const body = await (await req('/api/garden/soil')).json() as {
      salahTanah: Array<{ plantingId: string; status: string; saran: string | null }>;
    };
    expect(body.salahTanah).toHaveLength(1);
    expect(body.salahTanah[0].plantingId).toBe('p1');
    expect(body.salahTanah[0].status).toBe('terlalu-masam');
    expect(body.salahTanah[0].saran).toMatch(/dolomit/i);
  });

  it('memakai uji terbaru, bukan uji pertama', async () => {
    seedPlanting('user-1', 'p1', 'sawi-hijau', 'Bedengan depan');
    for (const [ph, tgl] of [[4.6, '2026-07-01'], [6.4, '2026-08-20']] as const) {
      await req('/api/garden/soil', {
        method: 'POST',
        body: JSON.stringify({ lokasiId: 'loc:Bedengan depan', ph, texture: 'liat', testedDate: tgl }),
      });
    }

    const body = await (await req('/api/garden/soil')).json() as {
      salahTanah: unknown[];
    };
    // Sudah dikapur; peringatan lama tidak boleh terus muncul.
    expect(body.salahTanah).toEqual([]);
  });

  it('menyebut lokasi yang sudah ditanami tapi belum pernah diuji', async () => {
    seedPlanting('user-1', 'p1', 'sawi-hijau', 'Pot teras');

    const body = await (await req('/api/garden/soil')).json() as {
      belumDiuji: Array<{ lokasiId: string }>;
    };
    expect(body.belumDiuji).toHaveLength(1);
    expect(body.belumDiuji[0].lokasiId).toBe('loc:Pot teras');
  });

  it('pengguna lain tidak melihat uji tanah pengguna ini', async () => {
    await req('/api/garden/soil', {
      method: 'POST',
      body: JSON.stringify({ lokasiId: 'loc:A', ph: 5.0 }),
    });

    const body = await (await req('/api/garden/soil', {}, otherToken)).json() as {
      riwayat: unknown[];
    };
    expect(body.riwayat).toEqual([]);
  });

  it('menghapus uji tanah sendiri', async () => {
    const { id } = await (await req('/api/garden/soil', {
      method: 'POST',
      body: JSON.stringify({ lokasiId: 'loc:A', ph: 5.0 }),
    })).json() as { id: string };

    expect((await req(`/api/garden/soil/${id}`, { method: 'DELETE' })).status).toBe(200);
    const body = await (await req('/api/garden/soil')).json() as { riwayat: unknown[] };
    expect(body.riwayat).toEqual([]);
  });

  it('menghapus uji milik pengguna lain mengembalikan 404 dan tidak menghapus', async () => {
    const { id } = await (await req('/api/garden/soil', {
      method: 'POST',
      body: JSON.stringify({ lokasiId: 'loc:A', ph: 5.0 }),
    })).json() as { id: string };

    const res = await req(`/api/garden/soil/${id}`, { method: 'DELETE' }, otherToken);
    expect(res.status).toBe(404);

    const body = await (await req('/api/garden/soil')).json() as { riwayat: unknown[] };
    expect(body.riwayat).toHaveLength(1);
  });
});

// ──────────────────────────── PERBANYAKAN ────────────────────────────

describe('perbanyakan', () => {
  async function catat(over: Record<string, unknown> = {}) {
    const res = await req('/api/garden/propagation', {
      method: 'POST',
      body: JSON.stringify({
        plantId: 'tin', method: 'stek', startedDate: '2026-08-01', countStarted: 10, ...over,
      }),
    });
    return { res, body: await res.json() as { id: string } };
  }

  it('mencatat batch baru', async () => {
    const { res } = await catat();
    expect(res.status).toBe(200);

    const body = await (await req('/api/garden/propagation')).json() as {
      catatan: Array<{ method: string; countStarted: number; countRooted: number | null; rate: number | null }>;
    };
    expect(body.catatan).toHaveLength(1);
    expect(body.catatan[0].method).toBe('stek');
    expect(body.catatan[0].countStarted).toBe(10);
    expect(body.catatan[0].countRooted).toBeNull();
    expect(body.catatan[0].rate).toBeNull();
  });

  it('menolak metode yang tidak dikenal', async () => {
    const { res } = await catat({ method: 'kultur-jaringan' });
    expect(res.status).toBe(400);
  });

  it('menolak jumlah yang tidak masuk akal', async () => {
    expect((await catat({ countStarted: 0 })).res.status).toBe(400);
    expect((await catat({ countStarted: -3 })).res.status).toBe(400);
  });

  it('menolak tanaman yang tidak ada di katalog', async () => {
    const { res } = await catat({ plantId: 'tanaman-hantu' });
    expect(res.status).toBe(400);
  });

  it('mengisi jumlah yang berakar lalu menghitung tingkat keberhasilan', async () => {
    const { body } = await catat();
    const res = await req(`/api/garden/propagation/${body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ countRooted: 7, rootedDate: '2026-08-25' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ countRooted: 7, rate: 70 });
  });

  it('nol berakar tersimpan sebagai 0, bukan ditolak', async () => {
    // Batch yang gagal total justru data terpenting tentang metodenya.
    const { body } = await catat();
    const res = await req(`/api/garden/propagation/${body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ countRooted: 0 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ countRooted: 0, rate: 0 });
  });

  it('menolak berakar lebih banyak daripada yang dipasang', async () => {
    const { body } = await catat();
    const res = await req(`/api/garden/propagation/${body.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ countRooted: 99 }),
    });
    expect(res.status).toBe(400);
  });

  it('meringkas keberhasilan per metode', async () => {
    const a = await catat({ method: 'stek', countStarted: 10 });
    const b = await catat({ method: 'cangkok', countStarted: 4 });
    await req(`/api/garden/propagation/${a.body.id}`, {
      method: 'PATCH', body: JSON.stringify({ countRooted: 8 }),
    });
    await req(`/api/garden/propagation/${b.body.id}`, {
      method: 'PATCH', body: JSON.stringify({ countRooted: 1 }),
    });

    const body = await (await req('/api/garden/propagation')).json() as {
      ringkasan: Array<{ method: string; rate: number }>;
    };
    expect(body.ringkasan[0]).toMatchObject({ method: 'stek', rate: 80 });
    expect(body.ringkasan[1]).toMatchObject({ method: 'cangkok', rate: 25 });
  });

  it('menyarankan metode dari kolom propagation katalog untuk tanaman yang ditanam', async () => {
    seedPlanting('user-1', 'p1', 'tin', 'Pot teras');

    const body = await (await req('/api/garden/propagation')).json() as {
      saranKatalog: Array<{ plantId: string; metode: Array<{ method: string }> }>;
    };
    const tin = body.saranKatalog.find((s) => s.plantId === 'tin');
    expect(tin).toBeTruthy();
    expect(tin!.metode.map((m) => m.method)).toContain('stek');
  });

  it('menolak tanaman induk milik pengguna lain', async () => {
    seedPlanting('user-2', 'milik-orang-lain', 'tin', null);
    const { res } = await catat({ sourcePlantingId: 'milik-orang-lain' });
    expect(res.status).toBe(404);
  });

  it('pengguna lain tidak melihat catatan perbanyakan pengguna ini', async () => {
    await catat();
    const body = await (await req('/api/garden/propagation', {}, otherToken)).json() as {
      catatan: unknown[];
    };
    expect(body.catatan).toEqual([]);
  });

  it('PATCH pada catatan pengguna lain mengembalikan 404', async () => {
    const { body } = await catat();
    const res = await req(`/api/garden/propagation/${body.id}`, {
      method: 'PATCH', body: JSON.stringify({ countRooted: 5 }),
    }, otherToken);
    expect(res.status).toBe(404);
  });
});

// ────────────────────────── PRANATA MANGSA ──────────────────────────

describe('pranata mangsa', () => {
  it('mengembalikan mangsa berjalan dan berikutnya', async () => {
    const body = await (await req('/api/garden/mangsa')).json() as {
      sekarang: { nama: string; urutan: number; saran: string; musimSederhana: string };
      berikutnya: { nama: string; urutan: number };
      semua: unknown[];
    };
    expect(body.semua).toHaveLength(12);
    expect(body.sekarang.nama).toBeTruthy();
    expect(body.sekarang.saran.length).toBeGreaterThan(20);
    expect(['hujan', 'kemarau']).toContain(body.sekarang.musimSederhana);
    // Berikutnya selalu satu langkah sesudahnya, memutar di ujung.
    expect(body.berikutnya.urutan).toBe((body.sekarang.urutan % 12) + 1);
  });

  it('hanya menyarankan tanaman yang musimnya cocok atau sepanjang tahun', async () => {
    const body = await (await req('/api/garden/mangsa')).json() as {
      sekarang: { musimSederhana: string };
      cocokDitanam: Array<{ season: string; idealSekarang: boolean }>;
    };
    expect(body.cocokDitanam.length).toBeGreaterThan(0);
    for (const t of body.cocokDitanam) {
      const s = t.season.toLowerCase();
      const cocok = s.includes('sepanjang tahun') || s.includes(body.sekarang.musimSederhana);
      expect(cocok, t.season).toBe(true);
    }
  });

  it('tidak pernah menyarankan tanaman hias — mereka tidak ditanam untuk dipanen', async () => {
    const body = await (await req('/api/garden/mangsa')).json() as {
      cocokDitanam: Array<{ plantId: string }>;
    };
    expect(body.cocokDitanam.some((t) => t.plantId === 'aglaonema')).toBe(false);
  });
});

// ─────────────────────── JADWAL SEMAI MUNDUR ───────────────────────

describe('jadwal semai mundur', () => {
  it('menolak target yang bukan tanggal', async () => {
    expect((await req('/api/garden/seedling-schedule')).status).toBe(400);
    expect((await req('/api/garden/seedling-schedule?target=besok')).status).toBe(400);
    expect((await req('/api/garden/seedling-schedule?target=2026-13-45x')).status).toBe(400);
  });

  it('menghitung mundur dari target tanam', async () => {
    const body = await (await req('/api/garden/seedling-schedule?target=2026-10-01')).json() as {
      target: string;
      jadwal: Array<{ plantId: string; mulaiSemai: string; mulaiAdaptasi: string; pekan: [number, number] }>;
    };
    expect(body.target).toBe('2026-10-01');
    expect(body.jadwal.length).toBeGreaterThan(0);
    for (const j of body.jadwal) {
      expect(j.mulaiSemai < j.mulaiAdaptasi, j.plantId).toBe(true);
      expect(j.mulaiAdaptasi < body.target, j.plantId).toBe(true);
    }
  });

  it('melewati tanaman yang ditanam benih langsung', async () => {
    const body = await (await req('/api/garden/seedling-schedule?target=2026-10-01')).json() as {
      jadwal: Array<{ plantId: string }>;
    };
    // Kangkung disebar langsung, tidak lewat persemaian.
    expect(body.jadwal.some((j) => j.plantId === 'kangkung')).toBe(false);
  });

  it('mikrogreen tidak masuk jadwal — disebar di nampan, tidak pernah dipindah', async () => {
    const body = await (await req('/api/garden/seedling-schedule?target=2026-10-01')).json() as {
      jadwal: Array<{ plantId: string }>;
    };
    expect(body.jadwal.some((j) => j.plantId.startsWith('mikrogreen-'))).toBe(false);
  });
});

// ───────────────────────────── MEDIA TANAM ─────────────────────────────

describe('media tanam', () => {
  it('penanaman tanpa catatan media dianggap tanah', async () => {
    seedPlanting('user-1', 'p1', 'kangkung', 'Bedengan A');
    const body = await (await req('/api/garden/media')).json() as {
      daftar: Array<{ plantingId: string; media: string; butuhSiram: boolean; tugas: string[] }>;
    };
    expect(body.daftar).toHaveLength(1);
    expect(body.daftar[0].media).toBe('tanah');
    expect(body.daftar[0].butuhSiram).toBe(true);
    expect(body.daftar[0].tugas).toEqual([]);
  });

  it('menyimpan media satu penanaman', async () => {
    seedPlanting('user-1', 'p1', 'kangkung', null);
    const res = await req('/api/garden/media/p1', {
      method: 'PUT',
      body: JSON.stringify({ media: 'hidroponik', lastSolutionChange: '2026-08-30' }),
    });
    expect(res.status).toBe(200);

    const body = await (await req('/api/garden/media')).json() as {
      daftar: Array<{ media: string; lastSolutionChange: string | null }>;
    };
    expect(body.daftar[0].media).toBe('hidroponik');
    expect(body.daftar[0].lastSolutionChange).toBe('2026-08-30');
  });

  it('menyimpan ulang menimpa, bukan menggandakan', async () => {
    seedPlanting('user-1', 'p1', 'kangkung', null);
    await req('/api/garden/media/p1', { method: 'PUT', body: JSON.stringify({ media: 'hidroponik' }) });
    await req('/api/garden/media/p1', { method: 'PUT', body: JSON.stringify({ media: 'vertikultur' }) });

    const body = await (await req('/api/garden/media')).json() as {
      daftar: Array<{ media: string }>;
    };
    expect(body.daftar).toHaveLength(1);
    expect(body.daftar[0].media).toBe('vertikultur');
  });

  it('hidroponik tidak pernah diminta disiram', async () => {
    seedPlanting('user-1', 'p1', 'kangkung', null);
    await req('/api/garden/media/p1', { method: 'PUT', body: JSON.stringify({ media: 'hidroponik' }) });

    const body = await (await req('/api/garden/media')).json() as {
      daftar: Array<{ butuhSiram: boolean; tugas: string[] }>;
    };
    expect(body.daftar[0].butuhSiram).toBe(false);
    expect(body.daftar[0].tugas.join(' ')).toMatch(/EC dan pH/i);
  });

  it('hidroponik yang larutannya lewat tenggat diminta mengganti', async () => {
    seedPlanting('user-1', 'p1', 'kangkung', null);
    await req('/api/garden/media/p1', {
      method: 'PUT',
      body: JSON.stringify({ media: 'hidroponik', lastSolutionChange: '2020-01-01' }),
    });

    const body = await (await req('/api/garden/media')).json() as {
      daftar: Array<{ tugas: string[] }>;
    };
    expect(body.daftar[0].tugas.join(' ')).toMatch(/ganti larutan/i);
  });

  it('tanggal ganti larutan tidak disimpan untuk media selain hidroponik', async () => {
    // Menyimpannya akan memunculkan tanggal yang tidak pernah dipakai apa pun.
    seedPlanting('user-1', 'p1', 'kangkung', null);
    await req('/api/garden/media/p1', {
      method: 'PUT',
      body: JSON.stringify({ media: 'polybag', lastSolutionChange: '2026-08-30' }),
    });

    const body = await (await req('/api/garden/media')).json() as {
      daftar: Array<{ lastSolutionChange: string | null }>;
    };
    expect(body.daftar[0].lastSolutionChange).toBeNull();
  });

  it('media tak dikenal jatuh ke tanah, bukan menggagalkan permintaan', async () => {
    seedPlanting('user-1', 'p1', 'kangkung', null);
    const res = await req('/api/garden/media/p1', {
      method: 'PUT', body: JSON.stringify({ media: 'akuaponik' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ media: 'tanah' });
  });

  it('menyetel media penanaman pengguna lain mengembalikan 404', async () => {
    seedPlanting('user-2', 'p-lain', 'kangkung', null);
    const res = await req('/api/garden/media/p-lain', {
      method: 'PUT', body: JSON.stringify({ media: 'hidroponik' }),
    });
    expect(res.status).toBe(404);
  });
});

// ───────────────────────────── KETINGGIAN ─────────────────────────────

describe('ketinggian', () => {
  it('menandai tanaman yang tidak cocok di mdpl tersimpan', async () => {
    // Kentang minta dataran tinggi; kebunnya di pesisir.
    const tinggi = ['kentang', 'wortel', 'brokoli', 'stroberi'];
    const body0 = await (await req('/api/garden/altitude')).json() as { mdpl: number };
    expect(body0.mdpl).toBe(0);

    setSetting('user-1', 'garden.altitude_mdpl', '50');
    let ditandai = false;
    for (const id of tinggi) {
      db.prepare('DELETE FROM garden_plantings WHERE user_id = ?1').bind('user-1').run();
      seedPlanting('user-1', 'p1', id, null);
      const body = await (await req('/api/garden/altitude')).json() as {
        salahTempat: Array<{ status: string; rentang: [number, number] }>;
      };
      if (body.salahTempat.length > 0) {
        expect(body.salahTempat[0].status).toBe('terlalu-rendah');
        ditandai = true;
        break;
      }
    }
    expect(ditandai, 'setidaknya satu tanaman dataran tinggi harus ditandai di 50 mdpl').toBe(true);
  });

  it('tanaman yang cocok tidak ditandai', async () => {
    setSetting('user-1', 'garden.altitude_mdpl', '200');
    seedPlanting('user-1', 'p1', 'kangkung', null);

    const body = await (await req('/api/garden/altitude')).json() as {
      salahTempat: unknown[];
    };
    expect(body.salahTempat).toEqual([]);
  });

  it('mdpl 0 tetap dinilai, bukan dianggap belum diisi', async () => {
    // 0 mdpl adalah jawaban sah untuk kebun di pesisir, dan tanaman dataran
    // tinggi di sana memang tidak cocok.
    const body = await (await req('/api/garden/altitude')).json() as {
      mdpl: number; cocokCount: number;
    };
    expect(body.mdpl).toBe(0);
    expect(body.cocokCount).toBeGreaterThan(0);
  });

  it('menyarankan tanaman yang cocok di ketinggian ini', async () => {
    setSetting('user-1', 'garden.altitude_mdpl', '1200');
    const body = await (await req('/api/garden/altitude')).json() as {
      cocok: Array<{ altitude: string }>;
    };
    expect(body.cocok.length).toBeGreaterThan(0);
    for (const t of body.cocok) {
      expect(t.altitude.toLowerCase(), t.altitude).toMatch(/tinggi/);
    }
  });

  it('pengguna lain punya ketinggian sendiri', async () => {
    setSetting('user-1', 'garden.altitude_mdpl', '1500');
    const body = await (await req('/api/garden/altitude', {}, otherToken)).json() as { mdpl: number };
    expect(body.mdpl).toBe(0);
  });
});
