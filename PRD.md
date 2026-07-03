Kamu adalah senior product manager berpengalaman dalam consumer apps dan behavior design,
dengan pemahaman mendalam tentang Apple Human Interface Guidelines dan motion design.

Saya akan membuat aplikasi web mobile-first bernama [NAMA APP] yang terinspirasi dari 
buku Atomic Habits oleh James Clear.

---

## Konteks & Filosofi Produk

App ini bukan sekadar task manager. Filosofi inti:
- Fokus pada SISTEM, bukan tujuan semata (goals are outcomes, systems create them)
- Identity-based approach: bantu user jadi "orang yang X", bukan hanya "capai X"
- Habit Loop: setiap fitur harus mendukung cue → craving → response → reward
- 1% improvement compounding: visualisasi pertumbuhan marginal, bukan binary done/not-done
- Reduce friction: UI harus semudah mungkin, terutama untuk input harian

---

## Target User

Saya sendiri — professional usia produktif, mobile-first, butuh tools terintegrasi 
dalam satu app daripada banyak app terpisah.

---

## Scope Fitur

App ini mencakup 6 modul utama:

### 1. GOALS (Setup & Tracking)
- Buat goal berbasis identity ("Saya adalah orang yang...") bukan outcome
- Breakdown goal → milestone → habits harian
- Progress bar berbasis habit completion, bukan deadline
- Visualisasi trajectory 1% compounding

### 2. HABIT TRACKER
- Setup habit dengan implementation intention: 
  "After [trigger], I will [action] at [time] in [place]"
- Habit stacking: chain habits secara visual
- Two-minute version wajib diisi (minimum viable habit)
- Streak tracking dengan "never miss twice" alert
- Visual habit loop: cue → craving → response → reward per habit
- Daily check-in UI: mobile-friendly, <30 detik per habit

### 3. PROJECT MANAGEMENT (Lite)
- Project → task → subtask
- Label/tag per task (lihat modul labeling)
- Status: backlog / in-progress / done
- Koneksi ke Goal: task bisa dihubungkan ke goal mana

### 4. BUDGETING
- Input pemasukan & pengeluaran harian
- Kategori pengeluaran (makanan, transport, hiburan, investasi, dll)
- Budget per kategori per bulan
- Summary harian/mingguan/bulanan
- Alert jika mendekati batas budget

### 5. ACTIVITY LABELING
- Label setiap kegiatan harian dengan kategori
  (Deep Work, Shallow Work, Rest, Social, Health, Learning, dll)
- Time tracking per label
- Laporan: berapa jam/hari dihabiskan untuk kategori apa
- Insight: apakah alokasi waktu sesuai identity & goal?

### 6. NUTRISI & FOOD LOGGING (NutriPlan-style)
- Log makanan harian
- Identifikasi nutrisi: kalori, protein, karbo, lemak, serat
- Database makanan Indonesia (nasi, tempe, ayam, dll) sebagai prioritas
- Target nutrisi harian
- Summary harian dengan gap analisis
- Label makanan: Sehat / Moderat / Indulge

---

## Motion & Animation System (Apple-inspired Fluid Motion)

Ini adalah fitur WAJIB, bukan opsional. Seluruh app harus terasa "alive" seperti iOS/macOS.
Semua spec ini masuk ke PRD sebagai requirements, bukan nice-to-have.

### Filosofi Motion

Motion berfungsi sebagai:
1. **Feedback** — konfirmasi bahwa action user berhasil (bukan hanya warna berubah)
2. **Orientation** — bantu user tahu "saya di mana" dalam navigasi
3. **Reward** — micro-animation saat habit complete = dopamine trigger (sesuai Law 4 Atomic Habits: Make It Satisfying)
4. **Continuity** — element bergerak dengan rasa fisika nyata, bukan teleport

### Spring Physics (core teknologi animasi)

Semua animasi transisi WAJIB pakai spring physics, bukan linear/ease-in-out biasa.
Referensi parameter (CSS/JS implementation via Framer Motion atau CSS spring):

| Use Case | Response | Damping | Feel |
|---|---|---|---|
| Card expand / sheet open | 0.28–0.35 | 0.75–0.82 | Snappy, settled |
| Modal overlay | 0.40 | 0.85 | Smooth, firm |
| Habit check-in bounce | 0.20 | 0.55 | Bouncy, celebratory |
| Number counter / streak | 0.30 | 0.70 | Natural roll |
| Navigation slide | 0.35 | 0.90 | Fast, no overshoot |
| Swipe dismiss | 0.25 | 0.65 | Follows finger, settles |

Implementasi web: `Framer Motion` (`spring({ stiffness, damping, mass })`), 
atau CSS `transition` + `cubic-bezier` untuk fallback.

### Easing Curves Reference

- **Standard transition:** `cubic-bezier(0.25, 0.46, 0.45, 0.94)` — Apple ease-out
- **Enter screen:** `cubic-bezier(0.0, 0.0, 0.2, 1)` — material decelerate
- **Exit screen:** `cubic-bezier(0.4, 0.0, 1, 1)` — material accelerate
- **Spring settle:** gunakan Framer Motion `spring` daripada cubic-bezier

### Duration Guidelines

| Animasi | Duration |
|---|---|
| Micro-interaction (tap, toggle) | 150–200ms |
| Component transition (card, sheet) | 280–350ms |
| Screen transition | 350–450ms |
| Celebration / reward animation | 500–800ms |
| Tidak ada animasi >800ms kecuali onboarding |

### Specific Motion Requirements per Modul

**Habit Tracker — Check-in:**
- Tap habit card → spring scale down (0.95) → release → spring bounce back (1.02 overshoot → 1.0)
- Checkmark draw: SVG stroke-dashoffset animation, 300ms, ease-out
- Completion: card slides right dengan fade, streak counter increments dengan spring roll
- Streak milestone (7/30/100 hari): confetti burst + haptic pattern (mobile)

**Goal Progress:**
- Progress bar fill: spring physics, bukan linear fill
- 1% gain visualization: number counter animates dengan spring bounce
- Milestone reached: card scales up (1.05) dengan glow pulse, kemudian settles

**Navigation / Screen Transitions:**
- Push forward: new screen slides in dari kanan (translateX: 100%→0), 
  current slides ke kiri (0→-30%) dengan scale sedikit (1→0.96) — persis iOS push
- Pop back: reverse, dengan gesture-driven drag support
- Bottom sheet open: slides up dari bawah dengan spring, backdrop fades in bersamaan
- Tab switch: active tab icon scales up (1.0→1.2→1.0) dengan spring bounce

**Dashboard Daily View:**
- App launch: staggered entrance — cards masuk satu per satu dengan 60ms delay tiap card
- Pull to refresh: custom spring rubber-band effect
- Scroll: parallax subtle pada hero section (0.3x scroll speed)

**Budget & Nutrition Input:**
- Number input: digits animate in dengan spring dari bawah (slot machine style)
- Category select: pill button scales + color fills dengan spring
- Summary donut chart: segments fill dengan spring physics, bukan CSS transition

**Micro-interactions:**
- Button press: scale 0.97 on press, 1.0 on release — semua button
- Toggle switch: thumb slides dengan spring (overshoot sedikit di destination)
- Swipe actions: rubber-band physics saat swipe melebihi threshold
- Empty state: subtle breathing animation (scale 1.0↔1.03, 3s loop, ease-in-out)

### Reduced Motion Support (WAJIB)

- Detect `prefers-reduced-motion: reduce` via CSS media query
- Fallback: ganti spring animation dengan instant atau opacity fade <200ms
- Jangan matikan semua animasi — kurangi jarak & durasi, pertahankan feedback

### Motion Token System

PRD harus include motion token yang bisa di-implement sebagai CSS variables:

```css
--motion-spring-snappy: spring(stiffness: 400, damping: 28);
--motion-spring-smooth: spring(stiffness: 280, damping: 32);
--motion-spring-bouncy: spring(stiffness: 500, damping: 20);
--motion-duration-micro: 150ms;
--motion-duration-component: 320ms;
--motion-duration-screen: 400ms;
--motion-easing-standard: cubic-bezier(0.25, 0.46, 0.45, 0.94);
--motion-easing-enter: cubic-bezier(0.0, 0.0, 0.2, 1);
--motion-easing-exit: cubic-bezier(0.4, 0.0, 1, 1);
```

---

## UX Principles

- Mobile-first, single-hand operable
- Daily dashboard: semua modul visible dalam satu layar
- Friction minimal: input harian harus bisa selesai <2 menit total
- Satisfying micro-interactions = Law 4 Atomic Habits (Make It Satisfying)
- Motion IS the product experience, bukan dekorasi
- Warna & visual: clean, calm, tidak overwhelming

---

## Tech Stack (untuk dipertimbangkan PRD)

- Frontend: React (web app, mobile browser) + **Framer Motion** untuk spring animations
- Backend: fleksibel (Node/Python)
- DB: fleksibel
- Auth: simple (email atau Google OAuth)
- Offline-capable: PWA preferred
- Animation lib priority: Framer Motion > React Spring > CSS custom properties

---

## Output yang Dibutuhkan

Buat PRD lengkap mencakup:
1. Executive Summary
2. Problem Statement
3. User Persona
4. Goals & Success Metrics
5. Feature Specifications per modul (user stories + acceptance criteria)
6. **Motion & Animation System** (dedicated section — bukan appendix)
7. Information Architecture
8. UX Flow per modul (dengan annotasi motion di setiap transisi)
9. Technical Requirements (termasuk animation performance budget: max 16ms/frame, 60fps)
10. MVP Scope vs Phase 2
    - MVP: fitur core + micro-interactions wajib
    - Phase 2: advanced celebrations, gesture-driven animations, haptics
11. Open Questions

Format: structured markdown, siap dijadikan dokumen kerja.
Untuk setiap user story yang melibatkan motion, tambahkan acceptance criteria:
"Animation: [pilih desain yang paling fluid, halus, dan proper]"