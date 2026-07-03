# Budget: Edit Transaksi, Category Drill-Down & Date Range Filter

## Goal

Tiga peningkatan UX pada modul keuangan: (1) setiap transaksi bisa dilihat detail dan diedit via bottom sheet, (2) klik kategori budget membuka fullscreen modal berisi semua transaksi kategori tersebut, (3) filter date range menggantikan month-only picker di Budget dan Finance Report.

## Architecture

Perubahan terbatas pada `frontend/src/screens/Budget.tsx`, `frontend/src/screens/FinancialReport.tsx`, dan satu endpoint backend baru (`PUT /api/budget/:id`). Semua state baru bersifat lokal (tidak perlu store global). Data kategori di-filter client-side — tidak ada endpoint baru untuk drill-down.

---

## Feature 1 — Edit/View Transaksi (Bottom Sheet)

### Backend

**New:** `PUT /api/budget/:id`

```
Body: { type, amount, category, note?, date, bank_account_id? }
Logic:
  1. Fetch existing entry (verify ownership)
  2. Compute amount delta vs old amount_idr
  3. Adjust bank_account balance: reverse old adjustment, apply new
  4. UPDATE budget_entries
Response: updated entry object
```

Validasi pakai `validate()` yang sudah ada: `type` enum, `amount` number min:1, `category` string.

`recurrence` dan `next_recurrence_date` tidak bisa diubah via endpoint ini — field diabaikan jika dikirim.

### Frontend — Bottom Sheet

**State baru di Budget.tsx:**
```typescript
const [viewEntry, setViewEntry] = useState<BudgetEntry | null>(null); // sheet open
const [editMode, setEditMode] = useState(false);
// edit fields reuse existing: type, amount, category, note, date, bankAccountId
```

**Trigger:** tap baris transaksi → `setViewEntry(entry)`.

**Sheet layout (AnimatePresence + motion.div dari y:100% ke y:0):**
- Backdrop semi-transparan, klik backdrop → tutup
- Handle bar di atas
- Header: badge type (Pengeluaran/Pemasukan) + tombol ✏️ toggle edit + tombol × tutup
- **View mode:** amount besar, kategori, tanggal, bank, catatan, thumbnail struk (jika ada)
- **Edit mode:** form identik add form (type toggle, amount input, kategori select, date, bank select, catatan). Tombol Simpan → `PUT /api/budget/:id` → reload data → tutup sheet.

Tombol Hapus tetap ada di sheet (pindah dari row ke sheet untuk mengurangi clutter list).

**Update `BudgetEntry` interface:** sudah include `recurrence?` dari feature sebelumnya, tidak ada tambahan.

---

## Feature 2 — Category Drill-Down (Fullscreen Modal)

### Frontend Only (client-side filter)

**State baru:**
```typescript
const [drillCategory, setDrillCategory] = useState<string | null>(null);
```

**Trigger:** tap card kategori di tab Budgeting → `setDrillCategory(category.category)`.

**Modal layout (AnimatePresence + motion.div fullscreen dari y:100%):**
- Sticky header: nama kategori, tombol × tutup
- Summary bar: `Spent: Rp X` / `Limit: Rp Y` / `Sisa: Rp Z` (warna merah jika over limit)
- List transaksi (dari `data.entries`) difilter `e.category === drillCategory`, digroup per tanggal (newest first)
- Empty state jika tidak ada transaksi di kategori itu dalam range aktif
- Swipe down juga tutup (touchstart/touchend handler lokal di modal)

Data yang ditampilkan mengikuti date range aktif (feature 3) karena `data.entries` sudah hasil fetch dengan range tersebut.

---

## Feature 3 — Date Range Filter

### Backend changes

**`GET /api/budget`** — tambah support param `from` dan `to`:
```
?from=YYYY-MM-DD&to=YYYY-MM-DD  → pakai range ini
?month=YYYY-MM                   → konversi ke from/to (backward compat)
(none)                           → default 30 hari terakhir
```

**`GET /api/finance-report`** — idem, tambah param `from` dan `to`.

### Frontend — Budget.tsx

**State baru:**
```typescript
type RangePreset = '7d' | '30d' | '3m' | 'custom';
const [rangePreset, setRangePreset] = useState<RangePreset>('30d');
const [rangeFrom, setRangeFrom] = useState('');
const [rangeTo, setRangeTo] = useState('');
```

**Helper:** `computeDateRange(preset, from?, to?) → { from: string, to: string }`:
- `7d` → today-6 sampai today
- `30d` → today-29 sampai today
- `3m` → today-89 sampai today
- `custom` → pakai `from`/`to` dari state

**UI (di atas summary card, tab Transaksi):**
```
[7 Hari] [30 Hari] [3 Bulan] [Kustom]
```
Chip aktif highlighted dengan accent color. Kustom → expand 2 `<input type="date">` (Dari – Sampai) dengan tombol Terapkan.

**Load function** diupdate: kirim `?from=&to=` ke API, hapus param `month`.

**Budget limits** (tab Budgeting) tetap pakai `month` current — date range hanya untuk transaksi dan drill-down.

### Frontend — FinancialReport.tsx

Tambah chip preset yang sama di bagian atas. Load function diupdate ke `?from=&to=`. Dashboard tidak berubah (tetap bulan berjalan).

---

## Data Flow

```
User pilih range → computeDateRange() → load() → GET /api/budget?from=&to=
                                                 → setData(entries)
                                                 ↓
User tap kategori → drillCategory = X → filter data.entries client-side → modal
User tap transaksi → viewEntry = entry → bottom sheet
User edit + simpan → PUT /api/budget/:id → load() → tutup sheet
```

---

## Scope & Exclusions

- **Dalam scope:** Budget transaksi (edit, view, delete via sheet), category drill-down, date range di Budget + FinancialReport
- **Luar scope:** Edit recurring template, date range di Dashboard, date range di Debts
- **Tidak ada tabel/migration baru** — semua perubahan di aplikasi layer
