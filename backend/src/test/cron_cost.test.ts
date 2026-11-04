/**
 * Uji biaya kueri cron, dan bahwa penghematannya tidak menghilangkan pekerjaan.
 *
 * Cron aplikasi ini menyala tiap menit — 1440 kali sehari — karena pengingat
 * kebiasaan dan kalender memakai jam:menit. Tapi sebagian besar isinya berbasis
 * JAM, dan dulu tiap trigger menanyakan database lebih dulu sebelum menyimpulkan
 * bahwa jamnya belum cocok. D1 menagih BARIS YANG DIBACA, jadi 59 dari 60 tick
 * membakar kuota untuk jawaban yang langsung dibuang.
 *
 * Dua sifat yang dijaga di sini, dan keduanya harus dijaga bersamaan karena
 * masing-masing sendirian bisa dipenuhi dengan cara yang salah:
 *
 * 1. Tick di LUAR jendela awal jam harus murah. Kalau ini saja yang diuji,
 *    "perbaikan" yang mematikan seluruh notifikasi akan lulus.
 * 2. Tick di DALAM jendela harus tetap mengirim notifikasinya. Kalau ini saja
 *    yang diuji, kode yang bertanya tiap menit tetap lulus.
 *
 * Ambang di uji ini bukan angka keramat; ia penjaga agar pola N+1 dan
 * pemindaian tiap menit tidak pelan-pelan kembali. Kalau sebuah fitur baru
 * memang butuh kueri tambahan di jalur cron, angkanya dinaikkan dengan sadar —
 * bukan dibiarkan merayap.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import handler from '../index';
import { createTestDb, seedUser, type FakeD1 } from './d1';

afterEach(() => { vi.useRealTimers(); });

function seedPengguna(db: FakeD1, userId: string) {
  const q = (sql: string, ...b: unknown[]) => db.prepare(sql).bind(...b).run();
  q(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
     VALUES (?1, ?2, ?3, 'k', 'a', 0)`,
    `p-${userId}`, userId, `https://contoh.test/${userId}`
  );
  q(
    `INSERT INTO garden_plantings (id, user_id, plant_id, quantity, planted_date, status, created_at)
     VALUES (?1, ?2, 'cabai-merah', 1, '2026-01-01', 'tumbuh', 0)`,
    `g-${userId}`, userId
  );
  q(`INSERT INTO habits (id, user_id, name, created_at) VALUES (?1, ?2, 'Olahraga', 0)`,
    `hb-${userId}`, userId);
}

/** Satu tick cron pada jam:menit WIB tertentu, dengan pencatat kueri. */
async function tick(jamWib: number, menit: number, jumlahPengguna: number) {
  const db = createTestDb();
  for (let i = 1; i <= jumlahPengguna; i++) {
    seedUser(db, `u${i}`);
    seedPengguna(db, `u${i}`);
  }

  let kueri = 0;
  let kueriPengaturan = 0;
  const asli = db.prepare.bind(db);
  (db as unknown as { prepare: (s: string) => unknown }).prepare = (sql: string) => {
    kueri++;
    if (/FROM user_settings/.test(sql)) kueriPengaturan++;
    return asli(sql);
  };

  vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, (jamWib - 7 + 24) % 24, menit, 0)));

  const tunggu: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { tunggu.push(p); },
    passThroughOnException: () => {},
  };
  const env = { DB: db, JWT_SECRET: 'x', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' } as never;

  await (handler as never as {
    scheduled: (e: unknown, env: unknown, c: unknown) => Promise<void>;
  }).scheduled({ cron: '* * * * *' } as never, env, ctx as never);
  await Promise.allSettled(tunggu);

  return { kueri, kueriPengaturan, db };
}

describe('biaya kueri cron', () => {
  it('tick di luar jendela awal jam sangat murah', async () => {
    // Menit 7: di luar jendela. Hanya yang benar-benar butuh granularitas
    // menit yang boleh bertanya — pengingat kebiasaan, kalender, dan
    // notifikasi terjadwal.
    const { kueri, db } = await tick(12, 7, 3);
    expect(kueri).toBeLessThanOrEqual(6);
    db.__close();
  });

  it('biaya tick menganggur tidak tumbuh seiring jumlah pengguna', async () => {
    // Inilah sifat yang paling penting. Pola lamanya satu kueri pengaturan PER
    // PENGGUNA di dalam loop, jadi biayanya naik linear: dua puluh pengguna
    // berarti dua puluh kali lipat, tiap menit, selamanya.
    const tiga = await tick(12, 7, 3);
    const duaPuluh = await tick(12, 7, 20);
    expect(duaPuluh.kueri).toBe(tiga.kueri);
    tiga.db.__close();
    duaPuluh.db.__close();
  });

  it('pembacaan pengaturan di dalam jendela tidak tumbuh seiring pengguna', async () => {
    // Uji ini mengukur DI DALAM jendela, dan itu intinya. Uji tick menganggur
    // di atas tidak bisa melihat pola N+1 sama sekali: penjaga jam memotong
    // trigger-nya sebelum loop per-penggunanya jalan, jadi mengembalikan N+1
    // tetap lolos di sana. Percobaan pertama uji ini memang begitu.
    //
    // Pekerjaan nyata (mengirim push) memang tumbuh seiring pengguna. Yang
    // TIDAK boleh tumbuh adalah pembacaan pengaturannya: itu satu kueri per
    // trigger, bukan satu per pengguna per trigger.
    // Menit berbeda, keduanya tetap di dalam jendela 0-4. Memo penerima di
    // daily_push.ts dikunci pada menit berjalan dan bertahan antar tick —
    // memang begitu maunya di produksi, tapi dua tick bermenit sama di sini
    // akan membuat tick kedua memakai memo tick pertama dan ujinya mengukur
    // artefak. (Percobaan pertama uji ini memang begitu: 20 pengguna terbaca
    // LEBIH murah daripada 3.)
    const tiga = await tick(6, 1, 3);
    const duaPuluh = await tick(6, 3, 20);

    expect(tiga.kueriPengaturan).toBeGreaterThan(0);
    expect(duaPuluh.kueriPengaturan).toBe(tiga.kueriPengaturan);

    // Batas absolut, selain sifat "tidak tumbuh" di atas. Keduanya diperlukan:
    // memo penerima di daily_push.ts menghemat FAKTOR TETAP — empat trigger
    // membaca jawaban yang sama — dan penghematan faktor tetap tidak terlihat
    // oleh perbandingan 3-vs-20 pengguna sama sekali. Tanpa batas ini,
    // mematikan memo itu tetap lolos.
    // Terukur 4 dengan memo, 7 tanpa. Batasnya 5 — cukup longgar untuk satu
    // trigger baru, cukup ketat untuk menangkap hilangnya memo.
    expect(tiga.kueriPengaturan).toBeLessThanOrEqual(5);

    // Dan pekerjaan nyatanya memang ikut tumbuh — supaya uji di atas tidak
    // lolos hampa karena ternyata tidak ada yang dikerjakan sama sekali.
    expect(duaPuluh.kueri).toBeGreaterThan(tiga.kueri);

    tiga.db.__close();
    duaPuluh.db.__close();
  });

  it('tetap mengirim notifikasi di dalam jendela awal jam', async () => {
    // Pasangan uji di atas. Tanpa ini, mematikan seluruh notifikasi akan
    // terlihat sebagai penghematan yang sempurna.
    const { db } = await tick(6, 2, 2);

    const terkirim = await db.prepare(
      `SELECT COUNT(*) AS n FROM notification_events`
    ).first<{ n: number }>();
    expect(terkirim!.n).toBeGreaterThan(0);
    db.__close();
  });

  it('tidak mengirim notifikasi berbasis jam di luar jendela', async () => {
    // Bukan kehilangan notifikasi: jam 6 menit 7 berarti brief paginya sudah
    // terkirim lima menit sebelumnya pada tick di dalam jendela. Yang diuji di
    // sini adalah penjaganya benar-benar memotong di hulu.
    const { db } = await tick(6, 7, 2);

    const terkirim = await db.prepare(
      `SELECT COUNT(*) AS n FROM notification_events`
    ).first<{ n: number }>();
    expect(terkirim!.n).toBe(0);
    db.__close();
  });

  it('pembersihan baris kedaluwarsa hanya jalan sekali sehari', async () => {
    // Empat DELETE pembersih dulu jalan tiap menit. Yang dihapusnya berumur
    // tujuh sampai tiga puluh hari, jadi 1439 panggilan sisanya tidak pernah
    // menghapus apa pun — hanya menyentuh indeks tabelnya 1439 kali.
    const db = createTestDb();
    seedUser(db, 'u1');
    await db.prepare(
      `INSERT INTO notification_events (id, user_id, type, title, body, created_at)
       VALUES ('lama', 'u1', 'test', 'Lama', 'Lama', unixepoch() - 30 * 86400)`
    ).run();

    const jalankan = async (jam: number, menit: number) => {
      vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, (jam - 7 + 24) % 24, menit, 0)));
      const tunggu: Promise<unknown>[] = [];
      const ctx = { waitUntil: (p: Promise<unknown>) => { tunggu.push(p); }, passThroughOnException: () => {} };
      await (handler as never as { scheduled: (e: unknown, env: unknown, c: unknown) => Promise<void> })
        .scheduled({ cron: '* * * * *' } as never,
          { DB: db, JWT_SECRET: 'x' } as never, ctx as never);
      await Promise.allSettled(tunggu);
      return (await db.prepare(`SELECT COUNT(*) AS n FROM notification_events WHERE id = 'lama'`)
        .first<{ n: number }>())!.n;
    };

    // Jam 12: bukan jam pembersihan, barisnya harus masih ada.
    expect(await jalankan(12, 7)).toBe(1);
    // Jam 03:10 WIB: jendela pembersihan.
    expect(await jalankan(3, 10)).toBe(0);
    db.__close();
  });
});
