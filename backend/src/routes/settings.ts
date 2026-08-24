import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { SETTINGS, SETTING_GROUPS, SETTING_BY_KEY } from '../lib/settings_schema';
import { loadSettings, saveSetting, defaultSettings } from '../lib/settings';

const settings = new Hono<AuthContext>();
settings.use('/*', requireAuth);

/**
 * Tabel yang isinya milik pengguna, beserta label dan modulnya.
 *
 * Ditulis eksplisit, bukan dibaca dari sqlite_master: daftar otomatis akan
 * ikut menampilkan tabel internal seperti cache dan penanda dedup, dan
 * memberi tombol hapus untuk sesuatu yang tidak berarti apa pun bagi
 * pengguna. Yang tidak ada di sini memang sengaja tidak bisa disentuh.
 */
export const DATA_TABLES: Array<{ table: string; label: string; group: string; userScoped: boolean }> = [
  { table: 'habits', label: 'Kebiasaan', group: 'Kebiasaan', userScoped: true },
  { table: 'habit_completions', label: 'Riwayat centang kebiasaan', group: 'Kebiasaan', userScoped: true },
  { table: 'goals', label: 'Goals', group: 'Kebiasaan', userScoped: true },
  { table: 'budget_entries', label: 'Catatan keuangan', group: 'Uang', userScoped: true },
  { table: 'budget_limits', label: 'Limit budget', group: 'Uang', userScoped: true },
  { table: 'bank_accounts', label: 'Rekening', group: 'Uang', userScoped: true },
  { table: 'debts', label: 'Utang & piutang', group: 'Uang', userScoped: true },
  { table: 'inventory_items', label: 'Stok inventaris', group: 'Inventaris', userScoped: true },
  { table: 'food_logs', label: 'Log makanan', group: 'Nutrisi', userScoped: true },
  { table: 'garden_plantings', label: 'Tanaman', group: 'Kebun', userScoped: true },
  { table: 'garden_care_log', label: 'Log perawatan kebun', group: 'Kebun', userScoped: true },
  { table: 'garden_photos', label: 'Foto kebun', group: 'Kebun', userScoped: true },
  { table: 'garden_seeds', label: 'Stok benih', group: 'Kebun', userScoped: true },
  { table: 'garden_costs', label: 'Biaya kebun', group: 'Kebun', userScoped: true },
  { table: 'garden_pest_log', label: 'Catatan hama', group: 'Kebun', userScoped: true },
  { table: 'cooking_recipes', label: 'Resep tersimpan', group: 'Masakan', userScoped: true },
  { table: 'notes', label: 'Catatan', group: 'Lainnya', userScoped: true },
  { table: 'calendar_events', label: 'Agenda', group: 'Lainnya', userScoped: true },
  { table: 'kids_schedules', label: 'Jadwal anak', group: 'Lainnya', userScoped: true },
  { table: 'health_metrics', label: 'Data Apple Health', group: 'Lainnya', userScoped: true },
  { table: 'daily_shutdown', label: 'Tutup Hari', group: 'Lainnya', userScoped: true },
  { table: 'notification_events', label: 'Riwayat notifikasi', group: 'Sistem', userScoped: true },
];

/**
 * Data sementara yang aman dibuang kapan saja: cache dan penanda dedup.
 * Semuanya akan terbentuk lagi sendiri saat dibutuhkan.
 */
export const PURGEABLE: Array<{ table: string; label: string; userScoped: boolean; ageColumn: string }> = [
  { table: 'notification_events', label: 'Riwayat notifikasi', userScoped: true, ageColumn: 'created_at' },
  { table: 'notification_deliveries', label: 'Riwayat pengiriman', userScoped: true, ageColumn: 'fired_at' },
  { table: 'daily_alert_sent', label: 'Penanda alert harian', userScoped: true, ageColumn: 'sent_at' },
  { table: 'garden_care_alert_sent', label: 'Penanda alert kebun', userScoped: false, ageColumn: 'sent_at' },
  { table: 'garden_weather_cache', label: 'Cache cuaca', userScoped: false, ageColumn: 'fetched_at' },
  { table: 'food_facts_cache', label: 'Cache pencarian makanan', userScoped: false, ageColumn: 'fetched_at' },
];

// GET /api/settings — skema beserta nilai yang berlaku
settings.get('/', async (c) => {
  const user = c.get('user');
  const values = await loadSettings(c.env.DB, user.sub);

  return c.json({
    groups: SETTING_GROUPS,
    // Skema ikut dikirim supaya UI bisa merender sendiri. Menambah pengaturan
    // baru cukup di registry backend, tanpa menyentuh frontend.
    settings: SETTINGS,
    values,
  });
});

// PUT /api/settings — simpan beberapa sekaligus
settings.put('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'body tidak valid' }, 400);

  const saved: string[] = [];
  const rejected: Array<{ key: string; reason: string }> = [];

  for (const [key, raw] of Object.entries(body)) {
    const def = SETTING_BY_KEY.get(key);
    if (!def) {
      rejected.push({ key, reason: 'pengaturan tidak dikenal' });
      continue;
    }
    if (await saveSetting(c.env.DB, user.sub, key, raw)) {
      saved.push(key);
    } else {
      const range =
        def.min !== undefined && def.max !== undefined ? ` (harus ${def.min}–${def.max})` : '';
      rejected.push({ key, reason: `nilai tidak valid${range}` });
    }
  }

  return c.json(
    { saved, rejected, values: await loadSettings(c.env.DB, user.sub) },
    rejected.length > 0 && saved.length === 0 ? 400 : 200
  );
});

// POST /api/settings/reset — kembalikan ke bawaan, satu grup atau semuanya
settings.post('/reset', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ group?: string }>().catch((): { group?: string } => ({}));

  if (body.group) {
    const keys = SETTINGS.filter((s) => s.group === body.group).map((s) => s.key);
    if (keys.length === 0) return c.json({ error: 'grup tidak dikenal' }, 400);

    const placeholders = keys.map((_, i) => `?${i + 2}`).join(',');
    await c.env.DB.prepare(
      `DELETE FROM user_settings WHERE user_id = ?1 AND key IN (${placeholders})`
    ).bind(user.sub, ...keys).run();
  } else {
    await c.env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?1').bind(user.sub).run();
  }

  return c.json({ values: defaultSettings() });
});

// GET /api/settings/database — berapa banyak data yang tersimpan
settings.get('/database', async (c) => {
  const user = c.get('user');

  const counts = await Promise.all(
    DATA_TABLES.map(async (entry) => {
      try {
        const row = await c.env.DB.prepare(
          entry.userScoped
            ? `SELECT COUNT(*) AS n FROM ${entry.table} WHERE user_id = ?1`
            : `SELECT COUNT(*) AS n FROM ${entry.table}`
        )
          .bind(...(entry.userScoped ? [user.sub] : []))
          .first<{ n: number }>();
        return { ...entry, rows: row?.n ?? 0 };
      } catch {
        // Tabel yang belum ada di database ini dilaporkan nol, bukan
        // menggagalkan seluruh halaman.
        return { ...entry, rows: 0 };
      }
    })
  );

  // Foto disebut terpisah: satu-satunya yang menyimpan gambar utuh di D1,
  // jadi ia yang paling mungkin membesar tanpa disadari.
  const photoBytes = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(LENGTH(image)), 0) AS bytes FROM garden_photos WHERE user_id = ?1'
  )
    .bind(user.sub)
    .first<{ bytes: number }>()
    .catch(() => ({ bytes: 0 }));

  return c.json({
    tables: counts.filter((t) => t.rows > 0),
    empty: counts.filter((t) => t.rows === 0).map((t) => t.label),
    photoBytes: photoBytes?.bytes ?? 0,
    purgeable: PURGEABLE.map((p) => ({ table: p.table, label: p.label })),
  });
});

// POST /api/settings/database/purge — buang data sementara
settings.post('/database/purge', async (c) => {
  const user = c.get('user');
  type PurgeBody = { table?: string; olderThanDays?: number };
  const body = await c.req.json<PurgeBody>().catch((): PurgeBody => ({}));

  const targets = body.table
    ? PURGEABLE.filter((p) => p.table === body.table)
    : PURGEABLE;

  if (targets.length === 0) return c.json({ error: 'tabel tidak bisa dibersihkan' }, 400);

  const days = typeof body.olderThanDays === 'number' && body.olderThanDays >= 0
    ? Math.min(365, Math.round(body.olderThanDays))
    : 7;

  const purged: Array<{ label: string; removed: number }> = [];

  for (const target of targets) {
    try {
      const result = await c.env.DB.prepare(
        target.userScoped
          ? `DELETE FROM ${target.table} WHERE user_id = ?1 AND ${target.ageColumn} < unixepoch() - ?2`
          : `DELETE FROM ${target.table} WHERE ${target.ageColumn} < unixepoch() - ?1`
      )
        .bind(...(target.userScoped ? [user.sub, days * 86400] : [days * 86400]))
        .run();

      purged.push({ label: target.label, removed: result.meta?.changes ?? 0 });
    } catch (err) {
      console.error(`[settings] gagal membersihkan ${target.table}`, err);
    }
  }

  return c.json({ purged, olderThanDays: days });
});

export default settings;
