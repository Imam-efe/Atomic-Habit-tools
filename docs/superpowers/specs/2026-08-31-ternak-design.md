# Modul Ternak — desain

Tanggal: 2026-08-31
Status: disetujui, siap disusun jadi rencana implementasi

## Ringkasan

Modul baru untuk melacak hewan peliharaan dan hewan produksi di rumah tangga
Indonesia — darat, air tawar, air payau, dan air laut. Ia mengikuti pola yang
sudah terbukti di modul Kebun: katalog referensi yang di-bundle, jadwal
perawatan yang dihitung dari katalog dan riwayat nyata, push pengingat harian,
dan panel AI kontekstual.

Perbedaan mendasarnya dari Kebun ada dua, dan keduanya menentukan seluruh
bentuk kode di bawah:

1. **Jenis tugas berbeda per spesies, bukan cuma intervalnya.** Kebun punya dua
   sumbu tetap (siram, pupuk) untuk semua tanaman. Hewan tidak: kucing butuh
   vaksin dan obat cacing, ikan butuh ganti air dan tes amonia, kura-kura butuh
   ganti lampu UVB. Satu ikan tidak pernah butuh obat cacing. Karena itu daftar
   tugas datang dari katalog, per spesies.
2. **Sebagian tugas menempel pada wadah, bukan pada hewannya.** Satu akuarium
   berisi delapan guppy adalah satu pekerjaan ganti air, bukan delapan. Tapi
   vaksin kucing adalah milik kucing itu, bukan milik rumah — kalau ia pindah,
   riwayatnya ikut. Karena itu ada dua lapis: kandang dan penghuni.

## Keputusan yang sudah dikunci

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Cakupan | Peliharaan dan produksi dalam satu modul | Ayam kampung bisa jadi keduanya; memisahkannya memaksa user memilih modul yang salah |
| Sumber daftar tugas | Katalog, per spesies | Pengetahuan perawatan adalah hal yang paling dibutuhkan pemula, dan pemula justru yang paling tidak bisa mengarangnya sendiri |
| Struktur | Dua lapis: kandang + hewan | Mencegah satu pekerjaan ditagih delapan kali, tanpa kehilangan riwayat per ekor |
| Jadwal | Dihitung dari katalog saat dibaca, plus tabel override tipis | Katalog 60–70 spesies yang ditulis tangan pasti ada yang meleset; dengan cara ini memperbaikinya cukup satu commit dan langsung sampai ke semua pengguna |
| Isi katalog gelombang 1 | ~60–70 spesies, semua golongan | Katalog tipis membuat modul terasa kosong saat pertama dibuka |
| Lingkup gelombang 1 | Fondasi utuh yang langsung dipakai | Modul tanpa pengingat berarti perawatan tetap bergantung ingatan — masalah yang justru mau dipecahkan |
| Penempatan | Di bawah "Lainnya" | TabBar sudah berisi tujuh; yang kedelapan menyempitkan semuanya. Memindahkannya jadi tab nanti cuma satu baris |

Yang **tidak** masuk gelombang pertama, dan alasannya:

- **Sisi produksi** (telur harian, panen ikan, pakan, HPP per kilogram) —
  subsistem besar tersendiri; lebih baik dibangun setelah bentuk perawatannya
  terbukti dipakai.
- **Lencana Pencapaian** — streak merawat hewan baru bermakna setelah ada data
  beberapa pekan.

## Katalog: `backend/src/data/animals.ts`

Bundled, bukan tabel D1 yang di-seed. Alasannya sama persis dengan
`data/plants.ts` dan `frontend/src/data/holidays.ts`: data referensi yang jarang
berubah, ditulis tangan dan ditinjau seperti kode, harus tetap benar tanpa
bergantung pada migrasi yang berjalan, dan menyimpannya di sini menghindari
seed besar di skrip migrate yang jalan tiap deploy.

```ts
export type AnimalGroup =
  | 'mamalia' | 'unggas' | 'ikan-tawar' | 'ikan-laut'
  | 'reptil' | 'amfibi' | 'ternak-besar' | 'serangga';

export type Habitat = 'darat' | 'air-tawar' | 'air-payau' | 'air-laut';
export type Peran = 'peliharaan' | 'produksi' | 'keduanya';
export type Kesulitan = 'mudah' | 'sedang' | 'sulit';
export type Sosial = 'sendiri' | 'berpasangan' | 'berkelompok';

export interface TugasKatalog {
  /** Kode stabil, dipakai sebagai kunci di log dan tabel override. */
  kode: string;
  nama: string;
  /** Interval ulang, hari. */
  tiapHari: number;
  /**
   * Jeda dari tanggal masuk sebelum tagihan pertama.
   *
   * Bukan sekadar kenyamanan: anak kucing umur tiga minggu belum boleh
   * divaksin, dan menagihnya di hari ia dicatat adalah saran yang salah
   * secara medis.
   */
  mulaiHari: number;
  /**
   * Menempel ke wadah atau ke ekor.
   *
   * Ini satu-satunya tempat pencegahan "delapan guppy ditagih delapan kali
   * ganti air" perlu ditulis.
   */
  sasaran: 'kandang' | 'hewan';
  /** Instruksi konkret. Bukan "rawat dengan baik". */
  cara: string;
  /** true = kelalaian berujung mati, bukan cuma kurang bagus. */
  penting: boolean;
}

export interface Animal {
  /** Slug stabil — foreign key di ternak_hewan. */
  id: string;
  nama: string;
  latin: string;
  grup: AnimalGroup;
  habitat: Habitat;
  emoji: string;
  peran: Peran;
  /** Harapan hidup, tahun: [terpendek, terpanjang]. */
  umurTahun: [number, number];
  /** Umur dewasa, bulan; null bila tidak relevan. */
  dewasaBulan: number | null;
  /** Rentang suhu ideal; null untuk hewan darat non-terarium. */
  suhuC: [number, number] | null;
  /** Rentang pH air; null untuk hewan darat. */
  phAir: [number, number] | null;
  /** Salinitas, ppt; hanya untuk habitat laut dan payau. */
  salinitasPpt: [number, number] | null;
  ruangMinimal: string;
  pakan: string;
  frekuensiPakan: string;
  sosial: Sosial;
  tugas: TugasKatalog[];
  penyakit: string[];
  kesulitan: Kesulitan;
  /**
   * Status hukum di Indonesia; null berarti bebas dipelihara.
   *
   * Sugar glider, sebagian kura-kura, dan banyak burung kicau masuk daftar
   * dilindungi atau butuh izin penangkaran. Katalog yang diam soal ini
   * mengajak penggunanya melanggar hukum tanpa tahu.
   */
  legal: string | null;
  /**
   * Risiko bagi manusia; null berarti tidak ada yang perlu diperingatkan.
   *
   * Zoonosis nyata: kura-kura brazil pembawa salmonella, dan itu sangat
   * relevan di rumah yang ada anak kecilnya. Kolom ini sejajar dengan
   * `toxic` pada tanaman hias di data/plants.ts — nilainya selalu diisi
   * eksplisit, tidak pernah dibiarkan kosong lalu diartikan "aman".
   */
  bahaya: string | null;
  tips: string;
}
```

Isi gelombang pertama, ~60–70 entri:

- **mamalia** — kucing domestik, kucing persia, anjing kampung, anjing kecil ras,
  kelinci, hamster, marmut, sugar glider, landak mini
- **unggas** — ayam kampung, ayam petelur, ayam hias, bebek, entok, puyuh,
  merpati, lovebird, murai batu, kenari, kacer, perkutut
- **ikan-tawar** — cupang, guppy, molly, platy, neon tetra, koi, mas koki,
  discus, arwana, oscar, lele, nila, gurame, patin, mujair, sepat
- **ikan-laut** — badut (nemo), blue tang, damsel, banggai cardinal, kepe-kepe,
  plus anemon dan karang lunak sebagai entri terpisah
- **reptil-amfibi** — kura-kura brazil, kura-kura sulcata, kura-kura ambon,
  leopard gecko, iguana, sanca kembang, ular jagung, katak pacman, axolotl
- **ternak-besar** — kambing etawa, kambing kacang, domba, sapi perah, sapi potong
- **serangga** — jangkrik, ulat hongkong, lebah madu (pakan hidup dan produksi)

## Skema: `backend/migrations/0040_ternak.sql`

Idempoten, tanpa `ALTER` maupun `DROP` — konvensi wajib repo ini karena
`db:migrate` dijalankan ulang tiap deploy. Terdaftar di **dua** skrip:
`db:migrate` dan `db:migrate:remote`.

| Tabel | Kolom inti |
|---|---|
| `ternak_kandang` | id, user_id, nama, jenis (akuarium/kandang/kolam/umbaran), habitat, volume_liter, lokasi, tanggal_mulai, status (aktif/nonaktif), catatan, created_at |
| `ternak_hewan` | id, user_id, kandang_id (nullable), animal_id (nullable), nama_kustom, nama_panggilan, jumlah, kelamin, tanggal_lahir, tanggal_masuk, asal, status (hidup/mati/dilepas/dijual), catatan, created_at |
| `ternak_log` | id, user_id, subjek_tipe ('kandang'\|'hewan'), subjek_id, kode_tugas, tanggal, nilai (REAL, opsional), catatan, created_at |
| `ternak_tugas_ubah` | user_id, subjek_tipe, subjek_id, kode_tugas, tiap_hari (nullable), nonaktif, nama_kustom, cara_kustom — PK gabungan |
| `ternak_ukur` | id, user_id, hewan_id, tanggal, berat_gram, panjang_cm, catatan, created_at |
| `ternak_air` | id, user_id, kandang_id, tanggal, suhu_c, ph, amonia_ppm, nitrit_ppm, nitrat_ppm, salinitas_ppt, catatan, created_at |

Catatan bentuk:

- **`kandang_id` boleh null.** Kucing rumahan tidak berkandang, dan memaksanya
  punya "kandang bernama Rumah" adalah baris palsu yang harus dijelaskan di
  setiap layar.
- **`animal_id` boleh null.** Hewan di luar katalog tetap boleh dicatat; ia
  hanya tidak punya jadwal otomatis.
- **`ternak_tugas_ubah` hanya berisi baris yang benar-benar diubah pengguna.**
  Tidak ada penyalinan saat hewan ditambah. Ini yang membuat perbaikan katalog
  langsung sampai ke semua orang.
- **`ternak_air` dipisah dari `ternak_log`** karena ia pengukuran bermatra
  banyak, bukan tindakan. Menumpangkannya ke kolom `nilai` tunggal akan
  memaksa enam baris untuk satu kali tes air.
- **`jumlah` pada `ternak_hewan` berarti satu baris boleh mewakili sekelompok**
  hewan sejenis (tiga puluh lele di satu kolam). Untuk baris seperti itu,
  `ternak_ukur` adalah pengukuran **contoh**, bukan sensus — layarnya harus
  menyebut itu apa adanya, karena "berat 180 gram" pada baris berisi tiga puluh
  ekor kalau tidak dijelaskan akan dibaca sebagai berat total.
- **Hanya baris berstatus `hidup` yang dijadwalkan.** Hewan yang mati, dilepas,
  atau dijual berhenti menagih tugas, tapi barisnya tidak dihapus: riwayat
  perawatannya adalah satu-satunya bahan untuk mengetahui apa yang salah.

Keenam tabel didaftarkan di `DATA_TABLES` pada `routes/settings.ts` supaya ikut
ekspor dan backup sejak hari pertama.

## Pustaka murni

### `lib/ternak_jadwal.ts`

Inti modul. Menggabungkan katalog, override, dan log terakhir jadi satu daftar
jatuh tempo.

```ts
export interface Subjek {
  tipe: 'kandang' | 'hewan';
  id: string;
  nama: string;
  animalId: string | null;
  /** tanggal_masuk untuk hewan, tanggal_mulai untuk kandang. */
  mulai: string;
}

export interface Ubahan {
  kodeTugas: string;
  /** null = ikut katalog. */
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

export function jadwalSubjek(
  subjek: Subjek,
  tugasKatalog: TugasKatalog[],
  ubahan: Ubahan[],
  terakhir: Map<string, string>,
  hariIni: string
): TugasJatuhTempo[];
```

Aturan yang dikunci, masing-masing dengan alasannya:

- Tugas katalog disaring per `sasaran`: bersasaran `kandang` hanya masuk jadwal
  kandang, bersasaran `hewan` hanya masuk jadwal hewan.
- Hewan tanpa kandang tetap mendapat seluruh tugas bersasaran `hewan`.
- `animalId` null menghasilkan daftar kosong — bukan jadwal dengan angka
  tebakan. Sama dengan keputusan yang sudah berlaku di `computeCareState`
  untuk tanaman di luar katalog.
- Tugas pertama dihitung dari `mulai + mulaiHari`; yang berikutnya dari log
  terakhir + interval.
- `nonaktif` menghilangkan tugas dari jadwal tapi tidak menyentuh riwayatnya.
- Tepat pada hari jatuh tempo belum dihitung telat — hari itu masih miliknya.
- Semua aritmetika tanggal UTC (`new Date(\`${d}T00:00:00Z\`)`, `getUTC*`),
  tidak pernah metode lokal.

### `lib/ternak_air.ts`

Menilai hasil tes air terhadap rentang katalog, mengembalikan
`{ parameter, nilai, status: 'aman' | 'waspada' | 'bahaya', saran }`.

Amonia di atas nol selalu `bahaya`, untuk semua habitat. Tidak ada kadar amonia
yang aman, dan itu penyebab kematian ikan nomor satu di akuarium yang belum
matang siklus nitrogennya.

### `lib/ternak_kepadatan.ts`

Membandingkan jumlah penghuni terhadap `ruangMinimal` katalog dan volume
kandang. Akuarium 20 liter berisi sepuluh mas koki adalah kalimat kematian yang
pelan, dan tidak ada satu pun tugas terjadwal yang akan menangkapnya.

### `lib/ternak_biosekuriti.ts`

Hewan baru yang masuk ke kandang berisi penghuni lain wajib karantina.
Menghitung tanggal aman gabung dari `tanggal_masuk`, dan menandai yang
dimasukkan lebih cepat.

## Rute

Tidak ada satu pun `/:id` telanjang di akar. `garden.ts` punya `/:id` yang
menelan setiap path yang dipasang sesudahnya, dan itu sudah dua kali memaksa
urutan mounting yang rapuh. Modul ini memakai path bersegmen sejak awal.

| Berkas | Endpoint |
|---|---|
| `routes/ternak.ts` | `GET /api/ternak`; `GET/POST /api/ternak/kandang`, `GET/PATCH/DELETE /api/ternak/kandang/:id`; sama untuk `/hewan` |
| `routes/ternak_care.ts` | `POST /api/ternak/log`; `GET /api/ternak/log/:subjekTipe/:subjekId`; `GET /api/ternak/jadwal?hari=14`; `PATCH /api/ternak/tugas`; `POST /api/ternak/tugas/custom` |
| `routes/ternak_health.ts` | `GET/POST /api/ternak/ukur/:hewanId`; `GET/POST /api/ternak/air/:kandangId`; `GET /api/ternak/kepadatan`; `GET /api/ternak/karantina` |
| `routes/ternak_catalog.ts` | `GET /api/ternak/katalog`; `GET /api/ternak/katalog/:animalId` |
| `routes/ternak_ai.ts` | `POST /api/ternak/diagnosa`; `POST /api/ternak/tanya` |

Setiap kueri membawa `user_id`. Setiap tulis dan hapus memverifikasi
kepemilikan sebelum bertindak, dan mengembalikan 404 — bukan 403 — untuk
sumber daya milik orang lain.

## Layar

Dipecah sejak awal. `Garden.tsx` sudah 2400+ baris dan itu pelajaran yang tidak
perlu diulang.

| Berkas | Isi |
|---|---|
| `screens/Ternak.tsx` | Kerangka, tab **Hari Ini** (satu daftar gabungan tugas kandang dan hewan, urut telat dulu, tugas `penting` ditandai), tab **Kandang** |
| `screens/TernakAnimals.tsx` | Tab **Hewan**: kartu per ekor atau kelompok, detail, riwayat, pindah kandang |
| `screens/TernakCatalog.tsx` | Tab **Katalog**: cari dan filter, detail spesies, tombol "Pelihara ini" |
| `screens/TernakHealth.tsx` | Timbang berat, tes air, peringatan kepadatan, hitung mundur karantina |

Mencatat perawatan cukup sekali ketuk dari daftar Hari Ini. Kegagalan jaringan
masuk antrean offline yang sudah ada (`queueFor(userId)`).

Empat peringatan muncul di atas daftar, bukan di sub-layar: kepadatan berlebih,
amonia terdeteksi, karantina belum selesai, dan tugas `penting` yang telat.
Keempatnya yang membunuh hewan; menyembunyikannya di tab lain sama saja tidak
memilikinya.

Setiap kegagalan muat dibedakan tegas dari "belum ada data" — pelajaran dari
Kebun, di mana galat jaringan sempat memberi tahu pengguna bahwa kebunnya
kosong.

## Integrasi lintas modul

- **Push** — tiga jenis, masing-masing dengan sakelar sendiri di
  `settings_schema.ts` dan satu jam kirim bersama: `ternak_care` (agregat tugas
  jatuh tempo), `ternak_penting` (tugas `penting` yang telat, dikirim terpisah
  supaya tidak tenggelam), `ternak_air` (kandang berair yang lebih dari
  `HARI_TES_AIR = 14` tidak dites, atau belum pernah sama sekali). Dedup lewat
  `claimDailyAlert`; `AlertKind` di `lib/daily_alert.ts` bertambah tiga nilai.
  Ketiganya menghormati satu sakelar induk Ternak, mengikuti pola sakelar induk
  Perawatan Kebun: mematikan modulnya mematikan semua pushnya.
- **Pagi Ini dan Tutup Hari** — `getTernakToday()` di `routes/daily.ts`, di
  sebelah `getGardenToday()`, dikembalikan sebagai kunci `ternak` pada `/brief`
  dan `/shutdown`, dengan kartunya di `Harian.tsx` dan `TutupHari.tsx`.
- **Pencarian global** — hewan dan kandang dicari per nama di `routes/search.ts`,
  tipe hasil `ternak`.
- **AI** — `'ternak'` masuk union modul di `lib/ai_context.ts` (dengan
  `buildTernak`) dan di `components/AiPanel.tsx`; dua alat agen di
  `lib/agent_tools.ts`: `ternak.catat` dan `ternak.tambah`. Diagnosa foto
  meniru `/api/garden/diagnose` yang sudah terbukti jalan.
- **Ekspor dan backup** — enam tabel di `DATA_TABLES`.
- **Navigasi** — satu entri di daftar `More.tsx`.

## Pengujian

**Pustaka murni.** Kasus wajib: tugas bersasaran `kandang` tidak pernah bocor ke
jadwal hewan dan sebaliknya; hewan tanpa kandang tetap mendapat tugasnya;
`animalId` null menghasilkan daftar kosong alih-alih melempar; override
mengalahkan katalog; `nonaktif` menghilangkan tugas sementara log lamanya tetap
terbaca; amonia di atas nol selalu `bahaya`; kepadatan dihitung terhadap volume
kandang yang sebenarnya.

**Rute.** Harness `createTestDb` dan `seedUser` yang sama dengan
`garden_growth.test.ts`, dijalankan terhadap berkas migrasi produksi sehingga
nama kolom yang salah ketik gagal di CI, bukan di ponsel pengguna. Setiap
endpoint diuji kepemilikan antar pengguna pada baca, tulis, dan hapus.

**Katalog.** Uji sifat, bukan kebenaran biologis — angkanya tidak bisa
dibuktikan tes, sama seperti umur panen di `plants.test.ts`. Yang diuji: id
unik; tiap hewan punya sekurangnya satu tugas; semua `tiapHari` lebih dari nol;
`mulaiHari` tidak negatif; tiap tugas punya `cara` yang benar-benar menjelaskan
(panjang minimum); spesies berhabitat laut dan payau wajib punya
`salinitasPpt`; spesies berhabitat air wajib punya `phAir`; `legal` dan
`bahaya` selalu hadir sebagai kolom, sehingga null pun adalah keputusan yang
disengaja dan bukan kelalaian.

**Verifikasi rilis.** `npx vitest run` dan `npm run typecheck` di backend;
`npx tsc --noEmit`, `npx vitest run`, dan `npm run build` di frontend; migrasi
0040 diterapkan ulang tiga kali di atas skema penuh tanpa galat.
