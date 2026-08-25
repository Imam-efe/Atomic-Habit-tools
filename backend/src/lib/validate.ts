/**
 * validate.ts — Input validation utility for backend routes.
 *
 * Usage:
 *   const err = validate(body, {
 *     name:   { type: 'string' },
 *     type:   { type: 'enum', values: ['income', 'expense'] },
 *     amount: { type: 'number', min: 1 },
 *   });
 *   if (err) return c.json({ error: err }, 400);
 */

type StringRule = { type: 'string'; min?: number };
type NumberRule = { type: 'number'; min?: number };
type EnumRule   = { type: 'enum'; values: readonly string[] };
type DateRule   = { type: 'date' };   // YYYY-MM-DD, required
type TimeRule   = { type: 'time' };   // HH:MM, required
type MonthRule  = { type: 'month' };  // YYYY-MM, required

type FieldRule = StringRule | NumberRule | EnumRule | DateRule | TimeRule | MonthRule;

/**
 * Validates body against rules.
 * Returns an error string on first failure, or null if valid.
 * All rules treat the field as required unless the field is absent and you only
 * need optional format checks — use the standalone helpers below for that.
 */
export function validate(
  body: Record<string, unknown>,
  rules: Record<string, FieldRule>
): string | null {
  for (const [field, rule] of Object.entries(rules)) {
    const value = body[field];

    switch (rule.type) {
      case 'string': {
        if (typeof value !== 'string' || !value.trim()) {
          return `${field} is required`;
        }
        if (rule.min !== undefined && value.trim().length < rule.min) {
          return `${field} must be at least ${rule.min} characters`;
        }
        break;
      }
      case 'number': {
        if (value === undefined || value === null || typeof value !== 'number' || isNaN(value)) {
          return `${field} must be a number`;
        }
        if (rule.min !== undefined && value < rule.min) {
          return `${field} must be >= ${rule.min}`;
        }
        break;
      }
      case 'enum': {
        if (typeof value !== 'string' || !rule.values.includes(value)) {
          return `${field} must be one of: ${rule.values.join(', ')}`;
        }
        break;
      }
      case 'date': {
        if (typeof value !== 'string' || !isDate(value)) {
          return `${field} must be a date (YYYY-MM-DD)`;
        }
        break;
      }
      case 'time': {
        if (typeof value !== 'string' || !isTime(value)) {
          return `${field} must be a time (HH:MM)`;
        }
        break;
      }
      case 'month': {
        if (typeof value !== 'string' || !isMonth(value)) {
          return `${field} must be a month (YYYY-MM)`;
        }
        break;
      }
    }
  }
  return null;
}

/** YYYY-MM-DD */
export const isDate  = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** HH:MM */
export const isTime  = (s: string): boolean => /^\d{2}:\d{2}$/.test(s);

/** YYYY-MM */
export const isMonth = (s: string): boolean => /^\d{4}-\d{2}$/.test(s);

/** Returns today's date in Jakarta timezone (UTC+7) as YYYY-MM-DD */
export function jakartaToday(): string {
  const now = new Date();
  const jakarta = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return jakarta.toISOString().slice(0, 10);
}

/**
 * Baca JSON yang tersimpan di kolom teks, tanpa ikut menjatuhkan rutenya.
 *
 * Kolom seperti `habits.goal_ids` ditulis oleh aplikasi sendiri, jadi isinya
 * "pasti" JSON — sampai sebuah berkas backup hasil suntingan tangan diimpor.
 * Satu baris rusak membuat `JSON.parse` melempar di tengah `map()`, dan yang
 * gagal bukan baris itu melainkan SELURUH daftar kebiasaan: layar utama
 * menjawab 500 dan tidak ada jalan memperbaikinya dari dalam aplikasi.
 */
export function parseTersimpan<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/**
 * Bulan berjalan menurut WIB, YYYY-MM.
 *
 * Sama alasannya dengan `jakartaToday()`, tapi salahnya lebih jarang dan lebih
 * membingungkan: hanya pada tanggal 1 antara tengah malam dan pukul tujuh pagi
 * WIB, dan yang terjadi bukan selisih satu hari melainkan seluruh layar
 * menampilkan bulan yang sudah lewat.
 */
export function jakartaMonth(): string {
  return jakartaToday().slice(0, 7);
}

/** Advance a YYYY-MM-DD date by the given recurrence interval */
export function advanceDate(dateStr: string, recurrence: 'daily' | 'weekly' | 'monthly'): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (recurrence === 'daily') dt.setDate(dt.getDate() + 1);
  else if (recurrence === 'weekly') dt.setDate(dt.getDate() + 7);
  else if (recurrence === 'monthly') {
    // setMonth alone doesn't clamp day-of-month: Jan 31 + 1 month would
    // overflow into March 3 instead of landing on Feb's last day. Passing
    // the clamped day to setMonth sets year/month/day atomically instead.
    const lastDayOfTarget = new Date(y, m + 1, 0).getDate();
    dt.setMonth(dt.getMonth() + 1, Math.min(d, lastDayOfTarget));
  }
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
