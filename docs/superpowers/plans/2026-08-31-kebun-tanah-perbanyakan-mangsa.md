# Kebun: Tanah, Perbanyakan, Mangsa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghidupkan tiga kolom katalog yang selama ini data mati (`phRange`, `altitude`, `propagation`), menambah kalender Pranata Mangsa, jadwal semai mundur, media tanam non-tanah, dan tanaman mikrogreen.

**Architecture:** Pola yang sama dengan batch peta-matahari (migrasi 0036): satu migrasi idempoten tanpa `ALTER TABLE`, logika murni di `backend/src/lib/garden_*.ts` yang diuji tanpa database, endpoint di satu berkas rute baru `garden_extra4.ts`, dan satu berkas layar frontend baru yang dipasang ke tab yang sudah ada. Kunci lokasi memakai perjanjian modul kebun yang berlaku: `bed_id` apa adanya, atau `loc:<teks>`.

**Tech Stack:** Cloudflare Workers + Hono + D1 (SQLite), TypeScript, Vitest, React + Vite.

**Spec:** Rekomendasi Tier A + Tier B pada percakapan 2026-08-31. Tidak ada berkas spec terpisah — plan ini yang menjadi kontraknya.

## Global Constraints

- Migrasi WAJIB idempoten. Tidak boleh ada `ALTER TABLE` — skrip `db:migrate` dijalankan ulang tiap deploy. Pakai `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` saja.
- Migrasi baru WAJIB didaftarkan ke `backend/package.json` pada `db:migrate` **dan** `db:migrate:remote`. Tabel yang tidak terdaftar tidak pernah dibuat di produksi.
- Tabel milik pengguna WAJIB masuk `DATA_TABLES` di `backend/src/routes/settings.ts` supaya ikut ekspor dan hitung-baris.
- Setiap endpoint WAJIB memeriksa `user_id` sebelum membaca atau menulis. Pengguna lain tidak boleh menyentuh data pengguna ini.
- Semua tanggal `YYYY-MM-DD`. Perhitungan tanggal memakai metode UTC saja (`new Date(\`${d}T00:00:00Z\`)`, `getUTC*`) — jangan pernah metode lokal, DST menggeser hasilnya.
- Semua teks yang dilihat pengguna dalam Bahasa Indonesia.
- Komentar kode ditulis seperti berkas kebun yang sudah ada: menjelaskan **kenapa**, bukan mengulang **apa**.
- `garden_extra4` dipasang SEBELUM `garden` di `src/index.ts` — `garden.ts` punya rute `/:id` yang menelan path apa pun yang datang sesudahnya.
- Tanaman hias punya `daysToHarvest: null`. Kode apa pun yang menyentuh umur panen wajib menanganinya eksplisit.

---

### Task 1: Migrasi 0037 + pendaftaran

**Files:**
- Create: `backend/migrations/0037_kebun_tanah_perbanyakan.sql`
- Modify: `backend/package.json` (skrip `db:migrate` dan `db:migrate:remote`)
- Modify: `backend/src/routes/settings.ts:39` (sisipkan sesudah baris `garden_saved_seed`)

**Interfaces:**
- Consumes: tabel `users`, `garden_plantings`, `garden_beds` yang sudah ada.
- Produces: tabel `garden_soil_test`, `garden_propagation`, `garden_planting_media`.

- [ ] **Step 1: Tulis migrasi**

```sql
-- Uji tanah per lokasi, catatan perbanyakan, dan media tanam non-tanah.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE.

-- #1 Hasil uji tanah di satu lokasi.
--
-- Katalog menyimpan `phRange` ideal tiap tanaman sejak awal, tapi tidak ada
-- satu pun tempat yang tahu pH tanah yang SEBENARNYA di kebun ini — jadi
-- angka ideal itu tidak pernah bisa dibandingkan dengan apa pun. Ini sisi
-- yang hilang, persis seperti jam matahari sebelum garden_sun_profile ada.
--
-- Baris per pengujian, bukan satu baris per lokasi: pH bergerak setelah
-- dikapur atau dipupuk, dan yang berguna justru melihat arah geraknya.
CREATE TABLE IF NOT EXISTS garden_soil_test (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lokasi_id TEXT NOT NULL,                  -- bed_id, atau 'loc:<teks lokasi>'
  lokasi_label TEXT NOT NULL,
  ph REAL NOT NULL,
  -- Tekstur ikut dicatat karena menentukan saran: tanah pasir butuh dosis
  -- kapur jauh lebih kecil daripada tanah liat untuk menggeser pH yang sama.
  texture TEXT,                             -- pasir | lempung | liat
  tested_date TEXT NOT NULL,                -- YYYY-MM-DD
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_soil_test_user
  ON garden_soil_test(user_id, lokasi_id, tested_date DESC);

-- #2 Percobaan perbanyakan: stek, cangkok, okulasi, anakan, rimpang.
--
-- Kolom `propagation` di katalog selama ini hanya dirender sebagai baris teks
-- di modal detail. Ia memberi tahu CARA memperbanyak, tapi tidak ada yang
-- mencatat apakah caranya berhasil di tangan pengguna ini. Tabel ini yang
-- menutup lingkarannya: benih -> tanam -> panen -> benih ATAU stek -> tanam.
--
-- source_planting_id ON DELETE SET NULL, bukan CASCADE: menghapus catatan
-- tanaman induk tidak boleh melenyapkan stek yang sudah berakar di polybag.
CREATE TABLE IF NOT EXISTS garden_propagation (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plant_id TEXT,                            -- id katalog bila dikenali
  custom_name TEXT,                         -- dipakai kalau di luar katalog
  source_planting_id TEXT REFERENCES garden_plantings(id) ON DELETE SET NULL,
  method TEXT NOT NULL,                     -- stek | cangkok | okulasi | anakan | rimpang | umbi | daun
  started_date TEXT NOT NULL,               -- YYYY-MM-DD
  count_started INTEGER NOT NULL,
  -- NULL berarti belum dihitung. 0 adalah jawaban sah dan justru yang paling
  -- penting: satu batch stek bisa gagal total, dan itu data tentang metodenya.
  count_rooted INTEGER,
  rooted_date TEXT,
  -- Diisi kalau stek yang jadi akhirnya ditanam sebagai tanaman baru.
  planting_id TEXT REFERENCES garden_plantings(id) ON DELETE SET NULL,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_propagation_user
  ON garden_propagation(user_id, started_date DESC);
CREATE INDEX IF NOT EXISTS idx_garden_propagation_plant
  ON garden_propagation(user_id, plant_id);

-- #3 Media tanam satu penanaman, kalau bukan tanah biasa.
--
-- Tabel pendamping, bukan kolom di garden_plantings: kebanyakan penanaman
-- memang di tanah/polybag dan tidak perlu baris di sini, dan ALTER TABLE
-- tidak boleh ada di skrip migrasi yang dijalankan ulang tiap deploy.
--
-- Yang berubah bukan sekadar label. Untuk hidroponik, "siram tiap N hari"
-- adalah nasihat yang salah — yang benar cek EC/pH larutan dan ganti larutan.
CREATE TABLE IF NOT EXISTS garden_planting_media (
  planting_id TEXT PRIMARY KEY REFERENCES garden_plantings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media TEXT NOT NULL,                      -- tanah | polybag | hidroponik | vertikultur | tabulampot
  -- Hanya untuk hidroponik; NULL untuk media lain.
  last_solution_change TEXT,                -- YYYY-MM-DD
  note TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_planting_media_user
  ON garden_planting_media(user_id, media);
```

- [ ] **Step 2: Daftarkan migrasi ke package.json**

Tambahkan pada akhir rantai `db:migrate` **dan** `db:migrate:remote`, tepat sesudah `0036_kebun_matahari_benih.sql`:

```
&& wrangler d1 execute fayolla-db --file=./migrations/0037_kebun_tanah_perbanyakan.sql
```

(`db:migrate:remote` memakai bentuk yang sama ditambah flag `--remote` seperti entri lain di skrip itu — salin persis bentuk entri `0036` di baris yang sama.)

- [ ] **Step 3: Daftarkan tabel ke DATA_TABLES**

Di `backend/src/routes/settings.ts`, sesudah baris `garden_saved_seed`:

```ts
  { table: 'garden_soil_test', label: 'Uji tanah', group: 'Kebun', userScoped: true },
  { table: 'garden_propagation', label: 'Perbanyakan (stek/cangkok)', group: 'Kebun', userScoped: true },
  { table: 'garden_planting_media', label: 'Media tanam', group: 'Kebun', userScoped: true },
```

- [ ] **Step 4: Verifikasi idempoten**

Jalankan `npm run db:migrate` **tiga kali berturut-turut** dari `backend/`.
Expected: ketiganya selesai tanpa galat. Kalau lewat pertama lolos tapi kedua gagal, ada DDL yang tidak idempoten — perbaiki sebelum lanjut.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/0037_kebun_tanah_perbanyakan.sql backend/package.json backend/src/routes/settings.ts
git commit -m "feat(kebun): migrasi uji tanah, perbanyakan, dan media tanam"
```

---

### Task 2: `garden_altitude.ts` — cocokkan ketinggian kebun

**Files:**
- Create: `backend/src/lib/garden_altitude.ts`
- Test: `backend/src/lib/garden_altitude.test.ts`

**Interfaces:**
- Consumes: `Plant.altitude` (teks bebas) dari `backend/src/data/plants.ts`.
- Produces:
  - `export type Band = 'rendah' | 'menengah' | 'tinggi'`
  - `export const BAND_MDPL: Record<Band, [number, number]>`
  - `export function parseAltitude(text: string): [number, number]`
  - `export function cocokKetinggian(text: string, mdpl: number): 'cocok' | 'terlalu-rendah' | 'terlalu-tinggi'`

Katalog hanya memakai lima nilai: `rendah`, `rendah sampai menengah`, `rendah sampai tinggi`, `menengah sampai tinggi`, `tinggi`. Semuanya tersusun dari tiga kata yang sama, jadi cukup dicocokkan kata kunci — tidak perlu AI untuk membaca sesuatu yang sudah tertulis jelas (pola yang sama dengan `garden_season.ts`).

- [ ] **Step 1: Tulis tes yang gagal**

```ts
import { describe, it, expect } from 'vitest';
import { parseAltitude, cocokKetinggian, BAND_MDPL } from './garden_altitude';
import { PLANTS } from '../data/plants';

describe('parseAltitude', () => {
  it('membaca satu band', () => {
    expect(parseAltitude('rendah')).toEqual([0, 400]);
    expect(parseAltitude('tinggi')).toEqual([700, 2000]);
  });

  it('membaca rentang "A sampai B"', () => {
    expect(parseAltitude('rendah sampai menengah')).toEqual([0, 700]);
    expect(parseAltitude('rendah sampai tinggi')).toEqual([0, 2000]);
    expect(parseAltitude('menengah sampai tinggi')).toEqual([400, 2000]);
  });

  it('teks tak dikenal jadi rentang terbuka, bukan kosong', () => {
    // Menyembunyikan tanaman karena teksnya tidak terbaca jauh lebih buruk
    // daripada tidak memberi peringatan apa pun.
    expect(parseAltitude('')).toEqual([0, 2000]);
    expect(parseAltitude('dataran pantai berangin')).toEqual([0, 2000]);
  });

  it('semua nilai altitude di katalog terbaca', () => {
    for (const p of PLANTS) {
      const [min, max] = parseAltitude(p.altitude);
      expect(max, p.id).toBeGreaterThan(min);
    }
  });
});

describe('cocokKetinggian', () => {
  it('di dalam rentang berarti cocok', () => {
    expect(cocokKetinggian('rendah sampai menengah', 300)).toBe('cocok');
  });

  it('kebun lebih tinggi dari batas atas tanaman', () => {
    expect(cocokKetinggian('rendah', 900)).toBe('terlalu-tinggi');
  });

  it('kebun lebih rendah dari batas bawah tanaman', () => {
    expect(cocokKetinggian('tinggi', 50)).toBe('terlalu-rendah');
  });

  it('batas dianggap masuk, bukan gagal', () => {
    expect(cocokKetinggian('rendah', 400)).toBe('cocok');
    expect(cocokKetinggian('tinggi', 700)).toBe('cocok');
  });

  it('mdpl 0 tetap dinilai, bukan dianggap "belum diisi"', () => {
    // 0 mdpl adalah jawaban sah untuk kebun di pesisir.
    expect(cocokKetinggian('tinggi', 0)).toBe('terlalu-rendah');
  });
});

describe('BAND_MDPL', () => {
  it('band-nya bersambung tanpa celah', () => {
    expect(BAND_MDPL.rendah[1]).toBe(BAND_MDPL.menengah[0]);
    expect(BAND_MDPL.menengah[1]).toBe(BAND_MDPL.tinggi[0]);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd backend && npx vitest run src/lib/garden_altitude.test.ts`
Expected: FAIL — `Failed to resolve import "./garden_altitude"`.

- [ ] **Step 3: Tulis implementasinya**

```ts
/**
 * Cocokkan ketinggian kebun dengan ketinggian yang diminta tanaman.
 *
 * Katalog menyimpan `altitude` sebagai teks bebas, tapi kosakatanya hanya tiga
 * kata — rendah, menengah, tinggi — dengan satu penghubung 'sampai'. Cukup
 * dicocokkan kata kunci, sama seperti garden_season.ts membaca kolom `season`.
 *
 * Pembagiannya mengikuti yang lazim dipakai penyuluh pertanian dan sudah
 * ditulis di kepala data/plants.ts, jadi angkanya tidak boleh berbeda:
 *   rendah   = 0–400 mdpl
 *   menengah = 400–700 mdpl
 *   tinggi   = di atas 700 mdpl
 */

export type Band = 'rendah' | 'menengah' | 'tinggi';

/**
 * Batas atas 'tinggi' dipatok 2000, bukan tak hingga: di atas itu tidak ada
 * pekarangan rumah di Indonesia, dan angka berhingga membuat perbandingan
 * rentang tidak perlu menangani Infinity.
 */
export const BAND_MDPL: Record<Band, [number, number]> = {
  rendah: [0, 400],
  menengah: [400, 700],
  tinggi: [700, 2000],
};

const URUT: Band[] = ['rendah', 'menengah', 'tinggi'];

/** Rentang mdpl yang diminta sebuah tanaman, dari teks bebas di katalog. */
export function parseAltitude(text: string): [number, number] {
  const lower = (text ?? '').toLowerCase();
  const ada = URUT.filter((b) => lower.includes(b));

  // Tidak ada kata kunci yang dikenal: perlakukan sebagai cocok di mana saja.
  // Menandai tanaman "tidak cocok" karena teksnya tidak terbaca adalah
  // peringatan palsu, dan peringatan palsu membuat semua peringatan diabaikan.
  if (ada.length === 0) return [BAND_MDPL.rendah[0], BAND_MDPL.tinggi[1]];

  return [BAND_MDPL[ada[0]][0], BAND_MDPL[ada[ada.length - 1]][1]];
}

/** Apakah kebun di ketinggian `mdpl` cocok untuk tanaman ini. */
export function cocokKetinggian(
  text: string,
  mdpl: number
): 'cocok' | 'terlalu-rendah' | 'terlalu-tinggi' {
  const [min, max] = parseAltitude(text);
  if (mdpl < min) return 'terlalu-rendah';
  if (mdpl > max) return 'terlalu-tinggi';
  return 'cocok';
}
```

- [ ] **Step 4: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/lib/garden_altitude.test.ts`
Expected: PASS, semua kasus.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/garden_altitude.ts backend/src/lib/garden_altitude.test.ts
git commit -m "feat(kebun): cocokkan ketinggian kebun dengan syarat tanaman"
```

---

### Task 3: `garden_soil.ts` — cocokkan pH tanah

**Files:**
- Create: `backend/src/lib/garden_soil.ts`
- Test: `backend/src/lib/garden_soil.test.ts`

**Interfaces:**
- Consumes: `Plant.phRange: [number, number]` dari katalog.
- Produces:
  - `export const PH_MIN = 3.5`, `export const PH_MAX = 9.5`
  - `export function bersihkanPh(nilai: unknown): number | null`
  - `export function cocokPh(range: [number, number], ph: number): 'cocok' | 'terlalu-masam' | 'terlalu-basa'`
  - `export function saranPerbaikan(range: [number, number], ph: number, texture: string | null): string | null`
  - `export interface UjiTanah { lokasiId: string; lokasiLabel: string; ph: number; texture: string | null; testedDate: string }`
  - `export interface SalahTanah { plantingId: string; nama: string; lokasiId: string; ph: number; status: 'terlalu-masam' | 'terlalu-basa'; saran: string | null }`
  - `export function cariSalahTanah(plantings, uji, phByPlant): SalahTanah[]`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
import { describe, it, expect } from 'vitest';
import { bersihkanPh, cocokPh, saranPerbaikan, cariSalahTanah, PH_MIN, PH_MAX } from './garden_soil';

describe('bersihkanPh', () => {
  it('menerima angka yang masuk akal', () => {
    expect(bersihkanPh(6.5)).toBe(6.5);
    expect(bersihkanPh('5.8')).toBe(5.8);
  });

  it('menolak yang di luar rentang alat ukur mana pun', () => {
    // pH 0 dan 14 ada di buku kimia, tidak ada di kebun. Angka seperti itu
    // hampir pasti salah ketik, dan menyimpannya akan melahirkan saran
    // pengapuran berkarung-karung untuk tanah yang sebenarnya normal.
    expect(bersihkanPh(0)).toBeNull();
    expect(bersihkanPh(14)).toBeNull();
    expect(bersihkanPh(PH_MIN)).toBe(PH_MIN);
    expect(bersihkanPh(PH_MAX)).toBe(PH_MAX);
  });

  it('menolak yang bukan angka', () => {
    expect(bersihkanPh(null)).toBeNull();
    expect(bersihkanPh('asam')).toBeNull();
    expect(bersihkanPh(NaN)).toBeNull();
    expect(bersihkanPh(Infinity)).toBeNull();
  });
});

describe('cocokPh', () => {
  it('di dalam rentang berarti cocok', () => {
    expect(cocokPh([5.5, 7.0], 6.2)).toBe('cocok');
  });

  it('batasnya masuk hitungan', () => {
    expect(cocokPh([5.5, 7.0], 5.5)).toBe('cocok');
    expect(cocokPh([5.5, 7.0], 7.0)).toBe('cocok');
  });

  it('di bawah rentang berarti terlalu masam', () => {
    expect(cocokPh([6.0, 7.0], 4.8)).toBe('terlalu-masam');
  });

  it('di atas rentang berarti terlalu basa', () => {
    expect(cocokPh([5.5, 6.5], 7.8)).toBe('terlalu-basa');
  });
});

describe('saranPerbaikan', () => {
  it('tanah masam disarankan dikapur', () => {
    const s = saranPerbaikan([6.0, 7.0], 4.8, 'liat');
    expect(s).toMatch(/dolomit|kapur/i);
  });

  it('dosis untuk tanah pasir lebih kecil daripada tanah liat', () => {
    // Tanah pasir punya daya sangga jauh lebih rendah; dosis yang sama akan
    // melampaui target dan membuat tanah terlalu basa.
    const pasir = saranPerbaikan([6.0, 7.0], 4.8, 'pasir') ?? '';
    const liat = saranPerbaikan([6.0, 7.0], 4.8, 'liat') ?? '';
    const angka = (s: string) => Number(s.match(/([\d.]+)\s*kg/)?.[1] ?? 0);
    expect(angka(pasir)).toBeGreaterThan(0);
    expect(angka(pasir)).toBeLessThan(angka(liat));
  });

  it('tanah basa disarankan bahan organik, dan justru dilarang dikapur', () => {
    const s = saranPerbaikan([5.5, 6.5], 7.8, 'lempung') ?? '';
    expect(s).toMatch(/kompos|organik|belerang/i);
    // Tidak boleh MENGANJURKAN kapur, tapi larangannya wajib disebut — jadi
    // jangan pakai /kapur/ polos, "Jangan dikapur" akan ikut tertangkap.
    expect(s).not.toMatch(/tabur dolomit/i);
    expect(s).toMatch(/jangan dikapur/i);
  });

  it('tanah yang sudah cocok tidak diberi saran', () => {
    expect(saranPerbaikan([5.5, 7.0], 6.2, 'lempung')).toBeNull();
  });

  it('tekstur kosong tetap memberi saran, tanpa dosis mengarang', () => {
    const s = saranPerbaikan([6.0, 7.0], 4.8, null);
    expect(s).toBeTruthy();
    expect(s).not.toMatch(/\d+\s*kg/);
  });
});

describe('cariSalahTanah', () => {
  const uji = [
    { lokasiId: 'bed-1', lokasiLabel: 'Bedengan depan', ph: 4.6, texture: 'liat', testedDate: '2026-08-01' },
    { lokasiId: 'loc:pot teras', lokasiLabel: 'Pot teras', ph: 6.3, texture: 'lempung', testedDate: '2026-08-02' },
  ];
  const phByPlant = new Map<string, [number, number]>([
    ['sawi-hijau', [6.0, 7.0]],
    ['kangkung', [5.5, 7.0]],
  ]);

  it('menandai tanaman di lokasi yang pH-nya di luar syaratnya', () => {
    const hasil = cariSalahTanah(
      [{ plantingId: 'p1', nama: 'Sawi', plantId: 'sawi-hijau', lokasiId: 'bed-1' }],
      uji,
      phByPlant
    );
    expect(hasil).toHaveLength(1);
    expect(hasil[0].status).toBe('terlalu-masam');
    expect(hasil[0].saran).toBeTruthy();
  });

  it('tidak menandai yang pH-nya sudah pas', () => {
    const hasil = cariSalahTanah(
      [{ plantingId: 'p2', nama: 'Kangkung', plantId: 'kangkung', lokasiId: 'loc:pot teras' }],
      uji,
      phByPlant
    );
    expect(hasil).toEqual([]);
  });

  it('lokasi yang belum pernah diuji dilewati, bukan dianggap buruk', () => {
    const hasil = cariSalahTanah(
      [{ plantingId: 'p3', nama: 'Sawi', plantId: 'sawi-hijau', lokasiId: 'bed-9' }],
      uji,
      phByPlant
    );
    expect(hasil).toEqual([]);
  });

  it('tanaman di luar katalog dilewati', () => {
    const hasil = cariSalahTanah(
      [{ plantingId: 'p4', nama: 'Entah', plantId: null, lokasiId: 'bed-1' }],
      uji,
      phByPlant
    );
    expect(hasil).toEqual([]);
  });

  it('memakai uji terbaru kalau satu lokasi diuji berkali-kali', () => {
    const berulang = [
      { lokasiId: 'bed-1', lokasiLabel: 'Bedengan depan', ph: 4.6, texture: 'liat', testedDate: '2026-08-01' },
      { lokasiId: 'bed-1', lokasiLabel: 'Bedengan depan', ph: 6.4, texture: 'liat', testedDate: '2026-08-20' },
    ];
    const hasil = cariSalahTanah(
      [{ plantingId: 'p1', nama: 'Sawi', plantId: 'sawi-hijau', lokasiId: 'bed-1' }],
      berulang,
      phByPlant
    );
    // Sudah dikapur bulan lalu; peringatan lama tidak boleh terus muncul.
    expect(hasil).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd backend && npx vitest run src/lib/garden_soil.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Tulis implementasinya**

```ts
/**
 * Cocokkan pH tanah yang diukur sendiri dengan pH yang diminta tanaman.
 *
 * Katalog menyimpan `phRange` untuk tiap tanaman sejak berkas plants.ts
 * ditulis, tapi sampai sekarang angka itu tidak pernah dibandingkan dengan
 * apa pun — tidak ada tempat menyimpan pH tanah yang sebenarnya. Ini sisi
 * yang hilang, sama seperti jam matahari sebelum garden_sun.ts ada.
 *
 * Kenapa penting di Indonesia: tanah masam adalah keadaan bawaan di banyak
 * daerah, dan tanaman yang mandek karenanya terlihat persis seperti tanaman
 * yang kurang pupuk. Pekebun lalu menambah pupuk — yang tidak menolong,
 * karena haranya ada di tanah tapi terkunci oleh pH.
 */

/** Di luar rentang ini hampir pasti salah ketik, bukan tanah yang aneh. */
export const PH_MIN = 3.5;
export const PH_MAX = 9.5;

export type StatusPh = 'cocok' | 'terlalu-masam' | 'terlalu-basa';

export function bersihkanPh(nilai: unknown): number | null {
  const n = typeof nilai === 'string' ? Number(nilai) : nilai;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n < PH_MIN || n > PH_MAX) return null;
  return n;
}

export function cocokPh(range: [number, number], ph: number): StatusPh {
  if (ph < range[0]) return 'terlalu-masam';
  if (ph > range[1]) return 'terlalu-basa';
  return 'cocok';
}

/**
 * Dosis dolomit kasar per 100 m², kg, untuk menaikkan pH satu satuan.
 *
 * Bergantung daya sangga tanah: pasir hampir tidak menyangga, liat menyangga
 * kuat. Angka ini panduan pekarangan, bukan rekomendasi agronomi — karena itu
 * saran selalu menutup dengan ajakan mengukur ulang, dan dosis tidak pernah
 * disebut sama sekali kalau teksturnya tidak diketahui.
 */
const DOSIS_DOLOMIT: Record<string, number> = {
  pasir: 15,
  lempung: 25,
  liat: 40,
};

export function saranPerbaikan(
  range: [number, number],
  ph: number,
  texture: string | null
): string | null {
  const status = cocokPh(range, ph);
  if (status === 'cocok') return null;

  if (status === 'terlalu-masam') {
    const selisih = Math.max(0.5, range[0] - ph);
    const dosis = texture ? DOSIS_DOLOMIT[texture] : undefined;
    const takaran = dosis
      ? ` Perkiraan ${(dosis * selisih).toFixed(0)} kg per 100 m².`
      : '';
    return (
      `Tanah terlalu masam (pH ${ph}, tanaman minta ${range[0]}–${range[1]}). ` +
      `Tabur dolomit lalu diamkan 2–3 pekan sebelum tanam.${takaran} Ukur ulang sesudahnya.`
    );
  }

  return (
    `Tanah terlalu basa (pH ${ph}, tanaman minta ${range[0]}–${range[1]}). ` +
    `Tambah kompos matang atau pupuk kandang; untuk penurunan yang lebih cepat pakai belerang. ` +
    `Jangan dikapur. Ukur ulang sesudah 3–4 pekan.`
  );
}

export interface UjiTanah {
  lokasiId: string;
  lokasiLabel: string;
  ph: number;
  texture: string | null;
  testedDate: string;
}

export interface TanamanDiLokasi {
  plantingId: string;
  nama: string;
  plantId: string | null;
  lokasiId: string;
}

export interface SalahTanah {
  plantingId: string;
  nama: string;
  lokasiId: string;
  lokasiLabel: string;
  ph: number;
  status: 'terlalu-masam' | 'terlalu-basa';
  saran: string | null;
}

/**
 * Tanaman yang berdiri di tanah dengan pH di luar syaratnya.
 *
 * Lokasi yang belum pernah diuji sengaja dilewati, bukan dianggap bermasalah:
 * peringatan tanpa pengukuran adalah tebakan, dan tebakan yang sering salah
 * membuat pengguna berhenti membaca semua peringatan.
 */
export function cariSalahTanah(
  plantings: TanamanDiLokasi[],
  uji: UjiTanah[],
  phByPlant: Map<string, [number, number]>
): SalahTanah[] {
  // Satu lokasi bisa diuji berkali-kali. Yang berlaku hanya yang terbaru —
  // memakai yang lama membuat peringatan bertahan sesudah tanahnya diperbaiki.
  const terbaru = new Map<string, UjiTanah>();
  for (const u of uji) {
    const ada = terbaru.get(u.lokasiId);
    if (!ada || u.testedDate > ada.testedDate) terbaru.set(u.lokasiId, u);
  }

  const hasil: SalahTanah[] = [];
  for (const t of plantings) {
    if (!t.plantId) continue;
    const range = phByPlant.get(t.plantId);
    if (!range) continue;

    const u = terbaru.get(t.lokasiId);
    if (!u) continue;

    const status = cocokPh(range, u.ph);
    if (status === 'cocok') continue;

    hasil.push({
      plantingId: t.plantingId,
      nama: t.nama,
      lokasiId: t.lokasiId,
      lokasiLabel: u.lokasiLabel,
      ph: u.ph,
      status,
      saran: saranPerbaikan(range, u.ph, u.texture),
    });
  }
  return hasil;
}
```

- [ ] **Step 4: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/lib/garden_soil.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/garden_soil.ts backend/src/lib/garden_soil.test.ts
git commit -m "feat(kebun): cocokkan pH tanah hasil uji dengan syarat tanaman"
```

---

### Task 4: `garden_propagation.ts` — baca cara perbanyakan, nilai keberhasilannya

**Files:**
- Create: `backend/src/lib/garden_propagation.ts`
- Test: `backend/src/lib/garden_propagation.test.ts`

**Interfaces:**
- Consumes: `Plant.propagation` (teks bebas).
- Produces:
  - `export type Metode = 'benih-langsung' | 'semai-pindah' | 'stek' | 'cangkok' | 'okulasi' | 'anakan' | 'rimpang' | 'umbi' | 'daun'`
  - `export const METODE_LABEL: Record<Metode, string>`
  - `export function parseMetode(text: string): Metode[]`
  - `export function pekanSemai(text: string): [number, number] | null`
  - `export function tingkatBerhasil(started: number, rooted: number | null): number | null`
  - `export interface CatatanPerbanyakan { plantId: string | null; nama: string; method: Metode; countStarted: number; countRooted: number | null }`
  - `export interface RingkasMetode { method: Metode; label: string; batch: number; started: number; rooted: number; rate: number }`
  - `export function ringkasMetode(catatan: CatatanPerbanyakan[]): RingkasMetode[]`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
import { describe, it, expect } from 'vitest';
import { parseMetode, pekanSemai, tingkatBerhasil, ringkasMetode } from './garden_propagation';
import { PLANTS } from '../data/plants';

describe('parseMetode', () => {
  it('membaca stek dan cangkok sekaligus', () => {
    expect(parseMetode('Stek batang atau cangkok')).toEqual(
      expect.arrayContaining(['stek', 'cangkok'])
    );
  });

  it('membedakan semai-pindah dari benih langsung', () => {
    expect(parseMetode('Semai 3–4 minggu, pindah tanam')).toContain('semai-pindah');
    expect(parseMetode('Tanam benih langsung, 2 biji per lubang')).toContain('benih-langsung');
    expect(parseMetode('Tanam benih langsung')).not.toContain('semai-pindah');
  });

  it('membaca rimpang, umbi, okulasi, anakan', () => {
    expect(parseMetode('Rimpang bertunas')).toContain('rimpang');
    expect(parseMetode('Umbi bibit bertunas')).toContain('umbi');
    expect(parseMetode('Bibit cangkok atau okulasi')).toContain('okulasi');
    expect(parseMetode('Anakan dari rumpun induk')).toContain('anakan');
  });

  it('teks tak dikenal menghasilkan daftar kosong, bukan tebakan', () => {
    expect(parseMetode('')).toEqual([]);
    expect(parseMetode('Beli bibit di toko')).toEqual([]);
  });

  it('tidak ada entri katalog yang membuatnya melempar galat', () => {
    for (const p of PLANTS) {
      expect(() => parseMetode(p.propagation), p.id).not.toThrow();
    }
  });

  it('sebagian besar katalog terbaca metodenya', () => {
    // Bukan semua: beberapa entri memang ditulis sebagai kalimat bebas.
    // Yang dijaga adalah parser tidak diam-diam berhenti bekerja.
    const terbaca = PLANTS.filter((p) => parseMetode(p.propagation).length > 0);
    expect(terbaca.length).toBeGreaterThan(PLANTS.length * 0.7);
  });
});

describe('pekanSemai', () => {
  it('membaca rentang pekan', () => {
    expect(pekanSemai('Semai 3–4 minggu, pindah tanam')).toEqual([3, 4]);
  });

  it('membaca satu angka pekan sebagai rentang rapat', () => {
    expect(pekanSemai('Semai 4 minggu, pindah tanam')).toEqual([4, 4]);
  });

  it('membaca satuan hari menjadi pekan', () => {
    expect(pekanSemai('Semai 10 hari, pindah tanam')).toEqual([2, 2]);
  });

  it('null kalau tidak ada tahap semai', () => {
    expect(pekanSemai('Tanam benih langsung')).toBeNull();
    expect(pekanSemai('Stek batang atau cangkok')).toBeNull();
  });
});

describe('tingkatBerhasil', () => {
  it('menghitung persen', () => {
    expect(tingkatBerhasil(10, 7)).toBe(70);
  });

  it('nol berhasil adalah 0, bukan null', () => {
    // Batch yang gagal total justru data terpenting tentang metodenya.
    expect(tingkatBerhasil(10, 0)).toBe(0);
  });

  it('belum dihitung tetap null', () => {
    expect(tingkatBerhasil(10, null)).toBeNull();
  });

  it('data mustahil ditolak, tidak dipaksa jadi angka', () => {
    expect(tingkatBerhasil(0, 0)).toBeNull();
    expect(tingkatBerhasil(5, 9)).toBeNull();
  });
});

describe('ringkasMetode', () => {
  it('menggabungkan per metode dan mengurutkan dari yang paling berhasil', () => {
    const hasil = ringkasMetode([
      { plantId: 'tin', nama: 'Tin', method: 'stek', countStarted: 10, countRooted: 8 },
      { plantId: 'tin', nama: 'Tin', method: 'stek', countStarted: 10, countRooted: 6 },
      { plantId: 'tin', nama: 'Tin', method: 'cangkok', countStarted: 4, countRooted: 1 },
    ]);
    expect(hasil[0].method).toBe('stek');
    expect(hasil[0].batch).toBe(2);
    expect(hasil[0].rate).toBe(70);
    expect(hasil[1].method).toBe('cangkok');
    expect(hasil[1].rate).toBe(25);
  });

  it('batch yang belum dihitung tidak ikut merusak rata-rata', () => {
    const hasil = ringkasMetode([
      { plantId: 'tin', nama: 'Tin', method: 'stek', countStarted: 10, countRooted: 8 },
      { plantId: 'tin', nama: 'Tin', method: 'stek', countStarted: 10, countRooted: null },
    ]);
    expect(hasil[0].rate).toBe(80);
    expect(hasil[0].started).toBe(10);
  });

  it('metode yang semua batch-nya belum dihitung tidak ditampilkan', () => {
    const hasil = ringkasMetode([
      { plantId: 'tin', nama: 'Tin', method: 'stek', countStarted: 10, countRooted: null },
    ]);
    expect(hasil).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd backend && npx vitest run src/lib/garden_propagation.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Tulis implementasinya**

```ts
/**
 * Baca cara perbanyakan dari katalog, lalu nilai mana yang benar-benar
 * berhasil di tangan pengguna ini.
 *
 * Kolom `propagation` sudah ada di tiap entri katalog sejak awal, tapi selama
 * ini hanya dirender sebagai satu baris teks di modal detail. Ia memberi tahu
 * CARA memperbanyak; tidak ada yang mencatat apakah caranya berhasil.
 *
 * Dengan tabel garden_propagation, lingkaran modul kebun tertutup penuh:
 * benih -> tanam -> panen -> benih ATAU stek -> tanam.
 */

export type Metode =
  | 'benih-langsung'
  | 'semai-pindah'
  | 'stek'
  | 'cangkok'
  | 'okulasi'
  | 'anakan'
  | 'rimpang'
  | 'umbi'
  | 'daun';

export const METODE_LABEL: Record<Metode, string> = {
  'benih-langsung': 'Benih langsung',
  'semai-pindah': 'Semai lalu pindah',
  stek: 'Stek',
  cangkok: 'Cangkok',
  okulasi: 'Okulasi',
  anakan: 'Anakan',
  rimpang: 'Rimpang',
  umbi: 'Umbi',
  daun: 'Stek daun',
};

/**
 * Urutannya penting: 'stek daun' harus dikenali sebagai `daun` sebelum kata
 * 'stek' menangkapnya lebih dulu sebagai stek batang biasa.
 */
const POLA: Array<[Metode, RegExp]> = [
  ['daun', /stek daun/i],
  ['semai-pindah', /semai/i],
  ['benih-langsung', /(tanam|sebar) benih langsung|benih langsung|tanam langsung/i],
  ['stek', /stek/i],
  ['cangkok', /cangkok/i],
  ['okulasi', /okulasi|sambung/i],
  ['anakan', /anakan|tunas anak/i],
  ['rimpang', /rimpang/i],
  ['umbi', /umbi/i],
];

export function parseMetode(text: string): Metode[] {
  const t = text ?? '';
  const hasil: Metode[] = [];
  for (const [metode, pola] of POLA) {
    if (pola.test(t)) hasil.push(metode);
  }
  return hasil;
}

/**
 * Lama persemaian dalam pekan, [tercepat, terlama], dari teks katalog.
 *
 * Ini yang membuat jadwal semai mundur bisa dihitung tanpa data tambahan:
 * "Semai 3–4 minggu, pindah tanam" sudah menyimpan angkanya sejak dulu.
 */
export function pekanSemai(text: string): [number, number] | null {
  const t = text ?? '';
  if (!/semai/i.test(t)) return null;

  // Tanda hubung bisa '-' biasa atau '–' en dash; katalog memakai keduanya.
  const minggu = t.match(/(\d+)\s*(?:[-–]\s*(\d+)\s*)?minggu/i);
  if (minggu) {
    const a = Number(minggu[1]);
    const b = minggu[2] ? Number(minggu[2]) : a;
    return [a, b];
  }

  const hari = t.match(/(\d+)\s*(?:[-–]\s*(\d+)\s*)?hari/i);
  if (hari) {
    const a = Math.max(1, Math.ceil(Number(hari[1]) / 7));
    const b = hari[2] ? Math.max(1, Math.ceil(Number(hari[2]) / 7)) : a;
    return [a, b];
  }

  return null;
}

/** Persen stek yang berakar. `null` bila belum dihitung atau datanya mustahil. */
export function tingkatBerhasil(started: number, rooted: number | null): number | null {
  if (rooted === null) return null;
  if (!Number.isFinite(started) || started <= 0) return null;
  if (!Number.isFinite(rooted) || rooted < 0 || rooted > started) return null;
  return Math.round((rooted / started) * 100);
}

export interface CatatanPerbanyakan {
  plantId: string | null;
  nama: string;
  method: Metode;
  countStarted: number;
  countRooted: number | null;
}

export interface RingkasMetode {
  method: Metode;
  label: string;
  batch: number;
  started: number;
  rooted: number;
  rate: number;
}

/**
 * Rangkum keberhasilan per metode, diurutkan dari yang paling berhasil.
 *
 * Batch yang belum dihitung dikeluarkan dari pembagi, bukan dihitung nol:
 * stek yang baru dipasang kemarin belum gagal, ia baru belum selesai.
 */
export function ringkasMetode(catatan: CatatanPerbanyakan[]): RingkasMetode[] {
  const per = new Map<Metode, { batch: number; started: number; rooted: number }>();

  for (const c of catatan) {
    if (tingkatBerhasil(c.countStarted, c.countRooted) === null) continue;
    const acc = per.get(c.method) ?? { batch: 0, started: 0, rooted: 0 };
    acc.batch += 1;
    acc.started += c.countStarted;
    acc.rooted += c.countRooted as number;
    per.set(c.method, acc);
  }

  return [...per.entries()]
    .map(([method, a]) => ({
      method,
      label: METODE_LABEL[method],
      batch: a.batch,
      started: a.started,
      rooted: a.rooted,
      rate: Math.round((a.rooted / a.started) * 100),
    }))
    .sort((x, y) => y.rate - x.rate || y.started - x.started);
}
```

- [ ] **Step 4: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/lib/garden_propagation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/garden_propagation.ts backend/src/lib/garden_propagation.test.ts
git commit -m "feat(kebun): baca metode perbanyakan katalog dan nilai keberhasilannya"
```

---

### Task 5: `garden_mangsa.ts` — kalender Pranata Mangsa

**Files:**
- Create: `backend/src/lib/garden_mangsa.ts`
- Test: `backend/src/lib/garden_mangsa.test.ts`

**Interfaces:**
- Produces:
  - `export type MusimMangsa = 'ketiga' | 'labuh' | 'rendheng' | 'mareng'`
  - `export interface Mangsa { urutan: number; nama: string; mulai: string; selesai: string; hari: number; musim: MusimMangsa; pertanda: string; saran: string }`
  - `export const MANGSA: Mangsa[]` (12 entri)
  - `export function mangsaPada(tanggal: string): Mangsa`
  - `export function musimMangsaKe(musim: MusimMangsa): 'hujan' | 'kemarau'`

Data referensi ditulis tangan dan ditinjau seperti kode — pola yang sama dengan `data/plants.ts` dan `frontend/src/data/holidays.ts`, bukan tabel D1 yang di-seed.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
import { describe, it, expect } from 'vitest';
import { MANGSA, mangsaPada, musimMangsaKe } from './garden_mangsa';

describe('tabel MANGSA', () => {
  it('ada dua belas', () => {
    expect(MANGSA).toHaveLength(12);
  });

  it('urutannya 1..12 tanpa lompat', () => {
    expect(MANGSA.map((m) => m.urutan)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
  });

  it('jumlah harinya 365', () => {
    expect(MANGSA.reduce((n, m) => n + m.hari, 0)).toBe(365);
  });

  it('tiap mangsa punya pertanda dan saran', () => {
    for (const m of MANGSA) {
      expect(m.pertanda, m.nama).toBeTruthy();
      expect(m.saran, m.nama).toBeTruthy();
    }
  });
});

describe('mangsaPada', () => {
  it('22 Juni adalah awal Kasa', () => {
    expect(mangsaPada('2026-06-22').nama).toBe('Kasa');
  });

  it('1 Agustus masih Kasa, 2 Agustus sudah Karo', () => {
    expect(mangsaPada('2026-08-01').nama).toBe('Kasa');
    expect(mangsaPada('2026-08-02').nama).toBe('Karo');
  });

  it('mangsa yang melewati pergantian tahun tetap terbaca', () => {
    // Kapitu: 22 Desember – 2 Februari.
    expect(mangsaPada('2026-12-25').nama).toBe('Kapitu');
    expect(mangsaPada('2026-01-15').nama).toBe('Kapitu');
    expect(mangsaPada('2026-02-02').nama).toBe('Kapitu');
    expect(mangsaPada('2026-02-03').nama).toBe('Kawolu');
  });

  it('29 Februari tahun kabisat tidak jatuh ke celah', () => {
    // Kawolu berakhir 28 Februari di tahun biasa. Tanpa penanganan khusus,
    // 29 Februari tidak masuk mangsa mana pun dan fungsinya melempar galat.
    expect(mangsaPada('2024-02-29').nama).toBe('Kawolu');
  });

  it('tiap hari dalam setahun dapat tepat satu mangsa', () => {
    const d = new Date(Date.UTC(2026, 0, 1));
    for (let i = 0; i < 365; i++) {
      const iso = d.toISOString().slice(0, 10);
      expect(() => mangsaPada(iso), iso).not.toThrow();
      d.setUTCDate(d.getUTCDate() + 1);
    }
  });

  it('musimnya sesuai pembagian empat', () => {
    expect(mangsaPada('2026-07-01').musim).toBe('ketiga');   // kemarau
    expect(mangsaPada('2026-10-01').musim).toBe('labuh');    // menjelang hujan
    expect(mangsaPada('2026-01-10').musim).toBe('rendheng'); // hujan
    expect(mangsaPada('2026-04-10').musim).toBe('mareng');   // menjelang kemarau
  });
});

describe('musimMangsaKe', () => {
  it('memetakan empat musim mangsa ke dua musim yang dipakai katalog', () => {
    expect(musimMangsaKe('rendheng')).toBe('hujan');
    expect(musimMangsaKe('labuh')).toBe('hujan');
    expect(musimMangsaKe('ketiga')).toBe('kemarau');
    expect(musimMangsaKe('mareng')).toBe('kemarau');
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd backend && npx vitest run src/lib/garden_mangsa.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Tulis implementasinya**

```ts
/**
 * Pranata Mangsa — kalender musim Jawa, dua belas mangsa.
 *
 * Disusun jauh sebelum ditetapkan resmi pada 1855 dan masih dipakai pekebun
 * di Jawa Tengah dan DIY sampai sekarang. Penelitian curah hujan modern
 * menemukan pembagiannya memang sejalan dengan pola hujan nyata, jadi ini
 * bukan hiasan budaya: ia panduan waktu tanam yang bisa diuji.
 *
 * Data referensi, ditulis tangan dan ditinjau seperti kode — sama seperti
 * data/plants.ts. Tidak di-seed ke D1: tanggalnya tidak pernah berubah, dan
 * menyimpannya di sini membuatnya tetap benar tanpa bergantung pada migrasi.
 *
 * Ia melengkapi garden_season.ts, tidak menggantikannya. garden_season.ts
 * membagi setahun jadi dua (hujan/kemarau) untuk mencocokkan kolom `season`
 * katalog; mangsa membaginya jadi dua belas dan memberi tahu apa yang
 * dikerjakan pada tiap potongan.
 */

export type MusimMangsa = 'ketiga' | 'labuh' | 'rendheng' | 'mareng';

export interface Mangsa {
  urutan: number;
  nama: string;
  /** MM-DD, inklusif. */
  mulai: string;
  /** MM-DD, inklusif. */
  selesai: string;
  hari: number;
  musim: MusimMangsa;
  pertanda: string;
  saran: string;
}

export const MANGSA: Mangsa[] = [
  {
    urutan: 1, nama: 'Kasa', mulai: '06-22', selesai: '08-01', hari: 41, musim: 'ketiga',
    pertanda: 'Daun-daun berguguran, tanah mulai retak, udara malam terasa dingin.',
    saran: 'Musim kemarau dimulai. Waktunya membakar sisa panen jadi abu, memperbaiki bedengan, dan menanam palawija yang tahan kering. Jangan mulai tanaman berdaun lebar yang butuh air terus.',
  },
  {
    urutan: 2, nama: 'Karo', mulai: '08-02', selesai: '08-24', hari: 23, musim: 'ketiga',
    pertanda: 'Tanah makin keras dan pecah-pecah, pohon randu mulai berbuah.',
    saran: 'Puncak kering pertama. Utamakan mulsa tebal dan siram pagi buta. Cocok mengolah tanah dan menabur dolomit — hasilnya sempat meresap sebelum hujan datang.',
  },
  {
    urutan: 3, nama: 'Katelu', mulai: '08-25', selesai: '09-17', hari: 24, musim: 'ketiga',
    pertanda: 'Rebung bermunculan, daun randu tumbuh kembali.',
    saran: 'Kemarau masih penuh. Waktu terbaik memanen umbi dan rimpang — jahe, kunyit, dan bawang menyimpan lebih baik kalau dipanen kering.',
  },
  {
    urutan: 4, nama: 'Kapat', mulai: '09-18', selesai: '10-12', hari: 25, musim: 'labuh',
    pertanda: 'Sumur menyusut, kapuk mulai merekah, burung membuat sarang.',
    saran: 'Peralihan menuju hujan. Siapkan persemaian sekarang supaya bibit siap pindah saat hujan pertama. Perbaiki saluran air sebelum dibutuhkan.',
  },
  {
    urutan: 5, nama: 'Kalima', mulai: '10-13', selesai: '11-08', hari: 27, musim: 'labuh',
    pertanda: 'Hujan pertama turun, mangga berbunga, ulat bermunculan.',
    saran: 'Hujan mulai. Saat menanam yang paling baik sepanjang tahun untuk kebanyakan sayuran. Awasi ulat dan siput yang ikut bangun bersama hujan.',
  },
  {
    urutan: 6, nama: 'Kanem', mulai: '11-09', selesai: '12-21', hari: 43, musim: 'labuh',
    pertanda: 'Buah-buahan mulai matang, hujan makin sering, banyak petir.',
    saran: 'Puncak musim tanam. Pupuk susulan sekarang mumpung tanah lembap. Panen buah musiman. Pasang ajir sebelum angin kencang datang.',
  },
  {
    urutan: 7, nama: 'Kapitu', mulai: '12-22', selesai: '02-02', hari: 43, musim: 'rendheng',
    pertanda: 'Hujan paling deras, sungai meluap, banyak penyakit tanaman.',
    saran: 'Puncak hujan dan puncak risiko. Perbaiki drainase, jangan biarkan air menggenang di pot. Jamur dan busuk akar paling sering menyerang sekarang — kurangi kerapatan tanam dan buang daun bawah yang menempel tanah.',
  },
  {
    urutan: 8, nama: 'Kawolu', mulai: '02-03', selesai: '02-28', hari: 26, musim: 'rendheng',
    pertanda: 'Hujan masih sering, padi mulai berisi, banyak ulat dan tikus.',
    saran: 'Hujan mulai mereda tapi hama memuncak. Periksa tanaman tiap hari; ini mangsa yang paling menuntut pengamatan, bukan penanaman baru.',
  },
  {
    urutan: 9, nama: 'Kasanga', mulai: '03-01', selesai: '03-25', hari: 25, musim: 'rendheng',
    pertanda: 'Padi menguning, jangkrik bersuara, hujan mulai jarang.',
    saran: 'Akhir musim hujan. Waktunya memanen dan mulai menyimpan benih dari tanaman terbaik. Jangan mulai tanaman berumur panjang yang butuh hujan.',
  },
  {
    urutan: 10, nama: 'Kasadasa', mulai: '03-26', selesai: '04-18', hari: 24, musim: 'mareng',
    pertanda: 'Panen raya, udara mulai kering, burung kembali bersarang.',
    saran: 'Peralihan menuju kemarau. Panen besar dan pengeringan benih. Mulai siapkan mulsa dan tampungan air hujan selagi masih ada yang bisa ditampung.',
  },
  {
    urutan: 11, nama: 'Dhesta', mulai: '04-19', selesai: '05-11', hari: 23, musim: 'mareng',
    pertanda: 'Hujan tinggal sesekali, embun tebal di pagi hari.',
    saran: 'Kemarau mendekat. Tanam yang berumur pendek saja — kangkung, bayam, sawi — supaya sempat dipanen sebelum air jadi mahal.',
  },
  {
    urutan: 12, nama: 'Sadha', mulai: '05-12', selesai: '06-21', hari: 41, musim: 'mareng',
    pertanda: 'Air mulai surut, udara dingin di malam hari, kabut pagi.',
    saran: 'Ambang kemarau. Benahi bedengan, tambah kompos, dan rapikan naungan. Yang ditanam sekarang harus yang tahan kering atau yang bisa disiram rutin.',
  },
];

/** Ubah 'MM-DD' jadi angka yang bisa dibandingkan: 622 untuk 22 Juni. */
function kunci(mmdd: string): number {
  return Number(mmdd.slice(0, 2)) * 100 + Number(mmdd.slice(3, 5));
}

/**
 * Mangsa yang berlaku pada satu tanggal.
 *
 * Perbandingan dilakukan pada MM-DD, bukan pada objek Date, supaya mangsa
 * yang melewati pergantian tahun (Kapitu, 22 Des – 2 Feb) tidak perlu
 * diperlakukan khusus di setiap pemanggil.
 */
export function mangsaPada(tanggal: string): Mangsa {
  const k = kunci(tanggal.slice(5, 10));

  for (const m of MANGSA) {
    const a = kunci(m.mulai);
    const b = kunci(m.selesai);
    // Mangsa yang membungkus akhir tahun: mulai > selesai.
    const cocok = a <= b ? k >= a && k <= b : k >= a || k <= b;
    if (cocok) return m;
  }

  // Hanya bisa tercapai pada 29 Februari: Kawolu berakhir 28 Februari, dan
  // tabelnya sengaja disimpan sebagai 365 hari supaya jumlahnya bisa diuji.
  // Hari kabisat itu milik Kawolu — mangsa yang sedang berjalan saat itu.
  return MANGSA[7];
}

/**
 * Petakan empat musim mangsa ke dua musim yang dipakai kolom `season` katalog.
 *
 * Labuh (menjelang hujan) dihitung hujan dan mareng (menjelang kemarau)
 * dihitung kemarau: pada kedua peralihan itu, yang menentukan pilihan tanaman
 * adalah ke mana cuaca sedang menuju, bukan dari mana ia datang.
 */
export function musimMangsaKe(musim: MusimMangsa): 'hujan' | 'kemarau' {
  return musim === 'rendheng' || musim === 'labuh' ? 'hujan' : 'kemarau';
}
```

- [ ] **Step 4: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/lib/garden_mangsa.test.ts`
Expected: PASS, termasuk kasus 29 Februari dan 365 hari.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/garden_mangsa.ts backend/src/lib/garden_mangsa.test.ts
git commit -m "feat(kebun): kalender Pranata Mangsa dua belas mangsa"
```

---

### Task 6: `garden_seedling_schedule.ts` — jadwal semai mundur

**Files:**
- Create: `backend/src/lib/garden_seedling_schedule.ts`
- Test: `backend/src/lib/garden_seedling_schedule.test.ts`

**Interfaces:**
- Consumes: `pekanSemai` dari `./garden_propagation` (Task 4).
- Produces:
  - `export interface JadwalSemai { mulaiSemai: string; mulaiAdaptasi: string; targetTanam: string; pekan: [number, number] }`
  - `export function jadwalMundur(targetTanam: string, propagation: string): JadwalSemai | null`
  - `export function semaiTerlambat(jadwal: JadwalSemai, hariIni: string): number`

`sowLeadDays` di `garden_succession.ts` menjawab pertanyaan lain (kapan menyemai batch susulan supaya panen bersambung) dan tidak diubah.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
import { describe, it, expect } from 'vitest';
import { jadwalMundur, semaiTerlambat } from './garden_seedling_schedule';

describe('jadwalMundur', () => {
  it('menghitung mundur dari target tanam', () => {
    // Semai 3–4 minggu: pakai yang terlama supaya bibit tidak dipaksa pindah
    // sebelum siap. 28 hari sebelum 2026-10-01 adalah 2026-09-03.
    const j = jadwalMundur('2026-10-01', 'Semai 3–4 minggu, pindah tanam');
    expect(j).not.toBeNull();
    expect(j!.mulaiSemai).toBe('2026-09-03');
    expect(j!.targetTanam).toBe('2026-10-01');
    expect(j!.pekan).toEqual([3, 4]);
  });

  it('menyisipkan adaptasi seminggu sebelum pindah', () => {
    // Bibit yang langsung dipindah dari tempat teduh ke matahari penuh
    // sering layu permanen. Seminggu penyesuaian mencegahnya.
    const j = jadwalMundur('2026-10-01', 'Semai 3–4 minggu, pindah tanam');
    expect(j!.mulaiAdaptasi).toBe('2026-09-24');
  });

  it('null untuk tanaman yang ditanam benih langsung', () => {
    expect(jadwalMundur('2026-10-01', 'Tanam benih langsung')).toBeNull();
  });

  it('null untuk tanaman yang diperbanyak dengan stek', () => {
    expect(jadwalMundur('2026-10-01', 'Stek batang atau cangkok')).toBeNull();
  });

  it('melewati pergantian bulan dan tahun dengan benar', () => {
    const j = jadwalMundur('2026-01-05', 'Semai 4 minggu, pindah tanam');
    expect(j!.mulaiSemai).toBe('2025-12-08');
  });

  it('tanggalnya tidak bergeser oleh zona waktu perangkat', () => {
    // Perhitungan wajib memakai metode UTC. Kalau memakai metode lokal,
    // hasilnya bergeser sehari di zona waktu tertentu.
    const j = jadwalMundur('2026-03-30', 'Semai 2–3 minggu, pindah tanam');
    expect(j!.mulaiSemai).toBe('2026-03-09');
  });
});

describe('semaiTerlambat', () => {
  const j = jadwalMundur('2026-10-01', 'Semai 3–4 minggu, pindah tanam')!;

  it('nol kalau belum waktunya', () => {
    expect(semaiTerlambat(j, '2026-09-01')).toBe(0);
  });

  it('nol tepat pada hari mulai semai', () => {
    expect(semaiTerlambat(j, '2026-09-03')).toBe(0);
  });

  it('menghitung hari keterlambatan', () => {
    expect(semaiTerlambat(j, '2026-09-10')).toBe(7);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd backend && npx vitest run src/lib/garden_seedling_schedule.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Tulis implementasinya**

```ts
/**
 * Hitung mundur kapan harus mulai menyemai supaya bibit siap pada tanggal
 * tanam yang diinginkan.
 *
 * Datanya sudah ada di katalog sejak dulu: `propagation` menulis "Semai 3–4
 * minggu, pindah tanam". Yang belum ada adalah yang membalik arah hitungnya —
 * selama ini pengguna hanya bisa bertanya "kapan bibit ini siap", bukan
 * "kapan saya harus mulai supaya siap saat hujan pertama".
 *
 * Berbeda dari sowLeadDays di garden_succession.ts, yang menjawab kapan
 * menyemai batch berikutnya supaya panen bersambung.
 */

import { pekanSemai } from './garden_propagation';

/**
 * Lama penyesuaian sebelum pindah tanam, hari.
 *
 * Bibit yang dipindah mendadak dari tempat teduh ke matahari penuh sering
 * layu dan tidak pulih. Seminggu dikeluarkan bertahap membuat daunnya
 * menebal lebih dulu.
 */
const HARI_ADAPTASI = 7;

export interface JadwalSemai {
  mulaiSemai: string;
  mulaiAdaptasi: string;
  targetTanam: string;
  pekan: [number, number];
}

/** Geser tanggal YYYY-MM-DD sebanyak `hari`. UTC saja — DST tidak boleh ikut. */
function geser(tanggal: string, hari: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

function selisihHari(dari: string, ke: string): number {
  const a = Date.parse(`${dari}T00:00:00Z`);
  const b = Date.parse(`${ke}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Jadwal mundur untuk satu target tanam, atau null bila tanaman ini memang
 * tidak lewat persemaian.
 *
 * Dipakai yang TERLAMA dari rentang pekan, bukan yang tercepat: menyemai
 * kepagian hanya berarti bibit menunggu sebentar di tray, sedangkan menyemai
 * kesiangan berarti target tanamnya meleset dan tidak bisa diperbaiki.
 */
export function jadwalMundur(targetTanam: string, propagation: string): JadwalSemai | null {
  const pekan = pekanSemai(propagation);
  if (!pekan) return null;

  const mulaiSemai = geser(targetTanam, -pekan[1] * 7);

  return {
    mulaiSemai,
    mulaiAdaptasi: geser(targetTanam, -HARI_ADAPTASI),
    targetTanam,
    pekan,
  };
}

/** Berapa hari terlambat dari jadwal semai. 0 bila belum waktunya atau tepat waktu. */
export function semaiTerlambat(jadwal: JadwalSemai, hariIni: string): number {
  return Math.max(0, selisihHari(jadwal.mulaiSemai, hariIni));
}
```

- [ ] **Step 4: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/lib/garden_seedling_schedule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/garden_seedling_schedule.ts backend/src/lib/garden_seedling_schedule.test.ts
git commit -m "feat(kebun): jadwal semai mundur dari target tanam"
```

---

### Task 7: `garden_media.ts` + mikrogreen di katalog

**Files:**
- Create: `backend/src/lib/garden_media.ts`
- Test: `backend/src/lib/garden_media.test.ts`
- Modify: `backend/src/data/plants.ts` (tambah kategori `mikrogreen` + 6 entri)
- Modify: `backend/src/data/plants.test.ts` hanya bila ada tes yang menuntut daftar kategori tetap

**Interfaces:**
- Produces:
  - `export type Media = 'tanah' | 'polybag' | 'hidroponik' | 'vertikultur' | 'tabulampot'`
  - `export const MEDIA_LABEL: Record<Media, string>`
  - `export function bersihkanMedia(nilai: unknown): Media`
  - `export function butuhSiram(media: Media): boolean`
  - `export function tugasMedia(media: Media, lastSolutionChange: string | null, hariIni: string): string[]`
  - `export const HARI_GANTI_LARUTAN = 10`
- Katalog bertambah: `PlantCategory` mendapat `'mikrogreen'`, `CATEGORY_LABELS.mikrogreen`, dan `CATEGORY_PANEN` memasukkannya.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
import { describe, it, expect } from 'vitest';
import { bersihkanMedia, butuhSiram, tugasMedia, HARI_GANTI_LARUTAN } from './garden_media';
import { PLANTS, CATEGORY_LABELS, CATEGORY_PANEN, dipanen } from '../data/plants';

describe('bersihkanMedia', () => {
  it('menerima media yang dikenal', () => {
    expect(bersihkanMedia('hidroponik')).toBe('hidroponik');
    expect(bersihkanMedia('vertikultur')).toBe('vertikultur');
  });

  it('nilai tak dikenal jatuh ke tanah, bukan melempar galat', () => {
    expect(bersihkanMedia('akuaponik')).toBe('tanah');
    expect(bersihkanMedia(null)).toBe('tanah');
    expect(bersihkanMedia(42)).toBe('tanah');
  });
});

describe('butuhSiram', () => {
  it('media tanah butuh siram', () => {
    expect(butuhSiram('tanah')).toBe(true);
    expect(butuhSiram('polybag')).toBe(true);
    expect(butuhSiram('tabulampot')).toBe(true);
    expect(butuhSiram('vertikultur')).toBe(true);
  });

  it('hidroponik tidak disiram', () => {
    // "Siram tiap 2 hari" adalah nasihat yang salah untuk akar yang memang
    // selalu di dalam air. Yang benar mengganti larutannya.
    expect(butuhSiram('hidroponik')).toBe(false);
  });
});

describe('tugasMedia', () => {
  it('hidroponik yang larutannya belum pernah diganti diminta mengganti', () => {
    const t = tugasMedia('hidroponik', null, '2026-08-31');
    expect(t.join(' ')).toMatch(/larutan/i);
  });

  it('hidroponik yang baru diganti tidak diminta mengganti lagi', () => {
    const t = tugasMedia('hidroponik', '2026-08-29', '2026-08-31');
    expect(t.join(' ')).not.toMatch(/ganti larutan/i);
  });

  it('hidroponik yang lewat tenggat diminta mengganti', () => {
    const t = tugasMedia('hidroponik', '2026-08-01', '2026-08-31');
    expect(t.join(' ')).toMatch(/ganti larutan/i);
  });

  it('tenggatnya sesuai HARI_GANTI_LARUTAN', () => {
    const tepat = tugasMedia('hidroponik', '2026-08-21', '2026-08-31'); // 10 hari
    expect(tepat.join(' ')).toMatch(/ganti larutan/i);
    const belum = tugasMedia('hidroponik', '2026-08-22', '2026-08-31'); // 9 hari
    expect(belum.join(' ')).not.toMatch(/ganti larutan/i);
    expect(HARI_GANTI_LARUTAN).toBe(10);
  });

  it('vertikultur diingatkan soal baris bawah yang kurang cahaya', () => {
    expect(tugasMedia('vertikultur', null, '2026-08-31').join(' ')).toMatch(/bawah/i);
  });

  it('tanah biasa tidak menambah tugas apa pun', () => {
    expect(tugasMedia('tanah', null, '2026-08-31')).toEqual([]);
  });
});

describe('katalog mikrogreen', () => {
  const mikro = PLANTS.filter((p) => p.category === 'mikrogreen');

  it('ada isinya', () => {
    expect(mikro.length).toBeGreaterThanOrEqual(6);
  });

  it('punya label kategori', () => {
    expect(CATEGORY_LABELS.mikrogreen).toBeTruthy();
  });

  it('dihitung sebagai tanaman panen', () => {
    expect(CATEGORY_PANEN).toContain('mikrogreen');
    for (const p of mikro) expect(dipanen(p), p.id).toBe(true);
  });

  it('umur panennya sangat pendek — itu seluruh alasan keberadaannya', () => {
    for (const p of mikro) {
      expect(p.daysToHarvest![1], p.id).toBeLessThanOrEqual(21);
    }
  });

  it('tidak panen berulang — sekali potong lalu semai ulang', () => {
    for (const p of mikro) {
      expect(p.repeatHarvest, p.id).toBe(false);
      expect(p.harvestEveryDays, p.id).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd backend && npx vitest run src/lib/garden_media.test.ts`
Expected: FAIL — modul belum ada dan kategori `mikrogreen` belum ada.

- [ ] **Step 3: Tulis `garden_media.ts`**

```ts
/**
 * Media tanam selain tanah, dan apa yang berubah karenanya.
 *
 * Seluruh modul kebun sampai sekarang mengandaikan tanah atau polybag:
 * `waterIntervalDays` di katalog berarti "siram tiap N hari". Untuk
 * hidroponik, kalimat itu bukan sekadar kurang tepat — ia salah. Akarnya
 * memang selalu di dalam air; yang perlu dikerjakan adalah mengganti
 * larutannya sebelum garamnya menumpuk.
 *
 * Vertikultur dan tabulampot tetap disiram, tapi punya jebakan sendiri yang
 * pantas diingatkan sekali daripada ditemukan sesudah tanamannya kerdil.
 */

export type Media = 'tanah' | 'polybag' | 'hidroponik' | 'vertikultur' | 'tabulampot';

export const MEDIA_LABEL: Record<Media, string> = {
  tanah: 'Tanah langsung',
  polybag: 'Polybag / pot',
  hidroponik: 'Hidroponik',
  vertikultur: 'Vertikultur',
  tabulampot: 'Tabulampot',
};

const SEMUA = Object.keys(MEDIA_LABEL) as Media[];

/** Setiap tenggang ini larutan hidroponik diganti, hari. */
export const HARI_GANTI_LARUTAN = 10;

/**
 * Nilai tak dikenal jatuh ke 'tanah', bukan melempar galat: media adalah
 * keterangan tambahan, dan penanaman tanpa keterangan yang sah tetap harus
 * bisa dirawat seperti biasa.
 */
export function bersihkanMedia(nilai: unknown): Media {
  return typeof nilai === 'string' && (SEMUA as string[]).includes(nilai)
    ? (nilai as Media)
    : 'tanah';
}

export function butuhSiram(media: Media): boolean {
  return media !== 'hidroponik';
}

function selisihHari(dari: string, ke: string): number {
  const a = Date.parse(`${dari}T00:00:00Z`);
  const b = Date.parse(`${ke}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Tugas tambahan yang lahir dari medianya, bukan dari tanamannya. */
export function tugasMedia(
  media: Media,
  lastSolutionChange: string | null,
  hariIni: string
): string[] {
  if (media === 'hidroponik') {
    const tugas = ['Cek EC dan pH larutan.'];
    const umur = lastSolutionChange ? selisihHari(lastSolutionChange, hariIni) : null;
    if (umur === null || umur >= HARI_GANTI_LARUTAN) {
      tugas.push(
        umur === null
          ? 'Ganti larutan nutrisi — belum pernah dicatat.'
          : `Ganti larutan nutrisi — sudah ${umur} hari.`
      );
    }
    return tugas;
  }

  if (media === 'vertikultur') {
    return [
      'Putar posisi rak: baris bawah dapat cahaya paling sedikit dan akan tertinggal kalau dibiarkan di situ terus.',
      'Cek baris paling bawah — air dari atas menumpuk di sana dan bisa membuat akar busuk.',
    ];
  }

  if (media === 'tabulampot') {
    return [
      'Cek akar yang keluar dari lubang bawah pot; kalau sudah melingkar, saatnya ganti media atau pangkas akar.',
    ];
  }

  return [];
}
```

- [ ] **Step 4: Tambah kategori dan entri mikrogreen di `plants.ts`**

Pada `PlantCategory`, tambahkan `| 'mikrogreen'`. Pada `CATEGORY_LABELS`, tambahkan `mikrogreen: 'Mikrogreen'`. Pada `CATEGORY_PANEN`, masukkan `'mikrogreen'`.

Tambahkan enam entri dengan bentuk yang sama persis dengan entri sayuran daun yang sudah ada. Contoh satu entri lengkap; lima sisanya (`mikrogreen-lobak`, `mikrogreen-bunga-matahari`, `mikrogreen-kacang-hijau`, `mikrogreen-selada-air`, `mikrogreen-brokoli`) ditulis dengan pola yang sama, hanya berbeda angka dan teks:

```ts
  {
    id: 'mikrogreen-sawi',
    name: 'Mikrogreen sawi',
    latinName: 'Brassica juncea',
    category: 'mikrogreen',
    emoji: '🌱',
    daysToHarvest: [8, 12],
    repeatHarvest: false,
    harvestEveryDays: null,
    waterIntervalDays: 1,
    waterNote: 'Semprot kabut dua kali sehari. Jangan disiram deras — benih akan hanyut dan tumbuh tidak rata.',
    fertilizeIntervalDays: 30,  // BUKAN 0: tes katalog menuntut > 0 untuk semua tanaman.
    fertilizer: 'Tidak perlu. Cadangan makanan di dalam benih cukup sampai panen.',
    sunlight: 'sebagian',
    spacingCm: 0,
    potLiter: 1,
    difficulty: 'mudah',
    season: 'Sepanjang tahun',
    phRange: [6.0, 7.0],
    altitude: 'rendah sampai tinggi',
    pests: ['jamur busuk'],
    companions: [],
    avoid: [],
    propagation: 'Sebar benih rapat di nampan, gelap 2 hari lalu kena cahaya',
    harvestNote: 'Potong tepat di atas media saat daun sejati pertama mulai muncul. Lewat dari itu rasanya jadi pahit.',
    tips: 'Tumbuh di dalam rumah tanpa matahari langsung, panen 8–12 hari. Siklus tercepat di seluruh katalog — cocok untuk memulai kebiasaan merawat, dan untuk anak yang butuh melihat hasil sebelum kehilangan minat.',
  },
```

- [ ] **Step 5: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/lib/garden_media.test.ts src/data/plants.test.ts`
Expected: PASS keduanya. Tes katalog yang sudah ada (`tiap kategori berlabel benar-benar terpakai`, `tanaman pangan semuanya punya umur panen`) wajib tetap hijau.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/garden_media.ts backend/src/lib/garden_media.test.ts backend/src/data/plants.ts
git commit -m "feat(kebun): media tanam non-tanah dan kategori mikrogreen"
```

---

### Task 8: Rute `garden_extra4.ts` + setting mdpl

**Files:**
- Create: `backend/src/routes/garden_extra4.ts`
- Test: `backend/src/routes/garden_extra4.test.ts`
- Modify: `backend/src/index.ts` (impor + `app.route`, sebelum `garden`)
- Modify: `backend/src/lib/settings_schema.ts` (satu entri baru di grup `kebun`)

**Interfaces:**
- Consumes: seluruh lib dari Task 2–7.
- Produces endpoint berikut, semuanya di bawah prefiks `/api/garden`:

| Method | Path | Isi |
|---|---|---|
| GET | `/soil` | daftar uji terbaru per lokasi + tanaman yang salah tanah + lokasi yang belum pernah diuji |
| POST | `/soil` | simpan satu hasil uji |
| DELETE | `/soil/:id` | hapus satu hasil uji |
| GET | `/propagation` | daftar catatan + ringkasan per metode + metode yang disarankan katalog |
| POST | `/propagation` | catat batch baru |
| PATCH | `/propagation/:id` | isi `count_rooted` dan `rooted_date` |
| DELETE | `/propagation/:id` | hapus catatan |
| GET | `/mangsa` | mangsa berjalan + berikutnya + tanaman katalog yang cocok musimnya |
| GET | `/seedling-schedule?target=YYYY-MM-DD` | jadwal mundur untuk tanaman yang lewat persemaian |
| GET | `/media` | media tiap penanaman + tugas tambahan hari ini |
| PUT | `/media/:plantingId` | set media satu penanaman |
| GET | `/altitude` | mdpl tersimpan + tanaman aktif yang tidak cocok ketinggiannya |

- [ ] **Step 1: Tambah setting mdpl**

Di `backend/src/lib/settings_schema.ts`, di dalam blok `KEBUN` (sesudah `garden.succession_days`):

```ts
  {
    key: 'garden.altitude_mdpl',
    group: 'kebun',
    label: 'Ketinggian kebun',
    hint: 'Meter di atas permukaan laut. Dipakai untuk menandai tanaman yang tidak cocok di ketinggian ini sebelum ditanam.',
    type: 'number',
    default: 0,
    min: 0,
    max: 3000,
    unit: 'mdpl',
  },
```

Frontend tidak perlu disentuh: layar Pengaturan merender sendiri dari registry backend.

- [ ] **Step 2: Tulis tes rute yang gagal**

Ikuti bentuk `backend/src/routes/garden_extra3.test.ts` yang sudah ada — pakai helper penyiapan database dan pembuatan pengguna yang sama persis dari berkas itu. Kasus yang wajib ada:

```ts
// /soil
it('POST /soil menyimpan uji dan GET /soil mengembalikannya', async () => { /* ... */ });
it('POST /soil menolak pH di luar 3.5–9.5 dengan 400', async () => { /* ... */ });
it('GET /soil menandai tanaman yang berdiri di tanah terlalu masam', async () => { /* ... */ });
it('GET /soil memakai uji terbaru, bukan uji pertama', async () => { /* ... */ });
it('DELETE /soil/:id milik pengguna lain mengembalikan 404, bukan menghapus', async () => { /* ... */ });

// /propagation
it('POST /propagation mencatat batch baru', async () => { /* ... */ });
it('PATCH /propagation/:id mengisi jumlah yang berakar', async () => { /* ... */ });
it('PATCH menolak count_rooted lebih besar dari count_started dengan 400', async () => { /* ... */ });
it('GET /propagation meringkas keberhasilan per metode', async () => { /* ... */ });
it('GET /propagation menyarankan metode dari kolom propagation katalog', async () => { /* ... */ });
it('pengguna lain tidak melihat catatan perbanyakan pengguna ini', async () => { /* ... */ });

// /mangsa
it('GET /mangsa mengembalikan mangsa berjalan dan berikutnya', async () => { /* ... */ });
it('GET /mangsa hanya menyarankan tanaman yang musimnya cocok', async () => { /* ... */ });

// /seedling-schedule
it('GET /seedling-schedule menolak target tanpa format YYYY-MM-DD dengan 400', async () => { /* ... */ });
it('GET /seedling-schedule melewati tanaman yang ditanam benih langsung', async () => { /* ... */ });

// /media
it('PUT /media/:plantingId menyimpan media', async () => { /* ... */ });
it('PUT /media pada penanaman pengguna lain mengembalikan 404', async () => { /* ... */ });
it('GET /media memberi tugas ganti larutan untuk hidroponik yang lewat tenggat', async () => { /* ... */ });
it('GET /media tidak memberi tugas siram untuk hidroponik', async () => { /* ... */ });

// /altitude
it('GET /altitude menandai tanaman yang tidak cocok di mdpl tersimpan', async () => { /* ... */ });
it('GET /altitude dengan mdpl 0 tetap menilai, tidak menganggapnya belum diisi', async () => { /* ... */ });
```

Setiap `/* ... */` diisi dengan badan tes nyata mengikuti pola `garden_extra3.test.ts`: siapkan baris melalui `DB.prepare(...).bind(...).run()`, panggil `app.request(...)` dengan header autentikasi, lalu periksa status dan bentuk JSON-nya.

- [ ] **Step 3: Jalankan tes, pastikan gagal**

Run: `cd backend && npx vitest run src/routes/garden_extra4.test.ts`
Expected: FAIL — rute belum ada.

- [ ] **Step 4: Tulis rutenya**

Salin kerangka dari `backend/src/routes/garden_extra3.ts`: `new Hono<AuthContext>()`, `use('/*', requireAuth)`, `c.get('user')` di tiap handler, dan `user.sub` selalu ikut di klausa `WHERE`. Aturan yang tidak boleh dilanggar:

- Setiap `SELECT`, `UPDATE`, dan `DELETE` menyertakan `user_id = ?` — tidak ada pengecualian.
- `DELETE` dan `PATCH` yang tidak mengubah baris apa pun mengembalikan 404, bukan 200.
- pH masuk lewat `bersihkanPh`; `null` berarti 400.
- `count_rooted > count_started` adalah 400.
- `media` masuk lewat `bersihkanMedia`.
- Tanggal divalidasi dengan `/^\d{4}-\d{2}-\d{2}$/` sebelum dipakai.
- Hari ini diambil dengan `jakartaToday()` dari `./garden`, sama seperti rute kebun lain.

- [ ] **Step 5: Pasang rutenya di index.ts**

```ts
import gardenExtra4 from './routes/garden_extra4';
```

dan, tepat sesudah baris `app.route('/api/garden', gardenExtra3);`:

```ts
app.route('/api/garden', gardenExtra4);
```

WAJIB sebelum `app.route('/api/garden', garden);` — `garden.ts` punya rute `/:id` yang akan menelan `/soil`, `/mangsa`, dan semua path lain yang dipasang sesudahnya.

- [ ] **Step 6: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/routes/garden_extra4.test.ts`
Expected: PASS semua.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/garden_extra4.ts backend/src/routes/garden_extra4.test.ts backend/src/index.ts backend/src/lib/settings_schema.ts
git commit -m "feat(kebun): endpoint uji tanah, perbanyakan, mangsa, media, ketinggian"
```

---

### Task 9: Frontend `GardenGrow4.tsx` + pemasangan

**Files:**
- Create: `frontend/src/screens/GardenGrow4.tsx`
- Modify: `frontend/src/screens/GardenExtras.tsx` (impor + pasang ke tab)

**Interfaces:**
- Consumes: endpoint dari Task 8 melalui `apiFetch`.
- Produces:
  - `export function SoilSections({ plantings }: { plantings: Planting[] })` — tab Rencana
  - `export function MangsaSection()` — tab Rencana
  - `export function PropagationSections({ plantings }: { plantings: Planting[] })` — tab Catatan
  - `export function MediaSection({ plantings }: { plantings: Planting[] })` — tab Catatan

- [ ] **Step 1: Tulis komponennya**

Ikuti bentuk `frontend/src/screens/GardenGrow3.tsx` yang sudah ada: `useState` + `useEffect` untuk memuat, `apiFetch` bertipe, keadaan memuat dan kosong yang eksplisit, dan gaya kartu yang sama. Yang wajib ada di layar:

- **Uji tanah:** daftar uji terbaru per lokasi, formulir catat pH (input angka, pilihan tekstur, tanggal), dan peringatan tanaman salah tanah beserta saran perbaikannya. Warna peringatan: terlalu masam merah, terlalu basa oranye.
- **Mangsa:** kartu mangsa berjalan — nama, rentang tanggal, pertanda, saran — dan satu baris kecil "berikutnya: <nama> mulai <tanggal>".
- **Perbanyakan:** ringkasan keberhasilan per metode, daftar batch dengan tombol isi hasil, formulir catat batch baru, dan saran metode dari katalog untuk tanaman yang dipilih.
- **Media:** daftar penanaman dengan pilihan media, dan tugas tambahan hari ini untuk yang bukan tanah.

- [ ] **Step 2: Pasang ke GardenExtras.tsx**

Impor keempat komponen, lalu pasang `SoilSections` dan `MangsaSection` di tab **Rencana**, `PropagationSections` dan `MediaSection` di tab **Catatan** — mengikuti persis cara `GrowPlannerSections3` dan `GrowRecordSections3` dipasang sekarang.

- [ ] **Step 3: Jalankan tes dan build frontend**

Run: `cd frontend && npx vitest run && npm run build`
Expected: seluruh tes frontend yang sudah ada tetap PASS, build selesai tanpa galat TypeScript.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/GardenGrow4.tsx frontend/src/screens/GardenExtras.tsx
git commit -m "feat(kebun): layar uji tanah, mangsa, perbanyakan, dan media"
```

---

### Task 10: Verifikasi menyeluruh, merge, deploy

**Files:** tidak ada berkas baru.

- [ ] **Step 1: Seluruh tes backend**

Run: `cd backend && npx vitest run`
Expected: PASS semua, termasuk 891 tes yang sudah ada sebelumnya. Satu pun yang merah menghentikan langkah ini.

- [ ] **Step 2: Seluruh tes frontend + build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS dan build bersih.

- [ ] **Step 3: Migrasi idempoten tiga kali**

Run: `cd backend && npm run db:migrate && npm run db:migrate && npm run db:migrate`
Expected: ketiganya sukses.

- [ ] **Step 4: Periksa integrasi yang mudah terlewat**

- [ ] `garden_extra4` terpasang SEBELUM `garden` di `src/index.ts`
- [ ] Ketiga tabel baru ada di `DATA_TABLES` pada `src/routes/settings.ts`
- [ ] `0037_kebun_tanah_perbanyakan.sql` ada di `db:migrate` **dan** `db:migrate:remote`
- [ ] `garden.altitude_mdpl` muncul di layar Pengaturan grup Kebun
- [ ] Tidak ada `ALTER TABLE` sungguhan di migrasi baru. Jangan pakai `grep -c "ALTER TABLE"` polos — komentar di berkas itu menyebut frasanya dan hasilnya jadi positif palsu. Yang benar memeriksa baris DDL saja:
  `grep -nE "^\s*(ALTER|DROP)" backend/migrations/0037_*.sql` — keluaran kosong berarti aman.

- [ ] **Step 5: Push dan buka PR draft**

```bash
git push -u origin claude/cek-pending-cloudflare-deploy-kb4b07
```

Buka PR draft ke `main`. Isi badan PR dengan daftar fitur, tabel baru, dan jumlah tes.

- [ ] **Step 6: Merge dan deploy**

Tandai PR siap ditinjau, merge ke `main`. Workflow `Deploy to Cloudflare` berjalan sendiri pada push ke `main` — ia tidak punya pemicu `workflow_dispatch`, jadi jangan coba memicunya manual. Pantau sampai statusnya `success`.

---

## Self-Review

**Cakupan terhadap rekomendasi yang disetujui:**

| Fitur | Task | Status |
|---|---|---|
| #1 pH tanah | 1, 3, 8, 9 | tercakup |
| #2 Perbanyakan/stek | 1, 4, 8, 9 | tercakup |
| #3 Ketinggian mdpl | 2, 8 | tercakup |
| #4 Pranata Mangsa | 5, 8, 9 | tercakup |
| #5 Diagnosa foto | — | **sudah ada sebelumnya**, dikeluarkan dari plan |
| #6 Semai mundur | 4, 6, 8 | tercakup |
| #7 Media hidroponik/vertikultur | 1, 7, 8, 9 | tercakup |
| #8 Mikrogreen | 7 | tercakup |

**Konsistensi tipe:** `pekanSemai` didefinisikan di Task 4 dan dipakai Task 6 dengan nama yang sama. `bersihkanMedia`, `tugasMedia`, `HARI_GANTI_LARUTAN` didefinisikan Task 7 dan dipakai Task 8. `cariSalahTanah`, `saranPerbaikan`, `bersihkanPh` didefinisikan Task 3 dan dipakai Task 8. `cocokKetinggian` didefinisikan Task 2 dan dipakai Task 8. Nama tabel di Task 1 sama dengan yang dipakai Task 8.

**Catatan lingkup:** `sowLeadDays` di `garden_succession.ts` sengaja tidak diubah — ia menjawab pertanyaan yang berbeda dan sudah punya tes sendiri.
