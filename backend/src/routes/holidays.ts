import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { syncHolidays, HOLIDAY_SOURCE_NAME, HOLIDAY_SOURCE_URL } from '../lib/holiday_source';

const holidays = new Hono<AuthContext>();

holidays.use('/*', requireAuth);

interface CacheRow {
  holiday_date: string;
  name: string;
  kind: string;
  source: string;
}

interface MetaRow {
  source: string;
  source_updated: string | null;
  last_attempt_at: number | null;
  last_success_at: number | null;
  status: string | null;
  detail: string | null;
  entry_count: number;
}

/**
 * GET /api/holidays?year=YYYY
 *
 * The cached upstream set for a year, plus when it was last confirmed fresh.
 * The client keeps its own bundled dataset and decides what to do with this —
 * it is deliberately not merged here, because the client is the side that knows
 * which years the official decree has been transcribed for.
 */
holidays.get('/', async (c) => {
  const yearParam = c.req.query('year');
  const year = yearParam ? Number(yearParam) : new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 1970 || year > 2200) {
    return c.json({ error: 'year must be a four-digit year' }, 400);
  }

  const rows = await c.env.DB.prepare(
    `SELECT holiday_date, name, kind, source FROM holiday_cache
      WHERE year = ?1 ORDER BY holiday_date`
  ).bind(year).all<CacheRow>();

  const meta = await c.env.DB.prepare(
    `SELECT source, source_updated, last_attempt_at, last_success_at, status, detail, entry_count
       FROM holiday_sync_meta WHERE id = 1`
  ).first<MetaRow>();

  return c.json({
    year,
    source: { name: HOLIDAY_SOURCE_NAME, url: HOLIDAY_SOURCE_URL },
    sync: meta ?? null,
    holidays: (rows.results ?? []).map((r) => ({
      date: r.holiday_date,
      name: r.name,
      kind: r.kind,
    })),
  });
});

/**
 * POST /api/holidays/sync
 *
 * Pulls upstream now. The cron does this weekly; this is for when the decree
 * for a new year lands and the user does not want to wait for it.
 */
holidays.post('/sync', async (c) => {
  const result = await syncHolidays(c.env);
  return c.json(result, result.ok ? 200 : 502);
});

export default holidays;
