import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';

const app = new Hono<AuthContext>();

app.use('/*', requireAuth);

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
  const userId = c.get('user').sub;

  try {
    const exportData: Record<string, unknown[]> = {};

    for (const table of exportTables) {
      // users table keys on id, everything else on user_id
      const query = table === 'users'
        ? `SELECT * FROM users WHERE id = ?1`
        : `SELECT * FROM ${table} WHERE user_id = ?1`;
      const result = await c.env.DB.prepare(query).bind(userId).all();
      exportData[table] = result.results || [];
    }

    return c.json({
      version: '1.0',
      exported_at: new Date().toISOString(),
      user_id: userId,
      data: exportData,
    });
  } catch (error) {
    console.error('Export failed:', error);
    return c.json({ error: 'export failed' }, 500);
  }
});

// POST /api/import - Import user data from JSON
app.post('/', async (c) => {
  const userId = c.get('user').sub;

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

        // Security: verify ownership — non-users rows must carry this user's id,
        // and the users row may only be the user's own profile
        if (table !== 'users' && rowData.user_id !== userId) {
          continue;
        }
        if (table === 'users' && rowData.id !== userId) {
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
