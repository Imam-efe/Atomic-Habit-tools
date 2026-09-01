/**
 * Alat yang boleh dijalankan AI atas nama pengguna.
 *
 * Sampai sekarang AI di aplikasi ini hanya bisa mengusulkan; menulisnya
 * tetap pekerjaan tangan. Untuk permintaan seperti "buatkan daftar tanaman
 * untuk kebun kecil", mengusulkan sepuluh baris yang lalu harus diketik
 * ulang satu per satu bukan bantuan — itu memindahkan pekerjaan, bukan
 * menghilangkannya.
 *
 * Yang membuat eksekusi langsung bisa dipertanggungjawabkan bukan model
 * yang lebih pintar, melainkan tiga batas di berkas ini:
 *
 *   1. Daftar tertutup. Model hanya memilih dari alat yang terdaftar di
 *      sini; ia tidak pernah menyusun SQL, dan nama alat yang tidak dikenal
 *      ditolak sebelum menyentuh database.
 *   2. Argumen divalidasi kode, bukan dipercaya. Setiap alat memeriksa
 *      sendiri isi argumennya dan menolak yang tidak masuk akal.
 *   3. Tingkat risiko. Alat yang menyentuh uang tidak pernah dieksekusi
 *      langsung — ia dikembalikan sebagai usulan untuk dikonfirmasi. Salah
 *      mencatat pengeluaran merusak laporan berbulan-bulan ke belakang,
 *      dan itu kerugian yang tidak sebanding dengan hemat satu ketukan.
 *
 * Semua alat menulis lewat kueri yang sama dengan rute manualnya, jadi tidak
 * ada jalur tulis kedua yang bisa menyimpang dari aturan yang sudah ada.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { nanoid } from './nanoid';
import { PLANTS, PLANT_BY_ID, dipanen } from '../data/plants';
import { ANIMALS, ANIMAL_BY_ID, type TugasKatalog } from '../data/animals';
import { spesiesKandang } from './ternak_spesies';
import { addHarvestToInventory } from '../routes/garden';
import { pilahBahan, type StockItem } from './cooking';
import type { ModuleKey } from './ai_context';

/**
 * `aman` dijalankan langsung; `konfirmasi` dikembalikan sebagai usulan.
 *
 * Pembedanya bukan seberapa rumit alatnya, melainkan seberapa mahal salahnya
 * dan seberapa mudah dibatalkan. Menambah tanaman salah tinggal dihapus;
 * angka pengeluaran yang salah ikut ke rekap bulanan dan proyeksi.
 */
export type ToolRisk = 'aman' | 'konfirmasi';

export interface ToolContext {
  db: D1Database;
  userId: string;
  today: string;
}

export interface ToolResult {
  /** Kalimat pendek untuk ditampilkan ke pengguna. */
  ringkasan: string;
  /** Id baris yang dibuat, supaya UI bisa menawarkan pembatalan. */
  ids?: string[];
  /**
   * Keadaan sebelumnya yang perlu diketahui untuk membatalkan.
   *
   * Hanya alat yang mengubah baris di luar yang dibuatnya sendiri yang
   * mengisinya — menghapus baris baru saja tidak cukup kalau alatnya juga
   * sempat menaikkan status sesuatu.
   */
  undoMeta?: Record<string, unknown>;
}

export interface AgentTool {
  name: string;
  module: ModuleKey;
  risk: ToolRisk;
  /** Dibaca model saat memilih alat, jadi ditulis untuk model, bukan untuk dokumentasi. */
  description: string;
  /** Properti JSON Schema untuk argumen alat ini. */
  args: Record<string, unknown>;
  required: string[];
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;

  /**
   * Tabel tempat alat ini membuat baris.
   *
   * Pembatalan bawaan menghapus id yang tercatat dari tabel ini, jadi
   * sebagian besar alat tidak perlu menulis kode pembatalan sama sekali.
   * Namanya berasal dari daftar tertutup di berkas ini, bukan dari masukan
   * siapa pun, dan ada uji yang memastikan tabelnya benar-benar ada.
   */
  table: string;

  /**
   * Pembatalan khusus, untuk alat yang efeknya lebih dari sekadar baris baru.
   *
   * Dipanggil SEBELUM baris utamanya dihapus, supaya masih bisa membaca
   * apa pun yang menggantung padanya.
   */
  undo?(ctx: ToolContext, ids: string[], meta: Record<string, unknown>): Promise<void>;
}

/** Galat yang pesannya memang ditujukan untuk dibaca pengguna. */
export class ToolError extends Error {}

// ───────────────────────────── pembantu argumen ─────────────────────────────

function teks(args: Record<string, unknown>, key: string, maxLen = 200): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new ToolError(`"${key}" wajib diisi`);
  return v.trim().slice(0, maxLen);
}

function teksOpsional(args: Record<string, unknown>, key: string, maxLen = 200): string | null {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim().slice(0, maxLen);
}

function angka(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Tanggal YYYY-MM-DD; apa pun yang bukan itu jatuh ke hari ini. */
function tanggal(args: Record<string, unknown>, key: string, today: string): string {
  const v = args[key];
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : today;
}

function daftarTeks(args: Record<string, unknown>, key: string, maxItems = 20): string[] {
  const v = args[key];
  if (!Array.isArray(v)) throw new ToolError(`"${key}" harus berupa daftar`);
  const out = v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 120))
    .slice(0, maxItems);
  if (out.length === 0) throw new ToolError(`"${key}" tidak boleh kosong`);
  return out;
}

/**
 * Cocokkan nama bebas ke katalog tanaman.
 *
 * Model menulis "bayam merah" sedangkan katalog menyimpan "Bayam"; tanpa
 * pencocokan longgar setiap tanaman masuk sebagai nama kustom dan kehilangan
 * jadwal siram, perkiraan panen, dan seluruh perhitungan yang bergantung
 * pada katalog.
 */
export function cocokkanTanaman(nama: string): string | null {
  const q = nama.toLowerCase().trim();
  if (PLANT_BY_ID.has(q)) return q;

  const exact = PLANTS.find((p) => p.name.toLowerCase() === q);
  if (exact) return exact.id;

  // Pencocokan longgar berbatas kata, bukan substring bebas: "bibit cabai"
  // mengandung huruf "bit" dan tanpa batas kata akan jatuh ke katalog Bit —
  // tanamannya lalu memakai jadwal siram dan umur panen umbi-umbian.
  //
  // Yang paling panjang dimenangkan supaya "bayam merah" tidak jatuh ke
  // "bayam" ketika katalog punya keduanya.
  const kata = new Set(q.split(/\s+/).filter(Boolean));
  const kandidat = PLANTS.filter((p) => {
    const nama = p.name.toLowerCase();
    const namaKata = nama.split(/\s+/).filter(Boolean);
    // Seluruh kata nama katalog muncul utuh di permintaan, atau sebaliknya.
    return namaKata.every((w) => kata.has(w)) || [...kata].every((w) => namaKata.includes(w));
  });

  if (kandidat.length === 0) return null;
  return kandidat.reduce((a, b) => (b.name.length > a.name.length ? b : a)).id;
}

/**
 * Cocokkan nama bebas ke katalog hewan/ternak.
 *
 * Sama persis alasannya dengan cocokkanTanaman: model menulis "kucing"
 * sedangkan katalog menyimpan "Kucing domestik", dan tanpa pencocokan longgar
 * hewannya masuk sebagai nama kustom dan kehilangan seluruh jadwal
 * perawatannya.
 */
export function cocokkanHewan(nama: string): string | null {
  const q = nama.toLowerCase().trim();
  if (ANIMAL_BY_ID.has(q)) return q;

  const exact = ANIMALS.find((a) => a.nama.toLowerCase() === q);
  if (exact) return exact.id;

  const kata = new Set(q.split(/\s+/).filter(Boolean));
  const kandidat = ANIMALS.filter((a) => {
    const namaKata = a.nama.toLowerCase().split(/\s+/).filter(Boolean);
    return namaKata.every((w) => kata.has(w)) || [...kata].every((w) => namaKata.includes(w));
  });

  if (kandidat.length === 0) return null;
  return kandidat.reduce((a, b) => (b.nama.length > a.nama.length ? b : a)).id;
}

// ─────────────────────────────────── alat ───────────────────────────────────

const tools: AgentTool[] = [
  {
    name: 'kebun.tanam',
    table: 'garden_plantings',
    module: 'kebun',
    risk: 'aman',
    description:
      'Mencatat satu atau beberapa tanaman baru di kebun. Pakai ini kalau pengguna minta dibuatkan daftar tanaman, ditambahkan tanaman, atau disusunkan rencana tanam.',
    args: {
      tanaman: {
        type: 'array',
        items: { type: 'string' },
        description: 'Nama tanaman, satu per elemen. Contoh: ["Kangkung", "Bayam", "Cabai rawit"]',
      },
      lokasi: { type: 'string', description: 'Lokasi tanam, misal "polybag teras". Kosongkan kalau tidak disebut.' },
      jumlah: { type: 'number', description: 'Jumlah per tanaman. Default 1.' },
      tanggal: { type: 'string', description: 'Tanggal tanam YYYY-MM-DD. Kosongkan untuk hari ini.' },
    },
    required: ['tanaman'],
    async run(ctx, args) {
      const nama = daftarTeks(args, 'tanaman', 15);
      const lokasi = teksOpsional(args, 'lokasi', 80);
      const jumlah = Math.round(angka(args, 'jumlah', 1));
      const ditanam = tanggal(args, 'tanggal', ctx.today);

      const ids: string[] = [];
      const statements = nama.map((n) => {
        const id = nanoid();
        ids.push(id);
        const plantId = cocokkanTanaman(n);
        const plant = plantId ? PLANT_BY_ID.get(plantId) : undefined;

        // Batas BAWAH rentang katalog, sama seperti POST /api/garden. Memakai
        // batas atas membuat penanda siap-panen dan push-nya telat sampai dua
        // bulan untuk tanaman yang dibuat AI, dan tidak ada layar yang
        // menjelaskan kenapa dua tanaman yang sama berbeda jadwalnya.
        const panen = plant && dipanen(plant)
          ? new Date(Date.parse(`${ditanam}T00:00:00Z`) + plant.daysToHarvest[0] * 86400000)
              .toISOString().slice(0, 10)
          : null;

        return ctx.db.prepare(
          `INSERT INTO garden_plantings
             (id, user_id, plant_id, custom_name, location, quantity, planting_method,
              planted_date, expected_harvest_date, status)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'benih', ?7, ?8, 'tumbuh')`
        ).bind(id, ctx.userId, plantId, plantId ? null : n, lokasi, jumlah, ditanam, panen);
      });

      await ctx.db.batch(statements);
      return { ringkasan: `${nama.length} tanaman dicatat: ${nama.join(', ')}.`, ids };
    },
  },

  {
    name: 'kebun.rawat',
    table: 'garden_care_log',
    module: 'kebun',
    risk: 'aman',
    description:
      'Mencatat perawatan tanaman yang sudah ada: siram, pupuk, panen, pangkas, atau semprot.',
    args: {
      tanaman: { type: 'string', description: 'Nama tanaman yang dirawat, seperti tertulis di daftar kebun.' },
      aksi: { type: 'string', enum: ['siram', 'pupuk', 'panen', 'pangkas', 'semprot'], description: 'Perawatan yang dilakukan.' },
      jumlah: { type: 'number', description: 'Jumlah hasil panen, hanya untuk aksi panen.' },
      satuan: { type: 'string', description: 'Satuan hasil panen, misal kg. Hanya untuk aksi panen.' },
    },
    required: ['tanaman', 'aksi'],
    async run(ctx, args) {
      const nama = teks(args, 'tanaman', 80);
      const aksi = teks(args, 'aksi', 20).toLowerCase();
      if (!['siram', 'pupuk', 'panen', 'pangkas', 'semprot'].includes(aksi)) {
        throw new ToolError(`perawatan "${aksi}" tidak dikenal`);
      }

      // Tanaman yang sudah berstatus 'panen' tetap bisa dirawat: yang panennya
      // berulang masih disiram dan dipupuk setelah panen pertama.
      const target = await ctx.db.prepare(
        `SELECT id, status FROM garden_plantings
          WHERE user_id = ?1 AND status IN ('tumbuh', 'panen')
            AND (LOWER(COALESCE(nickname, '')) LIKE ?2
              OR LOWER(COALESCE(custom_name, '')) LIKE ?2
              OR LOWER(COALESCE(plant_id, '')) LIKE ?2)
          ORDER BY planted_date DESC LIMIT 1`
      ).bind(ctx.userId, `%${nama.toLowerCase()}%`).first<{ id: string; status: string }>();

      if (!target) throw new ToolError(`tidak menemukan tanaman "${nama}" di kebun`);

      const jumlah = aksi === 'panen' && typeof args.jumlah === 'number' && args.jumlah > 0
        ? args.jumlah
        : null;
      const satuan = aksi === 'panen' ? teksOpsional(args, 'satuan', 20) : null;

      const id = nanoid();
      await ctx.db.prepare(
        `INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date, amount, unit)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      ).bind(id, ctx.userId, target.id, aksi, ctx.today, jumlah, satuan).run();

      // Panen lewat AI harus punya akibat yang sama persis dengan panen lewat
      // tombol. Tanpa ini panen yang dicatat lewat kalimat berhenti di log
      // kebun: statusnya tidak pernah naik, hasilnya tidak pernah sampai ke
      // Inventaris, dan HPP serta Selamatkan Bahan yang berdiri di atas stok
      // itu diam-diam melewatkannya.
      let stockItemId: string | null = null;
      if (aksi === 'panen') {
        if (target.status === 'tumbuh') {
          await ctx.db.prepare("UPDATE garden_plantings SET status = 'panen' WHERE id = ?1 AND user_id = ?2")
            .bind(target.id, ctx.userId).run();
        }
        if (jumlah !== null) {
          stockItemId = await addHarvestToInventory(
            ctx.db, ctx.userId, target.id, id, jumlah, satuan, ctx.today
          );
        }
      }

      const catatan = stockItemId ? ' Hasilnya masuk Inventaris.' : '';
      return {
        ringkasan: `${aksi} untuk ${nama} dicatat.${catatan}`,
        ids: [id],
        // Status sebelum panen disimpan: tanpa ini pembatalan tidak tahu
        // apakah tanaman ini memang sudah berstatus 'panen' sejak sebelumnya.
        undoMeta: { plantingId: target.id, statusSebelum: target.status },
      };
    },

    /**
     * Membatalkan panen berarti mengembalikan tiga hal, bukan satu.
     *
     * Log perawatannya dihapus pembatalan bawaan, tapi panen juga menaikkan
     * status tanaman dan membuat baris stok di Inventaris. Membiarkan
     * keduanya menghasilkan keadaan yang tidak pernah bisa dijelaskan:
     * tanaman berstatus panen tanpa catatan panen, dan stok dapur yang
     * asalnya sudah tidak ada.
     */
    async undo(ctx, ids, meta) {
      const plantingId = typeof meta.plantingId === 'string' ? meta.plantingId : null;
      const statusSebelum = typeof meta.statusSebelum === 'string' ? meta.statusSebelum : null;

      // Stok hasil panen ditelusuri lewat baris klaim yang dibuat saat panen.
      for (const careLogId of ids) {
        const klaim = await ctx.db.prepare(
          'SELECT inventory_item_id FROM garden_harvest_stock WHERE care_log_id = ?1 AND user_id = ?2'
        ).bind(careLogId, ctx.userId).first<{ inventory_item_id: string }>();

        if (klaim) {
          await ctx.db.batch([
            ctx.db.prepare('DELETE FROM inventory_items WHERE id = ?1 AND user_id = ?2')
              .bind(klaim.inventory_item_id, ctx.userId),
            ctx.db.prepare('DELETE FROM garden_harvest_stock WHERE care_log_id = ?1 AND user_id = ?2')
              .bind(careLogId, ctx.userId),
          ]);
        }
      }

      // Status hanya diturunkan kalau aksi ini yang menaikkannya.
      if (plantingId && statusSebelum === 'tumbuh') {
        await ctx.db.prepare(
          "UPDATE garden_plantings SET status = 'tumbuh' WHERE id = ?1 AND user_id = ?2 AND status = 'panen'"
        ).bind(plantingId, ctx.userId).run();
      }
    },
  },

  {
    name: 'ternak.tambah',
    table: 'ternak_hewan',
    module: 'ternak',
    risk: 'aman',
    description:
      'Mencatat satu atau beberapa hewan/ternak baru. Pakai ini kalau pengguna bilang baru beli, dikasih, atau menetaskan hewan.',
    args: {
      hewan: {
        type: 'array',
        items: { type: 'string' },
        description: 'Nama spesies atau nama panggilan, satu per elemen. Contoh: ["Kucing domestik", "Lovebird"]',
      },
      kandang: { type: 'string', description: 'Nama kandang tempat hewan ini tinggal. Kosongkan kalau tidak disebut atau tidak berkandang.' },
      jumlah: { type: 'number', description: 'Jumlah per baris, misal 30 ekor lele dalam satu kolam. Default 1.' },
      tanggal: { type: 'string', description: 'Tanggal masuk YYYY-MM-DD. Kosongkan untuk hari ini.' },
    },
    required: ['hewan'],
    async run(ctx, args) {
      const nama = daftarTeks(args, 'hewan', 15);
      const namaKandang = teksOpsional(args, 'kandang', 80);
      const jumlah = Math.round(angka(args, 'jumlah', 1));
      const masuk = tanggal(args, 'tanggal', ctx.today);

      let kandangId: string | null = null;
      if (namaKandang) {
        const k = await ctx.db.prepare(
          `SELECT id FROM ternak_kandang
            WHERE user_id = ?1 AND status = 'aktif' AND LOWER(nama) LIKE ?2
            ORDER BY created_at DESC LIMIT 1`
        ).bind(ctx.userId, `%${namaKandang.toLowerCase()}%`).first<{ id: string }>();
        if (!k) throw new ToolError(`tidak menemukan kandang "${namaKandang}"`);
        kandangId = k.id;
      }

      const ids: string[] = [];
      const statements = nama.map((n) => {
        const id = nanoid();
        ids.push(id);
        const animalId = cocokkanHewan(n);

        return ctx.db.prepare(
          `INSERT INTO ternak_hewan
             (id, user_id, kandang_id, animal_id, nama_kustom, jumlah, tanggal_masuk)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        ).bind(id, ctx.userId, kandangId, animalId, animalId ? null : n, jumlah, masuk);
      });

      await ctx.db.batch(statements);
      return { ringkasan: `${nama.length} hewan dicatat: ${nama.join(', ')}.`, ids };
    },
  },

  {
    name: 'ternak.catat',
    table: 'ternak_log',
    module: 'ternak',
    risk: 'aman',
    description:
      'Mencatat satu tugas perawatan ternak yang sudah selesai dikerjakan, misalnya ganti air, potong kuku, atau vaksin.',
    args: {
      subjek: { type: 'string', description: 'Nama hewan atau kandang yang dirawat, seperti tertulis di daftar Ternak.' },
      tugas: { type: 'string', description: 'Nama tugas yang dikerjakan, misal "ganti air" atau "potong kuku".' },
      tanggal: { type: 'string', description: 'YYYY-MM-DD. Kosongkan untuk hari ini.' },
      catatan: { type: 'string' },
    },
    required: ['subjek', 'tugas'],
    async run(ctx, args) {
      const subjek = teks(args, 'subjek', 80);
      const namaTugas = teks(args, 'tugas', 80);
      const q = `%${subjek.toLowerCase()}%`;

      // Hewan dicari lebih dulu: kalimat pengguna jauh lebih sering menyebut
      // nama panggilan seekor hewan daripada nama kandangnya.
      const hewan = await ctx.db.prepare(
        `SELECT id, animal_id, kandang_id FROM ternak_hewan
          WHERE user_id = ?1 AND status = 'hidup'
            AND (LOWER(COALESCE(nama_panggilan, '')) LIKE ?2
              OR LOWER(COALESCE(nama_kustom, '')) LIKE ?2
              OR LOWER(COALESCE(animal_id, '')) LIKE ?2)
          ORDER BY created_at DESC LIMIT 1`
      ).bind(ctx.userId, q).first<{ id: string; animal_id: string | null; kandang_id: string | null }>();

      let subjekTipe: 'hewan' | 'kandang';
      let subjekId: string;
      let animalId: string | null;
      /** kandang_id hewan ini, untuk dialihkan kalau tugasnya ternyata bersasaran kandang. */
      let kandangHewan: string | null = null;

      if (hewan) {
        subjekTipe = 'hewan';
        subjekId = hewan.id;
        animalId = hewan.animal_id;
        kandangHewan = hewan.kandang_id;
      } else {
        const kandang = await ctx.db.prepare(
          `SELECT id FROM ternak_kandang
            WHERE user_id = ?1 AND status = 'aktif' AND LOWER(nama) LIKE ?2
            ORDER BY created_at DESC LIMIT 1`
        ).bind(ctx.userId, q).first<{ id: string }>();
        if (!kandang) throw new ToolError(`tidak menemukan hewan atau kandang "${subjek}" di Ternak`);

        subjekTipe = 'kandang';
        subjekId = kandang.id;

        // Kode tugasnya diambil dari spesies penghuni pertama — sama seperti
        // jadwalPengguna mengambil tugas kandang dari penghuninya.
        animalId = await spesiesKandang(ctx.db, kandang.id, ctx.userId);
      }

      // Nama tugas dicocokkan ke katalog spesiesnya kalau ada, supaya
      // tersimpan dengan kode yang sama dipakai jadwal — bukan kode buatan
      // yang tidak akan pernah cocok dengan apa pun di sana.
      //
      // Katalog disaring ke sasaran subjek yang sedang dicatat DULU, sebelum
      // dicocokkan — kalau tidak, "ganti air" bisa cocok dengan tugas
      // bersasaran kandang padahal subjeknya seekor ikan, tersimpan dengan
      // subjek yang salah dan tidak akan pernah terbaca jadwalPengguna, yang
      // mencari kode itu di kandangnya, bukan di ekornya.
      const katalog: TugasKatalog[] = animalId ? (ANIMAL_BY_ID.get(animalId)?.tugas ?? []) : [];
      const cariCocok = (daftar: TugasKatalog[]) =>
        daftar.find((t) => t.nama.toLowerCase() === namaTugas.toLowerCase()) ??
        daftar.find(
          (t) => t.nama.toLowerCase().includes(namaTugas.toLowerCase())
            || namaTugas.toLowerCase().includes(t.nama.toLowerCase())
        );

      const sesuaiSasaran = katalog.filter((t) => t.sasaran === subjekTipe);
      let cocok = cariCocok(sesuaiSasaran);
      let catatanAlih = '';

      if (!cocok && katalog.length > 0) {
        const bedaSasaran = katalog.filter((t) => t.sasaran !== subjekTipe);
        const cocokBeda = cariCocok(bedaSasaran);

        // Satu-satunya arah pengalihan yang punya subjek tunggal yang masuk
        // akal: seekor hewan yang menyebut tugas kandangnya sendiri,
        // dialihkan ke kandang itu. Kebalikannya — kandang yang menyebut
        // tugas per-ekor — tidak punya satu ekor tunggal untuk dituju kalau
        // penghuninya lebih dari satu, jadi tidak dialihkan.
        if (cocokBeda && subjekTipe === 'hewan' && cocokBeda.sasaran === 'kandang' && kandangHewan) {
          subjekTipe = 'kandang';
          subjekId = kandangHewan;
          cocok = cocokBeda;
          catatanAlih = ' (dicatat ke kandangnya — ini tugas kandang, bukan tugas per-ekor)';
        }
      }

      if (!cocok && katalog.length > 0) {
        const namaValid = [...new Set(katalog.map((t) => t.nama))].join(', ');
        throw new ToolError(`"${namaTugas}" bukan nama tugas untuk ${subjek}. Tugas yang ada: ${namaValid}.`);
      }

      const kodeTugas = cocok?.kode ?? namaTugas.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);

      const id = nanoid();
      await ctx.db.prepare(
        `INSERT INTO ternak_log (id, user_id, subjek_tipe, subjek_id, kode_tugas, tanggal, catatan)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      ).bind(
        id, ctx.userId, subjekTipe, subjekId, kodeTugas,
        tanggal(args, 'tanggal', ctx.today), teksOpsional(args, 'catatan', 200)
      ).run();

      return { ringkasan: `${cocok?.nama ?? namaTugas} untuk ${subjek} dicatat.${catatanAlih}`, ids: [id] };
    },
  },

  {
    name: 'inventaris.tambah',
    table: 'inventory_items',
    module: 'inventaris',
    risk: 'aman',
    description: 'Menambahkan barang ke inventaris dapur/rumah, misalnya hasil belanja.',
    args: {
      barang: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nama: { type: 'string' },
            jumlah: { type: 'number' },
            satuan: { type: 'string', description: 'kg, gram, pcs, liter, ikat' },
            kedaluwarsa: { type: 'string', description: 'YYYY-MM-DD, kosongkan kalau tidak tahu' },
          },
          required: ['nama'],
        },
        description: 'Daftar barang yang ditambahkan.',
      },
    },
    required: ['barang'],
    async run(ctx, args) {
      const raw = args.barang;
      if (!Array.isArray(raw) || raw.length === 0) throw new ToolError('"barang" tidak boleh kosong');

      const ids: string[] = [];
      const nama: string[] = [];
      const statements = raw.slice(0, 20).flatMap((item) => {
        if (typeof item !== 'object' || item === null) return [];
        const o = item as Record<string, unknown>;
        const n = typeof o.nama === 'string' ? o.nama.trim().slice(0, 120) : '';
        if (!n) return [];

        const id = nanoid();
        ids.push(id);
        nama.push(n);
        const kedaluwarsa =
          typeof o.kedaluwarsa === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.kedaluwarsa)
            ? o.kedaluwarsa
            : null;

        return [ctx.db.prepare(
          `INSERT INTO inventory_items (id, user_id, name, quantity, unit, expiry_date, purchase_date)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        ).bind(
          id, ctx.userId, n,
          typeof o.jumlah === 'number' && o.jumlah > 0 ? o.jumlah : 1,
          typeof o.satuan === 'string' && o.satuan.trim() ? o.satuan.trim().slice(0, 20) : 'pcs',
          kedaluwarsa, ctx.today
        )];
      });

      if (statements.length === 0) throw new ToolError('tidak ada barang yang bisa dibaca');
      await ctx.db.batch(statements);
      return { ringkasan: `${nama.length} barang masuk inventaris: ${nama.join(', ')}.`, ids };
    },
  },

  {
    name: 'kebiasaan.buat',
    table: 'habits',
    module: 'kebiasaan',
    risk: 'aman',
    description:
      'Membuat kebiasaan baru. Sertakan pemicu dan versi dua menit kalau pengguna menyebutkannya atau kalau masuk akal untuk kebiasaan itu.',
    args: {
      kebiasaan: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nama: { type: 'string' },
            pemicu: { type: 'string', description: 'Setelah apa kebiasaan ini dilakukan, misal "setelah sarapan"' },
            dua_menit: { type: 'string', description: 'Versi terkecil yang tetap dihitung, misal "buka buku satu halaman"' },
            jam: { type: 'string', description: 'Jam pengingat HH:MM, kosongkan kalau tidak disebut' },
          },
          required: ['nama'],
        },
      },
    },
    required: ['kebiasaan'],
    async run(ctx, args) {
      const raw = args.kebiasaan;
      if (!Array.isArray(raw) || raw.length === 0) throw new ToolError('"kebiasaan" tidak boleh kosong');

      const now = Math.floor(Date.now() / 1000);
      const ids: string[] = [];
      const nama: string[] = [];
      const statements = raw.slice(0, 10).flatMap((item) => {
        if (typeof item !== 'object' || item === null) return [];
        const o = item as Record<string, unknown>;
        const n = typeof o.nama === 'string' ? o.nama.trim().slice(0, 120) : '';
        if (!n) return [];

        const id = nanoid();
        ids.push(id);
        nama.push(n);
        const jam = typeof o.jam === 'string' && /^\d{2}:\d{2}$/.test(o.jam) ? o.jam : null;

        return [ctx.db.prepare(
          `INSERT INTO habits (id, user_id, name, color, icon, trigger_cue, two_min, goal_ids, created_at, action_time)
           VALUES (?1, ?2, ?3, '#34C759', 'check', ?4, ?5, '[]', ?6, ?7)`
        ).bind(
          id, ctx.userId, n,
          typeof o.pemicu === 'string' && o.pemicu.trim() ? o.pemicu.trim().slice(0, 200) : null,
          typeof o.dua_menit === 'string' && o.dua_menit.trim() ? o.dua_menit.trim().slice(0, 200) : null,
          now, jam
        )];
      });

      if (statements.length === 0) throw new ToolError('tidak ada kebiasaan yang bisa dibaca');
      await ctx.db.batch(statements);
      return { ringkasan: `${nama.length} kebiasaan dibuat: ${nama.join(', ')}.`, ids };
    },
  },

  {
    name: 'kalender.tambah',
    table: 'calendar_events',
    module: 'kalender',
    risk: 'aman',
    description: 'Menambahkan agenda, tugas, atau pengingat ke kalender.',
    args: {
      judul: { type: 'string' },
      tanggal: { type: 'string', description: 'YYYY-MM-DD. Hitung dari tanggal hari ini yang diberikan.' },
      jam: { type: 'string', description: 'HH:MM 24 jam, kosongkan kalau seharian' },
      jenis: { type: 'string', enum: ['task', 'event', 'reminder'], description: 'task untuk yang harus dikerjakan, event untuk acara, reminder untuk pengingat' },
      catatan: { type: 'string' },
    },
    required: ['judul', 'tanggal'],
    async run(ctx, args) {
      const judul = teks(args, 'judul', 200);
      const tgl = tanggal(args, 'tanggal', ctx.today);
      const jenisRaw = teksOpsional(args, 'jenis', 20) ?? 'event';
      const jenis = ['task', 'event', 'reminder'].includes(jenisRaw) ? jenisRaw : 'event';
      const jam = typeof args.jam === 'string' && /^\d{2}:\d{2}$/.test(args.jam) ? args.jam : null;

      const id = nanoid();
      const now = Math.floor(Date.now() / 1000);
      await ctx.db.prepare(
        `INSERT INTO calendar_events
           (id, user_id, title, note, kind, event_date, event_time, is_done, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)`
      ).bind(id, ctx.userId, judul, teksOpsional(args, 'catatan', 500), jenis, tgl, jam, now).run();

      return { ringkasan: `"${judul}" ditambahkan ke ${tgl}.`, ids: [id] };
    },
  },

  {
    name: 'catatan.buat',
    table: 'notes',
    module: 'catatan',
    risk: 'aman',
    description: 'Menyimpan catatan bebas. Pakai kalau pengguna minta sesuatu dicatat, dirangkum, atau disimpan untuk dibaca lagi nanti.',
    args: {
      isi: { type: 'string', description: 'Isi catatan lengkap.' },
      ringkasan: { type: 'string', description: 'Satu baris ringkasan untuk daftar catatan.' },
    },
    required: ['isi'],
    async run(ctx, args) {
      const isi = teks(args, 'isi', 8000);
      const id = nanoid();
      const now = Math.floor(Date.now() / 1000);
      await ctx.db.prepare(
        'INSERT INTO notes (id, user_id, body, summary, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)'
      ).bind(id, ctx.userId, isi, teksOpsional(args, 'ringkasan', 200), now).run();

      return { ringkasan: 'Catatan disimpan.', ids: [id] };
    },
  },

  {
    name: 'proyek.tambah_tugas',
    table: 'tasks',
    module: 'proyek',
    risk: 'aman',
    description: 'Menambahkan tugas ke sebuah proyek. Proyek dibuat otomatis kalau namanya belum ada.',
    args: {
      proyek: { type: 'string', description: 'Nama proyek.' },
      tugas: { type: 'array', items: { type: 'string' }, description: 'Daftar tugas.' },
    },
    required: ['proyek', 'tugas'],
    async run(ctx, args) {
      const namaProyek = teks(args, 'proyek', 120);
      const tugas = daftarTeks(args, 'tugas', 20);

      let proyek = await ctx.db.prepare(
        'SELECT id FROM projects WHERE user_id = ?1 AND LOWER(name) = LOWER(?2) LIMIT 1'
      ).bind(ctx.userId, namaProyek).first<{ id: string }>();

      const now = Math.floor(Date.now() / 1000);
      if (!proyek) {
        const pid = nanoid();
        await ctx.db.prepare(
          'INSERT INTO projects (id, user_id, name, created_at) VALUES (?1, ?2, ?3, ?4)'
        ).bind(pid, ctx.userId, namaProyek, now).run();
        proyek = { id: pid };
      }

      const ids: string[] = [];
      const statements = tugas.map((t, i) => {
        const id = nanoid();
        ids.push(id);
        return ctx.db.prepare(
          // 'backlog', bukan 'todo': itu nilai yang dipakai seluruh jalur tulis
          // lain, dan layar Proyek menyaring berdasarkan nilai itu.
          `INSERT INTO tasks (id, project_id, user_id, name, status, sort_order, created_at)
           VALUES (?1, ?2, ?3, ?4, 'backlog', ?5, ?6)`
        ).bind(id, proyek.id, ctx.userId, t, i, now);
      });

      await ctx.db.batch(statements);
      return { ringkasan: `${tugas.length} tugas ditambahkan ke proyek ${namaProyek}.`, ids };
    },
  },

  {
    name: 'nutrisi.catat_makan',
    table: 'food_logs',
    module: 'nutrisi',
    risk: 'aman',
    description:
      'Mencatat makanan yang dimakan beserta perkiraan gizinya. Perkirakan kalori dan protein dari porsi yang disebutkan.',
    args: {
      makanan: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nama: { type: 'string' },
            porsi: { type: 'string', description: 'Misal "1 piring", "200 gram"' },
            kalori: { type: 'number' },
            protein: { type: 'number', description: 'Gram protein' },
            label: { type: 'string', enum: ['sarapan', 'makan siang', 'makan malam', 'camilan'] },
          },
          required: ['nama'],
        },
      },
    },
    required: ['makanan'],
    async run(ctx, args) {
      const raw = args.makanan;
      if (!Array.isArray(raw) || raw.length === 0) throw new ToolError('"makanan" tidak boleh kosong');

      const ids: string[] = [];
      const nama: string[] = [];
      const statements = raw.slice(0, 10).flatMap((item) => {
        if (typeof item !== 'object' || item === null) return [];
        const o = item as Record<string, unknown>;
        const n = typeof o.nama === 'string' ? o.nama.trim().slice(0, 120) : '';
        if (!n) return [];

        const id = nanoid();
        ids.push(id);
        nama.push(n);
        const num = (key: string) =>
          typeof o[key] === 'number' && Number.isFinite(o[key] as number) && (o[key] as number) >= 0
            ? (o[key] as number)
            : null;

        return [ctx.db.prepare(
          `INSERT INTO food_logs (id, user_id, food_name, portion, calories, protein_g, label, log_date)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
        ).bind(
          id, ctx.userId, n,
          typeof o.porsi === 'string' && o.porsi.trim() ? o.porsi.trim().slice(0, 60) : null,
          num('kalori'), num('protein'),
          typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 30) : null,
          ctx.today
        )];
      });

      if (statements.length === 0) throw new ToolError('tidak ada makanan yang bisa dibaca');
      await ctx.db.batch(statements);
      return { ringkasan: `${nama.length} makanan dicatat: ${nama.join(', ')}.`, ids };
    },
  },

  {
    name: 'masakan.simpan_resep',
    table: 'cooking_recipes',
    module: 'masakan',
    risk: 'aman',
    description:
      'Menyimpan sebuah resep. Pisahkan bahan yang sudah dimiliki pengguna dari yang harus dibeli, berdasarkan daftar bahan yang diberikan.',
    args: {
      nama: { type: 'string', description: 'Nama masakan.' },
      bahan_ada: { type: 'array', items: { type: 'string' }, description: 'Bahan yang ada di inventaris pengguna.' },
      bahan_kurang: { type: 'array', items: { type: 'string' }, description: 'Bahan yang harus dibeli.' },
      langkah: { type: 'array', items: { type: 'string' } },
      menit: { type: 'number' },
      porsi: { type: 'number' },
    },
    required: ['nama'],
    async run(ctx, args) {
      const nama = teks(args, 'nama', 120);
      const bersih = (key: string, max: number): string[] =>
        Array.isArray(args[key])
          ? (args[key] as unknown[])
              .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
              .map((x) => x.trim().slice(0, 300))
              .slice(0, max)
          : [];

      // Pemilahan ada/kurang dihitung ulang terhadap inventaris, tidak diambil
      // dari jawaban model.
      //
      // Aturannya sama dengan /cooking/suggest dan ditulis di lib/cooking.ts:
      // model boleh mengarang resep, tapi tidak boleh mengarang isi kulkas.
      // Kalau klaimnya diterima apa adanya, resep tersimpan bisa mengatakan
      // "bahan lengkap" untuk sesuatu yang bahannya tidak pernah dibeli.
      const rows = await ctx.db.prepare(
        `SELECT name, quantity, unit FROM inventory_items
          WHERE user_id = ?1 AND quantity > 0 LIMIT 200`
      ).bind(ctx.userId).all<{ name: string; quantity: number; unit: string | null }>();

      const stok: StockItem[] = (rows.results ?? []).map((r) => ({
        name: r.name, quantity: r.quantity, unit: r.unit, daysLeft: null,
      }));

      const { have, missing } = pilahBahan(
        [...bersih('bahan_ada', 20), ...bersih('bahan_kurang', 20)],
        stok
      );

      const id = nanoid();
      await ctx.db.prepare(
        `INSERT INTO cooking_recipes
           (id, user_id, name, have_json, missing_json, steps_json, minutes, servings)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      ).bind(
        id, ctx.userId, nama,
        JSON.stringify(have), JSON.stringify(missing), JSON.stringify(bersih('langkah', 12)),
        typeof args.menit === 'number' && args.menit > 0 ? Math.round(args.menit) : null,
        typeof args.porsi === 'number' && args.porsi > 0 ? Math.round(args.porsi) : null
      ).run();

      const kurang = missing.length > 0 ? ` Kurang: ${missing.join(', ')}.` : '';
      return { ringkasan: `Resep "${nama}" disimpan.${kurang}`, ids: [id] };
    },
  },

  {
    name: 'uang.catat',
    table: 'budget_entries',
    module: 'uang',
    risk: 'konfirmasi',
    description:
      'Mencatat pemasukan atau pengeluaran. Selalu dikonfirmasi pengguna dulu, jangan menganggapnya sudah tersimpan.',
    args: {
      jenis: { type: 'string', enum: ['expense', 'income'] },
      jumlah: { type: 'number', description: 'Nominal rupiah penuh tanpa titik. 25rb = 25000.' },
      kategori: { type: 'string' },
      catatan: { type: 'string' },
      tanggal: { type: 'string', description: 'YYYY-MM-DD, kosongkan untuk hari ini.' },
    },
    required: ['jenis', 'jumlah'],
    async run(ctx, args) {
      const jenis = teks(args, 'jenis', 10);
      if (jenis !== 'expense' && jenis !== 'income') throw new ToolError('jenis harus expense atau income');

      const jumlah = Math.round(angka(args, 'jumlah', 0));
      if (jumlah <= 0) throw new ToolError('jumlah harus lebih dari nol');

      const id = nanoid();
      await ctx.db.prepare(
        `INSERT INTO budget_entries (id, user_id, type, amount_idr, category, note, entry_date, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      ).bind(
        id, ctx.userId, jenis, jumlah,
        teksOpsional(args, 'kategori', 60) ?? 'Lainnya',
        teksOpsional(args, 'catatan', 200),
        tanggal(args, 'tanggal', ctx.today),
        Math.floor(Date.now() / 1000)
      ).run();

      return { ringkasan: `${jenis === 'expense' ? 'Pengeluaran' : 'Pemasukan'} Rp${jumlah.toLocaleString('id-ID')} dicatat.`, ids: [id] };
    },
  },
];

export const TOOLS: readonly AgentTool[] = tools;

export const TOOL_BY_NAME = new Map(tools.map((t) => [t.name, t]));

/**
 * Alat yang ditawarkan untuk sebuah layar.
 *
 * Panel di layar Kebun tidak perlu tahu cara mencatat pengeluaran: daftar
 * yang lebih pendek membuat model lebih jarang salah pilih, dan aksi yang
 * muncul selalu masuk akal untuk layar yang sedang dibuka. Tanpa modul —
 * misalnya dari pencarian global — semua alat tersedia.
 */
export function toolsFor(module?: ModuleKey): AgentTool[] {
  if (!module) return [...tools];

  const scoped = tools.filter((t) => t.module === module);
  if (scoped.length > 0) return scoped;

  // Setiap modul punya alatnya sendiri, dan ada uji yang menjaga itu. Cadangan
  // ini hanya berlaku kalau modul baru ditambahkan tanpa alat — dan yang
  // dikembalikan sengaja bukan seluruh daftar: layar Nutrisi tidak boleh
  // tiba-tiba bisa menulis ke buku kas hanya karena modulnya belum dilengkapi.
  return tools.filter((t) => t.risk === 'aman');
}

/** Skema `guided_json` untuk rencana yang boleh dikembalikan model. */
export function planSchema(available: AgentTool[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      jawaban: {
        type: 'string',
        description: 'Jawaban untuk pengguna dalam bahasa Indonesia, maksimal tiga kalimat. Sebutkan angka nyata dari data yang diberikan.',
      },
      aksi: {
        type: 'array',
        description: 'Aksi yang perlu dijalankan. Kosongkan kalau pengguna hanya bertanya.',
        items: {
          type: 'object',
          properties: {
            alat: { type: 'string', enum: available.map((t) => t.name) },
            argumen: { type: 'object', description: 'Argumen sesuai alat yang dipilih.' },
          },
          required: ['alat', 'argumen'],
        },
      },
    },
    required: ['jawaban'],
  };
}

/** Katalog alat dalam bentuk teks, untuk ditempel ke prompt sistem. */
export function describeTools(available: AgentTool[]): string {
  return available
    .map((t) => {
      const args = Object.entries(t.args)
        .map(([k, v]) => {
          const d = (v as { description?: string }).description;
          return `    ${k}${t.required.includes(k) ? ' (wajib)' : ''}: ${d ?? ''}`;
        })
        .join('\n');
      return `- ${t.name}: ${t.description}\n${args}`;
    })
    .join('\n');
}
