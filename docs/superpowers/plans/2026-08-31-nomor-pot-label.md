# Nomor Pot pada Label dan Daftar Tanaman — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memberi tiap pot nomor unik per jenis (`Cabai #1`, `Cabai #2`) yang tercetak di label, tampil di daftar tanaman, bisa dipilah saat memupuk, dan bisa diedit sendiri oleh pengguna.

**Architecture:** Satu baris `garden_plantings` dengan `quantity: N` diperlakukan sebagai N pot yang bisa dibedakan. Tiap pot dapat baris di `garden_planting_unit`. Kuncinya dua lapis: `unit_no` **permanen** dan dipakai semua relasi, `code` **bisa diubah** dan hanya untuk dibaca manusia. Log perawatan menunjuk `unit_no`, jadi mengganti kode tidak pernah menulis ulang riwayat.

**Tech Stack:** Cloudflare Workers + Hono + D1 (SQLite), TypeScript, Vitest, React + Vite, jsPDF.

**Spec:** Desain yang disetujui pada percakapan 2026-08-31 (nomor per jenis, per pot, kode bisa diedit). Tidak ada berkas spec terpisah — plan ini kontraknya.

## Global Constraints

- Migrasi WAJIB idempoten. Tidak boleh ada `ALTER TABLE` — skrip `db:migrate` dijalankan ulang tiap deploy. Hanya `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `INSERT ... WHERE NOT EXISTS`.
- Migrasi baru WAJIB didaftarkan ke `backend/package.json` pada `db:migrate` **dan** `db:migrate:remote`.
- Tabel milik pengguna WAJIB masuk `DATA_TABLES` di `backend/src/routes/settings.ts`.
- Setiap endpoint WAJIB memeriksa `user_id` sebelum membaca atau menulis.
- Semua tanggal `YYYY-MM-DD`; perhitungan tanggal memakai metode UTC saja.
- Semua teks yang dilihat pengguna dalam Bahasa Indonesia. Komentar kode menjelaskan **kenapa**, bukan **apa**.
- **`unit_no` tidak pernah berubah dan tidak pernah dipakai ulang** dalam satu `planting_id`. Ia kunci semua relasi.
- **`code` boleh diubah**, tapi wajib unik di antara unit **aktif** dengan kunci jenis yang sama milik satu pengguna.
- Nomor otomatis **tidak pernah dihitung ulang** dari jumlah baris — selalu dari nilai tertinggi yang pernah dipakai, termasuk yang sudah pensiun. Label fisik sudah menempel di pot.
- Perilaku lama harus utuh: log perawatan tanpa baris di `garden_care_log_unit` berarti **"semua pot"**.

## Struktur Berkas

| Berkas | Tanggung jawab |
|---|---|
| `backend/migrations/0038_pot_unit.sql` | dua tabel + backfill unit untuk tanaman yang sudah ada |
| `backend/src/lib/garden_unit.ts` | logika murni: kunci jenis, alokasi nomor, validasi kode, deteksi tabrakan/tukar, ringkas rentang |
| `backend/src/routes/garden_unit.ts` | endpoint unit: daftar, ubah kode, tukar, pensiun, aktifkan lagi |
| `backend/src/routes/garden.ts` | `POST /:id/care` menerima `units`; daftar tanaman ikut membawa ringkasan unit |
| `frontend/src/lib/labelPrint.ts` | tata letak lencana kode di label |
| `frontend/src/screens/Garden.tsx` | label diperluas per unit, kode tercetak, pemilih unit saat aksi perawatan |
| `frontend/src/screens/GardenUnits.tsx` | layar kelola unit: ubah kode, tukar, pensiun |

Rute ditaruh di berkas bernama `garden_unit.ts`, bukan `garden_extra5.ts`. Penomoran `extra2/3/4` menandai gelombang waktu, bukan pokok bahasan; berkas ini punya satu pokok bahasan yang jelas dan namanya sebaiknya menyebutkannya.

---

### Task 1: Migrasi 0038 + backfill

**Files:**
- Create: `backend/migrations/0038_pot_unit.sql`
- Modify: `backend/package.json` (`db:migrate`, `db:migrate:remote`)
- Modify: `backend/src/routes/settings.ts` (sesudah baris `garden_planting_media`)

**Interfaces:**
- Consumes: `garden_plantings`, `garden_care_log`, `users`.
- Produces: tabel `garden_planting_unit`, `garden_care_log_unit`, terisi untuk seluruh tanaman yang sudah ada.

- [ ] **Step 1: Tulis migrasi**

```sql
-- Nomor pot: satu baris per pot fisik, dan pot mana yang tercakup satu log.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE.

-- #1 Satu pot fisik.
--
-- Sampai sekarang satu baris garden_plantings dengan quantity 5 adalah satu
-- benda bagi aplikasi, padahal di kebun ia lima pot yang berdiri terpisah.
-- Saat memupuk, dua cabai di dua pot terlihat persis sama di layar — dan
-- itulah yang membuatnya tertukar.
--
-- Dua kunci yang sengaja dipisah:
--   unit_no — PERMANEN. Semua relasi menunjuk ini. Tidak pernah berubah,
--             tidak pernah dipakai ulang dalam satu planting_id.
--   code    — yang TERCETAK di label, dan boleh diubah pengguna. Karena
--             riwayat menunjuk unit_no, mengganti kode tidak pernah menulis
--             ulang catatan perawatan yang sudah ada.
CREATE TABLE IF NOT EXISTS garden_planting_unit (
  planting_id TEXT NOT NULL REFERENCES garden_plantings(id) ON DELETE CASCADE,
  unit_no INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Kunci jenis: plant_id kalau ada di katalog, kalau tidak nama yang
  -- dinormalkan. Disimpan, bukan diturunkan saat dibaca — nama kustom bisa
  -- diedit, dan deret nomornya tidak boleh ikut pindah kalau itu terjadi.
  species_key TEXT NOT NULL,
  code TEXT NOT NULL,
  -- Pot yang mati atau dibuang. Barisnya TIDAK dihapus: nomornya harus tetap
  -- terpakai supaya nomor otomatis berikutnya tidak menabraknya, dan supaya
  -- riwayat perawatannya tetap punya induk.
  retired_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (planting_id, unit_no)
);
CREATE INDEX IF NOT EXISTS idx_garden_planting_unit_user
  ON garden_planting_unit(user_id, species_key);
CREATE INDEX IF NOT EXISTS idx_garden_planting_unit_planting
  ON garden_planting_unit(planting_id);

-- #2 Pot mana saja yang tercakup satu log perawatan.
--
-- Tabel pendamping, bukan kolom di garden_care_log: ALTER TABLE tidak boleh
-- ada di skrip migrasi yang dijalankan ulang tiap deploy, dan yang lebih
-- penting — log TANPA baris di sini berarti "semua pot". Dengan begitu setiap
-- log yang sudah tercatat sebelum fitur ini ada tetap benar artinya, tanpa
-- satu baris pun perlu ditulis ulang.
CREATE TABLE IF NOT EXISTS garden_care_log_unit (
  care_log_id TEXT NOT NULL REFERENCES garden_care_log(id) ON DELETE CASCADE,
  unit_no INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (care_log_id, unit_no)
);
CREATE INDEX IF NOT EXISTS idx_garden_care_log_unit_user
  ON garden_care_log_unit(user_id);

-- #3 Backfill: tiap tanaman yang sudah ada mendapat unit sebanyak quantity.
--
-- Recursive CTE, karena SQLite tidak punya generate_series. Diurutkan
-- planted_date lalu created_at lalu id — deterministik, jadi menjalankan
-- migrasi ini di dua tempat menghasilkan nomor yang sama persis.
--
-- Idempoten lewat NOT EXISTS di akhir: baris yang sudah ada tidak disentuh,
-- termasuk yang kodenya sudah diedit pengguna.
WITH RECURSIVE
  -- quantity dibatasi 200: satu catatan dengan jumlah lebih besar dari itu
  -- hampir pasti salah ketik, dan membuat 10.000 baris unit dari satu typo
  -- jauh lebih sulit dibereskan daripada menambahkannya nanti dengan sadar.
  dasar(id, user_id, species_key, qty, urut) AS (
    SELECT
      p.id,
      p.user_id,
      COALESCE(NULLIF(TRIM(p.plant_id), ''), 'nama:' || LOWER(TRIM(COALESCE(p.custom_name, 'tanaman')))),
      MIN(MAX(COALESCE(p.quantity, 1), 1), 200),
      ROW_NUMBER() OVER (
        PARTITION BY p.user_id,
                     COALESCE(NULLIF(TRIM(p.plant_id), ''), 'nama:' || LOWER(TRIM(COALESCE(p.custom_name, 'tanaman'))))
        ORDER BY p.planted_date, p.created_at, p.id
      )
    FROM garden_plantings p
  ),
  -- Nomor awal tiap catatan = jumlah seluruh pot pada catatan sebelumnya
  -- dalam jenis yang sama. Deret berlanjut lintas catatan, jadi cabai yang
  -- ditanam bulan lalu dan bulan ini tidak sama-sama mulai dari #1.
  awal(id, user_id, species_key, qty, mulai) AS (
    SELECT
      d.id, d.user_id, d.species_key, d.qty,
      COALESCE((
        SELECT SUM(d2.qty) FROM dasar d2
        WHERE d2.user_id = d.user_id AND d2.species_key = d.species_key AND d2.urut < d.urut
      ), 0)
    FROM dasar d
  ),
  deret(id, user_id, species_key, qty, mulai, n) AS (
    SELECT id, user_id, species_key, qty, mulai, 1 FROM awal
    UNION ALL
    SELECT id, user_id, species_key, qty, mulai, n + 1 FROM deret WHERE n < qty
  )
INSERT INTO garden_planting_unit (planting_id, unit_no, user_id, species_key, code)
SELECT d.id, d.n, d.user_id, d.species_key, CAST(d.mulai + d.n AS TEXT)
FROM deret d
WHERE NOT EXISTS (
  SELECT 1 FROM garden_planting_unit u
  WHERE u.planting_id = d.id AND u.unit_no = d.n
);
```

- [ ] **Step 2: Daftarkan migrasi**

Tambahkan di akhir rantai `db:migrate` **dan** `db:migrate:remote` di `backend/package.json`, meniru bentuk entri `0037` persis (yang remote memakai `--remote`):

```
&& wrangler d1 execute fayolla-db --file=./migrations/0038_pot_unit.sql
```

- [ ] **Step 3: Daftarkan tabel ke DATA_TABLES**

Di `backend/src/routes/settings.ts`, sesudah baris `garden_planting_media`:

```ts
  { table: 'garden_planting_unit', label: 'Nomor pot', group: 'Kebun', userScoped: true },
  { table: 'garden_care_log_unit', label: 'Pot pada log perawatan', group: 'Kebun', userScoped: true },
```

- [ ] **Step 4: Verifikasi idempoten dan backfill benar**

```bash
cd backend
for i in 1 2 3; do npx wrangler d1 execute fayolla-db --local --file=./migrations/0038_pot_unit.sql >/dev/null && echo "pass $i ok"; done
npx wrangler d1 execute fayolla-db --local --command="SELECT species_key, COUNT(*) n, MIN(CAST(code AS INTEGER)) lo, MAX(CAST(code AS INTEGER)) hi FROM garden_planting_unit GROUP BY species_key"
```

Expected: tiga pass sukses. Untuk tiap `species_key`, `hi - lo + 1 = n` — deretnya rapat tanpa lompat dan tanpa duplikat.

Periksa juga tidak ada `ALTER`/`DROP` sungguhan (komentar menyebut frasanya, jadi jangan pakai grep polos):

```bash
grep -nE "^\s*(ALTER|DROP)" migrations/0038_pot_unit.sql   # harus kosong
```

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/0038_pot_unit.sql backend/package.json backend/src/routes/settings.ts
git commit -m "feat(kebun): tabel nomor pot dan cakupan pot pada log perawatan"
```

---

### Task 2: `garden_unit.ts` — logika murni nomor pot

**Files:**
- Create: `backend/src/lib/garden_unit.ts`
- Test: `backend/src/lib/garden_unit.test.ts`

**Interfaces:**
- Produces:
  - `export const MAX_UNIT_PER_PLANTING = 200`
  - `export const MAX_CODE_LEN = 8`
  - `export function speciesKey(plantId: string | null, customName: string | null): string`
  - `export function bersihkanKode(raw: unknown): string | null`
  - `export function kodeBerikutnya(kodeTerpakai: string[]): string`
  - `export interface Unit { unitNo: number; code: string; retired: boolean }`
  - `export function ringkasKode(units: Unit[]): string`
  - `export type HasilUbah = { jenis: 'bebas' } | { jenis: 'tukar'; denganUnitNo: number; denganPlantingId: string } | { jenis: 'ditolak'; alasan: string }`
  - `export interface UnitLain { plantingId: string; unitNo: number; code: string; retired: boolean }`
  - `export function rencanaUbahKode(kodeBaru: string, sendiri: { plantingId: string; unitNo: number }, semuaSejenis: UnitLain[]): HasilUbah`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
import { describe, it, expect } from 'vitest';
import {
  speciesKey, bersihkanKode, kodeBerikutnya, ringkasKode, rencanaUbahKode,
  MAX_CODE_LEN,
} from './garden_unit';

describe('speciesKey', () => {
  it('memakai plant_id kalau tanamannya ada di katalog', () => {
    expect(speciesKey('cabai-rawit', null)).toBe('cabai-rawit');
  });

  it('memakai nama yang dinormalkan kalau di luar katalog', () => {
    expect(speciesKey(null, '  Cabai Gendot  ')).toBe('nama:cabai gendot');
  });

  it('nama beda huruf besar-kecil tetap satu deret', () => {
    expect(speciesKey(null, 'Cabai')).toBe(speciesKey(null, 'CABAI'));
  });

  it('tanpa keduanya tetap menghasilkan kunci, bukan string kosong', () => {
    // Kunci kosong akan menyatukan semua tanaman tak bernama jadi satu deret.
    expect(speciesKey(null, null)).toBe('nama:tanaman');
    expect(speciesKey('', '   ')).toBe('nama:tanaman');
  });
});

describe('bersihkanKode', () => {
  it('menerima angka dan teks pendek', () => {
    expect(bersihkanKode('3')).toBe('3');
    expect(bersihkanKode(3)).toBe('3');
    expect(bersihkanKode('A1')).toBe('A1');
  });

  it('merapikan spasi', () => {
    expect(bersihkanKode('  B2  ')).toBe('B2');
  });

  it('menolak yang kosong', () => {
    expect(bersihkanKode('')).toBeNull();
    expect(bersihkanKode('   ')).toBeNull();
    expect(bersihkanKode(null)).toBeNull();
  });

  it('menolak yang terlalu panjang untuk muat di label', () => {
    expect(bersihkanKode('A'.repeat(MAX_CODE_LEN))).toBe('A'.repeat(MAX_CODE_LEN));
    expect(bersihkanKode('A'.repeat(MAX_CODE_LEN + 1))).toBeNull();
  });

  it('menolak karakter yang tidak terbaca di label cetak', () => {
    // Font helvetica bawaan jsPDF hanya mengerti Latin-1; emoji tercetak
    // sebagai karakter acak dan lebarnya salah dihitung.
    expect(bersihkanKode('🌶️')).toBeNull();
    expect(bersihkanKode('A/B')).toBeNull();
    expect(bersihkanKode('A-1')).toBe('A-1');
  });
});

describe('kodeBerikutnya', () => {
  it('mulai dari 1 kalau belum ada apa-apa', () => {
    expect(kodeBerikutnya([])).toBe('1');
  });

  it('melanjutkan dari angka tertinggi', () => {
    expect(kodeBerikutnya(['1', '2', '3'])).toBe('4');
  });

  it('tidak memakai ulang nomor yang bolong', () => {
    // #2 sudah pensiun tapi labelnya bisa saja masih ada di gudang.
    // Nomor otomatis tidak boleh menabraknya.
    expect(kodeBerikutnya(['1', '3'])).toBe('4');
  });

  it('mengabaikan kode non-angka saat mencari yang tertinggi', () => {
    expect(kodeBerikutnya(['1', 'A1', '2'])).toBe('3');
  });

  it('kode non-angka saja tetap menghasilkan angka', () => {
    expect(kodeBerikutnya(['A1', 'B2'])).toBe('1');
  });
});

describe('ringkasKode', () => {
  it('satu pot tampil apa adanya', () => {
    expect(ringkasKode([{ unitNo: 1, code: '3', retired: false }])).toBe('#3');
  });

  it('deret rapat dipendekkan jadi rentang', () => {
    expect(ringkasKode([
      { unitNo: 1, code: '1', retired: false },
      { unitNo: 2, code: '2', retired: false },
      { unitNo: 3, code: '3', retired: false },
    ])).toBe('#1–#3');
  });

  it('deret berlubang disebut satu per satu, bukan dipaksa jadi rentang', () => {
    // "#1–#5" untuk pot yang sebenarnya cuma tiga adalah kebohongan yang
    // baru ketahuan saat pengguna berdiri di kebun menghitung pot.
    expect(ringkasKode([
      { unitNo: 1, code: '1', retired: false },
      { unitNo: 2, code: '3', retired: false },
      { unitNo: 3, code: '7', retired: false },
    ])).toBe('#1, #3, #7');
  });

  it('pot pensiun tidak ikut diringkas', () => {
    expect(ringkasKode([
      { unitNo: 1, code: '1', retired: false },
      { unitNo: 2, code: '2', retired: true },
      { unitNo: 3, code: '3', retired: false },
    ])).toBe('#1, #3');
  });

  it('daftar panjang dipotong dengan keterangan jumlah', () => {
    const banyak = Array.from({ length: 9 }, (_, i) => ({
      unitNo: i + 1, code: String((i + 1) * 2), retired: false,
    }));
    expect(ringkasKode(banyak)).toBe('9 pot');
  });

  it('semua pensiun menghasilkan keterangan, bukan string kosong', () => {
    expect(ringkasKode([{ unitNo: 1, code: '1', retired: true }])).toBe('tidak ada pot aktif');
  });
});

describe('rencanaUbahKode', () => {
  const sendiri = { plantingId: 'p1', unitNo: 2 };

  it('kode yang belum dipakai boleh langsung', () => {
    const hasil = rencanaUbahKode('9', sendiri, [
      { plantingId: 'p1', unitNo: 1, code: '1', retired: false },
    ]);
    expect(hasil).toEqual({ jenis: 'bebas' });
  });

  it('kode milik unit aktif lain ditawarkan sebagai tukar', () => {
    // Dua label tertukar tempel di pot yang salah — menukar nomornya jauh
    // lebih masuk akal daripada memaksa pengguna mencetak ulang keduanya.
    const hasil = rencanaUbahKode('1', sendiri, [
      { plantingId: 'p1', unitNo: 1, code: '1', retired: false },
    ]);
    expect(hasil).toEqual({ jenis: 'tukar', denganUnitNo: 1, denganPlantingId: 'p1' });
  });

  it('tukar juga berlaku lintas catatan tanaman', () => {
    const hasil = rencanaUbahKode('5', sendiri, [
      { plantingId: 'p9', unitNo: 1, code: '5', retired: false },
    ]);
    expect(hasil).toEqual({ jenis: 'tukar', denganUnitNo: 1, denganPlantingId: 'p9' });
  });

  it('kode milik unit yang sudah pensiun boleh dipakai ulang', () => {
    // Ini justru kasus yang diminta: pot lama mati, labelnya masih bagus,
    // dipasang ke pot baru.
    const hasil = rencanaUbahKode('4', sendiri, [
      { plantingId: 'p1', unitNo: 1, code: '4', retired: true },
    ]);
    expect(hasil).toEqual({ jenis: 'bebas' });
  });

  it('mengubah ke kode sendiri bukan tukar, melainkan tidak berubah', () => {
    const hasil = rencanaUbahKode('2', sendiri, [
      { plantingId: 'p1', unitNo: 2, code: '2', retired: false },
    ]);
    expect(hasil).toEqual({ jenis: 'bebas' });
  });

  it('kode tidak sah ditolak dengan alasan', () => {
    const hasil = rencanaUbahKode('', sendiri, []);
    expect(hasil.jenis).toBe('ditolak');
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd backend && npx vitest run src/lib/garden_unit.test.ts`
Expected: FAIL — `Cannot find module './garden_unit'`.

- [ ] **Step 3: Tulis implementasinya**

```ts
/**
 * Nomor pot: identitas satu tanaman fisik di dalam satu catatan penanaman.
 *
 * Satu baris garden_plantings dengan quantity 5 adalah satu benda bagi
 * aplikasi, tapi lima pot yang berdiri terpisah di kebun. Saat memupuk, dua
 * cabai di dua pot terlihat persis sama di layar — dan itulah yang membuatnya
 * tertukar.
 *
 * Dua kunci sengaja dipisah, dan pemisahan itu yang membuat kode boleh diedit
 * tanpa merusak apa pun:
 *
 *   unit_no — permanen, dipakai semua relasi termasuk log perawatan.
 *   code    — yang tercetak di label, bebas diubah pengguna.
 *
 * Karena riwayat menunjuk unit_no, mengganti kode hari ini tidak menggeser
 * satu pun catatan kemarin.
 */

/** Di atas ini hampir pasti salah ketik, bukan kebun yang besar. */
export const MAX_UNIT_PER_PLANTING = 200;

/**
 * Kode lebih panjang dari ini tidak muat terbaca di label terkecil, dan label
 * yang tidak terbaca sambil jongkok tidak menyelesaikan masalah apa pun.
 */
export const MAX_CODE_LEN = 8;

/**
 * Hanya huruf, angka, dan tanda hubung.
 *
 * Font helvetica bawaan jsPDF cuma mengerti Latin-1: emoji dan simbol tercetak
 * sebagai karakter acak, dan yang lebih parah lebarnya salah dihitung sehingga
 * teksnya meluber ke label sebelah.
 */
const KODE_SAH = /^[A-Za-z0-9-]+$/;

/**
 * Kunci deret nomor: satu deret per jenis per pengguna.
 *
 * Awalan `nama:` untuk tanaman di luar katalog supaya tidak pernah bentrok
 * dengan slug katalog — tanpa itu, tanaman kustom bernama "tomat" akan ikut
 * ke deret slug `tomat`.
 */
export function speciesKey(plantId: string | null, customName: string | null): string {
  const slug = (plantId ?? '').trim();
  if (slug) return slug;
  const nama = (customName ?? '').trim().toLowerCase();
  return `nama:${nama || 'tanaman'}`;
}

export function bersihkanKode(raw: unknown): string | null {
  const teks = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!teks || teks.length > MAX_CODE_LEN) return null;
  return KODE_SAH.test(teks) ? teks : null;
}

/**
 * Nomor otomatis berikutnya: satu di atas angka tertinggi yang PERNAH dipakai.
 *
 * Bukan jumlah baris, dan bukan lubang terkecil yang kosong. Pot yang pensiun
 * labelnya bisa saja masih tergeletak di gudang, dan memberi nomor yang sama
 * ke pot baru akan menghidupkan lagi persis kebingungan yang sedang dibereskan.
 * Pengguna tetap boleh memakai ulang nomor pensiunan — tapi dengan sadar,
 * lewat mengetiknya sendiri.
 */
export function kodeBerikutnya(kodeTerpakai: string[]): string {
  let tertinggi = 0;
  for (const k of kodeTerpakai) {
    const n = Number(k);
    if (Number.isInteger(n) && n > tertinggi) tertinggi = n;
  }
  return String(tertinggi + 1);
}

export interface Unit {
  unitNo: number;
  code: string;
  retired: boolean;
}

/** Di atas ini daftar kode lebih panjang daripada nama tanamannya sendiri. */
const MAKS_KODE_DISEBUT = 6;

/**
 * Ringkasan kode untuk satu baris daftar: '#3', '#1–#5', '#1, #3, #7'.
 *
 * Rentang hanya dipakai kalau deretnya benar-benar rapat. '#1–#5' untuk pot
 * yang sebenarnya cuma tiga adalah kebohongan yang baru ketahuan saat pengguna
 * berdiri di kebun menghitung pot.
 */
export function ringkasKode(units: Unit[]): string {
  const aktif = units.filter((u) => !u.retired);
  if (aktif.length === 0) return 'tidak ada pot aktif';
  if (aktif.length === 1) return `#${aktif[0].code}`;

  const angka = aktif.map((u) => Number(u.code));
  const semuaAngka = angka.every((n) => Number.isInteger(n));

  if (semuaAngka) {
    const urut = [...angka].sort((a, b) => a - b);
    const rapat = urut.every((n, i) => i === 0 || n === urut[i - 1] + 1);
    if (rapat) return `#${urut[0]}–#${urut[urut.length - 1]}`;
  }

  if (aktif.length > MAKS_KODE_DISEBUT) return `${aktif.length} pot`;
  return aktif.map((u) => `#${u.code}`).join(', ');
}

export type HasilUbah =
  | { jenis: 'bebas' }
  | { jenis: 'tukar'; denganUnitNo: number; denganPlantingId: string }
  | { jenis: 'ditolak'; alasan: string };

export interface UnitLain {
  plantingId: string;
  unitNo: number;
  code: string;
  retired: boolean;
}

/**
 * Apa yang terjadi kalau satu unit diberi kode baru.
 *
 * Tabrakan dengan unit aktif lain tidak ditolak, melainkan ditawarkan sebagai
 * tukar: kasus nyatanya adalah dua label yang tertempel di pot yang salah, dan
 * menukar nomornya jauh lebih masuk akal daripada memaksa mencetak ulang
 * keduanya. Tabrakan dengan unit pensiun dibiarkan lewat — memasang label lama
 * yang masih bagus ke pot baru memang tujuannya.
 */
export function rencanaUbahKode(
  kodeBaru: string,
  sendiri: { plantingId: string; unitNo: number },
  semuaSejenis: UnitLain[]
): HasilUbah {
  const kode = bersihkanKode(kodeBaru);
  if (!kode) {
    return {
      jenis: 'ditolak',
      alasan: `Kode harus 1–${MAX_CODE_LEN} karakter, hanya huruf, angka, dan tanda hubung.`,
    };
  }

  const bentrok = semuaSejenis.find(
    (u) =>
      u.code === kode &&
      !u.retired &&
      !(u.plantingId === sendiri.plantingId && u.unitNo === sendiri.unitNo)
  );

  if (!bentrok) return { jenis: 'bebas' };
  return { jenis: 'tukar', denganUnitNo: bentrok.unitNo, denganPlantingId: bentrok.plantingId };
}
```

- [ ] **Step 4: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/lib/garden_unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/garden_unit.ts backend/src/lib/garden_unit.test.ts
git commit -m "feat(kebun): logika nomor pot, kode bisa diedit dan ditukar"
```

---

### Task 3: Rute unit + `POST /:id/care` menerima pot tertentu

**Files:**
- Create: `backend/src/routes/garden_unit.ts`
- Test: `backend/src/routes/garden_unit.test.ts`
- Modify: `backend/src/index.ts` (impor + `app.route`, **sebelum** `garden`)
- Modify: `backend/src/routes/garden.ts` (`POST /:id/care`, dan daftar tanaman ikut membawa `units`)

**Interfaces:**
- Consumes: seluruh ekspor `../lib/garden_unit` dari Task 2.
- Produces endpoint di bawah prefiks `/api/garden`:

| Method | Path | Isi |
|---|---|---|
| GET | `/units` | seluruh unit pengguna, dikelompokkan per penanaman, plus ringkasan kode |
| GET | `/units/:plantingId` | unit satu penanaman |
| POST | `/units/:plantingId` | tambah pot baru pada penanaman itu (kode otomatis) |
| PATCH | `/units/:plantingId/:unitNo` | ubah kode; body `{ code, izinkanTukar? }` |
| POST | `/units/:plantingId/:unitNo/retire` | pensiunkan pot |
| POST | `/units/:plantingId/:unitNo/restore` | aktifkan lagi |

- [ ] **Step 1: Tulis tes yang gagal**

Pakai harness yang sama persis dengan `backend/src/routes/garden_extra4.test.ts` (`createTestDb`, `seedUser`, `mint`, `req`). Kasus yang wajib ada:

```ts
it('GET /units mengembalikan unit hasil backfill untuk tanaman yang ada', async () => { /* ... */ });
it('dua catatan cabai berbeda melanjutkan satu deret, bukan sama-sama mulai #1', async () => { /* ... */ });
it('PATCH mengubah kode satu pot', async () => { /* ... */ });
it('PATCH ke kode yang dipakai pot aktif lain menjawab 409 dengan usul tukar', async () => { /* ... */ });
it('PATCH dengan izinkanTukar menukar kedua kode sekaligus', async () => { /* ... */ });
it('tukar tidak menyentuh unit_no, jadi log perawatan lama tetap menunjuk pot yang sama', async () => { /* ... */ });
it('PATCH ke kode milik pot pensiun diterima', async () => { /* ... */ });
it('PATCH menolak kode kosong dan kode kepanjangan dengan 400', async () => { /* ... */ });
it('POST /units menambah pot dengan kode otomatis yang tidak menabrak pensiunan', async () => { /* ... */ });
it('retire lalu restore mengembalikan pot tanpa mengubah kodenya', async () => { /* ... */ });
it('unit milik pengguna lain tidak terlihat dan tidak bisa diubah (404)', async () => { /* ... */ });

// POST /:id/care
it('care tanpa units mencatat log tanpa baris cakupan — artinya semua pot', async () => { /* ... */ });
it('care dengan units mencatat hanya pot yang disebut', async () => { /* ... */ });
it('care menolak unit_no yang bukan milik penanaman itu dengan 400', async () => { /* ... */ });
it('kiriman ulang dengan clientId sama tidak menggandakan baris cakupan', async () => { /* ... */ });
```

Tiap `/* ... */` diisi badan tes nyata: siapkan baris lewat `db.prepare(...).bind(...).run()`, panggil `app.request(...)` dengan header autentikasi, periksa status dan bentuk JSON.

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd backend && npx vitest run src/routes/garden_unit.test.ts`
Expected: FAIL — rute belum ada.

- [ ] **Step 3: Tulis rutenya**

Salin kerangka dari `backend/src/routes/garden_extra4.ts`: `new Hono<AuthContext>()`, `use('/*', requireAuth)`, `user.sub` selalu di klausa `WHERE`. Aturan yang tidak boleh dilanggar:

- `PATCH` yang menemukan tabrakan menjawab **409** dengan `{ error, usulTukar: { plantingId, unitNo, code } }` — bukan diam-diam menimpa. Menukar baru terjadi kalau body membawa `izinkanTukar: true`.
- Penukaran dua kode dilakukan dalam satu `DB.batch([...])`. Kalau tidak, kegagalan di tengah meninggalkan dua pot berkode sama — keadaan yang justru dilarang.
- Tukar hanya menyentuh kolom `code`. `unit_no` tidak pernah ikut berubah.
- `POST /units/:plantingId` menolak dengan 400 kalau unit aktif sudah mencapai `MAX_UNIT_PER_PLANTING`.
- Setiap `SELECT`/`UPDATE`/`DELETE` menyertakan `user_id`; yang tidak mengubah baris menjawab 404.

- [ ] **Step 4: Ubah `POST /:id/care` menerima `units`**

Tambahkan `units?: number[]` ke tipe `Body`. Sesudah log tersimpan:

```ts
  // Tanpa `units`, log sengaja TIDAK menulis satu baris pun di
  // garden_care_log_unit. Ketiadaan baris berarti "semua pot" — perjanjian
  // yang membuat setiap log yang tercatat sebelum fitur nomor pot ada tetap
  // benar artinya, tanpa satu baris pun perlu ditulis ulang.
  const units = Array.isArray(body.units)
    ? [...new Set(body.units.filter((n) => Number.isInteger(n) && n > 0))]
    : [];

  if (units.length > 0) {
    const milik = (await c.env.DB.prepare(
      'SELECT unit_no FROM garden_planting_unit WHERE planting_id = ?1 AND user_id = ?2'
    ).bind(plantingId, user.sub).all<{ unit_no: number }>()).results ?? [];
    const sah = new Set(milik.map((r) => r.unit_no));

    // Unit asing ditolak, bukan diabaikan diam-diam: kalau klien mengirim
    // nomor yang bukan milik tanaman ini, yang salah adalah pemanggilnya, dan
    // menyimpan sebagian akan melahirkan riwayat yang tidak bisa dipercaya.
    const asing = units.filter((n) => !sah.has(n));
    if (asing.length > 0) {
      return c.json({ error: `pot tidak dikenal: ${asing.join(', ')}` }, 400);
    }

    // INSERT OR IGNORE, senada dengan log-nya sendiri: antrean offline pasti
    // mengirim ulang permintaan yang sebenarnya sudah sampai.
    await c.env.DB.batch(units.map((n) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO garden_care_log_unit (care_log_id, unit_no, user_id)
         VALUES (?1, ?2, ?3)`
      ).bind(logId, n, user.sub)
    ));
  }
```

`logId` adalah id log yang baru saja dipakai pada `INSERT OR IGNORE` di atasnya — pakai variabel yang sudah ada di handler itu, jangan membuat id kedua.

- [ ] **Step 5: Daftar tanaman ikut membawa unit**

Pada handler daftar tanaman di `garden.ts`, ambil unit seluruh penanaman dalam **satu** kueri lalu kelompokkan di memori — jangan satu kueri per tanaman:

```ts
  const unitRows = (await c.env.DB.prepare(
    `SELECT planting_id, unit_no, code, retired_at FROM garden_planting_unit
      WHERE user_id = ?1 ORDER BY planting_id, unit_no`
  ).bind(user.sub).all<{
    planting_id: string; unit_no: number; code: string; retired_at: number | null;
  }>()).results ?? [];

  const unitByPlanting = new Map<string, Unit[]>();
  for (const r of unitRows) {
    const daftar = unitByPlanting.get(r.planting_id) ?? [];
    daftar.push({ unitNo: r.unit_no, code: r.code, retired: r.retired_at !== null });
    unitByPlanting.set(r.planting_id, daftar);
  }
```

Tiap tanaman pada respons mendapat `units: Unit[]` dan `kodeRingkas: string` (dari `ringkasKode`).

- [ ] **Step 6: Pasang rutenya di index.ts**

```ts
import gardenUnit from './routes/garden_unit';
```

dan sesudah baris `app.route('/api/garden', gardenExtra4);`:

```ts
app.route('/api/garden', gardenUnit);
```

WAJIB sebelum `app.route('/api/garden', garden);` — `garden.ts` punya rute `/:id` yang akan menelan `/units`.

- [ ] **Step 7: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run && npm run typecheck`
Expected: seluruh suite PASS (termasuk 1018 tes yang sudah ada) dan typecheck bersih.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/garden_unit.ts backend/src/routes/garden_unit.test.ts backend/src/index.ts backend/src/routes/garden.ts
git commit -m "feat(kebun): endpoint nomor pot dan pencatatan pupuk per pot"
```

---

### Task 4: Kode tercetak di label

**Files:**
- Modify: `frontend/src/lib/labelPrint.ts`
- Test: `frontend/src/lib/__tests__/labelPrint.test.ts`
- Modify: `frontend/src/screens/Garden.tsx` (`buildLabelsPdf`, dan lembar cetak yang menyusun daftar label)

**Interfaces:**
- Consumes: `units` pada tiap tanaman dari Task 3.
- Produces:
  - `export function badgeSpec(size: LabelSize): { fontSize: number; padXmm: number; padYmm: number }`
  - `interface LabelUnit { planting: Planting; code: string | null }` (lokal di `Garden.tsx`)

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan ke `frontend/src/lib/__tests__/labelPrint.test.ts`:

```ts
import { badgeSpec, labelSizeSpec, LABEL_SIZES } from '../labelPrint';

describe('badgeSpec', () => {
  it('ada untuk tiap ukuran label', () => {
    for (const size of LABEL_SIZES) {
      expect(badgeSpec(size).fontSize, size).toBeGreaterThan(0);
    }
  });

  it('kode lebih besar daripada teks isi — ia yang dibaca sambil jongkok', () => {
    for (const size of LABEL_SIZES) {
      expect(badgeSpec(size).fontSize, size).toBeGreaterThan(labelSizeSpec(size).fontBody);
    }
  });

  it('makin besar labelnya makin besar kodenya', () => {
    expect(badgeSpec('besar').fontSize).toBeGreaterThan(badgeSpec('kecil').fontSize);
  });
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd frontend && npx vitest run src/lib/__tests__/labelPrint.test.ts`
Expected: FAIL — `badgeSpec` belum diekspor.

- [ ] **Step 3: Tulis `badgeSpec`**

```ts
/**
 * Lencana kode di pojok kanan atas label.
 *
 * Fontnya sengaja lebih besar daripada teks isi, bahkan lebih besar daripada
 * judul pada ukuran kecil: kode inilah yang dibaca sambil jongkok di depan
 * pot, sedangkan nama tanaman sudah diketahui dari bentuk daunnya.
 */
export function badgeSpec(size: LabelSize): { fontSize: number; padXmm: number; padYmm: number } {
  const BADGE: Record<LabelSize, { fontSize: number; padXmm: number; padYmm: number }> = {
    kecil: { fontSize: 9, padXmm: 1.2, padYmm: 0.8 },
    sedang: { fontSize: 12, padXmm: 1.6, padYmm: 1.0 },
    besar: { fontSize: 16, padXmm: 2.0, padYmm: 1.4 },
  };
  return BADGE[size];
}
```

- [ ] **Step 4: Cetak lencana di `buildLabelsPdf`**

Ubah tanda tangan menjadi `labels: LabelUnit[]`. Sesudah `doc.roundedRect(...)`, sebelum judul:

```ts
    // Lencana kode di kanan atas. Digambar SEBELUM judul supaya lebar judul
    // bisa dikurangi selebar lencana — tanpa itu nama tanaman yang panjang
    // akan menabrak angkanya.
    let badgeW = 0;
    if (kode) {
      const badge = badgeSpec(size);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(badge.fontSize);
      const teks = `#${kode}`;
      badgeW = doc.getTextWidth(teks) + badge.padXmm * 2;
      const badgeH = badge.fontSize * 0.42 + badge.padYmm * 2;
      const bx = x + w - badgeW - 1.5;
      const by = y + 1.5;

      if (warna) {
        doc.setFillColor(ar, ag, ab);
        doc.roundedRect(bx, by, badgeW, badgeH, 0.8, 0.8, 'F');
        doc.setTextColor(255, 255, 255);
      } else {
        doc.setDrawColor(60, 60, 60);
        doc.roundedRect(bx, by, badgeW, badgeH, 0.8, 0.8);
        doc.setTextColor(20, 20, 20);
      }
      doc.text(teks, bx + badge.padXmm, by + badgeH - badge.padYmm - badge.fontSize * 0.05);
    }
```

Lalu kurangi lebar judul: `const textWidth = w - (colorMode === 'warna' ? 7.5 : 6) - badgeW;`

- [ ] **Step 5: Perluas daftar label per unit**

Di lembar cetak, ganti perulangan yang mendorong objek tanaman yang sama berkali-kali:

```ts
  // Sebelumnya blok ini mendorong objek `p` yang SAMA sebanyak n kali, jadi
  // mencetak tiga salinan cabai menghasilkan tiga label yang tidak bisa
  // dibedakan satu sama lain — persis kebingungan yang fitur ini bereskan.
  const labels: LabelUnit[] = [];
  for (const p of plantings) {
    if (!(qty[p.id] ?? 0)) continue;
    const aktif = (p.units ?? []).filter((u) => !u.retired);
    if (aktif.length === 0) {
      labels.push({ planting: p, code: null });
      continue;
    }
    for (const u of aktif) labels.push({ planting: p, code: u.code });
  }
```

Centang di lembar cetak kini berarti "cetak label untuk seluruh pot tanaman ini", bukan "cetak n salinan". Ganti teksnya jadi jumlah pot, dan sediakan tombol per pot untuk mencetak ulang satu label saja.

- [ ] **Step 6: Jalankan tes dan build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: seluruh tes frontend PASS, build bersih.

- [ ] **Step 7: Periksa PDF-nya dengan mata**

Buat PDF contoh berisi ketiga ukuran × kedua mode warna, dengan kode terpanjang (`AB-12345`) dan nama tanaman terpanjang di katalog. Buka dan pastikan: lencana tidak keluar dari kotak, judul tidak menabrak lencana, dan kode terbaca dari jarak satu lengan.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/labelPrint.ts frontend/src/lib/__tests__/labelPrint.test.ts frontend/src/screens/Garden.tsx
git commit -m "feat(kebun): kode pot tercetak di label, satu label per pot"
```

---

### Task 5: Layar kelola nomor + pemilih pot saat memupuk

**Files:**
- Create: `frontend/src/screens/GardenUnits.tsx`
- Modify: `frontend/src/screens/Garden.tsx` (baris daftar menampilkan `kodeRingkas`; sheet aksi perawatan mendapat pemilih pot)

**Interfaces:**
- Consumes: endpoint Task 3.
- Produces: `export function UnitManager({ plantingId, onClose }: { plantingId: string; onClose: () => void })`

- [ ] **Step 1: Tulis komponennya**

Ikuti bentuk `frontend/src/screens/GardenGrow4.tsx`: `useState` + `useEffect`, `apiFetch` bertipe, keadaan memuat dan kosong yang eksplisit, gaya kartu yang sama. Yang wajib ada:

- Daftar pot dengan kodenya; pot pensiun tampil redup dengan tombol "Aktifkan lagi".
- Ketuk kode untuk mengeditnya. Saat server menjawab 409, tampilkan usulnya sebagai pilihan tegas: **"Tukar dengan #N"** atau **"Batal"** — jangan pernah menukar tanpa pengguna menyetujuinya.
- Tombol "+ Tambah pot" dan "Pensiunkan" per pot.
- Satu baris keterangan: mengganti kode hanya mengganti yang tercetak; riwayat perawatan tetap menempel pada pot yang sama.

- [ ] **Step 2: Tampilkan kode di daftar tanaman**

Pada baris daftar tanaman di `Garden.tsx`, tampilkan `kodeRingkas` di sebelah nama — inilah yang membuat dua cabai bisa dibedakan tanpa membuka apa pun.

- [ ] **Step 3: Pemilih pot pada aksi perawatan**

Pada sheet aksi (`siram` / `pupuk` / `panen`), tanaman dengan lebih dari satu pot aktif memunculkan centang per pot, **semuanya tercentang sebagai bawaan** — sekali ketuk untuk yang biasa, tapi bisa dipilah saat baru sempat separuh. Kirim `units` hanya kalau tidak semua tercentang, supaya log "semua pot" tetap tersimpan tanpa baris cakupan sesuai perjanjiannya.

- [ ] **Step 4: Jalankan tes dan build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS dan build bersih.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/GardenUnits.tsx frontend/src/screens/Garden.tsx
git commit -m "feat(kebun): layar kelola nomor pot dan pemilih pot saat merawat"
```

---

### Task 6: Verifikasi menyeluruh, merge, deploy

- [ ] **Step 1: Seluruh tes backend + typecheck**

Run: `cd backend && npx vitest run && npm run typecheck`
Expected: PASS semua, termasuk 1018 tes yang sudah ada.

- [ ] **Step 2: Seluruh tes frontend + build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS dan build bersih.

- [ ] **Step 3: Migrasi idempoten tiga kali**

Run: `cd backend && for i in 1 2 3; do npx wrangler d1 execute fayolla-db --local --file=./migrations/0038_pot_unit.sql >/dev/null && echo "ok $i"; done`

- [ ] **Step 4: Periksa integrasi yang mudah terlewat**

- [ ] `gardenUnit` terpasang SEBELUM `garden` di `src/index.ts`
- [ ] Dua tabel baru ada di `DATA_TABLES`
- [ ] `0038_pot_unit.sql` ada di `db:migrate` **dan** `db:migrate:remote`
- [ ] `grep -nE "^\s*(ALTER|DROP)" backend/migrations/0038_pot_unit.sql` kosong
- [ ] `/units` tidak bentrok dengan path di `garden_extra`, `garden_extra2`, `garden_extra3`, `garden_extra4`
- [ ] Log perawatan lama (tanpa baris cakupan) masih terbaca sebagai "semua pot" di layar

- [ ] **Step 5: Push, PR draft, merge, deploy**

```bash
git push -u origin claude/cek-pending-cloudflare-deploy-kb4b07
```

Buka PR draft ke `main`, tandai siap ditinjau, merge. Workflow `Deploy to Cloudflare` berjalan sendiri pada push ke `main` — ia tidak punya pemicu `workflow_dispatch`, jadi jangan coba memicunya manual. Pantau sampai `success`.

---

## Self-Review

**Cakupan terhadap desain yang disetujui:**

| Yang disetujui | Task |
|---|---|
| Nomor per jenis (`Cabai #1`, `#2`) | 1 (backfill), 2 (`speciesKey`, `kodeBerikutnya`) |
| Nomor per pot, bukan per catatan | 1 (`garden_planting_unit`), 4 (label per unit) |
| Nomor disimpan, tidak pernah dihitung ulang | 2 (`kodeBerikutnya` dari nilai tertinggi) |
| Jumlah naik/turun: lahir/pensiun, tanpa penomoran ulang | 3 (`POST /units`, `retire`, `restore`) |
| Kode bisa diedit pengguna | 2 (`rencanaUbahKode`), 3 (`PATCH`), 5 (UI) |
| Tukar dua nomor | 2, 3 (409 + `izinkanTukar`), 5 |
| Pakai ulang nomor pensiunan secara manual | 2 (pensiun dilewati saat cek tabrakan) |
| Label: satu per pot, kode besar | 4 |
| Daftar tanaman menampilkan kode | 3 (`kodeRingkas`), 5 |
| Pemupukan bisa dipilah per pot | 1 (`garden_care_log_unit`), 3 (`units`), 5 |
| Riwayat tidak rusak saat kode diganti | 2 (`unit_no` vs `code`), 3 (tukar hanya menyentuh `code`) |

**Konsistensi tipe:** `Unit { unitNo, code, retired }` didefinisikan Task 2 dan dipakai Task 3 (`unitByPlanting`) serta Task 5. `ringkasKode` dan `speciesKey` dipanggil Task 3 dengan nama yang sama. `badgeSpec` didefinisikan Task 4 dan hanya dipakai di sana. Nama tabel di Task 1 sama dengan yang dikueri Task 3.

**Batas lingkup yang disepakati:** "sefleksibel mungkin" dibatasi pada menimpa nomor otomatis, menukar dua nomor, dan memakai ulang nomor pensiunan. TIDAK termasuk format penomoran yang bisa dikonfigurasi, templat label per pengguna, atau penomoran ulang massal — kalau ternyata dibutuhkan, itu permintaan baru dengan klasifikasinya sendiri.
