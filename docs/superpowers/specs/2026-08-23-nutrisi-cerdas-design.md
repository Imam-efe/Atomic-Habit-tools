# Nutrisi Cerdas: Resolver Bertingkat, Scan Barcode/Label, Insight AKG

## Goal

Modul Nutrition saat ini cuma form manual — user isi nama, porsi, dan angka gizi sendiri. Tiga peningkatan:

1. **Resolver bertingkat** — cari nama makanan/barcode lewat kurasi lokal → cache bersama → Open Food Facts → AI, berhenti di tingkat pertama yang kena.
2. **Scan barcode & foto label** — dua jalur input baru selain ketik manual, memakai kamera yang sudah ada polanya di `Garden.tsx`.
3. **Insight %AKG** — setelah gizi terbaca, hitung persentase terhadap Acuan Label Gizi BPOM dan target pribadi user, tandai kelebihan gula/natrium/lemak jenuh, beri satu kalimat saran AI.

## Architecture

Backend: satu route baru `backend/src/routes/food_search.ts` (resolver + lookup + scan-label), satu data module `backend/src/data/foods_id.ts` (kurasi ~50 makanan, sama polanya dengan `data/plants.ts`), migration `0026_food_cache.sql`. `nutrition.ts` yang sudah ada tidak berubah strukturnya — hanya `food_logs` dapat dua kolom baru.

Frontend: `Nutrition.tsx` dapat tiga UI baru (cari dengan autocomplete, tombol scan barcode, tombol scan label) yang mengisi form yang sudah ada, bukan menggantinya.

Cache **lintas-user** (fakta produk publik, bukan data pribadi) — beda dari `food_logs` yang tetap per `user_id` ketat.

---

## 1. Kurasi lokal — `backend/src/data/foods_id.ts`

Ikut pola `plants.ts`: data referensi ditulis tangan, ditinjau seperti kode, tidak bergantung migration.

```typescript
export interface CuratedFood {
  id: string;            // slug, jadi lookup_key tingkat 1
  name: string;           // "Nasi putih"
  aliases: string[];      // ["nasi", "sebakul nasi"] — dicocokkan search
  servingLabel: string;   // "1 centong (100 g)"
  calories: number;
  protein: number;        // gram
  carbs: number;
  fat: number;
  fiber: number;
  sodium: number;         // mg — dipakai insight
  sugar: number;          // gram
}
```

~50 entri: nasi putih, nasi goreng, mie instan (goreng & kuah), telur (rebus/goreng/dadar), tempe/tahu goreng, ayam goreng/bakar, rendang, gado-gado, soto ayam, bakso, sate ayam, nasi padang komponennya, roti tawar, pisang, sambal, kerupuk, teh manis, kopi, dll — daftar final disusun saat implementasi dari makanan yang paling sering dicatat.

**Sumber angka:** Tabel Komposisi Pangan Indonesia (TKPI) Kemenkes, per porsi lazim rumah tangga. Dicatat di komentar file per entri kalau angka menyimpang dari TKPI standar (mis. digoreng vs rebus).

Fungsi ekspor: `searchCuratedFoods(query: string): CuratedFood[]` — cocokkan `name`/`aliases`, `includes()` case-insensitive, tanpa fuzzy matching (YAGNI untuk 50 entri).

---

## 2. Cache bersama — migration `0026_food_cache.sql`

```sql
CREATE TABLE IF NOT EXISTS food_facts_cache (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,          -- 'off' | 'ai'
  lookup_key TEXT NOT NULL,      -- barcode, atau nama ternormalisasi untuk AI
  name TEXT NOT NULL,
  brand TEXT,
  serving_size TEXT,             -- takaran saji tercetak, kalau ada
  calories REAL,
  protein REAL,
  carbs REAL,
  fat REAL,
  fiber REAL,
  sodium REAL,
  sugar REAL,
  fetched_at INTEGER NOT NULL,
  UNIQUE(source, lookup_key)
);

CREATE INDEX IF NOT EXISTS idx_food_cache_lookup ON food_facts_cache(source, lookup_key);

ALTER TABLE food_logs ADD COLUMN source TEXT;    -- 'curated' | 'cache-off' | 'cache-ai' | 'manual' | 'label-scan'
ALTER TABLE food_logs ADD COLUMN barcode TEXT;
```

TTL 90 hari dicek di kode saat baca (`fetched_at < now - 90*86400` → treat sebagai miss, re-resolve), bukan job pembersih terpisah — konsisten dengan cara `garden_care_alert_sent` sudah ditangani di cron yang ada, tidak perlu infrastruktur baru.

---

## 3. Resolver — `backend/src/routes/food_search.ts`

```
GET  /api/food/search?q=              tier 1 (kurasi) + tier 2 (cache), tanpa AI — untuk autocomplete cepat
POST /api/food/lookup                 { barcode? , name? } — rantai penuh 1→2→3→4
POST /api/food/scan-label             { image } — vision baca panel + insight
```

### `resolveFood(env, { barcode?, name? })`

```
1. Jika barcode: cek food_facts_cache (source='off', lookup_key=barcode).
   Hit & belum expired → return { ...cached, source: 'cache-off' }.
2. Jika name: cocokkan searchCuratedFoods() dulu.
   Match → return { ...food, source: 'curated' }.
3. Jika name: cek food_facts_cache (source='ai', lookup_key=normalize(name)).
   Hit & belum expired → return { ...cached, source: 'cache-ai' }.
4. Jika barcode: fetch Open Food Facts v2, timeout 5s.
   Sukses & nutriments lengkap → simpan ke cache (source='off') → return source:'off'.
5. Fallback AI: runJson(SCHEMA_MODEL) prompt "estimasi gizi per porsi lazim untuk '<name>'".
   Simpan ke cache (source='ai') → return source:'ai', flagged estimasi:true.
6. Semua gagal → 404 { error: 'Tidak ditemukan' }.
```

Barcode tidak pernah lewat AI — kalau OFF tidak punya, baliknya ke user "coba scan label" daripada AI menebak dari nomor barcode yang tidak berarti apa-apa.

### Open Food Facts — bentuk yang dipakai

```
GET https://world.openfoodfacts.org/api/v2/product/{barcode}.json?fields=product_name,brands,nutriments,serving_size

nutriments.energy-kcal_100g, .proteins_100g, .carbohydrates_100g,
.fat_100g, .fiber_100g, .sodium_100g (gram, dikali 1000 jadi mg),
.sugars_100g
```

Konversi per-100g ke per-sajian pakai `serving_size` tercetak kalau ada (mis. "27g"); kalau tidak ada, tampilkan per-100g apa adanya dan tandai di UI.

**Catatan verifikasi:** Container dev sesi ini memblokir `world.openfoodfacts.org` (egress proxy 403) — bentuk response di atas diverifikasi lewat dokumentasi API, bukan panggilan langsung. Worker produksi tidak kena blokir ini; endpoint harus dites live setelah deploy, bukan diklaim beres dari sekarang.

### Rate limit & guard

OFF minta User-Agent yang jelas dan membatasi query search ke beberapa per detik per IP — lookup by barcode (bukan search) jauh lebih longgar, itu kenapa desain ini pakai barcode sebagai kunci, bukan pencarian nama ke OFF. Set header `User-Agent: AtomicHabitTools/1.0 (kontak via app)`.

---

## 4. Scan label — jebakan takaran saji

Panel *Informasi Nilai Gizi* Indonesia mencantumkan angka **per takaran saji**, dan satu kemasan sering berisi lebih dari satu sajian. Baca mentah lalu simpan sebagai "1 porsi" salah kalau user makan seluruh kemasan.

```typescript
const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    servingSize:      { type: 'string' },   // "27 g" tercetak
    servingsPerPack:   { type: 'number' },   // "Sajian per kemasan: 3"
    calories:  { type: 'number' },
    protein:   { type: 'number' },
    carbs:     { type: 'number' },
    fat:       { type: 'number' },
    saturatedFat: { type: 'number' },
    fiber:     { type: 'number' },
    sugar:     { type: 'number' },
    sodium:    { type: 'number' },  // mg
  },
  required: ['calories'],
};
```

`POST /api/food/scan-label` jalan seperti `quickadd.post('/receipt')` yang sudah ada: `guided_json` + `SCHEMA_MODEL`, cap ukuran gambar 6MB, validasi `data:image/` prefix.

Response mengembalikan **dua kolom angka** — per sajian (langsung dari label) dan per kemasan (dikali `servingsPerPack`, kalau ada) — plus insight (lihat §5). Frontend memaksa user memilih salah satu sebelum simpan ke log; default per sajian.

---

## 5. Insight %AKG

Dua acuan, sengaja tidak dicampur:

**ALG BPOM** (Peraturan BPOM No. 26/2021, dipakai untuk %AKG yang tercetak di kemasan — angka kita harus cocok dengan yang user baca sendiri di label):

```typescript
// Sumber: Peraturan BPOM No. 26/2021 ttg Informasi Nilai Gizi.
// Energi/protein/lemak-total/karbohidrat diverifikasi via pencarian web sesi ini.
// Lemak jenuh, gula, natrium DARI INGATAN MODEL — belum dicocokkan ke teks
// regulasi asli (jaringan sesi ini memblokir situs BPOM). Cross-check sebelum
// dipakai untuk klaim kesehatan; nilai konservatif dipilih di sisi aman.
export const ALG_UMUM = {
  calories: 2150,      // kkal — terverifikasi
  protein: 60,         // g — terverifikasi
  fat: 67,             // g — terverifikasi
  carbs: 325,          // g — terverifikasi
  saturatedFat: 20,    // g — BELUM TERVERIFIKASI
  sugar: 50,           // g — BELUM TERVERIFIKASI
  sodium: 1500,        // mg — BELUM TERVERIFIKASI
};
```

**Target pribadi** (`nutrition_targets` yang sudah ada) untuk "sisa kuota hari ini" — tidak berubah, dipakai apa adanya.

Insight yang dikembalikan bareng hasil scan-label / lookup:

```typescript
{
  percentAlg: { calories, protein, fat, carbs, saturatedFat, sugar, sodium },  // per sajian
  warnings: string[],   // "Natrium 35% ALG dalam satu sajian" — muncul kalau >20%
  suggestion: string,   // 1 kalimat AI, tahu sisa kalori hari ini dari nutrition_targets
}
```

`suggestion` dibuat lewat `runText` (bukan `runJson` — ini prosa pendek), prompt bawa sisa kuota kalori hari ini dan nama makanan, minta satu kalimat Bahasa Indonesia.

---

## 6. Frontend — `Nutrition.tsx`

Tiga elemen baru di atas form tambah makanan yang sudah ada:

- **Kotak cari** dengan debounce 300ms → `GET /api/food/search?q=`, tampilkan hasil dengan badge sumber (Terkurasi / Cache / -). Klik hasil → isi form.
- **Tombol `📷 Scan label`** — pola kamera + kompresi kanvas disalin dari `Garden.tsx` (`FileReader` → `canvas.toDataURL('image/jpeg', 0.7)`). Kirim ke `/api/food/scan-label`, tampilkan dua opsi (per sajian/per kemasan) + insight sebelum user tekan simpan.
- **Tombol `▮▮ Scan barcode`** — `BarcodeDetector` API bawaan browser (Chrome/Android, tanpa library). Deteksi tidak tersedia → tombol disembunyikan, hanya scan label yang tampil (feature-detect di mount, bukan UA-sniff).

`FoodLog` interface dapat field opsional `source?: string` untuk badge kecil di list ("perkiraan AI" dsb pada entri yang datang dari tier 4).

---

## 7. Verifikasi

- Backend: `tsc --noEmit` bersih.
- Frontend: `tsc -b` + `npm run build` bersih.
- Unit test resolver pakai fixture respons OFF (bentuk terdokumentasi, bukan panggilan live) — cek urutan tingkat 1→2→3→4 berhenti di match pertama.
- `sweep.js` light+dark untuk Nutrition.tsx setelah UI baru masuk.
- **Yang tidak bisa diuji di sesi ini:** panggilan live ke Open Food Facts (egress diblokir di container dev). Diverifikasi manual setelah deploy ke produksi dengan barcode produk asli — dicatat eksplisit di PR, tidak diklaim beres sebelum itu.

## Yang sengaja tidak dikerjakan

- **Fuzzy matching di kurasi lokal.** 50 entri, `includes()` cukup. Fuzzy search adalah over-engineering untuk daftar sekecil ini.
- **Endpoint insight harian menyeluruh** (pola makan sepanjang hari, saran besok). User pilih lingkup per-item saat brainstorming; ditunda ke iterasi berikutnya kalau dibutuhkan.
- **Pembersihan cache terjadwal.** TTL dicek at-read, cukup untuk volume yang diharapkan — tidak perlu cron baru.
