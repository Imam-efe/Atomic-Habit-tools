import { Hono } from 'hono';
import type { Env } from '../types';
import { verifyAuth } from '../lib/auth';

const app = new Hono<{ Bindings: Env }>();

// Tables to export (exclude auth-related and internal tables)
const exportTables = [
  'users',
  'habits',
  'habit_completions',
  'goals',
  'projects',
  'tasks',
  'budget_entries',
  'budget_limits',
  'activity_logs',
  'food_logs',
  'nutrition_targets',
  'menstrual_settings',
  'menstrual_logs',
  'bank_accounts',
  'inventory_items',
  'kids_schedules',
  'debts',
  'debt_payments',
  'net_worth_snapshots',
  'weekly_reviews',
];

// GET /api/export - Export all user data as JSON
app.get('/', async (c) => {
  const auth = await verifyAuth(c);
  if (!auth) return c.json({ error: 'unauthorized' }, 401);

  try {
    const exportData: Record<string, unknown[]> = {};

    for (const table of exportTables) {
      const result = await c.env.DB.prepare(
        `SELECT * FROM ${table} WHERE user_id = ?1`
      ).bind(auth.user_id).all();

      // Handle users table specially (no user_id filter)
      if (table === 'users') {
        const userResult = await c.env.DB.prepare(
          `SELECT * FROM users WHERE id = ?1`
        ).bind(auth.user_id).all();
        exportData[table] = userResult.results || [];
      } else {
        exportData[table] = result.results || [];
      }
    }

    return c.json({
      version: '1.0',
      exported_at: new Date().toISOString(),
      user_id: auth.user_id,
      data: exportData,
    });
  } catch (error) {
    console.error('Export failed:', error);
    return c.json({ error: 'export failed' }, 500);
  }
});

// POST /api/import - Import user data from JSON
app.post('/', async (c) => {
  const auth = await verifyAuth(c);
  if (!auth) return c.json({ error: 'unauthorized' }, 401);

  try {
    const payload = await c.req.json() as {
      data?: Record<string, unknown[]>;
      version?: string;
    };

    if (!payload.data || typeof payload.data !== 'object') {
      return c.json({ error: 'invalid export data' }, 400);
    }

    const db = c.env.DB;
    let importedCount = 0;

    // Start transaction (Hono/D1 doesn't have explicit transaction support,
    // so we'll do best-effort insert with error handling)
    for (const [table, rows] of Object.entries(payload.data)) {
      if (!exportTables.includes(table) || !Array.isArray(rows)) continue;

      for (const row of rows) {
        const rowData = row as Record<string, unknown>;

        // Security: verify user_id matches for all non-users table inserts
        if (table !== 'users' && rowData.user_id !== auth.user_id) {
          continue;
        }

        try {
          const columns = Object.keys(rowData);
          const placeholders = columns.map((_, i) => `?${i + 1}`).join(',');
          const values = columns.map((col) => rowData[col]);

          await db.prepare(
            `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`
          ).bind(...values).run();

          importedCount++;
        } catch (error) {
          // Log but continue on individual row errors
          console.warn(`Failed to import row from ${table}:`, error);
        }
      }
    }

    return c.json({
      success: true,
      imported_count: importedCount,
      message: `Imported ${importedCount} records`,
    });
  } catch (error) {
    console.error('Import failed:', error);
    return c.json({ error: 'import failed' }, 500);
  }
});

export default app;
