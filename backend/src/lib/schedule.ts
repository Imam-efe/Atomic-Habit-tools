/**
 * schedule.ts — next-run computation for Notification Center reminders.
 *
 * Every wall-clock field is Jakarta time (GMT+7), matching the rest of the app.
 * Timestamps in and out are unix seconds.
 */

const JAKARTA_OFFSET = 7 * 60 * 60;

export type ScheduleType = 'once' | 'interval' | 'daily' | 'weekly';

export interface ScheduleSpec {
  schedule_type: ScheduleType;
  time_of_day?: string | null;
  days_of_week?: string | null;
  interval_minutes?: number | null;
  run_at?: number | null;
  quiet_from?: string | null;
  quiet_to?: string | null;
}

/** Minutes since Jakarta midnight (0..1439) for a unix timestamp */
export function jakartaMinuteOfDay(unix: number): number {
  const shifted = ((unix + JAKARTA_OFFSET) % 86400 + 86400) % 86400;
  return Math.floor(shifted / 60);
}

/** Unix timestamp of the Jakarta midnight opening the day that contains `unix` */
export function jakartaMidnight(unix: number): number {
  return Math.floor((unix + JAKARTA_OFFSET) / 86400) * 86400 - JAKARTA_OFFSET;
}

/** ISO weekday in Jakarta: 1=Monday .. 7=Sunday */
export function jakartaWeekday(unix: number): number {
  const days = Math.floor((unix + JAKARTA_OFFSET) / 86400);
  // 1970-01-01 was a Thursday (ISO 4)
  return ((days + 3) % 7) + 1;
}

/** "HH:MM" → minutes since midnight, or null when malformed */
export function parseHHMM(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** "1,2,3" → sorted unique ISO weekdays, or null when nothing valid is present */
export function parseDaysOfWeek(value: string | null | undefined): number[] | null {
  if (typeof value !== 'string') return null;
  const days = [...new Set(
    value
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
  )].sort((a, b) => a - b);
  return days.length > 0 ? days : null;
}

function inQuietWindow(minuteOfDay: number, from: number, to: number): boolean {
  if (from === to) return false; // zero-width window = quiet hours disabled
  if (from < to) return minuteOfDay >= from && minuteOfDay < to;
  return minuteOfDay >= from || minuteOfDay < to; // window wraps past midnight
}

/**
 * If `unix` lands inside the quiet window, push it to the moment the window ends.
 * Returns `unix` untouched when quiet hours are unset or not in effect.
 */
export function shiftOutOfQuietHours(
  unix: number,
  quietFrom: string | null | undefined,
  quietTo: string | null | undefined
): number {
  const from = parseHHMM(quietFrom);
  const to = parseHHMM(quietTo);
  if (from === null || to === null) return unix;
  if (!inQuietWindow(jakartaMinuteOfDay(unix), from, to)) return unix;

  let candidate = jakartaMidnight(unix) + to * 60;
  if (candidate <= unix) candidate += 86400;
  return candidate;
}

/**
 * Next fire time strictly after `fromUnix`, or null when the schedule is finished.
 *
 * Quiet hours only apply to `interval` schedules — `daily` and `weekly` fire at the
 * exact time the user picked, and `once` fires at the exact moment they picked.
 */
export function computeNextRun(spec: ScheduleSpec, fromUnix: number): number | null {
  switch (spec.schedule_type) {
    case 'once': {
      const runAt = spec.run_at ?? null;
      return runAt !== null && runAt > fromUnix ? runAt : null;
    }

    case 'interval': {
      const minutes = spec.interval_minutes ?? 0;
      if (!Number.isInteger(minutes) || minutes < 1) return null;
      return shiftOutOfQuietHours(fromUnix + minutes * 60, spec.quiet_from, spec.quiet_to);
    }

    case 'daily': {
      const minute = parseHHMM(spec.time_of_day);
      if (minute === null) return null;
      let candidate = jakartaMidnight(fromUnix) + minute * 60;
      if (candidate <= fromUnix) candidate += 86400;
      return candidate;
    }

    case 'weekly': {
      const minute = parseHHMM(spec.time_of_day);
      const days = parseDaysOfWeek(spec.days_of_week);
      if (minute === null || days === null) return null;

      const midnight = jakartaMidnight(fromUnix);
      // Scan 8 days so "same weekday next week" is reachable when today already passed
      for (let offset = 0; offset <= 7; offset++) {
        const candidate = midnight + offset * 86400 + minute * 60;
        if (candidate <= fromUnix) continue;
        if (days.includes(jakartaWeekday(candidate))) return candidate;
      }
      return null;
    }

    default:
      return null;
  }
}

/** Human-readable summary of a schedule, in Indonesian, for API responses */
export function describeSchedule(spec: ScheduleSpec): string {
  const DAY_NAMES = ['', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

  switch (spec.schedule_type) {
    case 'once': {
      if (!spec.run_at) return 'Sekali';
      const at = new Date((spec.run_at + JAKARTA_OFFSET) * 1000).toISOString();
      return `Sekali pada ${at.slice(0, 10)} ${at.slice(11, 16)}`;
    }
    case 'interval': {
      const minutes = spec.interval_minutes ?? 0;
      const every = minutes % 60 === 0 && minutes >= 60
        ? `${minutes / 60} jam`
        : `${minutes} menit`;
      const quiet = parseHHMM(spec.quiet_from) !== null && parseHHMM(spec.quiet_to) !== null
        ? ` (senyap ${spec.quiet_from}–${spec.quiet_to})`
        : '';
      return `Setiap ${every}${quiet}`;
    }
    case 'daily':
      return `Setiap hari pukul ${spec.time_of_day}`;
    case 'weekly': {
      const days = parseDaysOfWeek(spec.days_of_week) ?? [];
      return `Setiap ${days.map((d) => DAY_NAMES[d]).join(', ')} pukul ${spec.time_of_day}`;
    }
    default:
      return 'Tidak terjadwal';
  }
}
