# Nutrisi Cerdas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver gizi 4-tingkat (kurasi lokal → cache bersama → Open Food Facts → AI), scan barcode/label kemasan, dan insight %AKG BPOM untuk modul Nutrition.

**Architecture:** Satu route baru `backend/src/routes/food_search.ts` (resolver + 3 endpoint), satu data module `backend/src/data/foods_id.ts` (~36 makanan kurasi, pola sama dengan `data/plants.ts`), satu lib murni `backend/src/lib/nutrition_insight.ts` (matematika %AKG, tanpa dependency D1/AI supaya bisa diuji langsung). `nutrition.ts` yang sudah ada dapat dua kolom opsional. Frontend: `Nutrition.tsx` dapat kotak cari + dua tombol scan, mengisi form yang sudah ada.

**Tech Stack:** Hono (backend, Cloudflare Workers), D1, Workers AI (`@cf/meta/llama-4-scout-17b-16e-instruct` untuk vision/JSON terstruktur), React + Vite (frontend), `BarcodeDetector` Web API bawaan browser.

**Spec:** `docs/superpowers/specs/2026-08-23-nutrisi-cerdas-design.md`

## Global Constraints

- Cache `food_facts_cache` **lintas-user** (fakta produk publik) — beda dari `food_logs` yang tetap `user_id`-scoped ketat.
- Barcode tidak pernah jatuh ke tier AI. Kalau OFF tidak punya datanya, respons minta user scan label — bukan AI menebak dari nomor barcode.
- TTL cache 90 hari, dicek at-read (`fetched_at < now - 90*86400` → treat sebagai miss). Tidak ada cron pembersih baru.
- Angka ALG dari `Peraturan BPOM No. 26/2021`: **energi (2150 kkal), protein (60g), lemak total (67g), karbohidrat (325g) sudah diverifikasi** lewat pencarian web sesi brainstorming. **Lemak jenuh (20g), gula (50g), natrium (1500mg) BELUM diverifikasi dari teks regulasi asli** (jaringan sesi ini memblokir situs BPOM) — nilai dari ingatan model, konservatif, ditandai jelas di kode. Jangan hapus tanda ini saat implementasi kecuali sudah benar-benar dicocokkan ke dokumen primer.
- Angka gizi di `foods_id.ts` adalah estimasi praktis per porsi rumah tangga lazim, bukan hasil pengambilan langsung dari database TKPI Kemenkes sesi ini (jaringan diblokir juga untuk situs itu) — tandai hal ini di header file, sama seperti catatan `plants.ts` soal angka pertanian.
- Tidak ada test framework di repo ini (`backend/package.json` dan `frontend/package.json` tidak punya vitest/jest, CI tidak menjalankan test apapun). Untuk logic murni (matematika %AKG, pencarian kurasi) tulis test nyata dan jalankan langsung dengan `node --experimental-strip-types` (Node 22, tanpa dependency baru) — ini genuinely dijalankan, bukan ditulis lalu dibuang. Untuk route Hono yang butuh D1/AI binding sungguhan, verifikasi ikuti konvensi repo yang sudah ada: `tsc --noEmit` bersih + review manual + `sweep.js`; panggilan live ke Open Food Facts baru bisa diverifikasi setelah deploy produksi (dicatat eksplisit, tidak diklaim beres sebelumnya).
- Semua teks user-facing dalam Bahasa Indonesia, mengikuti konvensi repo.

---

### Task 1: Ekstrak `compressImage` jadi helper bersama

`Garden.tsx` sudah punya fungsi kompresi foto (`compressImage`, baris 161-184) yang persis dibutuhkan Nutrition untuk scan label. Duplikasi 20 baris logic canvas itu ke file kedua melanggar DRY yang diminta — pindahkan ke satu lib bersama dulu sebelum dipakai dua tempat.

**Files:**
- Create: `frontend/src/lib/image.ts`
- Modify: `frontend/src/screens/Garden.tsx:161-184` (hapus definisi lokal, pakai import)

**Interfaces:**
- Produces: `compressImage(file: File): Promise<string>` — dipakai Task 8 di `Nutrition.tsx`.

- [ ] **Step 1: Buat `frontend/src/lib/image.ts`**

```typescript
/** Kecilkan foto sebelum dikirim ke model vision — resolusi penuh tidak perlu. */
export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('gagal membaca file'));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error('gagal memuat gambar'));
      img.onload = () => {
        const max = 1200;
        let { width, height } = img;
        if (width > height && width > max) { height *= max / width; width = max; }
        else if (height >= width && height > max) { width *= max / height; height = max; }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
```

- [ ] **Step 2: Update `Garden.tsx` untuk pakai import**

Hapus baris 160-184 (komentar + fungsi `compressImage` lokal) dari `frontend/src/screens/Garden.tsx`, lalu tambahkan import di bagian atas file (dekat import lain seperti `apiFetch`):

```typescript
import { compressImage } from '@/lib/image';
```

- [ ] **Step 3: Verifikasi tidak ada pemakaian yang rusak**

Run: `grep -n "compressImage" frontend/src/screens/Garden.tsx`
Expected: hanya muncul di baris import dan di titik pemanggilan (`handlePhoto`), tidak ada lagi definisi fungsi.

- [ ] **Step 4: Type-check**

Run (dari `frontend/`): `npx tsc -b`
Expected: bersih, tanpa error.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/image.ts frontend/src/screens/Garden.tsx
git commit -m "refactor: extract compressImage into shared lib for reuse by Nutrition scan"
```

---

### Task 2: Migration `food_facts_cache` + kolom baru `food_logs`

**Files:**
- Create: `backend/migrations/0026_food_cache.sql`
- Modify: `backend/package.json` (tambah ke `db:migrate` dan `db:migrate:remote`)

**Interfaces:**
- Produces: tabel `food_facts_cache(id, source, lookup_key, name, brand, serving_size, calories, protein, carbs, fat, fiber, sodium, sugar, fetched_at)`, unique `(source, lookup_key)`. Kolom baru `food_logs.source`, `food_logs.barcode`.

- [ ] **Step 1: Tulis migration**

Create `backend/migrations/0026_food_cache.sql`:

```sql
-- Cache lintas-user untuk hasil resolusi gizi (Open Food Facts + AI).
--
-- Lintas-user dengan sengaja: isinya fakta produk publik ("Indomie goreng
-- punya X kalori per sajian"), bukan data pribadi — satu pengguna men-scan
-- sebuah produk, semua pengguna lain yang mengetik nama sama diuntungkan.
-- Ini beda dari food_logs yang tetap ketat per user_id.
--
-- TTL 90 hari dicek at-read di kode (fetched_at < now - 90*86400 => treat
-- sebagai miss), bukan job pembersih terpisah — konsisten dengan cara
-- garden_ai_plants sudah ditangani, tidak perlu infrastruktur cron baru.
CREATE TABLE IF NOT EXISTS food_facts_cache (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,          -- 'off' | 'ai'
  lookup_key TEXT NOT NULL,      -- barcode untuk 'off', nama ternormalisasi untuk 'ai'
  name TEXT NOT NULL,
  brand TEXT,
  serving_size TEXT,
  calories REAL NOT NULL,
  protein REAL NOT NULL,
  carbs REAL NOT NULL,
  fat REAL NOT NULL,
  fiber REAL NOT NULL,
  sodium REAL NOT NULL,
  sugar REAL NOT NULL,
  fetched_at INTEGER NOT NULL,
  UNIQUE(source, lookup_key)
);

CREATE INDEX IF NOT EXISTS idx_food_cache_lookup ON food_facts_cache(source, lookup_key);

-- 'curated' | 'cache-off' | 'cache-ai' | 'off' | 'ai' | 'label-scan' | NULL (manual, entri lama)
ALTER TABLE food_logs ADD COLUMN source TEXT;
ALTER TABLE food_logs ADD COLUMN barcode TEXT;
```

- [ ] **Step 2: Daftarkan di kedua script migrate**

Modify `backend/package.json` — di akhir string `db:migrate`, tambahkan sebelum tanda kutip penutup:

```
 && wrangler d1 execute fayolla-db --file=./migrations/0026_food_cache.sql
```

Dan di akhir string `db:migrate:remote`:

```
 && wrangler d1 execute fayolla-db --remote --file=./migrations/0026_food_cache.sql
```

- [ ] **Step 3: Verifikasi SQL valid secara sintaks**

Run: `npx wrangler d1 execute fayolla-db --local --file=./migrations/0026_food_cache.sql` (dari `backend/`, pakai DB lokal Miniflare — tidak menyentuh produksi)
Expected: sukses tanpa error SQL. Kalau `fayolla-db` lokal belum pernah di-init, jalankan dulu `0001_initial.sql` secara lokal (`--local`) sebelum ini, supaya `food_logs` sudah ada untuk di-`ALTER`.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/0026_food_cache.sql backend/package.json
git commit -m "feat: add food_facts_cache table and food_logs source/barcode columns"
```

---

### Task 3: Data kurasi — `backend/src/data/foods_id.ts`

**Files:**
- Create: `backend/src/data/foods_id.ts`
- Test: `backend/src/data/foods_id.test.ts`

**Interfaces:**
- Produces: `export interface CuratedFood { id, name, aliases, servingLabel, calories, protein, carbs, fat, fiber, sodium, sugar }`, `export const CURATED_FOODS: CuratedFood[]`, `export function searchCuratedFoods(query: string, foods?: CuratedFood[]): CuratedFood[]`.

- [ ] **Step 1: Tulis test dulu**

Create `backend/src/data/foods_id.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { searchCuratedFoods, CURATED_FOODS } from './foods_id.ts';

// Nama penuh cocok.
assert.equal(searchCuratedFoods('nasi goreng').some(f => f.id === 'nasi-goreng'), true);
// Alias cocok (nama dagang umum).
assert.equal(searchCuratedFoods('indomie').some(f => f.id === 'mie-goreng-instan'), true);
// Query kosong -> array kosong, bukan seluruh katalog.
assert.deepEqual(searchCuratedFoods(''), []);
// Query tidak cocok apa pun -> array kosong.
assert.deepEqual(searchCuratedFoods('xyz-tidak-ada-di-katalog'), []);
// Tidak ada id duplikat di katalog.
const ids = CURATED_FOODS.map(f => f.id);
assert.equal(new Set(ids).size, ids.length);
// Setiap entri punya angka gizi non-negatif.
for (const f of CURATED_FOODS) {
  assert.ok(f.calories >= 0 && f.protein >= 0 && f.carbs >= 0 && f.fat >= 0 && f.fiber >= 0 && f.sodium >= 0 && f.sugar >= 0, `angka negatif di ${f.id}`);
}

console.log(`foods_id.test.ts OK — ${CURATED_FOODS.length} entri`);
```

- [ ] **Step 2: Jalankan test, pastikan gagal (file belum ada)**

Run (dari `backend/`): `node --experimental-strip-types src/data/foods_id.test.ts`
Expected: FAIL — `Cannot find module './foods_id.ts'`.

- [ ] **Step 3: Tulis `foods_id.ts`**

Create `backend/src/data/foods_id.ts`:

```typescript
/**
 * foods_id.ts — katalog makanan Indonesia yang paling sering dicatat.
 *
 * Bundled, sama seperti data/plants.ts: data referensi yang ditinjau seperti
 * kode, tidak perlu di-seed ulang tiap deploy. Ini tier pertama resolver gizi
 * (lihat food_search.ts) — dicoba sebelum cache, Open Food Facts, dan AI.
 *
 * Angka adalah estimasi praktis per porsi rumah tangga lazim (bukan porsi
 * laboratorium), disusun dari pengetahuan gizi umum saat penulisan file ini.
 * BUKAN hasil pengambilan langsung dari basis data TKPI Kemenkes — jaringan
 * sesi penulisan memblokir situs tersebut. Cross-check terhadap TKPI kalau
 * dipakai untuk keputusan kesehatan presisi tinggi; untuk pelacakan kasar
 * harian, akurasinya cukup.
 */

export interface CuratedFood {
  /** Slug stabil — dipakai sebagai lookup_key di food_facts_cache kalau perlu. */
  id: string;
  name: string;
  /** Nama dagang/sebutan lain yang dicocokkan pencarian. */
  aliases: string[];
  servingLabel: string;
  calories: number;
  protein: number;   // gram
  carbs: number;      // gram
  fat: number;         // gram
  fiber: number;       // gram
  sodium: number;      // mg
  sugar: number;       // gram
}

export const CURATED_FOODS: CuratedFood[] = [
  // ────────────────────────────── POKOK ──────────────────────────────
  { id: 'nasi-putih', name: 'Nasi Putih', aliases: ['nasi', 'sebakul nasi'], servingLabel: '1 centong (100 g)', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sodium: 1, sugar: 0.1 },
  { id: 'nasi-goreng', name: 'Nasi Goreng', aliases: ['nasgor'], servingLabel: '1 piring (250 g)', calories: 350, protein: 8, carbs: 45, fat: 14, fiber: 2, sodium: 600, sugar: 3 },
  { id: 'lontong', name: 'Lontong', aliases: [], servingLabel: '1 potong (100 g)', calories: 130, protein: 2.5, carbs: 28, fat: 0.2, fiber: 0.5, sodium: 2, sugar: 0 },
  { id: 'ketupat', name: 'Ketupat', aliases: [], servingLabel: '1 buah (100 g)', calories: 130, protein: 2.5, carbs: 28, fat: 0.2, fiber: 0.5, sodium: 2, sugar: 0 },
  { id: 'bubur-ayam', name: 'Bubur Ayam', aliases: [], servingLabel: '1 mangkuk (300 g)', calories: 250, protein: 12, carbs: 35, fat: 6, fiber: 1, sodium: 700, sugar: 1 },
  { id: 'mie-goreng-instan', name: 'Mie Goreng Instan', aliases: ['indomie', 'indomie goreng', 'mie instan goreng'], servingLabel: '1 bungkus (85 g)', calories: 380, protein: 8, carbs: 52, fat: 15, fiber: 2, sodium: 900, sugar: 5 },
  { id: 'mie-kuah-instan', name: 'Mie Kuah Instan', aliases: ['indomie kuah', 'mie rebus instan'], servingLabel: '1 bungkus (75 g)', calories: 320, protein: 7, carbs: 45, fat: 12, fiber: 2, sodium: 1200, sugar: 3 },
  { id: 'roti-tawar', name: 'Roti Tawar', aliases: ['roti'], servingLabel: '2 lembar (60 g)', calories: 160, protein: 5, carbs: 30, fat: 2, fiber: 1.5, sodium: 250, sugar: 3 },

  // ────────────────────────────── LAUK ──────────────────────────────
  { id: 'telur-rebus', name: 'Telur Rebus', aliases: [], servingLabel: '1 butir (55 g)', calories: 78, protein: 6.3, carbs: 0.6, fat: 5.3, fiber: 0, sodium: 62, sugar: 0.6 },
  { id: 'telur-goreng', name: 'Telur Ceplok', aliases: ['telur goreng', 'telur mata sapi'], servingLabel: '1 butir (60 g)', calories: 120, protein: 6.5, carbs: 0.5, fat: 10, fiber: 0, sodium: 95, sugar: 0.4 },
  { id: 'telur-dadar', name: 'Telur Dadar', aliases: [], servingLabel: '1 butir (65 g)', calories: 130, protein: 7, carbs: 1, fat: 11, fiber: 0, sodium: 120, sugar: 0.5 },
  { id: 'ayam-goreng', name: 'Ayam Goreng', aliases: ['ayam goreng paha', 'fried chicken'], servingLabel: '1 potong paha (100 g)', calories: 260, protein: 22, carbs: 6, fat: 16, fiber: 0.3, sodium: 380, sugar: 0.5 },
  { id: 'ayam-bakar', name: 'Ayam Bakar', aliases: [], servingLabel: '1 potong (100 g)', calories: 200, protein: 24, carbs: 4, fat: 9, fiber: 0.2, sodium: 420, sugar: 3 },
  { id: 'rendang', name: 'Rendang Daging', aliases: ['rendang sapi'], servingLabel: '1 porsi (100 g)', calories: 280, protein: 18, carbs: 6, fat: 21, fiber: 1, sodium: 450, sugar: 2 },
  { id: 'sate-ayam', name: 'Sate Ayam', aliases: ['sate'], servingLabel: '10 tusuk + bumbu kacang (200 g)', calories: 380, protein: 28, carbs: 15, fat: 24, fiber: 2, sodium: 650, sugar: 8 },
  { id: 'tempe-goreng', name: 'Tempe Goreng', aliases: ['tempe'], servingLabel: '2 potong (50 g)', calories: 130, protein: 9, carbs: 8, fat: 8, fiber: 3, sodium: 5, sugar: 0.5 },
  { id: 'tahu-goreng', name: 'Tahu Goreng', aliases: ['tahu'], servingLabel: '2 potong (60 g)', calories: 110, protein: 8, carbs: 4, fat: 7, fiber: 1, sodium: 8, sugar: 0.5 },
  { id: 'ikan-goreng', name: 'Ikan Goreng', aliases: [], servingLabel: '1 ekor sedang (100 g)', calories: 190, protein: 22, carbs: 2, fat: 10, fiber: 0, sodium: 200, sugar: 0 },
  { id: 'bakso', name: 'Bakso', aliases: ['bakso sapi'], servingLabel: '1 mangkuk, 5 butir + kuah (300 g)', calories: 260, protein: 16, carbs: 25, fat: 10, fiber: 2, sodium: 900, sugar: 3 },
  { id: 'soto-ayam', name: 'Soto Ayam', aliases: ['soto'], servingLabel: '1 mangkuk (350 g)', calories: 220, protein: 18, carbs: 14, fat: 10, fiber: 2, sodium: 850, sugar: 2 },

  // ────────────────────────────── SAYUR & PELENGKAP ──────────────────────────────
  { id: 'gado-gado', name: 'Gado-Gado', aliases: [], servingLabel: '1 piring (300 g)', calories: 300, protein: 12, carbs: 28, fat: 16, fiber: 6, sodium: 550, sugar: 8 },
  { id: 'capcay', name: 'Cap Cay', aliases: ['capcai'], servingLabel: '1 piring (200 g)', calories: 130, protein: 6, carbs: 12, fat: 6, fiber: 4, sodium: 400, sugar: 3 },
  { id: 'sayur-asem', name: 'Sayur Asem', aliases: [], servingLabel: '1 mangkuk (250 g)', calories: 90, protein: 3, carbs: 15, fat: 2, fiber: 4, sodium: 300, sugar: 4 },
  { id: 'tumis-kangkung', name: 'Tumis Kangkung', aliases: [], servingLabel: '1 porsi (150 g)', calories: 90, protein: 3, carbs: 8, fat: 5, fiber: 3, sodium: 250, sugar: 1 },
  { id: 'sambal', name: 'Sambal', aliases: [], servingLabel: '2 sdm (30 g)', calories: 25, protein: 0.5, carbs: 4, fat: 1, fiber: 1, sodium: 200, sugar: 2 },
  { id: 'kerupuk', name: 'Kerupuk', aliases: [], servingLabel: '3 keping (15 g)', calories: 75, protein: 0.5, carbs: 9, fat: 4, fiber: 0.2, sodium: 150, sugar: 0.5 },

  // ────────────────────────────── BUAH & CAMILAN ──────────────────────────────
  { id: 'pisang', name: 'Pisang', aliases: [], servingLabel: '1 buah sedang (100 g)', calories: 90, protein: 1.1, carbs: 23, fat: 0.3, fiber: 2.6, sodium: 1, sugar: 12 },
  { id: 'pepaya', name: 'Pepaya', aliases: [], servingLabel: '1 potong (150 g)', calories: 65, protein: 1, carbs: 17, fat: 0.2, fiber: 3, sodium: 5, sugar: 12 },
  { id: 'semangka', name: 'Semangka', aliases: [], servingLabel: '1 potong (150 g)', calories: 45, protein: 0.9, carbs: 11, fat: 0.2, fiber: 0.6, sodium: 1, sugar: 9 },
  { id: 'gorengan', name: 'Gorengan', aliases: ['bakwan', 'tahu isi'], servingLabel: '1 buah (40 g)', calories: 110, protein: 2, carbs: 12, fat: 6, fiber: 1, sodium: 150, sugar: 1 },
  { id: 'keripik-singkong', name: 'Keripik Singkong', aliases: ['keripik'], servingLabel: '1 genggam (30 g)', calories: 150, protein: 1, carbs: 18, fat: 8, fiber: 1, sodium: 120, sugar: 1 },

  // ────────────────────────────── MINUMAN ──────────────────────────────
  { id: 'teh-manis', name: 'Teh Manis', aliases: [], servingLabel: '1 gelas (250 ml)', calories: 90, protein: 0, carbs: 22, fat: 0, fiber: 0, sodium: 5, sugar: 20 },
  { id: 'kopi-hitam', name: 'Kopi Hitam', aliases: ['kopi tanpa gula'], servingLabel: '1 cangkir (200 ml)', calories: 5, protein: 0.3, carbs: 0, fat: 0, fiber: 0, sodium: 5, sugar: 0 },
  { id: 'es-teh', name: 'Es Teh Manis', aliases: [], servingLabel: '1 gelas (350 ml)', calories: 120, protein: 0, carbs: 30, fat: 0, fiber: 0, sodium: 5, sugar: 28 },
  { id: 'jus-alpukat', name: 'Jus Alpukat', aliases: [], servingLabel: '1 gelas + susu kental manis (300 ml)', calories: 320, protein: 5, carbs: 35, fat: 18, fiber: 5, sodium: 40, sugar: 28 },
  { id: 'air-putih', name: 'Air Putih', aliases: [], servingLabel: '1 gelas (250 ml)', calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0, sugar: 0 },
];

/** Cocokkan nama/alias, case-insensitive, includes() — cukup untuk ~36 entri, fuzzy matching berlebihan (YAGNI). */
export function searchCuratedFoods(query: string, foods: CuratedFood[] = CURATED_FOODS): CuratedFood[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return foods.filter(f =>
    f.name.toLowerCase().includes(q) || f.aliases.some(a => a.toLowerCase().includes(q))
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `node --experimental-strip-types src/data/foods_id.test.ts`
Expected: PASS, cetak `foods_id.test.ts OK — 36 entri`.

- [ ] **Step 5: Type-check**

Run (dari `backend/`): `npx tsc --noEmit`
Expected: bersih.

- [ ] **Step 6: Commit**

```bash
git add backend/src/data/foods_id.ts backend/src/data/foods_id.test.ts
git commit -m "feat: add curated Indonesian food catalog for nutrition resolver tier 1"
```

---

### Task 4: Lib insight %AKG — `backend/src/lib/nutrition_insight.ts`

**Files:**
- Create: `backend/src/lib/nutrition_insight.ts`
- Test: `backend/src/lib/nutrition_insight.test.ts`

**Interfaces:**
- Produces: `export interface AlgNutrients { calories, protein, fat, saturatedFat, carbs, sugar, sodium }`, `export const ALG_UMUM: AlgNutrients`, `export function computeAlgPercent(perServing: AlgNutrients): AlgNutrients`, `export function buildWarnings(percentAlg: AlgNutrients): string[]`, `export function scaleServing<T extends Record<string, number>>(perServing: T, servingsPerPack?: number): T | null`.
- Consumes: nothing (murni, tanpa dependency file lain).

- [ ] **Step 1: Tulis test dulu**

Create `backend/src/lib/nutrition_insight.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { ALG_UMUM, computeAlgPercent, buildWarnings, scaleServing } from './nutrition_insight.ts';

// Separuh acuan kalori -> 50%.
assert.equal(
  computeAlgPercent({ calories: ALG_UMUM.calories / 2, protein: 0, fat: 0, saturatedFat: 0, carbs: 0, sugar: 0, sodium: 0 }).calories,
  50
);

// Natrium di atas ambang 20% ALG -> masuk warnings, menyebut "Natrium".
const highSodium = computeAlgPercent({ calories: 100, protein: 1, fat: 1, saturatedFat: 1, carbs: 10, sugar: 1, sodium: 500 });
assert.ok(buildWarnings(highSodium).some(w => w.includes('Natrium')));

// Semua di bawah ambang -> tidak ada warning.
const lowEverything = computeAlgPercent({ calories: 100, protein: 1, fat: 1, saturatedFat: 1, carbs: 10, sugar: 1, sodium: 50 });
assert.deepEqual(buildWarnings(lowEverything), []);

// scaleServing mengalikan tiap field numerik.
assert.deepEqual(scaleServing({ calories: 100, protein: 2 }, 3), { calories: 300, protein: 6 });
// servingsPerPack tidak valid (0, undefined) -> null, bukan dikalikan 0.
assert.equal(scaleServing({ calories: 100 }, 0), null);
assert.equal(scaleServing({ calories: 100 }, undefined), null);

console.log('nutrition_insight.test.ts OK');
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run (dari `backend/`): `node --experimental-strip-types src/lib/nutrition_insight.test.ts`
Expected: FAIL — `Cannot find module './nutrition_insight.ts'`.

- [ ] **Step 3: Tulis `nutrition_insight.ts`**

Create `backend/src/lib/nutrition_insight.ts`:

```typescript
/**
 * nutrition_insight.ts — %AKG terhadap Acuan Label Gizi (ALG) BPOM.
 *
 * Sumber: Peraturan BPOM No. 26/2021 ttg Informasi Nilai Gizi pada Label
 * Pangan Olahan. calories/protein/fat/carbs SUDAH diverifikasi lewat
 * pencarian web saat brainstorming fitur ini. saturatedFat/sugar/sodium
 * BELUM dicocokkan ke teks regulasi asli — jaringan sesi penulisan
 * memblokir situs BPOM (tabel-gizi.pom.go.id, peraturan.go.id). Nilai di
 * bawah dari ingatan model, dipilih konservatif. Cross-check ke dokumen
 * primer sebelum dipakai untuk klaim kesehatan; jangan hapus catatan ini
 * sampai itu dilakukan.
 *
 * ALG tidak mendefinisikan acuan serat — sengaja tidak ada di sini, serat
 * ditampilkan di UI apa adanya tanpa persentase.
 */

export interface AlgNutrients {
  calories: number;
  protein: number;
  fat: number;
  saturatedFat: number;
  carbs: number;
  sugar: number;
  sodium: number; // mg
}

export const ALG_UMUM: AlgNutrients = {
  calories: 2150,     // kkal — terverifikasi
  protein: 60,        // g — terverifikasi
  fat: 67,             // g — terverifikasi
  saturatedFat: 20,    // g — BELUM TERVERIFIKASI, lihat catatan di atas
  carbs: 325,          // g — terverifikasi
  sugar: 50,           // g — BELUM TERVERIFIKASI
  sodium: 1500,        // mg — BELUM TERVERIFIKASI
};

/** Peringatan muncul kalau satu sajian sudah lewat ini dari acuan harian. */
const WARNING_THRESHOLD_PCT = 20;

export function computeAlgPercent(perServing: AlgNutrients): AlgNutrients {
  const pct = (value: number, ref: number) => Math.round((value / ref) * 100);
  return {
    calories: pct(perServing.calories, ALG_UMUM.calories),
    protein: pct(perServing.protein, ALG_UMUM.protein),
    fat: pct(perServing.fat, ALG_UMUM.fat),
    saturatedFat: pct(perServing.saturatedFat, ALG_UMUM.saturatedFat),
    carbs: pct(perServing.carbs, ALG_UMUM.carbs),
    sugar: pct(perServing.sugar, ALG_UMUM.sugar),
    sodium: pct(perServing.sodium, ALG_UMUM.sodium),
  };
}

const WARNING_NUTRIENTS: { key: keyof AlgNutrients; label: string }[] = [
  { key: 'sodium', label: 'Natrium' },
  { key: 'sugar', label: 'Gula' },
  { key: 'saturatedFat', label: 'Lemak jenuh' },
];

export function buildWarnings(percentAlg: AlgNutrients): string[] {
  const warnings: string[] = [];
  for (const { key, label } of WARNING_NUTRIENTS) {
    const pct = percentAlg[key];
    if (pct > WARNING_THRESHOLD_PCT) {
      warnings.push(`${label} ${pct}% ALG dalam satu sajian`);
    }
  }
  return warnings;
}

/** Kalikan tiap field numerik dengan servingsPerPack. null kalau count tidak valid — pemanggil tahu tidak usah menampilkan kolom "per kemasan". */
export function scaleServing<T extends Record<string, number>>(
  perServing: T,
  servingsPerPack?: number
): T | null {
  if (!servingsPerPack || servingsPerPack <= 0) return null;
  const scaled = {} as T;
  for (const k of Object.keys(perServing) as (keyof T)[]) {
    scaled[k] = (Math.round(perServing[k] * servingsPerPack * 10) / 10) as T[keyof T];
  }
  return scaled;
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `node --experimental-strip-types src/lib/nutrition_insight.test.ts`
Expected: PASS, cetak `nutrition_insight.test.ts OK`.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: bersih.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/nutrition_insight.ts backend/src/lib/nutrition_insight.test.ts
git commit -m "feat: add BPOM ALG percent-of-daily-value calculator"
```

---

### Task 5: Resolver + search/lookup — `backend/src/routes/food_search.ts` (bagian 1)

**Files:**
- Create: `backend/src/routes/food_search.ts`
- Modify: `backend/src/index.ts:12` (import), `backend/src/index.ts:81` (route registration)

**Interfaces:**
- Consumes: `searchCuratedFoods, CuratedFood` dari `../data/foods_id` (Task 3); `runJson, SCHEMA_MODEL` dari `../lib/ai`; `requireAuth, type AuthContext` dari `../middleware/auth`; `nanoid` dari `../lib/nanoid`; `Env` dari `../types`.
- Produces: `export async function resolveFood(env: Env, opts: { barcode?: string; name?: string }): Promise<FoodResult | null>`, `export interface FoodResult { name, brand, servingSize, calories, protein, carbs, fat, fiber, sodium, sugar, source }` — dipakai Task 6 dan Task 7. Route default export `foodSearch`, mount di `/api/food`.

- [ ] **Step 1: Tulis `food_search.ts` (resolver + GET /search + POST /lookup)**

Create `backend/src/routes/food_search.ts`:

```typescript
import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { runJson, SCHEMA_MODEL } from '../lib/ai';
import { searchCuratedFoods, type CuratedFood } from '../data/foods_id';
import type { Env } from '../types';

const foodSearch = new Hono<AuthContext>();
foodSearch.use('/*', requireAuth);

// 90 hari — reformulasi produk biasanya lebih lambat dari ini.
const CACHE_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface FoodResult {
  name: string;
  brand: string | null;
  servingSize: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sodium: number; // mg
  sugar: number;
  source: 'curated' | 'cache-off' | 'cache-ai' | 'off' | 'ai';
}

function normalizeLookupKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function curatedToResult(f: CuratedFood): FoodResult {
  return {
    name: f.name, brand: null, servingSize: f.servingLabel,
    calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat,
    fiber: f.fiber, sodium: f.sodium, sugar: f.sugar, source: 'curated',
  };
}

interface CacheRow {
  name: string; brand: string | null; serving_size: string | null;
  calories: number; protein: number; carbs: number; fat: number;
  fiber: number; sodium: number; sugar: number; fetched_at: number;
}

function cacheRowToResult(row: CacheRow, source: 'cache-off' | 'cache-ai'): FoodResult {
  return {
    name: row.name, brand: row.brand, servingSize: row.serving_size,
    calories: row.calories, protein: row.protein, carbs: row.carbs, fat: row.fat,
    fiber: row.fiber, sodium: row.sodium, sugar: row.sugar, source,
  };
}

async function getCached(db: D1Database, source: 'off' | 'ai', lookupKey: string): Promise<CacheRow | null> {
  const row = await db.prepare(
    'SELECT name, brand, serving_size, calories, protein, carbs, fat, fiber, sodium, sugar, fetched_at FROM food_facts_cache WHERE source = ?1 AND lookup_key = ?2'
  ).bind(source, lookupKey).first<CacheRow>();
  if (!row) return null;
  const ageSeconds = Math.floor(Date.now() / 1000) - row.fetched_at;
  if (ageSeconds > CACHE_TTL_SECONDS) return null; // stale — treat sebagai miss, re-resolve
  return row;
}

async function putCache(db: D1Database, source: 'off' | 'ai', lookupKey: string, r: FoodResult): Promise<void> {
  await db.prepare(`
    INSERT INTO food_facts_cache (id, source, lookup_key, name, brand, serving_size, calories, protein, carbs, fat, fiber, sodium, sugar, fetched_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, unixepoch())
    ON CONFLICT(source, lookup_key) DO UPDATE SET
      name = ?4, brand = ?5, serving_size = ?6, calories = ?7, protein = ?8, carbs = ?9,
      fat = ?10, fiber = ?11, sodium = ?12, sugar = ?13, fetched_at = unixepoch()
  `).bind(
    nanoid(), source, lookupKey, r.name, r.brand, r.servingSize,
    r.calories, r.protein, r.carbs, r.fat, r.fiber, r.sodium, r.sugar
  ).run();
}

interface OffNutriments {
  'energy-kcal_100g'?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
  fiber_100g?: number;
  sodium_100g?: number; // gram di response OFF
  sugars_100g?: number;
}
interface OffProduct {
  product_name?: string;
  brands?: string;
  serving_size?: string;
  nutriments?: OffNutriments;
}
interface OffResponse {
  status?: number;
  product?: OffProduct;
}

/** Open Food Facts by barcode. Timeout 5s — jangan biarkan satu lookup menahan request pengguna. */
async function fetchOpenFoodFacts(barcode: string): Promise<FoodResult | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands,nutriments,serving_size`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  let json: OffResponse;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AtomicHabitTools/1.0 (kontak via app)' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    json = await res.json();
  } catch (err) {
    console.error('Open Food Facts fetch failed', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  const p = json.product;
  const n = p?.nutriments;
  if (json.status !== 1 || !p || !n || n['energy-kcal_100g'] === undefined) return null;

  return {
    name: p.product_name?.trim() || 'Produk tanpa nama',
    brand: p.brands?.trim() || null,
    servingSize: p.serving_size?.trim() || null,
    calories: n['energy-kcal_100g'] ?? 0,
    protein: n.proteins_100g ?? 0,
    carbs: n.carbohydrates_100g ?? 0,
    fat: n.fat_100g ?? 0,
    fiber: n.fiber_100g ?? 0,
    sodium: Math.round((n.sodium_100g ?? 0) * 1000), // gram -> mg
    sugar: n.sugars_100g ?? 0,
    source: 'off',
  };
}

const AI_FOOD_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    servingLabel: { type: 'string' },
    calories: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fat: { type: 'number' },
    fiber: { type: 'number' },
    sodium: { type: 'number' },
    sugar: { type: 'number' },
  },
  required: ['name', 'calories'],
} as const;

interface AiFoodRaw {
  name?: string; servingLabel?: string;
  calories?: number; protein?: number; carbs?: number; fat?: number;
  fiber?: number; sodium?: number; sugar?: number;
}

async function estimateWithAi(env: Env, name: string): Promise<FoodResult | null> {
  let raw: AiFoodRaw | null = null;
  try {
    raw = await runJson<AiFoodRaw>(
      env,
      [
        {
          role: 'system',
          content: 'Kamu ahli gizi Indonesia. Estimasi kandungan gizi untuk satu porsi lazim rumah tangga dari makanan yang disebut. Angka harus realistis untuk makanan pada umumnya, bukan produk kemasan bermerek spesifik. Semua teks Bahasa Indonesia.',
        },
        { role: 'user', content: `Estimasi gizi per porsi untuk: "${name}"` },
      ],
      AI_FOOD_SCHEMA as unknown as Record<string, unknown>,
      { model: SCHEMA_MODEL, maxTokens: 400 }
    );
  } catch (err) {
    console.error('Food AI estimate failed', err);
    return null;
  }
  if (!raw?.name || typeof raw.calories !== 'number') return null;

  return {
    name: raw.name.trim(),
    brand: null,
    servingSize: raw.servingLabel?.trim() || null,
    calories: Math.round(raw.calories),
    protein: raw.protein ?? 0,
    carbs: raw.carbs ?? 0,
    fat: raw.fat ?? 0,
    fiber: raw.fiber ?? 0,
    sodium: raw.sodium ?? 0,
    sugar: raw.sugar ?? 0,
    source: 'ai',
  };
}

/**
 * Resolver bertingkat. Barcode dan name diselesaikan lewat jalur terpisah —
 * barcode TIDAK PERNAH jatuh ke tier AI (nomor barcode tidak berarti apa-apa
 * bagi model bahasa); kalau OFF tidak punya datanya, hasilnya null dan
 * pemanggil mengarahkan pengguna ke scan label sebagai gantinya.
 *
 *   barcode: cache-off (tier 2) -> Open Food Facts (tier 3) -> null
 *   name:    curated (tier 1) -> cache-ai (tier 2) -> AI (tier 4)
 */
export async function resolveFood(
  env: Env,
  opts: { barcode?: string; name?: string }
): Promise<FoodResult | null> {
  const barcode = opts.barcode?.trim();
  const name = opts.name?.trim();

  if (barcode) {
    const cached = await getCached(env.DB, 'off', barcode);
    if (cached) return cacheRowToResult(cached, 'cache-off');

    const off = await fetchOpenFoodFacts(barcode);
    if (off) {
      await putCache(env.DB, 'off', barcode, off);
      return off;
    }
    return null;
  }

  if (name) {
    const curated = searchCuratedFoods(name).find(f => f.name.toLowerCase() === name.toLowerCase());
    if (curated) return curatedToResult(curated);

    const lookupKey = normalizeLookupKey(name);
    const cached = await getCached(env.DB, 'ai', lookupKey);
    if (cached) return cacheRowToResult(cached, 'cache-ai');

    const ai = await estimateWithAi(env, name);
    if (ai) {
      await putCache(env.DB, 'ai', lookupKey, ai);
      return ai;
    }
  }

  return null;
}

// GET /api/food/search?q=  — tier 1 (kurasi) + tier 2 (cache-ai), TANPA AI dan TANPA fetch
// jaringan. Untuk autocomplete cepat saat mengetik.
foodSearch.get('/search', async (c) => {
  const q = c.req.query('q')?.trim() ?? '';
  if (q.length < 2) return c.json({ results: [] });

  const curated = searchCuratedFoods(q).slice(0, 10).map(curatedToResult);
  if (curated.length >= 10) return c.json({ results: curated });

  const cached = await getCached(c.env.DB, 'ai', normalizeLookupKey(q));
  const results = cached ? [...curated, cacheRowToResult(cached, 'cache-ai')] : curated;
  return c.json({ results });
});

// POST /api/food/lookup — { barcode? , name? } — rantai resolver penuh.
foodSearch.post('/lookup', async (c) => {
  const body = await c.req.json<{ barcode?: string; name?: string }>().catch(() => null);
  const barcode = body?.barcode?.trim();
  const name = body?.name?.trim();
  if (!barcode && !name) return c.json({ error: 'barcode atau name wajib diisi' }, 400);

  const result = await resolveFood(c.env, { barcode, name });
  if (!result) {
    return c.json(
      { error: barcode ? 'Produk tidak ditemukan, coba scan label' : 'Makanan tidak dikenali' },
      404
    );
  }
  return c.json({ food: result });
});

export default foodSearch;
```

- [ ] **Step 2: Daftarkan route di `index.ts`**

Modify `backend/src/index.ts` — tambahkan import setelah baris 12 (`import nutrition from './routes/nutrition';`):

```typescript
import foodSearch from './routes/food_search';
```

Dan tambahkan registrasi setelah baris `app.route('/api/nutrition', nutrition);`:

```typescript
app.route('/api/food', foodSearch);
```

- [ ] **Step 3: Type-check**

Run (dari `backend/`): `npx tsc --noEmit`
Expected: bersih. Kalau ada error soal `D1Database`/`Ai` global type hilang, pastikan `@cloudflare/workers-types` sudah ter-include lewat `tsconfig.json` (`"types": ["@cloudflare/workers-types"]`) — jangan tambah import manual.

- [ ] **Step 4: Verifikasi manual urutan tingkat lewat trace kode**

Run: `grep -n "if (barcode)\|if (name)\|return null" backend/src/routes/food_search.ts`
Expected: urutan pemeriksaan persis mengikuti komentar di atas `resolveFood` — barcode diperiksa dulu dan berhenti sebelum blok `name` pernah dievaluasi untuk kasus barcode; kalau salah satu langkah ini terbalik, cek ulang `resolveFood`.

**Catatan verifikasi:** panggilan live ke Open Food Facts tidak bisa dites di sesi ini (jaringan container dev memblokir `world.openfoodfacts.org`, dikonfirmasi lewat `curl` dan `WebFetch` — lihat spec). `fetchOpenFoodFacts` diverifikasi lewat pembacaan kode saja di sini; jalur ini baru terbukti benar setelah deploy dan dicoba dengan barcode produk asli, lihat Task 9.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/food_search.ts backend/src/index.ts
git commit -m "feat: add tiered food resolver (curated -> cache -> Open Food Facts -> AI)"
```

---

### Task 6: Scan label — `POST /api/food/scan-label`

**Files:**
- Modify: `backend/src/routes/food_search.ts` (tambahkan endpoint baru di akhir file, sebelum `export default foodSearch;`)

**Interfaces:**
- Consumes: `runJson, runText, SCHEMA_MODEL` dari `../lib/ai`; `jakartaToday` dari `../lib/validate`; `ALG_UMUM, computeAlgPercent, buildWarnings, scaleServing, type AlgNutrients` dari `../lib/nutrition_insight` (Task 4).
- Produces: response `{ perServing: AlgNutrients & { fiber: number }, perPack: (AlgNutrients & { fiber: number }) | null, servingSize: string | null, servingsPerPack: number | null, insight: { percentAlg: AlgNutrients, warnings: string[], suggestion: string } }`.

- [ ] **Step 1: Tambahkan import di puncak `food_search.ts`**

Modify `backend/src/routes/food_search.ts` — ubah baris import paling atas:

```typescript
import { runJson, runText, SCHEMA_MODEL } from '../lib/ai';
```

(sebelumnya `runJson, SCHEMA_MODEL` saja — tambahkan `runText`.) Tambahkan juga:

```typescript
import { jakartaToday } from '../lib/validate';
import { ALG_UMUM, computeAlgPercent, buildWarnings, scaleServing, type AlgNutrients } from '../lib/nutrition_insight';
```

- [ ] **Step 2: Tambahkan endpoint sebelum `export default foodSearch;`**

Modify `backend/src/routes/food_search.ts` — sisipkan sebelum baris `export default foodSearch;`:

```typescript
const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    servingSize: { type: 'string' },
    servingsPerPack: { type: 'number' },
    calories: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fat: { type: 'number' },
    saturatedFat: { type: 'number' },
    fiber: { type: 'number' },
    sugar: { type: 'number' },
    sodium: { type: 'number' },
  },
  required: ['calories'],
} as const;

interface RawLabel {
  servingSize?: string;
  servingsPerPack?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  saturatedFat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

// POST /api/food/scan-label — { image } data URL panel Informasi Nilai Gizi.
//
// Panel Indonesia mencantumkan angka PER TAKARAN SAJI, dan satu kemasan
// sering berisi lebih dari satu sajian — kalau dibaca mentah lalu disimpan
// sebagai "1 porsi", user yang makan seluruh kemasan tercatat sepertiga dari
// yang sebenarnya. Makanya respons ini SELALU mengembalikan dua angka
// (per sajian, per kemasan) dan membiarkan pemanggil (frontend) memaksa
// user memilih sebelum disimpan ke log.
foodSearch.post('/scan-label', async (c) => {
  const body = await c.req.json<{ image?: string }>().catch(() => null);
  const image = body?.image?.trim();
  if (!image) return c.json({ error: 'image is required' }, 400);
  if (!image.startsWith('data:image/')) return c.json({ error: 'image must be a data URL' }, 400);
  if (image.length > 6_000_000) return c.json({ error: 'image too large' }, 413);

  let raw: RawLabel | null = null;
  try {
    raw = await runJson<RawLabel>(
      c.env,
      [
        {
          role: 'system',
          content: 'Kamu membaca panel Informasi Nilai Gizi pada kemasan makanan Indonesia. Ambil angka PER TAKARAN SAJI seperti tercetak (bukan per 100g kecuali memang itu yang tercetak), takaran saji, dan jumlah sajian per kemasan kalau tercantum. Lemak jenuh dalam gram, natrium dalam miligram, sesuai satuan yang lazim tercetak di label.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Baca panel Informasi Nilai Gizi ini dan keluarkan datanya.' },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
      LABEL_SCHEMA as unknown as Record<string, unknown>,
      { model: SCHEMA_MODEL, maxTokens: 500 }
    );
  } catch (err) {
    console.error('Label scan failed', err);
    return c.json({ error: 'Gagal membaca label' }, 502);
  }

  if (!raw || typeof raw.calories !== 'number' || raw.calories <= 0) {
    return c.json({ error: 'Label tidak terbaca' }, 422);
  }

  const perServing: AlgNutrients = {
    calories: raw.calories,
    protein: raw.protein ?? 0,
    fat: raw.fat ?? 0,
    saturatedFat: raw.saturatedFat ?? 0,
    carbs: raw.carbs ?? 0,
    sugar: raw.sugar ?? 0,
    sodium: raw.sodium ?? 0,
  };
  const fiber = raw.fiber ?? 0;

  const percentAlg = computeAlgPercent(perServing);
  const warnings = buildWarnings(percentAlg);

  const user = c.get('user');
  const [targetRow, todayRow] = await Promise.all([
    c.env.DB.prepare('SELECT calories FROM nutrition_targets WHERE user_id = ?1').bind(user.sub).first<{ calories: number }>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(calories), 0) as total FROM food_logs WHERE user_id = ?1 AND log_date = ?2")
      .bind(user.sub, jakartaToday()).first<{ total: number }>(),
  ]);
  const dailyTarget = targetRow?.calories ?? 2200;
  const remaining = Math.max(0, dailyTarget - (todayRow?.total ?? 0));

  let suggestion = '';
  try {
    suggestion = await runText(c.env, [
      { role: 'system', content: 'Kamu asisten gizi yang memberi satu kalimat saran singkat, suportif, dan jujur pada angka dalam Bahasa Indonesia. Tanpa markdown.' },
      {
        role: 'user',
        content: [
          `Sisa kuota kalori hari ini: ${remaining} kkal.`,
          `Produk yang baru dipindai: ${perServing.calories} kkal per sajian.`,
          warnings.length ? `Peringatan: ${warnings.join('; ')}.` : '',
          'Beri satu kalimat saran singkat.',
        ].filter(Boolean).join(' '),
      },
    ], { maxTokens: 100 });
  } catch (err) {
    console.error('Label suggestion failed', err);
    // Insight tetap berguna tanpa kalimat saran — tidak menggagalkan seluruh respons.
  }

  const perServingFull = { ...perServing, fiber };
  const perPack = raw.servingsPerPack && raw.servingsPerPack > 1
    ? scaleServing(perServingFull, raw.servingsPerPack)
    : null;

  return c.json({
    perServing: perServingFull,
    perPack,
    servingSize: raw.servingSize ?? null,
    servingsPerPack: raw.servingsPerPack ?? null,
    insight: { percentAlg, warnings, suggestion: suggestion.trim() },
  });
});
```

- [ ] **Step 3: Type-check**

Run (dari `backend/`): `npx tsc --noEmit`
Expected: bersih.

- [ ] **Step 4: Verifikasi manual skema vision cocok dengan tipe `RawLabel`**

Run: `grep -n "properties:" -A12 backend/src/routes/food_search.ts | head -15`
Expected: setiap key di `LABEL_SCHEMA.properties` (servingSize, servingsPerPack, calories, protein, carbs, fat, saturatedFat, fiber, sugar, sodium) punya pasangan persis di interface `RawLabel` — kalau ada yang beda nama, `runJson` akan diam-diam mengembalikan `undefined` untuk field itu.

**Catatan verifikasi:** endpoint ini butuh model vision (`SCHEMA_MODEL`) yang di container dev tidak bisa dipanggil live tanpa binding AI produksi. Diverifikasi lewat pembacaan kode + type-check di sini; foto label sungguhan dicoba setelah deploy (Task 9).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/food_search.ts
git commit -m "feat: add nutrition label scan endpoint with per-serving/per-pack split and ALG insight"
```

---

### Task 7: `nutrition.ts` — terima `source`/`barcode` dari log makanan

**Files:**
- Modify: `backend/src/routes/nutrition.ts:10-22` (interface `DBFoodLog`), `:100-159` (POST /food), `:70-82` (mapping GET /)

**Interfaces:**
- Consumes: tidak ada dependency baru.
- Produces: `POST /api/nutrition/food` menerima field opsional `source?: string`, `barcode?: string`; `GET /api/nutrition` mengembalikan `source`/`barcode` di tiap `foodLogs[]`.

- [ ] **Step 1: Tambahkan kolom ke `DBFoodLog`**

Modify `backend/src/routes/nutrition.ts` — ubah interface di baris 10-22:

```typescript
interface DBFoodLog {
  id: string;
  food_name: string;
  portion: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  label: string | null;
  log_date: string;
  created_at: number;
  source: string | null;
  barcode: string | null;
}
```

- [ ] **Step 2: Sertakan di mapping `GET /`**

Modify `backend/src/routes/nutrition.ts` — di dalam `logs.map(l => ({ ... }))` (baris ~71-82), tambahkan dua baris sebelum penutup objek:

```typescript
      label: l.label,
      date: l.log_date,
      source: l.source,
      barcode: l.barcode,
    })),
```

(Ganti baris `label: l.label, date: l.log_date,` yang sudah ada plus baris `})),` penutup dengan versi di atas.)

- [ ] **Step 3: Terima field baru di POST /food**

Modify `backend/src/routes/nutrition.ts` — di `FoodBody` type (dalam `nutrition.post('/food', ...)`, sekitar baris 103-113), tambahkan dua field:

```typescript
  type FoodBody = {
    name?: string;
    portion?: string;
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    fiber?: number;
    label?: string;
    date?: string;
    source?: string;
    barcode?: string;
  };
```

Lalu ubah statement INSERT (baris ~130-145) untuk menyertakan dua kolom baru:

```typescript
  await c.env.DB.prepare(
    `INSERT INTO food_logs (id, user_id, food_name, portion, calories, protein_g, carbs_g, fat_g, fiber_g, label, log_date, created_at, source, barcode)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
  ).bind(
    id, user.sub,
    body.name!.trim(),
    body.portion?.trim() ?? null,
    body.calories !== undefined ? Math.round(body.calories) : null,
    body.protein !== undefined ? parseFloat(body.protein.toString()) : null,
    body.carbs !== undefined ? parseFloat(body.carbs.toString()) : null,
    body.fat !== undefined ? parseFloat(body.fat.toString()) : null,
    body.fiber !== undefined ? parseFloat(body.fiber.toString()) : null,
    label,
    date,
    now,
    body.source?.trim() || null,
    body.barcode?.trim() || null
  ).run();
```

Dan tambahkan ke response object (baris ~147-158) sesudah `label,` `date,`:

```typescript
    label,
    date,
    source: body.source ?? null,
    barcode: body.barcode ?? null,
  }, 201);
```

- [ ] **Step 4: Type-check**

Run (dari `backend/`): `npx tsc --noEmit`
Expected: bersih.

- [ ] **Step 5: Verifikasi jumlah placeholder cocok**

Run: `grep -n "VALUES (?1" backend/src/routes/nutrition.ts`
Expected: baris INSERT `food_logs` menunjukkan 14 placeholder (`?1` sampai `?14`), cocok dengan 14 argumen di `.bind(...)` tepat di bawahnya. Kalau tidak cocok, D1 akan melempar error di runtime, bukan saat type-check.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/nutrition.ts
git commit -m "feat: accept source/barcode when logging food from resolver or scan"
```

---

### Task 8: Frontend — cari, scan barcode, scan label di `Nutrition.tsx`

**Files:**
- Create: `frontend/src/types/barcode-detector.d.ts`
- Modify: `frontend/src/screens/Nutrition.tsx`

**Interfaces:**
- Consumes: `compressImage` dari `@/lib/image` (Task 1); `apiFetch` dari `@/lib/api` (sudah ada); `FoodResult` shape dari backend Task 5/6 (dituliskan ulang sebagai `FoodSearchResult`/`LabelScanResult` di frontend, tidak diimpor lintas paket — backend dan frontend adalah dua proyek terpisah).
- Produces: tidak ada yang dikonsumsi task lain — ini titik akhir UI.

- [ ] **Step 1: Deklarasi ambient type `BarcodeDetector`**

TypeScript's bundled DOM lib belum punya `BarcodeDetector` (API masih Chrome/Android-only). Create `frontend/src/types/barcode-detector.d.ts`:

```typescript
// BarcodeDetector belum ada di lib.dom.d.ts bawaan TypeScript — deklarasi
// minimal supaya tsc bersih. Hanya bentuk yang dipakai di Nutrition.tsx.
// Referensi: https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
interface DetectedBarcode {
  rawValue: string;
}

declare class BarcodeDetector {
  constructor(options?: { formats: string[] });
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
```

- [ ] **Step 2: Import baru + interface baru di puncak `Nutrition.tsx`**

Modify `frontend/src/screens/Nutrition.tsx` — ubah import di baris 1-6:

```typescript
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '@/stores/uiStore';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { compressImage } from '@/lib/image';
import { NUTRITION_MACROS } from '@/constants/colors';
```

Tambahkan interface baru setelah interface `FoodLog` (dan tambahkan `source`/`barcode` opsional ke `FoodLog` yang sudah ada):

```typescript
interface FoodLog {
  id: string;
  name: string;
  portion: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  label: string | null;
  date: string;
  source?: string | null;
  barcode?: string | null;
}

interface FoodSearchResult {
  name: string;
  brand: string | null;
  servingSize: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sodium: number;
  sugar: number;
  source: 'curated' | 'cache-off' | 'cache-ai' | 'off' | 'ai';
}

interface AlgPercent {
  calories: number; protein: number; fat: number; saturatedFat: number;
  carbs: number; sugar: number; sodium: number;
}

interface LabelScanResult {
  perServing: AlgPercent & { fiber: number };
  perPack: (AlgPercent & { fiber: number }) | null;
  servingSize: string | null;
  servingsPerPack: number | null;
  insight: { percentAlg: AlgPercent; warnings: string[]; suggestion: string };
}

const SOURCE_BADGE: Record<string, string> = {
  curated: 'Terkurasi', 'cache-off': 'Terverifikasi', off: 'Terverifikasi',
  'cache-ai': 'Perkiraan AI', ai: 'Perkiraan AI', 'label-scan': 'Dari label',
};
```

- [ ] **Step 3: State baru di dalam `Nutrition()`**

Modify `frontend/src/screens/Nutrition.tsx` — tambahkan setelah deklarasi state target (`savingTarget`, sekitar baris 63):

```typescript
  // Search & scan state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FoodSearchResult[]>([]);
  const [foodSource, setFoodSource] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [labelScan, setLabelScan] = useState<LabelScanResult | null>(null);
  const [labelChoice, setLabelChoice] = useState<'sajian' | 'kemasan'>('sajian');
```

- [ ] **Step 4: Efek debounce pencarian**

Modify `frontend/src/screens/Nutrition.tsx` — tambahkan setelah `useEffect(() => { load(); }, []);` (baris 80):

```typescript
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    const handle = setTimeout(async () => {
      try {
        const res = await apiFetch<{ results: FoodSearchResult[] }>(`/food/search?q=${encodeURIComponent(q)}`);
        setSearchResults(res.results);
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);
```

- [ ] **Step 5: Fungsi apply hasil + handler barcode/label**

Modify `frontend/src/screens/Nutrition.tsx` — tambahkan setelah `handleDeleteFood` (setelah baris 132):

```typescript
  const applyFoodResult = (food: FoodSearchResult) => {
    setFoodName(food.name);
    setPortion(food.servingSize ?? '');
    setCalories(String(Math.round(food.calories)));
    setProtein(String(food.protein));
    setCarbs(String(food.carbs));
    setFat(String(food.fat));
    setFiber(String(food.fiber));
    setFoodSource(food.source);
    setSearchQuery('');
    setSearchResults([]);
    setShowAddFood(true);
  };

  const handleBarcodeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError('');
    setScanning(true);
    try {
      if (typeof BarcodeDetector === 'undefined') {
        setScanError('Perangkat tidak mendukung scan barcode. Coba scan label sebagai gantinya.');
        setScanning(false);
        return;
      }
      const bitmap = await createImageBitmap(file);
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const codes = await detector.detect(bitmap);
      if (!codes.length) {
        setScanError('Barcode tidak terdeteksi. Coba scan label sebagai gantinya.');
        setScanning(false);
        return;
      }
      const res = await apiFetch<{ food: FoodSearchResult }>('/food/lookup', {
        method: 'POST',
        body: JSON.stringify({ barcode: codes[0].rawValue }),
      });
      applyFoodResult(res.food);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Gagal memindai barcode.');
    }
    setScanning(false);
  };

  const handleLabelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError('');
    setScanning(true);
    try {
      const image = await compressImage(file);
      const res = await apiFetch<LabelScanResult>('/food/scan-label', {
        method: 'POST',
        body: JSON.stringify({ image }),
      });
      setLabelScan(res);
      setLabelChoice('sajian');
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Gagal membaca label.');
    }
    setScanning(false);
  };

  const applyLabelScan = () => {
    if (!labelScan) return;
    const chosen = labelChoice === 'kemasan' && labelScan.perPack ? labelScan.perPack : labelScan.perServing;
    setPortion(labelChoice === 'kemasan' ? 'Seluruh kemasan' : (labelScan.servingSize ?? '1 sajian'));
    setCalories(String(Math.round(chosen.calories)));
    setProtein(String(chosen.protein));
    setCarbs(String(chosen.carbs));
    setFat(String(chosen.fat));
    setFiber(String(chosen.fiber));
    setFoodSource('label-scan');
    setShowAddFood(true);
    setLabelScan(null);
  };
```

- [ ] **Step 6: Sertakan `source` saat menyimpan**

Modify `frontend/src/screens/Nutrition.tsx` — di `handleAddFood` (baris 82-110), tambahkan `source: foodSource ?? undefined,` ke body JSON, dan reset `foodSource` di akhir bersama field lain:

```typescript
  const handleAddFood = async () => {
    if (!foodName.trim()) return;
    setSavingFood(true);
    try {
      await apiFetch('/nutrition/food', {
        method: 'POST',
        body: JSON.stringify({
          name: foodName.trim(),
          portion: portion.trim() || undefined,
          calories: calories ? parseInt(calories) : 0,
          protein: protein ? parseFloat(protein) : 0,
          carbs: carbs ? parseFloat(carbs) : 0,
          fat: fat ? parseFloat(fat) : 0,
          fiber: fiber ? parseFloat(fiber) : 0,
          label: foodLabel,
          source: foodSource ?? undefined,
        }),
      });
      load();
      setFoodName('');
      setPortion('');
      setCalories('');
      setProtein('');
      setCarbs('');
      setFat('');
      setFiber('');
      setFoodSource(null);
      setShowAddFood(false);
    } catch {}
    setSavingFood(false);
  };
```

- [ ] **Step 7: UI — kotak cari, tombol scan, panel hasil scan label**

Modify `frontend/src/screens/Nutrition.tsx` — sisipkan sebelum blok `{/* Add Food Log Form */}` (sebelum baris 330), UI kotak cari + dua tombol scan + panel hasil (muncul kalau `labelScan` terisi):

```typescript
      {/* Cari & Scan */}
      <div className="rounded-[18px] p-4 mb-4 flex flex-col gap-3" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        <input
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
          placeholder="Cari makanan... misal nasi goreng"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        {searchResults.length > 0 && (
          <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
            {searchResults.map((r, i) => (
              <button
                key={i}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-left text-sm"
                style={{ background: 'var(--bg)' }}
                onClick={() => applyFoodResult(r)}
              >
                <span style={{ color: 'var(--text)' }}>{r.name}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--track)', color: 'var(--text2)' }}>
                  {SOURCE_BADGE[r.source] ?? r.source}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <label
            className="flex-1 text-center py-2.5 rounded-xl text-xs font-bold cursor-pointer"
            style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
          >
            {scanning ? 'Memindai...' : '📷 Scan Label'}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleLabelFile} disabled={scanning} />
          </label>
          <label
            className="flex-1 text-center py-2.5 rounded-xl text-xs font-bold cursor-pointer"
            style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
          >
            {scanning ? 'Memindai...' : '▮▮ Scan Barcode'}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleBarcodeFile} disabled={scanning} />
          </label>
        </div>
        {scanError && <p className="text-xs font-semibold text-[var(--neg)]">{scanError}</p>}
      </div>

      {/* Hasil Scan Label — pilih per sajian / per kemasan sebelum simpan */}
      <AnimatePresence>
        {labelScan && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Hasil Scan Label</p>
            <div className="flex gap-2">
              <button
                className="flex-1 py-2 rounded-xl text-xs font-bold"
                style={{
                  background: labelChoice === 'sajian' ? 'var(--accentFill)' : 'var(--bg)',
                  color: labelChoice === 'sajian' ? 'white' : 'var(--text2)',
                }}
                onClick={() => setLabelChoice('sajian')}
              >
                Per Sajian ({labelScan.servingSize ?? '?'})
              </button>
              <button
                className="flex-1 py-2 rounded-xl text-xs font-bold"
                style={{
                  background: labelChoice === 'kemasan' ? 'var(--accentFill)' : 'var(--bg)',
                  color: labelChoice === 'kemasan' ? 'white' : 'var(--text2)',
                  opacity: labelScan.perPack ? 1 : 0.4,
                }}
                onClick={() => labelScan.perPack && setLabelChoice('kemasan')}
                disabled={!labelScan.perPack}
              >
                Seluruh Kemasan{labelScan.servingsPerPack ? ` (${labelScan.servingsPerPack}x)` : ''}
              </button>
            </div>
            <p className="text-xs" style={{ color: 'var(--text2)' }}>
              {Math.round((labelChoice === 'kemasan' && labelScan.perPack ? labelScan.perPack : labelScan.perServing).calories)} kkal
              {' · '}%AKG kalori {labelScan.insight.percentAlg.calories}%
            </p>
            {labelScan.insight.warnings.length > 0 && (
              <div className="flex flex-col gap-1">
                {labelScan.insight.warnings.map((w, i) => (
                  <p key={i} className="text-xs font-semibold" style={{ color: 'var(--warn)' }}>⚠ {w}</p>
                ))}
              </div>
            )}
            {labelScan.insight.suggestion && (
              <p className="text-xs italic" style={{ color: 'var(--text3)' }}>{labelScan.insight.suggestion}</p>
            )}
            <div className="flex gap-2">
              <motion.button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'var(--accentFill)' }}
                onClick={applyLabelScan}
                whileTap={{ scale: 0.97 }}
              >
                Pakai Angka Ini
              </motion.button>
              <button
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                onClick={() => setLabelScan(null)}
              >
                Batal
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
```

- [ ] **Step 8: Badge sumber di food log list**

Modify `frontend/src/screens/Nutrition.tsx` — di dalam `.map(food => ...)` render list (sekitar baris 566-573), tambahkan badge kecil kalau `food.source` menunjukkan estimasi AI:

```typescript
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                          {food.name}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>
                          {food.portion} · {food.protein}g protein
                          {food.source && SOURCE_BADGE[food.source] === 'Perkiraan AI' && ' · perkiraan AI'}
                        </p>
                      </div>
```

- [ ] **Step 9: Type-check + build**

Run (dari `frontend/`): `npx tsc -b`
Expected: bersih. Kalau ada error `Cannot find name 'BarcodeDetector'`, pastikan `frontend/src/types/barcode-detector.d.ts` sudah dibuat (Step 1) dan tidak ada typo nama file (harus `.d.ts`, bukan `.ts`, supaya tidak butuh export/import eksplisit).

Run: `npm run build`
Expected: build sukses.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/types/barcode-detector.d.ts frontend/src/screens/Nutrition.tsx
git commit -m "feat: add food search, barcode scan, and label scan UI to Nutrition screen"
```

---

### Task 9: Verifikasi akhir

**Files:** tidak ada file baru — hanya menjalankan pemeriksaan.

- [ ] **Step 1: Type-check penuh kedua paket**

Run: `cd backend && npx tsc --noEmit`
Expected: bersih.

Run: `cd frontend && npx tsc -b && npm run build`
Expected: bersih.

- [ ] **Step 2: Jalankan kedua unit test logic murni sekali lagi (regresi setelah semua task)**

Run (dari `backend/`):
```bash
node --experimental-strip-types src/data/foods_id.test.ts
node --experimental-strip-types src/lib/nutrition_insight.test.ts
```
Expected: keduanya PASS.

- [ ] **Step 3: `sweep.js` pada layar Nutrition, light + dark**

Run (dari `frontend/`, ikuti cara sweep.js dipanggil di PR sebelumnya — biasanya perlu dev server jalan lebih dulu):
```bash
npm run dev &
sleep 3
node sweep.js
```
Expected: 0 contrast failures, 0 runtime error, 0 blank screen untuk layar Nutrition di kedua tema — perhatikan khususnya kartu "Hasil Scan Label" dan badge sumber yang baru ditambahkan, karena keduanya elemen teks baru yang belum pernah diaudit.

- [ ] **Step 4: Catat batasan verifikasi di PR**

Tulis eksplisit di deskripsi PR (bukan kode) bahwa:
- Panggilan live ke Open Food Facts (`fetchOpenFoodFacts`) dan model vision (`scan-label`, resolver AI fallback) tidak bisa dites di container dev sesi ini — jaringan memblokir `world.openfoodfacts.org`, dan AI binding produksi tidak tersedia secara lokal. Kedua jalur diverifikasi lewat type-check + pembacaan kode, dan perlu dicoba manual dengan barcode/foto label asli setelah deploy.
- Tiga angka ALG (lemak jenuh, gula, natrium) di `nutrition_insight.ts` belum dicocokkan ke teks regulasi BPOM primer — ditandai jelas di kode, perlu cross-check kalau dipakai untuk klaim kesehatan presisi tinggi.

- [ ] **Step 5: Commit dokumentasi verifikasi (kalau ada perubahan, mis. hasil sweep disimpan)**

```bash
git add -A
git commit -m "chore: final verification pass for nutrition resolver feature" --allow-empty
```

(Commit `--allow-empty` hanya perlu kalau Step 1-4 tidak menghasilkan perubahan file — kalau sweep.js menyimpan screenshot baru yang di-gitignore, commit ini kemungkinan tidak ada apa-apanya untuk di-add; boleh dilewati kalau `git status` bersih.)
