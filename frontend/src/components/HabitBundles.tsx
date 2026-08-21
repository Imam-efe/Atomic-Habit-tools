import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';

interface Habit {
  id: string;
  name: string;
}

interface Bundle {
  id: string;
  required_habit_id: string;
  desire_habit_id: string;
  required_habit_name: string;
  desire_habit_name: string;
  reward_desc: string | null;
  is_active: number;
  total_completions: number;
  both_completed_count: number;
}

interface HabitBundlesProps {
  habits: Habit[];
  onRefresh?: () => void;
}

export function HabitBundles({ habits, onRefresh }: HabitBundlesProps) {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedRequired, setSelectedRequired] = useState('');
  const [selectedDesire, setSelectedDesire] = useState('');
  const [rewardDesc, setRewardDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Bundle[]>('/habit-bundles');
      setBundles(data);
    } catch (error) {
      console.error('Failed to load bundles:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleAddBundle = async () => {
    if (!selectedRequired || !selectedDesire) return;
    if (selectedRequired === selectedDesire) {
      alert('Cannot bundle habit with itself');
      return;
    }

    setSaving(true);
    try {
      await apiFetch('/habit-bundles', {
        method: 'POST',
        body: JSON.stringify({
          required_habit_id: selectedRequired,
          desire_habit_id: selectedDesire,
          reward_desc: rewardDesc.trim() || null,
        }),
      });
      setSelectedRequired('');
      setSelectedDesire('');
      setRewardDesc('');
      setShowAddForm(false);
      await load();
      onRefresh?.();
    } catch (error: any) {
      if (error.message?.includes('409')) {
        alert('Bundle already exists for these habits');
      } else {
        alert('Failed to create bundle');
      }
    }
    setSaving(false);
  };

  const handleDeleteBundle = async (id: string) => {
    if (!confirm('Delete this temptation bundle?')) return;
    setDeleting(id);
    try {
      await apiFetch(`/habit-bundles/${id}`, { method: 'DELETE' });
      await load();
      onRefresh?.();
    } catch {
      alert('Failed to delete bundle');
    }
    setDeleting(null);
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
          🔗 Temptation Bundles
        </h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-xs font-bold"
          style={{ color: 'var(--accent)' }}
        >
          {showAddForm ? 'Tutup' : '+ Tambah Bundle'}
        </button>
      </div>

      <AnimatePresence>
        {showAddForm && (
          <motion.div
            className="rounded-[18px] p-4 mb-4"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.smooth}
          >
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text2)' }}>
                  Habit yang Harus Dikerjakan
                </label>
                <select
                  className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={selectedRequired}
                  onChange={(e) => setSelectedRequired(e.target.value)}
                >
                  <option value="">Pilih habit...</option>
                  {habits.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text2)' }}>
                  Habit yang Diinginkan (Reward)
                </label>
                <select
                  className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={selectedDesire}
                  onChange={(e) => setSelectedDesire(e.target.value)}
                >
                  <option value="">Pilih habit...</option>
                  {habits.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold block mb-1" style={{ color: 'var(--text2)' }}>
                  Deskripsi Reward (opsional)
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  placeholder="Contoh: Minum kopi favorit"
                  value={rewardDesc}
                  onChange={(e) => setRewardDesc(e.target.value)}
                />
              </div>

              <button
                onClick={handleAddBundle}
                disabled={saving}
                className="neu-cta w-full py-2.5 rounded-xl text-xs font-bold text-white"
                style={{ background: 'var(--accentFill)' }}
              >
                {saving ? 'Menyimpan...' : 'Buat Bundle'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {bundles.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Belum ada temptation bundle. Buat satu untuk menghubungkan habit yang sulit dengan reward yang menyenangkan!
          </p>
        </div>
      ) : (
        <div
          className="rounded-[18px] overflow-hidden"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
        >
          {bundles.map((bundle, i) => (
            <div key={bundle.id}>
              {i > 0 && <div className="h-px" style={{ background: 'var(--sep)' }} />}
              <div className="p-4">
                <div className="flex items-start gap-3 mb-2">
                  <div className="flex-1">
                    <div className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--text)' }}>
                      ✓ {bundle.required_habit_name}
                      <span style={{ color: 'var(--text3)' }}>→</span>
                      🎁 {bundle.desire_habit_name}
                    </div>
                    {bundle.reward_desc && (
                      <div className="text-[10px] mt-1" style={{ color: 'var(--text2)' }}>
                        {bundle.reward_desc}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteBundle(bundle.id)}
                    disabled={deleting === bundle.id}
                    className="w-6 h-6 flex items-center justify-center rounded-lg flex-shrink-0"
                    style={{ background: 'rgba(255,69,58,0.1)' }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--neg)" strokeWidth="2.5">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
                <div className="text-[11px]" style={{ color: 'var(--text3)' }}>
                  Berhasil keduanya {bundle.both_completed_count} dari {bundle.total_completions} hari
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
