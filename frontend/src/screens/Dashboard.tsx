import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { apiFetch } from '@/lib/api';

interface DashboardData {
  habitsTotal: number;
  habitsDone: number;
  goalsTotal: number;
  streak: number;
  identityStatement: string;
  missedHabitAlert: string | null;
  budget: { income: number; expense: number };
}

interface Habit {
  id: string;
  name: string;
  color: string;
  streak: number;
  doneToday: boolean;
  isTwoMinToday?: boolean;
  twoMin?: string | null;
}

interface ActivityLog {
  id: string;
  label: string;
  hours: number;
}

interface NutritionData {
  summary: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  target: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
}

interface NetWorthData {
  current: { assets: number; liabilities: number; net_worth: number; month: string };
  history: { month: string; assets: number; liabilities: number; net_worth: number }[];
}

function formatRp(n: number) {
  return n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}

export function Dashboard() {
  const { session } = useAuthStore();
  const { setTab } = useUIStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(true);
  const [netWorth, setNetWorth] = useState<NetWorthData | null>(null);

  // System Insights State
  const [showInsights, setShowInsights] = useState(false);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [insights, setInsights] = useState<{
    habitText: string;
    habitScore: number;
    activityText: string;
    nutritionText: string;
    budgetText: string;
  } | null>(null);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Selamat pagi' : hour < 17 ? 'Selamat siang' : 'Selamat malam';

  const loadData = async () => {
    setLoading(true);
    try {
      const [dash, habs, nw] = await Promise.all([
        apiFetch<DashboardData>('/dashboard'),
        apiFetch<Habit[]>('/habits'),
        apiFetch<NetWorthData>('/net-worth').catch(() => null),
      ]);
      setData(dash);
      setHabits(habs);
      setNetWorth(nw);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const generateInsights = async () => {
    setLoadingInsights(true);
    setShowInsights(true);
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const monthStr = new Date().toISOString().slice(0, 7);

      const [activities, nutrition, budget] = await Promise.all([
        apiFetch<ActivityLog[]>('/activity'),
        apiFetch<NutritionData>(`/nutrition?date=${todayStr}`),
        apiFetch<any>(`/budget?month=${monthStr}`)
      ]);

      // 1. Habits Evaluation
      const totalHabs = data?.habitsTotal ?? 0;
      const doneHabs = data?.habitsDone ?? 0;
      const habitScore = totalHabs > 0 ? Math.round((doneHabs / totalHabs) * 100) : 0;
      let habitText = '';
      if (totalHabs === 0) {
        habitText = 'Belum ada kebiasaan terdaftar hari ini. Mulai tambahkan 1 kebiasaan kecil di tab Kebiasaan.';
      } else if (habitScore === 100) {
        habitText = 'Luar biasa! Konsistensi 100% hari ini. Anda membuktikan identitas baru Anda! 🌟';
      } else if (habitScore >= 50) {
        habitText = `Bagus! Anda menyelesaikan ${doneHabs} dari ${totalHabs} kebiasaan hari ini. Tetap pertahankan momentum! 📈`;
      } else {
        habitText = 'Ingat kaidah Atomic Habits: "Never miss twice" (Jangan bolos dua kali berturut-turut). Pastikan besok selesai ya! ⚠️';
      }

      // 2. Activity / Deep Work Evaluation
      const deepWorkHours = activities.filter(a => a.label === 'Deep Work').reduce((s, a) => s + a.hours, 0);
      let activityText = '';
      if (deepWorkHours >= 2) {
        activityText = `Hebat! Anda meluangkan waktu fokus (Deep Work) selama ${deepWorkHours} jam hari ini. Ini modal penting bagi sistem produktivitas Anda. 🚀`;
      } else if (deepWorkHours > 0) {
        activityText = `Tercatat ${deepWorkHours} jam Deep Work hari ini. Cobalah gunakan Timer Fokus besok untuk memperpanjang sesi produktif Anda. ⏳`;
      } else {
        activityText = 'Belum ada catatan waktu fokus (Deep Work) hari ini. Cobalah luangkan 25 menit besok pagi menggunakan Timer Pomodoro! ⏱️';
      }

      // 3. Nutrition / Protein Evaluation
      const consumedProt = nutrition.summary?.protein ?? 0;
      const targetProt = nutrition.target?.protein ?? 120;
      let nutritionText = '';
      if (consumedProt >= targetProt) {
        nutritionText = `Asupan protein Anda tercapai (${consumedProt}g / ${targetProt}g)! Otot dan energi Anda ternutrisi maksimal hari ini. 💪`;
      } else if (consumedProt > 0) {
        const gap = targetProt - consumedProt;
        nutritionText = `Asupan protein kurang ${gap}g hari ini. Tambahkan makanan padat protein seperti telur rebus atau tempe pada makan berikutnya. 🍳`;
      } else {
        nutritionText = 'Belum ada log nutrisi terdaftar hari ini. Cobalah catat makanan Anda untuk menjaga sistem kebugaran tubuh. 🍎';
      }

      // 4. Budget Evaluation
      const monthlySpent = budget.summary?.expense ?? 0;
      const monthlyIncome = budget.summary?.income ?? 0;
      let budgetText = '';
      if (monthlyIncome > 0) {
        const spentPct = (monthlySpent / monthlyIncome) * 100;
        if (spentPct > 100) {
          budgetText = 'Lampu Merah! Pengeluaran bulan ini sudah melebihi total pendapatan. Segera perketat ikat pinggang! 🚨';
        } else if (spentPct >= 80) {
          budgetText = `Pengeluaran bulan ini mencapai ${Math.round(spentPct)}% dari pendapatan. Kurangi pengeluaran hiburan/belanja yang tidak penting. ⚠️`;
        } else {
          budgetText = `Keuangan sehat! Pengeluaran baru memakai ${Math.round(spentPct)}% dari total pendapatan bulan ini. Tetap hemat! 💵`;
        }
      } else {
        budgetText = 'Belum ada pendapatan terdaftar di bulan ini. Catat transaksi masuk di modul Keuangan untuk memantau porsi budget.';
      }

      setInsights({
        habitText,
        habitScore,
        activityText,
        nutritionText,
        budgetText
      });
    } catch {}
    setLoadingInsights(false);
  };

  const toggleHabit = async (id: string, isTwoMin?: boolean) => {
    setHabits(prev => prev.map(h => {
      if (h.id === id) {
        const done = !h.doneToday;
        return {
          ...h,
          doneToday: done,
          isTwoMinToday: done ? !!isTwoMin : false,
          streak: done ? h.streak + 1 : Math.max(0, h.streak - 1),
        };
      }
      return h;
    }));

    try {
      const res = await apiFetch<{ doneToday: boolean; streak: number; isTwoMinToday: boolean }>(`/habits/${id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ isTwoMin }),
      });
      setHabits(prev => prev.map(h => h.id === id ? { ...h, doneToday: res.doneToday, streak: res.streak, isTwoMinToday: res.isTwoMinToday } : h));
      apiFetch<DashboardData>('/dashboard').then(setData).catch(() => {});
    } catch {
      loadData();
    }
  };

  const firstName = session?.user.name?.split(' ')[0] ?? '';
  const habitsText = data ? `${data.habitsDone}/${data.habitsTotal}` : '–/–';
  const streakText = data ? `${data.streak}` : '–';
  const goalsText = data ? `${data.goalsTotal}` : '–';

  return (
    <div className="min-h-screen px-5 pt-16 pb-28 animate-[fyScreen_420ms_cubic-bezier(0.25,0.46,0.45,0.94)_both]" style={{ background: 'var(--bg)' }}>
      <motion.div initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={springs.gentle}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--text2)' }}>
              {now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}>
              {greeting}, {firstName}
            </h1>
          </div>
          <div className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0"
            style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}>
            {session?.user.name?.[0] ?? 'A'}
          </div>
        </div>

        {/* AI System Insights Banner */}
        <div 
          onClick={generateInsights}
          className="rounded-[18px] p-3.5 mb-4 flex items-center justify-between cursor-pointer transition-all border bg-zinc-900/10 dark:bg-white/5"
          style={{ borderColor: 'var(--sep)' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">💡</span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white" style={{ color: 'var(--text)' }}>Rangkuman Sistem Hari Ini</p>
              <p className="text-[10px] truncate text-[var(--text2)]">Analisis kebiasaan, waktu, keuangan & nutrisi</p>
            </div>
          </div>
          <span className="neu-cta text-[10px] font-bold px-2 py-1 rounded-lg text-white" style={{ background: 'var(--accentFill)' }}>Lihat</span>
        </div>

        {/* AI System Insights Modal */}
        <AnimatePresence>
          {showInsights && (
            <motion.div
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="w-full max-w-[430px] rounded-t-[30px] p-5 flex flex-col gap-4 shadow-2xl relative"
                style={{ background: 'var(--surface)', boxShadow: 'var(--neu-sheet)', maxHeight: '85vh', overflowY: 'auto' }}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={springs.snappy}
              >
                {/* Drag handle decoration */}
                <div className="w-12 h-1.5 rounded-full mx-auto bg-neutral-600 mb-1" />

                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-black text-[var(--accent)] block uppercase tracking-widest">💡 ANALISIS PERSONAL SYSTEM</span>
                    <h3 className="text-lg font-black text-white" style={{ color: 'var(--text)' }}>
                      Rangkuman Sistem {now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })}
                    </h3>
                  </div>
                  <button
                    onClick={() => setShowInsights(false)}
                    className="w-7 h-7 rounded-full bg-zinc-950/15 flex items-center justify-center font-bold"
                  >
                    ×
                  </button>
                </div>

                {loadingInsights ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
                    <span className="text-xs text-[var(--text2)]">Merangkum data harian...</span>
                  </div>
                ) : insights ? (
                  <div className="flex flex-col gap-4">
                    {/* Habits consistency */}
                    <div className="p-3.5 rounded-2xl bg-zinc-950/10 dark:bg-white/5 border" style={{ borderColor: 'var(--sep)' }}>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-xs font-bold text-white">🔄 Konsistensi Kebiasaan</span>
                        <span className="text-xs font-extrabold text-[var(--accent)]">{insights.habitScore}%</span>
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text2)' }}>
                        {insights.habitText}
                      </p>
                    </div>

                    {/* Time allocation */}
                    <div className="p-3.5 rounded-2xl bg-zinc-950/10 dark:bg-white/5 border" style={{ borderColor: 'var(--sep)' }}>
                      <span className="text-xs font-bold text-white block mb-1.5">⏱️ Alokasi Waktu Fokus</span>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text2)' }}>
                        {insights.activityText}
                      </p>
                    </div>

                    {/* Nutrition */}
                    <div className="p-3.5 rounded-2xl bg-zinc-950/10 dark:bg-white/5 border" style={{ borderColor: 'var(--sep)' }}>
                      <span className="text-xs font-bold text-white block mb-1.5">🍎 Nutrisi & Protein</span>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text2)' }}>
                        {insights.nutritionText}
                      </p>
                    </div>

                    {/* Finance */}
                    <div className="p-3.5 rounded-2xl bg-zinc-950/10 dark:bg-white/5 border" style={{ borderColor: 'var(--sep)' }}>
                      <span className="text-xs font-bold text-white block mb-1.5">💵 Keuangan & Budget</span>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text2)' }}>
                        {insights.budgetText}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-center py-10" style={{ color: 'var(--text3)' }}>Gagal memuat rekap harian</p>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Identity Hero Card */}
        <motion.div className="rounded-[24px] p-5 mb-4"
          style={{ background: 'linear-gradient(135deg, var(--accentFill), var(--accentFill2))', boxShadow: 'var(--neu-raised-lg)' }}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springs.gentle, delay: 0.06 }}>
          <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.7)' }}>
            IDENTITY HARI INI
          </p>
          <p className="text-lg font-bold text-white leading-snug">
            {data?.identityStatement ?? 'Saya adalah orang yang terus berkembang 1% setiap hari.'}
          </p>
          <div className="flex gap-6 mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.2)' }}>
            {[
              { label: 'Kebiasaan', value: habitsText },
              { label: 'Streak', value: streakText },
              { label: 'Goals', value: goalsText },
            ].map((stat, i) => (
              <div key={i} className="flex-1 text-center">
                <p className="text-2xl font-extrabold text-white">{stat.value}</p>
                <p className="text-[11px] text-white/70 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Missed Habit Alert (Never Miss Twice) */}
        {data?.missedHabitAlert && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 flex gap-3 items-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--warnBorder)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.08 }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base"
              style={{ background: 'rgba(255,159,10,0.16)', color: 'var(--warn)' }}>
              ⚠️
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>Jangan lewat dua kali</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text2)' }}>{data.missedHabitAlert}</p>
            </div>
          </motion.div>
        )}

        {/* Today's Habits (Quick Preview) */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>Kebiasaan hari ini</h2>
            <button onClick={() => setTab('kebiasaan')} className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
              Semua
            </button>
          </div>

          {habits.length === 0 ? (
            <div className="rounded-[18px] p-4 border border-dashed flex flex-col items-center justify-center py-8 gap-2" style={{ borderColor: 'var(--sep)' }}>
              <p className="text-xs" style={{ color: 'var(--text3)' }}>Belum ada kebiasaan untuk hari ini</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {habits.slice(0, 3).map((h) => (
                <div
                  key={h.id}
                  onClick={() => toggleHabit(h.id, h.isTwoMinToday)}
                  className="rounded-[18px] p-3 flex items-center justify-between cursor-pointer border transition-all"
                  style={{
                    background: 'var(--surface)',
                    // Completed habits sink into the surface; pending ones stay raised.
                    boxShadow: h.doneToday ? 'var(--neu-pressed)' : 'var(--neu-raised)',
                    borderColor: h.doneToday ? h.color + '55' : 'transparent'
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-semibold flex-shrink-0" style={{ background: h.color + '20', color: h.color }}>
                      ✨
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)', textDecoration: h.doneToday ? 'line-through' : 'none' }}>
                        {h.name}
                      </p>
                      <p className="text-[10px] flex items-center gap-2" style={{ color: 'var(--text3)' }}>
                        <span>🔥 {h.streak} hari streak</span>
                        {h.doneToday && h.isTwoMinToday && (
                          <span className="text-[var(--pos)] font-bold">⚡ 2M</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    {!h.doneToday && h.twoMin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleHabit(h.id, true);
                        }}
                        className="px-2 py-1 rounded-lg font-bold text-[9px] text-white flex items-center gap-0.5"
                        style={{ background: 'var(--accentFill)' }}
                      >
                        ⚡ 2M
                      </button>
                    )}

                    <div className="w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                      style={{
                        borderColor: h.color,
                        background: h.doneToday ? h.color : 'transparent',
                        borderStyle: h.doneToday && h.isTwoMinToday ? 'dashed' : 'solid',
                      }}
                    >
                      {h.doneToday && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* System Module Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div onClick={() => setTab('goals')} className="rounded-[18px] p-4 cursor-pointer border flex flex-col justify-between"
            style={{ background: 'var(--surface)', borderColor: 'transparent', boxShadow: 'var(--neu-raised)' }}>
            <div className="flex justify-between items-start">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ background: 'rgba(124,92,255,0.16)', color: '#7C5CFF' }}>🎯</div>
              <span className="text-xl font-bold" style={{ color: 'var(--text)' }}>{goalsText}</span>
            </div>
            <div className="mt-4">
              <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Goals</p>
              <p className="text-[11px]" style={{ color: 'var(--text2)' }}>Identity tracker</p>
            </div>
          </div>

          <div onClick={() => setTab('uang')} className="rounded-[18px] p-4 cursor-pointer border flex flex-col justify-between"
            style={{ background: 'var(--surface)', borderColor: 'transparent', boxShadow: 'var(--neu-raised)' }}>
            <div className="flex justify-between items-start">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ background: 'rgba(52,199,89,0.16)', color: 'var(--pos)' }}>💰</div>
              <span className="text-xs font-extrabold text-[var(--pos)]">Uang</span>
            </div>
            <div className="mt-4">
              <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Budget</p>
              <p className="text-[11px]" style={{ color: 'var(--text2)' }}>Ringkasan saldo</p>
            </div>
          </div>
        </div>

        {/* Net Worth Card */}
        {netWorth && (
          <motion.div
            className="rounded-[18px] p-4 mt-2.5"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.1 }}
          >
            <div className="flex justify-between items-center mb-3">
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text3)' }}>NET WORTH</p>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(52,199,89,0.12)', color: 'var(--pos)' }}>
                {netWorth.current.month}
              </span>
            </div>
            <p
              className="text-2xl font-extrabold mb-3"
              style={{ color: netWorth.current.net_worth >= 0 ? 'var(--pos)' : 'var(--neg)' }}
            >
              {formatRp(netWorth.current.net_worth)}
            </p>
            <div className="flex gap-4">
              <div>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Aset</p>
                <p className="text-xs font-bold text-[var(--pos)]">{formatRp(netWorth.current.assets)}</p>
              </div>
              <div>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Utang</p>
                <p className="text-xs font-bold text-[var(--neg)]">{formatRp(netWorth.current.liabilities)}</p>
              </div>
            </div>
            {netWorth.history.length > 1 && (
              <div className="mt-3 pt-3 flex gap-1 items-end" style={{ borderTop: '1px solid var(--sep)', height: 40 }}>
                {netWorth.history.map((h, i) => {
                  const max = Math.max(...netWorth.history.map(x => Math.abs(x.net_worth)), 1);
                  const pct = Math.abs(h.net_worth) / max;
                  const isNeg = h.net_worth < 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col justify-end items-center">
                      <div
                        className="w-full rounded-sm"
                        style={{
                          height: `${Math.max(pct * 28, 4)}px`,
                          background: isNeg ? '#FF453A60' : '#34C75960',
                        }}
                        title={`${h.month}: ${formatRp(h.net_worth)}`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {/* Wide Module deep-links */}
        <div className="flex flex-col gap-2.5">
          {[
            { label: 'Projects & Tasks', id: 'projects', desc: 'Lihat tugas terhubung dengan goals', icon: '📁', bg: 'rgba(10,132,255,0.16)', color: '#0A84FF' },
            { label: 'Alokasi Waktu', id: 'activity', desc: 'Analisis Deep vs Shallow Work harian', icon: '⏱️', bg: 'rgba(94,92,230,0.16)', color: '#5E5CE6' },
            { label: 'Nutrisi & Makanan', id: 'nutrition', desc: 'Catat kalori & makronutrisi harian', icon: '🍎', bg: 'rgba(230, 57, 70, 0.16)', color: '#E63946' },
          ].map((m) => (
            <div
              key={m.id}
              onClick={() => {
                setTab('lainnya');
                setTimeout(() => useUIStore.getState().setSubScreen(m.id), 20);
              }}
              className="rounded-[18px] p-3 flex items-center justify-between cursor-pointer border"
              style={{ background: 'var(--surface)', borderColor: 'transparent', boxShadow: 'var(--neu-raised)' }}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base" style={{ background: m.bg, color: m.color }}>
                  {m.icon}
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{m.label}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text2)' }}>{m.desc}</p>
                </div>
              </div>
              <span className="text-[var(--text3)] text-lg">›</span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
