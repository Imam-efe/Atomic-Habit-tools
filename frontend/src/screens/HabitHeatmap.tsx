import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface HabitData {
  habitId: string;
  name: string;
  color: string;
  dates: string[];
  startDate: string;
  today: string;
}

function buildGrid(startDate: string, today: string, completedSet: Set<string>) {
  const parts = startDate.split('-');
  const start = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const dayOfWeek = start.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  start.setDate(start.getDate() + diff);

  const todayDate = new Date(today);
  const weeks: { date: string; done: boolean; future: boolean }[][] = [];

  for (let w = 0; w < 52; w++) {
    const week: { date: string; done: boolean; future: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const current = new Date(start);
      current.setDate(start.getDate() + w * 7 + d);
      const dateStr = current.toISOString().slice(0, 10);
      week.push({
        date: dateStr,
        done: completedSet.has(dateStr),
        future: current > todayDate,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];

function getMonthLabels(weeks: { date: string }[][]) {
  const labels: { month: string; col: number }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, i) => {
    const d = new Date(week[0].date);
    const m = d.getMonth();
    if (m !== lastMonth) {
      labels.push({ month: MONTH_LABELS[m], col: i });
      lastMonth = m;
    }
  });
  return labels;
}

export function HabitHeatmap() {
  const { goBack } = useUIStore();
  const [habits, setHabits] = useState<HabitData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedHabit, setSelectedHabit] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<HabitData[]>('/habits/completions?weeks=52')
      .then(res => {
        setHabits(res);
        if (res.length > 0) setSelectedHabit(res[0].habitId);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const activeHabit = habits.find(h => h.habitId === selectedHabit);
  const completedSet = new Set(activeHabit?.dates ?? []);
  const weeks = activeHabit ? buildGrid(activeHabit.startDate, activeHabit.today, completedSet) : [];
  const monthLabels = getMonthLabels(weeks);

  const totalDone = activeHabit?.dates.length ?? 0;
  const longestStreak = (() => {
    if (!activeHabit) return 0;
    let max = 0; let cur = 0;
    const sorted = [...activeHabit.dates].sort();
    for (let i = 0; i < sorted.length; i++) {
      if (i === 0) { cur = 1; max = 1; continue; }
      const prev = new Date(sorted[i - 1]);
      const curr = new Date(sorted[i]);
      const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
      if (diff === 1) { cur++; max = Math.max(max, cur); }
      else { cur = 1; }
    }
    return max;
  })();

  return (
    <div
      className="min-h-screen px-5 pt-14 pb-28 animate-[fyScreen_420ms_cubic-bezier(0.25,0.46,0.45,0.94)_both]"
      style={{ background: 'var(--bg)' }}
    >
      <div className="flex items-center gap-3 mb-6">
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
          Heatmap Kebiasaan
        </h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : habits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-4xl">📅</p>
          <p className="font-semibold" style={{ color: 'var(--text2)' }}>Belum ada kebiasaan</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap mb-5">
            {habits.map(h => (
              <motion.button
                key={h.habitId}
                className="px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{
                  background: selectedHabit === h.habitId ? h.color : 'var(--surface)',
                  color: selectedHabit === h.habitId ? 'white' : 'var(--text2)',
                  boxShadow: selectedHabit === h.habitId ? 'var(--neu-pressed)' : 'var(--neu-raised-sm)',
                }}
                onClick={() => setSelectedHabit(h.habitId)}
                whileTap={{ scale: 0.93 }}
                transition={springs.snappy}
              >
                {h.name}
              </motion.button>
            ))}
          </div>

          {activeHabit && (
            <motion.div
              key={activeHabit.habitId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springs.gentle}
            >
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-[16px] p-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text3)' }}>Total Hari</p>
                  <p className="text-2xl font-black" style={{ color: activeHabit.color }}>{totalDone}</p>
                </div>
                <div className="rounded-[16px] p-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text3)' }}>Streak Terpanjang</p>
                  <p className="text-2xl font-black" style={{ color: activeHabit.color }}>{longestStreak}🔥</p>
                </div>
              </div>

              <div
                className="rounded-[20px] p-4 overflow-x-auto"
                style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              >
                <div className="relative h-5 mb-1" style={{ minWidth: weeks.length * 13 }}>
                  {monthLabels.map(({ month, col }) => (
                    <span
                      key={`${month}-${col}`}
                      className="absolute text-[9px] font-bold"
                      style={{ color: 'var(--text3)', left: col * 13 }}
                    >
                      {month}
                    </span>
                  ))}
                </div>
                <div className="flex gap-[3px]" style={{ minWidth: weeks.length * 13 }}>
                  {weeks.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-[3px]">
                      {week.map((day) => (
                        <div
                          key={day.date}
                          className="w-[10px] h-[10px] rounded-[2px]"
                          style={{
                            background: day.future
                              ? 'transparent'
                              : day.done
                                ? activeHabit.color
                                : 'var(--track)',
                            border: day.future ? '1px solid var(--sep)' : 'none',
                            opacity: day.done ? 1 : day.future ? 0.3 : 0.35,
                          }}
                          title={day.date}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 mt-3 text-[9px] font-bold" style={{ color: 'var(--text3)' }}>
                  <span>Sen</span><span>Sel</span><span>Rab</span><span>Kam</span><span>Jum</span><span>Sab</span><span>Min</span>
                </div>
              </div>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
