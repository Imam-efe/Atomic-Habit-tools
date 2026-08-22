# Regression tools and data sources

Two headless harnesses that run against a production build. Both serve the app
from `test-fixtures.js` so a run does not depend on a live backend.

```bash
npm run build
npx vite preview --port 4180 &

node sweep.js 4180 light    # contrast + render audit, light theme
node sweep.js 4180 dark     # same, dark theme
node perf.js  4180          # frame timing during tab changes
```

Both exit non-zero on failure, so they can gate CI.

## sweep.js — contrast and render audit

Walks all 18 screens plus the two root overlays (global search and quick-add)
and, for every text node, measures the WCAG contrast of its colour against
whatever actually paints behind it.

The overlays need driving, not just opening: search shows nothing until a query
is typed, and quick-add shows nothing until a parse returns. `OVERLAYS` in
`sweep.js` carries the text to type and the button to press for each, so the
states that actually render are the ones measured.

Per screen it reports:

- **contrast failures** — below 4.5:1 for normal text, 3:1 for large text
  (24px+, or 18.66px+ at weight 700+)
- **runtime errors** — anything thrown during render
- **blank screens** — a screen that rendered under 40 characters, or lost the tab
  bar

The blank check matters more than it looks. A screen that throws renders no
text, and no text means no contrast failures, so the audit alone scores a
crashed screen as a *perfect* pass. Three screens were passing that way before
the check existed.

Screenshots land in `sweep-light/` and `sweep-dark/` (git-ignored).

### How contrast is measured

WCAG relative luminance with gamma correction. Resolving the backdrop walks up
from the element and stops at whichever paints first — an opaque background or a
gradient — so an ancestor gradient cannot override an element's own solid fill.
Text over a gradient is scored against the gradient's **worst** stop.

Skipped, and counted in the output: text dimmed below 0.95 cumulative opacity,
and strings with no alphanumeric characters (icons, emoji, separators).

### Themes

Theme is set by seeding the `fayolla_ui` key that `uiStore` persists, then
letting the app apply it. The run aborts if `data-theme` does not match what was
asked for.

Earlier versions injected CSS variables directly. That left the store on
`light`, so anything that themes in JavaScript — `readableOn` in `src/lib/color.ts`,
and any future theme-keyed logic — was audited in the wrong theme, and the
injected token list was a hand-maintained copy of `tokens/theme.ts` free to drift
from it.

## perf.js — frame timing

Records every `requestAnimationFrame` interval across four tab changes and a
burst of button presses, at 4x CPU throttle to stand in for a mid-range phone.
Reports p50/p95/max frame time, frames over the 60Hz and 120Hz budgets, and the
worst long task.

**Read the long-task column first.** Screen transitions are composited and cost
almost nothing; what drops frames is the main thread blocking while React mounts
the incoming screen and its fetch resolves. During an 80ms long task nothing
animates, no matter how cheap the animation is.

Two limits worth knowing: headless Chromium is vsync'd at 60Hz, so the >8.3ms
column cannot demonstrate 120fps and p50 sits at 16.7ms by construction; and
frame counts move by a few between runs, so only treat sizeable differences as
signal.

## Adding a screen

1. Add its menu label to `SUBSCREENS` in `sweep.js`.
2. Add every endpoint it calls to `FIXTURES` in `test-fixtures.js`.

Fixture shape has to match the backend, not just be plausible. Wrong shapes
caused every blank screen found so far — a guessed `/api/financial-report`
against the real `/api/finance-report`, and a `/api/goals` entry missing
`habitIds`, both of which crashed the screen while the audit reported a clean
pass. Check `backend/src/routes/` when adding one.

## Holiday data

Red dates come from `src/data/holidays.ts` — the SKB 3 Menteri decree,
transcribed per year. That file is authoritative and works offline.

A weekly Worker cron also pulls
[guangrei/APIHariLibur_V2](https://github.com/guangrei/APIHariLibur_V2) into
`holiday_cache` and serves it at `GET /api/holidays?year=`. It is served from
`raw.githubusercontent.com` rather than one of the Vercel-hosted Indonesian
holiday APIs, which are hobby deployments that go cold; a static file on
GitHub's CDN does not, and it carries an `info.updated` stamp.

The feed never overwrites the decree. It agrees with the SKB on all 25 dates in
2026, but is looser about what each one is: every entry is `holiday: true`, so
cuti bersama are only identifiable by name — and 28 May 2026 arrives named as a
second day of Idul Adha rather than the joint leave it is. Merging it in would
collapse the two colours the grid draws. So `resolveYear()` gives it two jobs
instead:

- **cover years with no decree yet**, drawn with an "belum diverifikasi SKB" notice
- **report date-level disagreement** on years both cover, so a real amendment
  surfaces instead of silently repainting red dates

Only added or removed *dates* count as drift. Name and kind differences are the
feed's known imprecision and would fire on every sync.

To add a year once its decree is published: append it to `holidays.ts` and to
`COVERED_YEARS`.
