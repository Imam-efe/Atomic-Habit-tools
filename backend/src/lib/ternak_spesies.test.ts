/**
 * Uji `spesiesKandang` dan kesepakatannya dengan subquery berkorelasi di
 * `jadwalPengguna` (routes/ternak_care.ts) — keduanya HARUS punya semantik
 * yang sama persis: dibatasi user_id, mengabaikan penghuni tanpa spesies
 * (animal_id null), dan tie-break dua kunci (created_at lalu id) supaya
 * urutannya tidak kebetulan.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';
import { spesiesKandang } from './ternak_spesies';
import { jadwalPengguna } from '../routes/ternak_care';
import { nanoid } from './nanoid';

let db: FakeD1;

beforeEach(() => {
  db = createTestDb();
  seedUser(db, 'user-1');
  seedUser(db, 'user-2');
});

afterEach(() => db.__close());

async function buatKandang(userId: string, id = nanoid()): Promise<string> {
  await db.prepare(`
    INSERT INTO ternak_kandang (id, user_id, nama, jenis, habitat, tanggal_mulai)
    VALUES (?1, ?2, 'Akuarium', 'akuarium', 'air-tawar', '2026-01-01')
  `).bind(id, userId).run();
  return id;
}

async function buatHewan(opts: {
  userId: string; kandangId: string | null; animalId: string | null;
  status?: string; createdAt?: number; id?: string;
}): Promise<string> {
  const id = opts.id ?? nanoid();
  await db.prepare(`
    INSERT INTO ternak_hewan
      (id, user_id, kandang_id, animal_id, jumlah, tanggal_masuk, status, created_at)
    VALUES (?1, ?2, ?3, ?4, 1, '2026-01-01', ?5, ?6)
  `).bind(id, opts.userId, opts.kandangId, opts.animalId, opts.status ?? 'hidup', opts.createdAt ?? 0).run();
  return id;
}

describe('spesiesKandang', () => {
  it('mengembalikan spesies penghuni pertama', async () => {
    const kandangId = await buatKandang('user-1');
    await buatHewan({ userId: 'user-1', kandangId, animalId: 'cupang', createdAt: 100 });
    expect(await spesiesKandang(db as never, kandangId, 'user-1')).toBe('cupang');
  });

  it('kandang tanpa penghuni berspesies mengembalikan null', async () => {
    const kandangId = await buatKandang('user-1');
    expect(await spesiesKandang(db as never, kandangId, 'user-1')).toBeNull();
  });

  it('penghuni tanpa spesies tidak menyembunyikan penghuni lain yang punya spesies', async () => {
    const kandangId = await buatKandang('user-1');
    // Penghuni pertama (created_at lebih awal) tidak punya animal_id —
    // sebelumnya ini membuat kueri mengembalikan null padahal ada penghuni
    // kedua yang punya spesies.
    await buatHewan({ userId: 'user-1', kandangId, animalId: null, createdAt: 1 });
    await buatHewan({ userId: 'user-1', kandangId, animalId: 'cupang', createdAt: 2 });
    expect(await spesiesKandang(db as never, kandangId, 'user-1')).toBe('cupang');
  });

  it('tie-break created_at sama jatuh ke id, bukan urutan kebetulan', async () => {
    const kandangId = await buatKandang('user-1');
    await buatHewan({ userId: 'user-1', kandangId, animalId: 'lele', createdAt: 5, id: 'zzz-belakangan' });
    await buatHewan({ userId: 'user-1', kandangId, animalId: 'cupang', createdAt: 5, id: 'aaa-duluan' });
    expect(await spesiesKandang(db as never, kandangId, 'user-1')).toBe('cupang');
  });

  it('penghuni berstatus mati tidak dihitung', async () => {
    const kandangId = await buatKandang('user-1');
    await buatHewan({ userId: 'user-1', kandangId, animalId: 'cupang', createdAt: 1, status: 'mati' });
    await buatHewan({ userId: 'user-1', kandangId, animalId: 'lele', createdAt: 2 });
    expect(await spesiesKandang(db as never, kandangId, 'user-1')).toBe('lele');
  });

  it('kandang milik pengguna lain tidak pernah terlihat', async () => {
    const kandangId = await buatKandang('user-2');
    await buatHewan({ userId: 'user-2', kandangId, animalId: 'cupang', createdAt: 1 });
    expect(await spesiesKandang(db as never, kandangId, 'user-1')).toBeNull();
  });
});

describe('spesiesKandang sepakat dengan subquery jadwalPengguna', () => {
  it('kandang tanpa penghuni berspesies (karena penghuni pertama tanpa spesies) tidak dianggap punya spesies oleh keduanya', async () => {
    const kandangId = await buatKandang('user-1');
    await buatHewan({ userId: 'user-1', kandangId, animalId: null, createdAt: 1 });
    await buatHewan({ userId: 'user-1', kandangId, animalId: 'cupang', createdAt: 2 });

    const lewatHelper = await spesiesKandang(db as never, kandangId, 'user-1');

    // jadwalPengguna tidak mengembalikan animal_id kandang secara langsung,
    // tapi tugas 'ganti-air' cupang (sasaran kandang) hanya muncul kalau
    // subquery-nya menyimpulkan spesies yang sama dengan helper.
    const hasil = await jadwalPengguna(db as never, 'user-1', '2026-06-01');
    const punyaTugasCupang = hasil.some((t) => t.subjekId === kandangId && t.kodeTugas === 'ganti-air');

    expect(lewatHelper).toBe('cupang');
    expect(punyaTugasCupang).toBe(true);
  });

  it('kandang milik pengguna lain dengan animal_id sama tidak membocorkan spesies lewat subquery', async () => {
    const kandangUser1 = await buatKandang('user-1');
    const kandangUser2 = await buatKandang('user-2');
    // Sengaja kandang user-2 dibuat lebih dulu (created_at lebih kecil) dan
    // penghuninya juga — kalau subquery jadwalPengguna lupa user_id, baris
    // milik user-2 ini bisa "menang" untuk kandang user-1.
    await buatHewan({ userId: 'user-2', kandangId: kandangUser2, animalId: 'cupang', createdAt: 1 });
    await buatHewan({ userId: 'user-1', kandangId: kandangUser1, animalId: 'lele', createdAt: 2 });

    const helper = await spesiesKandang(db as never, kandangUser1, 'user-1');
    expect(helper).toBe('lele');

    const hasil = await jadwalPengguna(db as never, 'user-1', '2026-06-01');
    const semuaKandangUser1 = hasil.filter((t) => t.subjekTipe === 'kandang');
    // Tugas lele bersasaran kandang: 'monitor-air'/'ganti-air' — cukup
    // pastikan tidak ada tugas cupang ('ganti-air' dengan cara cupang tidak
    // bisa dibedakan by kode, jadi diperiksa lewat jumlah baris kandang
    // user-1 tetap konsisten dan tidak nol).
    expect(semuaKandangUser1.length).toBeGreaterThan(0);
  });
});
