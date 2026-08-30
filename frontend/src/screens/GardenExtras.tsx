/**
 * Tab tambahan untuk layar Kebun: Rencana dan Catatan.
 *
 * Terpisah dari Garden.tsx yang sudah panjang. Keduanya dipakai sebagai tab
 * di layar yang sama, jadi bagi pengguna tetap satu Kebun.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';
import { GardenLocationPicker } from '@/components/GardenLocationPicker';
import { GrowPlannerSections, GrowRecordSections } from './GardenGrow';
import { GrowPlannerSections2, GrowRecordSections2 } from './GardenGrow2';
import { GrowPlannerSections3, GrowRecordSections3 } from './GardenGrow3';

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

export interface PlantingOption {
  id: string;
  label: string;
  plantId: string | null;
}

function Card({
  title,
  accent,
  children,
  delay = 0,
}: {
  title: string;
  accent?: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      className="rounded-[18px] p-4 mb-3 flex flex-col gap-2.5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.gentle, delay }}
    >
      <div className="text-sm font-bold" style={{ color: accent ?? 'var(--text)' }}>
        {title}
      </div>
      {children}
    </motion.div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl p-3 text-xs border-l-[3px]"
      style={{ background: 'rgba(255, 159, 10, 0.1)', borderColor: '#ff9f0a', color: 'var(--text2)' }}
    >
      {message}
    </div>
  );
}

const describeError = (err: unknown, fallback: string) =>
  err instanceof ApiError ? (err.body.message ?? err.body.error ?? fallback) : 'Terjadi kesalahan jaringan.';

// ─────────────────────────── RENCANA ───────────────────────────

interface CalendarResponse {
  month: number;
  season: string;
  windows: Array<{
    plantId: string;
    name: string;
    emoji: string;
    season: string;
    fit: 'ideal' | 'bisa';
    daysToHarvest: [number, number];
    difficulty: string;
  }>;
}

interface WeatherResponse {
  configured: boolean;
  available?: boolean;
  message?: string;
  label?: string | null;
  rain?: { yesterday: number; today: number; tomorrow: number };
  waterBalance?: { et0Today: number; rainToday: number; recommendedMm: number } | null;
  skipWatering?: boolean;
  reason?: string;
  note?: string | null;
}

interface SuccessionResponse {
  due: Array<{
    plantingId: string;
    label: string;
    emoji: string;
    harvestDate: string;
    sowDate: string;
    daysUntilSow: number;
  }>;
}

interface ConflictResponse {
  conflicts: Array<{ plantName: string; withPlantName: string }>;
}

interface PestRiskResponse {
  condition: 'lembap' | 'kering' | null;
  reason: string;
  warnings: Array<{ plantingId: string; label: string; matchedPests: string[] }>;
}

interface LayoutPair {
  plantId: string;
  name: string;
  withPlantId: string;
  withName: string;
}

interface LayoutSuggestion {
  totalAreaNeededM2: number;
  fitsInBed: boolean | null;
  conflicts: LayoutPair[];
  goodPairs: LayoutPair[];
  isolate: string[];
}

interface SpaceResponse {
  name: string;
  spacingCm: number;
  potLiter: number;
  bed: { count: number; layout: { rows: number; cols: number } | null } | null;
  pot: { message: string } | null;
}

export function GardenPlanner({ plantings }: { plantings: PlantingOption[] }) {
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [succession, setSuccession] = useState<SuccessionResponse | null>(null);
  const [scheduled, setScheduled] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<ConflictResponse | null>(null);
  const [pestRisk, setPestRisk] = useState<PestRiskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Perencana ruang
  const [spacePlant, setSpacePlant] = useState('');
  const [lengthM, setLengthM] = useState('2');
  const [widthM, setWidthM] = useState('1');
  const [potLiter, setPotLiter] = useState('10');
  const [space, setSpace] = useState<SpaceResponse | null>(null);

  // Susun-tanam: cek kecocokan beberapa tanaman sekaligus untuk satu bedeng.
  const [layoutSelected, setLayoutSelected] = useState<string[]>([]);
  const [layoutResult, setLayoutResult] = useState<LayoutSuggestion | null>(null);
  const uniquePlantOptions = [
    ...new Map(plantings.filter((p) => p.plantId).map((p) => [p.plantId!, p.label])).entries(),
  ].map(([plantId, label]) => ({ plantId, label }));

  // Lokasi kebun — picker disembunyikan begitu lokasi sudah diatur, tapi
  // selalu bisa dibuka lagi lewat tombol "Ubah lokasi". Sebelumnya begitu
  // cuaca berhasil terbaca, tidak ada jalan untuk memilih lokasi lain lagi.
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Tiap bagian berdiri sendiri; kegagalan salah satunya tidak boleh
        // mengosongkan seluruh tab.
        const [cal, wx, suc, con, risk] = await Promise.all([
          apiFetch<CalendarResponse>('/garden/calendar'),
          apiFetch<WeatherResponse>('/garden/weather').catch(() => null),
          apiFetch<SuccessionResponse>('/garden/succession').catch(() => ({ due: [] })),
          apiFetch<ConflictResponse>('/garden/conflicts').catch(() => ({ conflicts: [] })),
          apiFetch<PestRiskResponse>('/garden/pest-risk').catch(() => ({ condition: null, reason: '', warnings: [] })),
        ]);
        if (cancelled) return;
        setCalendar(cal);
        setWeather(wx);
        setSuccession(suc);
        setConflicts(con);
        setPestRisk(risk);
      } catch (err) {
        if (!cancelled) setError(describeError(err, 'Gagal memuat rencana.'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const reloadWeather = async () => {
    try {
      setWeather(await apiFetch<WeatherResponse>('/garden/weather'));
    } catch (err) {
      setError(describeError(err, 'Gagal memuat cuaca.'));
    }
  };

  const handleLocationSaved = () => {
    setShowLocationPicker(false);
    setError(null);
    reloadWeather();
  };

  const scheduleSuccession = async (plantingId: string, label: string, sowDate: string) => {
    try {
      await apiFetch('/garden/succession/schedule', { method: 'POST', body: JSON.stringify({ label, sowDate }) });
      setScheduled((prev) => new Set(prev).add(plantingId));
    } catch (err) {
      setError(describeError(err, 'Gagal menjadwalkan ke kalender.'));
    }
  };

  const checkSpace = async () => {
    if (!spacePlant) return;
    try {
      setSpace(
        await apiFetch<SpaceResponse>(
          `/garden/space?plantId=${encodeURIComponent(spacePlant)}&lengthM=${lengthM}&widthM=${widthM}&potLiter=${potLiter}`
        )
      );
    } catch (err) {
      setError(describeError(err, 'Gagal menghitung ruang.'));
    }
  };

  const toggleLayoutPlant = (plantId: string) => {
    setLayoutSelected((prev) =>
      prev.includes(plantId) ? prev.filter((id) => id !== plantId) : [...prev, plantId]
    );
    setLayoutResult(null);
  };

  const checkLayout = async () => {
    if (layoutSelected.length < 2) return;
    try {
      setLayoutResult(
        await apiFetch<LayoutSuggestion>('/garden/layout', {
          method: 'POST',
          body: JSON.stringify({ candidates: layoutSelected.map((plantId) => ({ plantId, quantity: 1 })) }),
        })
      );
    } catch (err) {
      setError(describeError(err, 'Gagal menghitung susunan tanam.'));
    }
  };

  return (
    <div className="flex flex-col">
      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {/* Cuaca paling atas: ia mengubah apa yang harus dikerjakan hari ini. */}
      <Card title="☔ Cuaca & siram">
        {!weather || weather.configured === false ? (
          <>
            <div className="text-xs" style={{ color: 'var(--text2)' }}>
              {weather?.message ?? 'Atur lokasi kebun supaya pengingat siram bisa menyesuaikan cuaca.'}
            </div>
            <GardenLocationPicker onSaved={handleLocationSaved} onError={setError} />
          </>
        ) : (
          <>
            {weather.available === false ? (
              <div className="text-xs" style={{ color: 'var(--text2)' }}>
                {weather.message}
              </div>
            ) : (
              <>
                <div className="flex justify-between text-xs" style={{ color: 'var(--text2)' }}>
                  <span>Kemarin {Math.round(weather.rain!.yesterday)} mm</span>
                  <span>Hari ini {Math.round(weather.rain!.today)} mm</span>
                  <span>Besok {Math.round(weather.rain!.tomorrow)} mm</span>
                </div>
                <div
                  className="text-sm font-semibold"
                  style={{ color: weather.skipWatering ? '#34c759' : 'var(--text)' }}
                >
                  {weather.skipWatering ? '✓ Tidak perlu menyiram hari ini' : '💧 Siram seperti biasa'}
                </div>
                {(weather.reason || weather.note) && (
                  <div className="text-xs" style={{ color: 'var(--text2)' }}>
                    {weather.reason || weather.note}
                  </div>
                )}
                {weather.waterBalance && weather.waterBalance.recommendedMm > 0 && (
                  <div className="text-xs" style={{ color: 'var(--text2)' }}>
                    💦 Perkiraan kebutuhan air hari ini ~{weather.waterBalance.recommendedMm} mm
                    (evapotranspirasi {weather.waterBalance.et0Today} mm − hujan {weather.waterBalance.rainToday} mm)
                  </div>
                )}
              </>
            )}

            {/* Bug yang diperbaiki: sebelumnya begitu lokasi tersimpan, tidak
                ada jalan untuk memilihnya lagi. Tombol ini selalu ada begitu
                lokasi sudah diatur, apa pun status cuacanya. */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              {weather.label ? (
                <span className="text-xs" style={{ color: 'var(--text3)' }}>
                  📍 {weather.label}
                </span>
              ) : (
                <span />
              )}
              <button
                className="text-[11px] font-semibold shrink-0"
                style={{ color: 'var(--accent)' }}
                onClick={() => setShowLocationPicker((v) => !v)}
              >
                {showLocationPicker ? 'Batal' : 'Ubah lokasi'}
              </button>
            </div>

            <AnimatePresence>
              {showLocationPicker && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={collapse}
                >
                  <GardenLocationPicker onSaved={handleLocationSaved} onError={setError} />
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </Card>

      {pestRisk && pestRisk.condition && pestRisk.warnings.length > 0 && (
        <Card title={pestRisk.condition === 'lembap' ? '🍄 Waspada hama musim lembap' : '🕷️ Waspada hama musim kering'} accent="#ff9f0a" delay={0.045}>
          <div className="text-xs" style={{ color: 'var(--text2)' }}>{pestRisk.reason}</div>
          {pestRisk.warnings.map((w) => (
            <div key={w.plantingId} className="text-sm" style={{ color: 'var(--text)' }}>
              {w.label} — cek {w.matchedPests.join(', ')}
            </div>
          ))}
        </Card>
      )}

      {succession && succession.due.length > 0 && (
        <Card title="🌱 Waktunya semai batch berikutnya" accent="#ff9f0a" delay={0.04}>
          {succession.due.map((item) => (
            <div key={item.plantingId} className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  {item.emoji} {item.label}
                </div>
                <div className="text-xs" style={{ color: 'var(--text2)' }}>
                  Panen sekitar {item.harvestDate} ·{' '}
                  {item.daysUntilSow < 0
                    ? `semai sudah lewat ${Math.abs(item.daysUntilSow)} hari`
                    : item.daysUntilSow === 0
                      ? 'semai hari ini'
                      : `semai ${item.daysUntilSow} hari lagi`}
                </div>
              </div>
              {scheduled.has(item.plantingId) ? (
                <span className="text-[10px] font-semibold shrink-0" style={{ color: '#34c759' }}>✓ di kalender</span>
              ) : (
                <button
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold shrink-0"
                  style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                  onClick={() => scheduleSuccession(item.plantingId, item.label, item.sowDate)}
                >
                  + Jadwal
                </button>
              )}
            </div>
          ))}
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            Supaya panen bersambung, bukan kosong berminggu-minggu.
          </div>
        </Card>
      )}

      {conflicts && conflicts.conflicts.length > 0 && (
        <Card title="⚠️ Tanaman yang sebaiknya dijauhkan" accent="#ff9f0a" delay={0.08}>
          {conflicts.conflicts.map((conflict, i) => (
            <div key={i} className="text-sm" style={{ color: 'var(--text)' }}>
              {conflict.plantName} — {conflict.withPlantName}
            </div>
          ))}
        </Card>
      )}

      {calendar && (
        <Card title={`📅 Bagus ditanam bulan ini (${calendar.season})`} delay={0.12}>
          {calendar.windows.slice(0, 8).map((window) => (
            <div key={window.plantId} className="flex justify-between items-center text-sm">
              <span style={{ color: 'var(--text)' }}>
                {window.emoji} {window.name}
                {window.fit === 'bisa' && (
                  <span className="text-xs" style={{ color: 'var(--text3)' }}>
                    {' '}· bisa kapan saja
                  </span>
                )}
              </span>
              <span className="text-xs shrink-0" style={{ color: 'var(--text3)' }}>
                {window.daysToHarvest[0]}–{window.daysToHarvest[1]} hari
              </span>
            </div>
          ))}
        </Card>
      )}

      <Card title="📐 Muat berapa?" delay={0.16}>
        <select
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
          value={spacePlant}
          onChange={(e) => setSpacePlant(e.target.value)}
        >
          <option value="">Pilih tanaman…</option>
          {plantings
            .filter((p) => p.plantId)
            .map((p) => (
              <option key={p.id} value={p.plantId!}>
                {p.label}
              </option>
            ))}
        </select>
        <div className="grid grid-cols-3 gap-2">
          {[
            ['Panjang (m)', lengthM, setLengthM],
            ['Lebar (m)', widthM, setWidthM],
            ['Pot (liter)', potLiter, setPotLiter],
          ].map(([label, value, setter]) => (
            <div key={label as string} className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold" style={{ color: 'var(--text3)' }}>
                {label as string}
              </span>
              <input
                className="w-full px-2 py-2 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                inputMode="decimal"
                value={value as string}
                onChange={(e) => (setter as (v: string) => void)(e.target.value)}
              />
            </div>
          ))}
        </div>
        <motion.button
          className="py-2.5 rounded-xl text-xs font-semibold text-white"
          style={{ background: spacePlant ? 'var(--accentFill)' : 'var(--track)' }}
          onClick={checkSpace}
          disabled={!spacePlant}
          whileTap={spacePlant ? { scale: 0.97 } : {}}
          transition={springs.snappy}
        >
          Hitung
        </motion.button>

        <AnimatePresence>
          {space && (
            <motion.div
              className="rounded-xl p-3 flex flex-col gap-1"
              style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={collapse}
            >
              {space.bed && (
                <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  Muat {space.bed.count} {space.name}
                  {space.bed.layout && (
                    <span className="text-xs font-normal" style={{ color: 'var(--text3)' }}>
                      {' '}({space.bed.layout.rows} baris × {space.bed.layout.cols})
                    </span>
                  )}
                </div>
              )}
              {space.pot && (
                <div className="text-xs" style={{ color: 'var(--text2)' }}>
                  {space.pot.message}
                </div>
              )}
              <div className="text-xs" style={{ color: 'var(--text3)' }}>
                Jarak tanam {space.spacingCm} cm · minimal {space.potLiter} liter per tanaman
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {uniquePlantOptions.length >= 2 && (
        <Card title="🧩 Cocok ditanam bareng?" delay={0.2}>
          <div className="flex flex-wrap gap-2">
            {uniquePlantOptions.map((opt) => {
              const selected = layoutSelected.includes(opt.plantId);
              return (
                <button
                  key={opt.plantId}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{
                    background: selected ? 'var(--accentFill)' : 'var(--bg)',
                    color: selected ? 'white' : 'var(--text2)',
                    boxShadow: selected ? 'none' : 'var(--neu-raised-sm)',
                  }}
                  onClick={() => toggleLayoutPlant(opt.plantId)}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <motion.button
            className="py-2.5 rounded-xl text-xs font-semibold text-white"
            style={{ background: layoutSelected.length >= 2 ? 'var(--accentFill)' : 'var(--track)' }}
            onClick={checkLayout}
            disabled={layoutSelected.length < 2}
            whileTap={layoutSelected.length >= 2 ? { scale: 0.97 } : {}}
            transition={springs.snappy}
          >
            Cek kecocokan
          </motion.button>

          {layoutResult && (
            <div className="flex flex-col gap-2">
              <div className="text-xs" style={{ color: 'var(--text3)' }}>
                Total butuh ~{layoutResult.totalAreaNeededM2} m²
              </div>
              {layoutResult.conflicts.length === 0 && layoutResult.goodPairs.length === 0 && (
                <div className="text-xs" style={{ color: 'var(--text2)' }}>
                  Tidak ada hubungan pendamping yang tercatat antar pilihan ini — aman ditanam bareng.
                </div>
              )}
              {layoutResult.conflicts.map((pair, i) => (
                <div key={i} className="text-xs" style={{ color: '#ff3b30' }}>
                  ⚠️ {pair.name} sebaiknya dipisah dari {pair.withName}
                </div>
              ))}
              {layoutResult.goodPairs.map((pair, i) => (
                <div key={i} className="text-xs" style={{ color: '#34c759' }}>
                  ✓ {pair.name} cocok berdampingan dengan {pair.withName}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <GrowPlannerSections plantings={plantings} />
      <GrowPlannerSections2 plantings={plantings} />
      <GrowPlannerSections3 />
    </div>
  );
}

// ─────────────────────────── CATATAN ───────────────────────────

interface Economics {
  perPlanting: Array<{
    plantingId: string;
    label: string;
    cost: number;
    harvested: number;
    unit: string;
    value: number | null;
    net: number | null;
    unitMismatch: boolean;
  }>;
  totalCost: number;
  totalValue: number;
  totalNet: number;
  sharedCost: number;
  missingPrices: string[];
}

interface PestData {
  incidents: Array<{
    id: string;
    plantLabel: string;
    pest: string;
    severity: string;
    treatment: string | null;
    spottedDate: string;
    worked: boolean | null;
  }>;
  provenTreatments: Array<{ pest: string; treatment: string; times: number }>;
}

interface YieldPrediction {
  plantingId: string;
  name: string;
  emoji: string;
  predictedAmount: number;
  unit: string;
  confidence: 'rendah' | 'sedang' | 'tinggi';
  sampleSize: number;
}

const CONFIDENCE_LABEL: Record<YieldPrediction['confidence'], string> = {
  rendah: 'keyakinan rendah',
  sedang: 'keyakinan sedang',
  tinggi: 'keyakinan tinggi',
};

interface FailurePattern {
  plantId: string;
  label: string;
  failureCount: number;
  commonLocation: string | null;
  commonMonth: number | null;
  pestShare: number;
  hypotheses: string[];
}

interface RotationWarning {
  plantingId: string;
  label: string;
  location: string;
  familyLabel: string;
  previousLabel: string;
  previousPlantedDate: string;
  message: string;
}

interface BreakEven {
  years: Array<{ year: number; cost: number; value: number; net: number; cumulativeNet: number }>;
  breakEvenYear: number | null;
  cumulativeNet: number;
}

interface Seed {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  expiry_date: string | null;
  daysLeft: number | null;
  status: string;
}

const SEED_STATUS: Record<string, { label: string; color: string }> = {
  kedaluwarsa: { label: 'Kedaluwarsa', color: '#ff3b30' },
  segera: { label: 'Segera pakai', color: '#ff9f0a' },
  aman: { label: 'Aman', color: '#34c759' },
  'tanpa-tanggal': { label: 'Tanpa tanggal', color: 'var(--text3)' },
};

export function GardenRecords({ plantings }: { plantings: PlantingOption[] }) {
  const [economics, setEconomics] = useState<Economics | null>(null);
  const [pests, setPests] = useState<PestData | null>(null);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [predictions, setPredictions] = useState<YieldPrediction[]>([]);
  const [failurePatterns, setFailurePatterns] = useState<FailurePattern[]>([]);
  const [rotationWarnings, setRotationWarnings] = useState<RotationWarning[]>([]);
  const [breakEven, setBreakEven] = useState<BreakEven | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [costPlanting, setCostPlanting] = useState('');
  const [costKind, setCostKind] = useState('benih');
  const [costAmount, setCostAmount] = useState('');

  const [pestPlanting, setPestPlanting] = useState('');
  const [pestName, setPestName] = useState('');
  const [pestTreatment, setPestTreatment] = useState('');

  const [seedName, setSeedName] = useState('');
  const [seedExpiry, setSeedExpiry] = useState('');

  const reload = async () => {
    try {
      const [eco, pest, seed, yieldRes, failureRes, rotationRes, breakEvenRes] = await Promise.all([
        apiFetch<Economics>('/garden/economics'),
        apiFetch<PestData>('/garden/pests'),
        apiFetch<{ seeds: Seed[] }>('/garden/seeds'),
        apiFetch<{ predictions: YieldPrediction[] }>('/garden/yield-prediction'),
        apiFetch<{ patterns: FailurePattern[] }>('/garden/failure-patterns'),
        apiFetch<{ warnings: RotationWarning[] }>('/garden/rotation-check'),
        apiFetch<BreakEven>('/garden/economics/yearly'),
      ]);
      setEconomics(eco);
      setPests(pest);
      setSeeds(seed.seeds);
      setPredictions(yieldRes.predictions);
      setFailurePatterns(failureRes.patterns);
      setRotationWarnings(rotationRes.warnings);
      setBreakEven(breakEvenRes);
    } catch (err) {
      setError(describeError(err, 'Gagal memuat catatan.'));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const addCost = async () => {
    const amount = Number(costAmount.replace(/\D/g, ''));
    if (!amount) return;
    try {
      await apiFetch('/garden/costs', {
        method: 'POST',
        body: JSON.stringify({ plantingId: costPlanting || null, kind: costKind, amount }),
      });
      setCostAmount('');
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan biaya.'));
    }
  };

  const addPest = async () => {
    if (!pestPlanting || !pestName.trim()) return;
    try {
      await apiFetch('/garden/pests', {
        method: 'POST',
        body: JSON.stringify({
          plantingId: pestPlanting,
          pest: pestName.trim(),
          treatment: pestTreatment.trim() || undefined,
        }),
      });
      setPestName('');
      setPestTreatment('');
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan catatan hama.'));
    }
  };

  const markPest = async (id: string, worked: boolean) => {
    try {
      await apiFetch(`/garden/pests/${id}`, { method: 'PATCH', body: JSON.stringify({ worked }) });
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal memperbarui.'));
    }
  };

  const addSeed = async () => {
    if (!seedName.trim()) return;
    try {
      await apiFetch('/garden/seeds', {
        method: 'POST',
        body: JSON.stringify({ name: seedName.trim(), expiryDate: seedExpiry || undefined }),
      });
      setSeedName('');
      setSeedExpiry('');
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan benih.'));
    }
  };

  const inputStyle = {
    background: 'var(--bg)',
    color: 'var(--text)',
    boxShadow: 'var(--neu-inset)',
  };

  return (
    <div className="flex flex-col">
      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {economics && (
        <Card
          title="💰 Hemat atau tidak?"
          accent={economics.totalNet >= 0 ? undefined : '#ff3b30'}
        >
          <div
            className="text-2xl font-extrabold"
            style={{ color: economics.totalNet >= 0 ? '#34c759' : '#ff3b30' }}
          >
            {economics.totalNet >= 0 ? '+' : '−'}
            {rupiah(Math.abs(economics.totalNet))}
          </div>
          <div className="text-xs" style={{ color: 'var(--text2)' }}>
            Nilai panen {rupiah(economics.totalValue)} · biaya {rupiah(economics.totalCost)}
          </div>

          {economics.perPlanting
            .filter((p) => p.cost > 0 || p.harvested > 0)
            .map((p) => (
              <div key={p.plantingId} className="flex justify-between text-sm">
                <span style={{ color: 'var(--text)' }}>{p.label}</span>
                <span className="text-xs" style={{ color: 'var(--text2)' }}>
                  {p.harvested > 0 && `${p.harvested} ${p.unit} · `}
                  {p.net === null ? 'belum bisa dinilai' : rupiah(p.net)}
                </span>
              </div>
            ))}

          {/* Harga tidak pernah ditebak; kalau belum ada, itu dikatakan. */}
          {economics.missingPrices.length > 0 && (
            <div className="text-xs" style={{ color: 'var(--text3)' }}>
              Belum ada harga pasar untuk: {economics.missingPrices.join(', ')}. Panennya tidak
              dihitung supaya angkanya tidak menyesatkan.
            </div>
          )}

          {breakEven && breakEven.years.length > 0 && (
            <div className="text-xs pt-1" style={{ color: 'var(--text3)', borderTop: '1px solid var(--sep)' }}>
              {/* Cek tanda cumulativeNet langsung, bukan cuma breakEvenYear —
                  sempat balik modal lalu rugi lagi tahun berikutnya tetap
                  harus tampil sebagai belum balik modal saat ini. */}
              {breakEven.cumulativeNet >= 0
                ? `📈 Sudah balik modal${breakEven.breakEvenYear ? ` sejak ${breakEven.breakEvenYear}` : ''} — kumulatif +${rupiah(breakEven.cumulativeNet)}`
                : `📉 Belum balik modal — kumulatif masih −${rupiah(Math.abs(breakEven.cumulativeNet))}`}
            </div>
          )}
        </Card>
      )}

      {predictions.length > 0 && (
        <Card title="🔮 Perkiraan panen berikutnya" delay={0.02}>
          {predictions.map((p) => (
            <div key={p.plantingId} className="flex justify-between items-center text-sm">
              <span style={{ color: 'var(--text)' }}>{p.emoji} {p.name}</span>
              <span className="text-xs text-right" style={{ color: 'var(--text2)' }}>
                ~{p.predictedAmount} {p.unit}
                <span className="block" style={{ color: 'var(--text3)' }}>
                  {CONFIDENCE_LABEL[p.confidence]} · {p.sampleSize} panen tercatat
                </span>
              </span>
            </div>
          ))}
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            Dari rata-rata panen tanaman sejenis di kebunmu sendiri, bukan tabel umum.
          </div>
        </Card>
      )}

      {failurePatterns.length > 0 && (
        <Card title="🔍 Pola gagal panen" accent="#ff3b30" delay={0.03}>
          {failurePatterns.map((f) => (
            <div key={f.plantId} className="flex flex-col gap-0.5">
              <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {f.label} — gagal {f.failureCount}×
              </div>
              {f.hypotheses.map((h, i) => (
                <div key={i} className="text-xs" style={{ color: 'var(--text2)' }}>
                  {h}
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}

      {rotationWarnings.length > 0 && (
        <Card title="🔁 Rotasi tanam" accent="#ff9f0a" delay={0.035}>
          {rotationWarnings.map((w) => (
            <div key={w.plantingId} className="text-xs" style={{ color: 'var(--text2)' }}>
              {w.message}
            </div>
          ))}
        </Card>
      )}

      <Card title="🧾 Catat biaya" delay={0.04}>
        <div className="grid grid-cols-2 gap-2">
          <select
            className="px-3 py-2.5 rounded-xl text-sm outline-none"
            style={inputStyle}
            value={costKind}
            onChange={(e) => setCostKind(e.target.value)}
          >
            {['benih', 'pupuk', 'media', 'pot', 'pestisida', 'lainnya'].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            className="px-3 py-2.5 rounded-xl text-sm outline-none"
            style={inputStyle}
            placeholder="Rp"
            inputMode="numeric"
            value={costAmount}
            onChange={(e) => setCostAmount(e.target.value)}
          />
        </div>
        <select
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={inputStyle}
          value={costPlanting}
          onChange={(e) => setCostPlanting(e.target.value)}
        >
          <option value="">Biaya umum (semua tanaman)</option>
          {plantings.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <motion.button
          className="py-2.5 rounded-xl text-xs font-semibold text-white"
          style={{ background: 'var(--accentFill)' }}
          onClick={addCost}
          whileTap={{ scale: 0.97 }}
          transition={springs.snappy}
        >
          Simpan biaya
        </motion.button>
      </Card>

      <Card title="🐛 Hama" delay={0.08}>
        {pests && pests.provenTreatments.length > 0 && (
          <div className="rounded-xl p-3 flex flex-col gap-1" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
            <div className="text-xs font-bold" style={{ color: '#34c759' }}>
              Terbukti berhasil
            </div>
            {pests.provenTreatments.map((t, i) => (
              <div key={i} className="text-xs" style={{ color: 'var(--text2)' }}>
                {t.pest}: {t.treatment} ({t.times}×)
              </div>
            ))}
          </div>
        )}

        <select
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={inputStyle}
          value={pestPlanting}
          onChange={(e) => setPestPlanting(e.target.value)}
        >
          <option value="">Tanaman yang kena…</option>
          {plantings.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={inputStyle}
          placeholder="Hama apa? Misalnya ulat grayak"
          value={pestName}
          onChange={(e) => setPestName(e.target.value)}
        />
        <input
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={inputStyle}
          placeholder="Tindakan yang dicoba (opsional)"
          value={pestTreatment}
          onChange={(e) => setPestTreatment(e.target.value)}
        />
        <motion.button
          className="py-2.5 rounded-xl text-xs font-semibold text-white"
          style={{ background: pestPlanting && pestName.trim() ? 'var(--accentFill)' : 'var(--track)' }}
          onClick={addPest}
          disabled={!pestPlanting || !pestName.trim()}
          whileTap={{ scale: 0.97 }}
          transition={springs.snappy}
        >
          Catat hama
        </motion.button>

        {pests?.incidents.slice(0, 5).map((incident) => (
          <div key={incident.id} className="flex justify-between items-center gap-2 text-sm">
            <span style={{ color: 'var(--text)' }}>
              {incident.pest}
              <span className="text-xs" style={{ color: 'var(--text3)' }}>
                {' '}· {incident.plantLabel}
              </span>
            </span>
            {incident.worked === null ? (
              <div className="flex gap-1.5 shrink-0">
                <button
                  className="px-2 py-1 rounded-lg text-[10px] font-semibold"
                  style={{ background: 'rgba(52,199,89,0.15)', color: '#34c759' }}
                  onClick={() => markPest(incident.id, true)}
                >
                  Berhasil
                </button>
                <button
                  className="px-2 py-1 rounded-lg text-[10px] font-semibold"
                  style={{ background: 'rgba(255,59,48,0.15)', color: '#ff3b30' }}
                  onClick={() => markPest(incident.id, false)}
                >
                  Gagal
                </button>
              </div>
            ) : (
              <span className="text-xs shrink-0" style={{ color: incident.worked ? '#34c759' : '#ff3b30' }}>
                {incident.worked ? '✓ berhasil' : '✕ gagal'}
              </span>
            )}
          </div>
        ))}
      </Card>

      <Card title="🌰 Stok benih" delay={0.12}>
        <div className="grid grid-cols-2 gap-2">
          <input
            className="px-3 py-2.5 rounded-xl text-sm outline-none"
            style={inputStyle}
            placeholder="Nama benih"
            value={seedName}
            onChange={(e) => setSeedName(e.target.value)}
          />
          <input
            className="px-3 py-2.5 rounded-xl text-sm outline-none"
            style={inputStyle}
            type="date"
            value={seedExpiry}
            onChange={(e) => setSeedExpiry(e.target.value)}
          />
        </div>
        <motion.button
          className="py-2.5 rounded-xl text-xs font-semibold text-white"
          style={{ background: seedName.trim() ? 'var(--accentFill)' : 'var(--track)' }}
          onClick={addSeed}
          disabled={!seedName.trim()}
          whileTap={{ scale: 0.97 }}
          transition={springs.snappy}
        >
          Tambah benih
        </motion.button>

        {seeds.map((seed) => {
          const status = SEED_STATUS[seed.status] ?? SEED_STATUS['tanpa-tanggal'];
          return (
            <div key={seed.id} className="flex justify-between text-sm">
              <span style={{ color: 'var(--text)' }}>
                {seed.name}
                <span className="text-xs" style={{ color: 'var(--text3)' }}>
                  {' '}· {seed.quantity} {seed.unit}
                </span>
              </span>
              <span className="text-xs shrink-0" style={{ color: status.color }}>
                {status.label}
              </span>
            </div>
          );
        })}

        {seeds.some((s) => s.status === 'kedaluwarsa') && (
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            Benih kedaluwarsa biasanya masih tumbuh, hanya daya tumbuhnya turun — semai lebih
            banyak dari biasanya.
          </div>
        )}
      </Card>

      <GrowRecordSections />
      <GrowRecordSections2 />
      <GrowRecordSections3 plantings={plantings} />
    </div>
  );
}
