/**
 * Full-app sweep: visits every reachable screen in both themes, runs the WCAG AA
 * contrast audit against the rendered DOM, records any runtime error, and writes
 * a screenshot per screen.
 */
const { chromium } = require('playwright');
const fs = require('fs');

const { installFixtures } = require('./test-fixtures');


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

  await installFixtures(page);

  // Drive the app's own theme rather than injecting CSS variables. Injection
  // left the store on 'light', so anything that themes in JS (readableOn, and
  // any future logic keyed on theme) was audited in the wrong theme — and the
  // injected token list was a hand-maintained copy free to drift from
  // tokens/theme.ts. uiStore persists theme, so this survives the reloads
  // between screens.
  await page.addInitScript((t) => {
    localStorage.setItem('fayolla_ui', JSON.stringify({ state: { theme: t, accent: 'violet' }, version: 0 }));
  }, theme);

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Guard against the persisted theme silently not applying: every later result
  // would be attributed to the wrong theme.
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (applied !== theme) {
    console.error(`FATAL: asked for '${theme}' but the app is in '${applied}'.`);
    await browser.close();
    process.exit(2);
  }

  const report = [];
  const check = async (name) => {
    const before = errors.length;
    // A screen that threw has no text, and no text means no contrast failures —
    // which the audit alone would report as a clean pass. Measure what actually
    // rendered so a blank screen fails loudly instead of scoring perfectly.
    const rendered = await page.evaluate(() => ({
      chars: (document.body.innerText || '').trim().length,
      tabBar: !!document.querySelector('nav'),
    }));
    const { out, skipped } = await page.evaluate(AUDIT);
    fs.mkdirSync(`sweep-${theme}`, { recursive: true });
    await page.screenshot({ path: `sweep-${theme}/${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`, fullPage: true });
    report.push({ name, fails: out, skipped, rendered, newErrors: errors.slice(before) });
  };

  // A screen that throws blanks React and takes the tab bar with it, so every
  // later navigation would fail too. Reload between screens to isolate them.
  const home = async () => {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1100);
  };

  await check('Beranda');
  for (const tab of ['Kebiasaan', 'Kalender', 'Goals', 'Uang', 'Lainnya']) {
    try {
      await home();
      await page.getByRole('button', { name: tab, exact: false }).first().click({ timeout: 8000 });
      await page.waitForTimeout(1100);
      if (tab === 'Kebiasaan') {
        // The shell keeps visited tabs mounted (display:none), so the same
        // text exists in hidden panes too — match only the visible one.
        const h = page.locator('text=Olahraga pagi >> visible=true').first();
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
      const entry = page.locator(`text="${label}" >> visible=true`).first();
      if (!(await entry.count())) { report.push({ name: label, missing: true }); continue; }
      await entry.click({ timeout: 8000 });
      await page.waitForTimeout(1300);
      await check(label);
    } catch (e) {
      report.push({ name: label, blocked: e.message.split('\n')[0], newErrors: errors.slice(-3) });
    }
  }

  // Anything under this and the screen did not really render — the audit would
  // otherwise score an empty page as a clean pass.
  const MIN_CHARS = 40;

  let totalFails = 0, totalErrors = 0, totalBlank = 0;
  for (const r of report) {
    if (r.missing) { console.log(`\n?? ${r.name}: MENU ENTRY NOT FOUND`); continue; }
    if (r.blocked) {
      console.log(`\n!! ${r.name}: COULD NOT REACH — ${r.blocked}`);
      for (const e of r.newErrors || []) console.log(`     RUNTIME ERROR: ${e}`);
      totalErrors += (r.newErrors || []).length;
      continue;
    }
    const blank = r.rendered.chars < MIN_CHARS || !r.rendered.tabBar;
    if (blank) totalBlank++;
    totalFails += r.fails.length;
    totalErrors += r.newErrors.length;
    const flag = blank || r.fails.length || r.newErrors.length ? '!!' : 'ok';
    console.log(`\n${flag} ${r.name} — ${r.fails.length} below AA (${r.skipped.gradient} on gradients checked / ${r.skipped.glyph} glyph / ${r.skipped.dimmed} dimmed skipped)`);
    if (blank) {
      console.log(`     DID NOT RENDER: ${r.rendered.chars} chars of text, tab bar ${r.rendered.tabBar ? 'present' : 'MISSING'}`);
    }
    const seen = new Set();
    for (const f of r.fails) {
      const k = f.text + f.ratio;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`     ${String(f.ratio).padStart(5)} (need ${f.min})  "${f.text}"  [${f.cls}]`);
    }
    for (const e of r.newErrors) console.log(`     RUNTIME ERROR: ${e}`);
  }
  console.log(`\n===== ${theme}: ${totalFails} contrast failures, ${totalErrors} runtime errors, ${totalBlank} blank screens across ${report.length} screens =====`);

  await browser.close();
  process.exit(totalFails || totalErrors || totalBlank ? 1 : 0);
})();
