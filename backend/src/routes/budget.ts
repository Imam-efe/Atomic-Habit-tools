import { Hono } from 'hono';
import type { BudgetEntryRow, BudgetLimitRow } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate, advanceDate, jakartaToday } from '../lib/validate';

const budget = new Hono<AuthContext>();

budget.use('/*', requireAuth);

// Exported so quick-add and receipt OCR constrain the model to the same
// categories the manual form offers — a category invented by the AI would
// never line up with the budget limits screen.
export const EXPENSE_CATEGORIES = [
  'Makanan & Minuman',
  'Transportasi & Bensin',
  'Kebutuhan Rumah Tangga',
  'Belanja Bulanan',
  'Tagihan & Utilitas',
  'Pendidikan & Anak',
  'Kesehatan & Obat',
  'Hiburan & Rekreasi',
  'Cicilan & Utang',
  'Investasi & Tabungan',
  'Lainnya'
];

export const INCOME_CATEGORIES = ['Gaji', 'Freelance', 'Investasi', 'Bisnis', 'Lainnya'];

// GET /api/budget?from=YYYY-MM-DD&to=YYYY-MM-DD  (or legacy ?month=YYYY-MM)
budget.get('/', async (c) => {
  const user = c.get('user');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7);
  const dateFrom = from ?? `${month}-01`;
  const dateTo = to ?? `${month}-31`;

  const rows = await c.env.DB.prepare(
    `SELECT * FROM budget_entries
     WHERE user_id = ?1 AND entry_date >= ?2 AND entry_date <= ?3
     ORDER BY entry_date DESC, created_at DESC`
  ).bind(user.sub, dateFrom, dateTo).all<BudgetEntryRow>();

  const entries = rows.results ?? [];
  const totalIncome = entries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount_idr, 0);
  const totalExpense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount_idr, 0);

  return c.json({
    entries: entries.map(e => ({
      id: e.id,
      type: e.type,
      amount: e.amount_idr,
      category: e.category,
      note: e.note,
      date: e.entry_date,
      bank_account_id: e.bank_account_id,
      receipt_img: e.receipt_img,
    })),
    summary: { income: totalIncome, expense: totalExpense, balance: totalIncome - totalExpense },
  });
});

// GET /api/budget/limits?month=YYYY-MM
budget.get('/limits', async (c) => {
  const user = c.get('user');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7);

  // Get limits
  const limitsRows = await c.env.DB.prepare(
    `SELECT * FROM budget_limits WHERE user_id = ?1 AND month = ?2`
  ).bind(user.sub, month).all<BudgetLimitRow>();
  const limits = limitsRows.results ?? [];

  // Get spent per category
  const spentRows = await c.env.DB.prepare(
    `SELECT category, SUM(amount_idr) as total_spent
     FROM budget_entries
     WHERE user_id = ?1 AND type = 'expense' AND entry_date >= ?2 AND entry_date <= ?3
     GROUP BY category`
  ).bind(user.sub, `${month}-01`, `${month}-31`).all<{ category: string; total_spent: number }>();
  const spent = spentRows.results ?? [];

  const limitMap = new Map(limits.map(l => [l.category, l.monthly_limit_idr]));
  const spentMap = new Map(spent.map(s => [s.category, s.total_spent]));

  const result = EXPENSE_CATEGORIES.map(category => {
    const limit = limitMap.get(category) ?? 0;
    const spentAmount = spentMap.get(category) ?? 0;
    return {
      category,
      limit,
      spent: spentAmount,
      remaining: limit > 0 ? Math.max(0, limit - spentAmount) : 0,
    };
  });

  return c.json(result);
});

// POST /api/budget/limits
budget.post('/limits', async (c) => {
  const user = c.get('user');
  type LimitBody = { category?: string; limit?: number; month?: string };
  const body = await c.req.json<LimitBody>().catch((): LimitBody => ({}));

  const err = validate(body as Record<string, unknown>, {
    category: { type: 'string' },
    limit:    { type: 'number', min: 0 },
  });
  if (err) return c.json({ error: err }, 400);

  const month = body.month ?? new Date().toISOString().slice(0, 7);
  const id = nanoid();

  await c.env.DB.prepare(
    `INSERT INTO budget_limits (id, user_id, category, monthly_limit_idr, month)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id, category, month)
     DO UPDATE SET monthly_limit_idr = excluded.monthly_limit_idr`
  ).bind(id, user.sub, body.category, Math.round(body.limit!), month).run();

  return c.json({ success: true, category: body.category, limit: body.limit, month });
});

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

  // Adjust bank account balance
  if (bankAccountId) {
    if (body.type === 'expense') {
      await c.env.DB.prepare(
        `UPDATE bank_accounts SET balance = balance - ?1 WHERE id = ?2 AND user_id = ?3`
      ).bind(amount, bankAccountId, user.sub).run();
    } else {
      await c.env.DB.prepare(
        `UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3`
      ).bind(amount, bankAccountId, user.sub).run();
    }
  }

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
});

// DELETE /api/budget/:id
budget.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  // Fetch entry first to reverse balance adjustment
  const entry = await c.env.DB.prepare(
    `SELECT * FROM budget_entries WHERE id = ?1 AND user_id = ?2`
  ).bind(id, user.sub).first<BudgetEntryRow>();

  if (entry) {
    if (entry.bank_account_id) {
      if (entry.type === 'expense') {
        await c.env.DB.prepare(
          `UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3`
        ).bind(entry.amount_idr, entry.bank_account_id, user.sub).run();
      } else {
        await c.env.DB.prepare(
          `UPDATE bank_accounts SET balance = balance - ?1 WHERE id = ?2 AND user_id = ?3`
        ).bind(entry.amount_idr, entry.bank_account_id, user.sub).run();
      }
    }
    await c.env.DB.prepare('DELETE FROM budget_entries WHERE id = ?1 AND user_id = ?2').bind(id, user.sub).run();
    return c.json({ ok: true });
  }

  return c.json({ error: 'transaction not found' }, 404);
});

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

// PUT /api/budget/:id — edit a transaction
budget.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = { type?: string; amount?: number; category?: string; note?: string; date?: string; bank_account_id?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, {
    type:     { type: 'enum', values: ['income', 'expense'] },
    amount:   { type: 'number', min: 1 },
    category: { type: 'string' },
  });
  if (err) return c.json({ error: err }, 400);

  // Fetch existing to reverse bank balance
  const existing = await c.env.DB.prepare(
    'SELECT * FROM budget_entries WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user.sub).first<BudgetEntryRow>();
  if (!existing) return c.json({ error: 'entry not found' }, 404);

  const newAmount = Math.round(body.amount!);
  const newType = body.type!;
  const entryDate = body.date ?? existing.entry_date;
  // If bank_account_id key is present in body, use it (even if empty string → null); else keep existing
  const bankAccountId = 'bank_account_id' in body
    ? (body.bank_account_id || null)
    : existing.bank_account_id;

  // Reverse old bank adjustment
  if (existing.bank_account_id) {
    const reverseSign = existing.type === 'expense' ? 1 : -1;
    await c.env.DB.prepare(
      'UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3'
    ).bind(reverseSign * existing.amount_idr, existing.bank_account_id, user.sub).run();
  }

  // Apply new bank adjustment
  if (bankAccountId) {
    const sign = newType === 'expense' ? -1 : 1;
    await c.env.DB.prepare(
      'UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3'
    ).bind(sign * newAmount, bankAccountId, user.sub).run();
  }

  await c.env.DB.prepare(
    `UPDATE budget_entries
     SET type = ?1, amount_idr = ?2, category = ?3, note = ?4, entry_date = ?5, bank_account_id = ?6
     WHERE id = ?7 AND user_id = ?8`
  ).bind(newType, newAmount, body.category, body.note ?? null, entryDate, bankAccountId, id, user.sub).run();

  return c.json({ id, type: newType, amount: newAmount, category: body.category, note: body.note ?? null, date: entryDate, bank_account_id: bankAccountId });
});

export default budget;

