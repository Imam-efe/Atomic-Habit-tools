import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface ReportData {
  pnl: {
    month: string;
    income: number;
    expense: number;
    net_profit: number;
    expenses_breakdown: { category: string; amount: number }[];
    income_breakdown: { category: string; amount: number }[];
  };
  balance_sheet: {
    assets: {
      total: number;
      accounts: { name: string; type: string; balance: number }[];
      receivables: number;
    };
    liabilities: {
      total: number;
    };
    net_worth: number;
  };
  upcoming_payments: {
    id: string;
    debt_id: string;
    amount: number;
    date: string;
    status: string;
    note: string | null;
    person_name: string;
    debt_type: string;
  }[];
}

interface Debt {
  id: string;
  type: 'debt' | 'receivable';
  person_name: string;
  amount_idr: number;
  due_date: string | null;
  note: string | null;
  status: 'unpaid' | 'paid';
  payments: {
    id: string;
    amount_idr: number;
    payment_date: string;
    status: string;
    note: string | null;
  }[];
}

function formatRp(n: number) {
  return n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}

type RangePreset = '7d' | '30d' | '3m' | 'custom';

function jakartaToday() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

function jakartaDaysAgo(n: number) {
  return new Date(Date.now() + 7 * 3600000 - n * 86400000).toISOString().slice(0, 10);
}

function computeRange(preset: RangePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const today = jakartaToday();
  if (preset === '7d') return { from: jakartaDaysAgo(6), to: today };
  if (preset === '30d') return { from: jakartaDaysAgo(29), to: today };
  if (preset === '3m') return { from: jakartaDaysAgo(89), to: today };
  return { from: customFrom || today, to: customTo || today };
}

export function FinancialReport() {
  const { setSubScreen } = useUIStore();
  const [activeTab, setActiveTab] = useState<'pnl' | 'balance' | 'debt'>('pnl');
  const [report, setReport] = useState<ReportData | null>(null);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangePreset, setRangePreset] = useState<RangePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Debt Form state
  const [showDebtForm, setShowDebtForm] = useState(false);
  const [debtType, setDebtType] = useState<'debt' | 'receivable'>('debt');
  const [personName, setPersonName] = useState('');
  const [debtAmount, setDebtAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [debtNote, setDebtNote] = useState('');
  const [savingDebt, setSavingDebt] = useState(false);

  // Payment Form state
  const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(jakartaToday());
  const [paymentNote, setPaymentNote] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  const loadReport = () => {
    setLoading(true);
    const { from, to } = computeRange(rangePreset, customFrom, customTo);
    Promise.all([
      apiFetch<ReportData>(`/finance-report?from=${from}&to=${to}`),
      apiFetch<Debt[]>('/debts')
    ]).then(([repData, debtData]) => {
      setReport(repData);
      setDebts(debtData);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { loadReport(); }, [rangePreset, customFrom, customTo]);

  const handleAddDebt = async () => {
    const amt = parseInt(debtAmount.replace(/\D/g, ''));
    if (!personName.trim() || !amt) return;
    setSavingDebt(true);
    try {
      await apiFetch('/debts', {
        method: 'POST',
        body: JSON.stringify({
          type: debtType,
          person_name: personName.trim(),
          amount: amt,
          due_date: dueDate || null,
          note: debtNote.trim() || null
        })
      });
      loadReport();
      // Reset Form
      setPersonName('');
      setDebtAmount('');
      setDueDate('');
      setDebtNote('');
      setShowDebtForm(false);
    } catch {}
    setSavingDebt(false);
  };

  const handleToggleDebtStatus = async (id: string, currentStatus: string) => {
    const debt = debts.find(d => d.id === id);
    if (!debt) return;
    const newStatus = currentStatus === 'paid' ? 'unpaid' : 'paid';

    // Optimistic Update
    setDebts(prev => prev.map(d => d.id === id ? { ...d, status: newStatus } : d));

    try {
      await apiFetch(`/debts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          type: debt.type,
          person_name: debt.person_name,
          amount: debt.amount_idr,
          due_date: debt.due_date,
          note: debt.note,
          status: newStatus
        })
      });
      loadReport();
    } catch {
      loadReport();
    }
  };

  const handleDeleteDebt = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus catatan utang/piutang ini?')) return;
    setDebts(prev => prev.filter(d => d.id !== id));
    try {
      await apiFetch(`/debts/${id}`, { method: 'DELETE' });
      loadReport();
    } catch {
      loadReport();
    }
  };

  const handleAddPayment = async () => {
    const amt = parseInt(paymentAmount.replace(/\D/g, ''));
    if (!selectedDebtId || !amt || !paymentDate) return;
    setSavingPayment(true);
    try {
      // Backend auto-creates budget entry + adjusts bank balance when bank_account_id is passed
      await apiFetch(`/debts/${selectedDebtId}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: amt,
          payment_date: paymentDate,
          status: 'paid',
          note: paymentNote.trim() || null,
          // No bank_account_id here (FinancialReport doesn't have bank selector)
          // Budget entry NOT auto-created; use DebtPlanner for full bank integration
        })
      });

      // Fallback: manually create budget entry without bank link
      // (only if no bank was selected — keeps backward compatibility)
      const targetDebt = debts.find(d => d.id === selectedDebtId);
      if (targetDebt) {
        await apiFetch('/budget', {
          method: 'POST',
          body: JSON.stringify({
            type: targetDebt.type === 'debt' ? 'expense' : 'income',
            amount: amt,
            category: targetDebt.type === 'debt' ? 'Cicilan & Utang' : 'Lainnya',
            note: `Pembayaran ${targetDebt.type === 'debt' ? 'Utang' : 'Piutang'} oleh/kepada ${targetDebt.person_name}${paymentNote ? ` (${paymentNote})` : ''}`,
            date: paymentDate
          })
        });
      }

      loadReport();
      setPaymentAmount('');
      setPaymentNote('');
      setSelectedDebtId(null);
    } catch {}
    setSavingPayment(false);
  };

  const completeUpcomingPayment = async (payId: string, debtId: string, amount: number, personName: string, debtType: string) => {
    if (!confirm('Tandai tagihan pembayaran ini sebagai selesai dibayar? Ini juga akan otomatis mencatat pengeluaran di modul uang.')) return;
    try {
      const today = jakartaToday();

      // 1. Update payment status to paid
      await apiFetch(`/debts/${debtId}/payments/${payId}`, {
        method: 'PUT',
        body: JSON.stringify({
          amount,
          payment_date: today,
          status: 'paid'
        })
      });

      // 2. Add budget entry (no bank_account_id — use DebtPlanner for full bank integration)
      await apiFetch('/budget', {
        method: 'POST',
        body: JSON.stringify({
          type: debtType === 'debt' ? 'expense' : 'income',
          amount,
          category: debtType === 'debt' ? 'Cicilan & Utang' : 'Lainnya',
          note: `Bayar cicilan ${debtType === 'debt' ? 'Utang' : 'Piutang'} ke ${personName}`,
          date: today
        })
      });

      loadReport();
    } catch {
      alert('Gagal menyelesaikan pembayaran');
    }
  };

  return (
    <div className="min-h-screen px-5 pt-16 pb-28" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => setSubScreen(null)}
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
        >
          <span style={{ color: 'var(--accent)' }} className="text-xl">‹</span>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.5px' }}>
            Laporan Keuangan
          </h1>
          <p className="text-xs" style={{ color: 'var(--text2)' }}>
            Rekap P&L, Neraca, & Manajemen Utang
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl mb-5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        {(['pnl', 'balance', 'debt'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="py-2.5 rounded-lg text-xs font-bold text-center"
            style={{
              background: activeTab === tab ? 'var(--bg)' : 'transparent',
              color: activeTab === tab ? 'var(--text)' : 'var(--text3)',
            }}
          >
            {tab === 'pnl' ? '📈 Laba Rugi' : tab === 'balance' ? '⚖️ Neraca' : '🤝 Utang'}
          </button>
        ))}
      </div>

      {loading && !report ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div>
          {/* TAB 1: LABA RUGI (P&L) */}
          {activeTab === 'pnl' && report && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.gentle} className="flex flex-col gap-4">
              {/* Date Range Filter */}
              <div className="flex flex-col gap-2 mb-4">
                <div className="flex gap-1.5">
                  {(['7d', '30d', '3m', 'custom'] as RangePreset[]).map(p => (
                    <motion.button
                      key={p}
                      className="flex-1 py-1.5 rounded-xl text-[11px] font-bold"
                      style={{
                        background: rangePreset === p ? 'var(--accentFill)' : 'var(--track)',
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
                    <input type="date"
                      className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
                      style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                      value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
                    <span className="text-xs" style={{ color: 'var(--text3)' }}>–</span>
                    <input type="date"
                      className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
                      style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                      value={customTo} onChange={e => setCustomTo(e.target.value)} />
                  </div>
                )}
              </div>

              {/* Summary Card */}
              <div className="rounded-[20px] p-5 flex flex-col gap-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                <div>
                  <p className="text-[10px] font-bold tracking-wider uppercase mb-1" style={{ color: 'var(--text3)' }}>
                    HASIL BERSIH (NET INCOME)
                  </p>
                  <h2 className="text-2xl font-black" style={{ color: report.pnl.net_profit >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                    {formatRp(report.pnl.net_profit)}
                  </h2>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4" style={{ borderTop: '1px solid var(--sep)' }}>
                  <div>
                    <span className="text-[10px] font-bold text-[var(--pos)] block uppercase mb-0.5">Total Pendapatan</span>
                    <span className="text-base font-bold text-[var(--pos)]">{formatRp(report.pnl.income)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-[var(--neg)] block uppercase mb-0.5">Total Pengeluaran</span>
                    <span className="text-base font-bold text-[var(--neg)]">{formatRp(report.pnl.expense)}</span>
                  </div>
                </div>
              </div>

              {/* Incomes Breakdown */}
              <div className="rounded-[20px] p-4 flex flex-col gap-3" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                <p className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: 'var(--text2)' }}>
                  💸 SUMBER PENDAPATAN
                </p>
                {report.pnl.income_breakdown.length === 0 ? (
                  <p className="text-xs text-center py-2" style={{ color: 'var(--text3)' }}>Belum ada pendapatan masuk</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {report.pnl.income_breakdown.map(inc => (
                      <div key={inc.category} className="flex justify-between items-center text-xs">
                        <span style={{ color: 'var(--text2)' }}>{inc.category}</span>
                        <span className="font-bold text-[var(--pos)]">{formatRp(inc.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Expenses Breakdown */}
              <div className="rounded-[20px] p-4 flex flex-col gap-3" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                <p className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: 'var(--text2)' }}>
                  📉 POS PENGELUARAN
                </p>
                {report.pnl.expenses_breakdown.length === 0 ? (
                  <p className="text-xs text-center py-2" style={{ color: 'var(--text3)' }}>Belum ada pengeluaran tercatat</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {report.pnl.expenses_breakdown.map(exp => {
                      const percentage = report.pnl.expense > 0 ? (exp.amount / report.pnl.expense) * 100 : 0;
                      return (
                        <div key={exp.category} className="flex flex-col gap-1">
                          <div className="flex justify-between items-center text-xs">
                            <span style={{ color: 'var(--text)' }} className="font-semibold">{exp.category}</span>
                            <span className="font-bold" style={{ color: 'var(--text)' }}>
                              {formatRp(exp.amount)} <span className="text-[10px]" style={{ color: 'var(--text3)' }}>({Math.round(percentage)}%)</span>
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                            <div className="h-full rounded-full" style={{ background: 'var(--accentFill)', width: `${percentage}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* TAB 2: NERACA (BALANCE SHEET) */}
          {activeTab === 'balance' && report && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.gentle} className="flex flex-col gap-4">
              {/* Net Worth Hero */}
              <div className="rounded-[20px] p-5 flex flex-col gap-3" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                <div>
                  <p className="text-[10px] font-bold tracking-wider uppercase mb-1" style={{ color: 'var(--text3)' }}>
                    KEKAYAAN BERSIH (NET WORTH)
                  </p>
                  <h2 className="text-3xl font-black" style={{ color: report.balance_sheet.net_worth >= 0 ? 'var(--accent)' : 'var(--neg)' }}>
                    {formatRp(report.balance_sheet.net_worth)}
                  </h2>
                  <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'var(--text3)' }}>
                    *Kekayaan bersih dihitung dari total Aset Bank & Piutang dikurangi total Liabilitas Utang.
                  </p>
                </div>
              </div>

              {/* Assets Section */}
              <div className="rounded-[20px] p-4 flex flex-col gap-3.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                <div className="flex justify-between items-center" style={{ borderBottom: '1px solid var(--sep)', paddingBottom: '8px' }}>
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--pos)' }}>🟢 ASET (ASSETS)</span>
                  <span className="text-sm font-bold" style={{ color: 'var(--pos)' }}>{formatRp(report.balance_sheet.assets.total + report.balance_sheet.assets.receivables)}</span>
                </div>

                <div className="flex flex-col gap-2.5 pl-1.5">
                  {report.balance_sheet.assets.accounts.map(acc => (
                    <div key={acc.name} className="flex justify-between items-center text-xs">
                      <div>
                        <span style={{ color: 'var(--text)' }} className="font-semibold block">{acc.name}</span>
                        <span style={{ color: 'var(--text3)' }} className="text-[9px] block uppercase">{acc.type}</span>
                      </div>
                      <span className="font-bold" style={{ color: 'var(--text)' }}>{formatRp(acc.balance)}</span>
                    </div>
                  ))}
                  {report.balance_sheet.assets.receivables > 0 && (
                    <div className="flex justify-between items-center text-xs pt-1.5" style={{ borderTop: '1px dashed var(--sep)' }}>
                      <span style={{ color: 'var(--text2)' }} className="italic">💰 Total Piutang (Uang Anda di Orang Lain)</span>
                      <span className="font-bold text-[var(--pos)]">{formatRp(report.balance_sheet.assets.receivables)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Liabilities Section */}
              <div className="rounded-[20px] p-4 flex flex-col gap-3.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                <div className="flex justify-between items-center" style={{ borderBottom: '1px solid var(--sep)', paddingBottom: '8px' }}>
                  <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--neg)' }}>🔴 KEWAJIBAN / UTANG (LIABILITIES)</span>
                  <span className="text-sm font-bold" style={{ color: 'var(--neg)' }}>{formatRp(report.balance_sheet.liabilities.total)}</span>
                </div>

                <div className="flex flex-col gap-2.5 pl-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span style={{ color: 'var(--text2)' }}>Utang Belum Lunas</span>
                    <span className="font-bold text-[var(--neg)]">{formatRp(report.balance_sheet.liabilities.total)}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 3: DEBT / UTANG & PIUTANG */}
          {activeTab === 'debt' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.gentle} className="flex flex-col gap-4">
              {/* Form toggler */}
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text2)] pl-1">Daftar Utang & Piutang</h3>
                <button
                  onClick={() => setShowDebtForm(s => !s)}
                  className="neu-cta px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                  style={{ background: 'var(--accentFill)' }}
                >
                  {showDebtForm ? 'Tutup Form' : '+ Catat Baru'}
                </button>
              </div>

              {/* New Debt Form */}
              <AnimatePresence>
                {showDebtForm && (
                  <motion.div
                    className="rounded-[18px] p-4"
                    style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={collapse}
                  >
                    <p className="text-xs font-bold mb-3" style={{ color: 'var(--text)' }}>Catat Utang Baru</p>
                    <div className="flex flex-col gap-2.5">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="flex-1 py-2 rounded-xl text-xs font-bold"
                          style={{
                            background: debtType === 'debt' ? 'var(--negFill)' : 'var(--track)',
                            color: debtType === 'debt' ? 'white' : 'var(--text2)'
                          }}
                          onClick={() => setDebtType('debt')}
                        >
                          Utang Kita (Debt)
                        </button>
                        <button
                          type="button"
                          className="flex-1 py-2 rounded-xl text-xs font-bold"
                          style={{
                            background: debtType === 'receivable' ? 'var(--posFill)' : 'var(--track)',
                            color: debtType === 'receivable' ? 'white' : 'var(--text2)'
                          }}
                          onClick={() => setDebtType('receivable')}
                        >
                          Piutang Kita (Receivable)
                        </button>
                      </div>

                      <input
                        className="w-full px-3.5 py-2 rounded-xl text-xs outline-none"
                        style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                        placeholder="Nama Orang (Pemberi Utang / Peminjam)"
                        value={personName}
                        onChange={e => setPersonName(e.target.value)}
                      />

                      <input
                        className="w-full px-3.5 py-2 rounded-xl text-xs outline-none"
                        style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                        placeholder="Jumlah (Rp)"
                        value={debtAmount}
                        onChange={e => setDebtAmount(e.target.value.replace(/\D/g, ''))}
                        inputMode="numeric"
                      />

                      <div>
                        <label className="text-[9px] font-bold text-[var(--text2)] block mb-1 uppercase">Jatuh Tempo (Opsional)</label>
                        <input
                          type="date"
                          className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                          style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                          value={dueDate}
                          onChange={e => setDueDate(e.target.value)}
                        />
                      </div>

                      <input
                        className="w-full px-3.5 py-2 rounded-xl text-xs outline-none"
                        style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                        placeholder="Keterangan tambahan"
                        value={debtNote}
                        onChange={e => setDebtNote(e.target.value)}
                      />

                      <button
                        onClick={handleAddDebt}
                        disabled={savingDebt}
                        className="neu-cta w-full py-2.5 rounded-xl text-xs font-bold text-white"
                        style={{ background: 'var(--accentFill)' }}
                      >
                        {savingDebt ? 'Menyimpan...' : 'Simpan Utang'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Debt payment scheduler modal / form */}
              <AnimatePresence>
                {selectedDebtId && (
                  <motion.div
                    className="rounded-[18px] p-4 bg-zinc-950/20"
                    style={{ border: '1px solid var(--accent)', background: 'var(--surface)', boxShadow: 'var(--neu-pressed)' }}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                  >
                    <div className="flex justify-between items-center mb-3">
                      <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>📝 Catat Pembayaran Cicilan</p>
                      <button className="text-xs text-[var(--text2)]" onClick={() => setSelectedDebtId(null)}>Tutup</button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <input
                        className="w-full px-3.5 py-2 rounded-xl text-xs outline-none"
                        style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                        placeholder="Jumlah Bayar (Rp)"
                        value={paymentAmount}
                        onChange={e => setPaymentAmount(e.target.value.replace(/\D/g, ''))}
                        inputMode="numeric"
                      />
                      <input
                        type="date"
                        className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                        style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                        value={paymentDate}
                        onChange={e => setPaymentDate(e.target.value)}
                      />
                      <input
                        className="w-full px-3.5 py-2 rounded-xl text-xs outline-none"
                        style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                        placeholder="Catatan pembayaran (contoh: Cicilan 1, Bayar Lunas)"
                        value={paymentNote}
                        onChange={e => setPaymentNote(e.target.value)}
                      />
                      <button
                        onClick={handleAddPayment}
                        disabled={savingPayment}
                        className="neu-cta w-full py-2.5 rounded-xl text-xs font-bold text-white mt-1"
                        style={{ background: 'var(--accentFill)' }}
                      >
                        {savingPayment ? 'Menyimpan...' : 'Simpan Pembayaran'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Debt payment schedules reminders */}
              {report && report.upcoming_payments.length > 0 && (
                <div className="rounded-[18px] p-4 flex flex-col gap-2.5" style={{ background: 'rgba(255,159,10,0.06)', border: '1px solid rgba(255,159,10,0.2)' }}>
                  <p className="text-[10px] font-bold text-[var(--warn)] uppercase tracking-wider block">⏰ SCHEDULE BAYAR JATUH TEMPO</p>
                  <div className="flex flex-col gap-2">
                    {report.upcoming_payments.map(pay => (
                      <div key={pay.id} className="flex items-center justify-between bg-black/10 dark:bg-white/5 p-2 rounded-xl text-xs">
                        <div>
                          <span className="font-semibold block" style={{ color: 'var(--text)' }}>
                            {pay.debt_type === 'debt' ? 'Bayar ke ' : 'Terima dari '} {pay.person_name}
                          </span>
                          <span className="text-[10px] block" style={{ color: 'var(--text3)' }}>
                            Jatuh tempo: {new Date(pay.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[var(--warn)] mr-1">{formatRp(pay.amount)}</span>
                          <button
                            onClick={() => completeUpcomingPayment(pay.id, pay.debt_id, pay.amount, pay.person_name, pay.debt_type)}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-2.5 py-1 rounded-lg text-[10px]"
                          >
                            Lunas ✓
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Debt List Cards */}
              {debts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <p className="text-2xl mb-2">🤝</p>
                  <p className="text-xs" style={{ color: 'var(--text3)' }}>Tidak ada catatan utang piutang aktif</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {debts.map(debt => {
                    const isDebt = debt.type === 'debt';
                    const paidAmount = debt.payments.reduce((sum, p) => sum + p.amount_idr, 0);
                    const remainingAmount = debt.amount_idr - paidAmount;

                    return (
                      <div
                        key={debt.id}
                        className="rounded-2xl p-4 flex flex-col gap-3 relative overflow-hidden"
                        style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
                      >
                        {/* Side Bar Indicator */}
                        <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: isDebt ? 'var(--negFill)' : 'var(--posFill)' }} />

                        {/* Top Header */}
                        <div className="flex items-start justify-between pl-1">
                          <div>
                            <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full"
                              style={{ background: isDebt ? 'rgba(255,69,58,0.12)' : 'rgba(52,199,89,0.12)', color: isDebt ? 'var(--neg)' : 'var(--pos)' }}>
                              {isDebt ? 'Utang Kita' : 'Piutang Orang'}
                            </span>
                            <h4 className="text-sm font-bold text-white mt-1.5" style={{ color: 'var(--text)' }}>
                              {debt.person_name}
                            </h4>
                            {debt.note && <p className="text-[11px]" style={{ color: 'var(--text3)' }}>{debt.note}</p>}
                            {debt.due_date && (
                              <p className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>
                                Tempo: <span className="font-semibold">{new Date(debt.due_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                              </p>
                            )}
                          </div>

                          <div className="text-right">
                            <h4 className="text-sm font-extrabold" style={{ color: isDebt ? 'var(--neg)' : 'var(--pos)' }}>
                              {formatRp(debt.amount_idr)}
                            </h4>
                            <span className="text-[10px] block mt-0.5 font-bold" style={{ color: debt.status === 'paid' ? 'var(--pos)' : 'var(--warn)' }}>
                              {debt.status === 'paid' ? 'LUNAS ✓' : 'BELUM LUNAS'}
                            </span>
                          </div>
                        </div>

                        {/* Progress Bar for installments */}
                        {debt.status === 'unpaid' && debt.amount_idr > 0 && (
                          <div className="pl-1 pt-1">
                            <div className="flex justify-between items-center text-[10px] mb-1" style={{ color: 'var(--text3)' }}>
                              <span>Terbayar: {formatRp(paidAmount)}</span>
                              <span>Sisa: {formatRp(remainingAmount)}</span>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                              <div
                                className="h-full rounded-full"
                                style={{
                                  background: isDebt ? 'var(--negFill)' : 'var(--posFill)',
                                  width: `${Math.min(100, (paidAmount / debt.amount_idr) * 100)}%`
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {/* List of Payments */}
                        {debt.payments.length > 0 && (
                          <div className="pl-1 py-1 rounded-xl bg-black/10 dark:bg-white/5 p-2 flex flex-col gap-1 text-[10px]">
                            <span className="font-bold text-[var(--text2)] block mb-0.5 uppercase tracking-wider">Histori Cicilan</span>
                            {debt.payments.map(p => (
                              <div key={p.id} className="flex justify-between text-[10px]">
                                <span style={{ color: 'var(--text3)' }}>
                                  📅 {new Date(p.payment_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} {p.note && `(${p.note})`}
                                </span>
                                <span className="font-bold text-white">{formatRp(p.amount_idr)}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Debt Actions */}
                        <div className="flex gap-2 justify-end pt-2 border-t" style={{ borderColor: 'var(--sep)' }}>
                          {debt.status === 'unpaid' && (
                            <button
                              onClick={() => {
                                const text = isDebt 
                                  ? `Halo ${debt.person_name}, saya ingin menginfokan bahwa cicilan utang saya sebesar ${formatRp(remainingAmount)} telah dijadwalkan untuk dibayar pada tanggal ${debt.due_date ? new Date(debt.due_date).toLocaleDateString('id-ID', {day:'numeric', month:'long'}) : 'waktu dekat'}. Terima kasih!` 
                                  : `Halo ${debt.person_name}, semoga sehat selalu. Hanya ingin mengingatkan secara ramah mengenai piutang sebesar ${formatRp(remainingAmount)} yang dijadwalkan jatuh tempo pada tanggal ${debt.due_date ? new Date(debt.due_date).toLocaleDateString('id-ID', {day:'numeric', month:'long'}) : 'waktu dekat'}. Terima kasih banyak atas perhatiannya!`;
                                window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                              }}
                              className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-white bg-emerald-600"
                            >
                              💬 WA
                            </button>
                          )}
                          <button
                            onClick={() => handleToggleDebtStatus(debt.id, debt.status)}
                            className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-white"
                            style={{ background: 'var(--track)', color: 'var(--text)' }}
                          >
                            {debt.status === 'paid' ? 'Tandai Belum Lunas' : 'Tandai Lunas'}
                          </button>
                          {debt.status === 'unpaid' && (
                            <button
                              onClick={() => setSelectedDebtId(debt.id)}
                              className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-white bg-orange-500"
                            >
                              + Cicilan
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteDebt(debt.id)}
                            className="p-1.5 rounded-lg flex items-center justify-center bg-red-950/10 border border-red-500/20"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--neg)" strokeWidth="2.5">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
