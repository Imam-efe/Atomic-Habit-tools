/**
 * Uji rute kandang dan hewan terhadap skema produksi.
 *
 * Yang paling penting bukan bentuk JSON-nya, melainkan bahwa setiap kueri
 * membawa user_id: kandang orang lain tidak boleh terbaca, terisi, atau
 * terhapus.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import ternak from './ternak';
import { Hono } from 'hono';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';

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

describe('kandang', () => {
  it('dibuat lalu terbaca kembali', async () => {
    const { res } = await buatKandang();
    expect(res.status).toBe(201);

    const body = await (await req('/api/ternak')).json() as {
      kandang: Array<{ nama: string; jumlahPenghuni: number }>;
      ringkasan: { kandangAktif: number };
    };
    expect(body.kandang).toHaveLength(1);
    expect(body.kandang[0].nama).toBe('Akuarium depan');
    expect(body.kandang[0].jumlahPenghuni).toBe(0);
    expect(body.ringkasan.kandangAktif).toBe(1);
  });

  it('menolak nama kosong', async () => {
    const { res } = await buatKandang({ nama: '   ' });
    expect(res.status).toBe(400);
  });

  it('menolak habitat di luar daftar', async () => {
    const { res } = await buatKandang({ habitat: 'luar-angkasa' });
    expect(res.status).toBe(400);
  });

  it('menolak jenis di luar daftar', async () => {
    const { res } = await buatKandang({ jenis: 'lemari' });
    expect(res.status).toBe(400);
  });

  it('PATCH milik orang lain 404 dan tidak mengubah apa pun', async () => {
    const { id } = await buatKandang();
    const res = await req(`/api/ternak/kandang/${id}`, {
      method: 'PATCH', body: JSON.stringify({ nama: 'Dibajak' }),
    }, otherToken);
    expect(res.status).toBe(404);

    const body = await (await req('/api/ternak')).json() as { kandang: Array<{ nama: string }> };
    expect(body.kandang[0].nama).toBe('Akuarium depan');
  });

  it('DELETE milik orang lain 404, milik sendiri 200', async () => {
    const { id } = await buatKandang();
    expect((await req(`/api/ternak/kandang/${id}`, { method: 'DELETE' }, otherToken)).status).toBe(404);
    expect((await req(`/api/ternak/kandang/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await req(`/api/ternak/kandang/${id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('kandang orang lain tidak pernah muncul di daftar', async () => {
    await buatKandang({ nama: 'Punya tetangga' }, otherToken);
    const body = await (await req('/api/ternak')).json() as { kandang: unknown[] };
    expect(body.kandang).toHaveLength(0);
  });
});

describe('hewan', () => {
  it('ditambahkan ke kandang dan ikut terhitung sebagai penghuni', async () => {
    const { id: kandangId } = await buatKandang();
    const res = await req('/api/ternak/hewan', {
      method: 'POST',
      body: JSON.stringify({
        kandangId, animalId: 'cupang', namaPanggilan: 'Si Biru',
        jumlah: 1, tanggalMasuk: '2026-02-01',
      }),
    });
    expect(res.status).toBe(201);

    const body = await (await req('/api/ternak')).json() as {
      kandang: Array<{ jumlahPenghuni: number }>;
      hewan: Array<{ nama: string; animalId: string }>;
      ringkasan: { hewanHidup: number; ekorTotal: number };
    };
    expect(body.kandang[0].jumlahPenghuni).toBe(1);
    expect(body.hewan[0].nama).toBe('Si Biru');
    expect(body.ringkasan.hewanHidup).toBe(1);
  });

  it('hewan tanpa kandang tetap boleh dicatat', async () => {
    // Kucing rumahan tidak berkandang. Memaksanya punya kandang bernama
    // "Rumah" adalah baris palsu yang harus dijelaskan di setiap layar.
    const res = await req('/api/ternak/hewan', {
      method: 'POST',
      body: JSON.stringify({ animalId: 'kucing-domestik', namaPanggilan: 'Mimi', tanggalMasuk: '2026-01-15' }),
    });
    expect(res.status).toBe(201);
    const body = await (await req('/api/ternak')).json() as { hewan: Array<{ kandangId: string | null }> };
    expect(body.hewan[0].kandangId).toBeNull();
  });

  it('menolak kandang milik orang lain', async () => {
    const { id } = await buatKandang({}, otherToken);
    const res = await req('/api/ternak/hewan', {
      method: 'POST',
      body: JSON.stringify({ kandangId: id, animalId: 'cupang', tanggalMasuk: '2026-02-01' }),
    });
    expect(res.status).toBe(404);
  });

  it('hewan di luar katalog boleh, asal punya nama sendiri', async () => {
    const ok = await req('/api/ternak/hewan', {
      method: 'POST',
      body: JSON.stringify({ namaKustom: 'Burung hantu warisan', tanggalMasuk: '2026-02-01' }),
    });
    expect(ok.status).toBe(201);

    const gagal = await req('/api/ternak/hewan', {
      method: 'POST', body: JSON.stringify({ tanggalMasuk: '2026-02-01' }),
    });
    expect(gagal.status).toBe(400);
  });

  it('jumlah minimal satu', async () => {
    const res = await req('/api/ternak/hewan', {
      method: 'POST',
      body: JSON.stringify({ animalId: 'lele', jumlah: 0, tanggalMasuk: '2026-02-01' }),
    });
    expect(res.status).toBe(400);
  });

  it('status mati berhenti dihitung tapi barisnya tetap ada', async () => {
    const id = (await (await req('/api/ternak/hewan', {
      method: 'POST',
      body: JSON.stringify({ animalId: 'cupang', jumlah: 1, tanggalMasuk: '2026-02-01' }),
    })).json() as { id: string }).id;

    await req(`/api/ternak/hewan/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'mati' }) });

    const body = await (await req('/api/ternak')).json() as {
      hewan: Array<{ status: string }>; ringkasan: { hewanHidup: number };
    };
    expect(body.ringkasan.hewanHidup).toBe(0);
    expect(body.hewan).toHaveLength(1);
    expect(body.hewan[0].status).toBe('mati');
  });

  it('menolak status di luar daftar', async () => {
    const id = (await (await req('/api/ternak/hewan', {
      method: 'POST', body: JSON.stringify({ animalId: 'cupang', tanggalMasuk: '2026-02-01' }),
    })).json() as { id: string }).id;

    const res = await req(`/api/ternak/hewan/${id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'entah' }),
    });
    expect(res.status).toBe(400);
  });

  it('memindahkan hewan ke kandang lain milik sendiri', async () => {
    const { id: k1 } = await buatKandang({ nama: 'Tangki A' });
    const { id: k2 } = await buatKandang({ nama: 'Tangki B' });
    const id = (await (await req('/api/ternak/hewan', {
      method: 'POST', body: JSON.stringify({ kandangId: k1, animalId: 'cupang', tanggalMasuk: '2026-02-01' }),
    })).json() as { id: string }).id;

    expect((await req(`/api/ternak/hewan/${id}`, {
      method: 'PATCH', body: JSON.stringify({ kandangId: k2 }),
    })).status).toBe(200);

    const body = await (await req('/api/ternak')).json() as { hewan: Array<{ kandangId: string }> };
    expect(body.hewan[0].kandangId).toBe(k2);
  });

  it('menolak memindahkan hewan ke kandang milik orang lain', async () => {
    const id = (await (await req('/api/ternak/hewan', {
      method: 'POST', body: JSON.stringify({ animalId: 'cupang', tanggalMasuk: '2026-02-01' }),
    })).json() as { id: string }).id;
    const { id: kandangOrangLain } = await buatKandang({}, otherToken);

    const res = await req(`/api/ternak/hewan/${id}`, {
      method: 'PATCH', body: JSON.stringify({ kandangId: kandangOrangLain }),
    });
    expect(res.status).toBe(404);

    // 404 yang diam-diam tetap menulis lebih berbahaya daripada 404 biasa —
    // pastikan hewan ini tidak ikut pindah ke kandang orang lain.
    const body = await (await req('/api/ternak')).json() as { hewan: Array<{ kandangId: string | null }> };
    expect(body.hewan[0].kandangId).toBeNull();
  });

  it('kebun kosong menghasilkan ringkasan nol, bukan galat', async () => {
    const body = await (await req('/api/ternak')).json() as {
      ringkasan: { kandangAktif: number; hewanHidup: number; ekorTotal: number };
    };
    expect(body.ringkasan).toEqual({ kandangAktif: 0, hewanHidup: 0, ekorTotal: 0 });
  });
});
