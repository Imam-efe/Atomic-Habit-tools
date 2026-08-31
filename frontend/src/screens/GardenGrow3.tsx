/**
 * Peta matahari dan benih simpanan sendiri.
 *
 * Berkas ketiga untuk layar Kebun, mengikuti pemisahan yang sudah ada:
 * GardenGrow.tsx gelombang pertama, GardenGrow2.tsx gelombang kedua. Dua
 * komponen yang diekspor dipasang ke tab yang sudah dikenal — Rencana dan
 * Catatan — supaya tidak ada navigasi baru yang harus dipelajari.
 */

import { useEffect, useState } from 'react';
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

const inputStyle = {
  background: 'var(--bg)',
  color: 'var(--text)',
  boxShadow: 'var(--neu-inset)',
} as const;

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

// ─────────────────────────── TIPE RESPONS ───────────────────────────

type Sunlight = 'penuh' | 'sebagian' | 'teduh';

interface ProfilMatahari {
  lokasiId: string;
  lokasiLabel: string;
  jamLangsung: number;
  orientation: string | null;
  note: string | null;
}

interface LokasiBelumDiukur {
  lokasiId: string;
  lokasiLabel: string;
}

interface PeringatanMatahari {
  plantingId: string;
  label: string;
  lokasiId: string;
  lokasiLabel: string;
  jamLangsung: number;
  butuh: Sunlight;
  kecocokan: 'kurang' | 'terlalu-terik';
  message: string;
}

interface SunMapResponse {
  profil: ProfilMatahari[];
  belumDiukur: LokasiBelumDiukur[];
  peringatan: PeringatanMatahari[];
  kebutuhanJam: Record<Sunlight, { min: number; max: number | null }>;
  labelSunlight: Record<Sunlight, string>;
}

interface SavedSeed {
  id: string;
  plantId: string | null;
  name: string;
  emoji: string;
  generation: number;
  generationLabel: string;
  harvestedDate: string;
  quantity: number;
  unit: string;
  note: string | null;
  sourcePlantingId: string | null;
  sourceNickname: string | null;
}

interface RingkasanGenerasi {
  generation: number;
  jumlahDinilai: number;
  rataPanen: number;
  unit: string;
}

interface RingkasanGalur {
  plantKey: string;
  label: string;
  generasiTertinggi: number;
  jumlahBatch: number;
  perGenerasi: RingkasanGenerasi[];
  generasiTerbaik: number | null;
}

interface SavedSeedsResponse {
  seeds: SavedSeed[];
  galur: RingkasanGalur[];
}

/** Warna peringatan menurut arah masalahnya — kurang cahaya vs kelebihan. */
const WARNA_KECOCOKAN: Record<PeringatanMatahari['kecocokan'], string> = {
  kurang: '#5b8def',
  'terlalu-terik': '#ff9f0a',
};

const IKON_KECOCOKAN: Record<PeringatanMatahari['kecocokan'], string> = {
  kurang: '🌥️',
  'terlalu-terik': '🔥',
};

// ─────────────────────────── RENCANA: PETA MATAHARI ───────────────────────────

export function GrowPlannerSections3() {
  const [data, setData] = useState<SunMapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Lokasi yang sedang diisi jamnya; null berarti tidak ada form terbuka. */
  const [mengukur, setMengukur] = useState<LokasiBelumDiukur | null>(null);
  const [jamInput, setJamInput] = useState('');
  const [orientasi, setOrientasi] = useState('');

  const reload = async () => {
    try {
      setData(await apiFetch<SunMapResponse>('/garden/sun-map'));
    } catch (err) {
      setError(describeError(err, 'Gagal memuat peta matahari.'));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const simpanJam = async () => {
    if (!mengukur) return;
    const jam = Number(jamInput.replace(',', '.'));
    if (!Number.isFinite(jam)) {
      setError('Isi jam matahari dengan angka, misalnya 6 atau 4,5.');
      return;
    }
    try {
      await apiFetch('/garden/sun-map', {
        method: 'PUT',
        body: JSON.stringify({
          lokasiId: mengukur.lokasiId,
          lokasiLabel: mengukur.lokasiLabel,
          jamLangsung: jam,
          orientation: orientasi || undefined,
        }),
      });
      setMengukur(null);
      setJamInput('');
      setOrientasi('');
      setError(null);
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan jam matahari.'));
    }
  };

  const hapusProfil = async (lokasiId: string) => {
    try {
      await apiFetch(`/garden/sun-map/${encodeURIComponent(lokasiId)}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menghapus profil.'));
    }
  };

  const bukaForm = (lokasi: LokasiBelumDiukur, jamAwal = '') => {
    setMengukur(lokasi);
    setJamInput(jamAwal);
    setOrientasi('');
  };

  if (!data) return null;

  return (
    <div className="flex flex-col">
      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {data.peringatan.length > 0 && (
        <Card title="☀️ Tanaman yang salah tempat">
          {data.peringatan.map((p) => (
            <div key={p.plantingId} className="flex gap-2 items-start">
              <span
                className="text-sm shrink-0 font-bold"
                style={{ color: WARNA_KECOCOKAN[p.kecocokan] }}
              >
                {IKON_KECOCOKAN[p.kecocokan]}
              </span>
              <div className="text-xs" style={{ color: 'var(--text2)' }}>{p.message}</div>
            </div>
          ))}
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            Salah menaruh adalah penyebab gagal paling sering di kebun rumahan, dan paling jarang
            disadari — tanamannya cuma terlihat "kurang subur" berbulan-bulan.
          </div>
        </Card>
      )}

      <Card title="🧭 Peta matahari">
        {data.profil.length === 0 && data.belumDiukur.length === 0 && (
          <div className="text-xs" style={{ color: 'var(--text2)' }}>
            Belum ada lokasi tanaman untuk diukur. Tambahkan tanaman dengan lokasi dulu, lalu catat
            berapa jam matahari langsung yang didapat tempat itu.
          </div>
        )}

        {data.profil.map((p) => (
          <div key={p.lokasiId} className="flex items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{p.lokasiLabel}</span>
              <span className="text-xs" style={{ color: 'var(--text3)' }}>
                {p.jamLangsung} jam matahari langsung
                {p.orientation ? ` · hadap ${p.orientation}` : ''}
              </span>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                className="px-2 py-1 rounded-lg text-[10px] font-semibold"
                style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                onClick={() => bukaForm({ lokasiId: p.lokasiId, lokasiLabel: p.lokasiLabel }, String(p.jamLangsung))}
              >
                Ubah
              </button>
              <button
                className="px-2 py-1 rounded-lg text-[10px] font-semibold"
                style={{ background: 'rgba(255,59,48,0.1)', color: '#ff3b30' }}
                onClick={() => hapusProfil(p.lokasiId)}
              >
                Hapus
              </button>
            </div>
          </div>
        ))}

        {data.belumDiukur.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-1" style={{ borderTop: '1px solid var(--sep)' }}>
            <div className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
              Belum diukur
            </div>
            {data.belumDiukur.map((l) => (
              <div key={l.lokasiId} className="flex items-center justify-between gap-2">
                <span className="text-sm" style={{ color: 'var(--text2)' }}>{l.lokasiLabel}</span>
                <button
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold shrink-0 text-white"
                  style={{ background: 'var(--accentFill)' }}
                  onClick={() => bukaForm(l)}
                >
                  Catat jam
                </button>
              </div>
            ))}
          </div>
        )}

        {mengukur && (
          <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
            <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{mengukur.lokasiLabel}</div>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>
              Berapa jam tempat ini kena matahari LANGSUNG, bukan sekadar terang? Amati sekali di
              hari cerah — pohon tetangga dan atap tidak ada di ramalan cuaca mana pun.
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface)', color: 'var(--text)' }}
                placeholder="Jam, misal 6"
                inputMode="decimal"
                value={jamInput}
                onChange={(e) => setJamInput(e.target.value)}
                autoFocus
              />
              <select
                className="px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--surface)', color: 'var(--text)' }}
                value={orientasi}
                onChange={(e) => setOrientasi(e.target.value)}
              >
                <option value="">Arah hadap…</option>
                {['utara', 'timur', 'selatan', 'barat', 'campuran'].map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 py-2 rounded-lg text-[11px] font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--text2)' }}
                onClick={() => setMengukur(null)}
              >
                Batal
              </button>
              <button
                className="flex-1 py-2 rounded-lg text-[11px] font-bold text-white"
                style={{ background: jamInput.trim() ? 'var(--accentFill)' : 'var(--track)' }}
                disabled={!jamInput.trim()}
                onClick={simpanJam}
              >
                Simpan
              </button>
            </div>
          </div>
        )}

        {data.profil.length > 0 && (
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            Patokan: {data.labelSunlight.penuh} butuh ≥{data.kebutuhanJam.penuh.min} jam,{' '}
            {data.labelSunlight.sebagian} {data.kebutuhanJam.sebagian.min}–{data.kebutuhanJam.sebagian.max} jam,{' '}
            {data.labelSunlight.teduh} maksimal {data.kebutuhanJam.teduh.max} jam.
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────── CATATAN: BENIH SIMPANAN ───────────────────────────

export function GrowRecordSections3({ plantings }: { plantings: PlantingOption[] }) {
  const [data, setData] = useState<SavedSeedsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sumberPlanting, setSumberPlanting] = useState('');
  const [jumlah, setJumlah] = useState('');
  const [satuan, setSatuan] = useState('butir');

  const reload = async () => {
    try {
      setData(await apiFetch<SavedSeedsResponse>('/garden/saved-seeds'));
    } catch (err) {
      setError(describeError(err, 'Gagal memuat benih simpanan.'));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const simpanBenih = async () => {
    if (!sumberPlanting) return;
    try {
      await apiFetch('/garden/saved-seeds', {
        method: 'POST',
        body: JSON.stringify({
          plantingId: sumberPlanting,
          quantity: Number(jumlah.replace(/\D/g, '')) || undefined,
          unit: satuan,
        }),
      });
      setSumberPlanting('');
      setJumlah('');
      setError(null);
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan benih.'));
    }
  };

  const hapusBenih = async (id: string) => {
    try {
      await apiFetch(`/garden/saved-seeds/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menghapus benih.'));
    }
  };

  if (!data) return null;

  return (
    <div className="flex flex-col">
      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {data.galur.length > 0 && (
        <Card title="🧬 Galur benihmu sendiri">
          {data.galur.map((g) => (
            <div key={g.plantKey} className="flex flex-col gap-0.5">
              <div className="flex justify-between items-center text-sm">
                <span style={{ color: 'var(--text)' }}>{g.label}</span>
                <span className="text-xs" style={{ color: 'var(--text3)' }}>
                  sampai F{g.generasiTertinggi} · {g.jumlahBatch} batch
                </span>
              </div>
              {g.perGenerasi.map((gen) => (
                <div key={gen.generation} className="flex justify-between text-xs">
                  <span style={{ color: 'var(--text3)' }}>
                    F{gen.generation} · {gen.jumlahDinilai} tanaman dinilai
                  </span>
                  <span
                    style={{ color: g.generasiTerbaik === gen.generation ? '#34c759' : 'var(--text3)' }}
                  >
                    rata-rata {gen.rataPanen} {gen.unit}
                    {g.generasiTerbaik === gen.generation ? ' ✓' : ''}
                  </span>
                </div>
              ))}
            </div>
          ))}
          <div className="text-xs" style={{ color: 'var(--text3)' }}>
            Generasi ditandai terbaik hanya kalau sudah ada minimal dua yang bisa dibandingkan.
          </div>
        </Card>
      )}

      <Card title="🫙 Benih simpanan sendiri">
        {data.seeds.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {data.seeds.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-sm" style={{ color: 'var(--text)' }}>
                    {s.emoji} {s.name}{' '}
                    <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{s.generationLabel}</span>
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text3)' }}>
                    {s.harvestedDate}
                    {s.quantity > 0 ? ` · ${s.quantity} ${s.unit}` : ''}
                    {s.sourceNickname ? ` · dari ${s.sourceNickname}` : ''}
                  </span>
                </div>
                <button className="text-xs shrink-0" style={{ color: '#ff3b30' }} onClick={() => hapusBenih(s.id)}>
                  Hapus
                </button>
              </div>
            ))}
          </div>
        )}

        <select
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={inputStyle}
          value={sumberPlanting}
          onChange={(e) => setSumberPlanting(e.target.value)}
        >
          <option value="">Simpan benih dari tanaman…</option>
          {plantings.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input
            className="px-3 py-2.5 rounded-xl text-sm outline-none"
            style={inputStyle}
            placeholder="Jumlah (opsional)"
            inputMode="numeric"
            value={jumlah}
            onChange={(e) => setJumlah(e.target.value)}
          />
          <select
            className="px-3 py-2.5 rounded-xl text-sm outline-none"
            style={inputStyle}
            value={satuan}
            onChange={(e) => setSatuan(e.target.value)}
          >
            {['butir', 'gram', 'bungkus'].map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <motion.button
          className="py-2.5 rounded-xl text-xs font-semibold text-white"
          style={{ background: sumberPlanting ? 'var(--accentFill)' : 'var(--track)' }}
          onClick={simpanBenih}
          disabled={!sumberPlanting}
          whileTap={sumberPlanting ? { scale: 0.97 } : {}}
          transition={springs.snappy}
        >
          Simpan benih
        </motion.button>
        <div className="text-xs" style={{ color: 'var(--text3)' }}>
          Generasinya dihitung sendiri: benih dari tanaman asal beli jadi F1, dan naik satu tiap kali
          disimpan lagi dari keturunannya.
        </div>
      </Card>
    </div>
  );
}
