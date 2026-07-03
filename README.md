# Handoff: Fayolla — Atomic Habits Personal System (iOS-style, mobile-first)

## Overview
Fayolla is a single-user, mobile-first personal-operating-system app inspired by *Atomic Habits*
(James Clear). It unifies six modules — Habits, Goals, Projects, Budget, Activity Labeling, and
Nutrition — under one philosophy: **focus on systems (daily behaviors), not goals (outcomes), and
frame everything around identity** ("Saya adalah orang yang…" / "I am the kind of person who…").

Tagline: *Your personal system for 1% better every day.*

The product is **Apple-native in feel** (iOS system look: SF system font, iOS semantic colors,
spring motion, tab bar + push navigation) and **motion is a first-class requirement, not decoration**.
UI copy is in **Indonesian**.

---

## About the Design Files
The file in `design/Fayolla.dc.html` is a **design reference prototype built in HTML/JS** — it shows
the intended look, layout, content, and interaction behavior. **It is not production code to copy
directly.** It uses a small internal templating runtime (`support.js`, the `<x-dc>` / `{{ }}` /
`<sc-for>` / `<sc-if>` tags); you do **not** need that runtime.

Your task is to **recreate this design in the project's real environment**. The PRD
(`design/PRD.md`) specifies the target stack: **React 18 + Framer Motion 11 + Tailwind CSS 3 +
React Router v6 + Zustand**, PWA, with a flexible backend (Supabase recommended for MVP). If you are
starting fresh, use that stack. If a codebase already exists, follow its established patterns and
component library and treat this prototype as the visual + behavioral spec.

To view the prototype: open `design/Fayolla.dc.html` in a browser. Use the **Light/Dark** toggle and
the **accent swatches** above the phone to see theme variations. Tap habit cards to check them in
(tap **Meditasi** to trigger the streak-milestone confetti).

---

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, iconography, copy, and motion are all
specified here and in the prototype. Recreate the UI pixel-accurately using the codebase's libraries.
The only deliberately faux elements are the device bezel/status bar (provided by the real device /
OS at runtime) and the floating theme/accent control dock (a prototype-only affordance — in the real
app, theme lives in Settings and follows system appearance by default).

---

## Information Architecture & Navigation

**Bottom tab bar (5 tabs), always visible:**
| Tab | Label (ID) | Screen |
|---|---|---|
| 1 | Beranda | Dashboard / daily view |
| 2 | Kebiasaan | Habit Tracker |
| 3 | Goals | Goals (identity-based) |
| 4 | Uang | Budget |
| 5 | Lainnya | "More" hub |

**The "Lainnya" hub** pushes (iOS forward-push) into three secondary screens, each with a back
button: **Projects**, **Activity Labeling (Aktivitas)**, **Nutrisi & Food Log**. Dashboard module
cards deep-link directly to any screen.

- Switching tabs = cross-fade/slide entrance of the new screen (`fyScreen` keyframe).
- Entering a secondary screen = iOS push (slide from right). Back = pop. Tab bar stays mounted; the
  active tab indicator stays on "Lainnya" while in a secondary screen.
- Each screen scrolls independently; scroll resets to top on navigation.

---

## Design Tokens

### Theme — Dark (default per PRD; prototype's edited default is Light — confirm with product)
| Token | Value |
|---|---|
| `--bg` | `#000000` |
| `--surface` (cards) | `#1C1C1E` |
| `--text` | `#FFFFFF` |
| `--text2` (secondary) | `rgba(235,235,245,0.62)` |
| `--text3` (tertiary/disabled) | `rgba(235,235,245,0.30)` |
| `--sep` (separators/borders) | `rgba(84,84,88,0.50)` |
| `--track` (progress track) | `rgba(120,120,128,0.28)` |
| `--blur` (tab bar bg) | `rgba(22,22,24,0.78)` + backdrop-blur(22px) |
| warn border | `rgba(255,159,10,0.35)` |

### Theme — Light
| Token | Value |
|---|---|
| `--bg` | `#F2F2F7` |
| `--surface` | `#FFFFFF` |
| `--text` | `#000000` |
| `--text2` | `rgba(60,60,67,0.60)` |
| `--text3` | `rgba(60,60,67,0.30)` |
| `--sep` | `rgba(60,60,67,0.14)` |
| `--track` | `rgba(120,120,128,0.16)` |
| `--blur` | `rgba(255,255,255,0.78)` |

### Accent (user-selectable; default = violet per PRD, prototype edited to green)
| Name | Primary | Gradient end (`--accent2`) | Soft (16%) |
|---|---|---|---|
| violet | `#7C5CFF` | `#9D7CFF` | `rgba(124,92,255,0.16)` |
| green | `#34C759` | `#5BD97A` | `rgba(52,199,89,0.16)` |
| blue | `#0A84FF` | `#4AA8FF` | `rgba(10,132,255,0.16)` |
| orange | `#FF9F0A` | `#FFB740` | `rgba(255,159,10,0.16)` |

`--accentSoft` = primary at 16% alpha. Identity hero uses `linear-gradient(135deg, --accent, --accent2)`.

### Category / semantic colors (constant across themes — iOS system palette)
`green #34C759` · `blue #0A84FF` · `orange #FF9F0A` · `red #FF453A` · `teal #5AC8FA` ·
`pink/red #FF375F` · `indigo #5E5CE6` · `gray #8E8E93`.
Soft backgrounds for icon tiles/chips = the color at **15–16% alpha**.

Status label colors: **done** `#34C759` · **in-progress** `#0A84FF` · **backlog** `#8E8E93`.
Food labels: **Sehat** `#34C759` · **Moderat** `#FF9F0A` · **Indulge** `#FF375F`.

### Typography
- Family: **system stack** — `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
  "Segoe UI", Roboto, sans-serif` (renders SF Pro on Apple devices, the target).
- Scale used (px / weight / tracking):
  - Screen title (large): 28–30 / 800 / -0.6 to -0.7px
  - Section header: 18 / 700 / -0.3px
  - Card title: 15–16.5 / 600–700 / -0.2 to -0.3px
  - Big stat numerals: 21–26 / 800
  - Body / secondary: 12.5–14 / 400–500
  - Caption / meta: 11–12 / 500–600
  - Tab label: 10 / 600
  - Eyebrow/uppercase label: 11–12 / 600–700 / +0.3–0.4px, uppercase

### Radii, spacing, shadow
- Radii: cards 15–22px · icon tiles 11–14px · pills/chips 7–9px · full circles for check/avatars ·
  app screen container 44px (device corner) .
- Screen horizontal padding: **20px**. Content bottom padding: **108px** (clears tab bar).
- Card inner padding: 13–20px. Gaps between cards: 10–13px.
- Card border: `1px solid var(--sep)`. Identity hero shadow: `0 14px 30px var(--accentSoft)`.
- Tab bar: top border `1px solid var(--sep)`, padding `9px 8px 26px` (last value = home-indicator inset).

---

## Motion & Animation System (REQUIRED — see PRD §"Motion" for full spec)
Use **Framer Motion springs**, not linear/ease. Animate **transform & opacity only** (60fps budget,
≤16ms/frame). Honor `prefers-reduced-motion` (reduce distance/duration, keep opacity feedback).

### Spring presets (Framer Motion)
```js
export const springs = {
  snappy: { type:"spring", stiffness:400, damping:28, mass:1 },   // cards, sheets
  smooth: { type:"spring", stiffness:280, damping:32, mass:1 },   // modals
  bouncy: { type:"spring", stiffness:500, damping:20, mass:1 },   // habit check-in
  gentle: { type:"spring", stiffness:200, damping:30, mass:1 },   // dashboard stagger
  firm:   { type:"spring", stiffness:350, damping:40, mass:1 },
  roll:   { type:"spring", stiffness:300, damping:26, mass:1 },   // streak number
  nav:    { type:"spring", stiffness:380, damping:36, mass:1 },   // push/pop
};
```
Prototype CSS equivalents: spring/overshoot = `cubic-bezier(0.34,1.56,0.64,1)`;
standard ease-out = `cubic-bezier(0.25,0.46,0.45,0.94)`.
Durations: micro 120–180ms · component 280–350ms · screen 350–420ms · celebration 500–800ms (hard cap 800ms).

### Per-interaction motion (as built in the prototype)
- **Dashboard entrance** — staggered cards, `translateY(22px)→0` + `opacity 0→1`, ~60ms delay per card index, `gentle` spring (`fyCardIn`).
- **Screen transition** — `translateX(10px)→0` + slight scale + fade, ~420ms (`fyScreen`).
- **Habit check-in** — press: card `scale(0.97)`; on complete: check circle `scale(0)→1.18→1` pop (`fyPop`), checkmark SVG **stroke-dashoffset draw** ~340ms (`fyDraw`), streak number `translateY(11px)→0` spring roll keyed on value (`fyRoll`).
- **Streak milestone** (7/30/100) — canvas **confetti burst** (~90 particles, gravity sim, accent palette) + intended haptic "heavy". Implemented in `burstConfetti()`.
- **Tab switch** — active icon `scale(1)→1.24→1` bounce (`fyTabPop`); icon fills with accent + label colors to accent.
- **Progress bars / activity bar / macro bars** — `scaleX(0)→1`, transform-origin left, spring (`fyBar`).
- **Donut (budget) & rings (nutrition)** — segments draw via **stroke-dashoffset** animation, staggered ~80–90ms per segment (`fyDraw`).
- **Compound chart line** — path draws via stroke-dashoffset, ~1100ms ease-out.
- **Empty/insight cards** — subtle breathing `scale(1↔1.035)` + opacity, 3–4s loop (`fyBreathe`).
- **Button press (global)** — `scale(0.95–0.97)` on `:active`, spring back.

---

## Screens / Views

### 1. Dashboard (Beranda)
- **Header**: date ("Jumat, 19 Juni"), greeting ("Selamat pagi, Arya"), 44px circular avatar (accentSoft bg, accent initial).
- **Identity hero**: accent gradient card, eyebrow "IDENTITY HARI INI", identity statement, 3 stats row (Kebiasaan `done/total`, Streak terbaik `47`, Goal utama `68%`) with vertical dividers. Radius 24, padding 20.
- **"Never miss twice" alert**: surface card with warn border; orange triangle-alert icon tile; title "Jangan lewat dua kali" + recovery copy. Shown when a habit was missed the prior day.
- **"Kebiasaan hari ini"**: section header + "Semua" link → Habits. List of habit check-in rows (see Habit row spec).
- **"Sistem kamu" module grid** (2-col): Goals (68%, 3 identity aktif), Budget (Rp 6,5jt sisa), Projects (7 tugas), Deep Work (3,5j) — each a tappable card with icon tile + big stat; plus a full-width Nutrisi card (1.680/2.200 kkal · kurang 25g protein). Each deep-links to its screen.

### 2. Habit Tracker (Kebiasaan)
- Title + subtitle ("{done} dari {total} selesai · konsistensi 92%").
- **Habit cards** (one per habit): icon tile (soft bg + colored line icon) · name · implementation
  intention ("Setelah [trigger], [action] pukul [time] di [place]") · right-side **check control**
  (empty 2px ring → filled accent circle with drawn checkmark). Footer row: flame + streak "N hari"
  + "2-menit: [two-minute version]". Whole upper row is the tap target for check-in.
- **Habit Stacking**: a vertical chain card linking the morning routine (Kopi Pagi → Journaling →
  Meditasi → Baca Buku) with connector lines and times.
- **Habit Loop · Baca Buku**: 2×2 grid of Cue / Craving / Response / Reward chips (color-coded:
  blue / orange / green / pink).
- Seed habits (id · name · color · streak · done · twoMin · milestone):
  `olahraga` Olahraga Pagi #34C759 12 ✓ · `air` Minum Air 2L #5AC8FA 23 ✓ · `journal` Journaling
  #5E5CE6 8 · `meditasi` Meditasi #FF9F0A 6 (milestone 7) · `baca` Baca Buku #0A84FF 47.

### 3. Goals (identity-based)
- Title + subtitle ("Identity-based · progress dari kebiasaan, bukan deadline").
- **Compounding chart card**: "Efek 1% setiap hari", "1.01³⁶⁵ = 37,8× lebih baik", "365 hari" badge.
  SVG: dashed linear baseline + accent exponential curve (1.01^day) with soft area fill; x-axis
  labels Hari 1 / 90 / 365. Curve = `y = H - (1.01^i − 1)/(1.01^N − 1)·H`.
- **Goal cards**: eyebrow "Saya adalah orang yang", identity title, "{n} kebiasaan terkait" + big
  percent, then a spring-fill progress bar. Seeds: "sehat & bugar" 68% green · "seorang penulis" 54%
  indigo · "melek finansial" 41% orange. **Progress is computed from linked-habit completion, not deadlines.**

### 4. Budget (Uang)
- Title + month ("Juni 2026").
- **Summary card**: SVG **donut** of spending by category (rotated arcs, drawn) + total "Rp 5,49jt",
  "dari Rp 12jt pemasukan", "Sisa Rp 6,51jt" (green).
- **Category rows**: color dot · name · spent/limit · progress bar. Bar turns **orange at ≥80%**
  ("80% — mendekati batas") and **red at ≥100%** ("100% — budget tercapai").
  Seeds (spent/limit): Makanan 1.85/2.5jt · Transport 620/800rb · Hiburan 540/600rb (90% → orange) ·
  Investasi 2.0/2.0jt (100% → red) · Kesehatan 180/500rb · Lainnya 300/500rb.
- Categories: Makanan, Transport, Hiburan, Investasi, Kesehatan, Lainnya. Currency: Rupiah.

### 5. Activity Labeling (Aktivitas — under Lainnya)
- Back button + title + "Alokasi waktu · hari ini".
- **Stacked horizontal timeline bar** of today's labels (proportional widths, spring scaleX).
- **Legend rows**: color dot · label · hours. Seeds (hours): Shallow Work 4 (orange) · Deep Work 3,5
  (violet) · Rest 2 (teal) · Learning 1,5 (green) · Social 1,5 (pink) · Health 1 (indigo).
- **Insight card** (accentSoft, breathing): "Kamu habiskan 40% hari untuk Shallow Work. Goal
  'penulis' butuh lebih banyak Deep Work…". Labels set: Deep Work, Shallow Work, Rest, Social, Health, Learning.

### 6. Nutrisi & Food Log (under Lainnya)
- Back + title.
- **Calorie ring card**: accent ring (drawn) + "1.680 / 2.200 kkal · sisa 520".
- **Macro card**: Protein 95/120g, Karbohidrat 180/250g, Lemak 52/70g, Serat 18/30g — each a
  labeled spring-fill bar (pink/orange/teal/green) + gap note "Gap: kurang 25g protein hari ini".
- **Food log**: rows of name · portion + protein · label chip (Sehat/Moderat/Indulge) · kcal.
  Seeds: Nasi Putih (Moderat 175) · Tempe Goreng (Sehat 160) · Ayam Bakar (Sehat 220) · Sayur Bayam
  (Sehat 50) · Es Teh Manis (Indulge 90). DB is **Indonesia-first**; nutrients tracked: kalori,
  protein, karbo, lemak, serat.

### 7. Projects (lite — under Lainnya)
- Back + title.
- **Project cards**: name + linked-goal chip (accent); task rows = status dot · task name
  (strikethrough when done) · status chip (backlog/in-progress/done). Seeds: "Redesign Portfolio"
  (→penulis), "Launch Newsletter" (→penulis), "Dana Darurat 6×" (→finansial). Hierarchy Project →
  Task → Subtask; every task can link to a Goal.

---

## State Management (suggested Zustand stores)
- **uiStore**: `theme` ('dark'|'light', default per system), `accent` ('violet'|'green'|'blue'|'orange'),
  `activeTab`, `subScreen`.
- **habitStore**: habits[] (`id, name, color, icon, intention{trigger,action,time,place}, twoMin,
  streak, lastCompletedDate, doneToday, milestone, goalIds[]`), `toggleHabit(id)` (optimistic;
  streak ±1; fire confetti + haptic when new streak hits a milestone; "never miss twice" when a habit
  has one missed day), daily reset at local midnight.
- **goalStore**: goals[] (`id, identityStatement, color, icon, habitIds[], milestones[]`); progress =
  completion rate of linked habits.
- **projectStore / budgetStore / activityStore / nutritionStore**: as per seeds above.
- Persist locally (offline-first / PWA); sync when online with optimistic updates + rollback.

UX rules from PRD (do not violate): single-hand operable (primary actions in bottom 60%); daily
check-in < 2 min total; zero empty screens (every empty state has a CTA + breathing animation);
never block on loading (optimistic UI); offline-first; minimal input (smart defaults, history
suggestions); haptics on critical actions; dark mode from day one.

---

## Assets
- **No raster assets / no external image files.** All iconography is inline stroke SVG (24×24,
  `stroke-linecap/linejoin: round`, ~1.8–2.2px stroke). Replace with your icon library (SF Symbols on
  native; e.g. lucide-react / Heroicons on web) — keep the same glyphs: home, check-in-seal (check in
  circle), target (concentric circles), wallet, grid (more), flame (streak), chevron-left (back),
  triangle-alert, clock, heart, dumbbell, droplet, pencil, leaf, book, info.
- Fonts: system font stack (SF Pro). No web-font files needed for Apple targets.

## Files in this bundle
- `design/Fayolla.dc.html` — the full hifi prototype (all 7 screens, theming, motion). Open in a browser.
- `design/PRD.md` — the product requirements doc (philosophy, full feature specs, full motion system, MVP vs phases).

## Build order (from PRD MVP scope)
**MVP v1.0**: Auth (Google OAuth) · Habit Tracker (check-in, streak, basic stacking) · Goals
(identity-based, linked to habits) · Daily Dashboard · core motion (check-in bounce, screen
transition, stagger) · basic PWA.
**Phase 2**: Projects · Budget · Activity Labeling · advanced celebrations (confetti, milestone) ·
gesture-driven animations.
**Phase 3**: Nutrition & Food Log (needs Indonesian food DB) · AI insights · custom haptics · widgets.
