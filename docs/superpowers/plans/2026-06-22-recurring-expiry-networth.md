# Recurring Budget, Expiry Alerts & Net Worth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 backend+frontend features: (1) recurring budget entries auto-created by scheduler, (2) push notifications for inventory items expiring within 3 days, (3) net worth tracker with monthly snapshots.

**Architecture:** Single DB migration adds all new columns/tables. Each feature gets a dedicated function in `index.ts` called from the existing `scheduled` handler. Net worth gets its own route file. Frontend changes are surgical additions to existing screens.

**Tech Stack:** Hono, Cloudflare Workers, D1 (SQLite), `@block65/webcrypto-web-push`, React + Tailwind + Framer Motion

---

## File Map

| Action | Path | What changes |
|---|---|---|
| Create | `backend/migrations/0008_recurring_expiry_networth.sql` | New columns + new table |
| Modify | `backend/src/routes/budget.ts` | POST /budget accepts `recurrence`, GET /budget/recurring |
| Modify | `backend/src/index.ts` | Add `processRecurringBudget` + `triggerExpiryAlerts` + `takeNetWorthSnapshot` to scheduled handler |
| Create | `backend/src/routes/net_worth.ts` | GET /api/net-worth |
| Modify | `backend/src/index.ts` | Register `/api/net-worth` route |
| Modify | `frontend/src/screens/Budget.tsx` | Add recurrence select + `recurring` to state + send to API |
| Modify | `frontend/src/screens/Dashboard.tsx` | Add NetWorth card + fetch `/net-worth` |

---

## Task 1: DB Migration

**Files:**
- Create: `backend/migrations/0008_recurring_expiry_networth.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Feature 1: Recurring budget entries
ALTER TABLE budget_entries ADD COLUMN recurrence TEXT;           -- NULL | 'daily' | 'weekly' | 'monthly'
ALTER TABLE budget_entries ADD COLUMN next_recurrence_date TEXT; -- YYYY-MM-DD, NULL for one-time or generated copies

-- Feature 2: Inventory expiry alert dedup
ALTER TABLE inventory_items ADD COLUMN expiry_alert_sent TEXT;   -- YYYY-MM-DD of last sent alert

-- Feature 3: Net worth monthly snapshots
CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,            -- YYYY-MM
  assets INTEGER NOT NULL DEFAULT 0,
  liabilities INTEGER NOT NULL DEFAULT 0,
  net_worth INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_net_worth_snapshots_user ON net_worth_snapshots(user_id);
```

- [ ] **Step 2: Apply migration to local dev DB**

```bash
cd backend
wrangler d1 execute fayolla-db --local --file=./migrations/0008_recurring_expiry_networth.sql
```

Expected output: `✅ Applied 0008_recurring_expiry_networth.sql`

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/0008_recurring_expiry_networth.sql
git commit -m "feat: migration for recurring budget, expiry alerts, net worth snapshots"
```

---

## Task 2: Date Helper Utility

**Files:**
- Modify: `backend/src/lib/validate.ts` (add `jakartaToday` and `advanceDate`)

- [ ] **Step 1: Add helpers to `backend/src/lib/validate.ts`**

Append to the end of the file (after the existing exports):

```typescript
/** Returns today's date in Jakarta timezone (UTC+7) as YYYY-MM-DD */
export function jakartaToday(): string {
  const now = new Date();
  const jakarta = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return jakarta.toISOString().slice(0, 10);
}

/** Advance a YYYY-MM-DD date by the given recurrence interval */
export function advanceDate(dateStr: string, recurrence: 'daily' | 'weekly' | 'monthly'): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (recurrence === 'daily') dt.setDate(dt.getDate() + 1);
  else if (recurrence === 'weekly') dt.setDate(dt.getDate() + 7);
  else if (recurrence === 'monthly') dt.setMonth(dt.getMonth() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/validate.ts
git commit -m "feat: add jakartaToday and advanceDate helpers to validate.ts"
```

---

## Task 3: Feature 1 — Recurring Budget Backend

**Files:**
- Modify: `backend/src/routes/budget.ts`

**What changes:**
- `POST /api/budget`: accept `recurrence` field; if present, compute and store `next_recurrence_date`
- Add `GET /api/budget/recurring`: list all recurring templates for current user

- [ ] **Step 1: Update POST /api/budget to accept recurrence**

In `backend/src/routes/budget.ts`, find the import line and add the new imports:

```typescript
import { validate, advanceDate, jakartaToday } from '../lib/validate';
```

(Replace existing `import { validate } from '../lib/validate';`)

- [ ] **Step 2: Update the BudgetBody type and addEntry logic**

Find:
```typescript
// POST /api/budget
budget.post('/', async (c) => {
  const user = c.get('user');
  type BudgetBody = {
    type?: string;
    amount?: number;
    category?: string;
    note?: string;
    date?: string;
    bank_account_id?: string;
    receipt_img?: string;
  };
  const body = await c.req.json<BudgetBody>().catch((): BudgetBody => ({}));

  const err = validate(body as Record<string, unknown>, {
    type:     { type: 'enum', values: ['income', 'expense'] },
    amount:   { type: 'number', min: 1 },
    category: { type: 'string' },
  });
  if (err) return c.json({ error: err }, 400);

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const entryDate = body.date ?? new Date().toISOString().slice(0, 10);
  const amount = Math.round(body.amount!);
  const bankAccountId = body.bank_account_id || null;
  const receiptImg = body.receipt_img || null;

  // Insert transaction
  await c.env.DB.prepare(
    `INSERT INTO budget_entries (id, user_id, type, amount_idr, category, note, entry_date, bank_account_id, receipt_img, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(id, user.sub, body.type, amount, body.category, body.note ?? null, entryDate, bankAccountId, receiptImg, now).run();
```

Replace with:
```typescript
// POST /api/budget
budget.post('/', async (c) => {
  const user = c.get('user');
  type BudgetBody = {
    type?: string;
    amount?: number;
    category?: string;
    note?: string;
    date?: string;
    bank_account_id?: string;
    receipt_img?: string;
    recurrence?: string;
  };
  const body = await c.req.json<BudgetBody>().catch((): BudgetBody => ({}));

  const err = validate(body as Record<string, unknown>, {
    type:     { type: 'enum', values: ['income', 'expense'] },
    amount:   { type: 'number', min: 1 },
    category: { type: 'string' },
  });
  if (err) return c.json({ error: err }, 400);

  const VALID_RECURRENCES = ['daily', 'weekly', 'monthly'];
  const recurrence = body.recurrence && VALID_RECURRENCES.includes(body.recurrence) ? body.recurrence : null;

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const entryDate = body.date ?? jakartaToday();
  const amount = Math.round(body.amount!);
  const bankAccountId = body.bank_account_id || null;
  const receiptImg = body.receipt_img || null;
  const nextRecurrenceDate = recurrence
    ? advanceDate(entryDate, recurrence as 'daily' | 'weekly' | 'monthly')
    : null;

  // Insert transaction
  await c.env.DB.prepare(
    `INSERT INTO budget_entries (id, user_id, type, amount_idr, category, note, entry_date, bank_account_id, receipt_img, created_at, recurrence, next_recurrence_date)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
  ).bind(id, user.sub, body.type, amount, body.category, body.note ?? null, entryDate, bankAccountId, receiptImg, now, recurrence, nextRecurrenceDate).run();
```

- [ ] **Step 3: Update the return value of POST /api/budget to include recurrence fields**

Find the return statement at the end of `POST /api/budget`:
```typescript
  return c.json({
    id,
    type: body.type,
    amount,
    category: body.category,
    note: body.note,
    date: entryDate,
    bank_account_id: bankAccountId,
    receipt_img: receiptImg,
  }, 201);
```

Replace with:
```typescript
  return c.json({
    id,
    type: body.type,
    amount,
    category: body.category,
    note: body.note,
    date: entryDate,
    bank_account_id: bankAccountId,
    receipt_img: receiptImg,
    recurrence,
    next_recurrence_date: nextRecurrenceDate,
  }, 201);
```

- [ ] **Step 4: Add GET /api/budget/recurring endpoint**

Add this route before `export default budget;`:

```typescript
// GET /api/budget/recurring — list recurring templates for current user
budget.get('/recurring', async (c) => {
  const user = c.get('user');

  const rows = await c.env.DB.prepare(
    `SELECT * FROM budget_entries
     WHERE user_id = ?1 AND recurrence IS NOT NULL
     ORDER BY created_at DESC`
  ).bind(user.sub).all<BudgetEntryRow & { recurrence: string; next_recurrence_date: string }>();

  return c.json(
    (rows.results ?? []).map(e => ({
      id: e.id,
      type: e.type,
      amount: e.amount_idr,
      category: e.category,
      note: e.note,
      date: e.entry_date,
      recurrence: e.recurrence,
      next_recurrence_date: e.next_recurrence_date,
    }))
  );
});
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/budget.ts
git commit -m "feat: recurring budget entries - POST accepts recurrence, GET /recurring endpoint"
```

---

## Task 4: Feature 1 — Recurring Budget Scheduler

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Add import for helpers at top of index.ts**

Add to the imports section of `backend/src/index.ts`:

```typescript
import { advanceDate, jakartaToday } from './lib/validate';
```

- [ ] **Step 2: Add `processRecurringBudget` function**

Add this function before the `handler` export in `backend/src/index.ts`:

```typescript
async function processRecurringBudget(env: Env) {
  const today = jakartaToday();

  // Find all recurring templates due today or overdue
  const due = await env.DB.prepare(`
    SELECT * FROM budget_entries
    WHERE recurrence IS NOT NULL AND next_recurrence_date <= ?1
  `).bind(today).all<{
    id: string;
    user_id: string;
    type: string;
    amount_idr: number;
    category: string;
    note: string | null;
    bank_account_id: string | null;
    recurrence: string;
    next_recurrence_date: string;
  }>();

  if (!due.results || due.results.length === 0) return;

  const { nanoid } = await import('./lib/nanoid');
  const now = Math.floor(Date.now() / 1000);

  for (const template of due.results) {
    const newId = nanoid();
    const entryDate = template.next_recurrence_date;
    const nextDate = advanceDate(entryDate, template.recurrence as 'daily' | 'weekly' | 'monthly');

    // Create the new entry (recurrence = NULL — it's a generated copy)
    await env.DB.prepare(`
      INSERT INTO budget_entries
        (id, user_id, type, amount_idr, category, note, entry_date, bank_account_id, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    `).bind(newId, template.user_id, template.type, template.amount_idr, template.category,
            template.note, entryDate, template.bank_account_id, now).run();

    // Adjust bank account balance if linked
    if (template.bank_account_id) {
      const sign = template.type === 'expense' ? -1 : 1;
      await env.DB.prepare(`
        UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3
      `).bind(sign * template.amount_idr, template.bank_account_id, template.user_id).run();
    }

    // Advance the template's next_recurrence_date
    await env.DB.prepare(`
      UPDATE budget_entries SET next_recurrence_date = ?1 WHERE id = ?2
    `).bind(nextDate, template.id).run();
  }
}
```

- [ ] **Step 3: Call processRecurringBudget from scheduled handler**

Find:
```typescript
  async scheduled(event: any, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(triggerReminders(env));
  }
```

Replace with:
```typescript
  async scheduled(event: any, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([
      triggerReminders(env),
      processRecurringBudget(env),
    ]));
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat: processRecurringBudget scheduler - auto-create recurring entries daily"
```

---

## Task 5: Feature 2 — Inventory Expiry Alert Scheduler

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Add `triggerExpiryAlerts` function to index.ts**

Add after `processRecurringBudget` and before the `handler` export:

```typescript
async function triggerExpiryAlerts(env: Env) {
  const today = jakartaToday();

  // Only run once per day at 8 AM Jakarta time
  const now = new Date();
  const jakartaHour = new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCHours();
  if (jakartaHour !== 8) return;

  // Find items expiring within 3 days that haven't been alerted today
  const threeDaysFromNow = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  })();

  const items = await env.DB.prepare(`
    SELECT i.id, i.user_id, i.name, i.expiry_date, i.quantity, i.unit
    FROM inventory_items i
    WHERE i.expiry_date BETWEEN ?1 AND ?2
      AND (i.expiry_alert_sent IS NULL OR i.expiry_alert_sent != ?3)
  `).bind(today, threeDaysFromNow, today).all<{
    id: string;
    user_id: string;
    name: string;
    expiry_date: string;
    quantity: number;
    unit: string;
  }>();

  if (!items.results || items.results.length === 0) return;

  // Group by user
  const byUser = new Map<string, typeof items.results>();
  for (const item of items.results) {
    if (!byUser.has(item.user_id)) byUser.set(item.user_id, []);
    byUser.get(item.user_id)!.push(item);
  }

  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  for (const [userId, userItems] of byUser.entries()) {
    const subs = await env.DB.prepare(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?1'
    ).bind(userId).all<{ endpoint: string; p256dh: string; auth: string }>();

    if (!subs.results || subs.results.length === 0) continue;

    const itemList = userItems.map(i => `• ${i.name} (${i.quantity} ${i.unit}) — kadaluarsa ${i.expiry_date}`).join('\n');
    const body = userItems.length === 1
      ? `${userItems[0].name} kadaluarsa ${userItems[0].expiry_date}. Segera gunakan! 🚨`
      : `${userItems.length} item akan kadaluarsa:\n${itemList}`;

    const message = {
      data: JSON.stringify({
        title: '⚠️ Stok Mau Kadaluarsa',
        body,
        url: '/lainnya',
      })
    };

    for (const sub of subs.results) {
      try {
        const payload = await buildPushPayload(message, {
          endpoint: sub.endpoint,
          expirationTime: null,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        }, vapid);
        const res = await fetch(sub.endpoint, payload);
        if (res.status === 410 || res.status === 404) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(sub.endpoint).run();
        }
      } catch (err) {
        console.error('Expiry alert push failed', err);
      }
    }

    // Mark all notified items as sent today
    const ids = userItems.map(() => '?').join(',');
    const bindings = [today, ...userItems.map(i => i.id)];
    await env.DB.prepare(
      `UPDATE inventory_items SET expiry_alert_sent = ?1 WHERE id IN (${ids})`
    ).bind(...bindings).run();
  }
}
```

- [ ] **Step 2: Add triggerExpiryAlerts to scheduled handler**

Find:
```typescript
  async scheduled(event: any, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([
      triggerReminders(env),
      processRecurringBudget(env),
    ]));
  }
```

Replace with:
```typescript
  async scheduled(event: any, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([
      triggerReminders(env),
      processRecurringBudget(env),
      triggerExpiryAlerts(env),
    ]));
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat: inventory expiry push alerts - notify at 8 AM Jakarta for items expiring in 3 days"
```

---

## Task 6: Feature 3 — Net Worth Route

**Files:**
- Create: `backend/src/routes/net_worth.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Create `backend/src/routes/net_worth.ts`**

```typescript
import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';

const netWorth = new Hono<AuthContext>();

netWorth.use('/*', requireAuth);

// GET /api/net-worth
// Returns current net worth + last 6 months of snapshots
netWorth.get('/', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();
  const currentMonth = today.slice(0, 7); // YYYY-MM

  // Compute current assets and liabilities
  const [assetsRes, liabilitiesRes] = await Promise.all([
    c.env.DB.prepare(
      'SELECT COALESCE(SUM(balance), 0) as total FROM bank_accounts WHERE user_id = ?1'
    ).bind(user.sub).first<{ total: number }>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_idr), 0) as total FROM debts
       WHERE user_id = ?1 AND status != 'paid'`
    ).bind(user.sub).first<{ total: number }>(),
  ]);

  const assets = assetsRes?.total ?? 0;
  const liabilities = liabilitiesRes?.total ?? 0;
  const currentNetWorth = assets - liabilities;

  // Upsert snapshot for current month
  await c.env.DB.prepare(`
    INSERT INTO net_worth_snapshots (id, user_id, month, assets, liabilities, net_worth)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(user_id, month)
    DO UPDATE SET assets = excluded.assets, liabilities = excluded.liabilities, net_worth = excluded.net_worth
  `).bind(nanoid(), user.sub, currentMonth, assets, liabilities, currentNetWorth).run();

  // Fetch last 6 months of snapshots
  const historyRes = await c.env.DB.prepare(`
    SELECT month, assets, liabilities, net_worth
    FROM net_worth_snapshots
    WHERE user_id = ?1
    ORDER BY month DESC
    LIMIT 6
  `).bind(user.sub).all<{ month: string; assets: number; liabilities: number; net_worth: number }>();

  const history = (historyRes.results ?? []).reverse(); // oldest → newest for chart

  return c.json({
    current: {
      assets,
      liabilities,
      net_worth: currentNetWorth,
      month: currentMonth,
    },
    history,
  });
});

export default netWorth;
```

- [ ] **Step 2: Register route in `backend/src/index.ts`**

Add import after other route imports:
```typescript
import netWorth from './routes/net_worth';
```

Add route registration after the debts route:
```typescript
app.route('/api/net-worth', netWorth);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend
npx tsc --noEmit
```

- [ ] **Step 4: Test endpoint manually**

```bash
cd backend
wrangler dev &
# then in another terminal:
curl -H "Authorization: Bearer <your_jwt>" http://localhost:8787/api/net-worth
```

Expected: `{ "current": { "assets": ..., "liabilities": ..., "net_worth": ..., "month": "2026-06" }, "history": [...] }`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/net_worth.ts backend/src/index.ts
git commit -m "feat: net worth route - current value + 6-month snapshot history"
```

---

## Task 7: Feature 1 Frontend — Recurrence Select in Budget Form

**Files:**
- Modify: `frontend/src/screens/Budget.tsx`

- [ ] **Step 1: Add `recurrence` state to Budget component**

Find the block of useState declarations (around line 172–179). Add after `const [bankAccountId, setBankAccountId] = useState('');`:

```typescript
const [recurrence, setRecurrence] = useState<'' | 'daily' | 'weekly' | 'monthly'>('');
```

- [ ] **Step 2: Add recurrence to the API call in `addEntry`**

Find in `addEntry` function:
```typescript
      await apiFetch<BudgetEntry>('/budget', {
        method: 'POST',
        body: JSON.stringify({
          type,
          amount: amt,
          category,
          note: note.trim() || undefined,
          date,
          bank_account_id: bankAccountId || undefined,
          receipt_img: receiptImg || undefined
        }),
      });
```

Replace with:
```typescript
      await apiFetch<BudgetEntry>('/budget', {
        method: 'POST',
        body: JSON.stringify({
          type,
          amount: amt,
          category,
          note: note.trim() || undefined,
          date,
          bank_account_id: bankAccountId || undefined,
          receipt_img: receiptImg || undefined,
          recurrence: recurrence || undefined,
        }),
      });
```

- [ ] **Step 3: Reset recurrence on form close**

Find the reset line inside `addEntry` (after `setShowAdd(false)`):
```typescript
      setAmount('');
      setNote('');
      setReceiptImg(null);
      setShowAdd(false);
```

Add `setRecurrence('');` to that block:
```typescript
      setAmount('');
      setNote('');
      setReceiptImg(null);
      setRecurrence('');
      setShowAdd(false);
```

Also find the cancel button's onClick:
```typescript
onClick={() => { setShowAdd(false); setAmount(''); setNote(''); setReceiptImg(null); }}
```

Replace with:
```typescript
onClick={() => { setShowAdd(false); setAmount(''); setNote(''); setReceiptImg(null); setRecurrence(''); }}
```

- [ ] **Step 4: Add recurrence select to the form UI**

Find in the form section, after the bank account select (around the `Catatan / Keterangan` input):
```typescript
              <input
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                placeholder="Catatan / Keterangan (opsional)"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
```

Add before that input:
```typescript
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider pl-1">Pengulangan (Opsional)</label>
                <select
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                  value={recurrence}
                  onChange={e => setRecurrence(e.target.value as '' | 'daily' | 'weekly' | 'monthly')}
                >
                  <option value="">Tidak berulang</option>
                  <option value="daily">Setiap hari</option>
                  <option value="weekly">Setiap minggu</option>
                  <option value="monthly">Setiap bulan</option>
                </select>
              </div>
```

- [ ] **Step 5: Add recurring badge to entry list items**

Find in the entry list render (the `entries.map` section). Locate where `entry.note` is shown. Add a recurring badge next to entries that have recurrence — but first update the `BudgetEntry` interface at the top:

Find:
```typescript
interface BudgetEntry {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  note: string | null;
  date: string;
  bank_account_id: string | null;
  receipt_img: string | null;
}
```

Replace with:
```typescript
interface BudgetEntry {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  note: string | null;
  date: string;
  bank_account_id: string | null;
  receipt_img: string | null;
  recurrence?: string | null;
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/Budget.tsx
git commit -m "feat: recurring budget UI - recurrence select in add form"
```

---

## Task 8: Feature 3 Frontend — Net Worth Card in Dashboard

**Files:**
- Modify: `frontend/src/screens/Dashboard.tsx`

- [ ] **Step 1: Add NetWorth interface and state**

Add after the `NutritionData` interface definition:
```typescript
interface NetWorthData {
  current: { assets: number; liabilities: number; net_worth: number; month: string };
  history: { month: string; assets: number; liabilities: number; net_worth: number }[];
}
```

Add after `const [loading, setLoading] = useState(true);`:
```typescript
const [netWorth, setNetWorth] = useState<NetWorthData | null>(null);
```

- [ ] **Step 2: Fetch net worth in loadData**

Find:
```typescript
  const loadData = async () => {
    setLoading(true);
    try {
      const [dash, habs] = await Promise.all([
        apiFetch<DashboardData>('/dashboard'),
        apiFetch<Habit[]>('/habits'),
      ]);
      setData(dash);
      setHabits(habs);
    } catch {}
    setLoading(false);
  };
```

Replace with:
```typescript
  const loadData = async () => {
    setLoading(true);
    try {
      const [dash, habs, nw] = await Promise.all([
        apiFetch<DashboardData>('/dashboard'),
        apiFetch<Habit[]>('/habits'),
        apiFetch<NetWorthData>('/net-worth').catch(() => null),
      ]);
      setData(dash);
      setHabits(habs);
      setNetWorth(nw);
    } catch {}
    setLoading(false);
  };
```

- [ ] **Step 3: Add formatRp helper to Dashboard**

Add after the import block, before the component definition:
```typescript
function formatRp(n: number) {
  return n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}
```

- [ ] **Step 4: Add Net Worth card to Dashboard render**

Find the Budget card in the grid:
```typescript
          <div onClick={() => setTab('uang')} className="rounded-[18px] p-4 cursor-pointer border flex flex-col justify-between"
            style={{ background: 'var(--surface)', borderColor: 'var(--sep)' }}>
            <div className="flex justify-between items-start">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ background: 'rgba(52,199,89,0.16)', color: '#34C759' }}>💰</div>
              <span className="text-xs font-extrabold text-green-500">Uang</span>
            </div>
            <div className="mt-4">
              <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Budget</p>
              <p className="text-[11px]" style={{ color: 'var(--text2)' }}>Ringkasan saldo</p>
            </div>
          </div>
```

Replace with:
```typescript
          <div onClick={() => setTab('uang')} className="rounded-[18px] p-4 cursor-pointer border flex flex-col justify-between"
            style={{ background: 'var(--surface)', borderColor: 'var(--sep)' }}>
            <div className="flex justify-between items-start">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ background: 'rgba(52,199,89,0.16)', color: '#34C759' }}>💰</div>
              <span className="text-xs font-extrabold text-green-500">Uang</span>
            </div>
            <div className="mt-4">
              <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Budget</p>
              <p className="text-[11px]" style={{ color: 'var(--text2)' }}>Ringkasan saldo</p>
            </div>
          </div>
        </div>

        {/* Net Worth Card */}
        {netWorth && (
          <motion.div
            className="rounded-[18px] p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.1 }}
          >
            <div className="flex justify-between items-center mb-3">
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text3)' }}>NET WORTH</p>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(52,199,89,0.12)', color: '#34C759' }}>
                {netWorth.current.month}
              </span>
            </div>
            <p
              className="text-2xl font-extrabold mb-3"
              style={{ color: netWorth.current.net_worth >= 0 ? '#34C759' : '#FF453A' }}
            >
              {formatRp(netWorth.current.net_worth)}
            </p>
            <div className="flex gap-4">
              <div>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Aset</p>
                <p className="text-xs font-bold text-green-400">{formatRp(netWorth.current.assets)}</p>
              </div>
              <div>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Utang</p>
                <p className="text-xs font-bold text-red-400">{formatRp(netWorth.current.liabilities)}</p>
              </div>
            </div>
            {netWorth.history.length > 1 && (
              <div className="mt-3 pt-3 flex gap-1 items-end" style={{ borderTop: '1px solid var(--sep)', height: 40 }}>
                {netWorth.history.map((h, i) => {
                  const max = Math.max(...netWorth.history.map(x => Math.abs(x.net_worth)), 1);
                  const pct = Math.abs(h.net_worth) / max;
                  const isNeg = h.net_worth < 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col justify-end items-center gap-0.5">
                      <div
                        className="w-full rounded-sm"
                        style={{
                          height: `${Math.max(pct * 28, 4)}px`,
                          background: isNeg ? '#FF453A60' : '#34C75960',
                        }}
                        title={`${h.month}: ${formatRp(h.net_worth)}`}
                      />
                    </div>
                  );
                })}
```

Then add the closing tags for the Net Worth card after the history bar chart. Find the original closing `</div>` of the grid section that had the Budget card and fix structure. The replacement above ends mid-JSX intentionally — complete it with:

```typescript
              </div>
            )}
          </motion.div>
```

> **Note:** The grid wrapper `</div>` that was after the Budget card was moved. Remove the duplicate `</div>` below the net worth card to maintain correct JSX nesting. Verify there are no unclosed tags with `npx tsc --noEmit`.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit
```

Fix any JSX nesting errors before continuing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/Dashboard.tsx
git commit -m "feat: net worth card on dashboard - shows assets, liabilities, 6-month mini chart"
```

---

## Task 9: Apply Remote Migration

After all features are working locally:

- [ ] **Step 1: Apply migration to production D1**

```bash
cd backend
wrangler d1 execute fayolla-db --remote --file=./migrations/0008_recurring_expiry_networth.sql
```

- [ ] **Step 2: Deploy backend**

```bash
cd backend
wrangler deploy
```

- [ ] **Step 3: Build and deploy frontend**

```bash
cd frontend
npm run build
# deploy dist/ to Cloudflare Pages
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Recurring budget: POST accepts `recurrence`, scheduler creates copies, GET /recurring lists templates, frontend select
- [x] Expiry alerts: column for dedup, scheduler at 8 AM Jakarta, grouped by user, push notif with item list
- [x] Net worth: new table, route computes + upserts snapshot, history endpoint, dashboard card with mini chart

**Type consistency:**
- `jakartaToday()` and `advanceDate()` defined in Task 2, used in Tasks 3, 4, 5, 6 ✓
- `BudgetEntry.recurrence` added in Task 7 step 5 ✓
- `NetWorthData` interface defined in Task 8 step 1, used in step 2 ✓

**Potential gotchas:**
- Task 8 JSX nesting is tricky — the grid closing `</div>` must be moved outside the net worth card. Run `npx tsc --noEmit` to catch structure errors.
- `processRecurringBudget` uses dynamic `import('./lib/nanoid')` — change to top-level import at the head of `index.ts` instead if tree-shaking is a concern.
- The expiry alert `UPDATE ... WHERE id IN (${ids})` uses dynamic binding count — this is safe for D1 as long as the item count per user is reasonable (<100).
