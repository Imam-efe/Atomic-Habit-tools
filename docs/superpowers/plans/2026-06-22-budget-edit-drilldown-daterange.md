# Budget Edit, Drill-Down & Date Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three features to the Budget module: (1) view/edit any transaction via bottom sheet, (2) tap a budget category to see all its transactions in a fullscreen modal, (3) date range filter with presets replacing the fixed month in Budget and FinancialReport.

**Architecture:** One new backend endpoint (`PUT /api/budget/:id`) plus two existing GET endpoints updated to accept `from`/`to` date params (backward-compatible). All three features live inside existing screen files — no new files. State is local to each screen.

**Tech Stack:** Hono + Cloudflare Workers + D1, React + TypeScript + Framer Motion + Tailwind

---

## File Map

| Action | Path |
|---|---|
| Modify | `backend/src/routes/budget.ts` — add PUT /:id, update GET / to accept from/to |
| Modify | `backend/src/routes/finance_report.ts` — accept from/to params |
| Modify | `frontend/src/screens/Budget.tsx` — date range state, bottom sheet, category modal |
| Modify | `frontend/src/screens/FinancialReport.tsx` — date range chips |

---

## Task 1: Backend — PUT /api/budget/:id

**Files:**
- Modify: `backend/src/routes/budget.ts`

- [ ] **Step 1: Add PUT /api/budget/:id route**

Add this route before `export default budget;` in `backend/src/routes/budget.ts`:

```typescript
// PUT /api/budget/:id — edit a transaction
budget.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = { type?: string; amount?: number; category?: string; note?: string; date?: string; bank_account_id?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, {
    type:     { type: 'enum', values: ['income', 'expense'] },
    amount:   { type: 'number', min: 1 },
    category: { type: 'string' },
  });
  if (err) return c.json({ error: err }, 400);

  // Fetch existing to reverse bank balance
  const existing = await c.env.DB.prepare(
    'SELECT * FROM budget_entries WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user.sub).first<BudgetEntryRow>();
  if (!existing) return c.json({ error: 'entry not found' }, 404);

  const newAmount = Math.round(body.amount!);
  const newType = body.type!;
  const entryDate = body.date ?? existing.entry_date;
  // If bank_account_id key is present in body, use it (even if empty string → null); else keep existing
  const bankAccountId = 'bank_account_id' in body
    ? (body.bank_account_id || null)
    : existing.bank_account_id;

  // Reverse old bank adjustment
  if (existing.bank_account_id) {
    const reverseSign = existing.type === 'expense' ? 1 : -1;
    await c.env.DB.prepare(
      'UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3'
    ).bind(reverseSign * existing.amount_idr, existing.bank_account_id, user.sub).run();
  }

  // Apply new bank adjustment
  if (bankAccountId) {
    const sign = newType === 'expense' ? -1 : 1;
    await c.env.DB.prepare(
      'UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3'
    ).bind(sign * newAmount, bankAccountId, user.sub).run();
  }

  await c.env.DB.prepare(
    `UPDATE budget_entries
     SET type = ?1, amount_idr = ?2, category = ?3, note = ?4, entry_date = ?5, bank_account_id = ?6
     WHERE id = ?7 AND user_id = ?8`
  ).bind(newType, newAmount, body.category, body.note ?? null, entryDate, bankAccountId, id, user.sub).run();

  return c.json({ id, type: newType, amount: newAmount, category: body.category, note: body.note ?? null, date: entryDate, bank_account_id: bankAccountId });
});
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd "D:\AI Model\Atomic Habit tools\backend"
npx tsc --noEmit
```

Expected: no new errors in `budget.ts`.

---

## Task 2: Backend — Date Range Params for GET /api/budget

**Files:**
- Modify: `backend/src/routes/budget.ts`

- [ ] **Step 1: Update GET /api/budget to accept from/to**

Find in `backend/src/routes/budget.ts`:
```typescript
// GET /api/budget?month=YYYY-MM
budget.get('/', async (c) => {
  const user = c.get('user');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7);

  const rows = await c.env.DB.prepare(
    `SELECT * FROM budget_entries
     WHERE user_id = ?1 AND entry_date >= ?2 AND entry_date <= ?3
     ORDER BY entry_date DESC, created_at DESC`
  ).bind(user.sub, `${month}-01`, `${month}-31`).all<BudgetEntryRow>();
```

Replace with:
```typescript
// GET /api/budget?from=YYYY-MM-DD&to=YYYY-MM-DD  (or legacy ?month=YYYY-MM)
budget.get('/', async (c) => {
  const user = c.get('user');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7);
  const dateFrom = from ?? `${month}-01`;
  const dateTo = to ?? `${month}-31`;

  const rows = await c.env.DB.prepare(
    `SELECT * FROM budget_entries
     WHERE user_id = ?1 AND entry_date >= ?2 AND entry_date <= ?3
     ORDER BY entry_date DESC, created_at DESC`
  ).bind(user.sub, dateFrom, dateTo).all<BudgetEntryRow>();
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd "D:\AI Model\Atomic Habit tools\backend"
npx tsc --noEmit
```

---

## Task 3: Backend — Date Range Params for GET /api/finance-report

**Files:**
- Modify: `backend/src/routes/finance_report.ts`

- [ ] **Step 1: Update finance-report to accept from/to**

Find in `backend/src/routes/finance_report.ts`:
```typescript
// GET /api/finance-report?month=YYYY-MM
financeReport.get('/', async (c) => {
  const user = c.get('user');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7);

  // 1. P&L (Profit and Loss) Calculation for the month
  const pnlRows = await c.env.DB.prepare(
    `SELECT * FROM budget_entries
     WHERE user_id = ?1 AND entry_date >= ?2 AND entry_date <= ?3`
  ).bind(user.sub, `${month}-01`, `${month}-31`).all<BudgetEntryRow>();
```

Replace with:
```typescript
// GET /api/finance-report?from=YYYY-MM-DD&to=YYYY-MM-DD  (or legacy ?month=YYYY-MM)
financeReport.get('/', async (c) => {
  const user = c.get('user');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7);
  const dateFrom = from ?? `${month}-01`;
  const dateTo = to ?? `${month}-31`;

  // 1. P&L Calculation for selected range
  const pnlRows = await c.env.DB.prepare(
    `SELECT * FROM budget_entries
     WHERE user_id = ?1 AND entry_date >= ?2 AND entry_date <= ?3`
  ).bind(user.sub, dateFrom, dateTo).all<BudgetEntryRow>();
```

Also update the `pnl` response object — replace `month` field with range info:

Find:
```typescript
    pnl: {
      month,
```

Replace with:
```typescript
    pnl: {
      month: from ? `${dateFrom} s/d ${dateTo}` : month,
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd "D:\AI Model\Atomic Habit tools\backend"
npx tsc --noEmit
```

---

## Task 4: Frontend — Date Range State & UI in Budget.tsx

**Files:**
- Modify: `frontend/src/screens/Budget.tsx`

- [ ] **Step 1: Add computeRange helper and date range state**

In `Budget.tsx`, find the function body of the `Budget` component (after `function Budget() {` or `export function Budget() {`). Find the existing useState declarations block. 

First, add this helper function BEFORE the component (after the `formatRp` function):

```typescript
type RangePreset = '7d' | '30d' | '3m' | 'custom';

function computeRange(preset: RangePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (preset === '7d') {
    return { from: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), to: today };
  }
  if (preset === '30d') {
    return { from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), to: today };
  }
  if (preset === '3m') {
    return { from: new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10), to: today };
  }
  return { from: customFrom || today, to: customTo || today };
}
```

- [ ] **Step 2: Replace fixed month with date range state**

Find:
```typescript
  const month = new Date().toISOString().slice(0, 7);
```

Replace with:
```typescript
  const [rangePreset, setRangePreset] = useState<RangePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
```

- [ ] **Step 3: Update load() to use from/to params**

Find in the `load` function:
```typescript
        apiFetch<BudgetData>(`/budget?month=${month}`),
```

Replace with:
```typescript
        const { from, to } = computeRange(rangePreset, customFrom, customTo);
        apiFetch<BudgetData>(`/budget?from=${from}&to=${to}`),
```

The limits line stays unchanged — category limits always use current month:
```typescript
        apiFetch<CategoryLimit[]>(`/budget/limits?month=${new Date().toISOString().slice(0, 7)}`)
```

- [ ] **Step 4: Update useEffect dependency**

Find:
```typescript
  useEffect(() => { load(); }, [activeSubTab]);
```

Replace with:
```typescript
  useEffect(() => { load(); }, [activeSubTab, rangePreset, customFrom, customTo]);
```

- [ ] **Step 5: Add date range chip UI**

In the JSX, find the transaction summary card section. It starts around:
```typescript
      {activeSubTab === 'transaksi' && (
        <div className="flex flex-col gap-4">
          {/* Summary card */}
```

Insert the date range chips BEFORE `{/* Summary card */}`:
```typescript
          {/* Date Range Filter */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5">
              {(['7d', '30d', '3m', 'custom'] as RangePreset[]).map(p => (
                <motion.button
                  key={p}
                  className="flex-1 py-1.5 rounded-xl text-[11px] font-bold"
                  style={{
                    background: rangePreset === p ? 'var(--accent)' : 'var(--track)',
                    color: rangePreset === p ? 'white' : 'var(--text2)',
                  }}
                  whileTap={{ scale: 0.95 }}
                  transition={springs.snappy}
                  onClick={() => setRangePreset(p)}
                >
                  {p === '7d' ? '7 Hari' : p === '30d' ? '30 Hari' : p === '3m' ? '3 Bulan' : 'Kustom'}
                </motion.button>
              ))}
            </div>
            {rangePreset === 'custom' && (
              <motion.div
                className="flex gap-2 items-center"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={springs.smooth}
              >
                <input
                  type="date"
                  className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                />
                <span className="text-xs" style={{ color: 'var(--text3)' }}>–</span>
                <input
                  type="date"
                  className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                />
              </motion.div>
            )}
          </div>
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd "D:\AI Model\Atomic Habit tools\frontend"
npx tsc --noEmit
```

---

## Task 5: Frontend — Transaction View/Edit Bottom Sheet

**Files:**
- Modify: `frontend/src/screens/Budget.tsx`

- [ ] **Step 1: Add sheet state variables**

Find the useState block (after `recurrence` state). Add after `const [recurrence, setRecurrence] = useState...`:

```typescript
  // View/Edit sheet state
  const [viewEntry, setViewEntry] = useState<BudgetEntry | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editType, setEditType] = useState<'income' | 'expense'>('expense');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editBankAccountId, setEditBankAccountId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
```

- [ ] **Step 2: Add openSheet and saveEdit functions**

Add these functions in the component body (after `deleteEntry`):

```typescript
  const openSheet = (entry: BudgetEntry) => {
    setViewEntry(entry);
    setEditMode(false);
    setEditType(entry.type);
    setEditAmount(String(entry.amount));
    setEditCategory(entry.category);
    setEditNote(entry.note ?? '');
    setEditDate(entry.date);
    setEditBankAccountId(entry.bank_account_id ?? '');
  };

  const saveEdit = async () => {
    if (!viewEntry) return;
    const amt = parseInt(editAmount.replace(/\D/g, ''));
    if (!amt || amt <= 0) return;
    setSavingEdit(true);
    try {
      await apiFetch(`/budget/${viewEntry.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          type: editType,
          amount: amt,
          category: editCategory,
          note: editNote.trim() || undefined,
          date: editDate,
          bank_account_id: editBankAccountId || undefined,
        }),
      });
      setViewEntry(null);
      setEditMode(false);
      load();
    } catch {}
    setSavingEdit(false);
  };
```

- [ ] **Step 3: Make transaction rows tappable, remove inline delete button**

Find the transaction row JSX. It starts with:
```typescript
                  <motion.div
                    key={entry.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="rounded-[14px] px-4 py-3.5 flex items-center gap-3 relative overflow-hidden"
                    style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
                  >
```

Replace with (add `onClick` and `cursor-pointer`):
```typescript
                  <motion.div
                    key={entry.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="rounded-[14px] px-4 py-3.5 flex items-center gap-3 relative overflow-hidden cursor-pointer"
                    style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
                    onClick={() => openSheet(entry)}
                  >
```

Then find and remove the delete button inside the row:
```typescript
                    <motion.button
                      className="w-6 h-6 flex-shrink-0 flex items-center justify-center"
                      whileTap={{ scale: 0.85 }}
                      onClick={() => deleteEntry(entry.id)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </motion.button>
```

Delete that entire block.

- [ ] **Step 4: Add bottom sheet JSX**

At the end of the component's return JSX, just before the final closing `</div>` of the component wrapper, add:

```typescript
      {/* Transaction View/Edit Bottom Sheet */}
      <AnimatePresence>
        {viewEntry && (
          <>
            <motion.div
              className="fixed inset-0 z-40"
              style={{ background: 'rgba(0,0,0,0.5)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setViewEntry(null); setEditMode(false); }}
            />
            <motion.div
              className="fixed bottom-0 left-0 right-0 z-50 max-w-[430px] mx-auto rounded-t-[24px] p-5 pb-10"
              style={{ background: 'var(--surface)', maxHeight: '88vh', overflowY: 'auto' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={springs.smooth}
            >
              <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: 'var(--sep)' }} />

              {/* Sheet header */}
              <div className="flex justify-between items-center mb-5">
                <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                  style={{
                    background: editMode ? 'rgba(10,132,255,0.15)' : viewEntry.type === 'expense' ? 'rgba(255,69,58,0.15)' : 'rgba(52,199,89,0.15)',
                    color: editMode ? '#0A84FF' : viewEntry.type === 'expense' ? '#FF453A' : '#34C759'
                  }}>
                  {editMode ? '✏️ Edit' : viewEntry.type === 'expense' ? 'Pengeluaran' : 'Pemasukan'}
                </span>
                <div className="flex gap-2 items-center">
                  <button
                    onClick={() => setEditMode(!editMode)}
                    className="text-xs px-3 py-1.5 rounded-xl font-semibold"
                    style={{ background: 'var(--track)', color: 'var(--text2)' }}
                  >
                    {editMode ? 'Batal' : '✏️ Edit'}
                  </button>
                  <button onClick={() => { setViewEntry(null); setEditMode(false); }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text3)' }}>
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>

              {!editMode ? (
                /* View mode */
                <div className="flex flex-col gap-3">
                  <p className="text-3xl font-extrabold" style={{ color: viewEntry.type === 'income' ? '#34C759' : '#FF453A' }}>
                    {viewEntry.type === 'income' ? '+' : '-'}{formatRp(viewEntry.amount)}
                  </p>
                  <div className="flex flex-col gap-2 text-sm">
                    <div className="flex justify-between py-2.5" style={{ borderBottom: '1px solid var(--sep)' }}>
                      <span style={{ color: 'var(--text3)' }}>Kategori</span>
                      <span className="font-semibold" style={{ color: 'var(--text)' }}>{viewEntry.category}</span>
                    </div>
                    <div className="flex justify-between py-2.5" style={{ borderBottom: '1px solid var(--sep)' }}>
                      <span style={{ color: 'var(--text3)' }}>Tanggal</span>
                      <span className="font-semibold" style={{ color: 'var(--text)' }}>{viewEntry.date}</span>
                    </div>
                    {viewEntry.note && (
                      <div className="flex justify-between py-2.5" style={{ borderBottom: '1px solid var(--sep)' }}>
                        <span style={{ color: 'var(--text3)' }}>Catatan</span>
                        <span className="font-semibold text-right max-w-[60%]" style={{ color: 'var(--text)' }}>{viewEntry.note}</span>
                      </div>
                    )}
                    {viewEntry.bank_account_id && (() => {
                      const bank = bankAccounts.find(b => b.id === viewEntry.bank_account_id);
                      return bank ? (
                        <div className="flex justify-between py-2.5" style={{ borderBottom: '1px solid var(--sep)' }}>
                          <span style={{ color: 'var(--text3)' }}>Bank / Dompet</span>
                          <span className="font-semibold" style={{ color: 'var(--text)' }}>🏦 {bank.name}</span>
                        </div>
                      ) : null;
                    })()}
                    {viewEntry.recurrence && (
                      <div className="flex justify-between py-2.5" style={{ borderBottom: '1px solid var(--sep)' }}>
                        <span style={{ color: 'var(--text3)' }}>Pengulangan</span>
                        <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                          🔁 {viewEntry.recurrence === 'daily' ? 'Setiap hari' : viewEntry.recurrence === 'weekly' ? 'Setiap minggu' : 'Setiap bulan'}
                        </span>
                      </div>
                    )}
                    {viewEntry.receipt_img && (
                      <div className="mt-2">
                        <p className="text-xs mb-2" style={{ color: 'var(--text3)' }}>Foto Struk</p>
                        <img src={viewEntry.receipt_img} className="w-full rounded-xl object-cover max-h-48" />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Edit mode */
                <div className="flex flex-col gap-2.5">
                  <div className="flex gap-2 mb-1">
                    {(['expense', 'income'] as const).map(t => (
                      <motion.button
                        key={t}
                        className="flex-1 py-2 rounded-xl text-sm font-semibold"
                        style={{
                          background: editType === t ? (t === 'expense' ? '#FF453A' : '#34C759') : 'var(--track)',
                          color: editType === t ? 'white' : 'var(--text2)',
                        }}
                        whileTap={{ scale: 0.97 }}
                        transition={springs.snappy}
                        onClick={() => { setEditType(t); setEditCategory(t === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]); }}
                      >
                        {t === 'expense' ? 'Pengeluaran' : 'Pemasukan'}
                      </motion.button>
                    ))}
                  </div>
                  <input
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                    placeholder="Jumlah (Rp)"
                    value={editAmount}
                    onChange={e => setEditAmount(e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                      value={editCategory}
                      onChange={e => setEditCategory(e.target.value)}
                    >
                      {(editType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <input
                      type="date"
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                      value={editDate}
                      onChange={e => setEditDate(e.target.value)}
                    />
                  </div>
                  <select
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                    value={editBankAccountId}
                    onChange={e => setEditBankAccountId(e.target.value)}
                  >
                    <option value="">Cash/Tunai (Tanpa Bank)</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.account_type})</option>
                    ))}
                  </select>
                  <input
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                    placeholder="Catatan (opsional)"
                    value={editNote}
                    onChange={e => setEditNote(e.target.value)}
                  />
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-5">
                {editMode && (
                  <motion.button
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                    style={{ background: 'var(--accent)', opacity: savingEdit ? 0.6 : 1 }}
                    whileTap={{ scale: 0.97 }}
                    transition={springs.snappy}
                    onClick={saveEdit}
                    disabled={savingEdit}
                  >
                    {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                  </motion.button>
                )}
                <motion.button
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: 'rgba(255,69,58,0.12)', color: '#FF453A' }}
                  whileTap={{ scale: 0.97 }}
                  transition={springs.snappy}
                  onClick={() => { deleteEntry(viewEntry!.id); setViewEntry(null); setEditMode(false); }}
                >
                  🗑️ Hapus
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd "D:\AI Model\Atomic Habit tools\frontend"
npx tsc --noEmit
```

---

## Task 6: Frontend — Category Drill-Down Fullscreen Modal

**Files:**
- Modify: `frontend/src/screens/Budget.tsx`

- [ ] **Step 1: Add drillCategory state**

Add after the `viewEntry` state block:
```typescript
  const [drillCategory, setDrillCategory] = useState<string | null>(null);
```

- [ ] **Step 2: Make category cards tappable**

Find the category card wrapper in the budgeting tab:
```typescript
                <div
                  key={cat.category}
                  className="rounded-[16px] p-4 flex flex-col gap-2.5"
                  style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
                >
```

Replace with:
```typescript
                <div
                  key={cat.category}
                  className="rounded-[16px] p-4 flex flex-col gap-2.5 cursor-pointer active:opacity-80"
                  style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
                  onClick={() => setDrillCategory(cat.category)}
                >
```

- [ ] **Step 3: Add drill-down fullscreen modal JSX**

Add AFTER the bottom sheet JSX (before the final closing `</div>`):

```typescript
      {/* Category Drill-Down Fullscreen Modal */}
      <AnimatePresence>
        {drillCategory && (() => {
          const drillEntries = data?.entries.filter(e => e.category === drillCategory) ?? [];
          const catLimit = categoryLimits.find(c => c.category === drillCategory);
          const totalSpent = drillEntries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
          const totalIncome = drillEntries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);

          // Group by date, newest first
          const grouped = drillEntries.reduce<Record<string, BudgetEntry[]>>((acc, e) => {
            if (!acc[e.date]) acc[e.date] = [];
            acc[e.date].push(e);
            return acc;
          }, {});
          const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

          return (
            <motion.div
              className="fixed inset-0 z-50 max-w-[430px] mx-auto flex flex-col"
              style={{ background: 'var(--bg)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={springs.smooth}
            >
              {/* Header */}
              <div className="flex items-center gap-3 px-5 pt-6 pb-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--sep)' }}>
                <button onClick={() => setDrillCategory(null)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--text)' }}>
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <div className="flex-1">
                  <p className="font-bold text-base" style={{ color: 'var(--text)' }}>{drillCategory}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text3)' }}>{drillEntries.length} transaksi</p>
                </div>
              </div>

              {/* Summary bar */}
              <div className="flex gap-3 px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--sep)' }}>
                {totalSpent > 0 && (
                  <div className="flex-1 rounded-xl p-3" style={{ background: 'rgba(255,69,58,0.08)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Total Keluar</p>
                    <p className="text-base font-extrabold text-red-400">{formatRp(totalSpent)}</p>
                  </div>
                )}
                {totalIncome > 0 && (
                  <div className="flex-1 rounded-xl p-3" style={{ background: 'rgba(52,199,89,0.08)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Total Masuk</p>
                    <p className="text-base font-extrabold text-green-400">{formatRp(totalIncome)}</p>
                  </div>
                )}
                {catLimit && catLimit.limit > 0 && (
                  <div className="flex-1 rounded-xl p-3" style={{ background: 'var(--surface)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Sisa Limit</p>
                    <p className="text-base font-extrabold" style={{ color: catLimit.remaining <= 0 ? '#FF453A' : '#34C759' }}>
                      {formatRp(catLimit.remaining)}
                    </p>
                  </div>
                )}
              </div>

              {/* Transaction list grouped by date */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {drillEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-2">
                    <p className="text-3xl">📭</p>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text2)' }}>Tidak ada transaksi</p>
                    <p className="text-xs" style={{ color: 'var(--text3)' }}>Dalam rentang tanggal yang dipilih</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    {sortedDates.map(date => (
                      <div key={date}>
                        <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text3)' }}>
                          {new Date(date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </p>
                        <div className="flex flex-col gap-2">
                          {grouped[date].map(entry => (
                            <div
                              key={entry.id}
                              className="rounded-[14px] px-4 py-3 flex items-center gap-3 cursor-pointer"
                              style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
                              onClick={() => { setDrillCategory(null); setTimeout(() => openSheet(entry), 300); }}
                            >
                              <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-sm"
                                style={{ background: entry.type === 'income' ? 'rgba(52,199,89,0.15)' : 'rgba(255,69,58,0.12)' }}>
                                {entry.type === 'income' ? '📈' : '📉'}
                              </div>
                              <div className="flex-1 min-w-0">
                                {entry.note && <p className="text-xs truncate" style={{ color: 'var(--text3)' }}>{entry.note}</p>}
                              </div>
                              <p className="text-sm font-bold flex-shrink-0"
                                style={{ color: entry.type === 'income' ? '#34C759' : '#FF453A' }}>
                                {entry.type === 'income' ? '+' : '-'}{formatRp(entry.amount)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd "D:\AI Model\Atomic Habit tools\frontend"
npx tsc --noEmit
```

Expected: zero errors.

---

## Task 7: Frontend — Date Range in FinancialReport.tsx

**Files:**
- Modify: `frontend/src/screens/FinancialReport.tsx`

- [ ] **Step 1: Add RangePreset type and computeRange helper**

At the top of `FinancialReport.tsx`, after the interface definitions, add before `export function FinancialReport()`:

```typescript
type RangePreset = '7d' | '30d' | '3m' | 'custom';

function computeRange(preset: RangePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (preset === '7d') return { from: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), to: today };
  if (preset === '30d') return { from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), to: today };
  if (preset === '3m') return { from: new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10), to: today };
  return { from: customFrom || today, to: customTo || today };
}
```

- [ ] **Step 2: Replace month state with range state**

Find:
```typescript
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
```

Replace with:
```typescript
  const [rangePreset, setRangePreset] = useState<RangePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
```

- [ ] **Step 3: Update loadReport to use from/to**

Find in `loadReport`:
```typescript
      apiFetch<ReportData>(`/finance-report?month=${month}`),
```

Replace with:
```typescript
      const { from, to } = computeRange(rangePreset, customFrom, customTo);
      apiFetch<ReportData>(`/finance-report?from=${from}&to=${to}`),
```

- [ ] **Step 4: Update useEffect dependency**

Find:
```typescript
  useEffect(() => { loadReport(); }, [month]);
```

Replace with:
```typescript
  useEffect(() => { loadReport(); }, [rangePreset, customFrom, customTo]);
```

- [ ] **Step 5: Replace month input with range chips UI**

Find the month input in the JSX. Look for something like:
```typescript
      <input
        type="month"
        value={month}
        onChange={e => setMonth(e.target.value)}
```
or a similar month picker. Replace it with:

```typescript
      {/* Date Range Filter */}
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex gap-1.5">
          {(['7d', '30d', '3m', 'custom'] as RangePreset[]).map(p => (
            <motion.button
              key={p}
              className="flex-1 py-1.5 rounded-xl text-[11px] font-bold"
              style={{
                background: rangePreset === p ? 'var(--accent)' : 'var(--track)',
                color: rangePreset === p ? 'white' : 'var(--text2)',
              }}
              whileTap={{ scale: 0.95 }}
              transition={springs.snappy}
              onClick={() => setRangePreset(p)}
            >
              {p === '7d' ? '7 Hari' : p === '30d' ? '30 Hari' : p === '3m' ? '3 Bulan' : 'Kustom'}
            </motion.button>
          ))}
        </div>
        {rangePreset === 'custom' && (
          <div className="flex gap-2 items-center">
            <input
              type="date"
              className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
            />
            <span className="text-xs" style={{ color: 'var(--text3)' }}>–</span>
            <input
              type="date"
              className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
            />
          </div>
        )}
      </div>
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd "D:\AI Model\Atomic Habit tools\frontend"
npx tsc --noEmit
```

Expected: zero errors.

---

## Task 8: Deploy

- [ ] **Step 1: Deploy backend**

```bash
cd "D:\AI Model\Atomic Habit tools\backend"
npx wrangler deploy
```

Expected: `Deployed fayolla-api triggers` with new version ID.

- [ ] **Step 2: Build frontend**

```bash
cd "D:\AI Model\Atomic Habit tools\frontend"
npm run build
```

Expected: `✓ built in X.XXs`

- [ ] **Step 3: Deploy frontend**

```bash
cd "D:\AI Model\Atomic Habit tools\frontend"
npx wrangler pages deploy dist --project-name=fayolla
```

Expected: `✨ Deployment complete!`

---

## Self-Review

**Spec coverage:**
- ✅ Task 1: PUT /api/budget/:id — edit + bank balance delta
- ✅ Task 2: GET /api/budget from/to params
- ✅ Task 3: GET /api/finance-report from/to params
- ✅ Task 4: Date range chips + custom inputs in Budget.tsx
- ✅ Task 5: Bottom sheet view/edit with all fields, delete moved to sheet
- ✅ Task 6: Category drill-down fullscreen modal, grouped by date
- ✅ Task 7: Date range chips in FinancialReport.tsx
- ✅ Task 8: Deploy

**Type consistency:**
- `RangePreset` defined in Task 4 (Budget) and Task 7 (FinancialReport) — intentionally duplicated since they're in separate files
- `computeRange` same signature in both files ✓
- `openSheet(entry: BudgetEntry)` defined Task 5 step 2, called in Task 6 step 3 ✓
- `drillCategory` defined Task 6 step 1, used in steps 2, 3 ✓

**No placeholders:** all steps have complete code ✓
