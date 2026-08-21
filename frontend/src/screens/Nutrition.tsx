import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '@/stores/uiStore';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';

interface FoodLog {
  id: string;
  name: string;
  portion: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  label: string | null;
  date: string;
}

interface NutritionData {
  foodLogs: FoodLog[];
  target: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
  summary: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
}

export function Nutrition() {
  const { setSubScreen } = useUIStore();
  const [data, setData] = useState<NutritionData | null>(null);
  const [loading, setLoading] = useState(true);

  // Food logger form state
  const [showAddFood, setShowAddFood] = useState(false);
  const [foodName, setFoodName] = useState('');
  const [portion, setPortion] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [foodLabel, setFoodLabel] = useState('Sehat');
  const [savingFood, setSavingFood] = useState(false);

  // Targets adjustment state
  const [showEditTarget, setShowEditTarget] = useState(false);
  const [targetKcal, setTargetKcal] = useState('');
  const [targetProt, setTargetProt] = useState('');
  const [targetCarb, setTargetCarb] = useState('');
  const [targetFat, setTargetFat] = useState('');
  const [targetFib, setTargetFib] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<NutritionData>('/nutrition');
      setData(res);
      // prefill target forms
      setTargetKcal(res.target.calories.toString());
      setTargetProt(res.target.protein.toString());
      setTargetCarb(res.target.carbs.toString());
      setTargetFat(res.target.fat.toString());
      setTargetFib(res.target.fiber.toString());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAddFood = async () => {
    if (!foodName.trim()) return;
    setSavingFood(true);
    try {
      await apiFetch('/nutrition/food', {
        method: 'POST',
        body: JSON.stringify({
          name: foodName.trim(),
          portion: portion.trim() || undefined,
          calories: calories ? parseInt(calories) : 0,
          protein: protein ? parseFloat(protein) : 0,
          carbs: carbs ? parseFloat(carbs) : 0,
          fat: fat ? parseFloat(fat) : 0,
          fiber: fiber ? parseFloat(fiber) : 0,
          label: foodLabel,
        }),
      });
      load();
      setFoodName('');
      setPortion('');
      setCalories('');
      setProtein('');
      setCarbs('');
      setFat('');
      setFiber('');
      setShowAddFood(false);
    } catch {}
    setSavingFood(false);
  };

  const handleDeleteFood = async (id: string) => {
    // optimistic delete
    if (data) {
      const filtered = data.foodLogs.filter(f => f.id !== id);
      const deletedFood = data.foodLogs.find(f => f.id === id);
      if (deletedFood) {
        setData({
          ...data,
          foodLogs: filtered,
          summary: {
            calories: Math.max(0, data.summary.calories - deletedFood.calories),
            protein: Math.max(0, data.summary.protein - deletedFood.protein),
            carbs: Math.max(0, data.summary.carbs - deletedFood.carbs),
            fat: Math.max(0, data.summary.fat - deletedFood.fat),
            fiber: Math.max(0, data.summary.fiber - deletedFood.fiber),
          },
        });
      }
    }
    await apiFetch(`/nutrition/food/${id}`, { method: 'DELETE' }).catch(() => load());
  };

  const handleSaveTarget = async () => {
    setSavingTarget(true);
    try {
      await apiFetch('/nutrition/target', {
        method: 'POST',
        body: JSON.stringify({
          calories: parseInt(targetKcal),
          protein: parseInt(targetProt),
          carbs: parseInt(targetCarb),
          fat: parseInt(targetFat),
          fiber: parseInt(targetFib),
        }),
      });
      load();
      setShowEditTarget(false);
    } catch {}
    setSavingTarget(false);
  };

  // SVG calculations for Calorie Ring
  const circleRadius = 46;
  const circumference = 2 * Math.PI * circleRadius;
  const currentKcal = data?.summary.calories ?? 0;
  const targetKcalVal = data?.target.calories ?? 2200;
  const kcalRemaining = Math.max(0, targetKcalVal - currentKcal);
  const kcalPercent = targetKcalVal > 0 ? currentKcal / targetKcalVal : 0;
  const strokeDashoffset = circumference - Math.min(1, kcalPercent) * circumference;

  // Macro progress calculations
  const macros = data ? [
    { name: 'Protein', key: 'protein', summary: data.summary.protein, target: data.target.protein, color: '#FF375F', unit: 'g' },
    { name: 'Karbohidrat', key: 'carbs', summary: data.summary.carbs, target: data.target.carbs, color: 'var(--warn)', unit: 'g' },
    { name: 'Lemak', key: 'fat', summary: data.summary.fat, target: data.target.fat, color: '#5AC8FA', unit: 'g' },
    { name: 'Serat', key: 'fiber', summary: data.summary.fiber, target: data.target.fiber, color: 'var(--pos)', unit: 'g' },
  ] : [];

  // Gap analysis string
  let gapString = 'Target gizi tercapai dengan baik!';
  if (data) {
    const proteinGap = Math.max(0, data.target.protein - data.summary.protein);
    const fiberGap = Math.max(0, data.target.fiber - data.summary.fiber);
    if (proteinGap > 0) {
      gapString = `Gap: kurang ${Math.round(proteinGap)}g protein hari ini.`;
    } else if (fiberGap > 0) {
      gapString = `Gap: kurang ${Math.round(fiberGap)}g serat hari ini.`;
    }
  }

  // Label styling helpers
  const getLabelColors = (label: string | null) => {
    switch (label) {
      case 'Sehat':
        return { bg: 'rgba(52,199,89,0.15)', text: 'var(--pos)' };
      case 'Moderat':
        return { bg: 'rgba(255,159,10,0.15)', text: 'var(--warn)' };
      case 'Indulge':
        return { bg: 'rgba(255,55,95,0.15)', text: '#FF375F' };
      default:
        return { bg: 'var(--track)', text: 'var(--text2)' };
    }
  };

  return (
    <div className="min-h-screen px-5 pt-16 pb-28" style={{ background: 'var(--bg)' }}>
      {/* Header / Back / Setup Target */}
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
          {/* Target setting button */}
          <motion.button
            onClick={() => setShowEditTarget(s => !s)}
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            whileTap={{ scale: 0.9 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </motion.button>
          {/* Add food button */}
          <motion.button
            onClick={() => setShowAddFood(s => !s)}
            className="neu-cta w-10 h-10 rounded-full flex items-center justify-center"
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

      <h1 className="text-3xl font-extrabold tracking-tight mb-6" style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}>
        Nutrisi
      </h1>

      {/* Adjust Target Modal */}
      <AnimatePresence>
        {showEditTarget && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.smooth}
          >
            <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Ubah Target Nutrisi Harian</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase font-bold text-neutral-400">Kalori (kkal)</span>
                <input
                  type="number"
                  className="px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={targetKcal}
                  onChange={e => setTargetKcal(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase font-bold text-neutral-400">Protein (g)</span>
                <input
                  type="number"
                  className="px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={targetProt}
                  onChange={e => setTargetProt(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase font-bold text-neutral-400">Karbohidrat (g)</span>
                <input
                  type="number"
                  className="px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={targetCarb}
                  onChange={e => setTargetCarb(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase font-bold text-neutral-400">Lemak (g)</span>
                <input
                  type="number"
                  className="px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={targetFat}
                  onChange={e => setTargetFat(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1 col-span-2">
                <span className="text-[10px] uppercase font-bold text-neutral-400">Serat (g)</span>
                <input
                  type="number"
                  className="px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={targetFib}
                  onChange={e => setTargetFib(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <motion.button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'var(--accent)', opacity: savingTarget ? 0.6 : 1 }}
                onClick={handleSaveTarget}
                disabled={savingTarget}
                whileTap={{ scale: 0.97 }}
              >
                Simpan Target
              </motion.button>
              <button
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                onClick={() => setShowEditTarget(false)}
              >
                Batal
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Food Log Form */}
      <AnimatePresence>
        {showAddFood && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.smooth}
          >
            <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Log Makanan Baru</p>
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              placeholder="Nama makanan... misal Nasi Putih"
              value={foodName}
              onChange={e => setFoodName(e.target.value)}
              autoFocus
            />
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              placeholder="Porsi... misal 1 piring atau 150g"
              value={portion}
              onChange={e => setPortion(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                className="px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Kalori (kkal)"
                value={calories}
                onChange={e => setCalories(e.target.value)}
              />
              <input
                type="number"
                step="0.1"
                className="px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Protein (g)"
                value={protein}
                onChange={e => setProtein(e.target.value)}
              />
              <input
                type="number"
                step="0.1"
                className="px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Karbo (g)"
                value={carbs}
                onChange={e => setCarbs(e.target.value)}
              />
              <input
                type="number"
                step="0.1"
                className="px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Lemak (g)"
                value={fat}
                onChange={e => setFat(e.target.value)}
              />
              <input
                type="number"
                step="0.1"
                className="px-3 py-2.5 rounded-xl text-sm outline-none col-span-2"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Serat (g)"
                value={fiber}
                onChange={e => setFiber(e.target.value)}
              />
            </div>
            <select
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              value={foodLabel}
              onChange={e => setFoodLabel(e.target.value)}
            >
              <option value="Sehat">Sehat</option>
              <option value="Moderat">Moderat</option>
              <option value="Indulge">Indulge</option>
            </select>
            <div className="flex gap-2 mt-1">
              <motion.button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'var(--accent)', opacity: savingFood ? 0.6 : 1 }}
                onClick={handleAddFood}
                disabled={savingFood}
                whileTap={{ scale: 0.97 }}
              >
                {savingFood ? 'Menyimpan...' : 'Simpan Makanan'}
              </motion.button>
              <button
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                onClick={() => setShowAddFood(false)}
              >
                Batal
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Calorie Ring Card */}
          <motion.div
            className="rounded-[22px] p-5 flex items-center gap-6"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.gentle}
          >
            <svg viewBox="0 0 120 120" style={{ width: '108px', height: '108px' }} className="flex-shrink-0 -rotate-90">
              <circle cx="60" cy="60" r={circleRadius} fill="none" stroke="var(--track)" strokeWidth="12" />
              <motion.circle
                cx="60"
                cy="60"
                r={circleRadius}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset }}
                transition={{ type: 'spring', stiffness: 80, damping: 15, delay: 0.2 }}
              />
            </svg>
            <div className="flex-1">
              <p className="text-xs" style={{ color: 'var(--text2)' }}>Kalori Hari Ini</p>
              <h2 className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text)' }}>
                {currentKcal}
              </h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>
                / {targetKcalVal} kkal · sisa {kcalRemaining}
              </p>
            </div>
          </motion.div>

          {/* Macro Progress Bars Card */}
          <div className="rounded-[20px] p-5 flex flex-col gap-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
            <p className="text-[11px] font-bold tracking-wider text-neutral-400 uppercase">MAKRONUTRISI</p>
            <div className="flex flex-col gap-3.5">
              {macros.map(m => {
                const pct = m.target > 0 ? (m.summary / m.target) * 100 : 0;
                return (
                  <div key={m.name} className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-xs font-semibold">
                      <span style={{ color: 'var(--text)' }}>{m.name}</span>
                      <span style={{ color: 'var(--text2)' }}>{Math.round(m.summary)} / {m.target} {m.unit}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                      <motion.div
                        className="h-full rounded-full"
                        style={{ transformOrigin: 'left', background: m.color, width: `${Math.min(100, pct)}%` }}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={springs.smooth}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {gapString && (
              <p className="text-xs font-bold mt-2 text-orange-400">{gapString}</p>
            )}

            {/* Macro Energy Ratios */}
            {(() => {
              const pKcal = (data?.summary.protein ?? 0) * 4;
              const cKcal = (data?.summary.carbs ?? 0) * 4;
              const fKcal = (data?.summary.fat ?? 0) * 9;
              const totalKcal = pKcal + cKcal + fKcal;
              
              if (totalKcal === 0) return null;

              const pPct = (pKcal / totalKcal) * 100;
              const cPct = (cKcal / totalKcal) * 100;
              const fPct = (fKcal / totalKcal) * 100;

              return (
                <div className="mt-3 pt-3 flex flex-col gap-2" style={{ borderTop: '1px solid var(--sep)' }}>
                  <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Distribusi Energi Makro</p>
                  <div className="h-3.5 rounded-lg overflow-hidden flex">
                    <div style={{ background: '#FF375F', width: `${pPct}%` }} />
                    <div style={{ background: 'var(--warn)', width: `${cPct}%` }} />
                    <div style={{ background: '#5AC8FA', width: `${fPct}%` }} />
                  </div>
                  <div className="flex justify-between text-[11px] font-semibold mt-1" style={{ color: 'var(--text2)' }}>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: '#FF375F' }} />
                      Pro ({Math.round(pPct)}%)
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: 'var(--warn)' }} />
                      Carb ({Math.round(cPct)}%)
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: '#5AC8FA' }} />
                      Lemak ({Math.round(fPct)}%)
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Food Log List */}
          <div>
            <p className="text-[11px] font-bold tracking-wider text-neutral-400 uppercase mb-2">MAKANAN HARI INI</p>
            {data?.foodLogs.length === 0 ? (
              <div className="py-8 text-center text-sm" style={{ color: 'var(--text3)' }}>
                Belum ada makanan yang dicatat hari ini
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {data?.foodLogs.map(food => {
                  const styleColors = getLabelColors(food.label);
                  return (
                    <motion.div
                      key={food.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="rounded-[14px] px-4 py-3 flex items-center justify-between"
                      style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                          {food.name}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>
                          {food.portion} · {food.protein}g protein
                        </p>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                          style={{ background: styleColors.bg, color: styleColors.text }}
                        >
                          {food.label}
                        </span>
                        <span className="text-sm font-bold text-right min-w-[54px]" style={{ color: 'var(--text2)' }}>
                          {food.calories} kkal
                        </span>
                        <motion.button
                          className="w-6 h-6 flex items-center justify-center opacity-40 hover:opacity-100"
                          onClick={() => handleDeleteFood(food.id)}
                          whileTap={{ scale: 0.8 }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </motion.button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
