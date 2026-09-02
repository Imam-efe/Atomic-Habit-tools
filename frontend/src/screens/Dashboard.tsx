import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, press } from '@/tokens/motion';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { useCommandStore } from '@/stores/commandStore';
import { apiFetch } from '@/lib/api';
import { formatRp } from '@/lib/currency';
import { canShare, shareProgress } from '@/lib/share';
import { isVoiceSupported } from '@/lib/voice';
import { useAppBadge } from '@/hooks';
import { resolveYear } from '@/data/holidays';
import type { RemoteHoliday, ResolvedHoliday } from '@/data/holidays';
import { observancesOn } from '@/data/observances';
import { todayISO, thisMonthISO } from '@/lib/date';

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

interface Brief {
  date: string;
  habits: { pending: number; total: number };
  events: Array<{ id: string; title: string; event_time: string | null }>;
  bills: { bills: Array<{ id: string; personName: string; daysUntil: number }>; total: number };
  missed: Array<{ id: string; name: string }>;
  expiring: Array<{ id: string; name: string; daysLeft: number }>;
  kids: Array<{ kidName: string; title: string }>;
}

interface PatternResult {
  patterns: Array<{ id: string; text: string }>;
}

interface AgendaItem {
  source: string;
  id: string;
  title: string;
  detail?: string | null;
  time?: string | null;
}

const PATTERN_LABELS: Record<string, string> = {
  sleep: 'Tidur', steps: 'Langkah', spend: 'Pengeluaran', habits: 'Kebiasaan',
};

export function Dashboard() {
  const { session } = useAuthStore();
  const { setTab } = useUIStore();
  const { openSearch, openQuickAdd } = useCommandStore();
  // Read once: the API either exists in this browser or it does not, and
  // re-checking on every render would just churn.
  const [voiceReady] = useState(isVoiceSupported);
  // "You just acted like X" — from the completed habit's linked goal. See
  // Habits.tsx's identical pattern; both screens can toggle a habit, so both
  // need it.
  const [identityFlash, setIdentityFlash] = useState<{ habitName: string; statement: string } | null>(null);
  useEffect(() => {
    if (!identityFlash) return;
    const t = setTimeout(() => setIdentityFlash(null), 3200);
    return () => clearTimeout(t);
  }, [identityFlash]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
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
  // Progressive enhancement: the rule-based texts above show instantly with
  // zero network cost; this fills in a moment later from Workers AI, and stays
  // null if that call fails, so the panel is never blocked on it.
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [loadingAiInsight, setLoadingAiInsight] = useState(false);

  // Insight lintas modul tambahan: Pagi Ini, Pola, dan agenda/info dari Kalender.
  const [brief, setBrief] = useState<Brief | null>(null);
  const [patterns, setPatterns] = useState<PatternResult | null>(null);
  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const [todayHoliday, setTodayHoliday] = useState<ResolvedHoliday | null>(null);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Selamat pagi' : hour < 17 ? 'Selamat siang' : 'Selamat malam';

  // Muat ulang tidak pernah mengosongkan `data` lebih dulu: angka yang sudah
  // ada tetap di layar sampai yang baru tiba, jadi membuka tab ini kembali
  // tidak mengedipkan seluruh halaman. Sebelum data pertama datang, kartunya
  // menampilkan '–' (lihat habitsText di bawah), bukan angka nol yang keliru.
  const loadData = async () => {
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

    // Pagi Ini, Pola, dan Kalender (agenda + info hari ini) tampil langsung di
    // halaman Beranda — bukan hanya di dalam modal Rangkuman Sistem — jadi
    // ini dimuat di sini, bukan saat generateInsights() dipanggil.
    const todayStr = todayISO();
    const year = Number(todayStr.slice(0, 4));
    try {
      const [briefRes, patternsRes, agendaRes, holidaysRes] = await Promise.all([
        apiFetch<Brief>('/daily/brief').catch(() => null),
        apiFetch<PatternResult>('/daily/patterns').catch(() => null),
        apiFetch<{ date: string; items: AgendaItem[] }>(`/calendar/agenda?date=${todayStr}`).catch(() => null),
        apiFetch<{ holidays: RemoteHoliday[] }>(`/holidays?year=${year}`).catch(() => null),
      ]);
      setBrief(briefRes);
      setPatterns(patternsRes);
      setAgenda(agendaRes?.items ?? []);
      const resolved = resolveYear(year, holidaysRes?.holidays ?? []);
      setTodayHoliday(resolved.holidays.find(h => h.date === todayStr) ?? null);
    } catch {}
  };

  useEffect(() => { loadData(); }, []);

  // The tab stays mounted between visits; aggregates edited on other tabs
  // (habits, budget) refresh silently each time the user comes back.
  useEffect(() => {
    const onShown = (e: Event) => {
      if ((e as CustomEvent).detail === 'beranda') loadData();
    };
    window.addEventListener('fayolla:tab-shown', onShown);
    return () => window.removeEventListener('fayolla:tab-shown', onShown);
  }, []);

  // Home Screen icon badge mirrors habits still open today.
  useAppBadge(data ? Math.max(0, data.habitsTotal - data.habitsDone) : 0);

  const generateInsights = async () => {
    setLoadingInsights(true);
    setShowInsights(true);
    try {
      const todayStr = todayISO();
      const monthStr = thisMonthISO();

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
      setLoadingInsights(false);

      // Fire-and-forget enhancement: the rule-based texts above are already
      // on screen, so a slow or missing AI backend never blocks anything.
      setAiInsight(null);
      setLoadingAiInsight(true);
      apiFetch<{ text: string }>('/insights/ai', {
        method: 'POST',
        body: JSON.stringify({
          habitScore,
          doneHabs,
          totalHabs,
          deepWorkHours,
          protein: consumedProt,
          proteinTarget: targetProt,
          income: monthlyIncome,
          expense: monthlySpent,
        }),
      })
        .then((res) => setAiInsight(res.text))
        .catch(() => {})
        .finally(() => setLoadingAiInsight(false));
    } catch {
      setLoadingInsights(false);
    }
  };

  const toggleHabit = async (id: string, isTwoMin?: boolean) => {
    // Save deep copy of previous state for rollback on error
    const prevHabits = habits.map(h => ({ ...h }));

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
      const res = await apiFetch<{ doneToday: boolean; streak: number; isTwoMinToday: boolean; identityStatement?: string | null }>(`/habits/${id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ isTwoMin }),
      });
      // Verify server response, update if different from optimistic
      setHabits(prev => prev.map(h => h.id === id ? { ...h, doneToday: res.doneToday, streak: res.streak, isTwoMinToday: res.isTwoMinToday } : h));
      // Silently refresh dashboard data in background
      apiFetch<DashboardData>('/dashboard').then(setData).catch(() => {});

      if (res.doneToday && res.identityStatement) {
        const habitName = habits.find(h => h.id === id)?.name ?? '';
        setIdentityFlash({ habitName, statement: res.identityStatement });
      }
    } catch {
      // Revert to previous state instead of full reload
      setHabits(prevHabits);
    }
  };

  const firstName = session?.user.name?.split(' ')[0] ?? '';
  const habitsText = data ? `${data.habitsDone}/${data.habitsTotal}` : '–/–';
  const streakText = data ? `${data.streak}` : '–';
  const goalsText = data ? `${data.goalsTotal}` : '–';

  const handleShare = () => {
    if (!data) return;
    shareProgress(
      `🔥 Streak ${data.streak} hari! ${data.habitsDone}/${data.habitsTotal} kebiasaan selesai hari ini. 1% lebih baik setiap hari dengan Fayolla.`
    );
  };

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      <AnimatePresence>
        {identityFlash && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={springs.gentle}
            className="fixed left-4 right-4 z-50 rounded-2xl px-4 py-3"
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
              background: 'var(--accentFill)',
              boxShadow: 'var(--neu-raised-lg)',
              maxWidth: 400,
              margin: '0 auto',
            }}
          >
            <p className="text-[13px] leading-snug text-white">
              <span aria-hidden>✨ </span>
              Kamu baru saja bertindak sebagai orang yang{' '}
              <span className="font-bold">{identityFlash.statement}</span>.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
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

        {/* Command bar — search and quick-add reach every module, so they live
            on the home screen rather than buried in one tab. */}
        <div className="flex items-center gap-2 mb-4">
          <motion.button
            whileTap={press.surface}
            onClick={openSearch}
            className="flex-1 min-w-0 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 neu-inset"
            style={{ background: 'var(--surface)' }}
          >
            <span className="text-[14px]" aria-hidden>🔍</span>
            <span className="text-[13px] truncate" style={{ color: 'var(--text3)' }}>
              Cari apa saja…
            </span>
          </motion.button>
          <motion.button
            whileTap={press.control}
            onClick={() => openQuickAdd()}
            aria-label="Catat cepat"
            className="w-11 h-11 rounded-2xl neu-cta flex items-center justify-center text-[17px] flex-shrink-0"
            style={{ background: 'var(--accentFill)', color: '#fff' }}
          >
            ⚡
          </motion.button>
          {voiceReady && (
            <motion.button
              whileTap={press.control}
              onClick={() => openQuickAdd({ listen: true })}
              aria-label="Catat dengan suara"
              className="w-11 h-11 rounded-2xl neu-press flex items-center justify-center text-[17px] flex-shrink-0"
              style={{ color: 'var(--text2)' }}
            >
              🎤
            </motion.button>
          )}
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

        {/* Pagi Ini, Pola, dan Kalender — insight lintas modul yang langsung
            tampak di Beranda, tanpa perlu membuka modal Rangkuman Sistem. */}
        {brief && (
          <motion.div
            whileTap={press.surface}
            onClick={() => { setTab('lainnya'); setTimeout(() => useUIStore.getState().setSubScreen('harian'), 20); }}
            className="rounded-[18px] p-3.5 mb-3 cursor-pointer border"
            style={{ background: 'var(--surface)', borderColor: 'var(--sep)' }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>🌤️ Pagi Ini</span>
              <span className="text-[10px]" style={{ color: 'var(--text3)' }}>Lihat semua ›</span>
            </div>
            <ul className="flex flex-col gap-1">
              {(() => {
                const lines: string[] = [];
                lines.push(
                  brief.habits.pending > 0
                    ? `${brief.habits.pending} dari ${brief.habits.total} kebiasaan belum selesai`
                    : brief.habits.total > 0
                      ? 'Semua kebiasaan sudah selesai ✅'
                      : 'Belum ada kebiasaan terdaftar'
                );
                if (brief.missed.length > 0) {
                  lines.push(`⚠️ Berisiko bolos dua kali: ${brief.missed.map(m => m.name).join(', ')}`);
                }
                if (brief.bills.total > 0) {
                  lines.push(`💳 ${brief.bills.bills.length} tagihan jatuh tempo · Rp${Math.round(brief.bills.total).toLocaleString('id-ID')}`);
                }
                if (brief.expiring.length > 0) {
                  lines.push(`🥫 ${brief.expiring.length} bahan makanan mau kedaluwarsa`);
                }
                if (brief.kids.length > 0) {
                  lines.push(`👶 ${brief.kids.length} jadwal anak besok`);
                }
                return lines.slice(0, 3).map((line, i) => (
                  <li key={i} className="text-[11px] leading-relaxed" style={{ color: 'var(--text2)' }}>{line}</li>
                ));
              })()}
            </ul>
          </motion.div>
        )}

        {patterns && patterns.patterns.length > 0 && (
          <motion.div
            whileTap={press.surface}
            onClick={() => { setTab('lainnya'); setTimeout(() => useUIStore.getState().setSubScreen('pola'), 20); }}
            className="rounded-[18px] p-3.5 mb-3 cursor-pointer border"
            style={{ background: 'var(--surface)', borderColor: 'var(--sep)' }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>🔗 Pola</span>
              <span className="text-[10px]" style={{ color: 'var(--text3)' }}>Lihat semua ›</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {patterns.patterns.slice(0, 2).map(p => (
                <li key={p.id} className="text-[11px] leading-relaxed" style={{ color: 'var(--text2)' }}>
                  <span className="font-bold" style={{ color: 'var(--text)' }}>{PATTERN_LABELS[p.id] ?? p.id}:</span> {p.text}
                </li>
              ))}
            </ul>
          </motion.div>
        )}

        {(() => {
          const todayStr = todayISO();
          const items = [
            ...(brief?.events.map(e => ({ id: e.id, title: e.title, time: e.event_time })) ?? []),
            ...agenda.map(a => ({ id: a.id, title: a.title, time: a.time ?? null })),
          ];
          const observances = observancesOn(todayStr);
          if (!todayHoliday && observances.length === 0 && items.length === 0) return null;

          return (
            <motion.div
              whileTap={press.surface}
              onClick={() => setTab('kalender')}
              className="rounded-[18px] p-3.5 mb-4 cursor-pointer border"
              style={{ background: 'var(--surface)', borderColor: 'var(--sep)' }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>🗓️ Kalender Hari Ini</span>
                <span className="text-[10px]" style={{ color: 'var(--text3)' }}>Buka Kalender ›</span>
              </div>
              {todayHoliday && (
                <p className="text-[11px] leading-relaxed mb-1" style={{ color: todayHoliday.kind === 'libur' ? 'var(--neg)' : 'var(--warn)' }}>
                  {todayHoliday.kind === 'libur' ? '🔴 Libur Nasional' : '🟠 Cuti Bersama'}: {todayHoliday.name}
                </p>
              )}
              {observances.length > 0 && (
                <p className="text-[11px] leading-relaxed mb-1" style={{ color: 'var(--text2)' }}>
                  {observances.map(o => o.name).join(', ')}
                </p>
              )}
              {items.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {items.slice(0, 3).map((it, i) => (
                    <li key={`${it.id}-${i}`} className="text-[11px] leading-relaxed" style={{ color: 'var(--text2)' }}>
                      • {it.title}{it.time ? ` — ${it.time}` : ''}
                    </li>
                  ))}
                  {items.length > 3 && (
                    <li className="text-[11px]" style={{ color: 'var(--text3)' }}>+{items.length - 3} lainnya</li>
                  )}
                </ul>
              )}
            </motion.div>
          );
        })()}

        {/* AI System Insights Modal */}
        <AnimatePresence>
          {showInsights && (
            <motion.div
              className="fixed inset-0 z-sheet flex items-end justify-center bg-black/60 backdrop-blur-sm"
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

                    {/* AI-generated insight — only appears if the backend has
                        ANTHROPIC_API_KEY configured; silently absent otherwise. */}
                    {(loadingAiInsight || aiInsight) && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-3.5 rounded-2xl border"
                        style={{ background: 'var(--accentSoft)', borderColor: 'var(--accent)' }}
                      >
                        <span className="text-xs font-bold block mb-1.5" style={{ color: 'var(--accent)' }}>✨ AI Insight</span>
                        {loadingAiInsight ? (
                          <p className="text-xs" style={{ color: 'var(--text3)' }}>Menganalisis pola harianmu...</p>
                        ) : (
                          <p className="text-xs leading-relaxed" style={{ color: 'var(--text2)' }}>{aiInsight}</p>
                        )}
                      </motion.div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-center py-10" style={{ color: 'var(--text3)' }}>Gagal memuat rekap harian</p>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Identity Hero Card */}
        <motion.div className="rounded-[24px] p-5 mb-4 relative"
          style={{ background: 'linear-gradient(135deg, var(--accentFill), var(--accentFill2))', boxShadow: 'var(--neu-raised-lg)' }}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springs.gentle, delay: 0.06 }}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.7)' }}>
              IDENTITY HARI INI
            </p>
            {canShare() && (
              <button
                onClick={handleShare}
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm"
                style={{ background: 'rgba(255,255,255,0.16)' }}
                aria-label="Bagikan progres"
              >
                📤
              </button>
            )}
          </div>
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
          {/* Goals kini sub-layar di bawah Lainnya, bukan tab sendiri —
              pola bukanya sama dengan kartu modul lain di bawah. */}
          <div onClick={() => { setTab('lainnya'); setTimeout(() => useUIStore.getState().setSubScreen('goals'), 20); }}
            className="rounded-[18px] p-4 cursor-pointer border flex flex-col justify-between"
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
