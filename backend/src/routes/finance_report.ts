import { Hono } from 'hono';
import type { BankAccountRow, BudgetEntryRow } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';

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

export default financeReport;
