/**
 * Fitur kebun lanjutan: pembibitan, perkiraan panen adaptif, kalkulator
 * belanja, denah bedengan, efektivitas penanganan hama, dari-kebun-ke-piring,
 * dan laporan tahunan.
 *
 * File terpisah dari GardenExtras.tsx yang sudah panjang. Dua komponen yang
 * diekspor dipasang ke dalam tab yang sudah ada — Rencana dan Catatan — supaya
 * pengguna tidak perlu belajar navigasi baru.
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';
import type { PlantingOption } from './GardenExtras';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div
      className="rounded-[18px] p-4 mb-3 flex flex-col gap-2.5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.gentle}
    >
      <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>{title}</div>
      {children}
    </motion.div>
  );
}

const describeError = (err: unknown, fallback: string) =>
  err instanceof ApiError ? (err.body.message ?? err.body.error ?? fallback) : 'Terjadi kesalahan jaringan.';

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

const inputStyle = {
  background: 'var(--bg)',
  color: 'var(--text)',
  boxShadow: 'var(--neu-inset)',
} as const;

// ─────────────────────────── TIPE RESPONS ───────────────────────────

interface Forecast {
  plantingId: string;
  name: string;
  emoji: string;
  baselineDate: string;
  estimatedDate: string;
  shiftDays: number;
  confidence: string;
  reason: string;
  overdueDays: number;
}

interface SupplyNeed {
  id: string;
  label: string;
  amount: number;
  unit: string;
  basis: string;
}

interface BedSlotView {
  plantingId: string;
  name: string;
  posX: number;
  posY: number;
  spacingCm: number;
}

/** Penanda bukan-tanaman: jalan setapak, pot kompos, rak. */
interface MarkerView {
  id: string;
  kind: string;
  label: string;
  posX: number;
  posY: number;
  radiusCm: number;
}

interface BedIssue {
  kind: string;
  plantingIds: string[];
  markerIds: string[];
  message: string;
}

interface BedView {
  id: string;
  name: string;
  widthCm: number;
  lengthCm: number;
  note: string | null;
  slots: BedSlotView[];
  markers: MarkerView[];
  report: { slotCount: number; usedPercent: number; issues: BedIssue[] };
}

const MARKER_ICON: Record<string, string> = {
  jalan: '🚶', kompos: '🪣', rak: '🗄️', lainnya: '📍',
};

const MARKER_KINDS: Array<{ id: string; label: string }> = [
  { id: 'jalan', label: 'Jalan setapak' },
  { id: 'kompos', label: 'Pot kompos' },
  { id: 'rak', label: 'Rak' },
];

/**
 * Satu drag yang sedang berjalan di denah, dalam koordinat sentimeter.
 *
 * `moved` membedakan ketuk dari geser: sentuhan yang tidak pernah melewati
 * ambang gerak dianggap ketuk (angkat/hapus), yang melewatinya dianggap
 * geser (pindah posisi). Tanpa ini, menggeser tanaman sedikit saja akan
 * ikut mengangkatnya dari denah.
 */
interface DragState {
  bedId: string;
  kind: 'slot' | 'marker';
  id: string;
  startClientX: number;
  startClientY: number;
  startPosX: number;
  startPosY: number;
  rectLeft: number;
  rectTop: number;
  rectWidth: number;
  rectHeight: number;
  widthCm: number;
  lengthCm: number;
  posX: number;
  posY: number;
  moved: boolean;
}

const DRAG_THRESHOLD_PX = 6;

interface Sowing {
  id: string;
  name: string;
  emoji: string;
  brand: string | null;
  sownDate: string;
  seedCount: number;
  germinatedCount: number | null;
  transplantedDate: string | null;
}

/** Stok benih di laci, dipakai untuk mengurangi jumlahnya saat menyemai. */
interface SeedStock {
  id: string;
  name: string;
  quantity: number;
  unit: string;
}

interface SourceScore {
  brand: string;
  batches: number;
  seedsSown: number;
  ratePercent: number;
  reliable: boolean;
}

interface SowingsResponse {
  sowings: Sowing[];
  summary: {
    totalBatches: number;
    pendingCount: number;
    overallRatePercent: number | null;
    readyToTransplant: number;
  };
  sources: SourceScore[];
}

interface TreatmentScore {
  pest: string;
  treatment: string;
  tried: number;
  worked: number;
  successPercent: number;
  avgDaysToResolve: number | null;
}

interface PendingReview {
  id: string | null;
  pest: string;
  treatment: string | null;
  spottedDate: string;
  daysSince: number;
}

interface KitchenReport {
  items: Array<{ name: string; amount: number; unit: string; valueIdr: number | null }>;
  harvestValueIdr: number;
  foodSpendIdr: number;
  selfSufficiencyPercent: number | null;
  unpricedHarvests: string[];
}

interface Calibration {
  plantId: string;
  name: string;
  emoji: string;
  catalogDays: number;
  actualDays: number;
  deltaDays: number;
  cycles: number;
  reliable: boolean;
}

interface GardenStreak {
  current: number;
  longest: number;
  activeToday: boolean;
  totalDays: number;
}

interface UnitCost {
  plantKey: string;
  name: string;
  costPerUnitIdr: number | null;
  marketPriceIdr: number | null;
  savingPerUnitIdr: number | null;
  unit: string;
  verdict: string;
  advice: string;
}

interface SeasonPlanItem {
  plantId: string;
  name: string;
  emoji: string;
  recommendation: 'utamakan' | 'boleh' | 'hindari';
  reasons: string[];
  seedOnHand: boolean;
}

interface RecipeIdea {
  name: string;
  uses: string[];
  steps: string[];
  minutes: number | null;
}

interface AnnualReport {
  year: string;
  plantedCount: number;
  failedCount: number;
  successPercent: number | null;
  pestCount: number;
  harvestValueIdr: number;
  costIdr: number;
  netIdr: number;
  items: Array<{ name: string; amount: number; unit: string; valueIdr: number | null }>;
  unpricedHarvests: string[];
}

// ─────────────────── BAGIAN UNTUK TAB RENCANA ───────────────────

export function GrowPlannerSections({ plantings }: { plantings: PlantingOption[] }) {
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [needs, setNeeds] = useState<SupplyNeed[]>([]);
  const [beds, setBeds] = useState<BedView[]>([]);
  const [calibrations, setCalibrations] = useState<Calibration[]>([]);
  const [unitCosts, setUnitCosts] = useState<UnitCost[]>([]);
  const [seasonPlan, setSeasonPlan] = useState<SeasonPlanItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Form bedengan baru
  const [bedName, setBedName] = useState('');
  const [bedWidth, setBedWidth] = useState('100');
  const [bedLength, setBedLength] = useState('200');

  // Menaruh tanaman ke denah
  const [placeBed, setPlaceBed] = useState('');
  const [placePlanting, setPlacePlanting] = useState('');

  const loadBeds = async () => {
    try {
      const res = await apiFetch<{ beds: BedView[] }>('/garden/beds');
      setBeds(res.beds);
    } catch (err) {
      setError(describeError(err, 'Gagal memuat denah.'));
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Tiap bagian berdiri sendiri: satu endpoint gagal tidak boleh
      // mengosongkan dua lainnya.
      const [f, s, b, cal, uc, plan] = await Promise.all([
        apiFetch<{ forecasts: Forecast[] }>('/garden/harvest-forecast').catch(() => ({ forecasts: [] })),
        apiFetch<{ needs: SupplyNeed[] }>('/garden/supplies').catch(() => ({ needs: [] })),
        apiFetch<{ beds: BedView[] }>('/garden/beds').catch(() => ({ beds: [] })),
        apiFetch<{ calibrations: Calibration[] }>('/garden/calibration').catch(() => ({ calibrations: [] })),
        apiFetch<{ plants: UnitCost[] }>('/garden/unit-cost').catch(() => ({ plants: [] })),
        apiFetch<{ plan: SeasonPlanItem[] }>('/garden/next-season').catch(() => ({ plan: [] })),
      ]);
      if (cancelled) return;
      setForecasts(f.forecasts);
      setNeeds(s.needs);
      setBeds(b.beds);
      setCalibrations(cal.calibrations);
      setUnitCosts(uc.plants);
      setSeasonPlan(plan.plan);
    })();

    return () => { cancelled = true; };
  }, []);

  const createBed = async () => {
    if (!bedName.trim()) return;
    try {
      await apiFetch('/garden/beds', {
        method: 'POST',
        body: JSON.stringify({
          name: bedName.trim(),
          widthCm: Number(bedWidth),
          lengthCm: Number(bedLength),
        }),
      });
      setBedName('');
      await loadBeds();
    } catch (err) {
      setError(describeError(err, 'Gagal membuat bedengan.'));
    }
  };

  const placePlant = async () => {
    if (!placeBed || !placePlanting) return;
    try {
      // Titik kosong dicari backend supaya penempatan pertama tidak menumpuk;
      // pengguna tetap bisa menggeser lewat angka setelah ini.
      const bed = beds.find((b) => b.id === placeBed);
      const suggestion = await apiFetch<{ suggestion: { posX: number; posY: number } | null }>(
        `/garden/beds/${placeBed}/suggest?spacing=30`
      );
      const pos = suggestion.suggestion ?? { posX: Math.round((bed?.widthCm ?? 100) / 2), posY: 20 };

      await apiFetch(`/garden/beds/${placeBed}/slots`, {
        method: 'PUT',
        body: JSON.stringify({ plantingId: placePlanting, posX: pos.posX, posY: pos.posY }),
      });
      setPlacePlanting('');
      await loadBeds();
    } catch (err) {
      setError(describeError(err, 'Gagal menaruh tanaman di denah.'));
    }
  };

  const removeSlot = async (plantingId: string) => {
    try {
      await apiFetch(`/garden/beds/slots/${plantingId}`, { method: 'DELETE' });
      await loadBeds();
    } catch (err) {
      setError(describeError(err, 'Gagal mengangkat tanaman dari denah.'));
    }
  };

  const deleteBed = async (id: string) => {
    if (!confirm('Hapus bedengan ini beserta penempatannya?')) return;
    try {
      await apiFetch(`/garden/beds/${id}`, { method: 'DELETE' });
      await loadBeds();
    } catch (err) {
      setError(describeError(err, 'Gagal menghapus bedengan.'));
    }
  };

  // ─────────────────── Denah bedengan: geser dan penanda ───────────────────
  //
  // Sebelumnya menaruh tanaman hanya lewat dropdown + tombol "Taruh" (backend
  // mencarikan titik kosong), dan satu-satunya interaksi di denah adalah
  // ketuk untuk mengangkat. Sekarang titik itu bisa digeser langsung dengan
  // jari/mouse — draf posisi ditampilkan seketika di layar (state lokal),
  // baru dikirim ke server saat jari diangkat.
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [placingMarker, setPlacingMarker] = useState<string | null>(null);

  const clampPos = (value: number, max: number) => Math.max(0, Math.min(max, Math.round(value)));

  const beginDrag = (
    e: React.PointerEvent,
    bed: BedView,
    kind: 'slot' | 'marker',
    id: string,
    posX: number,
    posY: number
  ) => {
    e.stopPropagation();
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const state: DragState = {
      bedId: bed.id, kind, id,
      startClientX: e.clientX, startClientY: e.clientY,
      startPosX: posX, startPosY: posY,
      rectLeft: rect.left, rectTop: rect.top, rectWidth: rect.width, rectHeight: rect.height,
      widthCm: bed.widthCm, lengthCm: bed.lengthCm,
      posX, posY, moved: false,
    };
    dragRef.current = state;
    setDrag(state);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current) return;

    const dxPx = e.clientX - current.startClientX;
    const dyPx = e.clientY - current.startClientY;
    if (!current.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;

    const dxCm = (dxPx / current.rectWidth) * current.widthCm;
    const dyCm = (dyPx / current.rectHeight) * current.lengthCm;
    const next: DragState = {
      ...current, moved: true,
      posX: clampPos(current.startPosX + dxCm, current.widthCm),
      posY: clampPos(current.startPosY + dyCm, current.lengthCm),
    };
    dragRef.current = next;
    setDrag(next);
  };

  const endDrag = async () => {
    const final = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!final) return;

    if (!final.moved) {
      // Ketuk tanpa gerak: perilaku lama, angkat dari denah.
      if (final.kind === 'slot') await removeSlot(final.id);
      else await removeMarker(final.id);
      return;
    }

    try {
      if (final.kind === 'slot') {
        await apiFetch(`/garden/beds/${final.bedId}/slots`, {
          method: 'PUT',
          body: JSON.stringify({ plantingId: final.id, posX: final.posX, posY: final.posY }),
        });
      } else {
        await apiFetch(`/garden/beds/markers/${final.id}`, {
          method: 'PUT',
          body: JSON.stringify({ posX: final.posX, posY: final.posY }),
        });
      }
      await loadBeds();
    } catch (err) {
      setError(describeError(err, 'Gagal memindahkan posisi di denah.'));
      await loadBeds();
    }
  };

  const removeMarker = async (id: string) => {
    try {
      await apiFetch(`/garden/beds/markers/${id}`, { method: 'DELETE' });
      await loadBeds();
    } catch (err) {
      setError(describeError(err, 'Gagal menghapus penanda.'));
    }
  };

  const addMarker = async (bed: BedView, kind: string) => {
    setPlacingMarker(null);
    try {
      const suggestion = await apiFetch<{ suggestion: { posX: number; posY: number } | null }>(
        `/garden/beds/${bed.id}/suggest?spacing=30`
      );
      const pos = suggestion.suggestion ?? { posX: Math.round(bed.widthCm / 2), posY: Math.round(bed.lengthCm / 2) };
      await apiFetch(`/garden/beds/${bed.id}/markers`, {
        method: 'POST',
        body: JSON.stringify({
          kind, label: MARKER_KINDS.find((m) => m.id === kind)?.label ?? 'Penanda',
          posX: pos.posX, posY: pos.posY,
        }),
      });
      await loadBeds();
    } catch (err) {
      setError(describeError(err, 'Gagal menambah penanda.'));
    }
  };

  return (
    <>
      {error && (
        <div className="rounded-xl p-3 text-xs border-l-[3px] mb-3"
          style={{ background: 'rgba(255, 159, 10, 0.1)', borderColor: '#ff9f0a', color: 'var(--text2)' }}>
          {error}
        </div>
      )}

      {/* Perkiraan panen adaptif */}
      {forecasts.length > 0 && (
        <Card title="🌾 Perkiraan panen">
          <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
            Dikoreksi dari kepatuhan siram dan pupuk, bukan sekadar umur katalog.
          </p>
          {forecasts.map((f) => (
            <div key={f.plantingId} className="rounded-xl p-2.5" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold truncate" style={{ color: 'var(--text)' }}>
                  {f.emoji} {f.name}
                </span>
                <span className="text-[10px] font-semibold flex-shrink-0"
                  style={{ color: f.overdueDays > 0 ? 'var(--warn)' : f.shiftDays > 0 ? 'var(--warn)' : 'var(--pos)' }}>
                  {f.estimatedDate}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed mt-1" style={{ color: 'var(--text2)' }}>{f.reason}</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text3)' }}>
                Keyakinan {f.confidence}
                {f.shiftDays > 0 && ` · mundur ${f.shiftDays} hari dari perkiraan katalog ${f.baselineDate}`}
                {f.overdueDays > 0 && ` · sudah lewat ${f.overdueDays} hari`}
              </p>
            </div>
          ))}
        </Card>
      )}

      {/* Rencana musim depan — hasil gabungan semua analisis di bawah */}
      {seasonPlan.length > 0 && (
        <Card title="📆 Musim depan tanam apa">
          {seasonPlan.slice(0, 6).map((item) => {
            const color = item.recommendation === 'utamakan' ? 'var(--pos)'
              : item.recommendation === 'hindari' ? 'var(--neg)' : 'var(--text2)';
            return (
              <div key={item.plantId} className="rounded-xl p-2.5" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold truncate" style={{ color: 'var(--text)' }}>
                    {item.emoji} {item.name}{item.seedOnHand && ' · benih ada'}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color }}>
                    {item.recommendation}
                  </span>
                </div>
                {item.reasons.map((r, i) => (
                  <p key={i} className="text-[10px] leading-relaxed mt-0.5" style={{ color: 'var(--text3)' }}>· {r}</p>
                ))}
              </div>
            );
          })}
        </Card>
      )}

      {/* HPP: lebih murah menanam sendiri atau membeli? */}
      {unitCosts.length > 0 && (
        <Card title="⚖️ Menanam vs membeli">
          {unitCosts.slice(0, 6).map((u) => {
            const color = u.verdict === 'untung' ? 'var(--pos)'
              : u.verdict === 'rugi' ? 'var(--neg)' : 'var(--text2)';
            return (
              <div key={u.plantKey}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>{u.name}</span>
                  {u.costPerUnitIdr !== null && (
                    <span className="text-[11px] font-bold flex-shrink-0" style={{ color }}>
                      {rupiah(u.costPerUnitIdr)}/{u.unit}
                    </span>
                  )}
                </div>
                <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text3)' }}>{u.advice}</p>
              </div>
            );
          })}
        </Card>
      )}

      {/* Kalibrasi katalog dari panen sendiri */}
      {calibrations.length > 0 && (
        <Card title="📐 Umur panen di kebun ini">
          <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
            Dibandingkan angka katalog, dari penanaman yang benar-benar sampai panen.
          </p>
          {calibrations.map((cal) => (
            <div key={cal.plantId} className="flex items-center justify-between gap-2">
              <span className="text-[11px] truncate" style={{ color: 'var(--text2)' }}>
                {cal.emoji} {cal.name}
                <span style={{ color: 'var(--text3)' }}>
                  {' '}({cal.cycles}×{!cal.reliable && ', data masih tipis'})
                </span>
              </span>
              <span className="text-[11px] font-bold flex-shrink-0"
                style={{ color: cal.deltaDays > 0 ? 'var(--warn)' : 'var(--pos)' }}>
                {cal.actualDays} hari ({cal.deltaDays > 0 ? '+' : ''}{cal.deltaDays})
              </span>
            </div>
          ))}
        </Card>
      )}

      {/* Kalkulator belanja */}
      <Card title="🛒 Perlu dibeli">
        {needs.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text2)' }}>
            Belum ada kebutuhan media atau pupuk yang bisa dihitung dari tanaman aktif.
          </p>
        ) : (
          needs.map((n) => (
            <div key={n.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{n.label}</p>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>{n.basis}</p>
              </div>
              <span className="text-xs font-bold flex-shrink-0" style={{ color: 'var(--accent)' }}>
                {n.amount} {n.unit}
              </span>
            </div>
          ))
        )}
      </Card>

      {/* Denah bedengan */}
      <Card title="🗺️ Denah bedengan">
        <div className="flex gap-2">
          <input
            className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] outline-none"
            style={inputStyle}
            placeholder="Nama bedengan"
            value={bedName}
            onChange={(e) => setBedName(e.target.value)}
          />
          <input
            className="w-14 px-2 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
            value={bedWidth} onChange={(e) => setBedWidth(e.target.value)} inputMode="numeric" aria-label="Lebar cm"
          />
          <input
            className="w-14 px-2 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
            value={bedLength} onChange={(e) => setBedLength(e.target.value)} inputMode="numeric" aria-label="Panjang cm"
          />
          <button
            className="neu-cta px-3 py-2 rounded-lg text-[11px] font-bold text-white flex-shrink-0"
            style={{ background: 'var(--accentFill)' }}
            onClick={createBed}
          >
            Buat
          </button>
        </div>
        <p className="text-[10px]" style={{ color: 'var(--text3)' }}>Lebar × panjang dalam sentimeter.</p>

        {beds.map((bed) => (
          <div key={bed.id} className="rounded-xl p-3 mt-1" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>
                {bed.name} · {bed.widthCm}×{bed.lengthCm} cm
              </span>
              <button className="text-[10px]" style={{ color: 'var(--neg)' }} onClick={() => deleteBed(bed.id)}>
                Hapus
              </button>
            </div>

            {/* Denah proporsional: kotak mengikuti rasio bedengan asli supaya
                jarak yang terlihat di layar mencerminkan jarak sebenarnya.
                Tanaman dan penanda bisa digeser langsung; ketuk tanpa geser
                mengangkatnya dari denah, sama seperti perilaku lama. */}
            <div
              className="relative w-full rounded-lg mb-2 touch-none"
              style={{
                paddingBottom: `${Math.min(160, (bed.lengthCm / Math.max(1, bed.widthCm)) * 100)}%`,
                background: 'var(--surface)',
                boxShadow: 'var(--neu-raised-sm)',
              }}
            >
              {bed.slots.map((s) => {
                const live = drag && drag.bedId === bed.id && drag.kind === 'slot' && drag.id === s.plantingId
                  ? drag : null;
                const posX = live?.posX ?? s.posX;
                const posY = live?.posY ?? s.posY;
                return (
                  <div
                    key={s.plantingId}
                    className="absolute rounded-full flex items-center justify-center text-[8px] font-bold cursor-grab select-none"
                    style={{
                      left: `${(posX / bed.widthCm) * 100}%`,
                      top: `${(posY / bed.lengthCm) * 100}%`,
                      width: `${Math.max(8, (Math.max(s.spacingCm, 10) / bed.widthCm) * 100)}%`,
                      aspectRatio: '1',
                      transform: 'translate(-50%, -50%)',
                      background: 'var(--accentSoft)',
                      color: 'var(--accent)',
                      border: '1px solid var(--accent)',
                      opacity: live?.moved ? 0.75 : 1,
                      zIndex: live ? 10 : 1,
                    }}
                    title={`${s.name} — geser untuk pindah, ketuk untuk angkat`}
                    onPointerDown={(e) => beginDrag(e, bed, 'slot', s.plantingId, s.posX, s.posY)}
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    {s.name.slice(0, 3)}
                  </div>
                );
              })}

              {bed.markers.map((m) => {
                const live = drag && drag.bedId === bed.id && drag.kind === 'marker' && drag.id === m.id
                  ? drag : null;
                const posX = live?.posX ?? m.posX;
                const posY = live?.posY ?? m.posY;
                return (
                  <div
                    key={m.id}
                    className="absolute flex items-center justify-center text-[10px] rounded-md cursor-grab select-none"
                    style={{
                      left: `${(posX / bed.widthCm) * 100}%`,
                      top: `${(posY / bed.lengthCm) * 100}%`,
                      width: `${Math.max(7, (Math.max(m.radiusCm * 2, 16) / bed.widthCm) * 100)}%`,
                      aspectRatio: '1',
                      transform: 'translate(-50%, -50%)',
                      background: 'var(--surface)',
                      border: '1px dashed var(--text3)',
                      opacity: live?.moved ? 0.75 : 1,
                      zIndex: live ? 10 : 1,
                    }}
                    title={`${m.label} — geser untuk pindah, ketuk untuk hapus`}
                    onPointerDown={(e) => beginDrag(e, bed, 'marker', m.id, m.posX, m.posY)}
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    {MARKER_ICON[m.kind] ?? MARKER_ICON.lainnya}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                {bed.report.slotCount} tanaman · {bed.markers.length} penanda · ruang terpakai {bed.report.usedPercent}%
              </p>
              <button
                className="text-[10px] font-semibold flex-shrink-0"
                style={{ color: 'var(--accent)' }}
                onClick={() => setPlacingMarker(placingMarker === bed.id ? null : bed.id)}
              >
                {placingMarker === bed.id ? 'Batal' : '+ Penanda'}
              </button>
            </div>

            {placingMarker === bed.id && (
              <div className="flex gap-1.5 mb-1">
                {MARKER_KINDS.map((k) => (
                  <button
                    key={k.id}
                    className="flex-1 text-[10px] py-1.5 rounded-lg font-semibold"
                    style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                    onClick={() => addMarker(bed, k.id)}
                  >
                    {MARKER_ICON[k.id]} {k.label}
                  </button>
                ))}
              </div>
            )}

            {bed.report.issues.map((issue, i) => (
              <p key={i} className="text-[10px] leading-relaxed mt-0.5" style={{ color: 'var(--warn)' }}>
                ⚠️ {issue.message}
              </p>
            ))}
          </div>
        ))}

        {beds.length > 0 && (
          <div className="flex gap-2 mt-1">
            <select
              className="flex-1 min-w-0 px-2 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
              value={placeBed} onChange={(e) => setPlaceBed(e.target.value)}
            >
              <option value="">Pilih bedengan…</option>
              {beds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select
              className="flex-1 min-w-0 px-2 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
              value={placePlanting} onChange={(e) => setPlacePlanting(e.target.value)}
            >
              <option value="">Pilih tanaman…</option>
              {plantings.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <button
              className="neu-cta px-3 py-2 rounded-lg text-[11px] font-bold text-white flex-shrink-0"
              style={{ background: 'var(--accentFill)', opacity: placeBed && placePlanting ? 1 : 0.6 }}
              onClick={placePlant}
              disabled={!placeBed || !placePlanting}
            >
              Taruh
            </button>
          </div>
        )}
      </Card>
    </>
  );
}

// ─────────────────── BAGIAN UNTUK TAB CATATAN ───────────────────

export function GrowRecordSections() {
  const [sowings, setSowings] = useState<SowingsResponse | null>(null);
  const [scores, setScores] = useState<TreatmentScore[]>([]);
  const [pending, setPending] = useState<PendingReview[]>([]);
  const [kitchen, setKitchen] = useState<KitchenReport | null>(null);
  const [annual, setAnnual] = useState<AnnualReport | null>(null);
  const [streak, setStreak] = useState<GardenStreak | null>(null);
  const [recipes, setRecipes] = useState<RecipeIdea[] | null>(null);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Form semai baru
  const [sowName, setSowName] = useState('');
  const [sowBrand, setSowBrand] = useState('');
  const [sowCount, setSowCount] = useState('20');
  // Benih yang dipakai. Kalau diisi, backend ikut mengurangi stoknya — itulah
  // satu-satunya cara angka di laci tetap berhubungan dengan yang ditanam.
  const [sowSeedId, setSowSeedId] = useState('');
  const [seeds, setSeeds] = useState<SeedStock[]>([]);

  const loadSowings = async () => {
    try {
      // Stok ikut dimuat ulang: menyemai mengurangi jumlahnya, dan daftar
      // yang tertinggal akan menawarkan benih yang sudah habis.
      const [s, seedRes] = await Promise.all([
        apiFetch<SowingsResponse>('/garden/sowings'),
        apiFetch<{ seeds: SeedStock[] }>('/garden/seeds').catch(() => ({ seeds: [] })),
      ]);
      setSowings(s);
      setSeeds(seedRes.seeds);
    } catch (err) {
      setError(describeError(err, 'Gagal memuat pembibitan.'));
    }
  };

  const loadTreatments = async () => {
    try {
      const t = await apiFetch<{ scores: TreatmentScore[]; pending: PendingReview[] }>('/garden/treatments');
      setScores(t.scores);
      setPending(t.pending);
    } catch (err) {
      setError(describeError(err, 'Gagal memuat catatan hama.'));
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [s, t, k, a, st, seedRes] = await Promise.all([
        apiFetch<SowingsResponse>('/garden/sowings').catch(() => null),
        apiFetch<{ scores: TreatmentScore[]; pending: PendingReview[] }>('/garden/treatments')
          .catch(() => ({ scores: [], pending: [] })),
        apiFetch<KitchenReport>('/garden/kitchen').catch(() => null),
        apiFetch<AnnualReport>('/garden/annual-report').catch(() => null),
        apiFetch<GardenStreak>('/garden/streak').catch(() => null),
        apiFetch<{ seeds: SeedStock[] }>('/garden/seeds').catch(() => ({ seeds: [] })),
      ]);
      if (cancelled) return;
      setSowings(s);
      setSeeds(seedRes.seeds);
      setScores(t.scores);
      setPending(t.pending);
      setKitchen(k);
      setAnnual(a);
      setStreak(st);
    })();

    return () => { cancelled = true; };
  }, []);

  const addSowing = async () => {
    if (!sowName.trim()) return;
    try {
      await apiFetch('/garden/sowings', {
        method: 'POST',
        body: JSON.stringify({
          name: sowName.trim(),
          brand: sowBrand.trim() || undefined,
          seedCount: Number(sowCount),
          seedId: sowSeedId || undefined,
        }),
      });
      setSowName('');
      setSowBrand('');
      setSowSeedId('');
      await loadSowings();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan catatan semai.'));
    }
  };

  const recordGermination = async (id: string, seedCount: number) => {
    const answer = prompt(`Berapa benih yang tumbuh dari ${seedCount} yang disemai?`);
    if (answer === null) return;
    const count = Number(answer);
    if (!Number.isFinite(count) || count < 0) return;
    try {
      await apiFetch(`/garden/sowings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ germinatedCount: count }),
      });
      await loadSowings();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan hasil kecambah.'));
    }
  };

  const answerReview = async (id: string | null, worked: boolean) => {
    if (!id) return;
    try {
      await apiFetch(`/garden/pests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ worked }),
      });
      await loadTreatments();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan penilaian.'));
    }
  };

  const loadRecipes = async () => {
    setLoadingRecipes(true);
    try {
      const res = await apiFetch<{ recipes: RecipeIdea[] }>('/garden/harvest-recipes');
      setRecipes(res.recipes);
    } catch (err) {
      setError(describeError(err, 'Gagal membuat saran masak.'));
    } finally {
      setLoadingRecipes(false);
    }
  };

  const exportAnnualPdf = async () => {
    if (!annual) return;
    setExporting(true);
    try {
      // jsPDF diimpor dinamis: laporan tahunan jarang dibuka, dan Kebun adalah
      // tab utama yang dimuat eager — import statis akan menaikkan bundle awal
      // seluruh aplikasi.
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      let y = 20;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(`Laporan Kebun ${annual.year}`, 20, y);
      y += 10;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const lines = [
        `Tanaman ditanam: ${annual.plantedCount}`,
        `Gagal: ${annual.failedCount}${annual.successPercent !== null ? ` (tingkat berhasil ${annual.successPercent}%)` : ''}`,
        `Catatan hama: ${annual.pestCount}`,
        '',
        `Nilai panen: ${rupiah(annual.harvestValueIdr)}`,
        `Biaya kebun: ${rupiah(annual.costIdr)}`,
        `Selisih: ${rupiah(annual.netIdr)}`,
      ];
      for (const line of lines) {
        doc.text(line, 20, y);
        y += 6;
      }

      if (annual.items.length > 0) {
        y += 4;
        doc.setFont('helvetica', 'bold');
        doc.text('Rincian panen', 20, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        for (const item of annual.items) {
          if (y > 275) {
            doc.addPage();
            y = 20;
          }
          const value = item.valueIdr !== null ? rupiah(item.valueIdr) : 'harga belum dicatat';
          doc.text(`${item.name}: ${item.amount} ${item.unit} — ${value}`, 20, y);
          y += 6;
        }
      }

      doc.save(`laporan-kebun-${annual.year}.pdf`);
    } catch (err) {
      setError(describeError(err, 'Gagal membuat PDF laporan.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      {error && (
        <div className="rounded-xl p-3 text-xs border-l-[3px] mb-3"
          style={{ background: 'rgba(255, 159, 10, 0.1)', borderColor: '#ff9f0a', color: 'var(--text2)' }}>
          {error}
        </div>
      )}

      {/* Streak merawat kebun */}
      {streak && streak.totalDays > 0 && (
        <Card title="🔥 Rentetan merawat kebun">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold" style={{ color: streak.current > 0 ? 'var(--accent)' : 'var(--text3)' }}>
              {streak.current}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text2)' }}>
              hari berturut-turut{streak.activeToday ? '' : ' · hari ini belum'}
            </span>
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
            Rekor {streak.longest} hari · total {streak.totalDays} hari merawat.
            Bolong sehari masih dimaafkan — kebun tidak menuntut tiap hari.
          </p>
        </Card>
      )}

      {/* Panen jadi saran masak */}
      <Card title="🍳 Masak apa dari panen">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
            Dari panen tiga hari terakhir.
          </p>
          <button
            className="neu-cta text-[10px] font-bold px-2.5 py-1 rounded-lg text-white flex-shrink-0"
            style={{ background: 'var(--accentFill)', opacity: loadingRecipes ? 0.6 : 1 }}
            onClick={loadRecipes}
            disabled={loadingRecipes}
          >
            {loadingRecipes ? 'Memikirkan...' : 'Cari ide'}
          </button>
        </div>
        {recipes && recipes.length === 0 && (
          <p className="text-[11px]" style={{ color: 'var(--text2)' }}>
            Belum ada panen tercatat beberapa hari ini.
          </p>
        )}
        {recipes?.map((r, i) => (
          <div key={i} className="rounded-xl p-2.5" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
            <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>
              {r.name}{r.minutes !== null && ` · ${r.minutes} menit`}
            </p>
            <p className="text-[10px] mb-1" style={{ color: 'var(--text3)' }}>Pakai: {r.uses.join(', ')}</p>
            {r.steps.map((s, j) => (
              <p key={j} className="text-[10px] leading-relaxed" style={{ color: 'var(--text2)' }}>{j + 1}. {s}</p>
            ))}
          </div>
        ))}
      </Card>

      {/* Penilaian penanganan hama yang menggantung — paling atas karena ini
          yang menutup lingkaran data; tanpa dijawab, peringkat di bawah kosong. */}
      {pending.length > 0 && (
        <Card title="❓ Penanganan hama berhasil?">
          {pending.map((p, i) => (
            <div key={p.id ?? i} className="rounded-xl p-2.5" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                {p.pest}{p.treatment ? ` — ${p.treatment}` : ''}
              </p>
              <p className="text-[10px] mb-1.5" style={{ color: 'var(--text3)' }}>
                Terlihat {p.spottedDate} · {p.daysSince} hari lalu
              </p>
              <div className="flex gap-2">
                <button
                  className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-white"
                  style={{ background: 'var(--pos)' }}
                  onClick={() => answerReview(p.id, true)}
                >
                  Berhasil
                </button>
                <button
                  className="flex-1 py-1.5 rounded-lg text-[11px] font-bold"
                  style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                  onClick={() => answerReview(p.id, false)}
                >
                  Belum
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {scores.length > 0 && (
        <Card title="🧪 Penanganan yang terbukti">
          {scores.map((s, i) => (
            <div key={i} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>{s.treatment}</p>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                  {s.pest} · {s.worked} dari {s.tried} kali
                  {s.avgDaysToResolve !== null && ` · rata-rata ${s.avgDaysToResolve} hari`}
                </p>
              </div>
              <span className="text-xs font-bold flex-shrink-0"
                style={{ color: s.successPercent >= 50 ? 'var(--pos)' : 'var(--text3)' }}>
                {s.successPercent}%
              </span>
            </div>
          ))}
        </Card>
      )}

      {/* Pembibitan */}
      <Card title="🌱 Pembibitan">
        <div className="flex gap-2">
          <input
            className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
            placeholder="Tanaman" value={sowName} onChange={(e) => setSowName(e.target.value)}
          />
          <input
            className="flex-1 min-w-0 px-2.5 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
            placeholder="Merek benih" value={sowBrand} onChange={(e) => setSowBrand(e.target.value)}
          />
          <input
            className="w-14 px-2 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
            value={sowCount} onChange={(e) => setSowCount(e.target.value)} inputMode="numeric" aria-label="Jumlah benih"
          />
          <button
            className="neu-cta px-3 py-2 rounded-lg text-[11px] font-bold text-white flex-shrink-0"
            style={{ background: 'var(--accentFill)' }}
            onClick={addSowing}
          >
            Semai
          </button>
        </div>

        {seeds.length > 0 && (
          <select
            className="w-full px-2.5 py-2 rounded-lg text-[11px] outline-none" style={inputStyle}
            value={sowSeedId}
            aria-label="Ambil dari stok benih"
            onChange={(e) => {
              const id = e.target.value;
              setSowSeedId(id);
              // Nama diisikan supaya tidak perlu mengetik ulang apa yang sudah
              // tercatat di laci; yang sudah diketik pengguna tidak ditimpa.
              const picked = seeds.find((sd) => sd.id === id);
              if (picked && !sowName.trim()) setSowName(picked.name);
            }}
          >
            <option value="">Tanpa mengurangi stok benih</option>
            {seeds.map((sd) => (
              <option key={sd.id} value={sd.id}>
                {sd.name} · sisa {sd.quantity} {sd.unit}
              </option>
            ))}
          </select>
        )}

        {sowSeedId && !seeds.find((sd) => sd.id === sowSeedId && sd.unit.toLowerCase() === 'butir') && (
          <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
            Stok ini bersatuan bukan butir, jadi jumlahnya tidak dikurangi otomatis.
          </p>
        )}

        {sowings && sowings.summary.totalBatches > 0 && (
          <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
            {sowings.summary.totalBatches} batch
            {sowings.summary.overallRatePercent !== null && ` · daya tumbuh ${sowings.summary.overallRatePercent}%`}
            {sowings.summary.readyToTransplant > 0 && ` · ${sowings.summary.readyToTransplant} bibit siap pindah`}
          </p>
        )}

        {sowings?.sowings.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl p-2.5"
            style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>
                {s.emoji} {s.name}{s.brand ? ` · ${s.brand}` : ''}
              </p>
              <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                {s.sownDate} · {s.seedCount} benih
                {s.germinatedCount !== null && ` · tumbuh ${s.germinatedCount}`}
              </p>
            </div>
            {s.germinatedCount === null && (
              <button
                className="text-[10px] font-bold px-2 py-1 rounded-lg flex-shrink-0 text-white"
                style={{ background: 'var(--accentFill)' }}
                onClick={() => recordGermination(s.id, s.seedCount)}
              >
                Hitung
              </button>
            )}
          </div>
        ))}

        {sowings && sowings.sources.length > 0 && (
          <>
            <p className="text-[10px] font-extrabold uppercase tracking-wider mt-1" style={{ color: 'var(--text3)' }}>
              Peringkat benih
            </p>
            {sowings.sources.map((src) => (
              <div key={src.brand} className="flex items-center justify-between gap-2">
                <span className="text-[11px] truncate" style={{ color: 'var(--text2)' }}>
                  {src.brand} <span style={{ color: 'var(--text3)' }}>({src.seedsSown} benih)</span>
                  {!src.reliable && <span style={{ color: 'var(--text3)' }}> · data masih tipis</span>}
                </span>
                <span className="text-[11px] font-bold flex-shrink-0" style={{ color: 'var(--text)' }}>
                  {src.ratePercent}%
                </span>
              </div>
            ))}
          </>
        )}
      </Card>

      {/* Dari kebun ke piring */}
      {kitchen && kitchen.items.length > 0 && (
        <Card title="🍽️ Dari kebun ke piring">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-extrabold" style={{ color: 'var(--pos)' }}>
              {rupiah(kitchen.harvestValueIdr)}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text3)' }}>nilai panen bulan ini</span>
          </div>
          {kitchen.selfSufficiencyPercent !== null ? (
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text2)' }}>
              Setara {kitchen.selfSufficiencyPercent}% dari belanja makanan bulan ini
              ({rupiah(kitchen.foodSpendIdr)}).
            </p>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
              Belum ada belanja makanan tercatat bulan ini sebagai pembanding.
            </p>
          )}
          {kitchen.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="text-[11px] truncate" style={{ color: 'var(--text2)' }}>
                {item.name} · {item.amount} {item.unit}
              </span>
              <span className="text-[11px] font-semibold flex-shrink-0"
                style={{ color: item.valueIdr !== null ? 'var(--text)' : 'var(--text3)' }}>
                {item.valueIdr !== null ? rupiah(item.valueIdr) : 'belum ada harga'}
              </span>
            </div>
          ))}
          {kitchen.unpricedHarvests.length > 0 && (
            <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
              Catat harga {kitchen.unpricedHarvests.join(', ')} di tab Catatan supaya ikut dinilai.
            </p>
          )}
        </Card>
      )}

      {/* Laporan tahunan */}
      {annual && (
        <Card title="📊 Laporan tahunan">
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Ditanam', `${annual.plantedCount}`],
              ['Berhasil', annual.successPercent !== null ? `${annual.successPercent}%` : '–'],
              ['Nilai panen', rupiah(annual.harvestValueIdr)],
              ['Biaya', rupiah(annual.costIdr)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl p-2.5" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>{label}</p>
                <p className="text-[12px] font-bold" style={{ color: 'var(--text)' }}>{value}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px]" style={{ color: annual.netIdr >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
            Selisih {annual.year}: {rupiah(annual.netIdr)}
          </p>
          <button
            className="neu-cta py-2.5 rounded-xl text-[12px] font-bold text-white"
            style={{ background: 'var(--accentFill)', opacity: exporting ? 0.6 : 1 }}
            onClick={exportAnnualPdf}
            disabled={exporting}
          >
            {exporting ? 'Membuat PDF...' : '📄 Ekspor laporan PDF'}
          </button>
        </Card>
      )}

    </>
  );
}
