/**
 * Ringkasan data nyata pengguna, untuk disuntikkan ke prompt.
 *
 * Selama ini tiap fitur AI menyusun konteksnya sendiri, dan yang tidak
 * sempat menyusun apa-apa menjawab dari pengetahuan umum: benar secara
 * umum, tidak berguna secara pribadi. "Bagaimana caranya hemat?" dijawab
 * dengan nasihat yang sama untuk semua orang, padahal jawabannya ada di
 * catatan belanjanya sendiri.
 *
 * Berkas ini menyusun potret padat lintas modul sekali saja, lalu dipakai
 * bersama oleh panel AI di tiap layar dan oleh agen. Padat itu disengaja:
 * jendela konteks model kecil, jadi yang dikirim adalah angka yang sudah
 * dihitung dan beberapa baris teratas — bukan seluruh isi tabel.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { jadwalPengguna } from '../routes/ternak_care';
import { HARI_TES_AIR } from './ternak_air';

/** Modul yang punya potret sendiri. Sama dengan tab dan sub-layar di aplikasi. */
export const MODULES = [
  'kebiasaan', 'uang', 'inventaris', 'kebun', 'kalender',
  'catatan', 'proyek', 'nutrisi', 'masakan', 'ternak',
] as const;

export type ModuleKey = (typeof MODULES)[number];

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (MODULES as readonly string[]).includes(value);
}

/** Rupiah ringkas — 1.250.000 jadi "1,3jt" supaya hemat token. */
export function ringkasRupiah(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}jt`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}rb`;
  return String(Math.round(n));
}

/** Selisih hari antara dua tanggal YYYY-MM-DD. */
export function selisihHari(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function shiftISO(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

type Builder = (db: D1Database, userId: string, today: string) => Promise<string[]>;

const buildKebiasaan: Builder = async (db, userId, today) => {
  const rows = await db.prepare(
    `SELECT name, streak, last_completed_date, two_min
       FROM habits WHERE user_id = ?1 ORDER BY sort_order ASC LIMIT 12`
  ).bind(userId).all<{ name: string; streak: number; last_completed_date: string | null; two_min: string | null }>();

  const habits = rows.results ?? [];
  if (habits.length === 0) return ['Belum ada kebiasaan yang dicatat.'];

  const selesai = habits.filter((h) => h.last_completed_date === today);
  const lines = [`${selesai.length}/${habits.length} kebiasaan selesai hari ini.`];
  for (const h of habits) {
    const status = h.last_completed_date === today ? 'sudah' : 'belum';
    lines.push(`- ${h.name}: ${status} hari ini, rentetan ${h.streak} hari${h.two_min ? `, versi 2 menit: ${h.two_min}` : ''}`);
  }
  return lines;
};

const buildUang: Builder = async (db, userId, today) => {
  // Batas atasnya hari ini, bukan akhir bulan: entri berulang disimpan dengan
  // tanggal jatuh tempo berikutnya, dan tanpa batas ini tagihan yang belum
  // terjadi ikut terhitung sebagai pengeluaran yang sudah dikeluarkan.
  const awalBulan = `${today.slice(0, 7)}-01`;

  const [totals, kategori, saldo] = await Promise.all([
    db.prepare(
      `SELECT type, COALESCE(SUM(amount_idr), 0) AS total
         FROM budget_entries WHERE user_id = ?1 AND entry_date BETWEEN ?2 AND ?3 GROUP BY type`
    ).bind(userId, awalBulan, today).all<{ type: string; total: number }>(),
    db.prepare(
      `SELECT category, COALESCE(SUM(amount_idr), 0) AS total
         FROM budget_entries
        WHERE user_id = ?1 AND entry_date BETWEEN ?2 AND ?3 AND type = 'expense'
        GROUP BY category ORDER BY total DESC LIMIT 5`
    ).bind(userId, awalBulan, today).all<{ category: string; total: number }>(),
    db.prepare(
      'SELECT name, balance FROM bank_accounts WHERE user_id = ?1 ORDER BY balance DESC LIMIT 5'
    ).bind(userId).all<{ name: string; balance: number }>(),
  ]);

  const masuk = (totals.results ?? []).find((r) => r.type === 'income')?.total ?? 0;
  const keluar = (totals.results ?? []).find((r) => r.type === 'expense')?.total ?? 0;
  if (masuk === 0 && keluar === 0 && (saldo.results ?? []).length === 0) {
    return ['Belum ada catatan keuangan bulan ini.'];
  }

  const lines = [`Bulan ini: masuk ${ringkasRupiah(masuk)}, keluar ${ringkasRupiah(keluar)}, sisa ${ringkasRupiah(masuk - keluar)}.`];
  const top = kategori.results ?? [];
  if (top.length > 0) {
    lines.push(`Pengeluaran terbesar: ${top.map((k) => `${k.category} ${ringkasRupiah(k.total)}`).join(', ')}.`);
  }
  for (const s of saldo.results ?? []) lines.push(`- Rekening ${s.name}: ${ringkasRupiah(s.balance)}`);
  return lines;
};

const buildInventaris: Builder = async (db, userId, today) => {
  const rows = await db.prepare(
    `SELECT name, quantity, unit, expiry_date, category
       FROM inventory_items WHERE user_id = ?1
      ORDER BY COALESCE(expiry_date, '9999-12-31') ASC LIMIT 30`
  ).bind(userId).all<{ name: string; quantity: number; unit: string | null; expiry_date: string | null; category: string | null }>();

  const items = rows.results ?? [];
  if (items.length === 0) return ['Inventaris kosong.'];

  const lines = [`${items.length} jenis barang di inventaris.`];
  for (const i of items) {
    const sisa = i.expiry_date ? selisihHari(today, i.expiry_date) : null;
    const umur = sisa === null ? '' : sisa < 0 ? ', SUDAH KEDALUWARSA' : sisa <= 3 ? `, kedaluwarsa ${sisa} hari lagi` : '';
    lines.push(`- ${i.name}: ${i.quantity}${i.unit ? ` ${i.unit}` : ''}${umur}`);
  }
  return lines;
};

const buildKebun: Builder = async (db, userId, today) => {
  const rows = await db.prepare(
    `SELECT p.id, p.plant_id, p.custom_name, p.nickname, p.location, p.quantity,
            p.planted_date, p.expected_harvest_date, p.status,
            (SELECT MAX(action_date) FROM garden_care_log c
              WHERE c.planting_id = p.id AND c.action = 'siram') AS last_water
       FROM garden_plantings p
      WHERE p.user_id = ?1 AND p.status = 'tumbuh'
      ORDER BY p.planted_date DESC LIMIT 20`
  ).bind(userId).all<{
    id: string; plant_id: string | null; custom_name: string | null; nickname: string | null;
    location: string | null; quantity: number; planted_date: string;
    expected_harvest_date: string | null; status: string; last_water: string | null;
  }>();

  const plantings = rows.results ?? [];
  if (plantings.length === 0) return ['Belum ada tanaman yang sedang tumbuh.'];

  const lines = [`${plantings.length} tanaman sedang tumbuh.`];
  for (const p of plantings) {
    const nama = p.nickname ?? p.custom_name ?? p.plant_id ?? 'tanaman';
    const umur = selisihHari(p.planted_date, today);
    const siram = p.last_water ? `terakhir disiram ${selisihHari(p.last_water, today)} hari lalu` : 'belum pernah dicatat disiram';
    const panen = p.expected_harvest_date ? `, perkiraan panen ${p.expected_harvest_date}` : '';
    lines.push(`- ${nama} (${p.quantity}${p.location ? `, ${p.location}` : ''}): umur ${umur} hari, ${siram}${panen}`);
  }
  return lines;
};

const buildKalender: Builder = async (db, userId, today) => {
  const rows = await db.prepare(
    `SELECT title, kind, event_date, event_time, is_done, priority
       FROM calendar_events
      WHERE user_id = ?1 AND event_date BETWEEN ?2 AND ?3
      ORDER BY event_date ASC, COALESCE(event_time, '99:99') ASC LIMIT 20`
  ).bind(userId, today, shiftISO(today, 7)).all<{
    title: string; kind: string; event_date: string; event_time: string | null;
    is_done: number; priority: string | null;
  }>();

  const events = rows.results ?? [];
  if (events.length === 0) return ['Tidak ada agenda dalam tujuh hari ke depan.'];

  const lines: string[] = [];
  for (const e of events) {
    const kapan = e.event_date === today ? 'hari ini' : e.event_date;
    lines.push(`- ${e.title} (${e.kind}) ${kapan}${e.event_time ? ` ${e.event_time}` : ''}${e.is_done ? ' [selesai]' : ''}`);
  }
  return lines;
};

const buildCatatan: Builder = async (db, userId) => {
  const rows = await db.prepare(
    `SELECT COALESCE(summary, substr(body, 1, 120)) AS ringkas, created_at
       FROM notes WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 8`
  ).bind(userId).all<{ ringkas: string; created_at: number }>();

  const notes = rows.results ?? [];
  if (notes.length === 0) return ['Belum ada catatan.'];
  return notes.map((n) => `- ${n.ringkas.replace(/\s+/g, ' ').trim()}`);
};

const buildProyek: Builder = async (db, userId) => {
  const rows = await db.prepare(
    `SELECT p.name AS proyek, t.name AS tugas, t.status
       FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ?1 AND t.status != 'done'
      ORDER BY t.sort_order ASC LIMIT 20`
  ).bind(userId).all<{ proyek: string; tugas: string; status: string }>();

  const tasks = rows.results ?? [];
  if (tasks.length === 0) return ['Tidak ada tugas yang belum selesai.'];
  return tasks.map((t) => `- [${t.proyek}] ${t.tugas} (${t.status})`);
};

const buildNutrisi: Builder = async (db, userId, today) => {
  const [hari, target] = await Promise.all([
    db.prepare(
      `SELECT COALESCE(SUM(calories), 0) AS kal, COALESCE(SUM(protein_g), 0) AS protein
         FROM food_logs WHERE user_id = ?1 AND log_date = ?2`
    ).bind(userId, today).first<{ kal: number; protein: number }>(),
    db.prepare(
      'SELECT calories, protein_g FROM nutrition_targets WHERE user_id = ?1'
    ).bind(userId).first<{ calories: number; protein_g: number }>(),
  ]);

  if (!hari || (hari.kal === 0 && !target)) return ['Belum ada catatan makan hari ini.'];
  const t = target ? ` dari target ${target.calories} kal / ${target.protein_g} g protein` : '';
  return [`Hari ini: ${Math.round(hari.kal)} kal, ${Math.round(hari.protein)} g protein${t}.`];
};

/**
 * Kandang, hewan, tugas telat, dan peringatan air, dalam satu potret.
 *
 * Memakai jadwalPengguna untuk tugas telat — alasan yang sama dengan
 * getTernakToday dan ketiga push ternak: dua hitungan untuk pertanyaan yang
 * sama pasti menyimpang.
 */
const buildTernak: Builder = async (db, userId, today) => {
  const [kandangRows, hewanRows, semua] = await Promise.all([
    db.prepare(
      `SELECT id, nama, habitat FROM ternak_kandang WHERE user_id = ?1 AND status = 'aktif'`
    ).bind(userId).all<{ id: string; nama: string; habitat: string }>(),
    db.prepare(
      `SELECT jumlah FROM ternak_hewan WHERE user_id = ?1 AND status = 'hidup'`
    ).bind(userId).all<{ jumlah: number }>(),
    jadwalPengguna(db, userId, today),
  ]);

  const kandang = kandangRows.results ?? [];
  const hewan = hewanRows.results ?? [];
  if (kandang.length === 0 && hewan.length === 0) return ['Belum ada kandang atau hewan yang dicatat.'];

  const ekorTotal = hewan.reduce((n, h) => n + h.jumlah, 0);
  const lines = [`${kandang.length} kandang aktif, ${ekorTotal} ekor hidup.`];

  const telat = semua.filter((t) => t.berikutnya <= today);
  const penting = telat.filter((t) => t.penting);
  if (telat.length > 0) {
    lines.push(
      `${telat.length} tugas jatuh tempo${penting.length > 0 ? `, ${penting.length} di antaranya mendesak` : ''}.`
    );
    for (const t of telat.slice(0, 10)) {
      lines.push(`- ${t.nama}: ${t.labelTugas}${t.penting ? ' (mendesak)' : ''}`);
    }
  } else {
    lines.push('Tidak ada tugas ternak yang jatuh tempo.');
  }

  // Peringatan air: kandang berair yang lama tidak dites atau belum pernah.
  const kandangAir = kandang.filter((k) => k.habitat !== 'darat');
  if (kandangAir.length > 0) {
    const lastTests = await db.prepare(
      `SELECT kandang_id, MAX(tanggal) AS last_test FROM ternak_air
         WHERE user_id = ?1 GROUP BY kandang_id`
    ).bind(userId).all<{ kandang_id: string; last_test: string }>();
    const lastMap = new Map((lastTests.results ?? []).map((r) => [r.kandang_id, r.last_test]));

    for (const k of kandangAir) {
      const last = lastMap.get(k.id) ?? null;
      const umur = last ? selisihHari(last, today) : null;
      if (umur === null || umur >= HARI_TES_AIR) {
        lines.push(`- ${k.nama}: air ${umur === null ? 'belum pernah dites' : `sudah ${umur} hari tidak dites`}.`);
      }
    }
  }

  return lines;
};

/**
 * Masakan membaca inventaris — bahan yang dimiliki adalah seluruh dasar
 * saran masak, jadi tidak ada potret terpisah untuknya.
 */
const BUILDERS: Record<ModuleKey, Builder> = {
  kebiasaan: buildKebiasaan,
  uang: buildUang,
  inventaris: buildInventaris,
  kebun: buildKebun,
  kalender: buildKalender,
  catatan: buildCatatan,
  proyek: buildProyek,
  nutrisi: buildNutrisi,
  masakan: buildInventaris,
  ternak: buildTernak,
};

const JUDUL: Record<ModuleKey, string> = {
  kebiasaan: 'KEBIASAAN',
  uang: 'KEUANGAN',
  inventaris: 'INVENTARIS',
  kebun: 'KEBUN',
  kalender: 'AGENDA',
  catatan: 'CATATAN',
  proyek: 'TUGAS & PROYEK',
  nutrisi: 'NUTRISI',
  masakan: 'BAHAN DI INVENTARIS',
  ternak: 'TERNAK',
};

/**
 * Potret beberapa modul sekaligus, siap ditempel ke prompt.
 *
 * Modul yang kueri-nya gagal dilewati diam-diam: satu tabel bermasalah tidak
 * boleh membuat seluruh jawaban AI hilang, dan bagian yang tersisa masih
 * lebih berguna daripada jawaban generik.
 */
export async function buildContext(
  db: D1Database,
  userId: string,
  modules: readonly ModuleKey[],
  today: string
): Promise<string> {
  const unik = [...new Set(modules)];

  const parts = await Promise.all(
    unik.map(async (m) => {
      try {
        const lines = await BUILDERS[m](db, userId, today);
        return `## ${JUDUL[m]}\n${lines.join('\n')}`;
      } catch {
        return '';
      }
    })
  );

  return parts.filter(Boolean).join('\n\n');
}
