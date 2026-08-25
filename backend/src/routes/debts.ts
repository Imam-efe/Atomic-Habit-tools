import { Hono } from 'hono';
import type { DebtRow, DebtPaymentRow } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';

const debts = new Hono<AuthContext>();

debts.use('/*', requireAuth);

/**
 * Arah uang untuk satu baris `debts`.
 *
 * Tabel ini menyimpan dua hal yang berlawanan dalam bentuk yang sama: utang
 * (kita berutang) dan piutang (orang berutang ke kita). Yang membedakan hanya
 * satu kolom, dan kode yang lupa membacanya tetap jalan tanpa error —
 * hasilnya cuma angka yang salah arah.
 *
 * Melunasi utang mengeluarkan uang; menerima pelunasan piutang memasukkan
 * uang. Keduanya sama-sama satu baris di `debt_payments`, jadi tandanya harus
 * ditentukan di sini, sekali, dan dipakai semua jalur.
 */
function arahUang(type: string): {
  masuk: boolean;
  entryType: 'income' | 'expense';
  category: string;
  labelNota: string;
} {
  return type === 'receivable'
    ? { masuk: true, entryType: 'income', category: 'Lainnya', labelNota: 'Terima piutang' }
    : { masuk: false, entryType: 'expense', category: 'Cicilan & Utang', labelNota: 'Bayar hutang' };
}

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
  const amount = Math.round(body.amount!);
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

  const lama = await c.env.DB.prepare(
    'SELECT type, due_date, note, status FROM debts WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user.sub).first<{ type: string; due_date: string | null; note: string | null; status: string }>();

  if (!lama) return c.json({ error: 'debt not found' }, 404);

  // Kolom yang tidak dikirim dipertahankan, bukan dikembalikan ke bawaan.
  // Layar Pelunasan Utang hanya mengirim status, nama, dan jumlah — dengan
  // nilai bawaan, melunasi utang ikut menghapus tanggal jatuh tempo dan
  // catatannya, dan mengubah piutang jadi utang.
  const type = body.type ?? lama.type;
  const amount = Math.round(body.amount!);
  const dueDate = body.due_date === undefined ? lama.due_date : (body.due_date || null);
  const note = body.note === undefined ? lama.note : (body.note || null);
  const status = body.status ?? lama.status;

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

  // Check debt exists first
  const debtExists = await c.env.DB.prepare(
    `SELECT id, type FROM debts WHERE id = ?1 AND user_id = ?2`
  ).bind(id, user.sub).first<{ id: string; type: string }>();

  if (!debtExists) return c.json({ error: 'debt not found' }, 404);

  // Membatalkan sebuah pencatatan harus menempuh jalan pulang yang sama
  // persis: uang yang tadinya masuk ditarik lagi, yang tadinya keluar
  // dikembalikan. Selalu menambah akan menciptakan uang dari piutang yang
  // dihapus.
  const arahHapus = arahUang(debtExists.type);

  // Fetch paid payments that have linked budget entries to reverse
  const paidRows = await c.env.DB.prepare(
    `SELECT id, amount_idr, bank_account_id, budget_entry_id
     FROM debt_payments
     WHERE debt_id = ?1 AND user_id = ?2 AND status = 'paid' AND budget_entry_id IS NOT NULL`
  ).bind(id, user.sub).all<{ id: string; amount_idr: number; bank_account_id: string | null; budget_entry_id: string | null }>();

  const stmts: D1PreparedStatement[] = [];

  // Reverse each paid payment: delete budget entry + restore bank balance
  for (const p of paidRows.results ?? []) {
    if (p.budget_entry_id) {
      stmts.push(
        c.env.DB.prepare(`DELETE FROM budget_entries WHERE id = ?1 AND user_id = ?2`)
          .bind(p.budget_entry_id, user.sub)
      );
    }
    if (p.bank_account_id) {
      stmts.push(
        c.env.DB.prepare(`UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3`)
          .bind(arahHapus.masuk ? -p.amount_idr : p.amount_idr, p.bank_account_id, user.sub)
      );
    }
  }

  stmts.push(
    c.env.DB.prepare(`DELETE FROM debt_payments WHERE debt_id = ?1 AND user_id = ?2`)
      .bind(id, user.sub)
  );
  stmts.push(
    c.env.DB.prepare(`DELETE FROM debts WHERE id = ?1 AND user_id = ?2`)
      .bind(id, user.sub)
  );

  await c.env.DB.batch(stmts);

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
  const amount = Math.round(body.amount!);
  const note = body.note || null;
  const bankAccountId = body.bank_account_id || null;
  const now = Math.floor(Date.now() / 1000);

  // If paid + bank selected → auto-create budget entry (Dr Hutang / Cr Bank)
  let budgetEntryId: string | null = null;
  if (status === 'paid' && bankAccountId) {
    const arah = arahUang(debt.type);

    const bankRow = await c.env.DB.prepare(
      `SELECT balance FROM bank_accounts WHERE id = ?1 AND user_id = ?2`
    ).bind(bankAccountId, user.sub).first<{ balance: number }>();

    if (!bankRow) return c.json({ error: 'bank account not found' }, 404);
    // Saldo hanya perlu cukup kalau uangnya keluar. Menerima pelunasan piutang
    // ke rekening kosong bukan masalah — justru itu yang mengisinya.
    if (!arah.masuk && bankRow.balance < amount) {
      return c.json({ error: 'insufficient balance' }, 400);
    }

    budgetEntryId = nanoid();
    const budgetNote = `${arah.labelNota}: ${debt.person_name}${note ? ` — ${note}` : ''}`;

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO budget_entries (id, user_id, type, amount_idr, category, note, entry_date, bank_account_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      ).bind(budgetEntryId, user.sub, arah.entryType, amount, arah.category, budgetNote, body.payment_date, bankAccountId, now),
      c.env.DB.prepare(
        `UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3`
      ).bind(arah.masuk ? amount : -amount, bankAccountId, user.sub),
      c.env.DB.prepare(
        `INSERT INTO debt_payments (id, debt_id, user_id, amount_idr, payment_date, status, note, bank_account_id, budget_entry_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      ).bind(id, debtId, user.sub, amount, body.payment_date, status, note, bankAccountId, budgetEntryId),
    ]);
  } else {
    await c.env.DB.prepare(
      `INSERT INTO debt_payments (id, debt_id, user_id, amount_idr, payment_date, status, note, bank_account_id, budget_entry_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    ).bind(id, debtId, user.sub, amount, body.payment_date, status, note, bankAccountId, budgetEntryId).run();
  }

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

  if (!debt) return c.json({ error: 'debt not found' }, 404);

  const amount = Math.round(body.amount!);
  const newStatus = body.status ?? 'scheduled';
  const note = body.note || null;
  const bankAccountId = body.bank_account_id || existing.bank_account_id || null;
  const now = Math.floor(Date.now() / 1000);
  const arah = arahUang(debt.type);
  let budgetEntryId = existing.budget_entry_id;

  const stmts: D1PreparedStatement[] = [];

  // Reverse old budget entry if exists
  if (existing.budget_entry_id && existing.bank_account_id) {
    stmts.push(
      c.env.DB.prepare(`DELETE FROM budget_entries WHERE id = ?1 AND user_id = ?2`)
        .bind(existing.budget_entry_id, user.sub)
    );
    stmts.push(
      c.env.DB.prepare(`UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3`)
        .bind(arah.masuk ? -existing.amount_idr : existing.amount_idr, existing.bank_account_id, user.sub)
    );
    budgetEntryId = null;
  }

  // Create new budget entry if now paid + bank selected
  if (newStatus === 'paid' && bankAccountId) {
    budgetEntryId = nanoid();
    const budgetNote = `${arah.labelNota}: ${debt.person_name}${note ? ` — ${note}` : ''}`;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO budget_entries (id, user_id, type, amount_idr, category, note, entry_date, bank_account_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      ).bind(budgetEntryId, user.sub, arah.entryType, amount, arah.category, budgetNote, body.payment_date, bankAccountId, now)
    );
    stmts.push(
      c.env.DB.prepare(`UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3`)
        .bind(arah.masuk ? amount : -amount, bankAccountId, user.sub)
    );
  }

  stmts.push(
    c.env.DB.prepare(
      `UPDATE debt_payments
       SET amount_idr = ?1, payment_date = ?2, status = ?3, note = ?4, bank_account_id = ?5, budget_entry_id = ?6
       WHERE id = ?7 AND debt_id = ?8 AND user_id = ?9`
    ).bind(amount, body.payment_date, newStatus, note, newStatus === 'paid' ? bankAccountId : null, budgetEntryId, paymentId, debtId, user.sub)
  );

  await c.env.DB.batch(stmts);

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

  const induk = await c.env.DB.prepare(
    'SELECT type FROM debts WHERE id = ?1 AND user_id = ?2'
  ).bind(debtId, user.sub).first<{ type: string }>();

  const arah = arahUang(induk?.type ?? 'debt');
  const stmts: D1PreparedStatement[] = [];

  // Reverse budget entry if it was auto-created
  if (existing.budget_entry_id && existing.bank_account_id) {
    stmts.push(
      c.env.DB.prepare(`DELETE FROM budget_entries WHERE id = ?1 AND user_id = ?2`)
        .bind(existing.budget_entry_id, user.sub)
    );
    stmts.push(
      c.env.DB.prepare(`UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3`)
        .bind(arah.masuk ? -existing.amount_idr : existing.amount_idr, existing.bank_account_id, user.sub)
    );
  }

  stmts.push(
    c.env.DB.prepare(`DELETE FROM debt_payments WHERE id = ?1 AND debt_id = ?2 AND user_id = ?3`)
      .bind(paymentId, debtId, user.sub)
  );

  await c.env.DB.batch(stmts);

  return c.json({ ok: true });
});

export default debts;
