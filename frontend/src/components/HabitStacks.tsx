import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';

interface StackHabit {
  id: string;
  habit_id: string;
  position: number;
  habit_name: string;
  habit_color: string;
  habit_icon: string;
  habit_action_time: string | null;
}

interface HabitStack {
  id: string;
  name: string;
  description: string | null;
  is_active: number;
  habits: StackHabit[];
}

interface Habit {
  id: string;
  name: string;
  action_time?: string | null;
  reminderTime?: string | null;
}

interface Props {
  habits: Habit[];
  onRefresh?: () => void;
}

export default function HabitStacks({ habits, onRefresh }: Props) {
  const [stacks, setStacks] = useState<HabitStack[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedHabits, setSelectedHabits] = useState<string[]>([]);
  const [stackName, setStackName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<HabitStack[]>('/habit-stacks');
      setStacks(data);
    } catch (error) {
      console.error('Failed to load habit stacks:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreateStack = async () => {
    if (!stackName.trim() || selectedHabits.length < 2) {
      alert('Beri nama dan pilih minimal 2 kebiasaan.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/habit-stacks', {
        method: 'POST',
        body: JSON.stringify({ name: stackName.trim(), habit_ids: selectedHabits }),
      });
      setStackName('');
      setSelectedHabits([]);
      setShowForm(false);
      await load();
      onRefresh?.();
    } catch (error) {
      console.error('Failed to create stack:', error);
      alert('Gagal membuat stack.');
    }
    setSaving(false);
  };

  const handleDeleteStack = async (stackId: string) => {
    if (!confirm('Hapus stack ini?')) return;
    setDeleting(stackId);
    try {
      await apiFetch(`/habit-stacks/${stackId}`, { method: 'DELETE' });
      await load();
      onRefresh?.();
    } catch {
      alert('Gagal menghapus stack.');
    }
    setDeleting(null);
  };

  const toggleHabit = (habitId: string) => {
    setSelectedHabits((prev) =>
      prev.includes(habitId) ? prev.filter((h) => h !== habitId) : [...prev, habitId]
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-4 h-4 rounded-full border border-t-transparent animate-spin"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold uppercase" style={{ color: 'var(--text2)' }}>
          🔗 Habit Stacking
        </h3>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="text-xs font-bold"
          style={{ color: 'var(--accent)' }}
        >
          {showForm ? 'Tutup' : '+ Buat Stack'}
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            className="rounded-[18px] p-4 mb-4"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Nama stack (misal: Rutinitas Pagi)"
                value={stackName}
                onChange={(e) => setStackName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              />

              <div>
                <label className="text-xs font-bold block mb-1.5" style={{ color: 'var(--text2)' }}>
                  Pilih kebiasaan (min. 2), urutan sesuai yang dipilih
                </label>
                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                  {habits.map((habit) => {
                    const isChecked = selectedHabits.includes(habit.id);
                    return (
                      <div
                        key={habit.id}
                        onClick={() => toggleHabit(habit.id)}
                        className="flex items-center gap-2.5 p-2.5 rounded-xl cursor-pointer"
                        style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
                      >
                        <div
                          className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0"
                          style={{
                            borderColor: isChecked ? 'var(--accent)' : 'var(--text3)',
                            background: isChecked ? 'var(--accentFill)' : 'transparent',
                          }}
                        >
                          {isChecked && <span className="text-[9px] text-white">✓</span>}
                        </div>
                        <span className="text-xs flex-1 truncate" style={{ color: 'var(--text)' }}>
                          {habit.name}
                        </span>
                        {habit.reminderTime && (
                          <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text3)' }}>
                            {habit.reminderTime}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2 mt-1">
                <button
                  onClick={handleCreateStack}
                  disabled={saving}
                  className="neu-cta flex-1 py-2.5 rounded-xl text-xs font-bold text-white disabled:opacity-60"
                  style={{ background: 'var(--accentFill)' }}
                >
                  {saving ? 'Menyimpan...' : 'Buat Stack'}
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setStackName('');
                    setSelectedHabits([]);
                  }}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold"
                  style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                >
                  Batal
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {stacks.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Belum ada habit stack. Rangkai beberapa kebiasaan berurutan supaya satu memicu yang berikutnya!
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {stacks.map((stack) => {
            const items = [...stack.habits].sort((a, b) => a.position - b.position);
            return (
              <div
                key={stack.id}
                className="rounded-[18px] p-4"
                style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate" style={{ color: 'var(--text)' }}>{stack.name}</p>
                    {stack.description && (
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text2)' }}>{stack.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteStack(stack.id)}
                    disabled={deleting === stack.id}
                    className="w-6 h-6 flex items-center justify-center rounded-lg flex-shrink-0"
                    style={{ background: 'rgba(255,69,58,0.1)' }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--neg)" strokeWidth="2.5">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>

                <div className="flex flex-col gap-1.5">
                  {items.map((item, index) => (
                    <div key={item.id}>
                      <div className="flex items-center gap-2.5 p-2.5 rounded-xl" style={{ background: 'var(--bg)' }}>
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-[11px] flex-shrink-0"
                          style={{ background: item.habit_color }}
                        >
                          {index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>
                            {item.habit_name}
                          </p>
                          {item.habit_action_time && (
                            <p className="text-[10px]" style={{ color: 'var(--text3)' }}>@ {item.habit_action_time}</p>
                          )}
                        </div>
                      </div>
                      {index < items.length - 1 && (
                        <div className="flex justify-center py-0.5">
                          <div className="w-0.5 h-3 rounded-full" style={{ background: 'var(--sep)' }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
