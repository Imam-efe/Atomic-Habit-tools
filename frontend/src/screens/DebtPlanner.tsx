import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface Debt {
  id: string;
  type: string;
  person_name: string;
  amount_idr: number;
  due_date: string | null;
  note: string | null;
  status: string;
}

interface BankAccount {
  id: string;
  name: string;
  account_type: string;
  balance: number;
}

interface PayForm {
  debtId: string;
  personName: string;
  maxAmount: number;
  amountInput: string;
  date: string;
  bankAccountId: string;
  note: string;
}

function formatRp(n: number) {
  return n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}

function jakartaToday() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

function computePayoff(debts: Debt[], method: 'snowball' | 'avalanche', extraMonthly: number): number {
  const unpaid = debts
    .filter(d => d.status === 'unpaid' && d.type === 'debt')
    .map(d => ({ ...d, balance: d.amount_idr }));

  if (unpaid.length === 0) return 0;

  const sorted = [...unpaid].sort((a, b) =>
    method === 'snowball'
      ? a.balance - b.balance
      : (a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1
  );

  const minPayment = Math.ceil(sorted[0].balance / 12);
  const totalMonthly = minPayment + extraMonthly;
  const working = sorted.map(d => ({ ...d }));

  let month = 0;
  while (working.some(d => d.balance > 0) && month < 120) {
    month++;
    let remaining = totalMonthly;
    for (const debt of working) {
      if (debt.balance <= 0) continue;
      const pay = Math.min(remaining, debt.balance);
      debt.balance -= pay;
      remaining -= pay;
      if (remaining <= 0) break;
    }
  }
  return month;
}

export function DebtPlanner() {
  const { goBack } = useUIStore();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState<'snowball' | 'avalanche'>('snowball');
  const [extraMonthly, setExtraMonthly] = useState(0);
  const [extraInput, setExtraInput] = useState('');
  const [payForm, setPayForm] = useState<PayForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);

  const load = () => {
    Promise.all([
      apiFetch<Debt[]>('/debts'),
      apiFetch<BankAccount[]>('/bank-accounts'),
    ])
      .then(([d, b]) => { setDebts(d); setBanks(b); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const unpaidDebts = debts.filter(d => d.status === 'unpaid' && d.type === 'debt');
  const totalDebt = unpaidDebts.reduce((s, d) => s + d.amount_idr, 0);
  const payoffMonth = computePayoff(debts, method, extraMonthly);

  const openPayForm = (debt: Debt) => {
    setPayForm({
      debtId: debt.id,
      personName: debt.person_name,
      maxAmount: debt.amount_idr,
      amountInput: String(debt.amount_idr),
      date: jakartaToday(),
      bankAccountId: banks[0]?.id ?? '',
      note: '',
    });
  };

  const handlePay = async () => {
    if (!payForm) return;
    const amount = parseInt(payForm.amountInput.replace(/\D/g, '')) || 0;
    if (amount <= 0) return;
    setSaving(true);
    try {
      await apiFetch(`/debts/${payForm.debtId}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          payment_date: payForm.date,
          status: 'paid',
          note: payForm.note || null,
          bank_account_id: payForm.bankAccountId || null,
        }),
      });
      // Mark debt as paid if full amount
      if (amount >= payForm.maxAmount) {
        await apiFetch(`/debts/${payForm.debtId}`, {
          method: 'PUT',
          body: JSON.stringify({
            status: 'paid',
            person_name: payForm.personName,
            amount: payForm.maxAmount,
          }),
        });
      }
      setSuccessId(payForm.debtId);
      setPayForm(null);
      load();
      setTimeout(() => setSuccessId(null), 2000);
    } catch (e: any) {
      alert('Gagal mencatat pembayaran: ' + (e?.message ?? ''));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="min-h-screen px-5 pt-14 pb-28 animate-[fyScreen_420ms_cubic-bezier(0.25,0.46,0.45,0.94)_both]"
      style={{ background: 'var(--bg)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <motion.button
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={goBack}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </motion.button>
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.5px' }}>
          Pelunasan Utang
        </h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : unpaidDebts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-4xl">🎉</p>
          <p className="font-semibold" style={{ color: 'var(--text2)' }}>Tidak ada utang aktif</p>
          <p className="text-sm text-center" style={{ color: 'var(--text3)' }}>Tambah utang di menu Laporan Keuangan untuk mulai merencanakan pelunasan</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Total */}
          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.gentle}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1" style={{ color: 'var(--text3)' }}>TOTAL UTANG AKTIF</p>
            <p className="text-3xl font-black" style={{ color: '#FF453A', letterSpacing: '-0.5px' }}>{formatRp(totalDebt)}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>{unpaidDebts.length} utang belum lunas</p>
          </motion.div>

          {/* Method selector */}
          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.05 }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>METODE PELUNASAN</p>
            <div className="grid grid-cols-2 gap-2">
              {(['snowball', 'avalanche'] as const).map(m => (
                <motion.button
                  key={m}
                  className="py-3 rounded-xl text-xs font-bold"
                  style={{
                    background: method === m ? 'var(--accent)' : 'var(--bg)',
                    color: method === m ? 'white' : 'var(--text2)',
                    border: `1px solid ${method === m ? 'var(--accent)' : 'var(--sep)'}`,
                  }}
                  onClick={() => setMethod(m)}
                  whileTap={{ scale: 0.96 }}
                  transition={springs.snappy}
                >
                  {m === 'snowball' ? '❄️ Snowball' : '🏔️ Avalanche'}
                  <span className="block text-[9px] mt-0.5 font-normal opacity-80">
                    {m === 'snowball' ? 'Terkecil dulu' : 'Jatuh tempo dulu'}
                  </span>
                </motion.button>
              ))}
            </div>
            <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--text3)' }}>
              {method === 'snowball'
                ? 'Bayar utang terkecil dulu → motivasi cepat meningkat.'
                : 'Bayar utang yang paling dekat jatuh temponya dulu.'}
            </p>
          </motion.div>

          {/* Extra monthly */}
          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.08 }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-2" style={{ color: 'var(--text3)' }}>TAMBAHAN BAYAR PER BULAN</p>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: 'var(--text2)' }}>Rp</span>
              <input
                className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none font-semibold"
                style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                placeholder="0"
                inputMode="numeric"
                value={extraInput}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '');
                  setExtraInput(v);
                  setExtraMonthly(parseInt(v) || 0);
                }}
              />
            </div>
          </motion.div>

          {/* Proyeksi */}
          {payoffMonth > 0 && (
            <motion.div
              className="rounded-[20px] p-5"
              style={{ background: 'var(--accentSoft)', border: '1px solid var(--accent)' }}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={springs.bouncy}
            >
              <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1" style={{ color: 'var(--accent)' }}>PROYEKSI LUNAS</p>
              <p className="text-2xl font-black" style={{ color: 'var(--accent)' }}>
                {payoffMonth < 12
                  ? `${payoffMonth} bulan`
                  : `${Math.floor(payoffMonth / 12)} thn ${payoffMonth % 12} bln`}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text2)' }}>
                estimasi berdasarkan cicilan minimum + tambahan {formatRp(extraMonthly)}/bln
              </p>
            </motion.div>
          )}

          {/* Urutan pelunasan + Bayar button */}
          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.12 }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>URUTAN PELUNASAN</p>
            {unpaidDebts
              .sort((a, b) => method === 'snowball'
                ? a.amount_idr - b.amount_idr
                : (a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1
              )
              .map((d, i) => (
                <div key={d.id} className="flex items-center gap-3 py-3 border-b last:border-0" style={{ borderColor: 'var(--sep)' }}>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
                    style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}
                  >
                    {successId === d.id ? '✓' : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--text)' }}>{d.person_name}</p>
                    {d.due_date && (
                      <p className="text-[10px]" style={{ color: 'var(--text3)' }}>jatuh tempo {d.due_date}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <p className="font-bold text-sm" style={{ color: '#FF453A' }}>{formatRp(d.amount_idr)}</p>
                    <motion.button
                      className="px-3 py-1.5 rounded-xl text-[11px] font-bold"
                      style={{ background: 'var(--accent)', color: 'white' }}
                      whileTap={{ scale: 0.94 }}
                      transition={springs.snappy}
                      onClick={() => openPayForm(d)}
                    >
                      Bayar
                    </motion.button>
                  </div>
                </div>
              ))}
          </motion.div>
        </div>
      )}

      {/* Pay Modal */}
      <AnimatePresence>
        {payForm && (
          <>
            <motion.div
              className="fixed inset-0 z-40"
              style={{ background: 'rgba(0,0,0,0.5)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPayForm(null)}
            />
            <motion.div
              className="fixed left-0 right-0 bottom-0 z-50 max-w-[430px] mx-auto rounded-t-[28px] px-5 pt-5 pb-10"
              style={{ background: 'var(--surface)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={springs.smooth}
            >
              <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'var(--sep)' }} />
              <p className="text-base font-extrabold mb-4" style={{ color: 'var(--text)' }}>
                Bayar Hutang — {payForm.personName}
              </p>

              {/* Amount */}
              <div className="mb-3">
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text3)' }}>JUMLAH</p>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: 'var(--bg)', border: '1px solid var(--sep)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--text2)' }}>Rp</span>
                  <input
                    className="flex-1 bg-transparent outline-none text-sm font-semibold"
                    style={{ color: 'var(--text)' }}
                    inputMode="numeric"
                    value={payForm.amountInput}
                    onChange={e => setPayForm(f => f && ({ ...f, amountInput: e.target.value.replace(/\D/g, '') }))}
                  />
                </div>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>
                  Total utang: {formatRp(payForm.maxAmount)}
                </p>
              </div>

              {/* Date */}
              <div className="mb-3">
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text3)' }}>TANGGAL BAYAR</p>
                <input
                  type="date"
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none font-semibold"
                  style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                  value={payForm.date}
                  onChange={e => setPayForm(f => f && ({ ...f, date: e.target.value }))}
                />
              </div>

              {/* Bank account */}
              {banks.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text3)' }}>REKENING (KREDIT)</p>
                  <select
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none font-semibold appearance-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                    value={payForm.bankAccountId}
                    onChange={e => setPayForm(f => f && ({ ...f, bankAccountId: e.target.value }))}
                  >
                    <option value="">— Tidak pakai rekening —</option>
                    {banks.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({formatRp(b.balance)})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>
                    Saldo rekening akan otomatis berkurang & masuk ke tab Pengeluaran
                  </p>
                </div>
              )}

              {/* Note */}
              <div className="mb-5">
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text3)' }}>CATATAN (OPSIONAL)</p>
                <input
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                  placeholder="Cicilan ke-1, via transfer, dll"
                  value={payForm.note}
                  onChange={e => setPayForm(f => f && ({ ...f, note: e.target.value }))}
                />
              </div>

              <motion.button
                className="w-full py-3.5 rounded-2xl font-bold text-sm"
                style={{ background: 'var(--accent)', color: 'white', opacity: saving ? 0.6 : 1 }}
                whileTap={{ scale: 0.97 }}
                transition={springs.snappy}
                onClick={handlePay}
                disabled={saving}
              >
                {saving ? 'Menyimpan...' : 'Catat Pembayaran'}
              </motion.button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
