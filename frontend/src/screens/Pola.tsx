import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';

interface PatternResult {
  patterns: Array<{
    id: string;
    text: string;
    support: { low: number; high: number };
    gapPoints: number;
  }>;
  daysAnalysed: number;
  skipped: Array<{ id: string; reason: string }>;
}

const LABELS: Record<string, string> = {
  sleep: 'Tidur',
  steps: 'Langkah',
  spend: 'Pengeluaran',
  habits: 'Kebiasaan',
};

export default function PolaScreen() {
  const [result, setResult] = useState<PatternResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch<PatternResult>('/daily/patterns')
      .then((data) => !cancelled && setResult(data))
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? (err.body.message ?? 'Gagal memuat.') : 'Terjadi kesalahan jaringan.');
        }
      })
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      <div className="mb-5">
        <h1
          className="text-3xl font-extrabold tracking-tight"
          style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}
        >
          Pola
        </h1>
        <p className="text-xs font-semibold mt-1" style={{ color: 'var(--text2)' }}>
          Hubungan antara kebiasaanmu dan data lain
        </p>
      </div>

      {loading && (
        <div className="text-sm text-center py-10" style={{ color: 'var(--text2)' }}>
          Menganalisis…
        </div>
      )}

      {error && (
        <div
          className="rounded-[18px] p-4 mb-3 border-l-[3px]"
          style={{ background: 'rgba(255, 159, 10, 0.1)', borderColor: '#ff9f0a' }}
        >
          <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            {error}
          </div>
        </div>
      )}

      {result && (
        <>
          {result.patterns.map((pattern, i) => (
            <motion.div
              key={pattern.id}
              className="rounded-[18px] p-4 mb-3 flex flex-col gap-2"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.gentle, delay: i * 0.05 }}
            >
              <div className="text-xs font-bold" style={{ color: 'var(--accent)' }}>
                {LABELS[pattern.id] ?? pattern.id}
              </div>
              <div className="text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
                {pattern.text}
              </div>
              {/* Jumlah hari penopang selalu ditampilkan. Sebuah pola dari
                  5 hari dan pola dari 40 hari tidak layak dibaca sama, dan
                  hanya pembaca yang bisa menilainya. */}
              <div className="text-xs" style={{ color: 'var(--text3)' }}>
                Berdasarkan {pattern.support.low} hari rendah dan {pattern.support.high} hari tinggi ·
                selisih {pattern.gapPoints} poin
              </div>
            </motion.div>
          ))}

          {result.patterns.length === 0 && (
            <motion.div
              className="rounded-[18px] p-5 mb-3"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springs.gentle}
            >
              <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>
                Belum ada pola yang cukup kuat
              </div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--text2)' }}>
                Ini bukan berarti tidak ada polanya — datanya saja yang belum cukup untuk
                menyimpulkan apa pun dengan jujur. Terus catat kebiasaan beberapa minggu lagi.
              </div>
            </motion.div>
          )}

          {result.skipped.length > 0 && (
            <motion.div
              className="rounded-[18px] p-4 mb-3 flex flex-col gap-2"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.gentle, delay: 0.1 }}
            >
              <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                Yang belum bisa dianalisis
              </div>
              {result.skipped.map((item) => (
                <div key={item.id} className="flex flex-col gap-0.5">
                  <div className="text-xs font-semibold" style={{ color: 'var(--text2)' }}>
                    {LABELS[item.id] ?? item.id}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text3)' }}>
                    {item.reason}
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          <div className="text-xs text-center mt-4" style={{ color: 'var(--text3)' }}>
            {result.daysAnalysed} hari dianalisis. Data tidur dan langkah masuk lewat Apple Health —
            lihat panduan di Lainnya.
          </div>
        </>
      )}
    </div>
  );
}
