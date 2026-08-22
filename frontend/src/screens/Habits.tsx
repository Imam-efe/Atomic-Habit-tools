import { useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { CONFETTI_COLORS } from '@/constants/colors';
import { HabitBundles } from '@/components/HabitBundles';
import HabitStacks from '@/components/HabitStacks';
import { useUndoToastStore } from '@/stores/toastStore';
import { useUIStore } from '@/stores/uiStore';
import { buildHabitReminderIcs, downloadIcs } from '@/lib/ics';
import { bestForegroundFor } from '@/lib/color';

interface Goal {
  id: string;
  identityStatement: string;
}

interface Habit {
  id: string;
  name: string;
  color: string;
  streak: number;
  doneToday: boolean;
  isTwoMinToday?: boolean;
  triggerCue: string | null;
  twoMin: string | null;
  goalIds: string[];
  reminderTime?: string | null;
  /** Streak freezes spent this calendar month, and what is left of the quota. */
  freezesUsed?: number;
  freezesLeft?: number;
  lastFreezeDate?: string | null;
  /** 'daily' (default) or 'weekly' — an N-times-per-week target instead of every day. */
  frequencyType?: 'daily' | 'weekly';
  targetPerWeek?: number | null;
  /** Only present for weekly habits — completions logged since this Monday. */
  completionsThisWeek?: number | null;
}

const COLORS = ['#7C5CFF', 'var(--pos)', '#0A84FF', 'var(--warn)', 'var(--neg)', '#FF2D55'];

/**
 * Resolved per-theme hex for the three semantic swatches above — needed to
 * pick a readable button foreground, since `bestForegroundFor` computes
 * contrast against an actual pixel colour, not a CSS custom property.
 *
 * Every one of the six swatches turns out to read under 4.5:1 for hardcoded
 * white text in at least one theme (the two literal-hex ones — purple and
 * blue — fail in both, since they were tuned as accents against the page,
 * not as a solid fill behind white type), which is what the Simpan/Perbarui
 * buttons below were doing before this.
 */
const SWATCH_HEX: Record<'light' | 'dark', Record<string, string>> = {
  light: { 'var(--pos)': '#1B6E37', 'var(--warn)': '#8A5300', 'var(--neg)': '#C0281A' },
  dark: { 'var(--pos)': '#34C759', 'var(--warn)': '#FF9F0A', 'var(--neg)': '#FF453A' },
};

function swatchTextColor(swatch: string, theme: 'light' | 'dark'): string {
  const hex = SWATCH_HEX[theme][swatch] ?? swatch;
  return bestForegroundFor(hex);
}

const LAW_LABELS: Record<string, string> = {
  obvious: 'Petunjuk (Cue)',
  attractive: 'Gairah (Craving)',
  easy: 'Tanggapan (Response)',
  satisfying: 'Penghargaan (Reward)',
};

/** Daily/weekly segmented toggle + a 1-6 stepper, shared by the add and edit forms. */
function FrequencyPicker({
  frequencyType,
  targetPerWeek,
  onFrequencyType,
  onTargetPerWeek,
}: {
  frequencyType: 'daily' | 'weekly';
  targetPerWeek: number;
  onFrequencyType: (t: 'daily' | 'weekly') => void;
  onTargetPerWeek: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold text-[var(--text2)] uppercase px-1">Frekuensi</label>
      <div className="flex gap-1.5">
        {(['daily', 'weekly'] as const).map(t => (
          <button
            key={t}
            type="button"
            className="flex-1 py-2 rounded-xl text-xs font-bold"
            style={{
              background: frequencyType === t ? 'var(--accentFill)' : 'var(--bg)',
              color: frequencyType === t ? '#fff' : 'var(--text2)',
              boxShadow: frequencyType === t ? 'none' : 'var(--neu-inset)',
            }}
            onClick={() => onFrequencyType(t)}
          >
            {t === 'daily' ? 'Setiap hari' : 'X kali/minggu'}
          </button>
        ))}
      </div>
      {frequencyType === 'weekly' && (
        <div className="flex items-center gap-3 mt-1 px-1">
          <button
            type="button"
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm neu-press"
            style={{ color: 'var(--text)' }}
            onClick={() => onTargetPerWeek(Math.max(1, targetPerWeek - 1))}
          >
            −
          </button>
          <span className="text-sm font-bold flex-1 text-center" style={{ color: 'var(--text)' }}>
            {targetPerWeek}× per minggu
          </span>
          <button
            type="button"
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm neu-press"
            style={{ color: 'var(--text)' }}
            onClick={() => onTargetPerWeek(Math.min(6, targetPerWeek + 1))}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

export function Habits() {
  const showUndoToast = useUndoToastStore(s => s.show);
  const theme = useUIStore(s => s.theme) as 'light' | 'dark';
  const [habits, setHabits] = useState<Habit[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Add Form State
  const [newName, setNewName] = useState('');
  const [newCue, setNewCue] = useState('');
  const [newTwoMin, setNewTwoMin] = useState('');
  const [newColor, setNewColor] = useState('var(--pos)');
  const [newGoalIds, setNewGoalIds] = useState<string[]>([]);
  const [newReminderTime, setNewReminderTime] = useState('');
  const [newFrequencyType, setNewFrequencyType] = useState<'daily' | 'weekly'>('daily');
  const [newTargetPerWeek, setNewTargetPerWeek] = useState(3);
  const [saving, setSaving] = useState(false);

  // Edit Form State
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [editName, setEditName] = useState('');
  const [editCue, setEditCue] = useState('');
  const [editTwoMin, setEditTwoMin] = useState('');
  const [editColor, setEditColor] = useState('var(--pos)');
  const [editGoalIds, setEditGoalIds] = useState<string[]>([]);
  const [editReminderTime, setEditReminderTime] = useState('');
  const [editFrequencyType, setEditFrequencyType] = useState<'daily' | 'weekly'>('daily');
  const [editTargetPerWeek, setEditTargetPerWeek] = useState(3);
  const [updating, setUpdating] = useState(false);

  // Selected Habit for Loop Detail
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);

  // Identity flash — a brief "you just acted like X" card on completion, from
  // the linked goal the toggle response resolves server-side. Auto-dismisses;
  // never fires on un-completing (see the toggle handler below).
  const [identityFlash, setIdentityFlash] = useState<{ habitName: string; statement: string } | null>(null);
  useEffect(() => {
    if (!identityFlash) return;
    const t = setTimeout(() => setIdentityFlash(null), 3200);
    return () => clearTimeout(t);
  }, [identityFlash]);

  // Four Laws diagnosis — per habit, so switching selection doesn't leak a
  // stale diagnosis from a different habit onto the newly selected one.
  const [diagnosis, setDiagnosis] = useState<{
    habitId: string;
    verdict: 'too_new' | 'healthy' | 'diagnosed' | 'error';
    consistency?: number;
    weakestLaw?: string;
    reason?: string;
    suggestion?: string;
  } | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  // Canvas Ref for Confetti
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // `silent` refreshes in place without flashing the loading skeleton — used
  // when the kept-alive tab is re-shown and already has data on screen.
  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [habsData, goalsData] = await Promise.all([
        apiFetch<Habit[]>('/habits'),
        apiFetch<Goal[]>('/goals'),
      ]);
      setHabits(habsData);
      setGoals(goalsData);
      if (habsData.length > 0 && !selectedHabitId) {
        setSelectedHabitId(habsData[0].id);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // The tab stays mounted between visits; habits can be toggled from the
  // Dashboard tab, so re-shows refresh silently to pick that up.
  useEffect(() => {
    const onShown = (e: Event) => {
      if ((e as CustomEvent).detail === 'kebiasaan') load(true);
    };
    window.addEventListener('fayolla:tab-shown', onShown);
    return () => window.removeEventListener('fayolla:tab-shown', onShown);
  }, []);

  const triggerConfetti = (isMilestone: boolean) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    cv.width = rect.width;
    cv.height = rect.height;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const colors = CONFETTI_COLORS;
    const N = isMilestone ? 90 : 30;
    const parts: any[] = [];

    for (let i = 0; i < N; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = isMilestone ? (5 + Math.random() * 8) : (3 + Math.random() * 5);
      parts.push({
        x: rect.width / 2,
        y: rect.height * 0.4,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 2,
        g: 0.16 + Math.random() * 0.1,
        w: 5 + Math.random() * 5,
        h: 6 + Math.random() * 6,
        rot: Math.random() * 6,
        vr: -0.2 + Math.random() * 0.4,
        c: colors[i % colors.length],
        life: 1.0,
      });
    }

    let t0 = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(2, (now - t0) / 16);
      t0 = now;
      ctx.clearRect(0, 0, cv.width, cv.height);
      let alive = false;
      for (const p of parts) {
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.life -= (isMilestone ? 0.007 : 0.012) * dt;
        if (p.life > 0 && p.y < cv.height + 20) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.c;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      }
      if (alive) {
        requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, cv.width, cv.height);
      }
    };
    requestAnimationFrame(tick);
  };

  const toggle = async (id: string, e: React.MouseEvent, isTwoMin?: boolean) => {
    e.stopPropagation(); // Prevent opening Edit Modal
    const prev = habits;
    let newStreak = 0;
    let checkingIn = false;

    setHabits(h => h.map(x => {
      if (x.id === id) {
        checkingIn = !x.doneToday;
        newStreak = checkingIn ? x.streak + 1 : Math.max(0, x.streak - 1);
        return { ...x, doneToday: checkingIn, isTwoMinToday: checkingIn ? !!isTwoMin : false, streak: newStreak };
      }
      return x;
    }));

    try {
      const res = await apiFetch<{ doneToday: boolean; streak: number; isTwoMinToday: boolean; identityStatement?: string | null }>(`/habits/${id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ isTwoMin }),
      });
      setHabits(h => h.map(x => x.id === id ? { ...x, doneToday: res.doneToday, streak: res.streak, isTwoMinToday: res.isTwoMinToday } : x));

      if (res.doneToday) {
        // Trigger Confetti!
        const isMilestone = res.streak > 0 && res.streak % 7 === 0;
        triggerConfetti(isMilestone);

        if (res.identityStatement) {
          const habitName = habits.find(h => h.id === id)?.name ?? '';
          setIdentityFlash({ habitName, statement: res.identityStatement });
        }
      }
    } catch {
      setHabits(prev);
    }
  };

  const addHabit = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await apiFetch<Habit>('/habits', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          triggerCue: newCue.trim() || undefined,
          twoMin: newTwoMin.trim() || undefined,
          color: newColor,
          goalIds: newGoalIds,
          reminderTime: newReminderTime.trim() || undefined,
          frequencyType: newFrequencyType,
          targetPerWeek: newFrequencyType === 'weekly' ? newTargetPerWeek : undefined,
        }),
      });
      load();
      setNewName('');
      setNewCue('');
      setNewTwoMin('');
      setNewGoalIds([]);
      setNewReminderTime('');
      setNewFrequencyType('daily');
      setNewTargetPerWeek(3);
      setShowAdd(false);
    } catch {}
    setSaving(false);
  };

  const updateHabit = async () => {
    if (!editingHabit || !editName.trim()) return;
    setUpdating(true);
    try {
      await apiFetch(`/habits/${editingHabit.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editName.trim(),
          triggerCue: editCue.trim() || undefined,
          twoMin: editTwoMin.trim() || undefined,
          color: editColor,
          goalIds: editGoalIds,
          reminderTime: editReminderTime.trim() || undefined,
          frequencyType: editFrequencyType,
          targetPerWeek: editFrequencyType === 'weekly' ? editTargetPerWeek : undefined,
        }),
      });
      load();
      setEditingHabit(null);
    } catch {}
    setUpdating(false);
  };

  /** POST /habits/:id/diagnose — which of the Four Laws is weakest right now. */
  const diagnoseHabit = async (habitId: string) => {
    if (diagnosing) return;
    setDiagnosing(true);
    setDiagnosis(null);
    try {
      const res = await apiFetch<{
        verdict: 'too_new' | 'healthy' | 'diagnosed';
        consistency?: number;
        weakestLaw?: string;
        reason?: string;
        suggestion?: string;
      }>(`/habits/${habitId}/diagnose`, { method: 'POST' });
      setDiagnosis({ habitId, ...res });
    } catch {
      setDiagnosis({ habitId, verdict: 'error' });
    }
    setDiagnosing(false);
  };

  const deleteHabit = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const removed = habits.find(h => h.id === id);
    if (!removed) return;
    const prevHabits = habits;

    setHabits(h => h.filter(x => x.id !== id));

    // Deferred like Budget's delete: the API call only fires once the undo
    // window has passed, so tapping Undo never has to race an in-flight DELETE.
    showUndoToast(
      `${removed.name} dihapus`,
      () => setHabits(prevHabits),
      () => { apiFetch(`/habits/${id}`, { method: 'DELETE' }).catch(() => load()); },
    );
  };

  const toggleGoalInAdd = (goalId: string) => {
    setNewGoalIds(prev =>
      prev.includes(goalId) ? prev.filter(id => id !== goalId) : [...prev, goalId]
    );
  };

  const toggleGoalInEdit = (goalId: string) => {
    setEditGoalIds(prev =>
      prev.includes(goalId) ? prev.filter(id => id !== goalId) : [...prev, goalId]
    );
  };

  const exportToCalendar = () => {
    const withReminders = habits.filter((h): h is Habit & { reminderTime: string } => !!h.reminderTime);
    if (withReminders.length === 0) return;
    downloadIcs(buildHabitReminderIcs(withReminders), 'fayolla-kebiasaan.ics');
  };

  const { done, total, stackedHabits, loopHabit } = useMemo(() => {
    const d = habits.filter(h => h.doneToday).length;
    const t = habits.length;
    const stacked = habits.filter(h => h.triggerCue?.trim());
    const loop = habits.find(h => h.id === selectedHabitId) || habits[0];
    return { done: d, total: t, stackedHabits: stacked, loopHabit: loop };
  }, [habits, selectedHabitId]);

  return (
    <div className="min-h-screen px-5 pt-16 pb-28 relative" style={{ background: 'var(--bg)' }}>
      {/* Confetti canvas overlay */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-40" />

      {/* Identity flash — "you just acted like X", from the habit's linked
          goal. Fires only on a fresh completion (see toggle()), auto-dismisses. */}
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

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}>
            Kebiasaan
          </h1>
          {total > 0 && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text2)' }}>
              {done}/{total} selesai hari ini
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {habits.some(h => h.reminderTime) && (
            <motion.button
              className="neu-press w-10 h-10 rounded-full flex items-center justify-center text-base"
              whileTap={{ scale: 0.9 }}
              transition={springs.snappy}
              onClick={exportToCalendar}
              aria-label="Ekspor pengingat ke Kalender"
            >
              📅
            </motion.button>
          )}
          <motion.button
            className="neu-cta w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'var(--accentFill)' }}
            whileTap={{ scale: 0.9 }}
            transition={springs.snappy}
            onClick={() => setShowAdd(s => !s)}
            aria-label="Tambah kebiasaan baru"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </motion.button>
        </div>
      </div>

      {/* Add Habit Modal */}
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
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Tambah Kebiasaan Baru</p>
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              placeholder="Nama kebiasaan..."
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
            />
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              placeholder="Setelah... (cue, misal: kopi pagi)"
              value={newCue}
              onChange={e => setNewCue(e.target.value)}
            />
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              placeholder="Versi 2-menit... (misal: buka buku 1 halaman)"
              value={newTwoMin}
              onChange={e => setNewTwoMin(e.target.value)}
            />

            {/* Reminder Time input */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[var(--text2)] uppercase px-1">Waktu Pengingat (Notifikasi)</label>
              <input
                type="time"
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                value={newReminderTime}
                onChange={e => setNewReminderTime(e.target.value)}
              />
            </div>

            <FrequencyPicker
              frequencyType={newFrequencyType}
              targetPerWeek={newTargetPerWeek}
              onFrequencyType={setNewFrequencyType}
              onTargetPerWeek={setNewTargetPerWeek}
            />

            {/* Accent Color picker */}
            <div className="flex gap-2 justify-between px-1">
              {COLORS.map(c => (
                <motion.button
                  key={c}
                  className="w-6.5 h-6.5 rounded-full flex-shrink-0"
                  style={{ background: c, border: newColor === c ? '2px solid white' : 'none', boxShadow: newColor === c ? `0 0 0 2px ${c}` : 'none' }}
                  whileTap={{ scale: 0.85 }}
                  onClick={() => setNewColor(c)}
                />
              ))}
            </div>

            {/* Goals selection list */}
            {goals.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[10px] font-bold text-[var(--text2)] uppercase">Hubungkan ke Identitas</p>
                <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto pr-1">
                  {goals.map(g => {
                    const isChecked = newGoalIds.includes(g.id);
                    return (
                      <div
                        key={g.id}
                        onClick={() => toggleGoalInAdd(g.id)}
                        className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer"
                        style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
                      >
                        <div className="w-4 h-4 rounded border flex items-center justify-center" style={{ borderColor: isChecked ? 'var(--accent)' : 'var(--text3)', background: isChecked ? 'var(--accentFill)' : 'transparent' }}>
                          {isChecked && <span className="text-[9px] text-white">✓</span>}
                        </div>
                        <span className="text-xs truncate" style={{ color: 'var(--text)' }}>
                          Saya adalah orang yang {g.identityStatement}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-1">
              <motion.button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: newColor, color: swatchTextColor(newColor, theme), opacity: saving ? 0.6 : 1 }}
                onClick={addHabit}
                disabled={saving}
                whileTap={{ scale: 0.97 }}
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </motion.button>
              <button
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                onClick={() => { setShowAdd(false); setNewName(''); setNewCue(''); setNewTwoMin(''); setNewGoalIds([]); setNewFrequencyType('daily'); setNewTargetPerWeek(3); }}
              >
                Batal
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Habit Modal */}
      <AnimatePresence>
        {editingHabit && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Ubah Pengaturan Kebiasaan</p>
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              autoFocus
            />
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              value={editCue}
              placeholder="Setelah..."
              onChange={e => setEditCue(e.target.value)}
            />
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              value={editTwoMin}
              placeholder="Versi 2-menit..."
              onChange={e => setEditTwoMin(e.target.value)}
            />

            {/* Edit Reminder Time input */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[var(--text2)] uppercase px-1">Waktu Pengingat (Notifikasi)</label>
              <input
                type="time"
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                value={editReminderTime}
                onChange={e => setEditReminderTime(e.target.value)}
              />
            </div>

            <FrequencyPicker
              frequencyType={editFrequencyType}
              targetPerWeek={editTargetPerWeek}
              onFrequencyType={setEditFrequencyType}
              onTargetPerWeek={setEditTargetPerWeek}
            />

            {/* Accent Color picker */}
            <div className="flex gap-2 justify-between px-1">
              {COLORS.map(c => (
                <motion.button
                  key={c}
                  className="w-6.5 h-6.5 rounded-full flex-shrink-0"
                  style={{ background: c, border: editColor === c ? '2px solid white' : 'none', boxShadow: editColor === c ? `0 0 0 2px ${c}` : 'none' }}
                  whileTap={{ scale: 0.85 }}
                  onClick={() => setEditColor(c)}
                />
              ))}
            </div>

            {/* Goals selection list */}
            {goals.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[10px] font-bold text-[var(--text2)] uppercase">Hubungkan ke Identitas</p>
                <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto pr-1">
                  {goals.map(g => {
                    const isChecked = editGoalIds.includes(g.id);
                    return (
                      <div
                        key={g.id}
                        onClick={() => toggleGoalInEdit(g.id)}
                        className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer"
                        style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
                      >
                        <div className="w-4 h-4 rounded border flex items-center justify-center" style={{ borderColor: isChecked ? 'var(--accent)' : 'var(--text3)', background: isChecked ? 'var(--accentFill)' : 'transparent' }}>
                          {isChecked && <span className="text-[9px] text-white">✓</span>}
                        </div>
                        <span className="text-xs truncate" style={{ color: 'var(--text)' }}>
                          Saya adalah orang yang {g.identityStatement}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-1">
              <motion.button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: editColor, color: swatchTextColor(editColor, theme), opacity: updating ? 0.6 : 1 }}
                onClick={updateHabit}
                disabled={updating}
                whileTap={{ scale: 0.97 }}
              >
                {updating ? 'Menyimpan...' : 'Perbarui'}
              </motion.button>
              <button
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                onClick={() => setEditingHabit(null)}
              >
                Batal
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Habits Checklist */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : habits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-4xl">✨</p>
          <p className="text-base font-semibold" style={{ color: 'var(--text2)' }}>Belum ada kebiasaan</p>
          <p className="text-sm" style={{ color: 'var(--text3)' }}>Tap + untuk buat kebiasaan baru</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 mb-6">
          {/* Freezes are granted silently overnight, so without this the streak
              simply looks unbroken and the user never learns the rule. */}
          {habits.some(h => !!h.freezesUsed) && (
            <div
              className="rounded-[16px] px-3.5 py-2.5 flex items-start gap-2.5"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised-sm)' }}
            >
              <span className="text-[15px] flex-shrink-0" aria-hidden>❄️</span>
              <p className="text-[11px] leading-snug" style={{ color: 'var(--text2)' }}>
                Streak diselamatkan{' '}
                <span className="font-bold" style={{ color: 'var(--text)' }}>
                  {habits.reduce((sum, h) => sum + (h.freezesUsed ?? 0), 0)}×
                </span>{' '}
                bulan ini. Setiap kebiasaan punya 2 jatah per bulan — satu hari terlewat
                tidak langsung menghanguskan streak.
              </p>
            </div>
          )}
          <AnimatePresence>
            {habits.map((habit) => {
              const isSelected = selectedHabitId === habit.id;
              return (
                <motion.div
                  key={habit.id}
                  onClick={() => setSelectedHabitId(habit.id)}
                  layout="position"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="rounded-[18px] p-4 flex flex-col cursor-pointer border transition-all"
                  style={{
                    background: 'var(--surface)',
                    borderColor: isSelected ? habit.color : 'transparent',
                    boxShadow: isSelected ? 'var(--neu-pressed)' : 'var(--neu-raised)',
                  }}
                >
                  {/* Upper Row: Check & Details */}
                  <div className="flex items-center gap-4">
                    {/* Check Button */}
                    <motion.button
                      className="w-11 h-11 rounded-full flex-shrink-0 flex items-center justify-center border-2"
                      style={{
                        borderColor: habit.color,
                        background: habit.doneToday ? habit.color : 'transparent',
                        borderStyle: habit.doneToday && habit.isTwoMinToday ? 'dashed' : 'solid',
                      }}
                      onClick={(e) => toggle(habit.id, e, habit.isTwoMinToday)}
                      whileTap={{ scale: 0.85 }}
                      transition={springs.bouncy}
                    >
                      {habit.doneToday && (
                        <div className="flex flex-col items-center justify-center">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          {habit.isTwoMinToday && (
                            <span className="text-[7.5px] font-black text-white -mt-0.5 leading-none">2M</span>
                          )}
                        </div>
                      )}
                    </motion.button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-base truncate" style={{ color: habit.doneToday ? 'var(--text2)' : 'var(--text)', textDecoration: habit.doneToday ? 'line-through' : 'none' }}>
                        {habit.name}
                      </p>
                      {habit.triggerCue && (
                        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text3)' }}>
                          Setelah {habit.triggerCue}
                        </p>
                      )}
                      {habit.reminderTime && (
                        <p className="text-[11px] mt-0.5 font-semibold text-[var(--warn)] flex items-center gap-1">
                          ⏰ Pengingat: {habit.reminderTime}
                        </p>
                      )}
                      {habit.frequencyType === 'weekly' && (
                        // --info, not --accentFill2: the accent is a user-chosen
                        // brand color with no guaranteed contrast on --surface at
                        // this size, where the semantic tokens are pre-tuned for.
                        <p className="text-[11px] mt-0.5 font-semibold" style={{ color: 'var(--info)' }}>
                          {habit.completionsThisWeek ?? 0}/{habit.targetPerWeek}× minggu ini
                        </p>
                      )}
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-2">
                      {/* Streak display. Unit differs by frequency — a weekly
                          habit's streak counts consecutive WEEKS meeting target,
                          not days, so the label says so to avoid reading it as a
                          much bigger daily streak than it is. The snowflake marks
                          a daily streak that only survived because a freeze
                          bridged a missed day. */}
                      {habit.streak > 0 && (
                        <div
                          className="flex items-center gap-0.5 flex-shrink-0 font-bold text-sm bg-orange-500/10 text-[var(--warn)] px-2 py-0.5 rounded-lg"
                          title={
                            habit.frequencyType === 'weekly'
                              ? `${habit.streak} minggu berturut-turut memenuhi target`
                              : habit.freezesUsed
                                ? `${habit.freezesUsed} hari terlewat diselamatkan bulan ini · sisa ${habit.freezesLeft} jatah`
                                : undefined
                          }
                        >
                          🔥 {habit.streak}{habit.frequencyType === 'weekly' ? ' mgu' : ''}
                          {!!habit.freezesUsed && habit.frequencyType !== 'weekly' && (
                            <span className="text-[var(--info)] ml-0.5" aria-hidden>❄️</span>
                          )}
                        </div>
                      )}

                      {/* Edit click */}
                      <button
                        className="w-6 h-6 flex items-center justify-center opacity-40 hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingHabit(habit);
                          setEditName(habit.name);
                          setEditCue(habit.triggerCue ?? '');
                          setEditTwoMin(habit.twoMin ?? '');
                          setEditColor(habit.color);
                          setEditGoalIds(habit.goalIds ?? []);
                          setEditReminderTime(habit.reminderTime ?? '');
                          setEditFrequencyType(habit.frequencyType ?? 'daily');
                          setEditTargetPerWeek(habit.targetPerWeek ?? 3);
                        }}
                      >
                        ✏️
                      </button>

                      {/* Delete click */}
                      <button
                        className="w-6 h-6 flex items-center justify-center opacity-40 hover:opacity-100"
                        onClick={(e) => deleteHabit(habit.id, e)}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {/* Two Minute Version Footer */}
                  {habit.twoMin && (
                    <div className="mt-3 pt-2.5 border-t text-[11px] flex justify-between items-center" style={{ borderColor: 'var(--sep)', color: 'var(--text2)' }}>
                      <div className="flex flex-col">
                        <span>Versi 2-menit:</span>
                        <span className="font-bold mt-0.5" style={{ color: 'var(--text)' }}>{habit.twoMin}</span>
                      </div>
                      {!habit.doneToday ? (
                        <button
                          onClick={(e) => toggle(habit.id, e, true)}
                          className="px-2.5 py-1 rounded-lg font-bold text-[10px] text-white flex items-center gap-1 transition-all"
                          style={{ background: 'var(--accentFill)' }}
                        >
                          ⚡ Rebound 2M
                        </button>
                      ) : habit.isTwoMinToday ? (
                        <span className="px-2.5 py-1 rounded-lg font-bold text-[10px] text-[var(--pos)] bg-emerald-500/10 flex items-center gap-1">
                          ✓ Rebound 2M
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--text2)] italic">Selesai Penuh</span>
                      )}
                    </div>
                  )}
                  {habit.reminderTime && (
                    <div className="flex items-center gap-1 mt-1.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      <span className="text-[10px] font-semibold" style={{ color: 'var(--text3)' }}>
                        Pengingat {habit.reminderTime}
                      </span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Temptation Bundling */}
      <HabitBundles habits={habits} onRefresh={load} />

      {/* Habit Stacking - Create and manage habit chains */}
      <HabitStacks habits={habits} onRefresh={load} />

      {/* Habit Loop card for selected habit */}
      {loopHabit && (
        <motion.div
          key={loopHabit.id}
          className="rounded-[22px] p-5 mb-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={springs.gentle}
        >
          <h3 className="text-base font-bold mb-0.5" style={{ color: 'var(--text)' }}>Habit Loop · {loopHabit.name}</h3>
          <p className="text-xs mb-4" style={{ color: 'var(--text2)' }}>Membangun kebiasaan melalui 4 hukum psikologi</p>

          {(() => {
            const active = diagnosis?.habitId === loopHabit.id ? diagnosis : null;
            const weakCellStyle = (law: string) =>
              active?.verdict === 'diagnosed' && active.weakestLaw === law
                ? { background: 'var(--bg)', boxShadow: 'var(--neu-inset)', border: '1.5px solid var(--neg)' }
                : { background: 'var(--bg)', boxShadow: 'var(--neu-inset)' };
            const isWeak = (law: string) => active?.verdict === 'diagnosed' && active.weakestLaw === law;

            return (
              <>
                <div className="grid grid-cols-2 gap-3.5">
                  <div className="rounded-xl p-3 flex flex-col justify-between" style={weakCellStyle('obvious')}>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--info)] flex items-center gap-1">
                      1. Cue (Petunjuk) {isWeak('obvious') && '⚠️'}
                    </span>
                    <p className="text-xs font-semibold leading-relaxed mt-2" style={{ color: 'var(--text)' }}>
                      {loopHabit.triggerCue ? `Setelah ${loopHabit.triggerCue}` : 'Set alarm pagi / rutinitas tetap'}
                    </p>
                  </div>

                  <div className="rounded-xl p-3 flex flex-col justify-between" style={weakCellStyle('attractive')}>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--warn)] flex items-center gap-1">
                      2. Craving (Gairah) {isWeak('attractive') && '⚠️'}
                    </span>
                    <p className="text-xs font-semibold leading-relaxed mt-2" style={{ color: 'var(--text)' }}>
                      Membangun kebiasaan 1% lebih konsisten
                    </p>
                  </div>

                  <div className="rounded-xl p-3 flex flex-col justify-between" style={weakCellStyle('easy')}>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--pos)] flex items-center gap-1">
                      3. Response (Tanggapan) {isWeak('easy') && '⚠️'}
                    </span>
                    <p className="text-xs font-semibold leading-relaxed mt-2" style={{ color: 'var(--text)' }}>
                      {loopHabit.twoMin ? `Versi 2-menit: ${loopHabit.twoMin}` : `Mulai lakukan ${loopHabit.name}`}
                    </p>
                  </div>

                  <div className="rounded-xl p-3 flex flex-col justify-between" style={weakCellStyle('satisfying')}>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] flex items-center gap-1">
                      4. Reward (Penghargaan) {isWeak('satisfying') && '⚠️'}
                    </span>
                    <p className="text-xs font-semibold leading-relaxed mt-2" style={{ color: 'var(--text)' }}>
                      Streak bertambah & merasa bangga!
                    </p>
                  </div>
                </div>

                {/* Four Laws diagnostic — AI names the weakest cell above from
                    this habit's actual data, rather than the user guessing. */}
                <div className="mt-3.5 pt-3.5 border-t" style={{ borderColor: 'var(--sep)' }}>
                  {!active && (
                    <button
                      onClick={() => diagnoseHabit(loopHabit.id)}
                      disabled={diagnosing}
                      className="w-full py-2.5 rounded-xl text-xs font-bold neu-press disabled:opacity-60"
                      style={{ color: 'var(--accentFill2)' }}
                    >
                      {diagnosing ? 'Menganalisis…' : '🔍 Diagnosa 4 Hukum (AI)'}
                    </button>
                  )}

                  {active?.verdict === 'too_new' && (
                    <p className="text-[11px] text-center" style={{ color: 'var(--text3)' }}>
                      Masih terlalu baru untuk didiagnosis — butuh minimal 7 hari riwayat.
                    </p>
                  )}
                  {active?.verdict === 'healthy' && (
                    <p className="text-[11px] text-center" style={{ color: 'var(--pos)' }}>
                      ✓ Konsistensi {active.consistency}% — sudah cukup baik, belum perlu diagnosis.
                    </p>
                  )}
                  {active?.verdict === 'error' && (
                    <button
                      onClick={() => diagnoseHabit(loopHabit.id)}
                      className="w-full py-2.5 rounded-xl text-xs font-bold neu-press"
                      style={{ color: 'var(--neg)' }}
                    >
                      Diagnosis gagal — coba lagi
                    </button>
                  )}
                  {active?.verdict === 'diagnosed' && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[11px] font-bold" style={{ color: 'var(--neg)' }}>
                        Hukum terlemah: {LAW_LABELS[active.weakestLaw ?? ''] ?? active.weakestLaw}
                      </p>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text2)' }}>
                        {active.reason}
                      </p>
                      <p className="text-xs leading-relaxed font-semibold" style={{ color: 'var(--text)' }}>
                        💡 {active.suggestion}
                      </p>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </motion.div>
      )}
    </div>
  );
}
