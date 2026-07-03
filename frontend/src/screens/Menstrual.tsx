import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '@/stores/uiStore';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';

interface MenstrualLog {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  notes: string | null;
}

interface MenstrualData {
  settings: {
    cycleLength: number;
    periodLength: number;
  };
  logs: MenstrualLog[];
}

// Date helpers
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function diffDays(dateStr1: string, dateStr2: string): number {
  const [y1, m1, d1] = dateStr1.split('-').map(Number);
  const [y2, m2, d2] = dateStr2.split('-').map(Number);
  const date1 = new Date(y1, m1 - 1, d1);
  const date2 = new Date(y2, m2 - 1, d2);
  return Math.round((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));
}

function getTodayStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatReadableDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

// Details on cycle phases
const PHASE_DETAILS = {
  menstrual: {
    name: 'Menstruasi',
    color: '#FF453A',
    bg: 'rgba(255, 69, 58, 0.15)',
    gradient: 'linear-gradient(135deg, #FF453A, #FF2D55)',
    desc: 'Tubuh meluruhkan lapisan dinding rahim karena tidak terjadi pembuahan. Estrogen & progesteron berada pada kadar terendah.',
    energy: 'Rendah (Sedikit lelah, kram perut, atau lesu adalah hal yang wajar).',
    workout: 'Olahraga ringan/pemulihan (Jalan santai, yin yoga, peregangan lembut).',
    nutrition: 'Makanan hangat & kaya zat besi (bayam, daging merah, kaldu tulang, sup hangat, jahe hangat).'
  },
  follicular: {
    name: 'Folikular',
    color: '#34C759',
    bg: 'rgba(52, 199, 89, 0.15)',
    gradient: 'linear-gradient(135deg, #34C759, #5BD97A)',
    desc: 'FSH meningkat memicu perkembangan folikel telur. Estrogen mulai naik, membantu menebalkan kembali dinding rahim dan meningkatkan stamina.',
    energy: 'Meningkat secara bertahap (Suasana hati membaik, motivasi & fokus tinggi).',
    workout: 'Cardio sedang & latihan kekuatan (Brisk walking, jogging ringan, pilates dinamis).',
    nutrition: 'Makanan segar & kaya probiotik (sayuran mentah, buah-buahan berry, kimchi, makanan terfermentasi).'
  },
  ovulation: {
    name: 'Ovulasi & Jendela Subur',
    color: '#AF52DE',
    bg: 'rgba(175, 82, 222, 0.15)',
    gradient: 'linear-gradient(135deg, #AF52DE, #7C5CFF)',
    desc: 'Sel telur matang dilepaskan ke tuba falopi. Hormon estrogen mencapai puncak, memicu lonjakan LH. Peluang kehamilan berada di titik tertinggi.',
    energy: 'Sangat Tinggi (Penuh percaya diri, komunikatif, dan bertenaga).',
    workout: 'Latihan intensitas tinggi (HIIT, angkat beban berat, lari cepat, olahraga kelompok).',
    nutrition: 'Makanan kaya antioksidan & anti-inflamasi (berry, kacang almond, brokoli, alpukat, salmon).'
  },
  luteal: {
    name: 'Luteal',
    color: '#FF9F0A',
    bg: 'rgba(255, 159, 10, 0.15)',
    gradient: 'linear-gradient(135deg, #FF9F0A, #FFB740)',
    desc: 'Folikel kosong berubah menjadi korpus luteum yang memproduksi progesteron untuk mempersiapkan rahim. Jika tidak dibuahi, kadar hormon akan drop tajam di akhir fase.',
    energy: 'Menurun perlahan (Lebih introspektif, mungkin mengalami retensi air atau gejala PMS menjelang akhir fase).',
    workout: 'Intensitas sedang-rendah (Pilates, yoga vinyasa, latihan kekuatan beban sedang).',
    nutrition: 'Karbohidrat kompleks & lemak sehat (ubi jalar, pisang, alpukat, dark chocolate untuk meredakan PMS).'
  },
  none: {
    name: 'Belum Ada Data',
    color: '#8E8E93',
    bg: 'rgba(142, 142, 147, 0.15)',
    gradient: 'linear-gradient(135deg, #8E8E93, #AEAEB2)',
    desc: 'Tambahkan log menstruasi pertama Anda untuk mulai memproyeksikan siklus menstruasi, hari subur, hari ovulasi, serta informasi fase hormon harian.',
    energy: '-',
    workout: '-',
    nutrition: '-'
  }
};

export function Menstrual() {
  const { setSubScreen } = useUIStore();
  const [data, setData] = useState<MenstrualData>({
    settings: { cycleLength: 28, periodLength: 5 },
    logs: []
  });
  const [loading, setLoading] = useState(true);

  // Calendar state
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDayStr, setSelectedDayStr] = useState<string>(getTodayStr());

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [cycleLengthVal, setCycleLengthVal] = useState(28);
  const [periodLengthVal, setPeriodLengthVal] = useState(5);
  const [savingSettings, setSavingSettings] = useState(false);

  // Add Log Form State
  const [showAddLog, setShowAddLog] = useState(false);
  const [startDateVal, setStartDateVal] = useState(getTodayStr());
  const [endDateVal, setEndDateVal] = useState('');
  const [notesVal, setNotesVal] = useState('');
  const [savingLog, setSavingLog] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<MenstrualData>('/menstrual');
      // Sort logs descending by startDate
      res.logs.sort((a, b) => b.startDate.localeCompare(a.startDate));
      setData(res);
      setCycleLengthVal(res.settings.cycleLength);
      setPeriodLengthVal(res.settings.periodLength);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await apiFetch('/menstrual/settings', {
        method: 'POST',
        body: JSON.stringify({
          cycleLength: cycleLengthVal,
          periodLength: periodLengthVal
        })
      });
      await loadData();
      setShowSettings(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddLog = async () => {
    if (!startDateVal) return;
    setSavingLog(true);
    try {
      await apiFetch('/menstrual/logs', {
        method: 'POST',
        body: JSON.stringify({
          startDate: startDateVal,
          endDate: endDateVal || undefined,
          notes: notesVal.trim() || undefined
        })
      });
      await loadData();
      setNotesVal('');
      setEndDateVal('');
      setShowAddLog(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingLog(false);
    }
  };

  const handleDeleteLog = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus log ini?')) return;
    try {
      await apiFetch(`/menstrual/logs/${id}`, {
        method: 'DELETE'
      });
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  // Date classifications
  const latestLog = data.logs.length > 0 ? data.logs[0] : null;
  const cycleLength = data.settings.cycleLength;
  const periodLength = data.settings.periodLength;

  const checkLoggedPeriod = (dateStr: string) => {
    for (const log of data.logs) {
      const start = log.startDate;
      const end = log.endDate || addDays(log.startDate, periodLength - 1);
      if (dateStr >= start && dateStr <= end) {
        return { isPeriod: true, log };
      }
    }
    return { isPeriod: false, log: null };
  };

  const getOvulationDayForStart = (startStr: string) => {
    return addDays(startStr, cycleLength - 14);
  };

  const checkOvulation = (dateStr: string) => {
    // Check logged
    for (const log of data.logs) {
      const ovul = getOvulationDayForStart(log.startDate);
      if (dateStr === ovul) return true;
    }
    // Check predicted
    if (latestLog) {
      for (let k = 1; k <= 6; k++) {
        const predStart = addDays(latestLog.startDate, k * cycleLength);
        const ovul = getOvulationDayForStart(predStart);
        if (dateStr === ovul) return true;
      }
    }
    return false;
  };

  const checkFertileWindow = (dateStr: string) => {
    // Check logged
    for (const log of data.logs) {
      const ovul = getOvulationDayForStart(log.startDate);
      const fertStart = addDays(ovul, -5);
      const fertEnd = addDays(ovul, 1);
      if (dateStr >= fertStart && dateStr <= fertEnd) return true;
    }
    // Check predicted
    if (latestLog) {
      for (let k = 1; k <= 6; k++) {
        const predStart = addDays(latestLog.startDate, k * cycleLength);
        const ovul = getOvulationDayForStart(predStart);
        const fertStart = addDays(ovul, -5);
        const fertEnd = addDays(ovul, 1);
        if (dateStr >= fertStart && dateStr <= fertEnd) return true;
      }
    }
    return false;
  };

  const checkPredictedPeriod = (dateStr: string) => {
    if (!latestLog) return false;
    for (let k = 1; k <= 6; k++) {
      const predStart = addDays(latestLog.startDate, k * cycleLength);
      const predEnd = addDays(predStart, periodLength - 1);
      if (dateStr >= predStart && dateStr <= predEnd) return true;
    }
    return false;
  };

  // Get active status based on a specific date (local)
  const getCycleStateForDate = (dateStr: string) => {
    if (!latestLog) {
      return {
        day: 0,
        isOverdue: false,
        overdueDays: 0,
        phase: 'none' as const,
        phaseName: 'Belum ada log',
        daysToNextPeriod: 0
      };
    }

    const diff = diffDays(latestLog.startDate, dateStr);
    const nextPeriodStart = addDays(latestLog.startDate, cycleLength);
    const daysToNext = diffDays(dateStr, nextPeriodStart);

    if (diff < 0) {
      return {
        day: 0,
        isOverdue: false,
        overdueDays: 0,
        phase: 'none' as const,
        phaseName: 'Siklus akan datang',
        daysToNextPeriod: daysToNext
      };
    }

    // cycleDay within cycleLength
    const cycleDay = (diff % cycleLength) + 1;
    const isOverdue = diff >= cycleLength; // Wait, actually isOverdue if not started yet but exceeded cycle length
    const overdueDays = diff >= cycleLength ? diff - cycleLength + 1 : 0;

    const ovulationDay = cycleLength - 14;

    let phase: 'menstrual' | 'follicular' | 'ovulation' | 'luteal' = 'luteal';
    let phaseName = 'Luteal';

    // If actual period is logged, force menstrual phase
    const logged = checkLoggedPeriod(dateStr);
    if (logged.isPeriod) {
      phase = 'menstrual';
      phaseName = 'Menstruasi';
    } else {
      if (cycleDay <= periodLength) {
        phase = 'menstrual';
        phaseName = 'Menstruasi';
      } else if (cycleDay <= ovulationDay - 6) {
        phase = 'follicular';
        phaseName = 'Folikular';
      } else if (cycleDay >= ovulationDay - 5 && cycleDay <= ovulationDay + 1) {
        phase = 'ovulation';
        phaseName = 'Ovulasi (Masa Subur)';
      } else {
        phase = 'luteal';
        phaseName = 'Luteal';
      }
    }

    return {
      day: cycleDay,
      isOverdue,
      overdueDays,
      phase,
      phaseName,
      daysToNextPeriod: daysToNext
    };
  };

  const todayStr = getTodayStr();
  const todayState = getCycleStateForDate(todayStr);
  const selectedDayState = getCycleStateForDate(selectedDayStr);

  // Generate calendar grid
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-indexed

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const daysInMonth = lastDayOfMonth.getDate();
  const lastDayOfPrevMonth = new Date(year, month, 0).getDate();

  // Align to Monday-start calendar
  // firstDayOfMonth.getDay() -> Sunday = 0, Monday = 1, etc.
  const startOffset = (firstDayOfMonth.getDay() === 0 ? 7 : firstDayOfMonth.getDay()) - 1;

  const calendarDays = [];

  // Trailing days from previous month
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = lastDayOfPrevMonth - i;
    let prevMonth = month - 1;
    let prevYear = year;
    if (prevMonth < 0) {
      prevMonth = 11;
      prevYear--;
    }
    const dStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    calendarDays.push({
      day: d,
      isCurrentMonth: false,
      dateStr: dStr
    });
  }

  // Days of current month
  for (let i = 1; i <= daysInMonth; i++) {
    const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    calendarDays.push({
      day: i,
      isCurrentMonth: true,
      dateStr: dStr
    });
  }

  // Leading days of next month to fill complete weeks (rows of 7, up to 35 or 42)
  const totalCells = calendarDays.length <= 35 ? 35 : 42;
  const nextMonthDaysCount = totalCells - calendarDays.length;
  for (let i = 1; i <= nextMonthDaysCount; i++) {
    let nextMonth = month + 1;
    let nextYear = year;
    if (nextMonth > 11) {
      nextMonth = 0;
      nextYear++;
    }
    const dStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    calendarDays.push({
      day: i,
      isCurrentMonth: false,
      dateStr: dStr
    });
  }

  // Navigation handlers
  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const activeDetails = PHASE_DETAILS[selectedDayState.phase];

  return (
    <div className="min-h-screen px-5 pt-16 pb-28 animate-[fyScreen_420ms_cubic-bezier(0.25,0.46,0.45,0.94)_both]" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
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
          {/* Settings Button */}
          <motion.button
            onClick={() => setShowSettings(s => !s)}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            whileTap={{ scale: 0.9 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </motion.button>
          {/* Add Log Button */}
          <motion.button
            onClick={() => setShowAddLog(s => !s)}
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

      <h1 className="text-3xl font-extrabold tracking-tight mb-5" style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}>
        Kalender Haid
      </h1>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 flex flex-col gap-3"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <h3 className="font-bold text-sm" style={{ color: 'var(--text)' }}>Pengaturan Siklus Rata-Rata</h3>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text2)' }}>Panjang Siklus (Hari)</label>
                <input
                  type="number"
                  min="20"
                  max="45"
                  value={cycleLengthVal}
                  onChange={(e) => setCycleLengthVal(parseInt(e.target.value) || 28)}
                  className="w-full px-3 py-2 text-sm rounded-lg"
                  style={{ background: 'var(--bg)', border: '1px solid var(--sep)', color: 'var(--text)' }}
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text2)' }}>Panjang Haid (Hari)</label>
                <input
                  type="number"
                  min="3"
                  max="14"
                  value={periodLengthVal}
                  onChange={(e) => setPeriodLengthVal(parseInt(e.target.value) || 5)}
                  className="w-full px-3 py-2 text-sm rounded-lg"
                  style={{ background: 'var(--bg)', border: '1px solid var(--sep)', color: 'var(--text)' }}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={() => setShowSettings(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg"
                style={{ color: 'var(--text2)' }}
              >
                Batal
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white"
                style={{ background: 'var(--accent)' }}
              >
                {savingSettings ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Log Panel */}
      <AnimatePresence>
        {showAddLog && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 flex flex-col gap-3"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <h3 className="font-bold text-sm" style={{ color: 'var(--text)' }}>Log Periode Haid Baru</h3>
            <div className="flex flex-col gap-2">
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text2)' }}>Tanggal Mulai *</label>
                <input
                  type="date"
                  value={startDateVal}
                  onChange={(e) => setStartDateVal(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg"
                  style={{ background: 'var(--bg)', border: '1px solid var(--sep)', color: 'var(--text)' }}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text2)' }}>Tanggal Selesai (Opsional)</label>
                <input
                  type="date"
                  value={endDateVal}
                  onChange={(e) => setEndDateVal(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg"
                  style={{ background: 'var(--bg)', border: '1px solid var(--sep)', color: 'var(--text)' }}
                />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--text2)' }}>Catatan / Gejala</label>
                <textarea
                  placeholder="Misal: kram ringan, kembung, mood swing"
                  value={notesVal}
                  onChange={(e) => setNotesVal(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg h-16 resize-none"
                  style={{ background: 'var(--bg)', border: '1px solid var(--sep)', color: 'var(--text)' }}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={() => setShowAddLog(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg"
                style={{ color: 'var(--text2)' }}
              >
                Batal
              </button>
              <button
                onClick={handleAddLog}
                disabled={savingLog || !startDateVal}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white"
                style={{ background: 'var(--accent)' }}
              >
                {savingLog ? 'Menyimpan...' : 'Simpan Log'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex items-center justify-center py-16" style={{ color: 'var(--text2)' }}>
          <p className="text-sm font-medium">Memuat data siklus...</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Hero State Card */}
          <motion.div
            className="rounded-[24px] p-6 text-center relative overflow-hidden flex flex-col items-center justify-center shadow-lg"
            style={{
              background: latestLog ? PHASE_DETAILS[todayState.phase].gradient : PHASE_DETAILS.none.gradient,
              boxShadow: latestLog
                ? `0 12px 24px -10px ${PHASE_DETAILS[todayState.phase].color}66`
                : 'none'
            }}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={springs.firm}
          >
            {/* Glossy Overlay */}
            <div className="absolute inset-0 bg-white/5 backdrop-blur-[1px] pointer-events-none" />

            {latestLog ? (
              <>
                <p className="text-xs font-bold text-white/70 uppercase tracking-widest mb-1">Status Hari Ini</p>
                <h2 className="text-4xl font-black text-white tracking-tight mb-1">
                  {todayState.isOverdue ? (
                    `Telat ${todayState.overdueDays} Hari`
                  ) : todayState.phase === 'menstrual' ? (
                    `Haid Hari ke-${todayState.day}`
                  ) : (
                    `Hari ke-${todayState.day}`
                  )}
                </h2>
                <div className="inline-flex items-center gap-1.5 bg-white/20 px-3 py-1 rounded-full text-xs font-bold text-white mb-4">
                  <span>{todayState.phaseName}</span>
                  {todayState.phase === 'ovulation' && <span>✨</span>}
                </div>

                <div className="h-px w-24 bg-white/30 mb-4" />

                <p className="text-sm text-white/90 font-medium">
                  {todayState.daysToNextPeriod > 0
                    ? `Estimasi ${todayState.daysToNextPeriod} hari menuju haid berikutnya`
                    : todayState.daysToNextPeriod === 0
                    ? 'Hari ini estimasi hari pertama haid Anda!'
                    : `Haid terlambat sekitar ${Math.abs(todayState.daysToNextPeriod)} hari`}
                </p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-white tracking-tight mb-2">Mulai Pelacakan Siklus</h2>
                <p className="text-xs text-white/80 max-w-[280px] mb-4">
                  Klik tombol tambah (+) di kanan atas untuk mencatat hari pertama haid terakhir Anda.
                </p>
                <button
                  onClick={() => setShowAddLog(true)}
                  className="px-4 py-2 bg-white text-black font-bold text-xs rounded-full shadow-sm hover:scale-105 transition-transform"
                >
                  Tambah Log Haid Pertama
                </button>
              </>
            )}
          </motion.div>

          {/* Calendar Card */}
          <div
            className="rounded-[24px] p-5 flex flex-col gap-4 shadow-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
          >
            {/* Calendar Header */}
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[17px]" style={{ color: 'var(--text)' }}>
                {currentDate.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}
              </h3>
              <div className="flex gap-1">
                <button
                  onClick={handlePrevMonth}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5"
                  style={{ color: 'var(--text)' }}
                >
                  ‹
                </button>
                <button
                  onClick={handleNextMonth}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5"
                  style={{ color: 'var(--text)' }}
                >
                  ›
                </button>
              </div>
            </div>

            {/* Weekdays */}
            <div className="grid grid-cols-7 text-center text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
              <div>S</div>
              <div>S</div>
              <div>R</div>
              <div>K</div>
              <div>J</div>
              <div>S</div>
              <div>M</div>
            </div>

            {/* Grid days */}
            <div className="grid grid-cols-7 gap-y-2.5 justify-items-center text-center">
              {calendarDays.map((cell, idx) => {
                const logged = checkLoggedPeriod(cell.dateStr);
                const isLogged = logged.isPeriod;
                const isPred = checkPredictedPeriod(cell.dateStr);
                const isOvul = checkOvulation(cell.dateStr);
                const isFert = checkFertileWindow(cell.dateStr);
                const isToday = cell.dateStr === todayStr;
                const isSelected = cell.dateStr === selectedDayStr;

                // Styling logic
                let dayBg = 'transparent';
                let textColor = cell.isCurrentMonth ? 'var(--text)' : 'var(--text3)';
                let borderStyle = 'none';
                let fontStyle = 'font-semibold';

                if (isLogged) {
                  dayBg = '#FF453A';
                  textColor = '#FFFFFF';
                } else if (isPred) {
                  dayBg = 'rgba(255, 69, 58, 0.15)';
                  borderStyle = '1px dashed #FF453A';
                  textColor = '#FF453A';
                } else if (isFert) {
                  dayBg = 'rgba(175, 82, 222, 0.15)';
                  textColor = '#AF52DE';
                }

                if (isSelected) {
                  borderStyle = '2px solid var(--accent)';
                }

                return (
                  <motion.button
                    key={`${cell.dateStr}-${idx}`}
                    onClick={() => setSelectedDayStr(cell.dateStr)}
                    className="w-9 h-9 rounded-full flex flex-col items-center justify-center text-sm relative"
                    style={{
                      background: dayBg,
                      color: textColor,
                      border: borderStyle,
                    }}
                    whileTap={{ scale: 0.9 }}
                  >
                    {isToday && (
                      <span
                        className="absolute bottom-1 w-1.5 h-1.5 rounded-full"
                        style={{ background: isLogged ? '#FFFFFF' : 'var(--accent)' }}
                      />
                    )}

                    <span className={fontStyle}>{cell.day}</span>

                    {/* Ovulation Dot / Star */}
                    {isOvul && (
                      <span
                        className="absolute -top-0.5 -right-0.5 text-[9px] drop-shadow-sm select-none"
                        title="Hari Ovulasi"
                      >
                        ⭐
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-2 border-t pt-3 text-[11px] font-semibold uppercase tracking-wider" style={{ borderColor: 'var(--sep)', color: 'var(--text2)' }}>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#FF453A]" />
                <span>Haid (Logged)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full border border-dashed border-[#FF453A] bg-[#FF453A]/10" />
                <span>Prediksi Haid</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-purple-500/20 border border-purple-500/30" />
                <span>Masa Subur</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span>⭐</span>
                <span>Ovulasi</span>
              </div>
            </div>
          </div>

          {/* Selected Date Details */}
          <div
            className="rounded-[24px] p-5 flex flex-col gap-4 shadow-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text3)' }}>
                Detail Tanggal
              </p>
              <h3 className="font-bold text-lg" style={{ color: 'var(--text)' }}>
                {formatReadableDate(selectedDayStr)}
                {selectedDayStr === todayStr && <span className="ml-1.5 text-xs text-white bg-black/40 dark:bg-white/20 px-2 py-0.5 rounded-full font-bold">Hari Ini</span>}
              </h3>
            </div>

            {/* Info Items */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5">
                <p className="text-xs" style={{ color: 'var(--text2)' }}>Hari Siklus</p>
                <p className="text-base font-bold mt-0.5" style={{ color: 'var(--text)' }}>
                  {!latestLog ? '-' : (
                    selectedDayState.isOverdue
                      ? `Hari ke-${selectedDayState.day} (Telat)`
                      : `Hari ke-${selectedDayState.day}`
                  )}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-black/5 dark:bg-white/5">
                <p className="text-xs" style={{ color: 'var(--text2)' }}>Fase Hormonal</p>
                <p className="text-base font-bold mt-0.5" style={{ color: latestLog ? activeDetails.color : 'var(--text)' }}>
                  {activeDetails.name}
                </p>
              </div>
            </div>

            {/* Phase Description */}
            <div className="p-4 rounded-xl flex flex-col gap-2" style={{ background: latestLog ? activeDetails.bg : 'var(--bg)', border: latestLog ? `1px solid ${activeDetails.color}30` : 'none' }}>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest opacity-80" style={{ color: latestLog ? activeDetails.color : 'var(--text2)' }}>Fisiologi & Hormon</p>
                <p className="text-sm font-medium mt-1 leading-relaxed" style={{ color: 'var(--text)' }}>{activeDetails.desc}</p>
              </div>
              {latestLog && (
                <>
                  <div className="h-px my-1 opacity-20" style={{ background: activeDetails.color }} />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest opacity-80" style={{ color: activeDetails.color }}>Stamina & Energi</p>
                    <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text)' }}>{activeDetails.energy}</p>
                  </div>
                  <div className="h-px my-1 opacity-20" style={{ background: activeDetails.color }} />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest opacity-80" style={{ color: activeDetails.color }}>Rekomendasi Olahraga</p>
                    <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text)' }}>{activeDetails.workout}</p>
                  </div>
                  <div className="h-px my-1 opacity-20" style={{ background: activeDetails.color }} />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest opacity-80" style={{ color: activeDetails.color }}>Saran Nutrisi</p>
                    <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text)' }}>{activeDetails.nutrition}</p>
                  </div>
                </>
              )}
            </div>

            {/* Quick Action Button for Selected Date */}
            {(() => {
              const logged = checkLoggedPeriod(selectedDayStr);
              if (logged.isPeriod && logged.log) {
                return (
                  <button
                    onClick={() => handleDeleteLog(logged.log!.id)}
                    className="w-full py-2.5 rounded-xl border font-bold text-sm text-[#FF453A] flex items-center justify-center gap-1.5"
                    style={{ borderColor: 'rgba(255, 69, 58, 0.3)', background: 'rgba(255, 69, 58, 0.05)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                    Hapus Log Haid Ini
                  </button>
                );
              } else {
                return (
                  <button
                    onClick={() => {
                      setStartDateVal(selectedDayStr);
                      setShowAddLog(true);
                    }}
                    className="w-full py-2.5 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-1.5"
                    style={{ background: 'var(--accent)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Catat Mulai Haid di Tanggal Ini
                  </button>
                );
              }
            })()}
          </div>

          {/* History List */}
          <div
            className="rounded-[24px] p-5 flex flex-col gap-4 shadow-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
          >
            <h3 className="font-bold text-[17px]" style={{ color: 'var(--text)' }}>Riwayat Log Menstruasi</h3>

            {data.logs.length === 0 ? (
              <p className="text-xs py-4 text-center" style={{ color: 'var(--text3)' }}>Belum ada log haid yang tersimpan.</p>
            ) : (
              <div className="flex flex-col gap-3 max-h-[220px] overflow-y-auto pr-1">
                {data.logs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-xl flex items-start justify-between bg-black/5 dark:bg-white/5 border border-transparent"
                    style={{ border: log.startDate === latestLog?.startDate ? '1px solid rgba(255, 69, 58, 0.3)' : 'none' }}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                          {formatReadableDate(log.startDate)}
                        </p>
                        <span className="text-[10px]" style={{ color: 'var(--text3)' }}>sampai</span>
                        <p className="text-sm font-bold" style={{ color: log.endDate ? 'var(--text)' : '#FF453A' }}>
                          {log.endDate ? formatReadableDate(log.endDate) : '(Berjalan)'}
                        </p>
                      </div>
                      {log.notes && (
                        <p className="text-xs mt-1 italic leading-relaxed" style={{ color: 'var(--text2)' }}>
                          &ldquo;{log.notes}&rdquo;
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => handleDeleteLog(log.id)}
                      className="text-xs font-semibold p-1.5 rounded-lg text-[#FF453A] hover:bg-[#FF453A]/10"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
