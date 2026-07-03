import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '@/stores/uiStore';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';

interface ActivityLog {
  id: string;
  label: string;
  hours: number;
  log_date: string;
}

const LABEL_COLORS: Record<string, string> = {
  'Deep Work': '#7C5CFF',
  'Shallow Work': '#FF9F0A',
  'Rest': '#5AC8FA',
  'Learning': '#34C759',
  'Social': '#FF375F',
  'Health': '#5E5CE6',
};

const LABELS = Object.keys(LABEL_COLORS);

export function Activity() {
  const { setSubScreen } = useUIStore();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [label, setLabel] = useState('Deep Work');
  const [hours, setHours] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  // Focus Timer state
  const [showTimer, setShowTimer] = useState(false);
  const [timerLabel, setTimerLabel] = useState('Deep Work');
  const [timerDuration, setTimerDuration] = useState(25); // in minutes
  const [timeLeft, setTimeLeft] = useState(25 * 60); // in seconds
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const timerRef = useRef<any>(null);
  const endTimeRef = useRef<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ActivityLog[]>('/activity');
      setLogs(data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Web Audio Synthesizer Beep
  const playBeep = () => {
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      const audioCtx = new AudioCtxClass();
      
      // Play a cute premium double chime (beep-beep)
      const playTone = (freq: number, startDelay: number, duration: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime + startDelay);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + startDelay + duration);
        osc.start(audioCtx.currentTime + startDelay);
        osc.stop(audioCtx.currentTime + startDelay + duration);
      };

      playTone(880, 0, 0.25);
      playTone(1109, 0.15, 0.35);
    } catch {}
  };

  // Timer Countdown loop with sleep/lock safety offset
  useEffect(() => {
    if (isTimerRunning) {
      endTimeRef.current = Date.now() + timeLeft * 1000;
      timerRef.current = setInterval(() => {
        if (endTimeRef.current) {
          const remaining = Math.round((endTimeRef.current - Date.now()) / 1000);
          if (remaining <= 0) {
            handleTimerComplete();
          } else {
            setTimeLeft(remaining);
          }
        }
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning]);

  const handleTimerComplete = async () => {
    setIsTimerRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    playBeep();
    
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }

    const elapsedHours = Number((timerDuration / 60).toFixed(2));
    
    // Auto log to database
    try {
      await apiFetch('/activity', {
        method: 'POST',
        body: JSON.stringify({
          label: timerLabel,
          hours: elapsedHours,
        }),
      });
      load();
      alert(`⏱️ Sesi ${timerLabel} (${timerDuration} menit) selesai! Aktivitas berhasil dicatat otomatis.`);
    } catch {
      alert(`⏱️ Sesi ${timerLabel} selesai!`);
    }

    // Reset timer
    setTimeLeft(timerDuration * 60);
  };

  const toggleTimer = () => {
    setIsTimerRunning(r => !r);
  };

  const resetTimer = () => {
    setIsTimerRunning(false);
    setTimeLeft(timerDuration * 60);
  };

  const handlePresetSelect = (mins: number) => {
    setIsTimerRunning(false);
    setTimerDuration(mins);
    setTimeLeft(mins * 60);
  };

  const handleAddLog = async () => {
    const hrVal = parseFloat(hours);
    if (!hrVal || hrVal <= 0) return;
    setSaving(true);
    try {
      await apiFetch('/activity', {
        method: 'POST',
        body: JSON.stringify({
          label,
          hours: hrVal,
        }),
      });
      load();
      setHours('');
      setShowAdd(false);
    } catch {}
    setSaving(false);
  };

  const handleDeleteLog = async (id: string) => {
    setLogs(prev => prev.filter(l => l.id !== id));
    await apiFetch(`/activity/${id}`, { method: 'DELETE' }).catch(() => load());
  };

  const totalHours = logs.reduce((s, l) => s + l.hours, 0);

  const summaryMap: Record<string, number> = {};
  LABELS.forEach(lbl => {
    summaryMap[lbl] = 0;
  });
  logs.forEach(l => {
    if (summaryMap[l.label] !== undefined) {
      summaryMap[l.label] += l.hours;
    } else {
      summaryMap[l.label] = l.hours;
    }
  });

  const activeSummaries = LABELS.map(name => ({
    name,
    hours: summaryMap[name],
    color: LABEL_COLORS[name],
    pct: totalHours > 0 ? (summaryMap[name] / totalHours) * 100 : 0,
  })).filter(x => x.hours > 0);

  const deepWorkHours = summaryMap['Deep Work'] || 0;
  const shallowWorkHours = summaryMap['Shallow Work'] || 0;

  let insightText = 'Mulai catat aktivitas harianmu untuk mendapatkan insight produktivitas di sini.';
  if (totalHours > 0) {
    if (deepWorkHours === 0) {
      insightText = 'Hari ini kamu belum mencatat Deep Work. Coba blokir waktu 1–2 jam tanpa distraksi besok pagi untuk menyelesaikan tugas terpenting.';
    } else if (shallowWorkHours > deepWorkHours) {
      insightText = `Kamu menghabiskan ${Math.round((shallowWorkHours/totalHours)*100)}% waktu hari ini untuk Shallow Work. Kurangi rapat/distraksi agar ada lebih banyak waktu Deep Work.`;
    } else {
      insightText = `Rasio kerja yang sangat baik! Kamu meluangkan ${deepWorkHours} jam untuk Deep Work. Pertahankan konsistensi ini untuk menggapai sasaranmu.`;
    }
  }

  // Timer SVG Circular Progress variables
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const totalSeconds = timerDuration * 60;
  const progressOffset = circumference - (timeLeft / totalSeconds) * circumference;

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen px-5 pt-16 pb-28" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setSubScreen(null)}
          className="inline-flex items-center gap-1 text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Lainnya
        </button>

        <div className="flex gap-2">
          <button
            onClick={() => setShowTimer(t => !t)}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
          >
            ⏱️
          </button>
          <motion.button
            onClick={() => setShowAdd(s => !s)}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'var(--accent)' }}
            whileTap={{ scale: 0.9 }}
            transition={springs.snappy}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </motion.button>
        </div>
      </div>

      <h1 className="text-3xl font-extrabold tracking-tight mb-2" style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}>
        Aktivitas
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
        Alokasi waktu · Hari ini
      </p>

      {/* Focus Timer Section */}
      <AnimatePresence>
        {showTimer && (
          <motion.div
            className="rounded-[22px] p-5 mb-5 flex flex-col items-center gap-4 text-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.smooth}
          >
            <div>
              <span className="text-[10px] font-black text-violet-400 block uppercase tracking-widest">⏱️ FOCUS TRACKER</span>
              <p className="text-xs text-neutral-400 mt-0.5">Blokir waktu harian Anda untuk Deep Work</p>
            </div>

            {/* Circular Progress Timer */}
            <div className="relative w-36 h-36 flex items-center justify-center my-1">
              <svg className="w-full h-full transform -rotate-90">
                {/* Track circle */}
                <circle
                  cx="72"
                  cy="72"
                  r={radius}
                  fill="transparent"
                  stroke="var(--track)"
                  strokeWidth="8"
                />
                {/* Progress circle */}
                <motion.circle
                  cx="72"
                  cy="72"
                  r={radius}
                  fill="transparent"
                  stroke="var(--accent)"
                  strokeWidth="8"
                  strokeDasharray={circumference}
                  strokeDashoffset={progressOffset}
                  strokeLinecap="round"
                  transition={{ ease: 'linear' }}
                />
              </svg>
              {/* Central Time Display */}
              <div className="absolute flex flex-col items-center">
                <span className="text-2xl font-mono font-black text-white" style={{ color: 'var(--text)' }}>
                  {formatTime(timeLeft)}
                </span>
                <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: 'var(--text3)' }}>
                  {timerLabel}
                </span>
              </div>
            </div>

            {/* Sesi Select & Presets */}
            <div className="w-full flex flex-col gap-2.5">
              <div className="flex gap-2">
                {['Deep Work', 'Learning'].map(lbl => (
                  <button
                    key={lbl}
                    onClick={() => { setTimerLabel(lbl); }}
                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold"
                    style={{
                      background: timerLabel === lbl ? 'var(--accentSoft)' : 'var(--bg)',
                      color: timerLabel === lbl ? 'var(--accent)' : 'var(--text2)',
                      border: `1px solid ${timerLabel === lbl ? 'var(--accent)' : 'var(--sep)'}`
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              <div className="flex justify-center gap-3 text-xs">
                {[15, 25, 50].map(mins => (
                  <button
                    key={mins}
                    onClick={() => handlePresetSelect(mins)}
                    className="px-3 py-1.5 rounded-lg font-bold"
                    style={{
                      background: timerDuration === mins ? 'var(--track)' : 'transparent',
                      color: 'var(--text2)'
                    }}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
            </div>

            {/* Timer Controls */}
            <div className="flex gap-3 w-full">
              <button
                onClick={toggleTimer}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white transition-colors"
                style={{ background: isTimerRunning ? '#FF9F0A' : 'var(--accent)' }}
              >
                {isTimerRunning ? 'Pause' : 'Start Focus'}
              </button>
              <button
                onClick={resetTimer}
                className="px-4 py-2.5 rounded-xl text-xs font-bold"
                style={{ background: 'var(--track)', color: 'var(--text2)' }}
              >
                Reset
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Log Form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 flex flex-col gap-3"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.smooth}
          >
            <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Log Alokasi Waktu</p>
            <select
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
              value={label}
              onChange={e => setLabel(e.target.value)}
            >
              {LABELS.map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <input
              type="number"
              step="0.5"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
              placeholder="Durasi (jam)... misal 1.5 atau 4"
              value={hours}
              onChange={e => setHours(e.target.value)}
              inputMode="decimal"
            />
            <div className="flex gap-2">
              <motion.button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'var(--accent)', opacity: saving ? 0.6 : 1 }}
                onClick={handleAddLog}
                disabled={saving}
                whileTap={{ scale: 0.97 }}
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </motion.button>
              <motion.button
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--track)', color: 'var(--text2)' }}
                onClick={() => { setShowAdd(false); setHours(''); }}
                whileTap={{ scale: 0.97 }}
              >
                Batal
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stacked Proportional Horizontal Bar */}
      {totalHours > 0 && (
        <div className="h-8 rounded-xl overflow-hidden flex mb-6">
          {activeSummaries.map((s, idx) => (
            <motion.div
              key={s.name}
              className="h-full first:rounded-l-xl last:rounded-r-xl"
              style={{
                background: s.color,
                width: `${s.pct}%`,
              }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ ...springs.gentle, delay: idx * 0.05 }}
              title={`${s.name}: ${s.hours} jam`}
            />
          ))}
        </div>
      )}

      {/* Productivity Focus Score Card */}
      {totalHours > 0 && (
        <div className="rounded-[18px] p-4 mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}>
          {(() => {
            const productive = (summaryMap['Deep Work'] || 0) + (summaryMap['Learning'] || 0);
            const score = totalHours > 0 ? Math.round((productive / totalHours) * 100) : 0;
            return (
              <>
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <span className="text-[11px] font-bold tracking-wider text-neutral-400 uppercase block">SKOR FOKUS HARI INI</span>
                    <span className="text-xs" style={{ color: 'var(--text2)' }}>
                      Rasio Deep Work & Belajar
                    </span>
                  </div>
                  <span className="text-2xl font-black text-violet-400">{score}/100</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden mb-2.5" style={{ background: 'var(--track)' }}>
                  <div 
                    className="h-full rounded-full" 
                    style={{ 
                      background: 'linear-gradient(90deg, #FF9F0A, #7C5CFF)', 
                      width: `${score}%` 
                    }} 
                  />
                </div>
                <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                  {score >= 70 ? 'Fokus Tinggi! Produktivitas luar biasa hari ini. 🚀' :
                   score >= 40 ? 'Fokus Cukup. Seimbangkan kerja dan istirahat. ⚖️' :
                   'Fokus Rendah. Coba kurangi distraksi besok pagi. 🛠️'}
                </p>
              </>
            );
          })()}
        </div>
      )}

      {/* Legend & Summary Cards */}
      {totalHours > 0 && (
        <div className="rounded-[18px] p-4 mb-4 flex flex-col gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}>
          <p className="text-[11px] font-bold tracking-wider text-neutral-400 uppercase">RINGKASAN DURASI</p>
          <div className="grid grid-cols-2 gap-3">
            {activeSummaries.map(s => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: s.color }} />
                <div className="min-w-0">
                  <p className="text-xs truncate font-semibold" style={{ color: 'var(--text2)' }}>{s.name}</p>
                  <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{s.hours} jam</p>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t pt-2.5 mt-1 flex justify-between items-center" style={{ borderColor: 'var(--sep)' }}>
            <span className="text-xs" style={{ color: 'var(--text2)' }}>Total Waktu Tercatat</span>
            <span className="text-base font-bold" style={{ color: 'var(--text)' }}>{totalHours} jam</span>
          </div>
        </div>
      )}

      {/* Dynamic AI Insight Card with breathing animation */}
      <motion.div
        className="rounded-[18px] p-4 mb-5 flex gap-3 items-start"
        style={{
          background: 'var(--accentSoft)',
          border: '1px solid var(--sep)',
        }}
        animate={{
          scale: [1, 1.02, 1],
          opacity: [0.9, 1, 0.9],
        }}
        transition={{
          duration: 3.5,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        <div style={{ color: 'var(--accent)' }} className="flex-shrink-0 mt-0.5">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text)' }}>
          {insightText}
        </p>
      </motion.div>

      {/* Today's Log List */}
      {loading ? (
        <div className="flex items-center justify-center py-2">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <p className="text-3xl">⏱️</p>
          <p className="text-sm" style={{ color: 'var(--text3)' }}>Belum ada durasi yang tercatat</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-bold tracking-wider text-neutral-400 uppercase mb-1">LOG DETAIL</p>
          <AnimatePresence>
            {logs.map(log => (
              <motion.div
                key={log.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="rounded-[14px] px-4 py-3 flex items-center justify-between"
                style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
              >
                <div className="flex items-center gap-3">
                  <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background: LABEL_COLORS[log.label] || '#fff' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{log.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold" style={{ color: 'var(--text2)' }}>{log.hours} jam</span>
                  <motion.button
                    className="w-6 h-6 flex items-center justify-center opacity-40 hover:opacity-100"
                    onClick={() => handleDeleteLog(log.id)}
                    whileTap={{ scale: 0.8 }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
