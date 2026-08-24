/**
 * Registry pengaturan.
 *
 * Satu tempat yang mendefinisikan setiap pengaturan: tipe, nilai bawaan,
 * batas, label, dan modul pemiliknya. Tiga akibat yang disengaja:
 *
 * 1. Nilai bawaan hidup di kode, bukan di database. Ia ditinjau seperti kode,
 *    ikut versi, dan tetap benar untuk pengguna baru tanpa seed apa pun.
 * 2. Database hanya menyimpan yang benar-benar diubah pengguna. Mengubah
 *    bawaan di kode langsung berlaku bagi semua yang belum menyentuhnya.
 * 3. UI dirender dari skema ini, bukan ditulis tangan per pengaturan.
 *    Menambah pengaturan baru cukup satu baris di sini.
 */

export type SettingType = 'boolean' | 'number' | 'hour' | 'enum';

export interface SettingDef {
  key: string;
  /** Modul pemilik, dipakai UI untuk mengelompokkan. */
  group: string;
  label: string;
  /** Kenapa pengaturan ini ada dan apa akibatnya kalau diubah. */
  hint?: string;
  type: SettingType;
  default: boolean | number | string;
  min?: number;
  max?: number;
  /** Satuan yang ditampilkan di sebelah input angka. */
  unit?: string;
  options?: Array<{ value: string; label: string }>;
}

export const SETTING_GROUPS: Array<{ id: string; label: string; icon: string }> = [
  { id: 'notifikasi', label: 'Notifikasi', icon: '🔔' },
  { id: 'kebiasaan', label: 'Kebiasaan', icon: '✅' },
  { id: 'uang', label: 'Uang', icon: '💰' },
  { id: 'inventaris', label: 'Inventaris', icon: '📦' },
  { id: 'nutrisi', label: 'Nutrisi', icon: '🍽️' },
  { id: 'kebun', label: 'Kebun', icon: '🌱' },
  { id: 'pola', label: 'Pola', icon: '📊' },
  { id: 'kalender', label: 'Kalender', icon: '📅' },
];

/** Jam kirim dipakai berkali-kali; bentuknya selalu sama. */
const hour = (key: string, label: string, def: number, hint?: string): SettingDef => ({
  key,
  group: 'notifikasi',
  label,
  hint,
  type: 'hour',
  default: def,
  min: 0,
  max: 23,
});

const toggle = (key: string, group: string, label: string, def: boolean, hint?: string): SettingDef => ({
  key,
  group,
  label,
  hint,
  type: 'boolean',
  default: def,
});

export const SETTINGS: SettingDef[] = [
  // ───────────────────────── NOTIFIKASI ─────────────────────────
  toggle('notify.morning_brief', 'notifikasi', 'Pagi Ini', true, 'Ringkasan harian lintas modul.'),
  hour('notify.morning_brief.hour', 'Jam kirim Pagi Ini', 6),

  toggle('notify.bill_radar', 'notifikasi', 'Radar Tagihan', true, 'Tagihan menjelang jatuh tempo.'),
  hour('notify.bill_radar.hour', 'Jam kirim Radar Tagihan', 8),

  toggle('notify.miss_twice', 'notifikasi', 'Jangan Bolos Dua Kali', true, 'Kebiasaan yang terlewat kemarin.'),
  hour('notify.miss_twice.hour', 'Jam kirim Jangan Bolos Dua Kali', 9),

  toggle('notify.kids_prep', 'notifikasi', 'Besok Anak', true, 'Persiapan jadwal anak untuk besok.'),
  hour('notify.kids_prep.hour', 'Jam kirim Besok Anak', 19),

  toggle('notify.garden_care', 'notifikasi', 'Perawatan Kebun', true, 'Siram, pupuk, dan panen.'),
  hour('notify.garden_care.hour', 'Jam kirim Perawatan Kebun', 7),

  toggle('notify.succession', 'notifikasi', 'Semai Berikutnya', true, 'Tanam bergilir agar panen bersambung.'),

  // Dipisah dari Perawatan Kebun: keduanya berangkat dari kebun yang sama tapi
  // menuntut hal berbeda. Sebelumnya keduanya menumpang satu sakelar, sehingga
  // mematikan pengingat panen berarti ikut mematikan pengingat siram.
  toggle('notify.harvest_due', 'notifikasi', 'Menjelang Panen', true, 'Perkiraan panen dalam 3 hari ke depan.'),
  toggle('notify.garden_followup', 'notifikasi', 'Tindak Lanjut Kebun', true, 'Penilaian penanganan hama dan bibit siap pindah.'),

  toggle('notify.expiry', 'notifikasi', 'Stok Mau Kedaluwarsa', true),
  hour('notify.expiry.hour', 'Jam kirim Stok Kedaluwarsa', 8),

  toggle('notify.streak_at_risk', 'notifikasi', 'Streak Terancam', true, 'Kebiasaan berstreak yang belum selesai malam ini.'),
  hour('notify.streak_at_risk.hour', 'Jam kirim Streak Terancam', 20),

  toggle('notify.weekly_recap', 'notifikasi', 'Rekap Mingguan', true, 'Dikirim Minggu malam.'),
  toggle('notify.habit_reminder', 'notifikasi', 'Pengingat Kebiasaan', true, 'Sesuai jam tiap kebiasaan.'),
  toggle('notify.calendar_reminder', 'notifikasi', 'Pengingat Kalender', true),

  // ───────────────────────── KEBIASAAN ─────────────────────────
  {
    key: 'habit.day_start',
    group: 'kebiasaan',
    label: 'Mulai hari',
    hint: 'Batas paling pagi saat menyarankan geser jadwal kebiasaan.',
    type: 'hour',
    default: 5,
    min: 0,
    max: 23,
  },
  {
    key: 'habit.day_end',
    group: 'kebiasaan',
    label: 'Akhir hari',
    hint: 'Batas paling malam untuk saran geser jadwal.',
    type: 'hour',
    default: 22,
    min: 1,
    max: 23,
  },
  {
    key: 'habit.slot_minutes',
    group: 'kebiasaan',
    label: 'Durasi satu kebiasaan',
    hint: 'Dipakai saat memeriksa bentrok dengan agenda.',
    type: 'number',
    default: 30,
    min: 5,
    max: 180,
    unit: 'menit',
  },

  // ─────────────────────────── UANG ───────────────────────────
  {
    key: 'money.bill_horizon_days',
    group: 'uang',
    label: 'Radar tagihan',
    hint: 'Berapa hari sebelum jatuh tempo mulai diingatkan.',
    type: 'number',
    default: 3,
    min: 1,
    max: 30,
    unit: 'hari',
  },
  toggle(
    'money.subtract_bills',
    'uang',
    'Potong tagihan dari sisa aman',
    true,
    'Uang yang sudah punya tujuan tidak dihitung sebagai bisa dipakai.'
  ),

  // ───────────────────────── INVENTARIS ─────────────────────────
  {
    key: 'inventory.expiry_days',
    group: 'inventaris',
    label: 'Ambang mendesak',
    hint: 'Stok dianggap mendesak bila kedaluwarsa dalam sekian hari.',
    type: 'number',
    default: 3,
    min: 1,
    max: 30,
    unit: 'hari',
  },

  // ─────────────────────────── NUTRISI ───────────────────────────
  // Bawaannya Angka Label Gizi umum Indonesia. Bisa diubah karena kebutuhan
  // tiap orang berbeda — angka nasional hanya titik awal, bukan target pribadi.
  { key: 'nutrition.calories', group: 'nutrisi', label: 'Target kalori', type: 'number', default: 2150, min: 800, max: 6000, unit: 'kkal' },
  { key: 'nutrition.protein', group: 'nutrisi', label: 'Target protein', type: 'number', default: 60, min: 20, max: 400, unit: 'g' },
  { key: 'nutrition.fat', group: 'nutrisi', label: 'Target lemak', type: 'number', default: 67, min: 10, max: 300, unit: 'g' },
  { key: 'nutrition.carbs', group: 'nutrisi', label: 'Target karbohidrat', type: 'number', default: 325, min: 20, max: 800, unit: 'g' },
  { key: 'nutrition.sugar', group: 'nutrisi', label: 'Batas gula', type: 'number', default: 50, min: 5, max: 200, unit: 'g' },
  { key: 'nutrition.sodium', group: 'nutrisi', label: 'Batas natrium', type: 'number', default: 1500, min: 200, max: 5000, unit: 'mg' },
  {
    key: 'nutrition.warning_pct',
    group: 'nutrisi',
    label: 'Ambang peringatan',
    hint: 'Peringatan muncul bila satu sajian melewati persentase ini dari acuan harian.',
    type: 'number',
    default: 20,
    min: 5,
    max: 100,
    unit: '%',
  },

  // ──────────────────────────── KEBUN ────────────────────────────
  {
    key: 'garden.rain_skip_mm',
    group: 'kebun',
    label: 'Hujan pengganti siram',
    hint: 'Hujan sebanyak ini dianggap sudah menggantikan satu kali siram.',
    type: 'number',
    default: 5,
    min: 1,
    max: 50,
    unit: 'mm',
  },
  {
    key: 'garden.rain_soaked_mm',
    group: 'kebun',
    label: 'Hujan yang menjenuhkan tanah',
    hint: 'Di atas ini, menyiram esoknya berisiko membusukkan akar.',
    type: 'number',
    default: 20,
    min: 5,
    max: 100,
    unit: 'mm',
  },
  {
    key: 'garden.succession_days',
    group: 'kebun',
    label: 'Peringatan semai',
    hint: 'Berapa hari sebelum waktunya menyemai mulai diingatkan.',
    type: 'number',
    default: 3,
    min: 0,
    max: 21,
    unit: 'hari',
  },

  // ───────────────────────────── POLA ─────────────────────────────
  {
    key: 'patterns.min_days',
    group: 'pola',
    label: 'Minimal hari per sisi',
    hint: 'Semakin tinggi, semakin sedikit pola yang muncul tapi semakin kuat buktinya.',
    type: 'number',
    default: 5,
    min: 3,
    max: 30,
    unit: 'hari',
  },
  {
    key: 'patterns.min_gap',
    group: 'pola',
    label: 'Selisih minimal',
    hint: 'Selisih penyelesaian yang dianggap cukup berarti untuk disebut pola.',
    type: 'number',
    default: 15,
    min: 5,
    max: 60,
    unit: 'poin',
  },

  // ─────────────────────────── KALENDER ───────────────────────────
  {
    key: 'calendar.default_event_minutes',
    group: 'kalender',
    label: 'Perkiraan durasi agenda',
    hint: 'Agenda tidak menyimpan durasi; angka ini dipakai saat memeriksa bentrok.',
    type: 'number',
    default: 60,
    min: 15,
    max: 480,
    unit: 'menit',
  },
];

export const SETTING_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

export type SettingValue = boolean | number | string;

/**
 * Paksa nilai masuk akal menurut definisinya.
 *
 * Mengembalikan null kalau tidak bisa diselamatkan, supaya pemanggil bisa
 * menolak alih-alih menyimpan sesuatu yang akan merusak fitur diam-diam —
 * jam 99 atau ambang negatif tidak akan pernah menghasilkan perilaku benar.
 */
export function coerceSetting(def: SettingDef, raw: unknown): SettingValue | null {
  switch (def.type) {
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 1) return true;
      if (raw === 'false' || raw === 0) return false;
      return null;

    case 'hour':
    case 'number': {
      // Number(null), Number('') dan Number([]) semuanya 0 — yang terhitung
      // valid untuk jam dan akan diam-diam menyetelnya ke tengah malam.
      // Hanya angka dan string berisi angka yang boleh lewat.
      if (typeof raw !== 'number' && typeof raw !== 'string') return null;
      if (typeof raw === 'string' && raw.trim() === '') return null;

      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      const rounded = def.type === 'hour' ? Math.round(n) : n;
      if (def.min !== undefined && rounded < def.min) return null;
      if (def.max !== undefined && rounded > def.max) return null;
      return rounded;
    }

    case 'enum':
      return typeof raw === 'string' && def.options?.some((o) => o.value === raw) ? raw : null;
  }
}
