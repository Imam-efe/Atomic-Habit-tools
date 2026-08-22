import { Hono } from 'hono';
import type { BankAccountRow, BudgetEntryRow, BudgetLimitRow } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { jakartaToday } from '../lib/validate';

const financeReport = new Hono<AuthContext>();

financeReport.use('/*', requireAuth);

// GET /api/finance-report?from=YYYY-MM-DD&to=YYYY-MM-DD  (or legacy ?month=YYYY-MM)
financeReport.get('/', async (c) => {
  const user = c.get('user');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7);
  const dateFrom = from ?? `${month}-01`;
  const dateTo = to ?? `${month}-31`;

  // 1. P&L Calculation for selected range
  const pnlRows = await c.env.DB.prepare(
    `SELECT * FROM budget_entries
     WHERE user_id = ?1 AND entry_date >= ?2 AND entry_date <= ?3`
  ).bind(user.sub, dateFrom, dateTo).all<BudgetEntryRow>();

  const entries = pnlRows.results ?? [];
  const totalIncome = entries.filter(e => e.type === 'income').reduce((sum, e) => sum + e.amount_idr, 0);
  const totalExpense = entries.filter(e => e.type === 'expense').reduce((sum, e) => sum + e.amount_idr, 0);

  // Expenses by category
  const expenseByCategory: Record<string, number> = {};
  entries.filter(e => e.type === 'expense').forEach(e => {
    expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + e.amount_idr;
  });

  // Income by category
  const incomeByCategory: Record<string, number> = {};
  entries.filter(e => e.type === 'income').forEach(e => {
    incomeByCategory[e.category] = (incomeByCategory[e.category] || 0) + e.amount_idr;
  });

  // 2. Balance Sheet Calculation (Current status, independent of month)
  // Assets: Sum of all bank account balances
  const bankAccountRows = await c.env.DB.prepare(
    `SELECT * FROM bank_accounts WHERE user_id = ?1`
  ).bind(user.sub).all<BankAccountRow>();
  const accounts = bankAccountRows.results ?? [];
  const totalAssets = accounts.reduce((sum, a) => sum + a.balance, 0);

  // Liabilities: Sum of outstanding (unpaid) debts
  const debtRows = await c.env.DB.prepare(
    `SELECT type, SUM(amount_idr) as total
     FROM debts
     WHERE user_id = ?1 AND status = 'unpaid'
     GROUP BY type`
  ).bind(user.sub).all<{ type: string; total: number }>();
  
  const debtsList = debtRows.results ?? [];
  const totalLiabilities = debtsList.find(d => d.type === 'debt')?.total ?? 0;
  const totalReceivables = debtsList.find(d => d.type === 'receivable')?.total ?? 0; // Money others owe us (Asset but kept separate or sub-asset)

  // Net Worth
  const netWorth = (totalAssets + totalReceivables) - totalLiabilities;

  // 3. Upcoming Debt Payments Schedule
  const upcomingPaymentsRows = await c.env.DB.prepare(
    `SELECT dp.id, dp.debt_id, dp.amount_idr, dp.payment_date, dp.status, dp.note, d.person_name, d.type as debt_type
     FROM debt_payments dp
     JOIN debts d ON dp.debt_id = d.id
     WHERE dp.user_id = ?1 AND dp.status = 'scheduled'
     ORDER BY dp.payment_date ASC
     LIMIT 10`
  ).bind(user.sub).all<{
    id: string;
    debt_id: string;
    amount_idr: number;
    payment_date: string;
    status: string;
    note: string | null;
    person_name: string;
    debt_type: string;
  }>();

  const upcomingPayments = upcomingPaymentsRows.results ?? [];

  return c.json({
    pnl: {
      month: from ? `${dateFrom} s/d ${dateTo}` : month,
      income: totalIncome,
      expense: totalExpense,
      net_profit: totalIncome - totalExpense,
      expenses_breakdown: Object.entries(expenseByCategory).map(([category, amount]) => ({ category, amount })),
      income_breakdown: Object.entries(incomeByCategory).map(([category, amount]) => ({ category, amount }))
    },
    balance_sheet: {
      assets: {
        total: totalAssets,
        accounts: accounts.map(a => ({ name: a.name, type: a.account_type, balance: a.balance })),
        receivables: totalReceivables // Piutang (other people owe us)
      },
      liabilities: {
        total: totalLiabilities // Hutang (we owe others)
      },
      net_worth: netWorth
    },
    upcoming_payments: upcomingPayments.map(p => ({
      id: p.id,
      debt_id: p.debt_id,
      amount: p.amount_idr,
      date: p.payment_date,
      status: p.status,
      note: p.note,
      person_name: p.person_name,
      debt_type: p.debt_type
    }))
  });
});

/**
 * GET /api/finance-report/forecast?month=YYYY-MM
 *
 * The rest of this file only looks backwards. This projects the month to its
 * end so an overspend is visible on the 12th rather than confirmed on the 30th.
 *
 * Two components, deliberately kept apart:
 *
 *   variable — the daily spend rate so far, carried across the remaining days.
 *              It already contains whatever daily and weekly recurring charges
 *              have fired, which is why those are not added again below.
 *   known    — items that are scheduled but have not hit the ledger yet:
 *              monthly recurring templates still due, and scheduled debt
 *              payments. A monthly template that already fired this month has
 *              advanced to next month, so it cannot be counted twice.
 *
 * Income is never averaged. Salary lands in one lump, and spreading it over
 * the days elapsed would invent income on every day of the month.
 */
financeReport.get('/forecast', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();
  const month = c.req.query('month') ?? today.slice(0, 7);
  const monthStart = `${month}-01`;
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  // Forecasting a month that already closed is meaningless — clamp "today" to
  // the window so a past month reports itself as fully elapsed.
  const asOf = today < monthStart ? monthStart : today > monthEnd ? monthEnd : today;
  const daysElapsed = Number(asOf.slice(8, 10));
  const daysRemaining = daysInMonth - daysElapsed;

  const [entriesRes, recurringRes, paymentsRes, accountsRes, limitsRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM budget_entries
       WHERE user_id = ?1 AND entry_date >= ?2 AND entry_date <= ?3`
    ).bind(user.sub, monthStart, asOf).all<BudgetEntryRow>(),

    c.env.DB.prepare(
      `SELECT type, amount_idr, category, note, recurrence, next_recurrence_date
       FROM budget_entries
       WHERE user_id = ?1 AND recurrence IS NOT NULL
         AND next_recurrence_date > ?2 AND next_recurrence_date <= ?3`
    ).bind(user.sub, asOf, monthEnd).all<{
      type: string; amount_idr: number; category: string; note: string | null;
      recurrence: string; next_recurrence_date: string;
    }>(),

    c.env.DB.prepare(
      `SELECT dp.amount_idr, dp.payment_date, d.person_name
       FROM debt_payments dp
       JOIN debts d ON dp.debt_id = d.id
       WHERE dp.user_id = ?1 AND dp.status = 'scheduled'
         AND dp.payment_date > ?2 AND dp.payment_date <= ?3`
    ).bind(user.sub, asOf, monthEnd).all<{
      amount_idr: number; payment_date: string; person_name: string;
    }>(),

    c.env.DB.prepare('SELECT * FROM bank_accounts WHERE user_id = ?1')
      .bind(user.sub).all<BankAccountRow>(),

    c.env.DB.prepare('SELECT * FROM budget_limits WHERE user_id = ?1 AND month = ?2')
      .bind(user.sub, month).all<BudgetLimitRow>(),
  ]);

  const entries = entriesRes.results ?? [];
  const actualIncome = entries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount_idr, 0);
  const actualExpense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount_idr, 0);

  const dailyRate = actualExpense / daysElapsed;
  const variableProjection = Math.round(dailyRate * daysRemaining);

  // Only monthly templates — see the note above on double counting.
  const upcomingRecurring = (recurringRes.results ?? []).filter(r => r.recurrence === 'monthly');
  const knownExpense = upcomingRecurring
    .filter(r => r.type === 'expense')
    .reduce((s, r) => s + r.amount_idr, 0);
  const knownIncome = upcomingRecurring
    .filter(r => r.type === 'income')
    .reduce((s, r) => s + r.amount_idr, 0);

  const scheduledPayments = paymentsRes.results ?? [];
  const knownDebtPayments = scheduledPayments.reduce((s, p) => s + p.amount_idr, 0);

  const projectedExpense = actualExpense + variableProjection + knownExpense + knownDebtPayments;
  const projectedIncome = actualIncome + knownIncome;

  const currentAssets = (accountsRes.results ?? []).reduce((s, a) => s + a.balance, 0);
  const projectedAssets =
    currentAssets + (projectedIncome - actualIncome) - (projectedExpense - actualExpense);

  // Per-category pace: spend so far carried to month end against its limit.
  const spentByCategory = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== 'expense') continue;
    spentByCategory.set(e.category, (spentByCategory.get(e.category) ?? 0) + e.amount_idr);
  }

  const categoryPace = (limitsRes.results ?? [])
    .filter(l => l.monthly_limit_idr > 0)
    .map(l => {
      const spent = spentByCategory.get(l.category) ?? 0;
      const projected = Math.round((spent / daysElapsed) * daysInMonth);
      return {
        category: l.category,
        limit: l.monthly_limit_idr,
        spent,
        projected,
        over_by: Math.max(0, projected - l.monthly_limit_idr),
        will_exceed: projected > l.monthly_limit_idr,
      };
    })
    .sort((a, b) => b.over_by - a.over_by);

  return c.json({
    month,
    as_of: asOf,
    days_elapsed: daysElapsed,
    days_remaining: daysRemaining,
    days_in_month: daysInMonth,
    actual: { income: actualIncome, expense: actualExpense, net: actualIncome - actualExpense },
    projected: {
      income: projectedIncome,
      expense: projectedExpense,
      net: projectedIncome - projectedExpense,
      daily_rate: Math.round(dailyRate),
      variable_remaining: variableProjection,
    },
    known_upcoming: [
      ...upcomingRecurring.map(r => ({
        kind: 'recurring' as const,
        type: r.type,
        label: r.note || r.category,
        amount: r.amount_idr,
        date: r.next_recurrence_date,
      })),
      ...scheduledPayments.map(p => ({
        kind: 'debt_payment' as const,
        type: 'expense',
        label: `Cicilan ${p.person_name}`,
        amount: p.amount_idr,
        date: p.payment_date,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date)),
    assets: { current: currentAssets, projected: projectedAssets },
    category_pace: categoryPace,
  });
});

export default financeReport;
