import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface HabitStat {
  id: string;
  name: string;
  color: string;
  streak: number;
  completions_this_week: number;
  consistency: number;
}

interface ReviewData {
  weekStart: string;
  weekEnd: string;
  daysElapsed: number;
  overallConsistency: number;
  habits: HabitStat[];
  review: {
    id: string;
    habit_reflection: string | null;
    obstacle: string | null;
    adjustment: string | null;
    identity_affirmation: string | null;
    rating: number;
  } | null;
}

const STARS = [1, 2, 3, 4, 5];

function formatWeekLabel(weekStart: string): string {
  const parts = weekStart.split('-');
  const start = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${start.getDate()} ${months[start.getMonth()]} – ${end.getDate()} ${months[end.getMonth()]}`;
}

export function WeeklyReview() {
  const { goBack } = useUIStore();
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [habitReflection, setHabitReflection] = useState('');
  const [obstacle, setObstacle] = useState('');
  const [adjustment, setAdjustment] = useState('');
  const [identityAffirmation, setIdentityAffirmation] = useState('');
  const [rating, setRating] = useState(3);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<ReviewData>('/weekly-review');
      setData(res);
      if (res.review) {
        setHabitReflection(res.review.habit_reflection ?? '');
        setObstacle(res.review.obstacle ?? '');
        setAdjustment(res.review.adjustment ?? '');
        setIdentityAffirmation(res.review.identity_affirmation ?? '');
        setRating(res.review.rating ?? 3);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch('/weekly-review', {
        method: 'POST',
        body: JSON.stringify({ habitReflection, obstacle, adjustment, identityAffirmation, rating }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      load();
    } catch {}
    setSaving(false);
  };

  /**
   * Fill the four reflection boxes from this week's own numbers.
   *
   * The boxes are the part of this screen people skip, so they sit empty and
   * the review loses its point. The draft lands in the same editable fields
   * and is not saved until the user presses Simpan, so nothing is recorded
   * that they have not read.
   */
  const generateDraft = async () => {
    const hasText = [habitReflection, obstacle, adjustment, identityAffirmation].some(v => v.trim());
    if (hasText && !confirm('Ganti isian yang sudah ada dengan draft AI?')) return;

    setDrafting(true);
    setDraftError(null);
    try {
      const res = await apiFetch<{
        habitReflection: string;
        obstacle: string;
        adjustment: string;
        identityAffirmation: string;
      }>('/weekly-review/draft', { method: 'POST', body: JSON.stringify({}) });

      setHabitReflection(res.habitReflection);
      setObstacle(res.obstacle);
      setAdjustment(res.adjustment);
      setIdentityAffirmation(res.identityAffirmation);
    } catch (err) {
      setDraftError(
        err instanceof Error && err.message.includes('kebiasaan')
          ? 'Belum ada kebiasaan untuk direfleksikan.'
          : 'Gagal membuat draft. Tulis manual atau coba lagi nanti.'
      );
    } finally {
      setDrafting(false);
    }
  };

  const consistencyColor = (pct: number) =>
    pct >= 80 ? 'var(--pos)' : pct >= 50 ? 'var(--warn)' : 'var(--neg)';

  return (
    <div
      className="min-h-screen px-5 pt-14 pb-tab-safe"
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
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.5px' }}>
            Review Mingguan
          </h1>
          {data && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
              {formatWeekLabel(data.weekStart)}
            </p>
          )}
        </div>
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
              KONSISTENSI MINGGU INI
            </p>
            <div className="flex items-end gap-3">
              <span
                className="text-5xl font-black"
                style={{ color: consistencyColor(data.overallConsistency), letterSpacing: '-1px' }}
              >
                {data.overallConsistency}%
              </span>
              <span className="text-sm mb-1" style={{ color: 'var(--text3)' }}>
                dari {data.daysElapsed} hari
              </span>
            </div>
            <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: consistencyColor(data.overallConsistency) }}
                initial={{ width: 0 }}
                animate={{ width: `${data.overallConsistency}%` }}
                transition={springs.smooth}
              />
            </div>
          </motion.div>

          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.05 }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
              PER KEBIASAAN
            </p>
            <div className="flex flex-col gap-3">
              {data.habits.map(h => (
                <div key={h.id}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{h.name}</span>
                    <span className="text-xs font-bold" style={{ color: consistencyColor(h.consistency) }}>
                      {h.completions_this_week}/{Math.min(data.daysElapsed, 7)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: h.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${h.consistency}%` }}
                      transition={springs.smooth}
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            className="rounded-[20px] p-5"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.1 }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
              NILAI MINGGU INI
            </p>
            <div className="flex gap-3 justify-center">
              {STARS.map(s => (
                <motion.button
                  key={s}
                  onClick={() => setRating(s)}
                  whileTap={{ scale: 0.8 }}
                  transition={springs.bouncy}
                  className="text-3xl"
                >
                  {s <= rating ? '⭐' : '☆'}
                </motion.button>
              ))}
            </div>
          </motion.div>

          <motion.div
            className="rounded-[20px] p-4 flex items-center gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.11 }}
          >
            <span className="text-xl flex-shrink-0" aria-hidden>✨</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>
                Draft otomatis
              </p>
              <p className="text-[10px] leading-snug" style={{ color: 'var(--text2)' }}>
                {draftError ?? 'Isi keempat kolom di bawah dari data minggu ini. Bisa diedit sebelum disimpan.'}
              </p>
            </div>
            <motion.button
              onClick={generateDraft}
              disabled={drafting}
              whileTap={{ scale: 0.94 }}
              transition={springs.snappy}
              className="neu-cta text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-white flex-shrink-0"
              style={{ background: 'var(--accentFill)', opacity: drafting ? 0.6 : 1 }}
            >
              {drafting ? 'Menulis…' : 'Buatkan'}
            </motion.button>
          </motion.div>

          {[
            { label: 'APA YANG BERHASIL?', value: habitReflection, setter: setHabitReflection, placeholder: 'Kebiasaan mana yang berjalan lancar minggu ini?' },
            { label: 'APA HAMBATANNYA?', value: obstacle, setter: setObstacle, placeholder: 'Apa yang membuat beberapa kebiasaan tidak terlaksana?' },
            { label: 'APA YANG PERLU DISESUAIKAN?', value: adjustment, setter: setAdjustment, placeholder: 'Perubahan kecil apa yang bisa membuat minggu depan lebih baik?' },
            { label: 'AFIRMASI IDENTITAS', value: identityAffirmation, setter: setIdentityAffirmation, placeholder: 'Saya adalah orang yang...' },
          ].map((field, i) => (
            <motion.div
              key={field.label}
              className="rounded-[20px] p-5"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.gentle, delay: 0.12 + i * 0.05 }}
            >
              <p className="text-[10px] font-extrabold uppercase tracking-wider mb-2" style={{ color: 'var(--text3)' }}>
                {field.label}
              </p>
              <textarea
                rows={3}
                className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none leading-relaxed"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder={field.placeholder}
                value={field.value}
                onChange={e => field.setter(e.target.value)}
              />
            </motion.div>
          ))}

          <motion.button
            className="w-full py-3.5 rounded-[18px] font-bold text-sm text-white"
            style={{ background: saved ? 'var(--posFill)' : 'var(--accentFill)', opacity: saving ? 0.7 : 1 }}
            onClick={handleSave}
            disabled={saving}
            whileTap={{ scale: 0.97 }}
            transition={springs.snappy}
          >
            {saved ? '✓ Tersimpan!' : saving ? 'Menyimpan...' : 'Simpan Review'}
          </motion.button>
        </div>
      ) : null}
    </div>
  );
}
