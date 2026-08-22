/**
 * Frame-timing harness for screen transitions.
 *
 * Drives a tab change against a production build and records every
 * requestAnimationFrame interval while it runs. Reports the dropped-frame count
 * against both a 60Hz and a 120Hz budget, plus the longest main-thread block —
 * a long task is what a dropped frame actually looks like from the outside.
 *
 * Usage:
 *   npm run build
 *   npx vite preview --port 4180 &
 *   node perf.js 4180
 */
const { chromium } = require('playwright');

const { USER, installFixtures } = require('./test-fixtures');


// Records rAF deltas until stopped. Runs in the page so the timestamps come
// from the same clock the compositor drives.
const START_RECORDING = () => {
  window.__frames = [];
  window.__recording = true;
  let last = performance.now();
  const tick = (now) => {
    window.__frames.push(now - last);
    last = now;
    if (window.__recording) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  window.__longTasks = [];
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration));
    });
    po.observe({ entryTypes: ['longtask'] });
    window.__po = po;
  } catch {}
};

const STOP_RECORDING = () => {
  window.__recording = false;
  try { window.__po && window.__po.disconnect(); } catch {}
  // The first frame after rAF starts is not a real inter-frame delta.
  return { frames: window.__frames.slice(1), longTasks: window.__longTasks || [] };
};

function report(label, frames, longTasks) {
  if (!frames.length) return console.log(`${label}: no frames captured`);
  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const over60 = frames.filter((f) => f > 16.7).length;
  const over120 = frames.filter((f) => f > 8.3).length;
  const worstTask = longTasks.length ? Math.max(...longTasks) : 0;
  console.log(
    `${label.padEnd(22)} frames=${String(frames.length).padStart(3)}  ` +
    `p50=${pct(0.5).toFixed(1)}ms  p95=${pct(0.95).toFixed(1)}ms  max=${sorted[sorted.length - 1].toFixed(1)}ms  ` +
    `>16.7ms=${over60}  >8.3ms=${over120}  longTasks=${longTasks.length}${worstTask ? ` (worst ${worstTask}ms)` : ''}`
  );
  return { over60, over120, worstTask };
}

(async () => {
  const port = process.argv[2] || '4180';
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--enable-gpu-rasterization', '--enable-zero-copy'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await installFixtures(page);

  // Throttle the CPU so the numbers reflect a mid-range phone rather than a
  // datacentre core, which is where jank actually shows up.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const tabs = ['Kebiasaan', 'Goals', 'Uang', 'Beranda'];
  let totalOver60 = 0, totalOver120 = 0, worst = 0;

  for (const tab of tabs) {
    await page.evaluate(START_RECORDING);
    await page.getByRole('button', { name: tab, exact: false }).first().click();
    await page.waitForTimeout(600);
    const { frames, longTasks } = await page.evaluate(STOP_RECORDING);
    const r = report(`tab -> ${tab}`, frames, longTasks);
    if (r) { totalOver60 += r.over60; totalOver120 += r.over120; worst = Math.max(worst, r.worstTask); }
    await page.waitForTimeout(250);
  }

  // Press feedback is the other hot path: it used to transition box-shadow.
  await page.evaluate(START_RECORDING);
  const cta = page.locator('.neu-cta').first();
  if (await cta.count()) {
    for (let i = 0; i < 4; i++) {
      await cta.hover().catch(() => {});
      await page.mouse.down(); await page.waitForTimeout(90);
      await page.mouse.up(); await page.waitForTimeout(90);
    }
  }
  const press = await page.evaluate(STOP_RECORDING);
  report('press feedback', press.frames, press.longTasks);

  console.log(`\n===== 4x CPU throttle · ${totalOver60} frames over 60Hz budget, ${totalOver120} over 120Hz budget, worst long task ${worst}ms =====`);
  if (errors.length) {
    console.log('\nRUNTIME ERRORS:');
    for (const e of errors) console.log('  ' + e);
  }

  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
