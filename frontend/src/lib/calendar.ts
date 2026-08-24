/**
 * Date helpers for the calendar screen: Indonesian names, month grids, and the
 * two extra calendars an Indonesian date is usually read alongside — Hijri and
 * the Javanese pasaran cycle.
 *
 * Everything here is arithmetic on a local date. No Date parsing of strings
 * (`new Date('2026-08-22')` is UTC and shifts the day in GMT+7), no timezone
 * library, no I/O.
 */

// toISO dan todayISO tinggal di lib/date.ts — dulu tiap layar punya salinannya
// sendiri dan sebagian memakai toISOString(), yang menggeser hari di GMT+7.
// Diteruskan dari sini supaya pemanggil lama tidak perlu diubah.
import { toISO, todayISO } from './date';
export { toISO, todayISO };

export const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
/** Monday-first, matching how Indonesian calendars are printed. */
export const DAY_INITIALS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
export const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** Parses YYYY-MM-DD as a local date, not UTC. */
export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const ms = fromISO(b).getTime() - fromISO(a).getTime();
  return Math.round(ms / 86400000);
}

/** e.g. "Sabtu, 22 Agustus 2026" */
export function formatLong(iso: string): string {
  const d = fromISO(iso);
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** e.g. "22 Ags" */
export function formatShort(iso: string): string {
  const d = fromISO(iso);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
}

export function isWeekend(iso: string): boolean {
  const wd = fromISO(iso).getDay();
  return wd === 0 || wd === 6;
}

export interface GridCell {
  iso: string;
  day: number;
  /** False for the leading/trailing days borrowed from adjacent months. */
  inMonth: boolean;
}

/**
 * Six-week grid for a month, Monday-first. Always 42 cells so the grid does not
 * change height between months — a reflowing calendar is worse than a row of
 * greyed-out cells.
 */
export function monthGrid(year: number, month: number): GridCell[] {
  const first = new Date(year, month, 1);
  // getDay() is Sunday-first; shift so Monday is 0.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);

  const cells: GridCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ iso: toISO(d), day: d.getDate(), inMonth: d.getMonth() === month });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Hijri
// ---------------------------------------------------------------------------

const HIJRI_MONTHS = [
  'Muharram', 'Safar', 'Rabiul Awal', 'Rabiul Akhir', 'Jumadil Awal', 'Jumadil Akhir',
  'Rajab', 'Syaban', 'Ramadan', 'Syawal', 'Zulkaidah', 'Zulhijah',
];

/** Julian Day Number for a Gregorian date. */
function julianDay(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy
    + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

export interface HijriDate {
  day: number;
  month: number;
  year: number;
  monthName: string;
  /** e.g. "9 Rabiul Awal 1448 H" */
  label: string;
}

/**
 * Tabular (arithmetical) Islamic calendar.
 *
 * This is a fixed 30-year cycle, not an observation of the moon, so it can sit
 * a day either side of the date Indonesia actually announces — Ramadan and the
 * two Ids in particular are set by rukyat and sidang isbat. Fine for showing
 * alongside a Gregorian date; not what the holiday dates are derived from.
 * Those are pinned per year in data/holidays.ts from the official decree.
 */
export function toHijri(iso: string): HijriDate {
  const d = fromISO(iso);
  const jd = julianDay(d.getFullYear(), d.getMonth() + 1, d.getDate());

  // Days elapsed since the Islamic epoch (1 Muharram 1 AH = JD 1948439.5).
  const days = jd - 1948440 + 10632;
  const n = Math.floor((days - 1) / 10631);
  const rem1 = days - 10631 * n + 354;
  const j = Math.floor((10985 - rem1) / 5316) * Math.floor((50 * rem1) / 17719)
    + Math.floor(rem1 / 5670) * Math.floor((43 * rem1) / 15238);
  const rem2 = rem1 - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50)
    - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;

  const month = Math.floor((24 * rem2) / 709);
  const day = rem2 - Math.floor((709 * month) / 24);
  const year = 30 * n + j - 30;

  const monthName = HIJRI_MONTHS[Math.min(11, Math.max(0, month - 1))];
  return { day, month, year, monthName, label: `${day} ${monthName} ${year} H` };
}

// ---------------------------------------------------------------------------
// Javanese pasaran
// ---------------------------------------------------------------------------

const PASARAN = ['Legi', 'Pahing', 'Pon', 'Wage', 'Kliwon'];

/**
 * Javanese five-day market cycle, paired with the weekday to give the weton.
 *
 * Anchored on 17 August 1945, which is documented as Jumat Legi — the weton of
 * the proclamation, and the reference most Indonesian sources calibrate to.
 */
const PASARAN_ANCHOR = '1945-08-17';

export function pasaranOf(iso: string): string {
  const diff = daysBetween(PASARAN_ANCHOR, iso);
  return PASARAN[((diff % 5) + 5) % 5];
}

/** e.g. "Sabtu Pahing" */
export function wetonOf(iso: string): string {
  return `${DAY_NAMES[fromISO(iso).getDay()]} ${pasaranOf(iso)}`;
}
