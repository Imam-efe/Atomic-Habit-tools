/**
 * Full-app sweep: visits every reachable screen in both themes, runs the WCAG AA
 * contrast audit against the rendered DOM, records any runtime error, and writes
 * a screenshot per screen.
 */
const { chromium } = require('playwright');
const fs = require('fs');

const USER = { id: 'u1', name: 'Imam', email: 'imam@fayolla.local' };
const MONTH = new Date().toISOString().slice(0, 7);
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
  '/api/goals': [{ id: 'g1', title: 'Lari 5K', identity: 'Saya pelari', progress: 60, target_date: '2026-12-31', name: 'Lari 5K' }],
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
  [`/api/nutrition`]: {
    summary: { calories: 1500, protein: 80, carbs: 180, fat: 50, fiber: 20 },
    target: { calories: 2200, protein: 120, carbs: 250, fat: 70, fiber: 30 },
    logs: [],
  },
  [`/api/budget`]: {
    summary: { income: 12000000, expense: 7400000 },
    entries: [{ id: 'e1', type: 'expense', amount: 250000, category: 'Makanan & Minuman', note: 'Belanja', date: TODAY }],
    categories: [],
  },
  '/api/habit-heatmap': [{ habitId: 'h1', name: 'Olahraga pagi', color: '#5B41D6', days: [] }],
  '/api/weekly-review': { habits: [], summary: {} },
  '/api/projects': [{ id: 'p1', name: 'Rumah', status: 'active', tasks: [] }],
  '/api/financial-report': { profitLoss: {}, balanceSheet: {}, debts: [] },
};

const AUDIT = () => {
  const lum = (r, g, b) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const ratio = (fg, bg) => {
    const a = lum(...fg), b = lum(...bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  // Walk outwards and stop at whichever paints first: an opaque background
  // colour or a gradient. Checking gradients separately would let an ancestor's
  // gradient override the element's own solid fill.
  const backdrop = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.9)) return { solid: c.slice(0, 3) };
      if (cs.backgroundImage !== 'none') {
        const stops = (cs.backgroundImage.match(/rgba?\([^)]*\)/g) || []).map((s) => parse(s).slice(0, 3));
        if (stops.length) return { stops };
      }
    }
    return { solid: parse(getComputedStyle(document.body).backgroundColor).slice(0, 3) };
  };


  const out = [];
  const skipped = { gradient: 0, glyph: 0, dimmed: 0 };
  document.querySelectorAll('*').forEach((el) => {
    const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim()).join(' ').trim();
    if (!text) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    let op = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
    if (op < 0.95) { skipped.dimmed++; return; }
    if (!/[a-zA-Z0-9]/.test(text)) { skipped.glyph++; return; }

    const fg = parse(cs.color).slice(0, 3);
    const bd = backdrop(el);
    const stops = bd.stops;
    // A gradient is only as good as its worst stop for this text colour.
    const cr = stops
      ? (skipped.gradient++, Math.min(...stops.map((s) => ratio(fg, s))))
      : ratio(fg, bd.solid);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const min = large ? 3 : 4.5;
    if (cr < min) out.push({ text: text.slice(0, 40), ratio: +cr.toFixed(2), min, onGradient: !!stops, cls: el.className.toString().slice(0, 50) });
  });
  return { out, skipped };
};

const DARK = {
  bg: '#22252A', surface: '#22252A', text: '#F4F6F9', text2: '#B2B9C6', text3: '#8A92A1',
  sep: 'rgba(23,26,30,0.75)', track: '#1C1F24', blur: 'rgba(34,37,42,0.82)',
  'neu-light': '#2B2F36', 'neu-dark': '#171A1E',
  accent: '#A48DFF', accent2: '#7C5CFF', accentSoft: 'rgba(164,141,255,0.18)',
  pos: '#34C759', neg: '#FF453A', warn: '#FF9F0A', info: '#5FB0FF',
  warnBorder: 'rgba(255,159,10,0.35)',
};

const SUBSCREENS = [
  'Projects', 'Aktivitas', 'Nutrisi', 'Kalender Haid', 'Stok & Inventaris',
  'Jadwal Anak', 'Laporan Keuangan', 'Review Mingguan', 'Heatmap Kebiasaan',
  'Pelunasan Utang', 'Pusat Notifikasi',
];

(async () => {
  const port = process.argv[2] || '4179';
  const theme = process.argv[3] || 'light';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 1400 }, deviceScaleFactor: 1 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p in FIXTURES ? FIXTURES[p] : []) });
  });
  await page.addInitScript(({ user }) => {
    localStorage.setItem('fayolla_accounts', JSON.stringify([{ userId: user.id, name: user.name, refreshToken: 'r1' }]));
    localStorage.setItem('fayolla_active_user_id', user.id);
  }, { user: USER });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const applyDark = async () => {
    if (theme !== 'dark') return;
    await page.evaluate((d) => {
      Object.entries(d).forEach(([k, v]) => document.documentElement.style.setProperty(`--${k}`, v));
      document.documentElement.setAttribute('data-theme', 'dark');
    }, DARK);
    await page.waitForTimeout(300);
  };
  await applyDark();

  const report = [];
  const check = async (name) => {
    await applyDark();
    const before = errors.length;
    const { out, skipped } = await page.evaluate(AUDIT);
    fs.mkdirSync(`sweep-${theme}`, { recursive: true });
    await page.screenshot({ path: `sweep-${theme}/${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`, fullPage: true });
    report.push({ name, fails: out, skipped, newErrors: errors.slice(before) });
  };

  // A screen that throws blanks React and takes the tab bar with it, so every
  // later navigation would fail too. Reload between screens to isolate them.
  const home = async () => {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1100);
    await applyDark();
  };

  await check('Beranda');
  for (const tab of ['Kebiasaan', 'Goals', 'Uang', 'Lainnya']) {
    try {
      await home();
      await page.getByRole('button', { name: tab, exact: false }).first().click({ timeout: 8000 });
      await page.waitForTimeout(1100);
      if (tab === 'Kebiasaan') {
        const h = page.getByText('Olahraga pagi').first();
        if (await h.count()) { await h.click(); await page.waitForTimeout(600); }
      }
      await check(tab);
    } catch (e) {
      report.push({ name: tab, blocked: e.message.split('\n')[0], newErrors: errors.slice(-3) });
    }
  }

  for (const label of SUBSCREENS) {
    try {
      await home();
      await page.getByRole('button', { name: 'Lainnya', exact: false }).first().click({ timeout: 8000 });
      await page.waitForTimeout(800);
      const entry = page.getByText(label, { exact: true }).first();
      if (!(await entry.count())) { report.push({ name: label, missing: true }); continue; }
      await entry.click({ timeout: 8000 });
      await page.waitForTimeout(1300);
      await check(label);
    } catch (e) {
      report.push({ name: label, blocked: e.message.split('\n')[0], newErrors: errors.slice(-3) });
    }
  }

  let totalFails = 0, totalErrors = 0;
  for (const r of report) {
    if (r.missing) { console.log(`\n?? ${r.name}: MENU ENTRY NOT FOUND`); continue; }
    if (r.blocked) {
      console.log(`\n!! ${r.name}: COULD NOT REACH — ${r.blocked}`);
      for (const e of r.newErrors || []) console.log(`     RUNTIME ERROR: ${e}`);
      totalErrors += (r.newErrors || []).length;
      continue;
    }
    totalFails += r.fails.length;
    totalErrors += r.newErrors.length;
    const flag = r.fails.length || r.newErrors.length ? '!!' : 'ok';
    console.log(`\n${flag} ${r.name} — ${r.fails.length} below AA (${r.skipped.gradient} on gradients checked / ${r.skipped.glyph} glyph / ${r.skipped.dimmed} dimmed skipped)`);
    const seen = new Set();
    for (const f of r.fails) {
      const k = f.text + f.ratio;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`     ${String(f.ratio).padStart(5)} (need ${f.min})  "${f.text}"  [${f.cls}]`);
    }
    for (const e of r.newErrors) console.log(`     RUNTIME ERROR: ${e}`);
  }
  console.log(`\n===== ${theme}: ${totalFails} contrast failures, ${totalErrors} runtime errors across ${report.length} screens =====`);

  await browser.close();
})();
