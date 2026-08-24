import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';

const app = new Hono<AuthContext>();

app.use('/*', requireAuth);

/**
 * Tables to export.
 *
 * Deliberately excluded, and why — so the next person adding a table knows
 * which pile it belongs in rather than guessing:
 *
 *   Kredensial      refresh_tokens, push_subscriptions, shortcut_tokens.
 *                   Menyalin ini ke file yang diunduh pengguna berarti
 *                   menyebarkan kunci sesi; backup tidak butuh itu.
 *   Sekali pakai    notification_events, notification_deliveries,
 *                   scheduled_notifications, daily_alert_sent,
 *                   garden_care_alert_sent — penanda antrean dan dedup yang
 *                   tidak berarti apa-apa di luar konteks waktunya.
 *
 * Selain dua pilihan itu, setiap tabel milik pengguna harus ada di sini.
 * Sebelumnya seluruh modul Kebun, Catatan, Kalender, review bulanan, metrik
 * kesehatan, dan pengaturan tidak pernah ikut ter-backup sama sekali.
 */
const exportTables = [
  'users',
  'habits',
  'habit_completions',
  'habit_streak_freezes',
  'habit_bundles',
  'bundle_completions',
  'habit_stacks',
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
  'monthly_reviews',
  'notes',
  'calendar_events',
  'health_metrics',
  'daily_shutdown',
  'user_settings',
  'garden_plantings',
  'garden_care_log',
  'garden_costs',
  'garden_plant_price',
  'garden_pest_log',
  'garden_seeds',
  'garden_location',
  'garden_sowings',
  'garden_beds',
  'garden_bed_slots',
  'garden_harvest_stock',
  'garden_photos',
];

/**
 * Tabel anak yang tidak punya kolom `user_id` sendiri.
 *
 * Kepemilikannya menempel pada induknya, jadi kueri `WHERE user_id = ?` yang
 * dipakai tabel lain tidak bisa menjangkaunya. Tanpa penanganan khusus,
 * habit_stacks ikut ter-backup tapi isinya hilang diam-diam — backup yang
 * terlihat berhasil padahal separuh datanya tidak terbawa.
 */
const CHILD_TABLES: Record<string, { parent: string; foreignKey: string }> = {
  habit_stack_items: { parent: 'habit_stacks', foreignKey: 'stack_id' },
};

/**
 * Foto jurnal kebun disimpan sebagai data URL base64, jadi satu tanaman yang
 * rajin difoto bisa membengkakkan ekspor sampai puluhan megabita dan membuat
 * unduhan gagal di tengah jalan. Karena itu foto hanya ikut kalau diminta
 * lewat `?photos=1`, dan ekspor selalu menyebut apa yang dilewati supaya
 * ketidakhadirannya tidak pernah jadi kejutan.
 */
const HEAVY_TABLES = ['garden_photos'];

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
  weekly_reviews: ['id', 'user_id', 'week_start', 'habit_reflection', 'obstacle', 'adjustment', 'identity_affirmation', 'rating', 'created_at'],
  monthly_reviews: ['id', 'user_id', 'month', 'narrative', 'created_at'],
  habit_streak_freezes: ['id', 'habit_id', 'user_id', 'freeze_date', 'created_at'],
  habit_bundles: ['id', 'user_id', 'required_habit_id', 'desire_habit_id', 'reward_desc', 'is_active', 'created_at'],
  bundle_completions: ['id', 'bundle_id', 'user_id', 'completion_date', 'required_completed', 'desire_completed', 'both_completed', 'created_at'],
  habit_stacks: ['id', 'user_id', 'name', 'description', 'is_active', 'sort_order', 'created_at'],
  habit_stack_items: ['id', 'stack_id', 'habit_id', 'position', 'created_at'],
  notes: ['id', 'user_id', 'body', 'summary', 'linked_habit_id', 'linked_goal_id', 'created_at', 'updated_at'],
  calendar_events: ['id', 'user_id', 'title', 'note', 'kind', 'event_date', 'event_time', 'end_time', 'priority', 'color', 'is_done', 'done_at', 'repeat_rule', 'repeat_until', 'remind_minutes_before', 'created_at', 'updated_at'],
  health_metrics: ['user_id', 'metric_date', 'metric', 'value', 'source', 'recorded_at'],
  daily_shutdown: ['user_id', 'shutdown_date', 'journal', 'mood', 'top_priorities', 'completed_at'],
  user_settings: ['user_id', 'key', 'value', 'updated_at'],
  garden_plantings: ['id', 'user_id', 'plant_id', 'custom_name', 'nickname', 'location', 'quantity', 'planting_method', 'planted_date', 'expected_harvest_date', 'status', 'note', 'created_at'],
  garden_care_log: ['id', 'user_id', 'planting_id', 'action', 'action_date', 'amount', 'unit', 'note', 'created_at'],
  garden_costs: ['id', 'user_id', 'planting_id', 'kind', 'amount_idr', 'note', 'cost_date', 'created_at'],
  garden_plant_price: ['user_id', 'plant_key', 'price_idr', 'unit', 'updated_at'],
  garden_pest_log: ['id', 'user_id', 'planting_id', 'pest', 'severity', 'treatment', 'spotted_date', 'resolved_date', 'worked', 'created_at'],
  garden_seeds: ['id', 'user_id', 'plant_id', 'name', 'quantity', 'unit', 'purchase_date', 'expiry_date', 'note', 'created_at'],
  garden_location: ['user_id', 'latitude', 'longitude', 'label', 'updated_at'],
  garden_sowings: ['id', 'user_id', 'plant_id', 'name', 'seed_brand', 'sown_date', 'seed_count', 'germinated_count', 'germinated_date', 'transplanted_date', 'planting_id', 'note', 'created_at'],
  garden_beds: ['id', 'user_id', 'name', 'width_cm', 'length_cm', 'note', 'created_at'],
  garden_bed_slots: ['planting_id', 'bed_id', 'user_id', 'pos_x', 'pos_y', 'created_at'],
  garden_harvest_stock: ['care_log_id', 'user_id', 'inventory_item_id', 'created_at'],
  garden_photos: ['id', 'user_id', 'planting_id', 'image', 'taken_date', 'note', 'created_at'],
};

// GET /api/export - Export all user data as JSON
app.get('/', async (c) => {
  const userId = c.get('user').sub;

  try {
    const includePhotos = c.req.query('photos') === '1';
    const exportData: Record<string, unknown[]> = {};
    const skipped: string[] = [];

    for (const table of exportTables) {
      if (!includePhotos && HEAVY_TABLES.includes(table)) {
        skipped.push(table);
        continue;
      }

      // users table keys on id, everything else on user_id
      const query = table === 'users'
        ? `SELECT * FROM users WHERE id = ?1`
        : `SELECT * FROM ${table} WHERE user_id = ?1`;
      const result = await c.env.DB.prepare(query).bind(userId).all();
      exportData[table] = result.results || [];
    }

    // Tabel anak diambil lewat induknya, karena tidak punya user_id sendiri.
    for (const [table, { parent, foreignKey }] of Object.entries(CHILD_TABLES)) {
      const result = await c.env.DB.prepare(
        `SELECT child.* FROM ${table} child
           JOIN ${parent} p ON p.id = child.${foreignKey}
          WHERE p.user_id = ?1`
      ).bind(userId).all();
      exportData[table] = result.results || [];
    }

    return c.json({
      version: '1.1',
      exported_at: new Date().toISOString(),
      user_id: userId,
      // Disebut terang-terangan: backup yang diam-diam tidak lengkap lebih
      // berbahaya daripada backup yang mengaku tidak lengkap.
      skipped_tables: skipped,
      photos_included: includePhotos,
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
      const child = CHILD_TABLES[table];
      if ((!exportTables.includes(table) && !child) || !Array.isArray(rows)) continue;

      for (const row of rows) {
        const rowData = row as Record<string, unknown>;

        if (child) {
          // Baris anak tidak membawa user_id, jadi kepemilikannya diperiksa
          // lewat induk. Tanpa ini, siapa pun bisa menyisipkan baris ke stack
          // milik orang lain hanya dengan menebak id-nya.
          const parentId = rowData[child.foreignKey];
          if (typeof parentId !== 'string') continue;
          const owned = await db.prepare(
            `SELECT 1 FROM ${child.parent} WHERE id = ?1 AND user_id = ?2`
          ).bind(parentId, userId).first();
          if (!owned) continue;
        } else if (table !== 'users') {
          // Security: verify ownership — non-users rows must carry this user's id
          if (rowData.user_id !== userId) continue;
        } else if (rowData.id !== userId) {
          // The users row may only be the user's own profile
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
