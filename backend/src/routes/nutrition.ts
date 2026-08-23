import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';

const nutrition = new Hono<AuthContext>();

nutrition.use('/*', requireAuth);

interface DBFoodLog {
  id: string;
  food_name: string;
  portion: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  label: string | null;
  log_date: string;
  created_at: number;
  source: string | null;
  barcode: string | null;
}

interface DBNutritionTarget {
  id: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

const DEFAULT_TARGET = {
  id: '',
  calories: 2200,
  protein_g: 120,
  carbs_g: 250,
  fat_g: 70,
  fiber_g: 30,
};

const FOOD_LABELS = ['Sehat', 'Moderat', 'Indulge'];

// GET /api/nutrition?date=YYYY-MM-DD
nutrition.get('/', async (c) => {
  const user = c.get('user');
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);

  // Fetch food logs
  const logsRes = await c.env.DB.prepare(
    'SELECT * FROM food_logs WHERE user_id = ?1 AND log_date = ?2 ORDER BY created_at ASC'
  ).bind(user.sub, date).all<DBFoodLog>();

  const logs = logsRes.results ?? [];

  // Fetch target
  const target = await c.env.DB.prepare(
    'SELECT calories, protein_g, carbs_g, fat_g, fiber_g FROM nutrition_targets WHERE user_id = ?1'
  ).bind(user.sub).first<DBNutritionTarget>();

  const finalTarget = target ?? DEFAULT_TARGET;

  // Calculate totals
  const totalCalories = logs.reduce((s, l) => s + (l.calories ?? 0), 0);
  const totalProtein = logs.reduce((s, l) => s + (l.protein_g ?? 0), 0);
  const totalCarbs = logs.reduce((s, l) => s + (l.carbs_g ?? 0), 0);
  const totalFat = logs.reduce((s, l) => s + (l.fat_g ?? 0), 0);
  const totalFiber = logs.reduce((s, l) => s + (l.fiber_g ?? 0), 0);

  return c.json({
    foodLogs: logs.map(l => ({
      id: l.id,
      name: l.food_name,
      portion: l.portion,
      calories: l.calories ?? 0,
      protein: l.protein_g ?? 0,
      carbs: l.carbs_g ?? 0,
      fat: l.fat_g ?? 0,
      fiber: l.fiber_g ?? 0,
      label: l.label,
      date: l.log_date,
      source: l.source,
      barcode: l.barcode,
    })),
    target: {
      calories: finalTarget.calories,
      protein: finalTarget.protein_g,
      carbs: finalTarget.carbs_g,
      fat: finalTarget.fat_g,
      fiber: finalTarget.fiber_g,
    },
    summary: {
      calories: totalCalories,
      protein: totalProtein,
      carbs: totalCarbs,
      fat: totalFat,
      fiber: totalFiber,
    },
  });
});

// POST /api/nutrition/food
nutrition.post('/food', async (c) => {
  const user = c.get('user');
  type FoodBody = {
    name?: string;
    portion?: string;
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    fiber?: number;
    label?: string;
    date?: string;
    source?: string;
    barcode?: string;
  };
  const body = await c.req.json<FoodBody>().catch((): FoodBody => ({}));

  const label = body.label ?? 'Moderat';
  const err = validate(
    { name: body.name, label } as Record<string, unknown>,
    {
      name:  { type: 'string' },
      label: { type: 'enum', values: FOOD_LABELS },
    }
  );
  if (err) return c.json({ error: err }, 400);

  const id = nanoid();
  const date = body.date ?? new Date().toISOString().slice(0, 10);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO food_logs (id, user_id, food_name, portion, calories, protein_g, carbs_g, fat_g, fiber_g, label, log_date, created_at, source, barcode)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
  ).bind(
    id, user.sub,
    body.name!.trim(),
    body.portion?.trim() ?? null,
    body.calories !== undefined ? Math.round(body.calories) : null,
    body.protein !== undefined ? parseFloat(body.protein.toString()) : null,
    body.carbs !== undefined ? parseFloat(body.carbs.toString()) : null,
    body.fat !== undefined ? parseFloat(body.fat.toString()) : null,
    body.fiber !== undefined ? parseFloat(body.fiber.toString()) : null,
    label,
    date,
    now,
    body.source?.trim() || null,
    body.barcode?.trim() || null
  ).run();

  return c.json({
    id,
    name: body.name!.trim(),
    portion: body.portion?.trim() ?? null,
    calories: body.calories ?? 0,
    protein: body.protein ?? 0,
    carbs: body.carbs ?? 0,
    fat: body.fat ?? 0,
    fiber: body.fiber ?? 0,
    label,
    date,
    source: body.source ?? null,
    barcode: body.barcode ?? null,
  }, 201);
});

// DELETE /api/nutrition/food/:id
nutrition.delete('/food/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  await c.env.DB.prepare('DELETE FROM food_logs WHERE id = ?1 AND user_id = ?2').bind(id, user.sub).run();
  return c.json({ ok: true });
});

// POST /api/nutrition/target
nutrition.post('/target', async (c) => {
  const user = c.get('user');
  type TargetBody = {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    fiber?: number;
  };
  const body = await c.req.json<TargetBody>().catch((): TargetBody => ({}));

  const calories = body.calories ?? DEFAULT_TARGET.calories;
  const protein = body.protein ?? DEFAULT_TARGET.protein_g;
  const carbs = body.carbs ?? DEFAULT_TARGET.carbs_g;
  const fat = body.fat ?? DEFAULT_TARGET.fat_g;
  const fiber = body.fiber ?? DEFAULT_TARGET.fiber_g;

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO nutrition_targets (id, user_id, calories, protein_g, carbs_g, fat_g, fiber_g, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(user_id) DO UPDATE SET
       calories = ?3,
       protein_g = ?4,
       carbs_g = ?5,
       fat_g = ?6,
       fiber_g = ?7,
       updated_at = ?8`
  ).bind(id, user.sub, calories, protein, carbs, fat, fiber, now).run();

  return c.json({ calories, protein, carbs, fat, fiber });
});

export default nutrition;
