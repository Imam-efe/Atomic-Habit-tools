import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { readableOn } from '@/lib/color';
import { useUIStore } from '@/stores/uiStore';

interface Habit {
  id: string;
  name: string;
}

interface Goal {
  id: string;
  identityStatement: string;
  color: string;
  habitIds: string[];
  progress: number;
  level?: number;
  currentExp?: number;
  nextLevelExp?: number;
  totalExp?: number;
}

interface ScoreData {
  today: number;
  history: { date: string; score: number }[];
  goals: { id: string; identityStatement: string; color: string; habitCount: number; score: number }[];
}

const COLORS = ['#7C5CFF', 'var(--pos)', '#0A84FF', 'var(--warn)', 'var(--neg)', '#FF2D55'];

export function Goals() {
  const theme = useUIStore((s) => s.theme);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState<ScoreData | null>(null);

  // Add Goal Form State
  const [showAdd, setShowAdd] = useState(false);
  const [statement, setStatement] = useState('');
  const [color, setColor] = useState('#7C5CFF');
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Edit Goal Form State
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [editStatement, setEditStatement] = useState('');
  const [editColor, setEditColor] = useState('#7C5CFF');
  const [editSelectedHabitIds, setEditSelectedHabitIds] = useState<string[]>([]);
  const [updating, setUpdating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [goalsRes, habitsRes, scoreRes] = await Promise.all([
        apiFetch<Goal[]>('/goals'),
        apiFetch<Habit[]>('/habits'),
        apiFetch<ScoreData>('/goals/score'),
      ]);
      setGoals(goalsRes);
      setHabits(habitsRes);
      setScore(scoreRes);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addGoal = async () => {
    if (!statement.trim()) return;
    setSaving(true);
    try {
      await apiFetch<Goal>('/goals', {
        method: 'POST',
        body: JSON.stringify({
          identityStatement: statement.trim(),
          color,
          habitIds: selectedHabitIds,
        }),
      });
      load();
      setStatement('');
      setSelectedHabitIds([]);
      setShowAdd(false);
    } catch {}
    setSaving(false);
  };

  const updateGoal = async () => {
    if (!editingGoal || !editStatement.trim()) return;
    setUpdating(true);
    try {
      await apiFetch(`/goals/${editingGoal.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          identityStatement: editStatement.trim(),
          color: editColor,
          habitIds: editSelectedHabitIds,
        }),
      });
      load();
      setEditingGoal(null);
    } catch {}
    setUpdating(false);
  };

  const deleteGoal = async (id: string) => {
    // optimistic delete
    setGoals(g => g.filter(x => x.id !== id));
    await apiFetch(`/goals/${id}`, { method: 'DELETE' }).catch(() => load());
  };

  // Toggle habit selection in Add Form
  const toggleHabitInAdd = (habitId: string) => {
    setSelectedHabitIds(prev =>
      prev.includes(habitId) ? prev.filter(id => id !== habitId) : [...prev, habitId]
    );
  };

  // Toggle habit selection in Edit Form
  const toggleHabitInEdit = (habitId: string) => {
    setEditSelectedHabitIds(prev =>
      prev.includes(habitId) ? prev.filter(id => id !== habitId) : [...prev, habitId]
    );
  };

  // Calculate Compounding curve path coordinates
  const svgW = 300;
  const svgH = 100;
  let compoundPath = '';
  let compoundArea = '';

  for (let i = 0; i <= svgW; i += 3) {
    const pct = i / svgW;
    const days = pct * 365;
    const val = Math.pow(1.01, days);
    const maxVal = Math.pow(1.01, 365);
    const y = svgH - 10 - ((val - 1) / (maxVal - 1)) * (svgH - 20);

    if (i === 0) {
      compoundPath += `M ${i} ${y}`;
      compoundArea += `M ${i} ${svgH - 10} L ${i} ${y}`;
    } else {
      compoundPath += ` L ${i} ${y}`;
      compoundArea += ` L ${i} ${y}`;
    }
  }
  compoundArea += ` L ${svgW} ${svgH - 10} Z`;

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}>
          Goals
        </h1>
        <motion.button
          className="neu-cta w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: 'var(--accentFill)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={() => setShowAdd(s => !s)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </motion.button>
      </div>

      {/* Identity Score Card */}
      {score && (
        <motion.div
          className="rounded-[22px] p-5 mb-4"
          style={{
            background: `linear-gradient(135deg, var(--accentFill), var(--accentFill2))`,
            boxShadow: 'var(--neu-raised-lg)',
          }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.gentle}
        >
          <p className="text-[10px] font-extrabold uppercase tracking-wider mb-1 text-white/70">
            IDENTITY SCORE HARI INI
          </p>
          <div className="flex items-end gap-2 mb-3">
            <span className="text-5xl font-black text-white" style={{ letterSpacing: '-1px' }}>
              {score.today}%
            </span>
            <span className="text-sm text-white/70 mb-1.5">identitas terpenuhi</span>
          </div>
          <div className="flex items-end gap-1 h-10">
            {score.history.map((d, i) => {
              const isToday = i === score.history.length - 1;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
                  <motion.div
                    className="w-full rounded-t-[3px]"
                    style={{
                      background: isToday ? 'white' : 'rgba(255,255,255,0.35)',
                      minHeight: 2,
                    }}
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max(4, (d.score / 100) * 36)}px` }}
                    transition={{ ...springs.smooth, delay: i * 0.04 }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-white/50">
              {score.history[0]?.date.slice(5).replace('-', '/')}
            </span>
            <span className="text-[9px] text-white/50">hari ini</span>
          </div>
        </motion.div>
      )}

      {/* Compounding Chart Card */}
      <motion.div
        className="rounded-[22px] p-5 mb-5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.gentle}
      >
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-sm font-bold" style={{ color: 'var(--text)' }}>Efek 1% setiap hari</h2>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text2)' }}>1.01³⁶⁵ = 37,8× lebih baik</p>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}>
            365 hari
          </span>
        </div>
        {/* SVG Drawing */}
        <div className="mt-4 relative h-[100px] w-full">
          <svg viewBox="0 0 300 100" className="w-full h-full overflow-visible">
            {/* Linear Baseline */}
            <line x1="0" y1="90" x2="300" y2="90" stroke="var(--sep)" strokeWidth="1" strokeDasharray="3 3" />
            {/* Gradient Area Fill */}
            <path d={compoundArea} fill="var(--accentSoft)" stroke="none" />
            {/* Exponential Curve */}
            <motion.path
              d={compoundPath}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
            />
          </svg>
        </div>
        <div className="flex justify-between text-[9px] font-bold mt-2" style={{ color: 'var(--text3)' }}>
          <span>Hari 1</span>
          <span>Hari 90</span>
          <span>Hari 365</span>
        </div>
      </motion.div>

      {/* Add Goal Modal */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            <p className="text-sm font-semibold text-white">Tambah Goal Identitas</p>
            <p className="text-[11px] -mb-1" style={{ color: 'var(--text3)' }}>Saya adalah orang yang...</p>
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              placeholder="...terus belajar setiap hari"
              value={statement}
              onChange={e => setStatement(e.target.value)}
              autoFocus
            />

            {/* Color Swatches */}
            <div className="flex gap-2 justify-between px-1">
              {COLORS.map(c => (
                <motion.button
                  key={c}
                  className="w-7 h-7 rounded-full flex-shrink-0"
                  style={{ background: c, border: color === c ? '2px solid white' : 'none', boxShadow: color === c ? `0 0 0 2px ${c}` : 'none' }}
                  whileTap={{ scale: 0.85 }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>

            {/* Connect Habits Selector */}
            {habits.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-1">
                <p className="text-[10px] font-bold text-[var(--text2)] uppercase">Hubungkan Kebiasaan</p>
                <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {habits.map(h => {
                    const isChecked = selectedHabitIds.includes(h.id);
                    return (
                      <div
                        key={h.id}
                        onClick={() => toggleHabitInAdd(h.id)}
                        className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer"
                        style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
                      >
                        <div className="w-4 h-4 rounded border flex items-center justify-center" style={{ borderColor: isChecked ? 'var(--accent)' : 'var(--text3)', background: isChecked ? 'var(--accentFill)' : 'transparent' }}>
                          {isChecked && <span className="text-[9px] text-white">✓</span>}
                        </div>
                        <span className="text-xs" style={{ color: 'var(--text)' }}>{h.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-2">
              <motion.button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: color, opacity: saving ? 0.6 : 1 }}
                onClick={addGoal}
                disabled={saving}
                whileTap={{ scale: 0.97 }}
              >
                {saving ? 'Menyimpan...' : 'Simpan Goal'}
              </motion.button>
              <button
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                onClick={() => { setShowAdd(false); setStatement(''); setSelectedHabitIds([]); }}
              >
                Batal
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Goal Modal */}
      <AnimatePresence>
        {editingGoal && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            <p className="text-sm font-semibold text-white">Edit Goal Identitas</p>
            <p className="text-[11px] -mb-1" style={{ color: 'var(--text3)' }}>Saya adalah orang yang...</p>
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              value={editStatement}
              onChange={e => setEditStatement(e.target.value)}
              autoFocus
            />

            {/* Color Swatches */}
            <div className="flex gap-2 justify-between px-1">
              {COLORS.map(c => (
                <motion.button
                  key={c}
                  className="w-7 h-7 rounded-full flex-shrink-0"
                  style={{ background: c, border: editColor === c ? '2px solid white' : 'none', boxShadow: editColor === c ? `0 0 0 2px ${c}` : 'none' }}
                  whileTap={{ scale: 0.85 }}
                  onClick={() => setEditColor(c)}
                />
              ))}
            </div>

            {/* Connect Habits Selector */}
            {habits.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-1">
                <p className="text-[10px] font-bold text-[var(--text2)] uppercase">Hubungkan Kebiasaan</p>
                <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {habits.map(h => {
                    const isChecked = editSelectedHabitIds.includes(h.id);
                    return (
                      <div
                        key={h.id}
                        onClick={() => toggleHabitInEdit(h.id)}
                        className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer"
                        style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
                      >
                        <div className="w-4 h-4 rounded border flex items-center justify-center" style={{ borderColor: isChecked ? 'var(--accent)' : 'var(--text3)', background: isChecked ? 'var(--accentFill)' : 'transparent' }}>
                          {isChecked && <span className="text-[9px] text-white">✓</span>}
                        </div>
                        <span className="text-xs" style={{ color: 'var(--text)' }}>{h.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-2">
              <motion.button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: editColor, opacity: updating ? 0.6 : 1 }}
                onClick={updateGoal}
                disabled={updating}
                whileTap={{ scale: 0.97 }}
              >
                {updating ? 'Menyimpan...' : 'Perbarui Goal'}
              </motion.button>
              <button
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                onClick={() => setEditingGoal(null)}
              >
                Batal
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Goals List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-4xl">🎯</p>
          <p className="text-base font-semibold" style={{ color: 'var(--text2)' }}>Belum ada goal</p>
          <p className="text-sm" style={{ color: 'var(--text3)' }}>Tap + untuk buat goal identitas</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {goals.map((goal) => {
            const level = goal.level || 1;
            const getRankName = (lvl: number) => {
              if (lvl <= 2) return 'Pemula';
              if (lvl <= 5) return 'Praktisi';
              if (lvl <= 9) return 'Spesialis';
              return 'Master';
            };
            const rank = getRankName(level);
            // Stored colour is tuned for the light base; as text on dark it lands ~2.3:1.
            const inkColor = readableOn(goal.color, theme);
            
            return (
              <motion.div
                key={goal.id}
                className="rounded-[18px] p-4 flex flex-col transition-all cursor-pointer border"
                style={{
                  background: goal.color + '10',
                  borderColor: goal.color + '25',
                }}
                onClick={() => {
                  setEditingGoal(goal);
                  setEditStatement(goal.identityStatement);
                  setEditColor(goal.color);
                  setEditSelectedHabitIds(goal.habitIds);
                }}
                layout="position"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-2xl flex-shrink-0 flex items-center justify-center text-xl"
                    style={{ background: goal.color + '22', color: inkColor }}>
                    🎯
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5" style={{ color: inkColor }}>
                      <span>Lvl {level} {rank}</span>
                      <span className="w-1 h-1 rounded-full" style={{ background: goal.color }} />
                      <span>Identitas</span>
                    </p>
                    <p className="font-bold text-base leading-snug mt-0.5" style={{ color: 'var(--text)' }}>
                      Saya adalah orang yang {goal.identityStatement}
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
                      {goal.habitIds.length} kebiasaan terhubung
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <motion.button
                      className="w-7 h-7 flex items-center justify-center opacity-60 hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteGoal(goal.id);
                      }}
                      whileTap={{ scale: 0.85 }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </motion.button>
                  </div>
                </div>

                {/* Progress & XP bars */}
                <div className="mt-4 pt-2.5 border-t" style={{ borderColor: 'var(--sep)' }}>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Today's completion progress */}
                    <div>
                      <div className="flex justify-between items-center text-[10px] font-semibold mb-1">
                        <span style={{ color: 'var(--text2)' }}>Kemajuan Hari Ini</span>
                        <span style={{ color: inkColor }} className="font-extrabold">{goal.progress}%</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: goal.color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${goal.progress}%` }}
                          transition={springs.smooth}
                        />
                      </div>
                    </div>

                    {/* Identity XP Progress */}
                    <div>
                      <div className="flex justify-between items-center text-[10px] font-semibold mb-1">
                        <span style={{ color: 'var(--text2)' }}>Pertumbuhan EXP</span>
                        <span style={{ color: inkColor }} className="font-extrabold">{goal.currentExp || 0}/{goal.nextLevelExp || 100} XP</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                        <motion.div
                          className="h-full rounded-full"
                          style={{ 
                            background: `linear-gradient(90deg, ${goal.color}, #5BD97A)` 
                          }}
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, ((goal.currentExp || 0) / (goal.nextLevelExp || 100)) * 100)}%` }}
                          transition={springs.smooth}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
