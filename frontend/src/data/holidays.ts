/**
 * Indonesian national holidays and joint leave (cuti bersama).
 *
 * Bundled rather than fetched. The holiday APIs are unreachable from this
 * deployment, and a calendar that renders the wrong days red because a third
 * party was down is worse than one that works offline.
 *
 * Dates come from the SKB 3 Menteri, the joint decree that fixes them each
 * year. Fixed-date holidays (17 Agustus, Natal) never move; the religious ones
 * follow lunar and lunisolar calendars and are only final once the decree is
 * signed, roughly a year ahead. So this file covers only the years a decree
 * exists for — `COVERED_YEARS` — and the UI says so for any year outside it
 * instead of guessing. Add a year here when its SKB is published.
 *
 * Sources:
 *   2026 — SKB No. 1497/2025, No. 2/2025, No. 5/2025 (signed 19 Sep 2025):
 *          17 libur nasional, 8 cuti bersama.
 *   2025 — SKB for 2025: 17 libur nasional, 10 cuti bersama.
 */

export type HolidayKind = 'libur' | 'cuti';

export interface Holiday {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  /** `libur` is a red date; `cuti` is joint leave, not itself a red date. */
  kind: HolidayKind;
}

/** Years with an official decree behind them. */
export const COVERED_YEARS = [2025, 2026] as const;

const H_2025: Holiday[] = [
  { date: '2025-01-01', name: 'Tahun Baru Masehi 2025', kind: 'libur' },
  { date: '2025-01-27', name: 'Isra Mikraj Nabi Muhammad SAW', kind: 'libur' },
  { date: '2025-01-28', name: 'Cuti Bersama Tahun Baru Imlek', kind: 'cuti' },
  { date: '2025-01-29', name: 'Tahun Baru Imlek 2576 Kongzili', kind: 'libur' },
  { date: '2025-03-28', name: 'Cuti Bersama Hari Suci Nyepi', kind: 'cuti' },
  { date: '2025-03-29', name: 'Hari Suci Nyepi (Tahun Baru Saka 1947)', kind: 'libur' },
  { date: '2025-03-31', name: 'Idul Fitri 1446 Hijriah', kind: 'libur' },
  { date: '2025-04-01', name: 'Idul Fitri 1446 Hijriah', kind: 'libur' },
  { date: '2025-04-02', name: 'Cuti Bersama Idul Fitri 1446 Hijriah', kind: 'cuti' },
  { date: '2025-04-03', name: 'Cuti Bersama Idul Fitri 1446 Hijriah', kind: 'cuti' },
  { date: '2025-04-04', name: 'Cuti Bersama Idul Fitri 1446 Hijriah', kind: 'cuti' },
  { date: '2025-04-07', name: 'Cuti Bersama Idul Fitri 1446 Hijriah', kind: 'cuti' },
  { date: '2025-04-18', name: 'Wafat Yesus Kristus', kind: 'libur' },
  { date: '2025-04-20', name: 'Kebangkitan Yesus Kristus (Paskah)', kind: 'libur' },
  { date: '2025-05-01', name: 'Hari Buruh Internasional', kind: 'libur' },
  { date: '2025-05-12', name: 'Hari Raya Waisak 2569 BE', kind: 'libur' },
  { date: '2025-05-13', name: 'Cuti Bersama Hari Raya Waisak', kind: 'cuti' },
  { date: '2025-05-29', name: 'Kenaikan Yesus Kristus', kind: 'libur' },
  { date: '2025-05-30', name: 'Cuti Bersama Kenaikan Yesus Kristus', kind: 'cuti' },
  { date: '2025-06-01', name: 'Hari Lahir Pancasila', kind: 'libur' },
  { date: '2025-06-06', name: 'Idul Adha 1446 Hijriah', kind: 'libur' },
  { date: '2025-06-09', name: 'Cuti Bersama Idul Adha 1446 Hijriah', kind: 'cuti' },
  { date: '2025-06-27', name: 'Tahun Baru Islam 1447 Hijriah', kind: 'libur' },
  { date: '2025-08-17', name: 'Proklamasi Kemerdekaan RI', kind: 'libur' },
  { date: '2025-09-05', name: 'Maulid Nabi Muhammad SAW', kind: 'libur' },
  { date: '2025-12-25', name: 'Kelahiran Yesus Kristus (Natal)', kind: 'libur' },
  { date: '2025-12-26', name: 'Cuti Bersama Kelahiran Yesus Kristus', kind: 'cuti' },
];

const H_2026: Holiday[] = [
  { date: '2026-01-01', name: 'Tahun Baru Masehi 2026', kind: 'libur' },
  { date: '2026-01-16', name: 'Isra Mikraj Nabi Muhammad SAW', kind: 'libur' },
  { date: '2026-02-16', name: 'Cuti Bersama Tahun Baru Imlek', kind: 'cuti' },
  { date: '2026-02-17', name: 'Tahun Baru Imlek 2577 Kongzili', kind: 'libur' },
  { date: '2026-03-18', name: 'Cuti Bersama Hari Suci Nyepi', kind: 'cuti' },
  { date: '2026-03-19', name: 'Hari Suci Nyepi (Tahun Baru Saka 1948)', kind: 'libur' },
  { date: '2026-03-20', name: 'Cuti Bersama Idul Fitri 1447 Hijriah', kind: 'cuti' },
  { date: '2026-03-21', name: 'Idul Fitri 1447 Hijriah', kind: 'libur' },
  { date: '2026-03-22', name: 'Idul Fitri 1447 Hijriah', kind: 'libur' },
  { date: '2026-03-23', name: 'Cuti Bersama Idul Fitri 1447 Hijriah', kind: 'cuti' },
  { date: '2026-03-24', name: 'Cuti Bersama Idul Fitri 1447 Hijriah', kind: 'cuti' },
  { date: '2026-04-03', name: 'Wafat Yesus Kristus', kind: 'libur' },
  { date: '2026-04-05', name: 'Kebangkitan Yesus Kristus (Paskah)', kind: 'libur' },
  { date: '2026-05-01', name: 'Hari Buruh Internasional', kind: 'libur' },
  { date: '2026-05-14', name: 'Kenaikan Yesus Kristus', kind: 'libur' },
  { date: '2026-05-15', name: 'Cuti Bersama Kenaikan Yesus Kristus', kind: 'cuti' },
  { date: '2026-05-27', name: 'Idul Adha 1447 Hijriah', kind: 'libur' },
  { date: '2026-05-28', name: 'Cuti Bersama Idul Adha 1447 Hijriah', kind: 'cuti' },
  { date: '2026-05-31', name: 'Hari Raya Waisak 2570 BE', kind: 'libur' },
  { date: '2026-06-01', name: 'Hari Lahir Pancasila', kind: 'libur' },
  { date: '2026-06-16', name: 'Tahun Baru Islam 1448 Hijriah', kind: 'libur' },
  { date: '2026-08-17', name: 'Proklamasi Kemerdekaan RI', kind: 'libur' },
  { date: '2026-08-25', name: 'Maulid Nabi Muhammad SAW', kind: 'libur' },
  { date: '2026-12-24', name: 'Cuti Bersama Kelahiran Yesus Kristus', kind: 'cuti' },
  { date: '2026-12-25', name: 'Kelahiran Yesus Kristus (Natal)', kind: 'libur' },
];

const BY_DATE: Map<string, Holiday> = new Map(
  [...H_2025, ...H_2026].map((h) => [h.date, h])
);

/** All entries for a year, ascending. Empty when no decree is bundled yet. */
export function holidaysInYear(year: number): Holiday[] {
  return [...BY_DATE.values()]
    .filter((h) => h.date.startsWith(String(year)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** True once a year's decree is bundled — lets the UI distinguish "no holidays" from "no data". */
export function hasOfficialData(year: number): boolean {
  return (COVERED_YEARS as readonly number[]).includes(year);
}

/** Next red date strictly after `iso`, within the covered years. */
export function nextHoliday(iso: string): Holiday | null {
  const upcoming = [...BY_DATE.values()]
    .filter((h) => h.kind === 'libur' && h.date > iso)
    .sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0] ?? null;
}

// ---------------------------------------------------------------------------
// Merging with the synced upstream feed
// ---------------------------------------------------------------------------

/** One entry as the backend cached it from upstream. */
export interface RemoteHoliday {
  date: string;
  name: string;
  kind: string;
}

export interface ResolvedHoliday extends Holiday {
  /** True when this came from the transcribed decree rather than upstream. */
  verified: boolean;
}

export type Provenance = 'skb' | 'upstream' | 'none';

export interface ResolvedYear {
  holidays: ResolvedHoliday[];
  provenance: Provenance;
  /** Dates where upstream and the decree disagree. Empty unless both cover the year. */
  drift: { date: string; bundled: string | null; upstream: string | null }[];
}

/**
 * Decides what a year's holidays actually are.
 *
 * The decree wins wherever it has been transcribed. Upstream agrees with it on
 * every 2026 date but is looser about what each one is — it reports cuti bersama
 * as ordinary holidays, and 28 May 2026 arrives named as a second day of Idul
 * Adha rather than the joint leave it is. Letting it overwrite would collapse
 * the two colours the grid draws into one.
 *
 * So upstream does two jobs instead: it covers years with no decree yet, marked
 * unverified, and it reports disagreement on the years both cover, so a genuine
 * amendment surfaces rather than silently repainting red dates.
 */
export function resolveYear(year: number, remote: RemoteHoliday[]): ResolvedYear {
  const remoteForYear = remote.filter((r) => r.date.startsWith(String(year)));

  if (hasOfficialData(year)) {
    const bundled = holidaysInYear(year);
    const bundledByDate = new Map(bundled.map((h) => [h.date, h]));
    const remoteByDate = new Map(remoteForYear.map((r) => [r.date, r]));

    const drift: ResolvedYear['drift'] = [];
    // Only meaningful once upstream has actually been synced for this year.
    if (remoteForYear.length > 0) {
      const dates = new Set([...bundledByDate.keys(), ...remoteByDate.keys()]);
      for (const date of [...dates].sort()) {
        const b = bundledByDate.get(date);
        const r = remoteByDate.get(date);
        if (!b || !r) {
          drift.push({ date, bundled: b?.name ?? null, upstream: r?.name ?? null });
        }
      }
    }

    return {
      holidays: bundled.map((h) => ({ ...h, verified: true })),
      provenance: 'skb',
      drift,
    };
  }

  if (remoteForYear.length === 0) {
    return { holidays: [], provenance: 'none', drift: [] };
  }

  return {
    holidays: remoteForYear
      .map((r) => ({
        date: r.date,
        name: r.name,
        kind: (r.kind === 'cuti' ? 'cuti' : 'libur') as HolidayKind,
        verified: false,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    provenance: 'upstream',
    drift: [],
  };
}
