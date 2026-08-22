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

/**
 * Real columns for every exportable table, mirrored from the migrations.
 *
 * Import builds its INSERT statement's column list from the KEYS of a
 * user-uploaded JSON row (`Object.keys(rowData)`), with the table name itself
 * already constrained to `exportTables` above. Column names, though, were
 * going straight into the SQL text unescaped and unchecked — an uploaded row
 * with an attacker-chosen key becomes part of the query itself, not a bound
 * value, so nothing downstream of `columns.join(',')` could stop it. This
 * allowlist is the check: only a row's keys that are real columns on that
 * table ever reach the query.
 */
const TABLE_COLUMNS: Record<string, string[]> = {
  users: ['id', 'email', 'name', 'avatar_url', 'accent', 'theme', 'created_at', 'role', 'last_weekly_recap_sent'],
  habits: ['id', 'user_id', 'name', 'color', 'icon', 'trigger_cue', 'action_desc', 'action_time', 'action_place', 'two_min', 'streak', 'last_completed_date', 'milestone', 'goal_ids', 'sort_order', 'created_at', 'streak_alert_sent'],
  habit_completions: ['id', 'habit_id', 'user_id', 'completed_date', 'is_two_min', 'created_at'],
  goals: ['id', 'user_id', 'identity_statement', 'color', 'icon', 'habit_ids', 'sort_order', 'created_at'],
  projects: ['id', 'user_id', 'name', 'goal_id', 'created_at'],
  tasks: ['id', 'project_id', 'user_id', 'name', 'status', 'goal_id', 'parent_task_id', 'sort_order', 'created_at'],
  budget_entries: ['id', 'user_id', 'type', 'amount_idr', 'category', 'note', 'entry_date', 'bank_account_id', 'receipt_img', 'created_at', 'recurrence', 'next_recurrence_date'],
  budget_limits: ['id', 'user_id', 'category', 'monthly_limit_idr', 'month'],
  activity_logs: ['id', 'user_id', 'label', 'hours', 'log_date', 'created_at'],
  food_logs: ['id', 'user_id', 'food_name', 'portion', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'label', 'log_date', 'created_at'],
  nutrition_targets: ['id', 'user_id', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'updated_at'],
  menstrual_settings: ['user_id', 'cycle_length', 'period_length', 'updated_at'],
  menstrual_logs: ['id', 'user_id', 'start_date', 'end_date', 'notes', 'created_at'],
  bank_accounts: ['id', 'user_id', 'name', 'account_type', 'balance', 'created_at'],
  inventory_items: ['id', 'user_id', 'name', 'quantity', 'unit', 'expiry_date', 'purchase_date', 'category', 'note', 'expiry_alert_sent', 'created_at'],
  kids_schedules: ['id', 'user_id', 'kid_name', 'title', 'type', 'day_of_week', 'schedule_time', 'schedule_date', 'note', 'created_at'],
  debts: ['id', 'user_id', 'type', 'person_name', 'amount_idr', 'due_date', 'note', 'status', 'created_at'],
  debt_payments: ['id', 'debt_id', 'user_id', 'amount_idr', 'payment_date', 'status', 'note', 'created_at', 'bank_account_id', 'budget_entry_id'],
  net_worth_snapshots: ['id', 'user_id', 'month', 'assets', 'liabilities', 'net_worth', 'created_at'],
  weekly_reviews: ['id', 'user_id', 'week_start', 'habit_reflection', 'obstacle', 'adjustment', 'identity_affirmation', 'rating'],
};

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
          // Column names go straight into the SQL text below, unlike the
          // values (which are always bound as parameters) — an uploaded
          // row's keys have to be real columns on this table before that's
          // safe to do at all.
          const allowedColumns = TABLE_COLUMNS[table] ?? [];
          const columns = Object.keys(rowData).filter((col) => allowedColumns.includes(col));
          if (columns.length === 0) continue;

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
