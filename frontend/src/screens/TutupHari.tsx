import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';

interface Shutdown {
  date: string;
  done: boolean;
  journal: string | null;
  mood: number | null;
  topPriorities: string[];
  kebun: {
    perluSiram: number;
    perluPupuk: number;
    siapPanen: number;
    terlantar: number;
    contoh: string[];
  };
  ternak: {
    tugasJatuhTempo: number;
    penting: number;
    kandangSesak: number;
    contoh: string[];
  };
}

const MOODS = [
  { value: 1, emoji: '😞', label: 'Berat' },
  { value: 2, emoji: '😕', label: 'Kurang' },
  { value: 3, emoji: '😐', label: 'Biasa' },
  { value: 4, emoji: '🙂', label: 'Baik' },
  { value: 5, emoji: '😄', label: 'Bagus' },
];

export default function TutupHariScreen() {
  const [journal, setJournal] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  // Selalu tiga slot: jumlah tetap membuat ritualnya terasa selesai, bukan
  // daftar yang bisa terus bertambah sampai jadi pekerjaan tersendiri.
  const [priorities, setPriorities] = useState<string[]>(['', '', '']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kebun, setKebun] = useState<Shutdown['kebun'] | null>(null);
  const [ternak, setTernak] = useState<Shutdown['ternak'] | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch<Shutdown>('/daily/shutdown')
      .then((data) => {
        if (cancelled) return;
        setJournal(data.journal ?? '');
        setMood(data.mood);
        setPriorities([0, 1, 2].map((i) => data.topPriorities[i] ?? ''));
        setSaved(data.done);
        setKebun(data.kebun ?? null);
        setTernak(data.ternak ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? (err.body.message ?? 'Gagal memuat.') : 'Terjadi kesalahan jaringan.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      await apiFetch('/daily/shutdown', {
        method: 'POST',
        body: JSON.stringify({
          journal: journal.trim() || undefined,
          mood: mood ?? undefined,
          topPriorities: priorities.map((p) => p.trim()).filter(Boolean),
        }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? (err.body.message ?? 'Gagal menyimpan.') : 'Terjadi kesalahan jaringan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      <div className="mb-5">
        <h1
          className="text-3xl font-extrabold tracking-tight"
          style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}
        >
          Tutup Hari
        </h1>
        <p className="text-xs font-semibold mt-1" style={{ color: 'var(--text2)' }}>
          Tiga menit untuk menutup hari dan menyiapkan besok
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-center py-10" style={{ color: 'var(--text2)' }}>
          Memuat…
        </div>
      ) : (
        <>
          {/* Menyiram sore justru lebih baik daripada tidak sama sekali di
              iklim panas, jadi sisa tugas kebun disebut di sini selagi masih
              sempat dikerjakan — bukan sebagai teguran, melainkan kesempatan
              terakhir hari itu. */}
          {kebun && (kebun.perluSiram + kebun.perluPupuk + kebun.siapPanen + kebun.terlantar) > 0 && (
            <motion.div
              className="rounded-[18px] p-4 mb-3 flex flex-col gap-1.5"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springs.gentle}
            >
              <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>🌱 Kebun belum selesai</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text2)' }}>
                {kebun.perluSiram > 0 && <span>💧 {kebun.perluSiram} perlu disiram</span>}
                {kebun.perluPupuk > 0 && <span>🌿 {kebun.perluPupuk} perlu dipupuk</span>}
                {kebun.siapPanen > 0 && <span>🧺 {kebun.siapPanen} siap panen</span>}
                {kebun.terlantar > 0 && <span style={{ color: '#ff3b30' }}>🕸️ {kebun.terlantar} lama tak tersentuh</span>}
              </div>
              {kebun.contoh.length > 0 && (
                <div className="text-[11px]" style={{ color: 'var(--text3)' }}>{kebun.contoh.join(', ')}</div>
              )}
            </motion.div>
          )}

          {/* Sama alasannya dengan kebun: kesempatan terakhir hari itu untuk
              tugas rawat yang masih bisa dikerjakan sebelum tidur — dan di
              sini, kelalaian yang dibawa ke besok bisa berarti hewan mati. */}
          {ternak && (ternak.tugasJatuhTempo + ternak.kandangSesak) > 0 && (
            <motion.div
              className="rounded-[18px] p-4 mb-3 flex flex-col gap-1.5"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.gentle, delay: 0.03 }}
            >
              <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>🐾 Ternak belum selesai</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text2)' }}>
                <span>📋 {ternak.tugasJatuhTempo} tugas jatuh tempo</span>
                {ternak.penting > 0 && <span style={{ color: '#ff3b30' }}>🚨 {ternak.penting} penting</span>}
                {ternak.kandangSesak > 0 && <span style={{ color: '#ff9f0a' }}>🏠 {ternak.kandangSesak} kandang sesak</span>}
              </div>
              {ternak.contoh.length > 0 && (
                <div className="text-[11px]" style={{ color: 'var(--text3)' }}>{ternak.contoh.join(', ')}</div>
              )}
            </motion.div>
          )}

          <motion.div
            className="rounded-[18px] p-5 mb-3 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.gentle}
          >
            <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              Bagaimana harimu?
            </div>
            <div className="flex justify-between gap-2">
              {MOODS.map((option) => (
                <motion.button
                  key={option.value}
                  className="flex-1 py-2.5 rounded-xl flex flex-col items-center gap-1"
                  style={{
                    background: mood === option.value ? 'var(--accentFill)' : 'var(--bg)',
                    boxShadow: mood === option.value ? 'none' : 'var(--neu-inset)',
                  }}
                  onClick={() => setMood(mood === option.value ? null : option.value)}
                  whileTap={{ scale: 0.94 }}
                  transition={springs.snappy}
                >
                  <span className="text-xl">{option.emoji}</span>
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: mood === option.value ? 'white' : 'var(--text3)' }}
                  >
                    {option.label}
                  </span>
                </motion.button>
              ))}
            </div>
          </motion.div>

          <motion.div
            className="rounded-[18px] p-5 mb-3 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.05 }}
          >
            <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              Satu baris tentang hari ini
            </div>
            <textarea
              className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              placeholder="Apa yang paling berkesan hari ini?"
              value={journal}
              onChange={(e) => setJournal(e.target.value)}
              maxLength={280}
              rows={3}
            />
            <div className="text-xs text-right font-semibold" style={{ color: 'var(--text3)' }}>
              {journal.length}/280
            </div>
          </motion.div>

          <motion.div
            className="rounded-[18px] p-5 mb-4 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.1 }}
          >
            <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              Tiga prioritas besok
            </div>
            {priorities.map((value, i) => (
              <input
                key={i}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder={`Prioritas ${i + 1}`}
                value={value}
                onChange={(e) => {
                  const next = [...priorities];
                  next[i] = e.target.value;
                  setPriorities(next);
                }}
                maxLength={120}
              />
            ))}
          </motion.div>

          <AnimatePresence>
            {error && (
              <motion.div
                className="rounded-[18px] p-4 mb-3 border-l-[3px]"
                style={{ background: 'rgba(255, 159, 10, 0.1)', borderColor: '#ff9f0a' }}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={collapse}
              >
                <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  {error}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            className="w-full py-3.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'var(--accentFill)', opacity: saving ? 0.6 : 1 }}
            onClick={handleSave}
            disabled={saving}
            whileTap={saving ? {} : { scale: 0.97 }}
            transition={springs.snappy}
          >
            {saving ? 'Menyimpan…' : saved ? 'Perbarui Tutup Hari' : 'Simpan & Tutup Hari'}
          </motion.button>

          <AnimatePresence>
            {saved && !saving && (
              <motion.div
                className="text-xs text-center mt-3 font-semibold"
                style={{ color: '#34c759' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                ✓ Hari ini sudah ditutup. Selamat istirahat.
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
