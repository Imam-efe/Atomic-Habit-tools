/**
 * Uji alat `ternak.catat` (agent_tools.ts) langsung lewat `tool.run`, bukan
 * lewat AI — yang diuji di sini adalah SETELAH nama tugas dicocokkan:
 * kecocokan harus disaring ke sasaran subjek yang sedang dicatat, kecocokan
 * silang dialihkan ke subjek yang benar kalau mungkin, dan yang tidak
 * tercocokkan sama sekali ditolak dengan pesan yang menyebut nama tugas yang
 * valid — bukan diam-diam menyimpan kode karangan yang tidak akan pernah
 * terbaca jadwal.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';
import { TOOLS, ToolError, type ToolContext } from './agent_tools';
import { nanoid } from './nanoid';

let db: FakeD1;

beforeEach(() => {
  db = createTestDb();
  seedUser(db, 'user-1');
});

afterEach(() => db.__close());

const catat = TOOLS.find((t) => t.name === 'ternak.catat')!;

function ctx(): ToolContext {
  return { db: db as never, userId: 'user-1', today: '2026-06-01' };
}

async function buatKandang(id = nanoid()): Promise<string> {
  await db.prepare(`
    INSERT INTO ternak_kandang (id, user_id, nama, jenis, habitat, tanggal_mulai)
    VALUES (?1, 'user-1', 'Akuarium', 'akuarium', 'air-tawar', '2026-01-01')
  `).bind(id).run();
  return id;
}

async function buatHewan(opts: { kandangId: string | null; animalId: string | null; namaPanggilan?: string }): Promise<string> {
  const id = nanoid();
  await db.prepare(`
    INSERT INTO ternak_hewan (id, user_id, kandang_id, animal_id, nama_panggilan, jumlah, tanggal_masuk)
    VALUES (?1, 'user-1', ?2, ?3, ?4, 1, '2026-01-01')
  `).bind(id, opts.kandangId, opts.animalId, opts.namaPanggilan ?? null).run();
  return id;
}

async function logTerakhir(): Promise<{ subjekTipe: string; subjekId: string; kodeTugas: string } | null> {
  return db.prepare(
    'SELECT subjek_tipe AS subjekTipe, subjek_id AS subjekId, kode_tugas AS kodeTugas FROM ternak_log ORDER BY created_at DESC LIMIT 1'
  ).first<{ subjekTipe: string; subjekId: string; kodeTugas: string }>();
}

describe('ternak.catat', () => {
  it('mencocokkan tugas bersasaran hewan pada subjek hewan', async () => {
    // cupang cuma punya tugas bersasaran kandang (ganti-air, bersih-wadah).
    // kucing-domestik punya 'timbang' bersasaran hewan — kasus yang tidak
    // ambigu untuk memastikan jalur normal masih bekerja.
    const hewanId = await buatHewan({ kandangId: null, animalId: 'kucing-domestik', namaPanggilan: 'Mimi' });

    const hasil = await catat.run(ctx(), { subjek: 'Mimi', tugas: 'timbang berat' });
    expect(hasil.ringkasan).toContain('Mimi');

    const log = await logTerakhir();
    expect(log?.subjekTipe).toBe('hewan');
    expect(log?.subjekId).toBe(hewanId);
    expect(log?.kodeTugas).toBe('timbang');
  });

  it('tidak mencocokkan tugas bersasaran kandang ke subjek hewan begitu saja — dialihkan ke kandangnya', async () => {
    const kandangId = await buatKandang();
    const hewanId = await buatHewan({ kandangId, animalId: 'cupang', namaPanggilan: 'Bewok' });

    const hasil = await catat.run(ctx(), { subjek: 'Bewok', tugas: 'ganti air' });
    expect(hasil.ringkasan.toLowerCase()).toContain('kandang');

    const log = await logTerakhir();
    // 'ganti-air' bersasaran kandang, jadi harus tersimpan atas nama
    // kandangnya, bukan atas nama hewan Bewok — kalau tidak, jadwalPengguna
    // (yang mencari log ini di kandang) tidak akan pernah membacanya.
    expect(log?.subjekTipe).toBe('kandang');
    expect(log?.subjekId).toBe(kandangId);
    expect(log?.kodeTugas).toBe('ganti-air');
    void hewanId;
  });

  it('hewan tanpa kandang: tugas kandang yang dicocokkan tidak punya subjek pengalihan, jadi ditolak', async () => {
    const hewanId = await buatHewan({ kandangId: null, animalId: 'cupang', namaPanggilan: 'Bewok' });
    await expect(catat.run(ctx(), { subjek: 'Bewok', tugas: 'ganti air' })).rejects.toThrow(ToolError);
    void hewanId;
  });

  it('menolak nama tugas yang tidak cocok sama sekali dan menyebut tugas yang valid', async () => {
    await buatHewan({ kandangId: null, animalId: 'kucing-domestik', namaPanggilan: 'Mimi' });

    await expect(
      catat.run(ctx(), { subjek: 'Mimi', tugas: 'terbang keliling rumah' })
    ).rejects.toThrow(ToolError);

    try {
      await catat.run(ctx(), { subjek: 'Mimi', tugas: 'terbang keliling rumah' });
      expect.fail('harus melempar ToolError');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      const pesan = (err as ToolError).message;
      expect(pesan).toContain('Vaksin tahunan');
    }

    const log = await logTerakhir();
    expect(log).toBeNull();
  });

  it('hewan di luar katalog (tanpa spesies) tetap boleh dicatat bebas', async () => {
    const hewanId = await buatHewan({ kandangId: null, animalId: null, namaPanggilan: 'Kiki' });
    const hasil = await catat.run(ctx(), { subjek: 'Kiki', tugas: 'bersihkan kandang burung' });
    expect(hasil.ringkasan).toContain('Kiki');

    const log = await logTerakhir();
    expect(log?.subjekTipe).toBe('hewan');
    expect(log?.subjekId).toBe(hewanId);
  });

  it('kandang yang tugasnya cocok dengan tugas bersasaran hewan spesiesnya: tidak dialihkan, ditolak', async () => {
    // ular-jagung punya tugas 'cek-ganti-kulit' bersasaran hewan. Kandangnya
    // tidak boleh mencatat tugas itu atas nama dirinya sendiri — kalaupun
    // dialihkan, tidak ada satu ekor tunggal yang jadi tujuannya kalau
    // penghuninya lebih dari satu.
    const kandangId = await buatKandang();
    await buatHewan({ kandangId, animalId: 'ular-jagung' });

    await expect(
      catat.run(ctx(), { subjek: 'Akuarium', tugas: 'cek ganti kulit' })
    ).rejects.toThrow(ToolError);
    void kandangId;
  });
});
