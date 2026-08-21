# Accessibility Sweep Tool

Full-app contrast audit: visits every reachable screen in both light and dark themes, runs WCAG AA contrast audit against rendered DOM, records runtime errors, and saves screenshots per screen.

## Usage

Start dev server on port 4179:
```bash
npm run dev -- --port 4179
```

In another terminal, run sweep for light theme:
```bash
node sweep.js 4179 light
```

Or dark theme:
```bash
node sweep.js 4179 dark
```

## Output

- Console report: contrast failures per screen, runtime errors, gradient vs solid backgrounds tested
- `sweep-light/` and `sweep-dark/` directories: PNG screenshots of each screen
- Exit code: 0 if no failures/errors, non-zero otherwise

## Screens Audited

Main tabs (4):
- Beranda (Dashboard)
- Kebiasaan (Habits)
- Goals
- Uang (Budget)

Sub-screens from More tab (11):
- Projects, Aktivitas, Nutrisi, Kalender Haid, Stok & Inventaris, Jadwal Anak, Laporan Keuangan, Review Mingguan, Heatmap Kebiasaan, Pelunasan Utang, Pusat Notifikasi

## Contrast Algorithm

WCAG 2.0 luminance formula with gamma correction. Text color tested against:
- Solid background: direct ratio
- Gradient background: worst stop (lightest for white text)

Ratios < 4.5:1 normal text or < 3:1 large text (24px+ or 18.66px+ 700+ weight) flagged.

## Extending

Add screens to SUBSCREENS array (line 135) to audit new menu entries. Update FIXTURES (lines 13–66) with API responses needed for new screens.

## CI Integration

Run sweep in CI pipeline after deployment to catch contrast regressions before release.
