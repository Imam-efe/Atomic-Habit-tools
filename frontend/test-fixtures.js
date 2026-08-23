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
  // h1 carries a spent streak freeze so the "streak diselamatkan" banner and
  // the ❄️ marker on the streak chip are both in the audit's path. h3 is
  // weekly-frequency so the "X/Y× minggu ini" line and the "mgu" streak unit
  // are in the audit's path too.
  '/api/habits': [
    { id: 'h1', name: 'Olahraga pagi', color: '#5B41D6', streak: 12, doneToday: true, triggerCue: 'bangun tidur', twoMin: 'Push up 5x', freezesUsed: 1, freezesLeft: 1, lastFreezeDate: '2026-08-14' },
    { id: 'h2', name: 'Baca 10 halaman', color: '#1B6E37', streak: 5, doneToday: false, freezesUsed: 0, freezesLeft: 2, lastFreezeDate: null },
    { id: 'h3', name: 'Gym', color: '#0A84FF', streak: 4, doneToday: false, freezesUsed: 0, freezesLeft: 2, lastFreezeDate: null, frequencyType: 'weekly', targetPerWeek: 3, completionsThisWeek: 2 },
  ],
  // Four Laws diagnostic — keyed literally on h1's diagnose path, since the
  // fixture router matches full pathname, not a wildcard. Exercises the
  // "diagnosed" panel (weakest-law highlight + reason/suggestion), the branch
  // sweep.js drives by clicking the button before capturing the Kebiasaan screen.
  '/api/habits/h1/diagnose': {
    verdict: 'diagnosed',
    consistency: 42,
    weakestLaw: 'obvious',
    weakestLawLabel: 'Jadikan Terlihat (Obvious)',
    reason: 'Belum ada waktu pengingat spesifik, jadi mudah terlupa di tengah kesibukan pagi.',
    suggestion: 'Tambahkan waktu pengingat tetap, misalnya 06:00, agar muncul notifikasi setiap hari.',
  },
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
  // Calendar reads a date range; the harness serves the same rows whatever the
  // range, which is enough to render the grid, the dots and the day panel.
  '/api/calendar': [
    { id: 'c1', title: 'Rapat RT', note: null, kind: 'event', date: TODAY, event_date: TODAY,
      event_time: '19:00', end_time: null, priority: 'normal', is_done: 0, repeat_rule: 'none', is_repeat: false },
    { id: 'c2', title: 'Bayar listrik', note: 'Lewat mobile banking', kind: 'task', date: TODAY, event_date: TODAY,
      event_time: null, end_time: null, priority: 'high', is_done: 0, repeat_rule: 'monthly', is_repeat: false },
  ],
  '/api/calendar/agenda': {
    date: TODAY,
    items: [
      { source: 'habit', id: 'h1', title: 'Olahraga pagi', time: '06:00' },
      { source: 'debt', id: 'dbt1', title: 'Bayar utang ke Andi', detail: 'Rp5.000.000' },
    ],
  },
  // Real payload shape from GET /api/holidays. The rows are the actual upstream
  // 2026 set, so the sweep exercises the merge against the bundled decree.
  '/api/holidays': {
    year: 2026,
    source: { name: 'guangrei/APIHariLibur_V2', url: 'https://raw.githubusercontent.com/guangrei/APIHariLibur_V2/main/calendar.min.json' },
    sync: {
      source: 'guangrei/APIHariLibur_V2', source_updated: '20260815 17:05:59',
      last_attempt_at: 1787270000, last_success_at: 1787270000,
      status: 'ok', detail: '25 entri', entry_count: 25,
    },
    holidays: [
      { date: '2026-01-01', name: "Hari Tahun Baru", kind: 'libur' },
      { date: '2026-01-16', name: "Isra Mikraj Nabi Muhammad", kind: 'libur' },
      { date: '2026-02-16', name: "Cuti Bersama Tahun Baru Imlek", kind: 'cuti' },
      { date: '2026-02-17', name: "Tahun Baru Imlek", kind: 'libur' },
      { date: '2026-03-18', name: "Cuti Bersama Hari Suci Nyepi (Tahun Baru Saka)", kind: 'cuti' },
      { date: '2026-03-19', name: "Hari Suci Nyepi (Tahun Baru Saka)", kind: 'libur' },
      { date: '2026-03-20', name: "Cuti Bersama Idul Fitri", kind: 'cuti' },
      { date: '2026-03-21', name: "Hari Idul Fitri", kind: 'libur' },
      { date: '2026-03-22', name: "Hari Idul Fitri", kind: 'libur' },
      { date: '2026-03-23', name: "Cuti Bersama Idul Fitri", kind: 'cuti' },
      { date: '2026-03-24', name: "Cuti Bersama Idul Fitri", kind: 'cuti' },
      { date: '2026-04-03', name: "Wafat Isa Almasih", kind: 'libur' },
      { date: '2026-04-05', name: "Hari Paskah", kind: 'libur' },
      { date: '2026-05-01', name: "Hari Buruh Internasional / Pekerja", kind: 'libur' },
      { date: '2026-05-14', name: "Kenaikan Isa Al Masih", kind: 'libur' },
      { date: '2026-05-15', name: "Cuti Bersama Kenaikan Isa Al Masih", kind: 'cuti' },
      { date: '2026-05-27', name: "Idul Adha (Lebaran Haji)", kind: 'libur' },
      { date: '2026-05-28', name: "Idul Adha (Lebaran Haji)", kind: 'libur' },
      { date: '2026-05-31', name: "Hari Raya Waisak (belum pasti)", kind: 'libur' },
      { date: '2026-06-01', name: "Hari Lahir Pancasila", kind: 'libur' },
      { date: '2026-06-16', name: "Hari Kedua Muharram", kind: 'libur' },
      { date: '2026-08-17', name: "Hari Proklamasi Kemerdekaan R.I.", kind: 'libur' },
      { date: '2026-08-25', name: "Maulid Nabi Muhammad", kind: 'libur' },
      { date: '2026-12-24', name: "Cuti Bersama Natal (Malam Natal)", kind: 'cuti' },
      { date: '2026-12-25', name: "Hari Raya Natal", kind: 'libur' },
    ],
  },
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
  // Global search overlay. Covers a dated hit and an undated one, since the
  // two render different subtitle rows.
  '/api/search': {
    query: 'beras',
    hits: [
      { type: 'inventory', label: 'Stok', id: 'iv1', title: 'Beras', subtitle: '5 kg · Bahan Makanan', date: '2026-09-10', subScreen: 'inventory' },
      { type: 'budget', label: 'Pengeluaran', id: 'be1', title: 'Beras 5kg', subtitle: 'Rp70.000 · Belanja Bulanan', date: TODAY, tab: 'uang' },
      { type: 'habit', label: 'Kebiasaan', id: 'h1', title: 'Olahraga pagi', subtitle: 'Streak 12 hari', date: null, tab: 'kebiasaan' },
    ],
  },
  // Quick-add proposal card. An expense keeps the richest layout on screen:
  // amount, category select and note are all editable before saving.
  // Calendar intent — the newest QuickAdd branch, so this is the one worth
  // auditing this pass; expense/habit/inventory render the same shared
  // tokens and were unchanged and already proven passing.
  '/api/quickadd/parse': {
    intent: 'calendar',
    text: 'meeting jam 3 sore besok',
    event: {
      title: 'Meeting', note: null, kind: 'event',
      event_date: TODAY, event_time: '15:00',
    },
  },
  // Month-end projection card. `days_remaining` must stay above zero or the
  // card hides itself and the audit never measures it. `category_pace` carries
  // one over-limit row so the warning block renders too.
  '/api/finance-report/forecast': {
    month: '2026-08', as_of: TODAY, days_elapsed: 22, days_remaining: 9, days_in_month: 31,
    actual: { income: 12000000, expense: 7400000, net: 4600000 },
    projected: {
      income: 12000000, expense: 10427000, net: 1573000,
      daily_rate: 336364, variable_remaining: 3027000,
    },
    known_upcoming: [
      { kind: 'recurring', type: 'expense', label: 'Langganan internet', amount: 350000, date: '2026-08-25' },
      { kind: 'debt_payment', type: 'expense', label: 'Cicilan Andi', amount: 1500000, date: '2026-08-28' },
    ],
    assets: { current: 25000000, projected: 21973000 },
    category_pace: [
      { category: 'Makanan & Minuman', limit: 4000000, spent: 3200000, projected: 4509000, over_by: 509000, will_exceed: true },
      { category: 'Transportasi & Bensin', limit: 2500000, spent: 1400000, projected: 1972000, over_by: 0, will_exceed: false },
    ],
  },
  '/api/achievements': {
    badges: [
      { id: 'streak-7', name: 'Seminggu Penuh', description: 'Streak 7 hari pada satu kebiasaan', icon: '🔥', earned: true, progress: 100, currentValue: 7, targetValue: 7 },
      { id: 'streak-30', name: 'Sebulan Konsisten', description: 'Streak 30 hari pada satu kebiasaan', icon: '🏆', earned: false, progress: 40, currentValue: 12, targetValue: 30 },
    ],
    earnedCount: 1,
    totalCount: 2,
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
