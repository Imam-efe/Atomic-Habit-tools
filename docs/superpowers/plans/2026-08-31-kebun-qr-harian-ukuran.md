# Kebun: QR, Ringkasan Harian, Ukuran, Terlantar, Pangkas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tujuh fitur Tier A dan B: QR di label, kebun masuk ringkasan harian, push untuk fitur yang selama ini diam, kalibrasi interval siram/pupuk, log ukuran numerik, deteksi tanaman terlantar, dan jadwal pangkas.

**Architecture:** Tiga di antaranya (QR, ringkasan harian, push) menyambungkan yang sudah ada, bukan menambah model data — QR memakai nomor pot yang sudah dibangun dan `BarcodeDetector` yang sudah dipakai modul Nutrisi. Tiga lainnya menambah penalaran di atas data yang sudah tercatat (kalibrasi dari `garden_care_log`, terlantar dari tanggal rawat terakhir, pangkas dari kolom katalog baru). Hanya satu yang butuh tabel baru: log ukuran numerik.

**Tech Stack:** Cloudflare Workers + Hono + D1, TypeScript, Vitest, React + Vite, jsPDF, `qrcode` (baru), `BarcodeDetector` (Web API).

**Spec:** Rekomendasi Tier A + B pada percakapan 2026-08-31.

## Global Constraints

- Migrasi WAJIB idempoten, tanpa `ALTER TABLE`; didaftarkan ke `db:migrate` **dan** `db:migrate:remote`; tabel baru masuk `DATA_TABLES`.
- Setiap endpoint memeriksa `user_id` sebelum baca/tulis.
- Tanggal `YYYY-MM-DD`, perhitungan memakai metode UTC saja.
- Teks pengguna Bahasa Indonesia; komentar menjelaskan **kenapa**.
- Rute baru dipasang SEBELUM `garden` di `index.ts` — `/:id` di sana menelan path apa pun sesudahnya.
- Kolom katalog baru bersifat **opsional** (`?`). Menjadikannya wajib memaksa 117 entri diisi, dan yang diisi asal-asalan lebih buruk daripada yang kosong.
- Push baru WAJIB punya toggle di `settings_schema.ts` dan lolos dedup `claimDailyAlert` seperti push kebun yang sudah ada.

## Struktur Berkas

| Berkas | Tanggung jawab |
|---|---|
| `backend/migrations/0039_kebun_ukuran.sql` | satu tabel: `garden_measurement` |
| `backend/src/lib/garden_measure.ts` | kurva pertumbuhan dari log ukuran, deteksi mandek |
| `backend/src/lib/garden_neglect.ts` | tanaman yang lama tidak disentuh |
| `backend/src/lib/garden_pruning.ts` | jadwal pangkas dari kolom katalog baru |
| `backend/src/lib/garden_calibration.ts` | **diperluas**: kalibrasi interval siram & pupuk |
| `backend/src/lib/daily.ts` | **diperluas**: `getGardenToday` |
| `backend/src/routes/garden_growth.ts` | endpoint ukuran, terlantar, pangkas |
| `backend/src/routes/daily.ts` | kebun masuk `/brief` dan `/shutdown` |
| `backend/src/data/plants.ts` | kolom opsional `pruning` |
| `backend/src/index.ts` | dua push baru + pasang rute |
| `frontend/src/lib/gardenQr.ts` | susun & baca muatan QR (murni, teruji) |
| `frontend/src/screens/Garden.tsx` | QR di label PDF, tombol pindai |
| `frontend/src/screens/GardenMeasure.tsx` | layar catat ukuran + kurva |

---

### Task 1: Migrasi 0039 + tabel ukuran

**Files:**
- Create: `backend/migrations/0039_kebun_ukuran.sql`
- Modify: `backend/package.json`, `backend/src/routes/settings.ts`

- [ ] **Step 1: Tulis migrasi**

```sql
-- Log ukuran tanaman yang diukur sendiri.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE.
--
-- Sampai sekarang satu-satunya cara menilai pertumbuhan adalah membandingkan
-- foto lewat AI (`POST /:id/growth-check`). Itu menjawab "kelihatan lebih
-- besar?", bukan "berapa". Angka memberi kurva yang bisa dibandingkan antar
-- musim, dan menangkap tanaman yang mandek jauh sebelum matanya sadar —
-- pertumbuhan yang berhenti dua pekan tidak terlihat di foto berdampingan.
--
-- unit_no boleh NULL: mengukur satu pot tertentu berguna, tapi memaksa
-- pengguna memilih pot tiap kali mengukur akan membuat fiturnya tidak dipakai.
CREATE TABLE IF NOT EXISTS garden_measurement (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  planting_id TEXT NOT NULL REFERENCES garden_plantings(id) ON DELETE CASCADE,
  unit_no INTEGER,
  measured_date TEXT NOT NULL,              -- YYYY-MM-DD
  height_cm REAL,
  leaf_count INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_measurement_planting
  ON garden_measurement(planting_id, measured_date);
CREATE INDEX IF NOT EXISTS idx_garden_measurement_user
  ON garden_measurement(user_id, measured_date DESC);
```

- [ ] **Step 2: Daftarkan migrasi dan tabel**

`backend/package.json`, akhir rantai `db:migrate` dan `db:migrate:remote` (yang remote memakai `--remote`):

```
&& wrangler d1 execute fayolla-db --file=./migrations/0039_kebun_ukuran.sql
```

`backend/src/routes/settings.ts`, sesudah baris `garden_care_log_unit`:

```ts
  { table: 'garden_measurement', label: 'Ukuran tanaman', group: 'Kebun', userScoped: true },
```

- [ ] **Step 3: Verifikasi idempoten**

```bash
cd backend
for i in 1 2 3; do npx wrangler d1 execute fayolla-db --local --file=./migrations/0039_kebun_ukuran.sql >/dev/null && echo "pass $i ok"; done
grep -nE "^\s*(ALTER|DROP)" migrations/0039_kebun_ukuran.sql   # harus kosong
```

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/0039_kebun_ukuran.sql backend/package.json backend/src/routes/settings.ts
git commit -m "feat(kebun): tabel log ukuran tanaman"
```

---

### Task 2: Pustaka murni — ukuran, terlantar, pangkas, kalibrasi interval

**Files:**
- Create: `backend/src/lib/garden_measure.ts` + test
- Create: `backend/src/lib/garden_neglect.ts` + test
- Create: `backend/src/lib/garden_pruning.ts` + test
- Modify: `backend/src/lib/garden_calibration.ts` + test
- Modify: `backend/src/data/plants.ts` (kolom `pruning` opsional)

**Interfaces:**

`garden_measure.ts`:
- `export interface Ukuran { measuredDate: string; heightCm: number | null; leafCount: number | null }`
- `export function bersihkanUkuran(v: unknown, maks: number): number | null`
- `export const MAX_HEIGHT_CM = 500`, `export const MAX_LEAF = 2000`
- `export interface LajuTumbuh { cmPerPekan: number | null; pekan: number; mandek: boolean }`
- `export function lajuTumbuh(riwayat: Ukuran[]): LajuTumbuh`

`garden_neglect.ts`:
- `export interface Sentuhan { plantingId: string; nama: string; lastCare: string | null; plantedDate: string }`
- `export const AMBANG_TERLANTAR = 21`
- `export function cariTerlantar(rows: Sentuhan[], hariIni: string, ambang?: number): Array<Sentuhan & { hariDiam: number }>`

`garden_pruning.ts`:
- `export interface AturanPangkas { mulaiHari: number; ulangHari: number; catatan: string }`
- `export function jadwalPangkas(aturan: AturanPangkas | undefined, plantedDate: string, lastPangkas: string | null, hariIni: string): { berikutnya: string; telat: number } | null`

`garden_calibration.ts` (tambahan):
- `export interface CareGap { plantId: string; action: 'siram' | 'pupuk'; gapDays: number }`
- `export function calibrateInterval(gaps: CareGap[], katalog: number): { intervalNyata: number; sampel: number; andal: boolean } | null`

`plants.ts`:
- `Plant` mendapat `pruning?: { mulaiHari: number; ulangHari: number; catatan: string }`

- [ ] **Step 1: Tulis tes yang gagal**

`garden_measure.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bersihkanUkuran, lajuTumbuh, MAX_HEIGHT_CM } from './garden_measure';

describe('bersihkanUkuran', () => {
  it('menerima angka wajar', () => {
    expect(bersihkanUkuran(35.5, MAX_HEIGHT_CM)).toBe(35.5);
    expect(bersihkanUkuran('40', MAX_HEIGHT_CM)).toBe(40);
  });

  it('menolak negatif, nol, dan di luar batas', () => {
    // Tinggi 0 bukan pengukuran, itu bidang kosong yang terkirim.
    expect(bersihkanUkuran(0, MAX_HEIGHT_CM)).toBeNull();
    expect(bersihkanUkuran(-5, MAX_HEIGHT_CM)).toBeNull();
    expect(bersihkanUkuran(MAX_HEIGHT_CM + 1, MAX_HEIGHT_CM)).toBeNull();
  });

  it('menolak yang bukan angka', () => {
    expect(bersihkanUkuran(null, MAX_HEIGHT_CM)).toBeNull();
    expect(bersihkanUkuran('tinggi', MAX_HEIGHT_CM)).toBeNull();
    expect(bersihkanUkuran(NaN, MAX_HEIGHT_CM)).toBeNull();
    expect(bersihkanUkuran(Infinity, MAX_HEIGHT_CM)).toBeNull();
  });
});

describe('lajuTumbuh', () => {
  it('menghitung cm per pekan dari dua titik', () => {
    const l = lajuTumbuh([
      { measuredDate: '2026-08-01', heightCm: 10, leafCount: null },
      { measuredDate: '2026-08-15', heightCm: 24, leafCount: null },
    ]);
    expect(l.cmPerPekan).toBe(7);   // 14 cm / 2 pekan
    expect(l.mandek).toBe(false);
  });

  it('satu titik belum menghasilkan laju', () => {
    // Satu pengukuran bukan tren; melaporkannya sebagai laju adalah mengarang.
    const l = lajuTumbuh([{ measuredDate: '2026-08-01', heightCm: 10, leafCount: null }]);
    expect(l.cmPerPekan).toBeNull();
  });

  it('kosong tidak melempar', () => {
    expect(lajuTumbuh([]).cmPerPekan).toBeNull();
  });

  it('tinggi yang tidak berubah dua pekan ditandai mandek', () => {
    const l = lajuTumbuh([
      { measuredDate: '2026-08-01', heightCm: 30, leafCount: null },
      { measuredDate: '2026-08-16', heightCm: 30, leafCount: null },
    ]);
    expect(l.mandek).toBe(true);
  });

  it('jeda kurang dari dua pekan belum disebut mandek', () => {
    // Tanaman memang tidak tumbuh terukur dalam tiga hari.
    const l = lajuTumbuh([
      { measuredDate: '2026-08-01', heightCm: 30, leafCount: null },
      { measuredDate: '2026-08-04', heightCm: 30, leafCount: null },
    ]);
    expect(l.mandek).toBe(false);
  });

  it('urutan tanggal acak tetap benar', () => {
    const l = lajuTumbuh([
      { measuredDate: '2026-08-15', heightCm: 24, leafCount: null },
      { measuredDate: '2026-08-01', heightCm: 10, leafCount: null },
    ]);
    expect(l.cmPerPekan).toBe(7);
  });

  it('pengukuran tanpa tinggi dilewati, bukan dihitung nol', () => {
    const l = lajuTumbuh([
      { measuredDate: '2026-08-01', heightCm: 10, leafCount: null },
      { measuredDate: '2026-08-08', heightCm: null, leafCount: 12 },
      { measuredDate: '2026-08-15', heightCm: 24, leafCount: null },
    ]);
    expect(l.cmPerPekan).toBe(7);
  });

  it('dua pengukuran di hari yang sama tidak membagi nol', () => {
    const l = lajuTumbuh([
      { measuredDate: '2026-08-01', heightCm: 10, leafCount: null },
      { measuredDate: '2026-08-01', heightCm: 12, leafCount: null },
    ]);
    expect(l.cmPerPekan).toBeNull();
  });
});
```

`garden_neglect.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cariTerlantar, AMBANG_TERLANTAR } from './garden_neglect';

const t = (over = {}) => ({
  plantingId: 'p1', nama: 'Cabai', lastCare: '2026-08-01', plantedDate: '2026-07-01', ...over,
});

describe('cariTerlantar', () => {
  it('menandai yang melewati ambang', () => {
    const hasil = cariTerlantar([t({ lastCare: '2026-08-01' })], '2026-08-31');
    expect(hasil).toHaveLength(1);
    expect(hasil[0].hariDiam).toBe(30);
  });

  it('yang baru dirawat tidak ditandai', () => {
    expect(cariTerlantar([t({ lastCare: '2026-08-30' })], '2026-08-31')).toEqual([]);
  });

  it('tepat di ambang belum ditandai', () => {
    const tepat = cariTerlantar([t({ lastCare: '2026-08-10' })], '2026-08-31', 21);
    expect(tepat).toEqual([]);
  });

  it('belum pernah dirawat dihitung dari tanggal tanam', () => {
    // Tanpa ini, tanaman yang tidak pernah disentuh sejak ditanam justru
    // lolos dari deteksi — padahal itu kasus yang paling parah.
    const hasil = cariTerlantar([t({ lastCare: null, plantedDate: '2026-07-01' })], '2026-08-31');
    expect(hasil).toHaveLength(1);
    expect(hasil[0].hariDiam).toBe(61);
  });

  it('yang baru ditanam dan belum dirawat tidak langsung ditandai', () => {
    const hasil = cariTerlantar([t({ lastCare: null, plantedDate: '2026-08-25' })], '2026-08-31');
    expect(hasil).toEqual([]);
  });

  it('diurutkan dari yang paling lama diam', () => {
    const hasil = cariTerlantar([
      t({ plantingId: 'a', lastCare: '2026-08-05' }),
      t({ plantingId: 'b', lastCare: '2026-07-01' }),
    ], '2026-08-31');
    expect(hasil.map((h) => h.plantingId)).toEqual(['b', 'a']);
  });

  it('ambang bawaannya 21 hari', () => {
    expect(AMBANG_TERLANTAR).toBe(21);
  });
});
```

`garden_pruning.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { jadwalPangkas } from './garden_pruning';

const aturan = { mulaiHari: 30, ulangHari: 14, catatan: 'Buang tunas air.' };

describe('jadwalPangkas', () => {
  it('null untuk tanaman tanpa aturan pangkas', () => {
    // Kebanyakan sayuran daun memang tidak dipangkas.
    expect(jadwalPangkas(undefined, '2026-07-01', null, '2026-08-31')).toBeNull();
  });

  it('pangkas pertama dihitung dari tanggal tanam', () => {
    const j = jadwalPangkas(aturan, '2026-08-01', null, '2026-08-15');
    expect(j!.berikutnya).toBe('2026-08-31');
    expect(j!.telat).toBe(0);
  });

  it('sesudah dipangkas, berikutnya dihitung dari pangkas terakhir', () => {
    const j = jadwalPangkas(aturan, '2026-07-01', '2026-08-20', '2026-08-25');
    expect(j!.berikutnya).toBe('2026-09-03');
  });

  it('yang lewat tenggat melaporkan berapa hari telat', () => {
    const j = jadwalPangkas(aturan, '2026-07-01', '2026-08-01', '2026-08-31');
    expect(j!.telat).toBe(16);   // jatuh tempo 2026-08-15
  });

  it('tanaman yang terlalu muda belum dijadwalkan telat', () => {
    const j = jadwalPangkas(aturan, '2026-08-25', null, '2026-08-31');
    expect(j!.telat).toBe(0);
  });

  it('tanggalnya tidak bergeser oleh zona waktu', () => {
    const j = jadwalPangkas(aturan, '2026-03-01', null, '2026-03-15');
    expect(j!.berikutnya).toBe('2026-03-31');
  });
});
```

`garden_calibration.test.ts` (tambahan):

```ts
import { calibrateInterval } from './garden_calibration';

describe('calibrateInterval', () => {
  const g = (n: number) => ({ plantId: 'cabai-rawit', action: 'siram' as const, gapDays: n });

  it('null kalau sampelnya terlalu sedikit', () => {
    // Dua kali siram bukan kebiasaan.
    expect(calibrateInterval([g(3), g(3)], 2)).toBeNull();
  });

  it('menghitung interval nyata dari jarak antar-siram', () => {
    const c = calibrateInterval([g(3), g(3), g(4), g(3), g(3)], 2);
    expect(c!.intervalNyata).toBe(3);
    expect(c!.sampel).toBe(5);
    expect(c!.andal).toBe(true);
  });

  it('jarak yang mustahil dibuang, bukan ikut merata-rata', () => {
    // Jeda 60 hari berarti pengguna berlibur, bukan interval siramnya 60 hari.
    const c = calibrateInterval([g(3), g(3), g(3), g(3), g(60)], 2);
    expect(c!.intervalNyata).toBe(3);
  });

  it('jarak nol dibuang — dua catatan di hari sama bukan interval', () => {
    const c = calibrateInterval([g(0), g(3), g(3), g(3), g(3)], 2);
    expect(c!.intervalNyata).toBe(3);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/lib/garden_measure.test.ts src/lib/garden_neglect.test.ts src/lib/garden_pruning.test.ts src/lib/garden_calibration.test.ts`
Expected: FAIL — modul dan fungsi belum ada.

- [ ] **Step 3: Tulis implementasinya**

Semua perhitungan tanggal memakai pola yang sudah dipakai `garden_seedling_schedule.ts`:

```ts
function selisihHari(dari: string, ke: string): number {
  const a = Date.parse(`${dari}T00:00:00Z`);
  const b = Date.parse(`${ke}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
function geser(tanggal: string, hari: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}
```

Aturan yang tidak boleh dilanggar:
- `lajuTumbuh` mengurutkan sendiri menurut tanggal, melewati entri tanpa `heightCm`, dan mengembalikan `null` bila titik terpakai kurang dari dua atau rentang harinya nol.
- `mandek` hanya boleh benar bila rentang antara dua pengukuran **≥ 14 hari** DAN pertambahan tingginya nol atau negatif.
- `cariTerlantar` memakai `plantedDate` sebagai pengganti saat `lastCare` null — tanaman yang tidak pernah disentuh sejak ditanam adalah kasus terparah, bukan kasus yang dilewati.
- `calibrateInterval` membuang gap `<= 0` dan gap di atas `katalog * 5` sebelum merata-rata, lalu butuh minimal 4 sampel tersisa untuk `andal`.

- [ ] **Step 4: Tambah kolom `pruning` ke katalog**

Pada `Plant` di `backend/src/data/plants.ts`:

```ts
  /**
   * Aturan pangkas — hanya untuk tanaman yang pangkasnya benar-benar
   * menentukan hasil. Opsional dengan sengaja: kebanyakan sayuran daun tidak
   * dipangkas, dan mengisi kolom ini asal-asalan untuk seluruh katalog lebih
   * buruk daripada membiarkannya kosong.
   */
  pruning?: {
    /** Hari sejak tanam sebelum pangkas pertama masuk akal. */
    mulaiHari: number;
    /** Jarak antar pangkas sesudahnya, hari. */
    ulangHari: number;
    catatan: string;
  };
```

Isi HANYA untuk tanaman yang aturannya jelas dan disepakati luas: tomat (tunas air), cabai (tunas bawah cabang Y), tin, anggur, jambu, mangga, jeruk. Jangan menebak untuk yang lain.

- [ ] **Step 5: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/lib src/data`
Expected: PASS, termasuk seluruh tes katalog yang sudah ada.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib backend/src/data/plants.ts
git commit -m "feat(kebun): ukuran, terlantar, pangkas, kalibrasi interval"
```

---

### Task 3: `getGardenToday` + kebun masuk Pagi Ini dan Tutup Hari

**Files:**
- Modify: `backend/src/lib/daily.ts`
- Modify: `backend/src/routes/daily.ts` (`/brief` dan `/shutdown`)
- Test: `backend/src/lib/daily.test.ts`

**Interfaces:**
- `export interface GardenToday { perluSiram: number; perluPupuk: number; siapPanen: number; terlantar: number; contoh: string[] }`
- `export async function getGardenToday(db: D1Database, userId: string, today: string): Promise<GardenToday>`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
describe('getGardenToday', () => {
  it('menghitung tugas kebun hari ini', async () => { /* isi dengan seed nyata */ });
  it('kebun kosong menghasilkan nol, bukan melempar', async () => { /* ... */ });
  it('tanaman selesai dan gagal tidak ikut dihitung', async () => { /* ... */ });
  it('contoh dibatasi tiga nama supaya notifikasi tidak kepanjangan', async () => { /* ... */ });
});
```

Setiap `/* ... */` diisi badan tes nyata memakai `createTestDb` seperti berkas tes lain.

- [ ] **Step 2: Implementasi + pasang ke dua endpoint**

`getGardenToday` memakai satu kueri gabungan — `garden_plantings` join `garden_care_log` terakhir per aksi — lalu `computeCareState` untuk menghitung jatuh tempo. Jangan satu kueri per tanaman.

Di `routes/daily.ts`, tambahkan ke `Promise.all` pada `/brief` dan kembalikan sebagai kunci `kebun`. Tambahkan hal yang sama ke `/shutdown` supaya ritual malam ikut menyebut kebun.

- [ ] **Step 3: Verifikasi + commit**

Run: `cd backend && npx vitest run && npm run typecheck`

```bash
git add backend/src/lib/daily.ts backend/src/lib/daily.test.ts backend/src/routes/daily.ts
git commit -m "feat(kebun): kebun masuk Pagi Ini dan Tutup Hari"
```

---

### Task 4: Rute `garden_growth.ts` + dua push baru

**Files:**
- Create: `backend/src/routes/garden_growth.ts` + test
- Modify: `backend/src/index.ts` (pasang rute + dua cron push)
- Modify: `backend/src/lib/settings_schema.ts` (dua toggle + jam)

**Endpoint** (prefiks `/api/garden`):

| Method | Path | Isi |
|---|---|---|
| GET | `/measurements/:plantingId` | riwayat ukuran + laju tumbuh |
| POST | `/measurements/:plantingId` | catat satu pengukuran |
| DELETE | `/measurements/:id` | hapus satu pengukuran |
| GET | `/neglected` | tanaman yang lama tidak disentuh |
| GET | `/pruning` | jadwal pangkas yang jatuh tempo |
| GET | `/calibration/interval` | interval siram/pupuk nyata vs katalog |

**Push baru:**

| Tipe | Kapan | Setting |
|---|---|---|
| `garden_solution` | larutan hidroponik lewat `HARI_GANTI_LARUTAN` | `notify.garden_solution` + `.hour` |
| `garden_mangsa` | hari pertama mangsa baru | `notify.garden_mangsa` + `.hour` |

Keduanya memakai `claimDailyAlert` untuk dedup, persis seperti `garden_care`.

- [ ] **Step 1: Tulis tes rute yang gagal**

Pakai harness `garden_unit.test.ts`. Kasus wajib: simpan & baca pengukuran; tolak tinggi 0/negatif/di luar batas (400); tolak `plantingId` pengguna lain (404); `DELETE` milik orang lain 404; `/neglected` menandai yang lewat 21 hari; `/pruning` hanya memuat tanaman yang punya aturan; `/calibration/interval` diam saat sampel kurang.

- [ ] **Step 2: Implementasi, pasang rute SEBELUM `garden`, tambah cron + setting**

- [ ] **Step 3: Verifikasi + commit**

Run: `cd backend && npx vitest run && npm run typecheck`

```bash
git commit -m "feat(kebun): endpoint ukuran, terlantar, pangkas, dan dua push baru"
```

---

### Task 5: QR di label + pemindai

**Files:**
- Create: `frontend/src/lib/gardenQr.ts` + test
- Modify: `frontend/src/screens/Garden.tsx` (QR di PDF, tombol pindai)
- Modify: `frontend/package.json` (dependensi `qrcode`)

**Interfaces:**
- `export const QR_PREFIX = 'kebun'`
- `export function susunQr(plantingId: string, unitNo: number | null): string`
- `export function bacaQr(raw: string): { plantingId: string; unitNo: number | null } | null`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
import { describe, it, expect } from 'vitest';
import { susunQr, bacaQr } from '../gardenQr';

describe('muatan QR', () => {
  it('bolak-balik utuh', () => {
    expect(bacaQr(susunQr('abc123', 2))).toEqual({ plantingId: 'abc123', unitNo: 2 });
  });

  it('tanpa nomor pot tetap sah', () => {
    expect(bacaQr(susunQr('abc123', null))).toEqual({ plantingId: 'abc123', unitNo: null });
  });

  it('menolak muatan asing', () => {
    // Kamera akan memindai QR apa pun yang kebetulan ada di kebun — kemasan
    // pupuk, stiker toko. Muatan yang bukan milik aplikasi ini harus ditolak,
    // bukan dipaksa jadi id tanaman.
    expect(bacaQr('https://contoh.com')).toBeNull();
    expect(bacaQr('')).toBeNull();
    expect(bacaQr('kebun:')).toBeNull();
    expect(bacaQr('lain:abc:1')).toBeNull();
  });

  it('nomor pot yang bukan angka ditolak', () => {
    expect(bacaQr('kebun:abc123:dua')).toBeNull();
  });

  it('id yang mengandung pemisah tidak merusak pembacaan', () => {
    expect(bacaQr('kebun:a:b:c')).toBeNull();
  });
});
```

- [ ] **Step 2: Implementasi muatan**

Bentuknya `kebun:<plantingId>:<unitNo|-`>. Ringkas — QR yang muatannya pendek menghasilkan modul lebih besar, dan modul besar jauh lebih mudah dipindai dari label 2 cm yang basah kena embun.

- [ ] **Step 3: Tempel QR di label PDF**

Di `buildLabelsPdf`, untuk tiap label buat data URL lewat `QRCode.toDataURL(susunQr(...), { errorCorrectionLevel: 'M', margin: 0, width: 256 })` lalu `doc.addImage(url, 'PNG', x, y, sisi, sisi)`. Taruh di kanan **bawah** — kanan atas sudah dipakai lencana kode.

Ukuran sisi QR: `kecil` 9 mm, `sedang` 12 mm, `besar` 16 mm. Di bawah 9 mm, QR tidak terbaca andal oleh kamera ponsel pada label cetak rumahan.

Lebar baris isi dikurangi selebar QR **hanya untuk baris yang sejajar dengannya** — jangan mengulang kesalahan lencana kode yang sempat mempersempit semua baris.

- [ ] **Step 4: Tombol pindai di layar Kebun**

Salin pola `handleBarcodeFile` dari `Nutrition.tsx:209` — termasuk penjagaan `typeof BarcodeDetector === 'undefined'` dan pesan galatnya. Format: `['qr_code']`. Hasil pindai yang sah membuka sheet aksi cepat untuk pot itu; hasil yang tidak dikenal memberi pesan, **bukan diam**.

- [ ] **Step 5: Verifikasi PDF berisi QR yang benar-benar terbaca**

Render PDF contoh, lalu decode balik QR-nya dari gambar dan pastikan muatannya sama dengan yang disusun. Ini satu-satunya bukti bahwa yang tercetak bisa dipindai; ukuran dan posisi saja tidak membuktikan apa-apa.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(kebun): QR di label dan pemindai pot"
```

---

### Task 6: Layar ukuran + tampilan terlantar/pangkas

**Files:**
- Create: `frontend/src/screens/GardenMeasure.tsx`
- Modify: `frontend/src/screens/GardenExtras.tsx` (pasang ke tab Catatan)
- Modify: `frontend/src/screens/Garden.tsx` (peringatan terlantar & pangkas di daftar)

Ikuti bentuk `GardenGrow4.tsx`. Wajib ada: formulir catat tinggi/jumlah daun, kurva sederhana, label "mandek" bila `lajuTumbuh().mandek`, dan daftar tanaman terlantar dengan hari diamnya.

- [ ] Verifikasi: `cd frontend && npx tsc --noEmit && npx vitest run && npm run build`
- [ ] Commit.

---

### Task 7: Verifikasi menyeluruh, merge, deploy

- [ ] `cd backend && npx vitest run && npm run typecheck`
- [ ] `cd frontend && npx tsc --noEmit && npx vitest run && npm run build`
- [ ] Migrasi idempoten 3×
- [ ] Cek integrasi: rute baru sebelum `garden`; tabel di `DATA_TABLES`; migrasi di kedua skrip; tidak ada `ALTER`/`DROP`; `/measurements`, `/neglected`, `/pruning` tidak bentrok dengan router kebun mana pun
- [ ] Push, PR draft, tandai siap, merge; pantau deploy sampai `success`

---

## Self-Review

| Fitur yang disetujui | Task |
|---|---|
| 1 QR di label | 5 |
| 2 Kebun di Pagi Ini / Tutup Hari | 3 |
| 3 Push yang diam | 4 |
| 4 Kalibrasi interval siram/pupuk | 2, 4 |
| 5 Log ukuran numerik | 1, 2, 4, 6 |
| 6 Deteksi terlantar | 2, 4, 6 |
| 7 Jadwal pangkas | 2, 4, 6 |

**Konsistensi tipe:** `lajuTumbuh`, `cariTerlantar`, `jadwalPangkas`, `calibrateInterval` didefinisikan Task 2 dan dipakai Task 4. `getGardenToday` didefinisikan Task 3 dan dipakai `routes/daily.ts` di task yang sama. `susunQr`/`bacaQr` didefinisikan Task 5 dan hanya dipakai di sana. Nama tabel Task 1 sama dengan yang dikueri Task 4.

**Risiko yang sudah disebut ke pengguna:** data `pruning` tidak bisa dibuktikan benar lewat tes — sama seperti `daysToHarvest`. Karena itu kolomnya opsional dan hanya diisi untuk tanaman yang aturannya disepakati luas.
