import { Hono } from 'hono';
import type { DebtRow, DebtPaymentRow } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';

const debts = new Hono<AuthContext>();

debts.use('/*', requireAuth);

// GET /api/debts
debts.get('/', async (c) => {
  const user = c.get('user');

  // Get debts
  const debtRows = await c.env.DB.prepare(
    `SELECT * FROM debts WHERE user_id = ?1 ORDER BY status DESC, due_date ASC`
  ).bind(user.sub).all<DebtRow>();
  const allDebts = debtRows.results ?? [];

  // Get payments
  const paymentRows = await c.env.DB.prepare(
    `SELECT * FROM debt_payments WHERE user_id = ?1 ORDER BY payment_date ASC`
  ).bind(user.sub).all<DebtPaymentRow>();
  const payments = paymentRows.results ?? [];

  // Nest payments in their respective debts
  const result = allDebts.map(debt => ({
    ...debt,
    payments: payments.filter(p => p.debt_id === debt.id)
  }));

  return c.json(result);
});

// POST /api/debts
debts.post('/', async (c) => {
  const user = c.get('user');
  type Body = {
    type?: string;
    person_name?: string;
    amount?: number;
    due_date?: string;
    note?: string;
    status?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, {
    person_name: { type: 'string' },
    amount:      { type: 'number', min: 1 },
  });
  if (err) return c.json({ error: err }, 400);

  const id = nanoid();
  const type = body.type ?? 'debt'; // 'debt' or 'receivable'
  const amount = Math.round(body.amount);
  const dueDate = body.due_date || null;
  const note = body.note || null;
  const status = body.status ?? 'unpaid';

  await c.env.DB.prepare(
    `INSERT INTO debts (id, user_id, type, person_name, amount_idr, due_date, note, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(id, user.sub, type, body.person_name, amount, dueDate, note, status).run();

  return c.json({ id, type, person_name: body.person_name, amount_idr: amount, due_date: dueDate, note, status }, 201);
});

// PUT /api/debts/:id
debts.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = {
    type?: string;
    person_name?: string;
    amount?: number;
    due_date?: string;
    note?: string;
    status?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, {
    person_name: { type: 'string' },
    amount:      { type: 'number', min: 1 },
  });
  if (err) return c.json({ error: err }, 400);

  const type = body.type ?? 'debt';
  const amount = Math.round(body.amount);
  const dueDate = body.due_date || null;
  const note = body.note || null;
  const status = body.status ?? 'unpaid';

  const res = await c.env.DB.prepare(
    `UPDATE debts
     SET type = ?1, person_name = ?2, amount_idr = ?3, due_date = ?4, note = ?5, status = ?6
     WHERE id = ?7 AND user_id = ?8`
  ).bind(type, body.person_name, amount, dueDate, note, status, id, user.sub).run();

  if (res.meta.changes === 0) return c.json({ error: 'debt not found' }, 404);

  return c.json({ id, type, person_name: body.person_name, amount_idr: amount, due_date: dueDate, note, status });
});

// DELETE /api/debts/:id
debts.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const res = await c.env.DB.prepare(
    `DELETE FROM debts WHERE id = ?1 AND user_id = ?2`
  ).bind(id, user.sub).run();

  if (res.meta.changes === 0) return c.json({ error: 'debt not found' }, 404);

  // Cascade delete payments
  await c.env.DB.prepare(
    `DELETE FROM debt_payments WHERE debt_id = ?1 AND user_id = ?2`
  ).bind(id, user.sub).run();

  return c.json({ ok: true });
});

// POST /api/debts/:id/payments (Add payment schedule/actual payment)
debts.post('/:id/payments', async (c) => {
  const user = c.get('user');
  const debtId = c.req.param('id');
  type Body = {
    amount?: number;
    payment_date?: string;
    status?: string;
    note?: string;
    bank_account_id?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, {
    amount:       { type: 'number', min: 1 },
    payment_date: { type: 'date' },
  });
  if (err) return c.json({ error: err }, 400);

  // Verify debt exists and belongs to user
  const debt = await c.env.DB.prepare(
    `SELECT * FROM debts WHERE id = ?1 AND user_id = ?2`
  ).bind(debtId, user.sub).first<DebtRow>();

  if (!debt) return c.json({ error: 'debt not found' }, 404);

  const id = nanoid();
  const status = body.status ?? 'scheduled'; // 'scheduled' | 'paid'
  const amount = Math.round(body.amount);
  const note = body.note || null;
  const bankAccountId = body.bank_account_id || null;
  const now = Math.floor(Date.now() / 1000);

  // If paid + bank selected → auto-create budget entry (Dr Hutang / Cr Bank)
  let budgetEntryId: string | null = null;
  if (status === 'paid' && bankAccountId) {
    budgetEntryId = nanoid();
    const budgetNote = `Bayar hutang: ${debt.person_name}${note ? ` — ${note}` : ''}`;
    await c.env.DB.prepare(
      `INSERT INTO budget_entries (id, user_id, type, amount_idr, category, note, entry_date, bank_account_id, created_at)
       VALUES (?1, ?2, 'expense', ?3, 'Cicilan & Utang', ?4, ?5, ?6, ?7)`
    ).bind(budgetEntryId, user.sub, amount, budgetNote, body.payment_date, bankAccountId, now).run();

    // Deduct bank balance
    await c.env.DB.prepare(
      `UPDATE bank_accounts SET balance = balance - ?1 WHERE id = ?2 AND user_id = ?3`
    ).bind(amount, bankAccountId, user.sub).run();
  }

  await c.env.DB.prepare(
    `INSERT INTO debt_payments (id, debt_id, user_id, amount_idr, payment_date, status, note, bank_account_id, budget_entry_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(id, debtId, user.sub, amount, body.payment_date, status, note, bankAccountId, budgetEntryId).run();

  return c.json({ id, debt_id: debtId, amount_idr: amount, payment_date: body.payment_date, status, note, bank_account_id: bankAccountId, budget_entry_id: budgetEntryId }, 201);
});

// PUT /api/debts/:id/payments/:paymentId
debts.put('/:id/payments/:paymentId', async (c) => {
  const user = c.get('user');
  const debtId = c.req.param('id');
  const paymentId = c.req.param('paymentId');
  type Body = {
    amount?: number;
    payment_date?: string;
    status?: string;
    note?: string;
    bank_account_id?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, {
    amount:       { type: 'number', min: 1 },
    payment_date: { type: 'date' },
  });
  if (err) return c.json({ error: err }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT * FROM debt_payments WHERE id = ?1 AND debt_id = ?2 AND user_id = ?3`
  ).bind(paymentId, debtId, user.sub).first<DebtPaymentRow & { bank_account_id: string | null; budget_entry_id: string | null }>();

  if (!existing) return c.json({ error: 'payment schedule not found' }, 404);

  const debt = await c.env.DB.prepare(
    `SELECT * FROM debts WHERE id = ?1 AND user_id = ?2`
  ).bind(debtId, user.sub).first<DebtRow>();

  const amount = Math.round(body.amount);
  const newStatus = body.status ?? 'scheduled';
  const note = body.note || null;
  const bankAccountId = body.bank_account_id || existing.bank_account_id || null;
  const now = Math.floor(Date.now() / 1000);
  let budgetEntryId = existing.budget_entry_id;

  // Reverse old budget entry if exists (status changing or amount changing while paid)
  if (existing.budget_entry_id && existing.bank_account_id) {
    await c.env.DB.prepare(
      `DELETE FROM budget_entries WHERE id = ?1 AND user_id = ?2`
    ).bind(existing.budget_entry_id, user.sub).run();
    await c.env.DB.prepare(
      `UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3`
    ).bind(existing.amount_idr, existing.bank_account_id, user.sub).run();
    budgetEntryId = null;
  }

  // Create new budget entry if now paid + bank selected
  if (newStatus === 'paid' && bankAccountId && debt) {
    budgetEntryId = nanoid();
    const budgetNote = `Bayar hutang: ${debt.person_name}${note ? ` — ${note}` : ''}`;
    await c.env.DB.prepare(
      `INSERT INTO budget_entries (id, user_id, type, amount_idr, category, note, entry_date, bank_account_id, created_at)
       VALUES (?1, ?2, 'expense', ?3, 'Cicilan & Utang', ?4, ?5, ?6, ?7)`
    ).bind(budgetEntryId, user.sub, amount, budgetNote, body.payment_date, bankAccountId, now).run();
    await c.env.DB.prepare(
      `UPDATE bank_accounts SET balance = balance - ?1 WHERE id = ?2 AND user_id = ?3`
    ).bind(amount, bankAccountId, user.sub).run();
  }

  await c.env.DB.prepare(
    `UPDATE debt_payments
     SET amount_idr = ?1, payment_date = ?2, status = ?3, note = ?4, bank_account_id = ?5, budget_entry_id = ?6
     WHERE id = ?7 AND debt_id = ?8 AND user_id = ?9`
  ).bind(amount, body.payment_date, newStatus, note, newStatus === 'paid' ? bankAccountId : null, budgetEntryId, paymentId, debtId, user.sub).run();

  return c.json({ id: paymentId, debt_id: debtId, amount_idr: amount, payment_date: body.payment_date, status: newStatus, note, bank_account_id: bankAccountId, budget_entry_id: budgetEntryId });
});

// DELETE /api/debts/:id/payments/:paymentId
debts.delete('/:id/payments/:paymentId', async (c) => {
  const user = c.get('user');
  const debtId = c.req.param('id');
  const paymentId = c.req.param('paymentId');

  // Fetch existing to reverse budget entry if needed
  const existing = await c.env.DB.prepare(
    `SELECT * FROM debt_payments WHERE id = ?1 AND debt_id = ?2 AND user_id = ?3`
  ).bind(paymentId, debtId, user.sub).first<DebtPaymentRow & { bank_account_id: string | null; budget_entry_id: string | null }>();

  if (!existing) return c.json({ error: 'payment schedule not found' }, 404);

  // Reverse budget entry if it was auto-created
  if (existing.budget_entry_id && existing.bank_account_id) {
    await c.env.DB.prepare(
      `DELETE FROM budget_entries WHERE id = ?1 AND user_id = ?2`
    ).bind(existing.budget_entry_id, user.sub).run();
    // Restore bank balance
    await c.env.DB.prepare(
      `UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3`
    ).bind(existing.amount_idr, existing.bank_account_id, user.sub).run();
  }

  await c.env.DB.prepare(
    `DELETE FROM debt_payments WHERE id = ?1 AND debt_id = ?2 AND user_id = ?3`
  ).bind(paymentId, debtId, user.sub).run();

  return c.json({ ok: true });
});

export default debts;
