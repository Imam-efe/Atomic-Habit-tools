/**
 * Shared API fixtures for the headless tools (sweep.js, perf.js).
 *
 * Every screen that throws on mount blanks React and takes the tab bar with it,
 * so a missing field here shows up as "could not reach screen" rather than as a
 * data problem. Keep a screen's required shape complete when adding one.
 */
const USER = { id: 'u1', name: 'Imam', email: 'imam@fayolla.local' };
const TODAY = new Date().toISOString().slice(0, 10);

const FIXTURES = {
  '/api/auth/refresh': { access_token: 'tok', refresh_token: 'r2', user: USER },
  '/api/dashboard': {
    habitsTotal: 3, habitsDone: 2, goalsTotal: 1, streak: 12,
    identityStatement: 'Saya orang yang konsisten',
    missedHabitAlert: 'Peregangan belum dikerjakan 2 hari',
    budget: { income: 12000000, expense: 7400000 },
  },
  '/api/net-worth': {
    current: { assets: 210000000, liabilities: 45000000, net_worth: 165000000, month: 'Ags 2026' },
    history: [{ month: 'Jul 2026', assets: 200000000, liabilities: 48000000, net_worth: 152000000 }],
  },
  '/api/habits': [
    { id: 'h1', name: 'Olahraga pagi', color: '#5B41D6', streak: 12, doneToday: true, triggerCue: 'bangun tidur', twoMin: 'Push up 5x' },
    { id: 'h2', name: 'Baca 10 halaman', color: '#1B6E37', streak: 5, doneToday: false },
  ],
  '/api/habit-stacks': [{
    id: 's1', name: 'Rutinitas pagi', description: 'Urutan pagi', is_active: 1,
    habits: [{ id: 'i1', habit_id: 'h1', position: 1, habit_name: 'Olahraga pagi', habit_color: '#5B41D6', habit_icon: '', habit_action_time: '06:00' }],
  }],
  // Shape mirrors GET /api/goals in backend/src/routes/goals.ts. `habitIds` in
  // particular is read unguarded by the goals list.
  '/api/goals': [{
    id: 'g1', identityStatement: 'Saya pelari', color: '#5B41D6', icon: '',
    habitIds: ['h1', 'h2'], progress: 60,
    level: 3, currentExp: 40, nextLevelExp: 100, totalExp: 240,
  }],
  // Goals renders score.history.map unguarded. The real endpoint always returns
  // the key (empty array when the user has no goals), so an omission here reads
  // as an app crash rather than a missing fixture.
  '/api/goals/score': {
    today: 67,
    history: [
      { date: '2026-08-15', score: 40 }, { date: '2026-08-16', score: 55 },
      { date: '2026-08-17', score: 60 }, { date: '2026-08-18', score: 50 },
      { date: '2026-08-19', score: 72 }, { date: '2026-08-20', score: 80 },
      { date: '2026-08-21', score: 67 },
    ],
    goals: [{ id: 'g1', identityStatement: 'Saya pelari', color: '#5B41D6', habitCount: 2, score: 67 }],
  },
  '/api/bank-accounts': [{ id: 'b1', name: 'BCA', account_type: 'bank', balance: 25000000 }],
  '/api/debts': [
    { id: 'dbt1', type: 'debt', person_name: 'Andi', amount_idr: 5000000, due_date: '2026-10-01', note: null, status: 'unpaid' },
  ],
  '/api/inventory': [
    { id: 'iv1', name: 'Beras', quantity: 5, unit: 'kg', expiry_date: '2026-09-10', purchase_date: TODAY, category: 'Bahan Makanan', note: null },
    { id: 'iv2', name: 'Susu', quantity: 0, unit: 'liter', expiry_date: '2026-08-01', purchase_date: TODAY, category: 'Bahan Makanan', note: null },
  ],
  '/api/kids-schedule': [
    { id: 'k1', kid_name: 'Aisyah', title: 'Matematika', type: 'pelajaran', day_of_week: 'Senin', schedule_time: '08:00', schedule_date: null, note: null },
  ],
  '/api/activity': [{ id: 'a1', label: 'Deep Work', hours: 3, date: TODAY }],
  '/api/scheduled-notifications': [
    { id: 'n1', title: 'Minum air', body: 'Waktunya minum', schedule_type: 'interval', interval_minutes: 120, isActive: true, fired_count: 4, nextRunAt: 1787320000 },
  ],
  '/api/scheduled-notifications/deliveries': [
    { id: 'dl1', title: 'Minum air', body: 'Waktunya minum', status: 'sent', fired_at: 1787310000 },
  ],
  '/api/nutrition': {
    summary: { calories: 1500, protein: 80, carbs: 180, fat: 50, fiber: 20 },
    target: { calories: 2200, protein: 120, carbs: 250, fat: 70, fiber: 30 },
    logs: [],
    foodLogs: [],
  },
  '/api/budget': {
    entries: [
      { id: 'e1', type: 'expense', amount: 250000, category: 'Makanan & Minuman', note: 'Belanja', date: TODAY, bank_account_id: 'b1', receipt_img: null },
      { id: 'e2', type: 'income', amount: 12000000, category: 'Gaji', note: 'Gaji bulanan', date: TODAY, bank_account_id: 'b1', receipt_img: null },
    ],
    summary: { income: 12000000, expense: 7400000, balance: 4600000 },
  },
  '/api/budget/limits': [],
  '/api/habit-heatmap': [{ habitId: 'h1', name: 'Olahraga pagi', color: '#5B41D6', days: [] }],
  // Shape mirrors GET /api/weekly-review.
  '/api/weekly-review': {
    weekStart: '2026-08-17', weekEnd: '2026-08-23', daysElapsed: 5, overallConsistency: 72,
    habits: [{ id: 'h1', name: 'Olahraga pagi', color: '#5B41D6', completed: 4, target: 5, consistency: 80 }],
    review: null,
  },
  '/api/weekly-review/list': [],
  '/api/projects': [{ id: 'p1', name: 'Rumah', status: 'active', tasks: [] }],
  // Route is /api/finance-report (not financial-), and the shape is pnl /
  // balance_sheet / upcoming_payments. Both were wrong here before, which left
  // the screen blank while the audit scored it as a clean pass.
  '/api/finance-report': {
    pnl: {
      month: '2026-08', income: 12000000, expense: 7400000, net_profit: 4600000,
      expenses_breakdown: [{ category: 'Makanan & Minuman', amount: 3200000 }, { category: 'Transportasi', amount: 1400000 }],
      income_breakdown: [{ category: 'Gaji', amount: 12000000 }],
    },
    balance_sheet: {
      assets: { total: 210000000, accounts: [{ name: 'BCA', type: 'bank', balance: 25000000 }], receivables: 2000000 },
      liabilities: { total: 45000000 },
      net_worth: 165000000,
    },
    upcoming_payments: [{
      id: 'up1', debt_id: 'dbt1', amount: 1500000, date: '2026-09-01',
      status: 'unpaid', note: null, person_name: 'Andi', debt_type: 'debt',
    }],
  },
};

/** Serves every /api/** call from FIXTURES, falling back to an empty list. */
async function installFixtures(page) {
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(p in FIXTURES ? FIXTURES[p] : []),
    });
  });
  await page.addInitScript(({ user }) => {
    localStorage.setItem('fayolla_accounts', JSON.stringify([{ userId: user.id, name: user.name, refreshToken: 'r1' }]));
    localStorage.setItem('fayolla_active_user_id', user.id);
  }, { user: USER });
}

module.exports = { USER, TODAY, FIXTURES, installFixtures };
