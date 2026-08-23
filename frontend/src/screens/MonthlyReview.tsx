import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface HabitStat {
  name: string;
  completions: number;
  expected: number;
  consistency: number;
}

interface MonthStats {
  month: string;
  daysElapsed: number;
  overallConsistency: number;
  habits: HabitStat[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  netWorth: number | null;
  netWorthDelta: number | null;
  identityStatement: string | null;
}

interface MonthlyReviewData {
  month: string;
  monthLabel: string;
  stats: MonthStats;
  narrative: string | null;
}

interface HistoryItem {
  month: string;
  monthLabel: string;
  narrative: string;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatRp(n: number) {
  return n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}

const consistencyColor = (pct: number) =>
  pct >= 80 ? 'var(--pos)' : pct >= 50 ? 'var(--warn)' : 'var(--neg)';

export function MonthlyReview() {
  const { goBack } = useUIStore();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<MonthlyReviewData | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const load = async (m: string) => {
    setLoading(true);
    try {
      const res = await apiFetch<MonthlyReviewData>(`/monthly-review?month=${m}`);
      setData(res);
    } catch {}
    setLoading(false);
  };

  const loadHistory = async () => {
    try {
      const res = await apiFetch<HistoryItem[]>('/monthly-review/list');
      setHistory(res);
    } catch {}
  };

  useEffect(() => { load(month); }, [month]);
  useEffect(() => { loadHistory(); }, []);

  const handleGenerate = async () => {
    if (data?.narrative && !confirm('Buat ulang rekap AI untuk bulan ini?')) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await apiFetch<MonthlyReviewData>('/monthly-review/generate', {
        method: 'POST',
        body: JSON.stringify({ month }),
      });
      setData(res);
      loadHistory();
    } catch (err) {
      setGenError(
        err instanceof Error && err.message.includes('data bulan')
          ? 'Belum ada data untuk direkap bulan ini.'
          : 'Gagal membuat rekap. Coba lagi nanti.'
      );
    }
    setGenerating(false);
  };

  const isCurrent = month === currentMonth();

  return (
    <div className="min-h-screen px-5 pt-14 pb-28" style={{ background: 'var(--bg)' }}>
      <div className="flex items-center gap-3 mb-5">
        <motion.button
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={goBack}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </motion.button>
        <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.5px' }}>
          Rekap Bulanan
        </h1>
      </div>

      {/* Month switcher */}
      <div className="flex items-center justify-between mb-5 rounded-[16px] px-2 py-2" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        <button
          className="w-8 h-8 rounded-full flex items-center justify-center"
          onClick={() => setMonth(m => shiftMonth(m, -1))}
        >
          <span style={{ color: 'var(--accent)' }}>‹</span>
        </button>
        <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>
          {data?.monthLabel ?? month}
        </span>
        <button
          className="w-8 h-8 rounded-full flex items-center justify-center"
          onClick={() => setMonth(m => shiftMonth(m, 1))}
          disabled={isCurrent}
          style={{ opacity: isCurrent ? 0.3 : 1 }}
        >
          <span style={{ color: 'var(--accent)' }}>›</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : data ? (
        <div className="flex flex-col gap-4">
          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.gentle}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
              KONSISTENSI BULAN INI
            </p>
            <div className="flex items-end gap-3">
              <span className="text-5xl font-black" style={{ color: consistencyColor(data.stats.overallConsistency), letterSpacing: '-1px' }}>
                {data.stats.overallConsistency}%
              </span>
              <span className="text-sm mb-1" style={{ color: 'var(--text3)' }}>dari {data.stats.daysElapsed} hari</span>
            </div>
            {data.stats.habits.length > 0 && (
              <div className="flex flex-col gap-2.5 mt-4">
                {data.stats.habits.map(h => (
                  <div key={h.name}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{h.name}</span>
                      <span className="text-[11px] font-bold" style={{ color: consistencyColor(h.consistency) }}>
                        {h.completions}/{h.expected}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: consistencyColor(h.consistency) }}
                        initial={{ width: 0 }}
                        animate={{ width: `${h.consistency}%` }}
                        transition={springs.smooth}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.05 }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
              KEUANGAN
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Pemasukan</p>
                <p className="text-sm font-bold" style={{ color: 'var(--pos)' }}>{formatRp(data.stats.totalIncome)}</p>
              </div>
              <div>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Pengeluaran</p>
                <p className="text-sm font-bold" style={{ color: 'var(--neg)' }}>{formatRp(data.stats.totalExpense)}</p>
              </div>
              <div>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Sisa Bersih</p>
                <p className="text-sm font-bold" style={{ color: data.stats.netProfit >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                  {formatRp(data.stats.netProfit)}
                </p>
              </div>
              {data.stats.netWorth !== null && (
                <div>
                  <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Kekayaan Bersih</p>
                  <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                    {formatRp(data.stats.netWorth)}
                    {data.stats.netWorthDelta !== null && (
                      <span className="text-[10px] font-semibold ml-1" style={{ color: data.stats.netWorthDelta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                        {data.stats.netWorthDelta >= 0 ? '▲' : '▼'} {formatRp(Math.abs(data.stats.netWorthDelta))}
                      </span>
                    )}
                  </p>
                </div>
              )}
            </div>
          </motion.div>

          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.1 }}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
                ✨ REKAP NARATIF AI
              </p>
              <motion.button
                onClick={handleGenerate}
                disabled={generating}
                whileTap={{ scale: 0.94 }}
                transition={springs.snappy}
                className="neu-cta text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-white flex-shrink-0"
                style={{ background: 'var(--accentFill)', opacity: generating ? 0.6 : 1 }}
              >
                {generating ? 'Menulis...' : data.narrative ? 'Buat Ulang' : 'Buat Rekap'}
              </motion.button>
            </div>
            {genError ? (
              <p className="text-xs" style={{ color: 'var(--neg)' }}>{genError}</p>
            ) : data.narrative ? (
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text)' }}>{data.narrative}</p>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text3)' }}>Belum ada rekap. Tap "Buat Rekap" untuk membuat narasi dari data bulan ini.</p>
            )}
          </motion.div>

          {history.length > 0 && (
            <motion.div
              className="rounded-[20px] p-5"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.gentle, delay: 0.15 }}
            >
              <p className="text-[10px] font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
                REKAP SEBELUMNYA
              </p>
              <div className="flex flex-col gap-3">
                {history.filter(h => h.month !== month).map(h => (
                  <button key={h.month} className="text-left" onClick={() => setMonth(h.month)}>
                    <p className="text-xs font-bold mb-0.5" style={{ color: 'var(--accent)' }}>{h.monthLabel}</p>
                    <p className="text-xs line-clamp-2" style={{ color: 'var(--text2)' }}>{h.narrative}</p>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      ) : null}
    </div>
  );
}
