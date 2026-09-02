# Modul Ternak — Rencana Implementasi Gelombang 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modul Ternak yang bisa langsung dipakai — katalog ~65 spesies hewan Indonesia, kandang dan penghuninya, jadwal perawatan per spesies, push pengingat, dan layarnya.

**Architecture:** Katalog di-bundle sebagai TypeScript (`data/animals.ts`), bukan di-seed ke D1. Jadwal dihitung saat dibaca dari katalog + log terakhir + tabel override tipis — tidak ada penyalinan tugas saat hewan ditambah. Dua lapis: `ternak_kandang` memegang tugas wadah (ganti air, bersih, UVB), `ternak_hewan` memegang tugas per ekor (vaksin, cacing, timbang).

**Tech Stack:** Cloudflare Workers + Hono + D1 (SQLite) di backend, React + Vite + TypeScript di frontend, Vitest di keduanya.

**Spec:** `docs/superpowers/specs/2026-08-31-ternak-design.md`

## Global Constraints

Aturan repo ini. Melanggarnya merusak produksi, bukan cuma gaya.

- **Migrasi idempoten, tidak pernah `ALTER TABLE` atau `DROP`.** `db:migrate` dijalankan ulang tiap deploy. Pakai `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, dan `INSERT ... WHERE NOT EXISTS`.
- **Migrasi wajib didaftarkan di DUA skrip** `backend/package.json`: `db:migrate` dan `db:migrate:remote`. Lupa satu = tabelnya tidak pernah ada di produksi.
- **Aritmetika tanggal UTC saja.** `new Date(\`${d}T00:00:00Z\`)` dan `getUTC*`. Metode lokal (`getDate`, `setDate`) menggeser tanggal saat zona waktu runner berbeda, dan CI menjalankan seluruh tes ulang di `TZ=America/New_York`.
- **Tanggal "hari ini" selalu dari `jakartaToday()`** (`backend/src/lib/validate.ts`), tidak pernah `new Date().toISOString()`.
- **Setiap kueri membawa `user_id`.** Tulis dan hapus memverifikasi kepemilikan; sumber daya milik orang lain menghasilkan **404**, bukan 403.
- **Tabel milik pengguna wajib masuk `DATA_TABLES`** di `backend/src/routes/settings.ts`, atau ia tidak ikut ekspor dan backup.
- **Tidak ada `catch {}` diam pada aksi yang dipicu pengguna.** Kegagalan muat harus dibedakan tegas dari "belum ada data".
- **Tidak ada identifier model** (nama atau versi model AI) di pesan commit, judul/isi PR, komentar kode, atau artefak apa pun yang di-push.
- Commit diakhiri dua baris:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01Er6KAB3np4KofPhXQo3oFr`
- Kerjakan di branch `claude/cek-pending-cloudflare-deploy-kb4b07`. Jangan push ke branch lain.

## Struktur berkas

**Backend — dibuat:**

| Berkas | Tanggung jawab |
|---|---|
| `backend/src/data/animals.ts` | Katalog ~65 spesies + tipe `Animal`, `TugasKatalog` |
| `backend/src/data/animals.test.ts` | Uji sifat katalog |
| `backend/migrations/0040_ternak.sql` | Enam tabel |
| `backend/src/lib/ternak_jadwal.ts` | `jadwalSubjek()` — inti modul |
| `backend/src/lib/ternak_air.ts` | `nilaiAir()` — tes air vs rentang katalog |
| `backend/src/lib/ternak_kepadatan.ts` | `cekKepadatan()` |
| `backend/src/lib/ternak_biosekuriti.ts` | `statusKarantina()` |
| `backend/src/routes/ternak.ts` | CRUD kandang + hewan, ringkasan |
| `backend/src/routes/ternak_care.ts` | Log, jadwal, override tugas |
| `backend/src/routes/ternak_health.ts` | Ukur, air, kepadatan, karantina |
| `backend/src/routes/ternak_catalog.ts` | Baca katalog |
| `backend/src/routes/ternak_ai.ts` | Diagnosa + tanya |

**Backend — diubah:** `package.json` (2 skrip), `src/index.ts` (mount + 3 cron), `src/lib/settings_schema.ts` (4 setting), `src/lib/daily_alert.ts` (3 `AlertKind`), `src/routes/settings.ts` (6 `DATA_TABLES`), `src/routes/daily.ts` (`getTernakToday`), `src/routes/search.ts`, `src/lib/ai_context.ts`, `src/lib/agent_tools.ts`.

**Frontend — dibuat:** `src/screens/Ternak.tsx`, `src/screens/TernakAnimals.tsx`, `src/screens/TernakCatalog.tsx`, `src/screens/TernakHealth.tsx`.

**Frontend — diubah:** `src/App.tsx` (subScreen), `src/screens/More.tsx` (entri), `src/components/AiPanel.tsx` (union), `src/screens/Harian.tsx`, `src/screens/TutupHari.tsx`.

---

### Task 1: Tipe katalog + 8 spesies benih

Bukan 65 sekaligus. Bentuk datanya harus diuji dulu dengan sampel yang mewakili tiap golongan; menulis 65 entri sebelum bentuknya terbukti berarti 65 entri yang harus diedit ulang.

**Files:**
- Create: `backend/src/data/animals.ts`
- Test: `backend/src/data/animals.test.ts`

**Interfaces:**
- Consumes: tidak ada.
- Produces: `Animal`, `TugasKatalog`, `AnimalGroup`, `Habitat`, `Peran`, `Kesulitan`, `Sosial`, `ANIMALS: Animal[]`, `ANIMAL_BY_ID: Map<string, Animal>`.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `backend/src/data/animals.test.ts`:

```ts
/**
 * Uji sifat katalog, bukan kebenaran biologisnya.
 *
 * Interval cacingan dan umur ganti UVB tidak bisa dibuktikan lewat tes — sama
 * seperti umur panen di plants.test.ts. Yang bisa dan harus dijaga adalah
 * bentuknya: tidak ada id kembar, tidak ada hewan tanpa tugas, dan tidak ada
 * kolom keselamatan yang lupa diisi.
 */
import { describe, it, expect } from 'vitest';
import { ANIMALS, ANIMAL_BY_ID } from './animals';

describe('katalog hewan', () => {
  it('punya isi', () => {
    expect(ANIMALS.length).toBeGreaterThan(0);
  });

  it('id unik dan peta cocok dengan daftarnya', () => {
    const ids = ANIMALS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ANIMAL_BY_ID.size).toBe(ANIMALS.length);
    for (const a of ANIMALS) expect(ANIMAL_BY_ID.get(a.id)).toBe(a);
  });

  it('setiap hewan punya sekurangnya satu tugas', () => {
    for (const a of ANIMALS) {
      expect(a.tugas.length, `${a.id} tidak punya tugas`).toBeGreaterThan(0);
    }
  });

  it('kode tugas unik dalam satu hewan', () => {
    for (const a of ANIMALS) {
      const kode = a.tugas.map((t) => t.kode);
      expect(new Set(kode).size, `${a.id} punya kode tugas kembar`).toBe(kode.length);
    }
  });

  it('interval tugas positif dan mulaiHari tidak negatif', () => {
    for (const a of ANIMALS) {
      for (const t of a.tugas) {
        expect(t.tiapHari, `${a.id}/${t.kode}`).toBeGreaterThan(0);
        expect(t.mulaiHari, `${a.id}/${t.kode}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('setiap tugas menjelaskan caranya, bukan cuma menamainya', () => {
    for (const a of ANIMALS) {
      for (const t of a.tugas) {
        expect(t.cara.length, `${a.id}/${t.kode} terlalu pendek`).toBeGreaterThan(25);
      }
    }
  });

  it('tugas hanya bersasaran kandang atau hewan', () => {
    for (const a of ANIMALS) {
      for (const t of a.tugas) {
        expect(['kandang', 'hewan']).toContain(t.sasaran);
      }
    }
  });

  it('hewan air punya rentang pH, hewan darat tidak dipaksa punya', () => {
    for (const a of ANIMALS) {
      if (a.habitat === 'darat') continue;
      expect(a.phAir, `${a.id} tanpa phAir`).not.toBeNull();
      expect(a.phAir![0]).toBeLessThan(a.phAir![1]);
    }
  });

  it('hewan laut dan payau punya rentang salinitas', () => {
    for (const a of ANIMALS) {
      if (a.habitat !== 'air-laut' && a.habitat !== 'air-payau') continue;
      expect(a.salinitasPpt, `${a.id} tanpa salinitas`).not.toBeNull();
      expect(a.salinitasPpt![0]).toBeLessThan(a.salinitasPpt![1]);
    }
  });

  it('hewan air tawar tidak punya salinitas', () => {
    for (const a of ANIMALS) {
      if (a.habitat !== 'air-tawar') continue;
      expect(a.salinitasPpt, `${a.id} punya salinitas padahal air tawar`).toBeNull();
    }
  });

  it('umur hidup masuk akal', () => {
    for (const a of ANIMALS) {
      expect(a.umurTahun[0]).toBeGreaterThan(0);
      expect(a.umurTahun[0]).toBeLessThanOrEqual(a.umurTahun[1]);
    }
  });

  it('kolom keselamatan selalu hadir sebagai keputusan', () => {
    // null pun harus disengaja. `in` membedakan "sengaja null" dari "lupa".
    for (const a of ANIMALS) {
      expect('legal' in a, `${a.id} tanpa kolom legal`).toBe(true);
      expect('bahaya' in a, `${a.id} tanpa kolom bahaya`).toBe(true);
    }
  });

  it('semua golongan yang dijanjikan sudah terwakili', () => {
    const grup = new Set(ANIMALS.map((a) => a.grup));
    for (const g of ['mamalia', 'unggas', 'ikan-tawar', 'ikan-laut', 'reptil']) {
      expect(grup.has(g as never), `belum ada ${g}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/data/animals.test.ts`
Expected: FAIL — `Cannot find module './animals'`.

- [ ] **Step 3: Tulis `animals.ts` dengan tipe + 8 spesies**

Salin blok tipe dari spec (bagian "Katalog") apa adanya — `AnimalGroup`, `Habitat`, `Peran`, `Kesulitan`, `Sosial`, `TugasKatalog`, `Animal` — beserta seluruh komentarnya, lalu:

```ts
export const ANIMALS: Animal[] = [
  // ────────────────────────── MAMALIA ──────────────────────────
  {
    id: 'kucing-domestik',
    nama: 'Kucing domestik',
    latin: 'Felis catus',
    grup: 'mamalia',
    habitat: 'darat',
    emoji: '🐱',
    peran: 'peliharaan',
    umurTahun: [12, 18],
    dewasaBulan: 12,
    suhuC: null,
    phAir: null,
    salinitasPpt: null,
    ruangMinimal: 'Bebas di dalam rumah; kandang jepit hanya untuk transport.',
    pakan: 'Pakan kucing kering atau basah, protein hewani di atas 30%.',
    frekuensiPakan: '2-3 kali sehari untuk dewasa, sekenyangnya untuk anak.',
    sosial: 'sendiri',
    tugas: [
      {
        kode: 'vaksin',
        nama: 'Vaksin tahunan',
        tiapHari: 365,
        mulaiHari: 56,
        sasaran: 'hewan',
        cara: 'Vaksin tricat atau tetracat ke dokter hewan. Seri pertama umur 8-12 minggu, booster 3-4 minggu setelahnya, lalu ulang tiap tahun.',
        penting: true,
      },
      {
        kode: 'cacing',
        nama: 'Obat cacing',
        tiapHari: 90,
        mulaiHari: 42,
        sasaran: 'hewan',
        cara: 'Dosis mengikuti berat badan. Kucing yang keluar rumah lebih sering cacingan daripada yang di dalam terus.',
        penting: true,
      },
      {
        kode: 'kutu',
        nama: 'Obat kutu',
        tiapHari: 30,
        mulaiHari: 56,
        sasaran: 'hewan',
        cara: 'Spot-on di tengkuk, tempat yang tidak terjilat. Kutu membawa cacing pita, jadi keduanya sering datang bersamaan.',
        penting: false,
      },
      {
        kode: 'kuku',
        nama: 'Potong kuku',
        tiapHari: 21,
        mulaiHari: 60,
        sasaran: 'hewan',
        cara: 'Potong ujung bening saja; bagian merah muda di dalamnya berisi pembuluh darah dan saraf.',
        penting: false,
      },
      {
        kode: 'timbang',
        nama: 'Timbang berat',
        tiapHari: 30,
        mulaiHari: 7,
        sasaran: 'hewan',
        cara: 'Turun berat tanpa sebab adalah gejala paling awal ginjal dan tiroid bermasalah, jauh sebelum terlihat sakit.',
        penting: false,
      },
      {
        kode: 'litter',
        nama: 'Ganti pasir kotoran',
        tiapHari: 7,
        mulaiHari: 0,
        sasaran: 'kandang',
        cara: 'Buang gumpalan tiap hari, kuras dan cuci total tiap pekan. Kucing menahan buang air di litter kotor sampai jadi masalah saluran kemih.',
        penting: false,
      },
    ],
    penyakit: ['flu kucing', 'scabies', 'FIV', 'gagal ginjal kronis'],
    kesulitan: 'mudah',
    legal: null,
    bahaya: 'Cakaran bisa menularkan cat scratch disease. Kotorannya membawa toksoplasma — ibu hamil sebaiknya tidak membersihkan litter.',
    tips: 'Sterilisasi menurunkan risiko kanker dan menghentikan kebiasaan menyemprot penanda wilayah.',
  },
  // Tambahkan tujuh entri lagi dengan bentuk yang sama persis:
  //   'kelinci'        mamalia,   darat
  //   'ayam-kampung'   unggas,    darat, peran 'keduanya'
  //   'lovebird'       unggas,    darat
  //   'cupang'         ikan-tawar, air-tawar
  //   'koi'            ikan-tawar, air-tawar
  //   'ikan-badut'     ikan-laut,  air-laut  (salinitasPpt wajib)
  //   'kura-kura-brazil' reptil,   air-tawar
  //
  // Aturan yang harus dipenuhi tiap entri, dijaga oleh tes di atas:
  //   - kode tugas unik dalam satu hewan
  //   - `cara` lebih dari 25 karakter dan benar-benar menjelaskan caranya
  //   - habitat air wajib `phAir`, air tawar wajib `salinitasPpt: null`
  //   - `legal` dan `bahaya` selalu ditulis, null pun disengaja
];

/** Peta id ke hewan, supaya pencarian per id tidak menyapu seluruh larik. */
export const ANIMAL_BY_ID: Map<string, Animal> = new Map(ANIMALS.map((a) => [a.id, a]));
```

Isi wajib untuk tiga entri yang paling menentukan:

- **`kura-kura-brazil`** — tugas `uvb` dengan `tiapHari: 180`, `sasaran: 'kandang'`, `penting: true`, dan `cara` yang menyebut bahwa lampu UVB berhenti memancarkan UVB jauh sebelum lampunya mati, sehingga "masih menyala" bukan tanda ia masih bekerja. `bahaya` wajib menyebut salmonella. `legal` wajib menyebut statusnya sebagai spesies asing invasif.
- **`ikan-badut`** — `salinitasPpt: [33, 35]`, `phAir: [8.0, 8.4]`, tugas `ganti-air` bersasaran `kandang`, tugas `tes-air` bersasaran `kandang` dengan `tiapHari: 7`.
- **`ayam-kampung`** — `peran: 'keduanya'`, tugas `vaksin-nd` bersasaran `hewan`, tugas `bersih-kandang` bersasaran `kandang`.

- [ ] **Step 4: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/data/animals.test.ts`
Expected: PASS, 13 tes.

- [ ] **Step 5: Periksa tipe**

Run: `cd backend && npm run typecheck`
Expected: keluaran kosong (dua perintah `tsc` lolos tanpa galat).

- [ ] **Step 6: Commit**

```bash
git add backend/src/data/animals.ts backend/src/data/animals.test.ts
git commit -m "feat(ternak): tipe katalog hewan + delapan spesies benih

Bentuk datanya diuji lebih dulu dengan sampel yang mewakili tiap golongan —
mamalia, unggas, ikan tawar, ikan laut, dan reptil. Menulis enam puluh lima
entri sebelum bentuknya terbukti berarti enam puluh lima entri yang harus
diedit ulang.

Dua kolom yang tidak ada di katalog tanaman: legal dan bahaya. Sugar glider
dan sebagian kura-kura butuh izin, dan kura-kura brazil membawa salmonella
yang relevan di rumah berisi anak kecil. Keduanya selalu ditulis eksplisit,
null pun disengaja, sama seperti kolom toxic pada tanaman hias.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Er6KAB3np4KofPhXQo3oFr"
```

---

### Task 2: Migrasi 0040

**Files:**
- Create: `backend/migrations/0040_ternak.sql`
- Modify: `backend/package.json` (dua skrip), `backend/src/routes/settings.ts` (`DATA_TABLES`)

**Interfaces:**
- Consumes: tidak ada.
- Produces: tabel `ternak_kandang`, `ternak_hewan`, `ternak_log`, `ternak_tugas_ubah`, `ternak_ukur`, `ternak_air` — dipakai seluruh task rute.

- [ ] **Step 1: Tulis migrasi**

Buat `backend/migrations/0040_ternak.sql`:

```sql
-- Modul Ternak: kandang, penghuni, dan perawatannya.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE.

-- #1 Wadah: akuarium, kandang, kolam, atau umbaran.
--
-- Ada sebagai baris tersendiri karena sebagian tugas menempel pada wadah,
-- bukan pada penghuninya. Satu akuarium berisi delapan guppy adalah satu
-- pekerjaan ganti air, bukan delapan.
CREATE TABLE IF NOT EXISTS ternak_kandang (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  jenis TEXT NOT NULL,                      -- akuarium | kandang | kolam | umbaran
  habitat TEXT NOT NULL,                    -- darat | air-tawar | air-payau | air-laut
  volume_liter REAL,
  lokasi TEXT,
  tanggal_mulai TEXT NOT NULL,              -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'aktif',     -- aktif | nonaktif
  catatan TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ternak_kandang_user ON ternak_kandang(user_id, status);

-- #2 Penghuni.
--
-- kandang_id boleh NULL: kucing rumahan tidak berkandang, dan memaksanya
-- punya "kandang bernama Rumah" adalah baris palsu yang harus dijelaskan di
-- setiap layar.
--
-- animal_id boleh NULL: hewan di luar katalog tetap boleh dicatat, ia hanya
-- tidak punya jadwal otomatis — sama dengan tanaman non-katalog di kebun.
--
-- jumlah > 1 berarti satu baris mewakili sekelompok hewan sejenis (tiga puluh
-- lele di satu kolam). Untuk baris seperti itu, ternak_ukur adalah pengukuran
-- CONTOH, bukan sensus.
CREATE TABLE IF NOT EXISTS ternak_hewan (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kandang_id TEXT REFERENCES ternak_kandang(id) ON DELETE SET NULL,
  animal_id TEXT,
  nama_kustom TEXT,
  nama_panggilan TEXT,
  jumlah INTEGER NOT NULL DEFAULT 1,
  kelamin TEXT,                             -- jantan | betina | campur | tidak-tahu
  tanggal_lahir TEXT,
  tanggal_masuk TEXT NOT NULL,
  asal TEXT,
  -- Hewan yang mati atau dilepas berhenti dijadwalkan, tapi barisnya tidak
  -- dihapus: riwayat perawatannya satu-satunya bahan untuk tahu apa yang salah.
  status TEXT NOT NULL DEFAULT 'hidup',     -- hidup | mati | dilepas | dijual
  catatan TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ternak_hewan_user ON ternak_hewan(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ternak_hewan_kandang ON ternak_hewan(kandang_id);

-- #3 Satu tindakan perawatan yang benar-benar dikerjakan.
CREATE TABLE IF NOT EXISTS ternak_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subjek_tipe TEXT NOT NULL,                -- kandang | hewan
  subjek_id TEXT NOT NULL,
  kode_tugas TEXT NOT NULL,
  tanggal TEXT NOT NULL,
  -- Angka opsional yang menyertai tindakan: gram pakan, persen air diganti.
  nilai REAL,
  catatan TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ternak_log_subjek
  ON ternak_log(subjek_id, kode_tugas, tanggal DESC);
CREATE INDEX IF NOT EXISTS idx_ternak_log_user ON ternak_log(user_id, tanggal DESC);

-- #4 Penyimpangan dari katalog.
--
-- Baris di sini HANYA ada kalau pengguna benar-benar mengubah sesuatu. Tidak
-- ada penyalinan tugas saat hewan ditambah, dan itu yang membuat perbaikan
-- katalog langsung sampai ke semua orang alih-alih menyisakan setiap hewan
-- yang sudah terdaftar dengan angka lama.
--
-- kode_tugas yang tidak ada di katalog berarti tugas custom milik subjek ini
-- sendiri; nama_kustom dan cara_kustom wajib terisi untuk baris seperti itu.
CREATE TABLE IF NOT EXISTS ternak_tugas_ubah (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subjek_tipe TEXT NOT NULL,
  subjek_id TEXT NOT NULL,
  kode_tugas TEXT NOT NULL,
  tiap_hari INTEGER,                        -- NULL = ikut katalog
  nonaktif INTEGER NOT NULL DEFAULT 0,
  nama_kustom TEXT,
  cara_kustom TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (subjek_tipe, subjek_id, kode_tugas)
);
CREATE INDEX IF NOT EXISTS idx_ternak_tugas_ubah_user ON ternak_tugas_ubah(user_id);

-- #5 Pertumbuhan.
CREATE TABLE IF NOT EXISTS ternak_ukur (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hewan_id TEXT NOT NULL REFERENCES ternak_hewan(id) ON DELETE CASCADE,
  tanggal TEXT NOT NULL,
  berat_gram REAL,
  panjang_cm REAL,
  catatan TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ternak_ukur_hewan ON ternak_ukur(hewan_id, tanggal);

-- #6 Tes air.
--
-- Dipisah dari ternak_log karena ia pengukuran bermatra banyak, bukan
-- tindakan. Menumpangkannya ke kolom `nilai` tunggal akan memaksa enam baris
-- untuk satu kali tes air.
CREATE TABLE IF NOT EXISTS ternak_air (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kandang_id TEXT NOT NULL REFERENCES ternak_kandang(id) ON DELETE CASCADE,
  tanggal TEXT NOT NULL,
  suhu_c REAL,
  ph REAL,
  amonia_ppm REAL,
  nitrit_ppm REAL,
  nitrat_ppm REAL,
  salinitas_ppt REAL,
  catatan TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ternak_air_kandang ON ternak_air(kandang_id, tanggal DESC);
```

- [ ] **Step 2: Daftarkan migrasi di dua skrip**

Di `backend/package.json`, tambahkan di **ujung** nilai `db:migrate` dan `db:migrate:remote` (keduanya, jangan salah satu):

```
 && wrangler d1 execute fayolla-db --local --file=./migrations/0040_ternak.sql
```

untuk `db:migrate`, dan untuk `db:migrate:remote`:

```
 && wrangler d1 execute fayolla-db --remote --file=./migrations/0040_ternak.sql
```

Verifikasi: `grep -c "0040_ternak" backend/package.json` harus mengeluarkan `2`.

- [ ] **Step 3: Daftarkan enam tabel ke DATA_TABLES**

Di `backend/src/routes/settings.ts`, tepat setelah baris `garden_measurement`:

```ts
  { table: 'ternak_kandang', label: 'Kandang & akuarium', group: 'Ternak', userScoped: true },
  { table: 'ternak_hewan', label: 'Hewan', group: 'Ternak', userScoped: true },
  { table: 'ternak_log', label: 'Log perawatan ternak', group: 'Ternak', userScoped: true },
  { table: 'ternak_tugas_ubah', label: 'Penyesuaian jadwal ternak', group: 'Ternak', userScoped: true },
  { table: 'ternak_ukur', label: 'Ukuran & berat hewan', group: 'Ternak', userScoped: true },
  { table: 'ternak_air', label: 'Hasil tes air', group: 'Ternak', userScoped: true },
```

- [ ] **Step 4: Buktikan idempoten dan tidak ada ALTER/DROP**

Run:

```bash
cd backend && grep -nE "^\s*(ALTER|DROP)" migrations/0040_ternak.sql
```

Expected: tidak ada keluaran (grep keluar dengan kode 1).

Lalu terapkan seluruh migrasi sekali, dan 0040 tiga kali lagi di atas skema penuh:

```bash
cd backend && node -e "
const {DatabaseSync}=require('node:sqlite');
const fs=require('fs');
const db=new DatabaseSync(':memory:');
const files=fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort();
for(const f of files){ try{ db.exec(fs.readFileSync('migrations/'+f,'utf8')); }catch(e){} }
for(let pass=2;pass<=4;pass++){
  try{ db.exec(fs.readFileSync('migrations/0040_ternak.sql','utf8')); }
  catch(e){ console.log('GAGAL pass',pass,e.message); process.exit(1); }
}
for (const t of ['ternak_kandang','ternak_hewan','ternak_log','ternak_tugas_ubah','ternak_ukur','ternak_air']) {
  db.prepare('SELECT COUNT(*) n FROM '+t).get();
}
console.log('0040 idempoten 3x ulang, enam tabel ada');
"
```

Expected: `0040 idempoten 3x ulang, enam tabel ada`.

- [ ] **Step 5: Jalankan seluruh tes backend**

Run: `cd backend && npx vitest run`
Expected: semua lolos. Harness `createTestDb` menjalankan setiap berkas migrasi pada tiap tes, jadi migrasi yang rusak akan menjatuhkan puluhan berkas tes sekaligus.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/0040_ternak.sql backend/package.json backend/src/routes/settings.ts
git commit -m "feat(ternak): migrasi 0040 — kandang, hewan, log, override, ukur, air

Enam tabel, idempoten, tanpa ALTER maupun DROP, terdaftar di kedua skrip
migrasi.

Dua bentuk yang sengaja dipilih dan alasannya ada di komentar berkasnya:
kandang_id boleh NULL karena kucing rumahan tidak berkandang, dan
ternak_tugas_ubah hanya berisi baris yang benar-benar diubah pengguna —
tidak ada penyalinan tugas saat hewan ditambah, sehingga katalog yang
diperbaiki langsung sampai ke semua orang.

ternak_air dipisah dari ternak_log karena ia pengukuran bermatra banyak,
bukan tindakan; menumpangkannya ke satu kolom nilai akan memaksa enam baris
untuk satu kali tes air.

Keenam tabel masuk DATA_TABLES supaya ikut ekspor dan backup sejak hari
pertama.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Er6KAB3np4KofPhXQo3oFr"
```

---

### Task 3: `ternak_jadwal.ts` — inti modul

**Files:**
- Create: `backend/src/lib/ternak_jadwal.ts`
- Test: `backend/src/lib/ternak_jadwal.test.ts`

**Interfaces:**
- Consumes: `TugasKatalog` dari `../data/animals` (Task 1).
- Produces: `Subjek`, `Ubahan`, `TugasJatuhTempo`, `jadwalSubjek(subjek, tugasKatalog, ubahan, terakhir, hariIni): TugasJatuhTempo[]` — dipakai Task 5, 6, 7.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `backend/src/lib/ternak_jadwal.test.ts`:

```ts
/**
 * Uji inti penjadwalan ternak.
 *
 * Yang paling menentukan di sini bukan aritmetika tanggalnya, melainkan
 * penyaringan sasaran: tugas ganti air milik akuarium, bukan milik tiap ikan
 * di dalamnya.
 */
import { describe, it, expect } from 'vitest';
import { jadwalSubjek, type Subjek, type Ubahan } from './ternak_jadwal';
import type { TugasKatalog } from '../data/animals';

const HARI_INI = '2026-06-01';

const tugasGantiAir: TugasKatalog = {
  kode: 'ganti-air',
  nama: 'Ganti air 25%',
  tiapHari: 7,
  mulaiHari: 7,
  sasaran: 'kandang',
  cara: 'Sedot 25% air dasar dengan selang, ganti air baru yang sudah diendapkan.',
  penting: true,
};

const tugasVaksin: TugasKatalog = {
  kode: 'vaksin',
  nama: 'Vaksin tahunan',
  tiapHari: 365,
  mulaiHari: 56,
  sasaran: 'hewan',
  cara: 'Ke dokter hewan. Seri pertama umur delapan sampai dua belas minggu.',
  penting: true,
};

const KATALOG = [tugasGantiAir, tugasVaksin];

function subjek(over: Partial<Subjek> = {}): Subjek {
  return {
    tipe: 'hewan', id: 'h1', nama: 'Guppy',
    animalId: 'guppy', mulai: '2026-01-01', ...over,
  };
}

describe('penyaringan sasaran', () => {
  it('jadwal kandang hanya memuat tugas bersasaran kandang', () => {
    const hasil = jadwalSubjek(
      subjek({ tipe: 'kandang', id: 'k1', nama: 'Akuarium depan' }),
      KATALOG, [], new Map(), HARI_INI
    );
    expect(hasil.map((t) => t.kodeTugas)).toEqual(['ganti-air']);
  });

  it('jadwal hewan hanya memuat tugas bersasaran hewan', () => {
    const hasil = jadwalSubjek(subjek(), KATALOG, [], new Map(), HARI_INI);
    expect(hasil.map((t) => t.kodeTugas)).toEqual(['vaksin']);
  });
});

describe('tanggal jatuh tempo', () => {
  it('tugas pertama dihitung dari mulai + mulaiHari, bukan + tiapHari', () => {
    const hasil = jadwalSubjek(subjek(), [tugasVaksin], [], new Map(), HARI_INI);
    expect(hasil[0].berikutnya).toBe('2026-02-26');
  });

  it('sesudah pernah dikerjakan, dihitung dari log terakhir + interval', () => {
    const hasil = jadwalSubjek(
      subjek(), [tugasVaksin], [], new Map([['vaksin', '2026-05-01']]), HARI_INI
    );
    expect(hasil[0].berikutnya).toBe('2027-05-01');
    expect(hasil[0].telat).toBe(0);
  });

  it('telat dihitung dalam hari penuh', () => {
    const hasil = jadwalSubjek(
      subjek({ tipe: 'kandang' }), [tugasGantiAir], [],
      new Map([['ganti-air', '2026-05-20']]), HARI_INI
    );
    expect(hasil[0].berikutnya).toBe('2026-05-27');
    expect(hasil[0].telat).toBe(5);
  });

  it('tepat pada hari jatuh tempo belum dihitung telat', () => {
    const hasil = jadwalSubjek(
      subjek({ tipe: 'kandang' }), [tugasGantiAir], [],
      new Map([['ganti-air', '2026-05-25']]), HARI_INI
    );
    expect(hasil[0].berikutnya).toBe('2026-06-01');
    expect(hasil[0].telat).toBe(0);
  });
});

describe('hewan di luar katalog', () => {
  it('animalId null menghasilkan daftar kosong, bukan melempar', () => {
    const hasil = jadwalSubjek(
      subjek({ animalId: null }), KATALOG, [], new Map(), HARI_INI
    );
    expect(hasil).toEqual([]);
  });
});

describe('override', () => {
  it('tiapHari dari ubahan mengalahkan katalog', () => {
    const ubahan: Ubahan[] = [{
      kodeTugas: 'vaksin', tiapHari: 180, nonaktif: false,
      namaKustom: null, caraKustom: null,
    }];
    const hasil = jadwalSubjek(
      subjek(), [tugasVaksin], ubahan, new Map([['vaksin', '2026-01-01']]), HARI_INI
    );
    expect(hasil[0].berikutnya).toBe('2026-06-30');
    expect(hasil[0].sumberInterval).toBe('ubahan');
  });

  it('tiapHari null pada ubahan tetap memakai interval katalog', () => {
    const ubahan: Ubahan[] = [{
      kodeTugas: 'vaksin', tiapHari: null, nonaktif: false,
      namaKustom: 'Vaksin dari drh. Rina', caraKustom: null,
    }];
    const hasil = jadwalSubjek(
      subjek(), [tugasVaksin], ubahan, new Map([['vaksin', '2026-01-01']]), HARI_INI
    );
    expect(hasil[0].berikutnya).toBe('2027-01-01');
    expect(hasil[0].sumberInterval).toBe('katalog');
    expect(hasil[0].labelTugas).toBe('Vaksin dari drh. Rina');
  });

  it('nonaktif menghilangkan tugas dari jadwal', () => {
    const ubahan: Ubahan[] = [{
      kodeTugas: 'vaksin', tiapHari: null, nonaktif: true,
      namaKustom: null, caraKustom: null,
    }];
    expect(jadwalSubjek(subjek(), [tugasVaksin], ubahan, new Map(), HARI_INI)).toEqual([]);
  });

  it('caraKustom mengalahkan cara katalog', () => {
    const ubahan: Ubahan[] = [{
      kodeTugas: 'vaksin', tiapHari: null, nonaktif: false,
      namaKustom: null, caraKustom: 'Bawa ke klinik depan pasar, buka Sabtu pagi.',
    }];
    const hasil = jadwalSubjek(subjek(), [tugasVaksin], ubahan, new Map(), HARI_INI);
    expect(hasil[0].cara).toBe('Bawa ke klinik depan pasar, buka Sabtu pagi.');
  });
});

describe('tugas custom', () => {
  it('ubahan dengan kode di luar katalog jadi tugas tambahan', () => {
    const ubahan: Ubahan[] = [{
      kodeTugas: 'obat-pasca-operasi', tiapHari: 1, nonaktif: false,
      namaKustom: 'Antibiotik pasca steril',
      caraKustom: 'Setengah tablet pagi, dicampur pakan basah.',
    }];
    const hasil = jadwalSubjek(subjek(), [tugasVaksin], ubahan, new Map(), HARI_INI);
    expect(hasil.map((t) => t.kodeTugas).sort()).toEqual(['obat-pasca-operasi', 'vaksin']);
    const custom = hasil.find((t) => t.kodeTugas === 'obat-pasca-operasi')!;
    expect(custom.labelTugas).toBe('Antibiotik pasca steril');
    expect(custom.penting).toBe(false);
  });

  it('tugas custom tanpa tiapHari diabaikan, bukan dijadwalkan tiap nol hari', () => {
    const ubahan: Ubahan[] = [{
      kodeTugas: 'entah', tiapHari: null, nonaktif: false,
      namaKustom: 'Entah', caraKustom: null,
    }];
    expect(jadwalSubjek(subjek(), [], ubahan, new Map(), HARI_INI)).toEqual([]);
  });
});

describe('urutan', () => {
  it('yang paling telat lebih dulu', () => {
    const hasil = jadwalSubjek(
      subjek({ tipe: 'kandang' }),
      [tugasGantiAir, { ...tugasGantiAir, kode: 'sikat', nama: 'Sikat kaca', tiapHari: 30 }],
      [],
      new Map([['ganti-air', '2026-05-28'], ['sikat', '2026-01-01']]),
      HARI_INI
    );
    expect(hasil[0].kodeTugas).toBe('sikat');
  });
});

describe('kekebalan zona waktu', () => {
  it('hasilnya sama walau tanggalnya melintasi awal bulan', () => {
    const hasil = jadwalSubjek(
      subjek({ tipe: 'kandang' }), [tugasGantiAir], [],
      new Map([['ganti-air', '2026-02-25']]), '2026-03-04'
    );
    expect(hasil[0].berikutnya).toBe('2026-03-04');
    expect(hasil[0].telat).toBe(0);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/lib/ternak_jadwal.test.ts`
Expected: FAIL — `Cannot find module './ternak_jadwal'`.

- [ ] **Step 3: Tulis implementasinya**

Buat `backend/src/lib/ternak_jadwal.ts`:

```ts
/**
 * Jadwal perawatan ternak: katalog + penyimpangan + riwayat, jadi satu daftar.
 *
 * Berbeda dari kebun, jenis tugasnya berbeda per spesies dan bukan cuma
 * intervalnya. Karena itu daftar tugas datang dari katalog, dan berkas ini
 * yang menentukan kapan tiap tugas jatuh tempo.
 *
 * Aturan yang paling menentukan ada di penyaringan `sasaran`: tugas ganti air
 * milik akuariumnya, bukan milik tiap ikan di dalamnya. Tanpa itu, satu
 * akuarium berisi delapan guppy akan menagih pekerjaan yang sama delapan kali,
 * dan daftar yang menagih pekerjaan hantu akan berhenti dibaca.
 */

import type { TugasKatalog } from '../data/animals';

export interface Subjek {
  tipe: 'kandang' | 'hewan';
  id: string;
  nama: string;
  /** Slug katalog; null untuk yang di luar katalog. */
  animalId: string | null;
  /** tanggal_masuk untuk hewan, tanggal_mulai untuk kandang. */
  mulai: string;
}

export interface Ubahan {
  kodeTugas: string;
  /** null = ikut interval katalog. */
  tiapHari: number | null;
  nonaktif: boolean;
  namaKustom: string | null;
  caraKustom: string | null;
}

export interface TugasJatuhTempo {
  subjekTipe: 'kandang' | 'hewan';
  subjekId: string;
  nama: string;
  kodeTugas: string;
  labelTugas: string;
  cara: string;
  penting: boolean;
  berikutnya: string;
  /** Hari terlewat dari jatuh tempo; 0 bila belum. */
  telat: number;
  sumberInterval: 'katalog' | 'ubahan';
}

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
 * Daftar tugas jatuh tempo untuk satu kandang atau satu hewan.
 *
 * `terakhir` memetakan kode tugas ke tanggal log terakhirnya. Kode yang tidak
 * ada di peta berarti tugas itu belum pernah dikerjakan sama sekali, dan
 * hitungannya jatuh ke `mulai + mulaiHari` — bukan `mulai + tiapHari`. Anak
 * kucing umur tiga minggu belum boleh divaksin, dan menagihnya di hari ia
 * dicatat adalah saran yang salah secara medis.
 */
export function jadwalSubjek(
  subjek: Subjek,
  tugasKatalog: TugasKatalog[],
  ubahan: Ubahan[],
  terakhir: Map<string, string>,
  hariIni: string
): TugasJatuhTempo[] {
  const ubahanPer = new Map(ubahan.map((u) => [u.kodeTugas, u]));
  const hasil: TugasJatuhTempo[] = [];

  // Hewan di luar katalog tidak punya interval yang bisa dipakai, jadi tidak
  // dijadwalkan — bukan dijadwalkan dengan angka tebakan. Tugas custom-nya
  // tetap berlaku: itu angka yang ditulis penggunanya sendiri.
  const dariKatalog = subjek.animalId
    ? tugasKatalog.filter((t) => t.sasaran === subjek.tipe)
    : [];

  for (const t of dariKatalog) {
    const u = ubahanPer.get(t.kode);
    if (u?.nonaktif) continue;

    const tiapHari = u?.tiapHari ?? t.tiapHari;
    const last = terakhir.get(t.kode) ?? null;
    const berikutnya = last ? geser(last, tiapHari) : geser(subjek.mulai, t.mulaiHari);

    hasil.push({
      subjekTipe: subjek.tipe,
      subjekId: subjek.id,
      nama: subjek.nama,
      kodeTugas: t.kode,
      labelTugas: u?.namaKustom ?? t.nama,
      cara: u?.caraKustom ?? t.cara,
      penting: t.penting,
      berikutnya,
      telat: Math.max(0, selisihHari(berikutnya, hariIni)),
      sumberInterval: u?.tiapHari != null ? 'ubahan' : 'katalog',
    });
  }

  // Tugas yang tidak ada di katalog sama sekali: milik subjek ini sendiri,
  // seperti antibiotik pasca operasi. Tanpa interval ia bukan jadwal, jadi
  // dilewati alih-alih ditagih tiap nol hari.
  const kodeKatalog = new Set(dariKatalog.map((t) => t.kode));
  for (const u of ubahan) {
    if (kodeKatalog.has(u.kodeTugas) || u.nonaktif) continue;
    if (u.tiapHari == null || u.tiapHari <= 0) continue;

    const last = terakhir.get(u.kodeTugas) ?? null;
    const berikutnya = last ? geser(last, u.tiapHari) : geser(subjek.mulai, u.tiapHari);

    hasil.push({
      subjekTipe: subjek.tipe,
      subjekId: subjek.id,
      nama: subjek.nama,
      kodeTugas: u.kodeTugas,
      labelTugas: u.namaKustom ?? u.kodeTugas,
      cara: u.caraKustom ?? '',
      // Tugas buatan pengguna tidak pernah otomatis dianggap kritis; hanya
      // katalog yang boleh menandai sesuatu sebagai penting.
      penting: false,
      berikutnya,
      telat: Math.max(0, selisihHari(berikutnya, hariIni)),
      sumberInterval: 'ubahan',
    });
  }

  return hasil.sort(
    (a, b) => b.telat - a.telat || a.berikutnya.localeCompare(b.berikutnya)
  );
}
```

- [ ] **Step 4: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/lib/ternak_jadwal.test.ts`
Expected: PASS, 15 tes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/ternak_jadwal.ts backend/src/lib/ternak_jadwal.test.ts
git commit -m "feat(ternak): jadwal perawatan dari katalog, override, dan riwayat

Inti modulnya. Tiga sumber digabung jadi satu daftar jatuh tempo: daftar tugas
per spesies dari katalog, penyimpangan yang ditulis pengguna, dan tanggal log
terakhir tiap tugas.

Aturan yang paling menentukan adalah penyaringan sasaran: tugas ganti air
milik akuariumnya, bukan milik tiap ikan di dalamnya. Tanpa itu satu akuarium
berisi delapan guppy menagih pekerjaan yang sama delapan kali, dan daftar yang
menagih pekerjaan hantu akan berhenti dibaca.

Tugas yang belum pernah dikerjakan dihitung dari tanggal masuk plus mulaiHari,
bukan plus interval ulangnya. Anak kucing umur tiga minggu belum boleh
divaksin, dan menagihnya di hari ia dicatat adalah saran yang salah secara
medis.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Er6KAB3np4KofPhXQo3oFr"
```

---

### Task 4: Tiga pustaka penilai — air, kepadatan, karantina

Ketiganya kecil dan berdiri sendiri, tapi keduanya-tiganya menangkap hal yang **tidak akan pernah tertangkap oleh tugas terjadwal**: air beracun, kandang sesak, dan penyakit yang masuk bersama hewan baru.

**Files:**
- Create: `backend/src/lib/ternak_air.ts`, `backend/src/lib/ternak_kepadatan.ts`, `backend/src/lib/ternak_biosekuriti.ts`
- Test: `backend/src/lib/ternak_air.test.ts`, `backend/src/lib/ternak_kepadatan.test.ts`, `backend/src/lib/ternak_biosekuriti.test.ts`

**Interfaces:**
- Consumes: `Animal` dari `../data/animals` (Task 1).
- Produces:
  - `nilaiAir(hasil: HasilAir, animal: Animal | null): PenilaianAir[]`
  - `HasilAir = { suhuC, ph, amoniaPpm, nitritPpm, nitratPpm, salinitasPpt }` (semua `number | null`)
  - `PenilaianAir = { parameter, nilai, status: 'aman'|'waspada'|'bahaya', saran }`
  - `cekKepadatan(volumeLiter: number | null, penghuni: Penghuni[]): Kepadatan | null`
  - `Penghuni = { animalId: string | null; jumlah: number; literPerEkor: number | null }`
  - `Kepadatan = { butuhLiter: number; tersedia: number; kelebihan: number; sesak: boolean }`
  - `HARI_KARANTINA = 14`, `statusKarantina(tanggalMasuk, hariIni, punyaTemanSekandang): Karantina | null`
  - `Karantina = { selesai: string; sisaHari: number; aman: boolean }`

- [ ] **Step 1: Tulis tes `ternak_air.test.ts`**

```ts
/**
 * Uji penilaian air.
 *
 * Satu aturan di sini tidak boleh pernah lunak: amonia di atas nol selalu
 * bahaya, untuk semua habitat. Tidak ada kadar amonia yang aman, dan itu
 * penyebab kematian ikan nomor satu di akuarium yang belum matang siklus
 * nitrogennya.
 */
import { describe, it, expect } from 'vitest';
import { nilaiAir, type HasilAir } from './ternak_air';
import type { Animal } from '../data/animals';

const ikanTawar = {
  id: 'koi', habitat: 'air-tawar', suhuC: [20, 28], phAir: [7.0, 8.5], salinitasPpt: null,
} as unknown as Animal;

const ikanLaut = {
  id: 'ikan-badut', habitat: 'air-laut', suhuC: [24, 28], phAir: [8.0, 8.4], salinitasPpt: [33, 35],
} as unknown as Animal;

const kosong: HasilAir = {
  suhuC: null, ph: null, amoniaPpm: null, nitritPpm: null, nitratPpm: null, salinitasPpt: null,
};

const cari = (r: ReturnType<typeof nilaiAir>, p: string) => r.find((x) => x.parameter === p);

describe('amonia', () => {
  it('di atas nol selalu bahaya, air tawar maupun laut', () => {
    for (const a of [ikanTawar, ikanLaut]) {
      const r = nilaiAir({ ...kosong, amoniaPpm: 0.25 }, a);
      expect(cari(r, 'amonia')!.status).toBe('bahaya');
    }
  });

  it('nol persis dinilai aman', () => {
    const r = nilaiAir({ ...kosong, amoniaPpm: 0 }, ikanTawar);
    expect(cari(r, 'amonia')!.status).toBe('aman');
  });
});

describe('nitrit dan nitrat', () => {
  it('nitrit di atas nol bahaya', () => {
    const r = nilaiAir({ ...kosong, nitritPpm: 0.5 }, ikanTawar);
    expect(cari(r, 'nitrit')!.status).toBe('bahaya');
  });

  it('nitrat tinggi cuma waspada, bukan bahaya', () => {
    // Nitrat adalah ujung siklus nitrogen dan ditoleransi jauh lebih tinggi;
    // menyamakannya dengan amonia membuat peringatan bahaya kehilangan arti.
    const r = nilaiAir({ ...kosong, nitratPpm: 60 }, ikanTawar);
    expect(cari(r, 'nitrat')!.status).toBe('waspada');
  });
});

describe('rentang katalog', () => {
  it('pH di dalam rentang aman, di luar rentang waspada', () => {
    expect(cari(nilaiAir({ ...kosong, ph: 7.5 }, ikanTawar), 'pH')!.status).toBe('aman');
    expect(cari(nilaiAir({ ...kosong, ph: 6.0 }, ikanTawar), 'pH')!.status).toBe('waspada');
  });

  it('suhu di luar rentang waspada', () => {
    expect(cari(nilaiAir({ ...kosong, suhuC: 32 }, ikanTawar), 'suhu')!.status).toBe('waspada');
  });

  it('salinitas dinilai hanya bila katalog menyebutnya', () => {
    expect(cari(nilaiAir({ ...kosong, salinitasPpt: 34 }, ikanLaut), 'salinitas')!.status).toBe('aman');
    expect(cari(nilaiAir({ ...kosong, salinitasPpt: 20 }, ikanLaut), 'salinitas')!.status).toBe('waspada');
    expect(cari(nilaiAir({ ...kosong, salinitasPpt: 34 }, ikanTawar), 'salinitas')).toBeUndefined();
  });
});

describe('data yang tidak ada', () => {
  it('parameter kosong tidak dinilai sama sekali', () => {
    expect(nilaiAir(kosong, ikanTawar)).toEqual([]);
  });

  it('tanpa katalog, amonia dan nitrit tetap dinilai', () => {
    // Ambangnya nol dan berlaku universal, jadi ia tidak butuh katalog.
    // pH dan suhu butuh rentang, jadi keduanya dilewati.
    const r = nilaiAir({ ...kosong, amoniaPpm: 1, ph: 6 }, null);
    expect(cari(r, 'amonia')!.status).toBe('bahaya');
    expect(cari(r, 'pH')).toBeUndefined();
  });
});

describe('saran', () => {
  it('setiap temuan membawa saran yang bisa dikerjakan', () => {
    const r = nilaiAir({ ...kosong, amoniaPpm: 1, nitritPpm: 1, ph: 5, suhuC: 35 }, ikanTawar);
    for (const p of r) {
      if (p.status === 'aman') continue;
      expect(p.saran.length, p.parameter).toBeGreaterThan(20);
    }
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/lib/ternak_air.test.ts`
Expected: FAIL — modul tidak ada.

- [ ] **Step 3: Tulis `ternak_air.ts`**

```ts
/**
 * Menilai hasil tes air terhadap rentang katalog.
 *
 * Satu aturan di sini tidak pernah lunak dan tidak butuh katalog: amonia di
 * atas nol selalu bahaya. Tidak ada kadar amonia yang aman bagi ikan mana pun,
 * dan itu penyebab kematian nomor satu di akuarium yang belum matang siklus
 * nitrogennya — biasanya beberapa hari setelah ikannya dimasukkan, saat
 * pemiliknya mengira semuanya berjalan baik.
 */

import type { Animal } from '../data/animals';

export interface HasilAir {
  suhuC: number | null;
  ph: number | null;
  amoniaPpm: number | null;
  nitritPpm: number | null;
  nitratPpm: number | null;
  salinitasPpt: number | null;
}

export type StatusAir = 'aman' | 'waspada' | 'bahaya';

export interface PenilaianAir {
  parameter: string;
  nilai: number;
  status: StatusAir;
  saran: string;
}

/** Nitrat ditoleransi jauh lebih tinggi daripada amonia dan nitrit. */
const NITRAT_WASPADA = 40;

/**
 * Selang terlama antar tes air sebelum pengguna ditagih, hari.
 *
 * Diekspor karena cron push di index.ts memakainya juga; menuliskannya ulang
 * di sana sebagai angka telanjang berarti dua ambang yang bisa menyimpang.
 */
export const HARI_TES_AIR = 14;

function rentang(
  parameter: string,
  nilai: number,
  batas: [number, number] | null,
  saranRendah: string,
  saranTinggi: string
): PenilaianAir | null {
  if (!batas) return null;
  if (nilai < batas[0]) return { parameter, nilai, status: 'waspada', saran: saranRendah };
  if (nilai > batas[1]) return { parameter, nilai, status: 'waspada', saran: saranTinggi };
  return { parameter, nilai, status: 'aman', saran: '' };
}

export function nilaiAir(hasil: HasilAir, animal: Animal | null): PenilaianAir[] {
  const keluar: PenilaianAir[] = [];

  if (hasil.amoniaPpm !== null) {
    keluar.push({
      parameter: 'amonia',
      nilai: hasil.amoniaPpm,
      status: hasil.amoniaPpm > 0 ? 'bahaya' : 'aman',
      saran: hasil.amoniaPpm > 0
        ? 'Ganti 30-50% air sekarang dan hentikan pakan sehari. Amonia terdeteksi berarti filternya belum matang atau kelebihan pakan.'
        : '',
    });
  }

  if (hasil.nitritPpm !== null) {
    keluar.push({
      parameter: 'nitrit',
      nilai: hasil.nitritPpm,
      status: hasil.nitritPpm > 0 ? 'bahaya' : 'aman',
      saran: hasil.nitritPpm > 0
        ? 'Ganti air dan jangan tambah ikan dulu. Nitrit mengikat darah ikan sehingga ia sesak walau airnya jernih.'
        : '',
    });
  }

  if (hasil.nitratPpm !== null) {
    keluar.push({
      parameter: 'nitrat',
      nilai: hasil.nitratPpm,
      status: hasil.nitratPpm > NITRAT_WASPADA ? 'waspada' : 'aman',
      saran: hasil.nitratPpm > NITRAT_WASPADA
        ? 'Perbesar porsi ganti air rutin. Nitrat tinggi tidak langsung membunuh, tapi menekan kekebalan dan memicu alga.'
        : '',
    });
  }

  if (hasil.ph !== null) {
    const p = rentang(
      'pH', hasil.ph, animal?.phAir ?? null,
      'pH di bawah rentang idealnya. Naikkan perlahan dengan penyangga; perubahan mendadak lebih berbahaya daripada pH yang sedikit meleset.',
      'pH di atas rentang idealnya. Turunkan perlahan; jangan pakai bahan penurun pH sekaligus banyak.'
    );
    if (p) keluar.push(p);
  }

  if (hasil.suhuC !== null) {
    const p = rentang(
      'suhu', hasil.suhuC, animal?.suhuC ?? null,
      'Suhu di bawah rentang idealnya. Ikan jadi lamban makan dan lebih mudah kena jamur.',
      'Suhu di atas rentang idealnya. Air hangat memuat lebih sedikit oksigen — tambah aerasi.'
    );
    if (p) keluar.push(p);
  }

  if (hasil.salinitasPpt !== null) {
    const p = rentang(
      'salinitas', hasil.salinitasPpt, animal?.salinitasPpt ?? null,
      'Salinitas terlalu rendah. Tambah air laut buatan, jangan garam dapur.',
      'Salinitas terlalu tinggi, biasanya karena penguapan. Tambah air tawar RO, bukan air laut.'
    );
    if (p) keluar.push(p);
  }

  return keluar;
}
```

- [ ] **Step 4: Tulis tes `ternak_kepadatan.test.ts` dan `ternak_biosekuriti.test.ts`**

```ts
// backend/src/lib/ternak_kepadatan.test.ts
/**
 * Uji kepadatan kandang.
 *
 * Akuarium 20 liter berisi sepuluh mas koki adalah kalimat kematian yang
 * pelan, dan tidak ada satu pun tugas terjadwal yang akan menangkapnya.
 */
import { describe, it, expect } from 'vitest';
import { cekKepadatan } from './ternak_kepadatan';

describe('cekKepadatan', () => {
  it('menghitung kebutuhan dari jumlah dikali liter per ekor', () => {
    const k = cekKepadatan(100, [{ animalId: 'koi', jumlah: 4, literPerEkor: 20 }])!;
    expect(k.butuhLiter).toBe(80);
    expect(k.tersedia).toBe(100);
    expect(k.kelebihan).toBe(0);
    expect(k.sesak).toBe(false);
  });

  it('menandai sesak dan menyebut kelebihannya', () => {
    const k = cekKepadatan(20, [{ animalId: 'mas-koki', jumlah: 10, literPerEkor: 30 }])!;
    expect(k.butuhLiter).toBe(300);
    expect(k.kelebihan).toBe(280);
    expect(k.sesak).toBe(true);
  });

  it('menjumlah beberapa spesies dalam satu kandang', () => {
    const k = cekKepadatan(100, [
      { animalId: 'guppy', jumlah: 8, literPerEkor: 5 },
      { animalId: 'koi', jumlah: 2, literPerEkor: 20 },
    ])!;
    expect(k.butuhLiter).toBe(80);
  });

  it('penghuni tanpa liter per ekor dilewati, bukan dihitung nol', () => {
    // Nol akan membuat kandang penuh terlihat lapang; dilewati membuat
    // angkanya tidak lengkap tapi tidak pernah berbohong ke arah aman.
    const k = cekKepadatan(50, [
      { animalId: null, jumlah: 5, literPerEkor: null },
      { animalId: 'guppy', jumlah: 4, literPerEkor: 5 },
    ])!;
    expect(k.butuhLiter).toBe(20);
  });

  it('kandang tanpa volume tidak bisa dinilai', () => {
    expect(cekKepadatan(null, [{ animalId: 'koi', jumlah: 4, literPerEkor: 20 }])).toBeNull();
  });

  it('kandang kosong tidak sesak', () => {
    const k = cekKepadatan(50, [])!;
    expect(k.butuhLiter).toBe(0);
    expect(k.sesak).toBe(false);
  });
});
```

```ts
// backend/src/lib/ternak_biosekuriti.test.ts
/**
 * Uji karantina hewan baru.
 *
 * Penyakit masuk bersama hewan baru, bukan muncul sendiri. Dua pekan adalah
 * jeda terpendek yang masih menangkap sebagian besar penyakit menular sebelum
 * ia menyebar ke seluruh isi kandang.
 */
import { describe, it, expect } from 'vitest';
import { statusKarantina, HARI_KARANTINA } from './ternak_biosekuriti';

describe('statusKarantina', () => {
  it('ambangnya dua pekan', () => {
    expect(HARI_KARANTINA).toBe(14);
  });

  it('hewan baru bersama penghuni lain masih dalam karantina', () => {
    const k = statusKarantina('2026-06-01', '2026-06-05', true)!;
    expect(k.selesai).toBe('2026-06-15');
    expect(k.sisaHari).toBe(10);
    expect(k.aman).toBe(false);
  });

  it('lewat ambang berarti aman', () => {
    const k = statusKarantina('2026-06-01', '2026-06-16', true)!;
    expect(k.sisaHari).toBe(0);
    expect(k.aman).toBe(true);
  });

  it('tepat di hari selesai sudah aman', () => {
    expect(statusKarantina('2026-06-01', '2026-06-15', true)!.aman).toBe(true);
  });

  it('hewan sendirian di kandang tidak perlu dikarantina', () => {
    // Tidak ada yang bisa ditulari, jadi peringatannya cuma jadi bising.
    expect(statusKarantina('2026-06-01', '2026-06-05', false)).toBeNull();
  });
});
```

- [ ] **Step 5: Jalankan ketiga tes, pastikan gagal**

Run: `cd backend && npx vitest run src/lib/ternak_kepadatan.test.ts src/lib/ternak_biosekuriti.test.ts`
Expected: FAIL — kedua modul belum ada.

- [ ] **Step 6: Tulis kedua implementasinya**

```ts
// backend/src/lib/ternak_kepadatan.ts
/**
 * Kepadatan kandang.
 *
 * Kelebihan penghuni tidak pernah muncul sebagai tugas yang telat — ia tidak
 * punya jadwal. Yang terjadi hanya ikan yang mati satu per satu selama
 * berbulan-bulan tanpa sebab yang kelihatan, karena amonia naik lebih cepat
 * daripada filternya sanggup mengurai.
 */

export interface Penghuni {
  animalId: string | null;
  jumlah: number;
  /** Kebutuhan ruang per ekor, liter; null bila katalog tidak menyebut angka. */
  literPerEkor: number | null;
}

export interface Kepadatan {
  butuhLiter: number;
  tersedia: number;
  /** Selisih kekurangan; 0 bila cukup. */
  kelebihan: number;
  sesak: boolean;
}

export function cekKepadatan(
  volumeLiter: number | null,
  penghuni: Penghuni[]
): Kepadatan | null {
  // Kandang tanpa volume tidak bisa dinilai. Menebak angkanya akan
  // menghasilkan peringatan yang salah ke dua arah sekaligus.
  if (volumeLiter == null || volumeLiter <= 0) return null;

  // Penghuni tanpa angka kebutuhan dilewati, bukan dihitung nol: nol akan
  // membuat kandang penuh terlihat lapang.
  const butuhLiter = penghuni.reduce(
    (n, p) => n + (p.literPerEkor == null ? 0 : p.literPerEkor * p.jumlah),
    0
  );

  return {
    butuhLiter,
    tersedia: volumeLiter,
    kelebihan: Math.max(0, butuhLiter - volumeLiter),
    sesak: butuhLiter > volumeLiter,
  };
}
```

```ts
// backend/src/lib/ternak_biosekuriti.ts
/**
 * Karantina hewan baru.
 *
 * Penyakit masuk bersama hewan baru, bukan muncul sendiri. Satu ikan yang
 * langsung dimasukkan ke tangki utama bisa menghabiskan seluruh isinya dalam
 * sepekan, dan itu kerugian yang tidak bisa dibatalkan.
 */

/** Jeda terpendek yang masih menangkap sebagian besar penyakit menular. */
export const HARI_KARANTINA = 14;

export interface Karantina {
  selesai: string;
  sisaHari: number;
  aman: boolean;
}

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
 * Status karantina, atau null bila memang tidak perlu dikarantina.
 *
 * Hewan yang sendirian di kandangnya tidak punya siapa pun untuk ditulari,
 * jadi peringatannya hanya akan jadi bising yang mengajari pengguna
 * mengabaikan peringatan berikutnya.
 */
export function statusKarantina(
  tanggalMasuk: string,
  hariIni: string,
  punyaTemanSekandang: boolean
): Karantina | null {
  if (!punyaTemanSekandang) return null;

  const selesai = geser(tanggalMasuk, HARI_KARANTINA);
  const sisaHari = Math.max(0, selisihHari(hariIni, selesai));
  return { selesai, sisaHari, aman: sisaHari === 0 };
}
```

- [ ] **Step 7: Jalankan ketiga berkas tes, pastikan lolos**

Run: `cd backend && npx vitest run src/lib/ternak_air.test.ts src/lib/ternak_kepadatan.test.ts src/lib/ternak_biosekuriti.test.ts`
Expected: PASS — 10 + 6 + 5 = 21 tes.

- [ ] **Step 8: Periksa tipe dan commit**

Run: `cd backend && npm run typecheck`
Expected: keluaran kosong.

```bash
git add backend/src/lib/ternak_air.ts backend/src/lib/ternak_air.test.ts \
        backend/src/lib/ternak_kepadatan.ts backend/src/lib/ternak_kepadatan.test.ts \
        backend/src/lib/ternak_biosekuriti.ts backend/src/lib/ternak_biosekuriti.test.ts
git commit -m "feat(ternak): penilai air, kepadatan kandang, dan karantina

Tiga hal yang tidak akan pernah tertangkap oleh tugas terjadwal, karena
ketiganya tidak punya jadwal.

Amonia di atas nol selalu bahaya, untuk semua habitat, dan penilaian itu
tidak butuh katalog. Tidak ada kadar amonia yang aman bagi ikan mana pun.
Nitrat sengaja hanya waspada: menyamakannya dengan amonia membuat peringatan
bahaya kehilangan artinya.

Kepadatan melewatkan penghuni yang katalognya tidak menyebut kebutuhan ruang,
alih-alih menghitungnya nol — nol akan membuat kandang penuh terlihat lapang.

Karantina diam untuk hewan yang sendirian di kandangnya: tidak ada yang bisa
ditulari, dan peringatan yang tidak berarti mengajari orang mengabaikan
peringatan berikutnya.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Er6KAB3np4KofPhXQo3oFr"
```

---

### Task 5: `routes/ternak.ts` — CRUD kandang dan hewan

**Files:**
- Create: `backend/src/routes/ternak.ts`, `backend/src/routes/ternak_routes.test.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `ANIMAL_BY_ID` (Task 1), tabel dari Task 2.
- Produces: `export default ternak` (router Hono), dan `export function namaSubjekHewan(row): string` yang dipakai Task 6, 7, 8.

Bentuk respons `GET /api/ternak`, dipakai layar di Task 9:

```ts
{
  today: string;
  kandang: Array<{ id, nama, jenis, habitat, volumeLiter, lokasi, tanggalMulai, status, jumlahPenghuni }>;
  hewan: Array<{ id, kandangId, animalId, nama, emoji, jumlah, status, tanggalMasuk, kesulitan }>;
  ringkasan: { kandangAktif: number; hewanHidup: number; ekorTotal: number };
}
```

- [ ] **Step 1: Tulis tes rute yang gagal**

Buat `backend/src/routes/ternak_routes.test.ts` memakai harness yang sama dengan `garden_growth.test.ts`:

```ts
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

  it('kebun kosong menghasilkan ringkasan nol, bukan galat', async () => {
    const body = await (await req('/api/ternak')).json() as {
      ringkasan: { kandangAktif: number; hewanHidup: number; ekorTotal: number };
    };
    expect(body.ringkasan).toEqual({ kandangAktif: 0, hewanHidup: 0, ekorTotal: 0 });
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/routes/ternak_routes.test.ts`
Expected: FAIL — `Cannot find module './ternak'`.

- [ ] **Step 3: Tulis `routes/ternak.ts`**

Kerangka wajib, isi tiap handler mengikuti tes di atas:

```ts
/**
 * Kandang dan penghuninya.
 *
 * Dua lapis, karena sebagian tugas perawatan menempel pada wadah dan sebagian
 * pada ekornya. Lihat lib/ternak_jadwal.ts untuk sisi penjadwalannya.
 *
 * Tidak ada rute '/:id' telanjang di berkas ini. garden.ts punya satu, dan
 * rute itu menelan setiap path yang dipasang sesudahnya — dua kali sudah
 * memaksa urutan mounting yang rapuh.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { ANIMAL_BY_ID } from '../data/animals';

const ternak = new Hono<AuthContext>();
ternak.use('/*', requireAuth);

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const HABITAT = ['darat', 'air-tawar', 'air-payau', 'air-laut'];
const JENIS_KANDANG = ['akuarium', 'kandang', 'kolam', 'umbaran'];
const STATUS_HEWAN = ['hidup', 'mati', 'dilepas', 'dijual'];

interface HewanRow {
  animal_id: string | null;
  nama_kustom: string | null;
  nama_panggilan: string | null;
}

/**
 * Nama yang ditampilkan untuk satu hewan.
 *
 * Panggilan menang atas nama katalog: pemiliknya memanggil kucingnya Mimi,
 * bukan "Kucing domestik".
 */
export function namaSubjekHewan(r: HewanRow): string {
  return r.nama_panggilan
    ?? (r.animal_id ? ANIMAL_BY_ID.get(r.animal_id)?.nama : undefined)
    ?? r.nama_kustom
    ?? 'Hewan';
}

// GET /api/ternak — ringkasan, kandang, dan hewan dalam satu permintaan.
// Satu panggilan, bukan tiga: layar ini dibuka dengan satu ketukan dan tiga
// permintaan berurutan membuatnya terasa lambat di jaringan seluler.
ternak.get('/', async (c) => { /* … */ });

// POST /api/ternak/kandang
// Validasi: nama setelah trim tidak boleh kosong (400); jenis harus di
// JENIS_KANDANG (400); habitat harus di HABITAT (400); tanggalMulai harus
// cocok TANGGAL, kalau tidak dipakai jakartaToday().
ternak.post('/kandang', async (c) => { /* … 201 { id } */ });

// PATCH /api/ternak/kandang/:id — UPDATE ... WHERE id = ?1 AND user_id = ?2,
// 404 bila meta.changes === 0.
ternak.patch('/kandang/:id', async (c) => { /* … */ });

// DELETE /api/ternak/kandang/:id — sama, 404 bila tidak ada perubahan.
ternak.delete('/kandang/:id', async (c) => { /* … */ });

// POST /api/ternak/hewan
// Validasi berurutan:
//   1. kandangId, bila diisi, harus milik pengguna ini — SELECT id FROM
//      ternak_kandang WHERE id = ?1 AND user_id = ?2, 404 bila tidak ada.
//   2. animalId, bila diisi, harus ada di ANIMAL_BY_ID (400 bila tidak).
//   3. Tanpa animalId maupun namaKustom, barisnya tidak punya identitas apa
//      pun dan akan tampil sebagai baris kosong di daftar — 400.
//   4. jumlah dibulatkan; kurang dari 1 ditolak 400.
ternak.post('/hewan', async (c) => { /* … 201 { id } */ });

// PATCH /api/ternak/hewan/:id
// kandangId baru diverifikasi kepemilikannya lebih dulu (404 bila bukan
// miliknya). status di luar STATUS_HEWAN ditolak 400.
ternak.patch('/hewan/:id', async (c) => { /* … */ });

// DELETE /api/ternak/hewan/:id
ternak.delete('/hewan/:id', async (c) => { /* … */ });

export default ternak;
```

Kueri untuk `GET /`, ketiganya dalam satu `Promise.all`:

```sql
-- kandang beserta jumlah penghuni hidupnya
SELECT k.id, k.nama, k.jenis, k.habitat, k.volume_liter, k.lokasi,
       k.tanggal_mulai, k.status,
       (SELECT COALESCE(SUM(h.jumlah), 0) FROM ternak_hewan h
         WHERE h.kandang_id = k.id AND h.status = 'hidup') AS penghuni
  FROM ternak_kandang k
 WHERE k.user_id = ?1
 ORDER BY k.status ASC, k.nama ASC
```

```sql
SELECT id, kandang_id, animal_id, nama_kustom, nama_panggilan, jumlah,
       kelamin, tanggal_lahir, tanggal_masuk, status
  FROM ternak_hewan WHERE user_id = ?1
 ORDER BY status ASC, created_at ASC
```

```sql
SELECT
  (SELECT COUNT(*) FROM ternak_kandang WHERE user_id = ?1 AND status = 'aktif') AS kandang_aktif,
  (SELECT COUNT(*) FROM ternak_hewan WHERE user_id = ?1 AND status = 'hidup') AS hewan_hidup,
  (SELECT COALESCE(SUM(jumlah), 0) FROM ternak_hewan WHERE user_id = ?1 AND status = 'hidup') AS ekor_total
```

`emoji` dan `kesulitan` tiap hewan diambil dari `ANIMAL_BY_ID`; hewan di luar katalog memakai `'🐾'` dan `kesulitan: null`.

- [ ] **Step 4: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/routes/ternak_routes.test.ts`
Expected: PASS, 15 tes.

Catatan: `all()` dan `first()` pada FakeD1 **asinkron**. Lupa `await` menghasilkan `Cannot read properties of undefined (reading 'map')` — galat yang menuduh kode rutenya padahal salahnya di tes.

- [ ] **Step 5: Pasang di `index.ts`**

Tambah import di dekat impor rute kebun:

```ts
import ternak from './routes/ternak';
```

dan mount setelah blok kebun:

```ts
app.route('/api/ternak', ternak);
```

- [ ] **Step 6: Verifikasi menyeluruh dan commit**

Run: `cd backend && npx vitest run && npm run typecheck`
Expected: semua lolos, typecheck bersih.

```bash
git add backend/src/routes/ternak.ts backend/src/routes/ternak_routes.test.ts backend/src/index.ts
git commit -m "feat(ternak): rute kandang dan hewan

CRUD dua lapis plus satu ringkasan yang mengembalikan kandang, hewan, dan
hitungannya dalam satu permintaan — layar ini dibuka dengan satu ketukan, dan
tiga permintaan berurutan membuatnya terasa lambat di jaringan seluler.

kandang_id boleh kosong: kucing rumahan tidak berkandang. Sebaliknya, hewan
tanpa animalId maupun namaKustom ditolak, karena baris tanpa identitas apa pun
akan tampil sebagai baris kosong yang tidak bisa dijelaskan.

Hewan berstatus mati berhenti dihitung tapi barisnya tetap ada: riwayat
perawatannya satu-satunya bahan untuk tahu apa yang salah.

Tidak ada rute '/:id' telanjang di berkas ini, supaya modul ini tidak
mewarisi urutan mounting rapuh yang sudah dua kali menggigit di kebun.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Er6KAB3np4KofPhXQo3oFr"
```

---

### Task 6: `routes/ternak_care.ts` — log, jadwal, override

**Files:**
- Create: `backend/src/routes/ternak_care.ts`, `backend/src/routes/ternak_care.test.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `jadwalSubjek`, `Subjek`, `Ubahan`, `TugasJatuhTempo` (Task 3); `namaSubjekHewan` (Task 5); `ANIMAL_BY_ID` (Task 1).
- Produces: `export default care`, dan `export async function jadwalPengguna(db, userId, hariIni): Promise<TugasJatuhTempo[]>` — dipakai Task 8 untuk push dan Pagi Ini.

`jadwalPengguna` adalah satu-satunya tempat kandang dan hewan digabung jadi satu daftar. Ia diekspor supaya cron dan `/brief` memakai hitungan yang sama persis dengan yang dilihat di layar; dua hitungan terpisah pasti akan menyimpang.

- [ ] **Step 1: Tulis tes yang gagal**

Buat `backend/src/routes/ternak_care.test.ts` dengan harness yang sama seperti Task 5 (`createTestDb`, `seedUser`, dua token), memasang **dua** router:

```ts
app.route('/api/ternak', ternak as never);
app.route('/api/ternak', care as never);
```

Kasus wajib:

```ts
describe('GET /api/ternak/jadwal', () => {
  it('menggabungkan tugas kandang dan tugas hewan dalam satu daftar', async () => {
    // Kandang akuarium + satu cupang di dalamnya. Hasilnya harus memuat
    // sekurangnya satu tugas bersubjek kandang dan satu bersubjek hewan.
  });

  it('tugas kandang muncul sekali walau kandangnya berisi delapan ikan', async () => {
    // Inti seluruh desain dua lapis. Kalau tes ini gagal, penyaringan sasaran
    // di jadwalSubjek bocor dan satu pekerjaan ditagih delapan kali.
    const { id: kandangId } = await buatKandang({ habitat: 'air-tawar', volumeLiter: 60 });
    for (let i = 0; i < 8; i++) {
      await req('/api/ternak/hewan', {
        method: 'POST',
        body: JSON.stringify({
          kandangId, animalId: 'guppy', namaPanggilan: `Guppy ${i + 1}`,
          jumlah: 1, tanggalMasuk: '2026-01-01',
        }),
      });
    }

    const body = await (await req('/api/ternak/jadwal')).json() as {
      tugas: Array<{ kodeTugas: string; subjekTipe: string; subjekId: string }>;
    };
    const gantiAir = body.tugas.filter((t) => t.kodeTugas === 'ganti-air');
    expect(gantiAir).toHaveLength(1);
    expect(gantiAir[0].subjekTipe).toBe('kandang');
    expect(gantiAir[0].subjekId).toBe(kandangId);
  });

  it('hewan berstatus mati tidak menagih apa pun', async () => {});

  it('kandang berstatus nonaktif tidak menagih apa pun', async () => {});

  it('hewan di luar katalog tidak menagih apa pun', async () => {});

  it('jadwal pengguna lain tidak pernah bocor', async () => {});
});

describe('POST /api/ternak/log', () => {
  it('mencatat tugas selesai dan menggeser jatuh temponya', async () => {
    // Baca /jadwal, catat log untuk salah satu kodeTugas dengan tanggal hari
    // ini, baca ulang: `berikutnya` untuk tugas itu harus maju dan `telat`
    // kembali 0.
  });

  it('menolak subjek milik orang lain', async () => {}); // 404
  it('menolak subjekTipe di luar kandang|hewan', async () => {}); // 400
  it('menolak kodeTugas kosong', async () => {}); // 400
  it('tanggal tidak valid jatuh ke hari ini, bukan ditolak', async () => {});
});

describe('GET /api/ternak/log/:subjekTipe/:subjekId', () => {
  it('mengembalikan riwayat terbaru lebih dulu', async () => {});
  it('milik orang lain 404', async () => {});
});

describe('PATCH /api/ternak/tugas', () => {
  it('mengubah interval dan jadwalnya ikut berubah', async () => {});
  it('nonaktif menghilangkan tugas dari jadwal tapi lognya tetap terbaca', async () => {});
  it('mengirim tiapHari null menghapus penyesuaian, kembali ke katalog', async () => {});
  it('subjek milik orang lain 404', async () => {});
});

describe('POST /api/ternak/tugas/custom', () => {
  it('tugas buatan sendiri masuk jadwal', async () => {});
  it('menolak tanpa nama atau tanpa interval', async () => {}); // 400
  it('menolak kode yang bentrok dengan kode katalog spesies itu', async () => {
    // Kalau dibiarkan bentrok, PATCH berikutnya akan mengubah dua hal
    // sekaligus tanpa pengguna tahu yang mana.
  });
});
```

Setiap `it` di atas **harus diisi tubuh tesnya** saat mengerjakan langkah ini — daftar di atas adalah nama dan maksudnya, bukan tes yang boleh dibiarkan kosong. Pakai helper `buatKandang` dan pembuat hewan dari `ternak_routes.test.ts`, disalin ke berkas ini (bukan diimpor lintas berkas tes).

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/routes/ternak_care.test.ts`
Expected: FAIL — `Cannot find module './ternak_care'`.

- [ ] **Step 3: Tulis implementasinya**

```ts
/**
 * Perawatan ternak: apa yang jatuh tempo, apa yang sudah dikerjakan, dan
 * penyesuaian pengguna atas jadwal katalog.
 *
 * `jadwalPengguna` sengaja diekspor. Ia satu-satunya tempat jadwal kandang
 * dan jadwal hewan digabung, dan cron push serta Pagi Ini memakainya juga —
 * dua hitungan terpisah untuk pertanyaan yang sama pasti akan menyimpang,
 * dan yang menyimpang diam-diam adalah pengingat yang salah.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { ANIMAL_BY_ID } from '../data/animals';
import { jadwalSubjek, type Subjek, type Ubahan, type TugasJatuhTempo } from '../lib/ternak_jadwal';
import { namaSubjekHewan } from './ternak';

const care = new Hono<AuthContext>();
care.use('/*', requireAuth);

/**
 * Seluruh tugas jatuh tempo milik satu pengguna, kandang dan hewan sekaligus.
 *
 * Empat kueri, bukan satu per subjek: kebun dengan dua puluh tanaman pernah
 * membuat halaman jadwal mengeluarkan puluhan kueri berurutan, dan D1
 * membatasi jumlah subrequest per permintaan.
 */
export async function jadwalPengguna(
  db: D1Database,
  userId: string,
  hariIni: string
): Promise<TugasJatuhTempo[]> {
  const [kandang, hewan, ubahan, log] = await Promise.all([
    db.prepare(
      `SELECT k.id, k.nama, k.habitat, k.tanggal_mulai,
              (SELECT h.animal_id FROM ternak_hewan h
                WHERE h.kandang_id = k.id AND h.status = 'hidup'
                ORDER BY h.created_at ASC LIMIT 1) AS animal_id
         FROM ternak_kandang k
        WHERE k.user_id = ?1 AND k.status = 'aktif'`
    ).bind(userId).all(),
    db.prepare(
      `SELECT id, animal_id, nama_kustom, nama_panggilan, tanggal_masuk
         FROM ternak_hewan WHERE user_id = ?1 AND status = 'hidup'`
    ).bind(userId).all(),
    db.prepare(
      `SELECT subjek_tipe, subjek_id, kode_tugas, tiap_hari, nonaktif,
              nama_kustom, cara_kustom
         FROM ternak_tugas_ubah WHERE user_id = ?1`
    ).bind(userId).all(),
    db.prepare(
      `SELECT subjek_tipe, subjek_id, kode_tugas, MAX(tanggal) AS tanggal
         FROM ternak_log WHERE user_id = ?1
        GROUP BY subjek_tipe, subjek_id, kode_tugas`
    ).bind(userId).all(),
  ]);

  // Tugas kandang diambil dari spesies penghuni pertamanya. Satu akuarium
  // berisi satu jenis ikan adalah kasus yang jauh lebih umum daripada
  // campuran, dan mengambil tugas dari semua penghuni akan menagih ganti air
  // berkali-kali — persis yang dicegah pemisahan sasaran.
  //
  // Kandang tanpa penghuni hidup tidak punya spesies, jadi tidak menagih apa
  // pun; itu benar, karena akuarium kosong memang tidak perlu diganti airnya.
  // …susun peta ubahan dan log per (tipe|id), lalu panggil jadwalSubjek untuk
  // tiap kandang dan tiap hewan, gabungkan, urutkan telat menurun.
}

// GET /api/ternak/jadwal?hari=14
care.get('/jadwal', async (c) => { /* … { today, tugas, jatuhTempo, penting } */ });

// POST /api/ternak/log  { subjekTipe, subjekId, kodeTugas, tanggal?, nilai?, catatan? }
care.post('/log', async (c) => { /* … 201 { id } */ });

// GET /api/ternak/log/:subjekTipe/:subjekId
care.get('/log/:subjekTipe/:subjekId', async (c) => { /* … */ });

// PATCH /api/ternak/tugas  { subjekTipe, subjekId, kodeTugas, tiapHari?, nonaktif?, namaKustom?, caraKustom? }
care.patch('/tugas', async (c) => { /* … INSERT ... ON CONFLICT DO UPDATE */ });

// POST /api/ternak/tugas/custom  { subjekTipe, subjekId, kodeTugas, nama, tiapHari, cara? }
care.post('/tugas/custom', async (c) => { /* … 201 */ });

export default care;
```

Verifikasi kepemilikan subjek dipakai berulang, jadi tulis sekali:

```ts
/** 404 untuk subjek yang bukan milik pengguna ini, apa pun tipenya. */
async function subjekMilik(
  db: D1Database, userId: string, tipe: string, id: string
): Promise<boolean> {
  const tabel = tipe === 'kandang' ? 'ternak_kandang' : 'ternak_hewan';
  const row = await db.prepare(
    `SELECT id FROM ${tabel} WHERE id = ?1 AND user_id = ?2`
  ).bind(id, userId).first<{ id: string }>();
  return row !== null;
}
```

`tabel` aman dari injeksi karena `tipe` sudah divalidasi terhadap `['kandang', 'hewan']` sebelum fungsi ini dipanggil — validasi itu wajib ada di setiap pemanggil, dan tesnya (`menolak subjekTipe di luar kandang|hewan`) yang menjaganya.

- [ ] **Step 4: Jalankan tes, pastikan lolos**

Run: `cd backend && npx vitest run src/routes/ternak_care.test.ts`
Expected: PASS.

- [ ] **Step 5: Pasang di `index.ts`, jalankan seluruh tes, commit**

```ts
import ternakCare from './routes/ternak_care';
```

```ts
app.route('/api/ternak', ternakCare);
app.route('/api/ternak', ternak);   // ternak.ts punya /kandang/:id, dipasang terakhir
```

Run: `cd backend && npx vitest run && npm run typecheck`

```bash
git add backend/src/routes/ternak_care.ts backend/src/routes/ternak_care.test.ts backend/src/index.ts
git commit -m "feat(ternak): jadwal gabungan, log perawatan, dan penyesuaian tugas

jadwalPengguna adalah satu-satunya tempat jadwal kandang dan jadwal hewan
digabung, dan ia diekspor supaya cron push dan Pagi Ini memakai hitungan yang
sama persis dengan yang dilihat di layar. Dua hitungan terpisah untuk
pertanyaan yang sama pasti menyimpang, dan yang menyimpang diam-diam adalah
pengingat yang salah.

Empat kueri untuk seluruh kebun, bukan satu per subjek: halaman jadwal kebun
pernah mengeluarkan puluhan kueri berurutan, dan D1 membatasi subrequest per
permintaan.

Tugas kandang diambil dari spesies penghuni pertamanya. Kandang tanpa
penghuni hidup tidak menagih apa pun, dan itu benar — akuarium kosong memang
tidak perlu diganti airnya.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Er6KAB3np4KofPhXQo3oFr"
```

---

### Task 7: `ternak_health.ts`, `ternak_catalog.ts`, `ternak_ai.ts`

Tiga rute kecil yang tidak saling bergantung, digabung jadi satu tugas karena masing-masing terlalu tipis untuk gerbang tinjauannya sendiri.

**Files:**
- Create: `backend/src/routes/ternak_health.ts`, `backend/src/routes/ternak_catalog.ts`, `backend/src/routes/ternak_ai.ts`, `backend/src/routes/ternak_health.test.ts`, `backend/src/routes/ternak_catalog.test.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `nilaiAir`, `cekKepadatan`, `statusKarantina`, `HARI_KARANTINA` (Task 4); `ANIMALS`, `ANIMAL_BY_ID` (Task 1).
- Produces: tiga router default.

- [ ] **Step 1: Tulis tes `ternak_health.test.ts`**

Kasus wajib, semuanya dengan tubuh tes penuh:

- `POST /api/ternak/ukur/:hewanId` menyimpan lalu `GET` membacanya kembali; hewan orang lain 404; menolak berat dan panjang yang dua-duanya kosong (400); menolak berat ≤ 0 (400).
- `POST /api/ternak/air/:kandangId` menyimpan; `GET` mengembalikan riwayat **beserta** penilaiannya dari `nilaiAir`; amonia 0.5 menghasilkan satu entri berstatus `bahaya`; kandang orang lain 404; tes air pada kandang berhabitat `darat` ditolak 400 dengan alasan yang disebutkan.
- `GET /api/ternak/kepadatan` menandai akuarium 20 L berisi 10 mas koki sebagai sesak; kandang tanpa `volume_liter` tidak muncul sama sekali; kandang orang lain tidak pernah muncul.
- `GET /api/ternak/karantina` menampilkan hewan yang masuk kurang dari 14 hari lalu **dan** sekandang dengan penghuni lain; hewan yang sendirian tidak muncul; hewan yang sudah lewat 14 hari tidak muncul.

- [ ] **Step 2: Tulis tes `ternak_catalog.test.ts`**

- `GET /api/ternak/katalog` mengembalikan seluruh entri dengan bentuk ringkas (`id`, `nama`, `emoji`, `grup`, `habitat`, `peran`, `kesulitan`, `jumlahTugas`) — bukan seluruh objek `Animal`, karena daftarnya tidak butuh `cara` tiap tugas dan itu memperbesar muatan berkali-kali lipat.
- Filter `?grup=`, `?habitat=`, `?peran=`, `?kesulitan=`, dan `?q=` (cocok pada `nama` maupun `latin`, tidak peka huruf besar-kecil).
- Filter dengan nilai yang tidak dikenal mengembalikan daftar kosong, bukan seluruh katalog — filter yang diam-diam diabaikan lebih membingungkan daripada hasil kosong.
- `GET /api/ternak/katalog/:animalId` mengembalikan objek penuh beserta `tugas`; id yang tidak ada 404.
- Katalog tidak butuh autentikasi data pengguna, tapi tetap di belakang `requireAuth` seperti seluruh API ini.

- [ ] **Step 3: Jalankan kedua tes, pastikan gagal, lalu tulis ketiga rutenya**

`ternak_ai.ts` meniru `/api/garden/diagnose` yang sudah ada di `routes/garden.ts` — baca implementasinya lebih dulu dan ikuti pola yang sama untuk model, penanganan galat, dan batas pemakaian:

- `POST /api/ternak/diagnosa` — terima `{ hewanId?, gejala, foto? }`, susun konteks dari spesies (nama, penyakit umum, rentang air) lalu kirim ke model. Jawaban selalu ditutup kalimat yang menyebut bahwa ini bukan pengganti dokter hewan.
- `POST /api/ternak/tanya` — tanya jawab kontekstual, sama polanya dengan `/api/garden/ask`.

Keduanya **tidak** punya tes rute: keduanya memanggil model, dan tes yang memanggil model tidak deterministik. Yang diuji adalah penyusun konteksnya kalau ia dipisah jadi fungsi murni; kalau tidak, tugas ini tidak menambah tes untuk `ternak_ai.ts` dan itu disebutkan apa adanya di pesan commit.

- [ ] **Step 4: Pasang ketiganya di `index.ts` dengan urutan benar**

```ts
app.route('/api/ternak', ternakCatalog);   // /katalog dan /katalog/:animalId
app.route('/api/ternak', ternakHealth);    // /ukur/:id, /air/:id, /kepadatan, /karantina
app.route('/api/ternak', ternakAi);        // /diagnosa, /tanya
app.route('/api/ternak', ternakCare);      // /jadwal, /log, /tugas
app.route('/api/ternak', ternak);          // /kandang/:id, /hewan/:id — terakhir
```

- [ ] **Step 5: Verifikasi dan commit**

Run: `cd backend && npx vitest run && npm run typecheck`

```bash
git add backend/src/routes/ternak_health.ts backend/src/routes/ternak_health.test.ts \
        backend/src/routes/ternak_catalog.ts backend/src/routes/ternak_catalog.test.ts \
        backend/src/routes/ternak_ai.ts backend/src/index.ts
git commit -m "feat(ternak): kesehatan, katalog, dan endpoint AI

Tes air mengembalikan penilaiannya, bukan cuma angkanya — angka amonia 0.5
tidak berarti apa-apa bagi orang yang baru memelihara ikan, sedangkan
'bahaya, ganti 30-50% air sekarang' berarti.

Tes air ditolak untuk kandang berhabitat darat, dengan alasan yang disebutkan,
bukan disimpan diam-diam sebagai baris yang tidak akan pernah dibaca.

Filter katalog dengan nilai tak dikenal mengembalikan daftar kosong, bukan
seluruh katalog: filter yang diam-diam diabaikan lebih membingungkan daripada
hasil kosong.

Endpoint AI belum punya tes rute karena keduanya memanggil model dan hasilnya
tidak deterministik.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Er6KAB3np4KofPhXQo3oFr"
```

---

### Task 8: Push, Pagi Ini, pencarian, AI — integrasi lintas modul

**Files:**
- Modify: `backend/src/lib/daily_alert.ts`, `backend/src/lib/settings_schema.ts`, `backend/src/index.ts`, `backend/src/routes/daily.ts`, `backend/src/routes/search.ts`, `backend/src/lib/ai_context.ts`, `backend/src/lib/agent_tools.ts`
- Test: `backend/src/routes/daily_ternak.test.ts`

**Interfaces:**
- Consumes: `jadwalPengguna` (Task 6), `cekKepadatan` (Task 4), `namaSubjekHewan` (Task 5).
- Produces: `getTernakToday(db, userId, today): Promise<TernakToday>` di `routes/daily.ts`, dengan
  `TernakToday = { tugasJatuhTempo: number; penting: number; kandangSesak: number; contoh: string[] }`.

- [ ] **Step 1: Tambah tiga `AlertKind`**

Di `backend/src/lib/daily_alert.ts`, perluas union:

```ts
  | 'garden_solution'
  | 'garden_mangsa'
  | 'ternak_care'
  | 'ternak_penting'
  | 'ternak_air';
```

- [ ] **Step 2: Tambah empat setting**

Di `backend/src/lib/settings_schema.ts`, setelah blok kebun:

```ts
  // Sakelar induk modul Ternak. Ketiga push di bawahnya menghormatinya,
  // mengikuti pola sakelar induk Perawatan Kebun: mematikan modulnya
  // mematikan semua pengingatnya sekaligus.
  toggle('notify.ternak', 'notifikasi', 'Ternak', true, 'Perawatan hewan dan kandang.'),
  hour('notify.ternak.hour', 'Jam kirim Ternak', 7),

  toggle('notify.ternak_penting', 'notifikasi', 'Ternak Mendesak', true, 'Tugas yang kelalaiannya berujung mati, dikirim terpisah.'),
  toggle('notify.ternak_air', 'notifikasi', 'Tes Air Kandang', true, 'Kandang berair yang lama tidak dites.'),
```

Jalankan `cd backend && npx vitest run src/routes/settings_schema_match.test.ts` — berkas itu menjaga agar skema setting dan yang dipakai kode tetap sinkron.

- [ ] **Step 3: Tulis tes `daily_ternak.test.ts` yang gagal**

Meniru `daily_garden.test.ts` yang sudah ada. Kasus wajib:

```ts
describe('getTernakToday', () => {
  it('tanpa hewan menghasilkan nol, bukan melempar', async () => {});
  it('menghitung tugas yang jatuh tempo', async () => {});
  it('memisahkan hitungan tugas penting', async () => {});
  it('menghitung kandang yang sesak', async () => {});
  it('hewan mati dan kandang nonaktif tidak ikut', async () => {});
  it('contoh dibatasi tiga nama supaya teksnya tidak meluber', async () => {});
});

describe('ternak di endpoint harian', () => {
  it('/brief membawa kunci ternak', async () => {});
  it('/shutdown membawa kunci ternak', async () => {});
});
```

- [ ] **Step 4: Implementasi `getTernakToday` dan pasang ke dua endpoint**

Di `backend/src/routes/daily.ts`, di sebelah `getGardenToday`:

```ts
export interface TernakToday {
  tugasJatuhTempo: number;
  penting: number;
  kandangSesak: number;
  contoh: string[];
}

const MAKS_CONTOH_TERNAK = 3;

/**
 * Ringkasan ternak untuk Pagi Ini dan Tutup Hari.
 *
 * Memanggil jadwalPengguna, bukan menghitung ulang sendiri: dua hitungan
 * untuk pertanyaan yang sama pasti menyimpang, dan ringkasan yang tidak cocok
 * dengan layarnya membuat keduanya diragukan.
 */
export async function getTernakToday(
  db: D1Database, userId: string, today: string
): Promise<TernakToday> { /* … */ }
```

Lalu tambahkan `getTernakToday(...)` ke `Promise.all` pada `/brief` dan `/shutdown`, dan kembalikan sebagai kunci `ternak` — persis seperti `kebun` sudah dilakukan.

- [ ] **Step 5: Tiga cron push di `index.ts`**

Ketiganya mengikuti bentuk `triggerGardenCare` yang sudah ada: ambil hanya pengguna yang punya `push_subscriptions`, muat setting per pengguna, periksa sakelar induk lalu sakelar sendiri lalu jam, dedup lewat `claimDailyAlert`, dan lepas klaim lewat `releaseDailyAlert` bila `result.subscriptions === 0`.

```ts
async function triggerTernakCare(env: Env) { /* notify.ternak + notify.ternak.hour */ }

/**
 * Tugas yang kelalaiannya berujung mati, dikirim terpisah.
 *
 * Digabung ke pengingat harian biasa, "ganti lampu UVB" akan berada di baris
 * keenam di bawah "potong kuku" dan tenggelam. Pemisahan inilah gunanya
 * kolom `penting` di katalog.
 */
async function triggerTernakPenting(env: Env) { /* … */ }

/** Kandang berair yang lebih dari HARI_TES_AIR tidak dites, atau belum pernah. */
async function triggerTernakAir(env: Env) { /* … */ }
```

`HARI_TES_AIR = 14` didefinisikan dan diekspor dari `backend/src/lib/ternak_air.ts`, bukan ditulis ulang sebagai angka telanjang di `index.ts`.

Ketiganya masuk `Promise.all` di `scheduled`, masing-masing dengan `.catch` sendiri:

```ts
      triggerTernakCare(env).catch((err) => console.error('Ternak care push failed', err)),
      triggerTernakPenting(env).catch((err) => console.error('Ternak urgent push failed', err)),
      triggerTernakAir(env).catch((err) => console.error('Ternak water test push failed', err)),
```

- [ ] **Step 6: Pencarian global**

Di `backend/src/routes/search.ts`, tambahkan dua kueri ke `Promise.all` yang sudah ada:

```sql
SELECT id, animal_id, nama_kustom, nama_panggilan, status
  FROM ternak_hewan WHERE user_id = ?1 AND status = 'hidup'
```

```sql
SELECT id, nama, jenis, lokasi FROM ternak_kandang
 WHERE user_id = ?1 AND status = 'aktif'
```

Hasilnya dipetakan ke bentuk hasil yang sudah dipakai modul lain, dengan `type: 'ternak'` dan `subScreen: 'ternak'`.

- [ ] **Step 7: Konteks dan alat AI**

- `backend/src/lib/ai_context.ts` — tambahkan `'ternak'` ke `MODULES`, tulis `buildTernak` yang meringkas kandang, hewan, tugas telat, dan peringatan air, lalu daftarkan di peta builder dan peta label (`ternak: 'TERNAK'`).
- `backend/src/lib/agent_tools.ts` — dua alat, mengikuti bentuk `kebun.tanam` dan `kebun.rawat`:
  - `ternak.tambah` — mencatat hewan baru dari kalimat bebas.
  - `ternak.catat` — mencatat satu tugas selesai; mencocokkan nama hewan atau kandang seperti `kebun.rawat` mencocokkan nama tanaman, dan melempar `ToolError` yang menyebut nama yang tidak ditemukan.

- [ ] **Step 8: Verifikasi dan commit**

Run: `cd backend && npx vitest run && npm run typecheck`
Expected: semua lolos, termasuk `settings_schema_match.test.ts`.

```bash
git add backend/src/lib/daily_alert.ts backend/src/lib/settings_schema.ts backend/src/index.ts \
        backend/src/routes/daily.ts backend/src/routes/daily_ternak.test.ts \
        backend/src/routes/search.ts backend/src/lib/ai_context.ts backend/src/lib/agent_tools.ts
git commit -m "feat(ternak): push, Pagi Ini, pencarian global, dan konteks AI

Tiga jenis push dengan satu sakelar induk. Tugas penting dikirim terpisah dari
pengingat harian biasa: digabung, 'ganti lampu UVB' akan berada di baris
keenam di bawah 'potong kuku' dan tenggelam — dan itu justru satu-satunya
tugas di daftar itu yang kelalaiannya membengkokkan cangkang.

getTernakToday memanggil jadwalPengguna alih-alih menghitung ulang sendiri.
Ringkasan yang tidak cocok dengan layarnya membuat keduanya diragukan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Er6KAB3np4KofPhXQo3oFr"
```

---

### Task 9: Layar Ternak

**Files:**
- Create: `frontend/src/screens/Ternak.tsx`, `frontend/src/screens/TernakAnimals.tsx`, `frontend/src/screens/TernakCatalog.tsx`, `frontend/src/screens/TernakHealth.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/screens/More.tsx`, `frontend/src/components/AiPanel.tsx`, `frontend/src/screens/Harian.tsx`, `frontend/src/screens/TutupHari.tsx`

**Interfaces:**
- Consumes: seluruh endpoint dari Task 5-8.
- Produces: `export default function TernakScreen()`; `Ternak.tsx` mengekspor `export interface PilihanSubjek { tipe: 'kandang' | 'hewan'; id: string; nama: string }` yang dipakai tiga berkas layar lainnya.

Empat berkas sejak awal, bukan satu yang dipecah nanti: `Garden.tsx` sudah 2400+ baris dan itu pelajaran yang tidak perlu diulang.

- [ ] **Step 1: `Ternak.tsx` — kerangka, tab Hari Ini, tab Kandang**

Muat `/api/ternak` dan `/api/ternak/jadwal` dalam satu `Promise.all`. Wajib:

- **`loadFailed` terpisah dari "belum ada data".** Gagal muat menampilkan layar "Gagal memuat ternak" dengan tombol coba lagi — bukan "Belum ada hewan", yang akan mengundang pengguna mendaftarkan ulang seluruh hewannya jadi duplikat. Ini persis bug yang pernah ada di Kebun.
- **Empat peringatan di atas daftar**, bukan di sub-layar: tugas `penting` yang telat, kandang sesak, amonia terdeteksi pada tes air terakhir, dan karantina yang belum selesai. Keempatnya yang membunuh hewan.
- **Catat sekali ketuk** dari tiap baris jadwal, memanggil `POST /api/ternak/log`. Kegagalan jaringan masuk antrean offline yang sudah ada (`queueFor(userId)`), dengan penghitung yang sama seperti di Kebun.
- Tiap baris jadwal menampilkan `labelTugas`, nama subjek, dan `telat`; menekan barisnya membuka `cara` — instruksi itu gunanya dibaca saat hendak mengerjakan, bukan disembunyikan di katalog.

- [ ] **Step 2: `TernakAnimals.tsx`, `TernakCatalog.tsx`, `TernakHealth.tsx`**

- **Animals** — kartu per baris hewan, detail, riwayat log, pindah kandang, ubah status. Baris ber-`jumlah` lebih dari satu diberi keterangan bahwa ukurannya adalah **contoh**, bukan sensus.
- **Catalog** — cari dan filter, detail spesies dengan daftar tugasnya, tombol "Pelihara ini" yang membuka formulir tambah hewan dengan `animalId` terisi. `legal` dan `bahaya` ditampilkan menonjol di detail, bukan di baris terakhir.
- **Health** — timbang, tes air (formulir enam kolom, semuanya opsional), hasil penilaian air, daftar kandang sesak, hitung mundur karantina.

- [ ] **Step 3: Sambungkan navigasi**

- `frontend/src/App.tsx`: `import Ternak from './screens/Ternak';` dan tambahkan `'ternak': <Ternak />,` ke peta `subScreens`.
- `frontend/src/screens/More.tsx`: sisipkan setelah entri Ibadah:

```tsx
            { label: 'Ternak', id: 'ternak', desc: 'Hewan peliharaan & ternak: jadwal rawat, kandang, tes air', path: null },
```

- `frontend/src/components/AiPanel.tsx`: tambahkan `| 'ternak'` ke `AiModule` — union itu wajib sama persis dengan `MODULES` di backend.
- `Harian.tsx` dan `TutupHari.tsx`: tambahkan kunci `ternak` ke antarmuka responsnya dan satu kartu, meniru kartu `kebun` yang sudah ada.

- [ ] **Step 4: Verifikasi frontend**

Run: `cd frontend && npx tsc --noEmit && npx vitest run && npm run build`
Expected: ketiganya bersih.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/Ternak.tsx frontend/src/screens/TernakAnimals.tsx \
        frontend/src/screens/TernakCatalog.tsx frontend/src/screens/TernakHealth.tsx \
        frontend/src/App.tsx frontend/src/screens/More.tsx \
        frontend/src/components/AiPanel.tsx frontend/src/screens/Harian.tsx \
        frontend/src/screens/TutupHari.tsx
git commit -m "feat(ternak): layar Ternak, katalog, dan kesehatan

Empat berkas sejak awal, bukan satu yang dipecah nanti — Garden.tsx sudah
2400 baris lebih dan itu pelajaran yang tidak perlu diulang.

Empat peringatan berada di atas daftar, bukan di sub-layar: tugas penting yang
telat, kandang sesak, amonia terdeteksi, dan karantina belum selesai.
Keempatnya yang membunuh hewan, dan menyembunyikannya di tab lain sama saja
tidak memilikinya.

Gagal muat dibedakan tegas dari kebun kosong. Layar yang bilang 'belum ada
hewan' saat jaringan putus mengundang pengguna mendaftarkan ulang seluruh
hewannya jadi duplikat — bug yang persis pernah terjadi di Kebun.

Instruksi tiap tugas dibuka dari baris jadwalnya. Cara mengerjakan sesuatu
berguna saat hendak dikerjakan, bukan saat sedang membaca katalog.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Er6KAB3np4KofPhXQo3oFr"
```

---

### Task 10: Katalog penuh ~65 spesies

Dikerjakan **setelah** seluruh jalur bekerja dengan delapan spesies. Menulis 65 entri lebih dulu berarti 65 entri yang harus diedit ulang setiap kali bentuknya bergeser.

**Files:**
- Modify: `backend/src/data/animals.ts`, `backend/src/data/animals.test.ts`

- [ ] **Step 1: Perketat tesnya lebih dulu**

Tambahkan ke `animals.test.ts`:

```ts
  it('jumlah spesies sesuai janji gelombang pertama', () => {
    expect(ANIMALS.length).toBeGreaterThanOrEqual(60);
  });

  it('tiap golongan punya cukup pilihan untuk berguna', () => {
    const per = new Map<string, number>();
    for (const a of ANIMALS) per.set(a.grup, (per.get(a.grup) ?? 0) + 1);
    for (const [grup, minimal] of [
      ['mamalia', 6], ['unggas', 10], ['ikan-tawar', 14],
      ['ikan-laut', 5], ['reptil', 6], ['ternak-besar', 4],
    ] as const) {
      expect(per.get(grup) ?? 0, `${grup} terlalu sedikit`).toBeGreaterThanOrEqual(minimal);
    }
  });

  it('tiap hewan berhabitat air punya tugas ganti air bersasaran kandang', () => {
    // Ikan yang tidak pernah ditagih ganti air adalah ikan yang mati pelan.
    for (const a of ANIMALS) {
      if (a.habitat === 'darat') continue;
      const ada = a.tugas.some((t) => t.sasaran === 'kandang' && /air/i.test(t.nama));
      expect(ada, `${a.id} tanpa tugas air`).toBe(true);
    }
  });

  it('tiap hewan punya sekurangnya satu tugas penting', () => {
    for (const a of ANIMALS) {
      expect(a.tugas.some((t) => t.penting), `${a.id} tanpa tugas penting`).toBe(true);
    }
  });

  it('reptil berjemur punya tugas ganti UVB', () => {
    // Lampu UVB berhenti memancarkan UVB jauh sebelum lampunya mati, jadi
    // "masih menyala" bukan tanda ia masih bekerja. Ini penyebab paling umum
    // cangkang bengkok pada kura-kura peliharaan.
    for (const a of ANIMALS) {
      if (a.grup !== 'reptil') continue;
      expect(a.tugas.some((t) => t.kode === 'uvb'), `${a.id} tanpa tugas uvb`).toBe(true);
    }
  });
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd backend && npx vitest run src/data/animals.test.ts`
Expected: FAIL pada lima tes baru (baru delapan spesies).

- [ ] **Step 3: Isi katalog sampai ~65 entri**

Daftar isi ada di spec, bagian "Katalog", sub-bagian "Isi gelombang pertama". Kerjakan per golongan dan jalankan tesnya tiap selesai satu golongan, jangan menulis 57 entri sekaligus lalu menghadapi tumpukan kegagalan.

Sumber angka: rentang yang lazim dipakai penyuluh peternakan dan komunitas pemelihara di Indonesia. Angka yang tidak yakin ditulis konservatif — interval terlalu rapat cuma merepotkan, interval terlalu longgar bisa membunuh.

- [ ] **Step 4: Jalankan tes, pastikan lolos, commit**

Run: `cd backend && npx vitest run src/data/animals.test.ts && npm run typecheck`

```bash
git add backend/src/data/animals.ts backend/src/data/animals.test.ts
git commit -m "feat(ternak): katalog penuh enam puluh lima spesies

Diisi setelah seluruh jalurnya bekerja dengan delapan spesies benih, bukan
sebelumnya — menulis enam puluh lima entri lebih dulu berarti enam puluh lima
entri yang harus diedit ulang setiap kali bentuknya bergeser.

Lima aturan baru dijaga tes: tiap golongan punya cukup pilihan untuk berguna,
tiap hewan berhabitat air punya tugas ganti air bersasaran kandang, tiap hewan
punya sekurangnya satu tugas penting, dan tiap reptil punya tugas ganti UVB.

Angka yang tidak yakin ditulis konservatif. Interval terlalu rapat cuma
merepotkan; interval terlalu longgar bisa membunuh.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Er6KAB3np4KofPhXQo3oFr"
```

---

### Task 11: Verifikasi menyeluruh, PR, merge, deploy

- [ ] **Step 1: Jalankan semua gerbang**

```bash
cd backend && npx vitest run && npm run typecheck
cd ../frontend && npx tsc --noEmit && npx vitest run && npm run build
```

Expected: semuanya lolos, build sukses.

- [ ] **Step 2: Periksa integrasi yang tidak dijaga tes**

```bash
cd /home/user/Atomic-Habit-tools
grep -c "0040_ternak" backend/package.json                    # harus 2
grep -nE "^\s*(ALTER|DROP)" backend/migrations/0040_ternak.sql # harus kosong
grep -c "ternak_" backend/src/routes/settings.ts               # harus >= 6
grep -n "app.route('/api/ternak'" backend/src/index.ts         # ternak.ts terakhir
grep -n "'ternak'" frontend/src/App.tsx frontend/src/components/AiPanel.tsx backend/src/lib/ai_context.ts
```

- [ ] **Step 3: Migrasi idempoten tiga kali**

Pakai skrip yang sama dengan Task 2 Step 4, tapi ulangi seluruh berkas dari `0037` ke atas.

- [ ] **Step 4: Push**

```bash
git push -u origin claude/cek-pending-cloudflare-deploy-kb4b07
```

Kalau gagal karena jaringan, ulangi maksimal empat kali dengan jeda 2s, 4s, 8s, 16s.

- [ ] **Step 5: PR, merge, pantau deploy**

Buat PR draf bila belum ada untuk branch ini, tandai siap, lalu merge. Setelah merge, pantau workflow `Deploy to Cloudflare` sampai ketiga job (`verify`, `deploy-backend`, `deploy-frontend`) berkonklusi `success`.

Perhatikan: `deploy-backend` menjalankan migrasi ke D1 produksi **sebelum** Worker-nya terpasang. Migrasi yang rusak berarti skema produksi sudah terlanjur berubah saat kegagalannya ketahuan — karena itu Step 1 sampai 3 tidak boleh dilewati.

---

## Catatan untuk pelaksana

- **Jangan pernah menyalin tugas katalog ke baris database.** Seluruh nilai desain ini bergantung pada jadwal yang dihitung saat dibaca. Kalau suatu tugas terasa lebih mudah dengan penyalinan, itu tanda ada yang salah dipahami — baca ulang bagian "Keputusan yang sudah dikunci" di spec.
- **`sasaran` adalah satu-satunya penjaga** dari "delapan guppy ditagih delapan kali". Setiap kali menambah jalur baca jadwal baru, periksa ia menghormati penyaringan itu.
- **Angka katalog akan salah.** Itu diperhitungkan: memperbaikinya cukup satu commit. Yang tidak bisa diperbaiki dengan satu commit adalah bentuk datanya, jadi ketelitian dipakai di sana.
