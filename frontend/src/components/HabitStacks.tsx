import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
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

interface Props {
  habits: any[];
  onRefresh?: () => void;
}

export default function HabitStacks({ habits, onRefresh }: Props) {
  const [stacks, setStacks] = useState<HabitStack[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedHabits, setSelectedHabits] = useState<string[]>([]);
  const [stackName, setStackName] = useState('');

  useEffect(() => {
    loadStacks();
  }, []);

  async function loadStacks() {
    try {
      setLoading(true);
      const data = await apiFetch<HabitStack[]>('/habit-stacks');
      setStacks(data);
    } catch (err) {
      console.error('Failed to load habit stacks:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateStack() {
    if (!stackName.trim() || selectedHabits.length < 2) {
      alert('Need name and at least 2 habits');
      return;
    }

    try {
      await apiFetch('/habit-stacks', {
        method: 'POST',
        body: JSON.stringify({
          name: stackName,
          habit_ids: selectedHabits,
        }),
      });
      setStackName('');
      setSelectedHabits([]);
      setShowForm(false);
      await loadStacks();
      onRefresh?.();
    } catch (err) {
      console.error('Failed to create stack:', err);
      alert('Failed to create stack');
    }
  }

  async function handleDeleteStack(stackId: string) {
    if (!confirm('Delete this stack?')) return;

    try {
      await apiFetch(`/habit-stacks/${stackId}`, { method: 'DELETE' });
      await loadStacks();
      onRefresh?.();
    } catch (err) {
      console.error('Failed to delete stack:', err);
      alert('Failed to delete stack');
    }
  }

  const toggleHabit = (habitId: string) => {
    setSelectedHabits((prev) =>
      prev.includes(habitId) ? prev.filter((h) => h !== habitId) : [...prev, habitId]
    );
  };

  if (loading) return <div className="p-4 text-center text-text3">Loading stacks...</div>;
  if (stacks.length === 0 && !showForm) {
    return (
      <div className="p-4">
        <h3 className="font-bold text-lg mb-3">Habit Stacking</h3>
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 rounded-lg bg-accent text-white font-semibold"
        >
          Create Stack
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.gentle}
      className="p-4"
    >
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-lg">Habit Stacking</h3>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="text-accent font-semibold text-sm">
            + New
          </button>
        )}
      </div>

      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.snappy}
          className="mb-6 p-4 bg-surface rounded-lg border border-sep"
        >
          <input
            type="text"
            placeholder="Stack name (e.g., Morning Routine)"
            value={stackName}
            onChange={(e) => setStackName(e.target.value)}
            className="w-full mb-4 p-2 bg-bg border border-sep rounded text-text placeholder-text3"
          />

          <div className="mb-4">
            <p className="text-sm text-text2 mb-2">Select habits (min 2):</p>
            <div className="space-y-2">
              {habits.map((habit) => (
                <label
                  key={habit.id}
                  className="flex items-center p-3 rounded-lg bg-bg cursor-pointer hover:border-accent border border-sep transition"
                >
                  <input
                    type="checkbox"
                    checked={selectedHabits.includes(habit.id)}
                    onChange={() => toggleHabit(habit.id)}
                    className="mr-3"
                  />
                  <span className="flex-1">{habit.name}</span>
                  {habit.action_time && <span className="text-xs text-text3">{habit.action_time}</span>}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCreateStack}
              className="flex-1 py-2 bg-accent text-white rounded font-semibold"
            >
              Create
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setStackName('');
                setSelectedHabits([]);
              }}
              className="flex-1 py-2 bg-surface border border-sep text-text rounded font-semibold"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      )}

      <div className="space-y-4">
        {stacks.map((stack) => (
          <motion.div
            key={stack.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.snappy}
            className="p-4 bg-surface rounded-lg border border-sep"
          >
            <div className="flex justify-between items-start mb-3">
              <div>
                <h4 className="font-semibold text-text">{stack.name}</h4>
                {stack.description && <p className="text-sm text-text2 mt-1">{stack.description}</p>}
              </div>
              <button
                onClick={() => handleDeleteStack(stack.id)}
                className="text-[var(--neg)] text-sm font-semibold hover:opacity-70"
              >
                Delete
              </button>
            </div>

            {/* Habit chain visualization */}
            <div className="space-y-3">
              {stack.habits
                .sort((a, b) => a.position - b.position)
                .map((habit, index) => (
                  <div key={habit.id}>
                    <div className="flex items-center gap-3 p-3 bg-bg rounded-lg">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                        style={{ backgroundColor: habit.habit_color }}
                      >
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-text">{habit.habit_name}</p>
                        {habit.habit_action_time && (
                          <p className="text-xs text-text3">@ {habit.habit_action_time}</p>
                        )}
                      </div>
                    </div>
                    {index < stack.habits.length - 1 && (
                      <div className="flex justify-center py-1">
                        <div className="w-1 h-4 bg-accent/30 rounded-full"></div>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
