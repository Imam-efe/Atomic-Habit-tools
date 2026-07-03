# Fayolla — 5-Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Weekly Review, Identity Score, Debt Planner, Habit Heatmap, and Smart Reminder Hub into the Fayolla personal OS app.

**Architecture:** Each feature is an independent sub-screen registered via `setSubScreen(id)` in `uiStore`, added to `More.tsx` menu and `App.tsx` subScreens map. Backend routes follow the Hono pattern in `backend/src/routes/`. One migration file adds the `weekly_reviews` table; remaining features use existing DB tables.

**Tech Stack:** React 18 + Framer Motion 11 + Tailwind CSS 3 + Hono.js (Cloudflare Workers) + D1 SQLite + `apiFetch` from `@/lib/api` + `springs` from `@/tokens/motion`

---

## File Map

**New files to create:**
- `backend/migrations/0009_weekly_reviews.sql`
- `backend/src/routes/weekly_review.ts`
- `frontend/src/screens/WeeklyReview.tsx`
- `frontend/src/screens/DebtPlanner.tsx`
- `frontend/src/screens/HabitHeatmap.tsx`

**Existing files to modify:**
- `backend/src/index.ts` — import + register `weekly-review` and habits completions route
- `backend/src/routes/habits.ts` — add `GET /completions` endpoint (52-week data)
- `backend/src/routes/goals.ts` — add `GET /score` endpoint (aggregate + 7-day history)
- `frontend/src/App.tsx` — register 3 new sub-screens
- `frontend/src/screens/More.tsx` — add 3 new menu items in MODUL LAINNYA section
- `frontend/src/screens/Goals.tsx` — add identity score summary card at top
- `frontend/src/screens/Habits.tsx` — show `reminderTime` badge on habit cards

---

## Task 1: DB Migration — weekly_reviews table

**Files:**
- Create: `backend/migrations/0009_weekly_reviews.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Weekly review entries
CREATE TABLE IF NOT EXISTS weekly_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,           -- YYYY-MM-DD (Monday of that week)
  habit_reflection TEXT,              -- free text: apa yang berhasil?
  obstacle TEXT,                      -- free text: apa hambatannya?
  adjustment TEXT,                    -- free text: apa yang perlu disesuaikan?
  identity_affirmation TEXT,          -- free text: saya adalah orang yang...
  rating INTEGER NOT NULL DEFAULT 3,  -- 1-5 week rating
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reviews_user ON weekly_reviews(user_id);
```

- [ ] **Step 2: Commit**

```bash
git add backend/migrations/0009_weekly_reviews.sql
git commit -m "feat(db): add weekly_reviews table"
```

---

## Task 2: Backend Route — Weekly Review API

**Files:**
- Create: `backend/src/routes/weekly_review.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Create route file**

```typescript
// backend/src/routes/weekly_review.ts
import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';

const weeklyReview = new Hono<AuthContext>();
weeklyReview.use('/*', requireAuth);

// Helper: get Monday of the week containing a given YYYY-MM-DD
function getMondayOf(dateStr: string): string {
  const parts = dateStr.split('-');
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// GET /api/weekly-review?week=YYYY-MM-DD  (defaults to current week)
weeklyReview.get('/', async (c) => {
  const user = c.get('user');
  const weekParam = c.req.query('week');
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = getMondayOf(weekParam || today);
  const weekEnd = (() => {
    const parts = weekStart.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();

  // Fetch review (if exists)
  const review = await c.env.DB.prepare(
    'SELECT * FROM weekly_reviews WHERE user_id = ?1 AND week_start = ?2'
  ).bind(user.sub, weekStart).first<{
    id: string; week_start: string; habit_reflection: string | null;
    obstacle: string | null; adjustment: string | null;
    identity_affirmation: string | null; rating: number;
  }>();

  // Habit stats for this week
  const habitStats = await c.env.DB.prepare(`
    SELECT h.id, h.name, h.color, h.streak,
           COUNT(hc.id) as completions_this_week
    FROM habits h
    LEFT JOIN habit_completions hc
      ON hc.habit_id = h.id
      AND hc.completed_date BETWEEN ?2 AND ?3
      AND hc.user_id = h.user_id
    WHERE h.user_id = ?1
    GROUP BY h.id
  `).bind(user.sub, weekStart, weekEnd).all<{
    id: string; name: string; color: string; streak: number; completions_this_week: number;
  }>();

  // Count total possible days (Mon to today or Sun, whichever comes first)
  const todayDate = new Date(today);
  const weekEndDate = new Date(weekEnd);
  const cappedEnd = todayDate < weekEndDate ? today : weekEnd;
  const startDate = new Date(weekStart);
  const daysElapsed = Math.max(1, Math.round((new Date(cappedEnd).getTime() - startDate.getTime()) / 86400000) + 1);

  const habits = (habitStats.results ?? []).map(h => ({
    ...h,
    consistency: Math.round((h.completions_this_week / Math.min(daysElapsed, 7)) * 100),
  }));

  const overallConsistency = habits.length > 0
    ? Math.round(habits.reduce((s, h) => s + h.consistency, 0) / habits.length)
    : 0;

  return c.json({
    weekStart,
    weekEnd,
    daysElapsed,
    overallConsistency,
    habits,
    review: review ?? null,
  });
});

// GET /api/weekly-review/list — last 10 reviews (for history)
weeklyReview.get('/list', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT id, week_start, rating, habit_reflection FROM weekly_reviews WHERE user_id = ?1 ORDER BY week_start DESC LIMIT 10'
  ).bind(user.sub).all<{ id: string; week_start: string; rating: number; habit_reflection: string | null }>();
  return c.json(rows.results ?? []);
});

// POST /api/weekly-review — upsert review for a week
weeklyReview.post('/', async (c) => {
  const user = c.get('user');
  type Body = {
    weekStart?: string;
    habitReflection?: string;
    obstacle?: string;
    adjustment?: string;
    identityAffirmation?: string;
    rating?: number;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = getMondayOf(body.weekStart || today);

  const existing = await c.env.DB.prepare(
    'SELECT id FROM weekly_reviews WHERE user_id = ?1 AND week_start = ?2'
  ).bind(user.sub, weekStart).first<{ id: string }>();

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE weekly_reviews
      SET habit_reflection = ?1, obstacle = ?2, adjustment = ?3,
          identity_affirmation = ?4, rating = ?5
      WHERE id = ?6
    `).bind(
      body.habitReflection ?? null,
      body.obstacle ?? null,
      body.adjustment ?? null,
      body.identityAffirmation ?? null,
      body.rating ?? 3,
      existing.id
    ).run();
    return c.json({ id: existing.id, weekStart });
  }

  const id = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO weekly_reviews (id, user_id, week_start, habit_reflection, obstacle, adjustment, identity_affirmation, rating)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `).bind(
    id, user.sub, weekStart,
    body.habitReflection ?? null,
    body.obstacle ?? null,
    body.adjustment ?? null,
    body.identityAffirmation ?? null,
    body.rating ?? 3
  ).run();

  return c.json({ id, weekStart }, 201);
});

export default weeklyReview;
```

- [ ] **Step 2: Register in index.ts**

Open `backend/src/index.ts`. After the last import line (before `const app`), add:
```typescript
import weeklyReview from './routes/weekly_review';
```

After `app.route('/api/net-worth', netWorth);`, add:
```typescript
app.route('/api/weekly-review', weeklyReview);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/weekly_review.ts backend/src/index.ts
git commit -m "feat(api): add weekly-review route (GET + POST + list)"
```

---

## Task 3: Backend — Habit Completions Endpoint (for Heatmap)

**Files:**
- Modify: `backend/src/routes/habits.ts`

- [ ] **Step 1: Add completions endpoint**

Open `backend/src/routes/habits.ts`. Before the `export default habits;` line at the bottom, add:

```typescript
// GET /api/habits/completions?weeks=52
// Returns { habitId: string, dates: string[] }[] for all user habits
habits.get('/completions', async (c) => {
  const user = c.get('user');
  const weeks = Math.min(parseInt(c.req.query('weeks') ?? '52', 10), 104);

  // Compute start date = today minus (weeks * 7) days
  const today = new Date().toISOString().slice(0, 10);
  const startDate = (() => {
    const parts = today.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    d.setDate(d.getDate() - weeks * 7);
    return d.toISOString().slice(0, 10);
  })();

  const [habitsRes, completionsRes] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, color FROM habits WHERE user_id = ?1 ORDER BY sort_order ASC, created_at ASC')
      .bind(user.sub).all<{ id: string; name: string; color: string }>(),
    c.env.DB.prepare(
      'SELECT habit_id, completed_date FROM habit_completions WHERE user_id = ?1 AND completed_date >= ?2 ORDER BY completed_date ASC'
    ).bind(user.sub, startDate).all<{ habit_id: string; completed_date: string }>(),
  ]);

  const habits = habitsRes.results ?? [];
  const completions = completionsRes.results ?? [];

  // Group completions by habit_id
  const byHabit = new Map<string, string[]>();
  for (const c of completions) {
    if (!byHabit.has(c.habit_id)) byHabit.set(c.habit_id, []);
    byHabit.get(c.habit_id)!.push(c.completed_date);
  }

  return c.json(habits.map(h => ({
    habitId: h.id,
    name: h.name,
    color: h.color,
    dates: byHabit.get(h.id) ?? [],
    startDate,
    today,
  })));
});
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/habits.ts
git commit -m "feat(api): add GET /habits/completions for heatmap"
```

---

## Task 4: Backend — Goals Score Endpoint (for Identity Score)

**Files:**
- Modify: `backend/src/routes/goals.ts`

- [ ] **Step 1: Add score endpoint**

Open `backend/src/routes/goals.ts`. Before `export default goals;`, add:

```typescript
// GET /api/goals/score
// Returns overall identity score (today) + 7-day history
goals.get('/score', async (c) => {
  const user = c.get('user');
  const today = new Date().toISOString().slice(0, 10);

  // Build list of last 7 days
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const parts = today.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const startDate = days[0];

  // Fetch all goals with their habit_ids
  const goalsRes = await c.env.DB.prepare(
    'SELECT id, identity_statement, color, habit_ids FROM goals WHERE user_id = ?1'
  ).bind(user.sub).all<{ id: string; identity_statement: string; color: string; habit_ids: string }>();
  const allGoals = goalsRes.results ?? [];

  if (allGoals.length === 0) {
    return c.json({ today: 0, history: [], goals: [] });
  }

  // Fetch all habit completions for the last 7 days
  const completionsRes = await c.env.DB.prepare(
    'SELECT habit_id, completed_date FROM habit_completions WHERE user_id = ?1 AND completed_date >= ?2'
  ).bind(user.sub, startDate).all<{ habit_id: string; completed_date: string }>();
  const completions = completionsRes.results ?? [];

  // Build a Set per day: day -> Set<habitId>
  const byDay = new Map<string, Set<string>>();
  for (const cp of completions) {
    if (!byDay.has(cp.completed_date)) byDay.set(cp.completed_date, new Set());
    byDay.get(cp.completed_date)!.add(cp.habit_id);
  }

  // Total unique habits across all goals (deduplicated)
  const allHabitIds = new Set<string>();
  for (const g of allGoals) {
    try { JSON.parse(g.habit_ids ?? '[]').forEach((id: string) => allHabitIds.add(id)); } catch {}
  }
  const totalHabits = allHabitIds.size;

  // Compute score per day = (habits completed that day ∩ allHabitIds) / totalHabits * 100
  const history = days.map(day => {
    const done = byDay.get(day);
    if (!done || totalHabits === 0) return { date: day, score: 0 };
    const count = [...allHabitIds].filter(id => done.has(id)).length;
    return { date: day, score: Math.round((count / totalHabits) * 100) };
  });

  const todayScore = history[history.length - 1]?.score ?? 0;

  // Per-goal today score
  const goalsWithScore = allGoals.map(g => {
    let habitIds: string[] = [];
    try { habitIds = JSON.parse(g.habit_ids ?? '[]'); } catch {}
    const todayDone = byDay.get(today);
    const done = todayDone ? habitIds.filter(id => todayDone.has(id)).length : 0;
    const score = habitIds.length > 0 ? Math.round((done / habitIds.length) * 100) : 0;
    return {
      id: g.id,
      identityStatement: g.identity_statement,
      color: g.color,
      habitCount: habitIds.length,
      score,
    };
  });

  return c.json({ today: todayScore, history, goals: goalsWithScore });
});
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/goals.ts
git commit -m "feat(api): add GET /goals/score for identity score + 7-day history"
```

---

## Task 5: Frontend — WeeklyReview Screen

**Files:**
- Create: `frontend/src/screens/WeeklyReview.tsx`

- [ ] **Step 1: Create the screen**

```tsx
// frontend/src/screens/WeeklyReview.tsx
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface HabitStat {
  id: string;
  name: string;
  color: string;
  streak: number;
  completions_this_week: number;
  consistency: number;
}

interface ReviewData {
  weekStart: string;
  weekEnd: string;
  daysElapsed: number;
  overallConsistency: number;
  habits: HabitStat[];
  review: {
    id: string;
    habit_reflection: string | null;
    obstacle: string | null;
    adjustment: string | null;
    identity_affirmation: string | null;
    rating: number;
  } | null;
}

const STARS = [1, 2, 3, 4, 5];

function formatWeekLabel(weekStart: string): string {
  const parts = weekStart.split('-');
  const start = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${start.getDate()} ${months[start.getMonth()]} – ${end.getDate()} ${months[end.getMonth()]}`;
}

export function WeeklyReview() {
  const { goBack } = useUIStore();
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Form state
  const [habitReflection, setHabitReflection] = useState('');
  const [obstacle, setObstacle] = useState('');
  const [adjustment, setAdjustment] = useState('');
  const [identityAffirmation, setIdentityAffirmation] = useState('');
  const [rating, setRating] = useState(3);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ReviewData>('/weekly-review');
      setData(res);
      if (res.review) {
        setHabitReflection(res.review.habit_reflection ?? '');
        setObstacle(res.review.obstacle ?? '');
        setAdjustment(res.review.adjustment ?? '');
        setIdentityAffirmation(res.review.identity_affirmation ?? '');
        setRating(res.review.rating ?? 3);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch('/weekly-review', {
        method: 'POST',
        body: JSON.stringify({ habitReflection, obstacle, adjustment, identityAffirmation, rating }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      load();
    } catch {}
    setSaving(false);
  };

  const consistencyColor = (pct: number) =>
    pct >= 80 ? '#34C759' : pct >= 50 ? '#FF9F0A' : '#FF453A';

  return (
    <div
      className="min-h-screen px-5 pt-14 pb-28 animate-[fyScreen_420ms_cubic-bezier(0.25,0.46,0.45,0.94)_both]"
      style={{ background: 'var(--bg)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <motion.button
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={goBack}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </motion.button>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.5px' }}>
            Review Mingguan
          </h1>
          {data && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
              {formatWeekLabel(data.weekStart)}
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : data ? (
        <div className="flex flex-col gap-4">
          {/* Overall consistency card */}
          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.gentle}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
              KONSISTENSI MINGGU INI
            </p>
            <div className="flex items-end gap-3">
              <span
                className="text-5xl font-black"
                style={{ color: consistencyColor(data.overallConsistency), letterSpacing: '-1px' }}
              >
                {data.overallConsistency}%
              </span>
              <span className="text-sm mb-1" style={{ color: 'var(--text3)' }}>
                dari {data.daysElapsed} hari
              </span>
            </div>
            <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: consistencyColor(data.overallConsistency) }}
                initial={{ width: 0 }}
                animate={{ width: `${data.overallConsistency}%` }}
                transition={springs.smooth}
              />
            </div>
          </motion.div>

          {/* Habit breakdown */}
          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.05 }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
              PER KEBIASAAN
            </p>
            <div className="flex flex-col gap-3">
              {data.habits.map(h => (
                <div key={h.id}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{h.name}</span>
                    <span className="text-xs font-bold" style={{ color: consistencyColor(h.consistency) }}>
                      {h.completions_this_week}/{Math.min(data.daysElapsed, 7)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: h.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${h.consistency}%` }}
                      transition={springs.smooth}
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Rating */}
          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.1 }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
              NILAI MINGGU INI
            </p>
            <div className="flex gap-3 justify-center">
              {STARS.map(s => (
                <motion.button
                  key={s}
                  onClick={() => setRating(s)}
                  whileTap={{ scale: 0.8 }}
                  transition={springs.bouncy}
                  className="text-3xl"
                >
                  {s <= rating ? '⭐' : '☆'}
                </motion.button>
              ))}
            </div>
          </motion.div>

          {/* Reflection form */}
          {[
            { label: 'APA YANG BERHASIL?', value: habitReflection, setter: setHabitReflection, placeholder: 'Kebiasaan mana yang berjalan lancar minggu ini?' },
            { label: 'APA HAMBATANNYA?', value: obstacle, setter: setObstacle, placeholder: 'Apa yang membuat beberapa kebiasaan tidak terlaksana?' },
            { label: 'APA YANG PERLU DISESUAIKAN?', value: adjustment, setter: setAdjustment, placeholder: 'Perubahan kecil apa yang bisa membuat minggu depan lebih baik?' },
            { label: 'AFIRMASI IDENTITAS', value: identityAffirmation, setter: setIdentityAffirmation, placeholder: 'Saya adalah orang yang...' },
          ].map((field, i) => (
            <motion.div
              key={field.label}
              className="rounded-[20px] p-5"
              style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.gentle, delay: 0.12 + i * 0.05 }}
            >
              <p className="text-[10px] font-extrabold uppercase tracking-wider mb-2" style={{ color: 'var(--text3)' }}>
                {field.label}
              </p>
              <textarea
                rows={3}
                className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none leading-relaxed"
                style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                placeholder={field.placeholder}
                value={field.value}
                onChange={e => field.setter(e.target.value)}
              />
            </motion.div>
          ))}

          {/* Save button */}
          <motion.button
            className="w-full py-3.5 rounded-[18px] font-bold text-sm text-white"
            style={{ background: saved ? '#34C759' : 'var(--accent)', opacity: saving ? 0.7 : 1 }}
            onClick={handleSave}
            disabled={saving}
            whileTap={{ scale: 0.97 }}
            transition={springs.snappy}
          >
            {saved ? '✓ Tersimpan!' : saving ? 'Menyimpan...' : 'Simpan Review'}
          </motion.button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/WeeklyReview.tsx
git commit -m "feat(ui): add WeeklyReview screen with habit stats + reflection form"
```

---

## Task 6: Frontend — HabitHeatmap Screen

**Files:**
- Create: `frontend/src/screens/HabitHeatmap.tsx`

- [ ] **Step 1: Create the screen**

```tsx
// frontend/src/screens/HabitHeatmap.tsx
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface HabitData {
  habitId: string;
  name: string;
  color: string;
  dates: string[];  // YYYY-MM-DD array of completed dates
  startDate: string;
  today: string;
}

// Build a 52-week grid: array of 52 weeks, each with 7 days (Mon-Sun)
function buildGrid(startDate: string, today: string, completedSet: Set<string>) {
  // Align startDate to Monday
  const parts = startDate.split('-');
  const start = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const dayOfWeek = start.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  start.setDate(start.getDate() + diff);

  const todayDate = new Date(today);
  const weeks: { date: string; done: boolean; future: boolean }[][] = [];

  for (let w = 0; w < 52; w++) {
    const week: { date: string; done: boolean; future: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const current = new Date(start);
      current.setDate(start.getDate() + w * 7 + d);
      const dateStr = current.toISOString().slice(0, 10);
      week.push({
        date: dateStr,
        done: completedSet.has(dateStr),
        future: current > todayDate,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];

function getMonthLabels(weeks: { date: string }[][]) {
  const labels: { month: string; col: number }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, i) => {
    const d = new Date(week[0].date);
    const m = d.getMonth();
    if (m !== lastMonth) {
      labels.push({ month: MONTH_LABELS[m], col: i });
      lastMonth = m;
    }
  });
  return labels;
}

export function HabitHeatmap() {
  const { goBack } = useUIStore();
  const [habits, setHabits] = useState<HabitData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedHabit, setSelectedHabit] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<HabitData[]>('/habits/completions?weeks=52')
      .then(res => {
        setHabits(res);
        if (res.length > 0) setSelectedHabit(res[0].habitId);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const activeHabit = habits.find(h => h.habitId === selectedHabit);
  const completedSet = new Set(activeHabit?.dates ?? []);
  const weeks = activeHabit ? buildGrid(activeHabit.startDate, activeHabit.today, completedSet) : [];
  const monthLabels = getMonthLabels(weeks);

  const totalDone = activeHabit?.dates.length ?? 0;
  const longestStreak = (() => {
    if (!activeHabit) return 0;
    let max = 0; let cur = 0;
    const sorted = [...activeHabit.dates].sort();
    for (let i = 0; i < sorted.length; i++) {
      if (i === 0) { cur = 1; max = 1; continue; }
      const prev = new Date(sorted[i - 1]);
      const curr = new Date(sorted[i]);
      const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
      if (diff === 1) { cur++; max = Math.max(max, cur); }
      else { cur = 1; }
    }
    return max;
  })();

  return (
    <div
      className="min-h-screen px-5 pt-14 pb-28 animate-[fyScreen_420ms_cubic-bezier(0.25,0.46,0.45,0.94)_both]"
      style={{ background: 'var(--bg)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <motion.button
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={goBack}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </motion.button>
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.5px' }}>
          Heatmap Kebiasaan
        </h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : habits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-4xl">📅</p>
          <p className="font-semibold" style={{ color: 'var(--text2)' }}>Belum ada kebiasaan</p>
        </div>
      ) : (
        <>
          {/* Habit selector pills */}
          <div className="flex gap-2 flex-wrap mb-5">
            {habits.map(h => (
              <motion.button
                key={h.habitId}
                className="px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{
                  background: selectedHabit === h.habitId ? h.color : 'var(--surface)',
                  color: selectedHabit === h.habitId ? 'white' : 'var(--text2)',
                  border: `1px solid ${selectedHabit === h.habitId ? h.color : 'var(--sep)'}`,
                }}
                onClick={() => setSelectedHabit(h.habitId)}
                whileTap={{ scale: 0.93 }}
                transition={springs.snappy}
              >
                {h.name}
              </motion.button>
            ))}
          </div>

          {activeHabit && (
            <motion.div
              key={activeHabit.habitId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springs.gentle}
            >
              {/* Stats row */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-[16px] p-4" style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text3)' }}>Total Hari</p>
                  <p className="text-2xl font-black" style={{ color: activeHabit.color }}>{totalDone}</p>
                </div>
                <div className="rounded-[16px] p-4" style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text3)' }}>Streak Terpanjang</p>
                  <p className="text-2xl font-black" style={{ color: activeHabit.color }}>{longestStreak}🔥</p>
                </div>
              </div>

              {/* Heatmap grid */}
              <div
                className="rounded-[20px] p-4 overflow-x-auto"
                style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
              >
                {/* Month labels */}
                <div className="relative h-5 mb-1" style={{ minWidth: weeks.length * 13 }}>
                  {monthLabels.map(({ month, col }) => (
                    <span
                      key={`${month}-${col}`}
                      className="absolute text-[9px] font-bold"
                      style={{ color: 'var(--text3)', left: col * 13 }}
                    >
                      {month}
                    </span>
                  ))}
                </div>
                {/* Grid: columns = weeks, rows = days */}
                <div className="flex gap-[3px]" style={{ minWidth: weeks.length * 13 }}>
                  {weeks.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-[3px]">
                      {week.map((day) => (
                        <div
                          key={day.date}
                          className="w-[10px] h-[10px] rounded-[2px]"
                          style={{
                            background: day.future
                              ? 'transparent'
                              : day.done
                                ? activeHabit.color
                                : 'var(--track)',
                            border: day.future ? '1px solid var(--sep)' : 'none',
                            opacity: day.done ? 1 : day.future ? 0.3 : 0.35,
                          }}
                          title={day.date}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                {/* Day labels */}
                <div className="flex flex-col gap-[3px] absolute left-0 top-0" style={{ display: 'none' }} />
                <div className="flex gap-3 mt-3 text-[9px] font-bold" style={{ color: 'var(--text3)' }}>
                  <span>Sen</span><span>Sel</span><span>Rab</span><span>Kam</span><span>Jum</span><span>Sab</span><span>Min</span>
                </div>
              </div>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/HabitHeatmap.tsx
git commit -m "feat(ui): add HabitHeatmap screen with GitHub-style 52-week grid"
```

---

## Task 7: Frontend — DebtPlanner Screen

**Files:**
- Create: `frontend/src/screens/DebtPlanner.tsx`

- [ ] **Step 1: Create the screen**

```tsx
// frontend/src/screens/DebtPlanner.tsx
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface Debt {
  id: string;
  type: string;        // 'debt' | 'receivable'
  person_name: string;
  amount_idr: number;
  due_date: string | null;
  note: string | null;
  status: string;      // 'unpaid' | 'paid'
}

interface PayoffStep {
  month: number;
  debtName: string;
  payment: number;
  remainingBalance: number;
  isPaidOff: boolean;
}

function formatRp(n: number) {
  return n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}

// Compute payoff schedule using snowball (smallest balance first) or avalanche (highest interest first — no rate data, so same order as snowball here)
function computePayoff(debts: Debt[], method: 'snowball' | 'avalanche', extraMonthly: number): PayoffStep[] {
  // Only unpaid debts of type 'debt'
  const unpaid = debts
    .filter(d => d.status === 'unpaid' && d.type === 'debt')
    .map(d => ({ ...d, balance: d.amount_idr }));

  if (unpaid.length === 0) return [];

  // Sort: snowball = smallest balance first; avalanche = we'd need interest rate, use due_date proximity
  const sorted = [...unpaid].sort((a, b) =>
    method === 'snowball'
      ? a.balance - b.balance
      : (a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1
  );

  const minPayment = Math.ceil(sorted[0].balance / 12); // estimate: pay off first debt in 12 months minimum
  const totalMonthly = minPayment + extraMonthly;
  const steps: PayoffStep[] = [];
  const working = sorted.map(d => ({ ...d }));

  let month = 0;
  while (working.some(d => d.balance > 0) && month < 120) {
    month++;
    let remaining = totalMonthly;

    for (const debt of working) {
      if (debt.balance <= 0) continue;
      const pay = Math.min(remaining, debt.balance);
      debt.balance -= pay;
      remaining -= pay;
      steps.push({
        month,
        debtName: `${debt.person_name}`,
        payment: pay,
        remainingBalance: Math.max(0, debt.balance),
        isPaidOff: debt.balance <= 0,
      });
      if (remaining <= 0) break;
    }
  }

  return steps;
}

export function DebtPlanner() {
  const { goBack } = useUIStore();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState<'snowball' | 'avalanche'>('snowball');
  const [extraMonthly, setExtraMonthly] = useState(0);
  const [extraInput, setExtraInput] = useState('');

  useEffect(() => {
    apiFetch<Debt[]>('/debts')
      .then(res => setDebts(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const unpaidDebts = debts.filter(d => d.status === 'unpaid' && d.type === 'debt');
  const totalDebt = unpaidDebts.reduce((s, d) => s + d.amount_idr, 0);
  const steps = computePayoff(debts, method, extraMonthly);
  const payoffMonth = steps.length > 0 ? Math.max(...steps.map(s => s.isPaidOff ? s.month : 0)) : 0;
  
  // Group steps by month for display (only show payoff events)
  const payoffEvents = steps.filter(s => s.isPaidOff);

  return (
    <div
      className="min-h-screen px-5 pt-14 pb-28 animate-[fyScreen_420ms_cubic-bezier(0.25,0.46,0.45,0.94)_both]"
      style={{ background: 'var(--bg)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <motion.button
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={goBack}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </motion.button>
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.5px' }}>
          Pelunasan Utang
        </h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : unpaidDebts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-4xl">🎉</p>
          <p className="font-semibold" style={{ color: 'var(--text2)' }}>Tidak ada utang aktif</p>
          <p className="text-sm text-center" style={{ color: 'var(--text3)' }}>Tambah utang di menu Laporan Keuangan untuk mulai merencanakan pelunasan</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Total debt */}
          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.gentle}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1" style={{ color: 'var(--text3)' }}>TOTAL UTANG AKTIF</p>
            <p className="text-3xl font-black" style={{ color: '#FF453A', letterSpacing: '-0.5px' }}>{formatRp(totalDebt)}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>{unpaidDebts.length} utang belum lunas</p>
          </motion.div>

          {/* Method selector */}
          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.05 }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>METODE PELUNASAN</p>
            <div className="grid grid-cols-2 gap-2">
              {(['snowball', 'avalanche'] as const).map(m => (
                <motion.button
                  key={m}
                  className="py-3 rounded-xl text-xs font-bold"
                  style={{
                    background: method === m ? 'var(--accent)' : 'var(--bg)',
                    color: method === m ? 'white' : 'var(--text2)',
                    border: `1px solid ${method === m ? 'var(--accent)' : 'var(--sep)'}`,
                  }}
                  onClick={() => setMethod(m)}
                  whileTap={{ scale: 0.96 }}
                  transition={springs.snappy}
                >
                  {m === 'snowball' ? '❄️ Snowball' : '🏔️ Avalanche'}
                  <span className="block text-[9px] mt-0.5 font-normal opacity-80">
                    {m === 'snowball' ? 'Terkecil dulu' : 'Jatuh tempo dulu'}
                  </span>
                </motion.button>
              ))}
            </div>
            <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--text3)' }}>
              {method === 'snowball'
                ? 'Bayar utang terkecil dulu → motivasi cepat meningkat.'
                : 'Bayar utang yang paling dekat jatuh temponya dulu.'}
            </p>
          </motion.div>

          {/* Extra payment input */}
          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.08 }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-2" style={{ color: 'var(--text3)' }}>TAMBAHAN BAYAR PER BULAN</p>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: 'var(--text2)' }}>Rp</span>
              <input
                className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none font-semibold"
                style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                placeholder="0"
                inputMode="numeric"
                value={extraInput}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '');
                  setExtraInput(v);
                  setExtraMonthly(parseInt(v) || 0);
                }}
              />
            </div>
          </motion.div>

          {/* Payoff projection */}
          {payoffMonth > 0 && (
            <motion.div
              className="rounded-[20px] p-5"
              style={{ background: 'var(--accentSoft)', border: '1px solid var(--accent)' }}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={springs.bouncy}
            >
              <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1" style={{ color: 'var(--accent)' }}>PROYEKSI LUNAS</p>
              <p className="text-2xl font-black" style={{ color: 'var(--accent)' }}>
                {payoffMonth < 12
                  ? `${payoffMonth} bulan`
                  : `${Math.floor(payoffMonth / 12)} thn ${payoffMonth % 12} bln`}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text2)' }}>
                estimasi berdasarkan cicilan minimum + tambahan {formatRp(extraMonthly)}/bln
              </p>
            </motion.div>
          )}

          {/* Debt list with order */}
          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.12 }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>URUTAN PELUNASAN</p>
            {unpaidDebts
              .sort((a, b) => method === 'snowball'
                ? a.amount_idr - b.amount_idr
                : (a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1
              )
              .map((d, i) => (
                <div key={d.id} className="flex items-center gap-3 py-3 border-b last:border-0" style={{ borderColor: 'var(--sep)' }}>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
                    style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--text)' }}>{d.person_name}</p>
                    {d.due_date && (
                      <p className="text-[10px]" style={{ color: 'var(--text3)' }}>jatuh tempo {d.due_date}</p>
                    )}
                  </div>
                  <p className="font-bold text-sm flex-shrink-0" style={{ color: '#FF453A' }}>{formatRp(d.amount_idr)}</p>
                </div>
              ))}
          </motion.div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/DebtPlanner.tsx
git commit -m "feat(ui): add DebtPlanner screen with snowball/avalanche payoff calculator"
```

---

## Task 8: Frontend — Identity Score Card in Goals Screen

**Files:**
- Modify: `frontend/src/screens/Goals.tsx`

- [ ] **Step 1: Add score state + fetch**

Open `frontend/src/screens/Goals.tsx`. 

After the existing `interface Goal { ... }` block, add:

```typescript
interface ScoreData {
  today: number;
  history: { date: string; score: number }[];
  goals: { id: string; score: number }[];
}
```

Inside the `Goals()` function, after the existing `const [loading, setLoading] = useState(true);` line, add:

```typescript
const [score, setScore] = useState<ScoreData | null>(null);
```

Modify the existing `load` function to also fetch score:

```typescript
const load = async () => {
  setLoading(true);
  try {
    const [goalsRes, habitsRes, scoreRes] = await Promise.all([
      apiFetch<Goal[]>('/goals'),
      apiFetch<Habit[]>('/habits'),
      apiFetch<ScoreData>('/goals/score'),
    ]);
    setGoals(goalsRes);
    setHabits(habitsRes);
    setScore(scoreRes);
  } catch {}
  setLoading(false);
};
```

- [ ] **Step 2: Add Identity Score card above Compounding Chart Card**

In the JSX, find the existing `{/* Compounding Chart Card */}` comment. Insert this block right before it:

```tsx
{/* Identity Score Card */}
{score && (
  <motion.div
    className="rounded-[22px] p-5 mb-4"
    style={{
      background: `linear-gradient(135deg, var(--accent), var(--accent2))`,
      boxShadow: '0 14px 30px var(--accentSoft)',
    }}
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={springs.gentle}
  >
    <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1 text-white/70">
      IDENTITY SCORE HARI INI
    </p>
    <div className="flex items-end gap-2 mb-3">
      <span className="text-5xl font-black text-white" style={{ letterSpacing: '-1px' }}>
        {score.today}%
      </span>
      <span className="text-sm text-white/70 mb-1.5">identitas terpenuhi</span>
    </div>
    {/* 7-day sparkline */}
    <div className="flex items-end gap-1 h-10">
      {score.history.map((d, i) => {
        const isToday = i === score.history.length - 1;
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
            <motion.div
              className="w-full rounded-t-[3px]"
              style={{
                background: isToday ? 'white' : 'rgba(255,255,255,0.35)',
                minHeight: 2,
              }}
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(4, (d.score / 100) * 36)}px` }}
              transition={{ ...springs.smooth, delay: i * 0.04 }}
            />
          </div>
        );
      })}
    </div>
    <div className="flex justify-between mt-1">
      <span className="text-[9px] text-white/50">
        {score.history[0]?.date.slice(5).replace('-', '/')}
      </span>
      <span className="text-[9px] text-white/50">hari ini</span>
    </div>
  </motion.div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/Goals.tsx
git commit -m "feat(ui): add Identity Score card with 7-day sparkline to Goals screen"
```

---

## Task 9: Frontend — Smart Reminder Badges on Habit Cards

**Files:**
- Modify: `frontend/src/screens/Habits.tsx`

- [ ] **Step 1: Show reminderTime on each habit card**

Open `frontend/src/screens/Habits.tsx`. Find the habit card JSX where each habit is rendered. Look for where `h.twoMin` is displayed (the "2-menit: ..." text in the footer row of each card). 

After the streak/twoMin footer row, add a reminder time badge if `h.reminderTime` is set. Find the section that looks like:

```tsx
{/* Footer: streak + two-min */}
```

If that exact comment doesn't exist, find the part of the habit card that shows `h.streak` and `h.twoMin`. Add this badge immediately after the twoMin display:

```tsx
{h.reminderTime && (
  <div className="flex items-center gap-1 mt-1.5">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
    <span className="text-[10px] font-semibold" style={{ color: 'var(--text3)' }}>
      Pengingat {h.reminderTime}
    </span>
  </div>
)}
```

Also, in the **Add Habit form** and **Edit Habit form**, make sure `reminderTime` input shows a label. Find where `newReminderTime` input is rendered. If it has no label, add this label above it:

```tsx
<p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
  WAKTU PENGINGAT (HH:MM)
</p>
```

And make the input more prominent:
```tsx
<input
  type="time"
  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
  style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
  value={newReminderTime}
  onChange={e => setNewReminderTime(e.target.value)}
/>
```

(Apply same pattern for `editReminderTime` in the edit form.)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/Habits.tsx
git commit -m "feat(ui): show reminder time badge on habit cards + improve reminder input"
```

---

## Task 10: Wire Navigation — App.tsx + More.tsx

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/screens/More.tsx`

- [ ] **Step 1: Add imports in App.tsx**

Open `frontend/src/App.tsx`. After the existing imports, add:

```typescript
import { WeeklyReview } from '@/screens/WeeklyReview';
import { HabitHeatmap } from '@/screens/HabitHeatmap';
import { DebtPlanner } from '@/screens/DebtPlanner';
```

- [ ] **Step 2: Register sub-screens in App.tsx**

Find the `subScreens` object in `App.tsx`. It looks like:
```typescript
const subScreens: Record<string, React.ReactNode> = {
  projects: <Projects />,
  activity: <Activity />,
  // ...
};
```

Add 3 new entries:
```typescript
'weekly-review': <WeeklyReview />,
'habit-heatmap': <HabitHeatmap />,
'debt-planner': <DebtPlanner />,
```

- [ ] **Step 3: Add menu items in More.tsx**

Open `frontend/src/screens/More.tsx`. Find the array inside the `MODUL LAINNYA` section:

```typescript
{ label: 'Laporan Keuangan', id: 'financial-report', desc: 'Rekap Laba Rugi, Neraca, & Utang' }
```

Add 3 new entries after it:
```typescript
{ label: 'Review Mingguan', id: 'weekly-review', desc: 'Refleksi kebiasaan & penyesuaian mingguan' },
{ label: 'Heatmap Kebiasaan', id: 'habit-heatmap', desc: 'Visualisasi 52 minggu konsistensi kebiasaan' },
{ label: 'Pelunasan Utang', id: 'debt-planner', desc: 'Kalkulator snowball & avalanche payoff' },
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/screens/More.tsx
git commit -m "feat(nav): register WeeklyReview, HabitHeatmap, DebtPlanner sub-screens"
```

---

## Self-Review

### Spec Coverage

| Feature | Task(s) | Status |
|---|---|---|
| Weekly Review Screen | Task 1, 2, 5 | ✅ Covered |
| Identity Score | Task 4, 8 | ✅ Covered |
| Debt Planner | Task 7 | ✅ Covered |
| Habit Heatmap | Task 3, 6 | ✅ Covered |
| Smart Reminder Hub | Task 9 | ✅ Covered (badge display + time input UX) |
| Navigation wiring | Task 10 | ✅ Covered |

### No Placeholders Check
- All code blocks are complete with actual implementation
- All API endpoints have real SQL queries
- All frontend components have real JSX

### Type Consistency
- `apiFetch<HabitData[]>('/habits/completions?weeks=52')` — matches route response shape
- `apiFetch<ScoreData>('/goals/score')` — matches `ScoreData` interface defined in Goals.tsx
- `apiFetch<ReviewData>('/weekly-review')` — matches route response shape
- `apiFetch<Debt[]>('/debts')` — matches existing `Debt` interface in DebtPlanner

### Notes
- DebtPlanner uses client-side calculation (no interest rate data in DB, so projection is approximate)
- Smart Reminder: `action_time` already stores HH:MM and cron already sends push at that time. Task 9 makes reminder time visible on cards and improves the input UX. No backend change needed.
- Identity Score endpoint returns `history` based on `habit_completions` table (accurate 7-day retroactive calculation)
- Weekly review migration (`0009`) must be applied to D1 before deploying backend
