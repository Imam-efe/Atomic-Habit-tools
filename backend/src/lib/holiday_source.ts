import type { Env } from '../types';

/**
 * Upstream holiday feed.
 *
 * Served from raw.githubusercontent.com rather than one of the several Vercel-
 * hosted Indonesian holiday APIs. Those are hobby deployments that go cold or
 * disappear; this is a static file on GitHub's CDN, and it carries its own
 * `info.updated` stamp so we can tell stale data from fresh.
 *
 * Shape:
 *   {
 *     "2026-01-01": { "holiday": true,
 *                     "summary": ["Hari Tahun Baru"],
 *                     "description": ["Hari libur nasional"] },
 *     ...
 *     "info": { "author": "...", "link": "...", "updated": "20260815 17:05:59" }
 *   }
 *
 * Known imprecision, which is why this never overwrites the bundled dataset:
 * every entry is `holiday: true`, including cuti bersama, so the joint-leave
 * days are only identifiable from their names — and one of them (28 May 2026)
 * is not named as such at all.
 */
export const HOLIDAY_SOURCE_URL =
  'https://raw.githubusercontent.com/guangrei/APIHariLibur_V2/main/calendar.min.json';

export const HOLIDAY_SOURCE_NAME = 'guangrei/APIHariLibur_V2';

export interface UpstreamHoliday {
  date: string;
  year: number;
  name: string;
  kind: 'libur' | 'cuti';
}

interface RawEntry {
  holiday?: boolean;
  summary?: string[];
  description?: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Joint leave is only distinguishable by name upstream. A miss here means an
 * entry is treated as a red date, which is the safer direction: the bundled
 * dataset already carries the authoritative split for the years it covers, and
 * for uncovered years the client labels everything as unverified anyway.
 */
function classify(name: string): 'libur' | 'cuti' {
  return /cuti\s+bersama/i.test(name) ? 'cuti' : 'libur';
}

export interface FetchResult {
  entries: UpstreamHoliday[];
  sourceUpdated: string | null;
}

export async function fetchUpstreamHolidays(): Promise<FetchResult> {
  const res = await fetch(HOLIDAY_SOURCE_URL, {
    headers: { 'accept': 'application/json', 'user-agent': 'fayolla-calendar-sync' },
    // The file changes at most daily; let Cloudflare serve a cached copy.
    cf: { cacheTtl: 3600, cacheEverything: true },
  } as RequestInit);

  if (!res.ok) throw new Error(`upstream returned ${res.status}`);

  const data = await res.json<Record<string, RawEntry | Record<string, string>>>();
  if (!data || typeof data !== 'object') throw new Error('upstream payload was not an object');

  const entries: UpstreamHoliday[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!ISO.test(key)) continue;
    const entry = value as RawEntry;
    if (!entry?.holiday) continue;

    const name = Array.isArray(entry.summary) ? entry.summary.join(', ').trim() : '';
    if (!name) continue;

    entries.push({ date: key, year: Number(key.slice(0, 4)), name, kind: classify(name) });
  }

  if (entries.length === 0) throw new Error('upstream payload had no holiday entries');

  const info = data.info as Record<string, string> | undefined;
  const sourceUpdated = typeof info?.updated === 'string' ? info.updated : null;

  return { entries: entries.sort((a, b) => a.date.localeCompare(b.date)), sourceUpdated };
}

/**
 * Replaces the cache with a freshly fetched set, and records the outcome either
 * way. A failed sync leaves the previous rows in place — stale cached data
 * beats an empty calendar.
 */
export async function syncHolidays(env: Env): Promise<{ ok: boolean; count: number; detail: string }> {
  const now = Math.floor(Date.now() / 1000);

  const recordAttempt = (status: string, detail: string, count: number, sourceUpdated: string | null) =>
    env.DB.prepare(
      `INSERT INTO holiday_sync_meta (id, source, source_updated, last_attempt_at, last_success_at, status, detail, entry_count)
       VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         source = ?1,
         source_updated = COALESCE(?2, holiday_sync_meta.source_updated),
         last_attempt_at = ?3,
         last_success_at = COALESCE(?4, holiday_sync_meta.last_success_at),
         status = ?5,
         detail = ?6,
         entry_count = CASE WHEN ?5 = 'ok' THEN ?7 ELSE holiday_sync_meta.entry_count END`
    ).bind(
      HOLIDAY_SOURCE_NAME, sourceUpdated, now, status === 'ok' ? now : null, status, detail, count
    ).run();

  try {
    const { entries, sourceUpdated } = await fetchUpstreamHolidays();

    // Replace wholesale: a date removed upstream should disappear here too,
    // and the set is small enough that a diff would only add failure modes.
    const statements = [
      env.DB.prepare('DELETE FROM holiday_cache'),
      ...entries.map((e) =>
        env.DB.prepare(
          `INSERT INTO holiday_cache (holiday_date, year, name, kind, source, fetched_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
        ).bind(e.date, e.year, e.name, e.kind, HOLIDAY_SOURCE_NAME, now)
      ),
    ];
    await env.DB.batch(statements);

    await recordAttempt('ok', `${entries.length} entri`, entries.length, sourceUpdated);
    return { ok: true, count: entries.length, detail: `${entries.length} entri` };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await recordAttempt('error', detail, 0, null).catch(() => {});
    return { ok: false, count: 0, detail };
  }
}
