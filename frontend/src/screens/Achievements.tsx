import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earned: boolean;
  progress: number;
  currentValue: number;
  targetValue: number;
}

interface AchievementsData {
  badges: Badge[];
  earnedCount: number;
  totalCount: number;
}

export function Achievements() {
  const { goBack } = useUIStore();
  const [data, setData] = useState<AchievementsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<AchievementsData>('/achievements')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen px-5 pt-14 pb-28" style={{ background: 'var(--bg)' }}>
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
            Pencapaian
          </h1>
          {data && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text2)' }}>
              {data.earnedCount}/{data.totalCount} lencana didapat
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {(data?.badges ?? []).map((badge, i) => (
            <motion.div
              key={badge.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.gentle, delay: i * 0.03 }}
              className="rounded-[18px] p-4 flex flex-col items-center text-center gap-2"
              style={{
                background: 'var(--surface)',
                boxShadow: badge.earned ? 'var(--neu-raised)' : 'var(--neu-inset)',
                opacity: badge.earned ? 1 : 0.55,
              }}
            >
              <div className="text-3xl">{badge.icon}</div>
              <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{badge.name}</p>
              <p className="text-[11px]" style={{ color: 'var(--text3)' }}>{badge.description}</p>

              {!badge.earned && (
                <div className="w-full mt-1">
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${badge.progress}%`, background: 'var(--accentFill)' }}
                    />
                  </div>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>
                    {badge.currentValue}/{badge.targetValue}
                  </p>
                </div>
              )}
              {badge.earned && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}>
                  ✓ Selesai
                </span>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
