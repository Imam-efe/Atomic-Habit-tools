/**
 * Uji tanah, Pranata Mangsa, perbanyakan, dan media tanam.
 *
 * Berkas keempat untuk layar Kebun, mengikuti pemisahan yang sudah ada:
 * GardenGrow.tsx gelombang pertama, GardenGrow2.tsx kedua, GardenGrow3.tsx
 * ketiga. Komponen yang diekspor dipasang ke tab yang sudah dikenal — Rencana
 * dan Catatan — supaya tidak ada navigasi baru yang harus dipelajari.
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

const buttonStyle = {
  background: 'var(--bg)',
  color: 'var(--text2)',
  boxShadow: 'var(--neu-raised-sm)',
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

interface UjiTanahRow {
  id: string;
  lokasiId: string;
  lokasiLabel: string;
  ph: number;
  texture: string | null;
  testedDate: string;
  note: string | null;
  terbaru: boolean;
}

interface SalahTanah {
  plantingId: string;
  nama: string;
  lokasiLabel: string;
  ph: number;
  status: 'terlalu-masam' | 'terlalu-basa';
  saran: string | null;
}

interface SoilResponse {
  riwayat: UjiTanahRow[];
  salahTanah: SalahTanah[];
  belumDiuji: Array<{ lokasiId: string; contohTanaman: string }>;
  tekstur: string[];
}

interface Mangsa {
  urutan: number;
  nama: string;
  mulai: string;
  selesai: string;
  musim: string;
  pertanda: string;
  saran: string;
  musimSederhana: string;
}

interface MangsaResponse {
  hariIni: string;
  sekarang: Mangsa;
  berikutnya: { urutan: number; nama: string; mulai: string; musim: string };
  cocokDitanam: Array<{ plantId: string; nama: string; emoji: string; idealSekarang: boolean }>;
}

interface CatatanPerbanyakan {
  id: string;
  nama: string;
  method: string;
  methodLabel: string;
  startedDate: string;
  countStarted: number;
  countRooted: number | null;
  rate: number | null;
}

interface PropagationResponse {
  catatan: CatatanPerbanyakan[];
  ringkasan: Array<{ method: string; label: string; batch: number; started: number; rate: number }>;
  saranKatalog: Array<{
    plantId: string; nama: string; emoji: string; teks: string;
    metode: Array<{ method: string; label: string }>;
  }>;
  metodeSah: Array<{ method: string; label: string }>;
}

interface MediaRow {
  plantingId: string;
  nama: string;
  media: string;
  mediaLabel: string;
  butuhSiram: boolean;
  lastSolutionChange: string | null;
  tugas: string[];
}

interface MediaResponse {
  daftar: MediaRow[];
  pilihan: Array<{ media: string; label: string }>;
}

/**
 * Merah untuk masam, oranye untuk basa. Bukan dua nada merah: keduanya
 * diperbaiki dengan tindakan yang berlawanan — satu dikapur, satu justru tidak
 * boleh — jadi keliru membaca yang mana memperburuk keadaannya.
 */
const WARNA_PH: Record<SalahTanah['status'], string> = {
  'terlalu-masam': '#ff453a',
  'terlalu-basa': '#ff9f0a',
};

const LABEL_PH: Record<SalahTanah['status'], string> = {
  'terlalu-masam': 'Terlalu masam',
  'terlalu-basa': 'Terlalu basa',
};

// ══════════════════════════ TAB RENCANA ══════════════════════════

/** Kartu mangsa berjalan: pertanda alam dan apa yang dikerjakan sekarang. */
export function MangsaSection() {
  const [data, setData] = useState<MangsaResponse | null>(null);

  useEffect(() => {
    apiFetch<MangsaResponse>('/garden/mangsa').then(setData).catch(() => setData(null));
  }, []);

  if (!data) return null;

  return (
    <Card title={`🗓️ Mangsa ${data.sekarang.nama}`}>
      <div className="text-xs" style={{ color: 'var(--text3)' }}>
        Mangsa ke-{data.sekarang.urutan} · {data.sekarang.mulai} sampai {data.sekarang.selesai} ·{' '}
        {data.sekarang.musim}
      </div>

      <div className="text-xs italic" style={{ color: 'var(--text2)' }}>
        {data.sekarang.pertanda}
      </div>

      <div className="text-xs" style={{ color: 'var(--text)' }}>{data.sekarang.saran}</div>

      {data.cocokDitanam.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {data.cocokDitanam.slice(0, 12).map((t) => (
            <span
              key={t.plantId}
              className="px-2 py-1 rounded-lg text-[10px]"
              style={{
                background: 'var(--bg)',
                color: t.idealSekarang ? 'var(--text)' : 'var(--text3)',
                boxShadow: 'var(--neu-inset)',
              }}
            >
              {t.emoji} {t.nama}
            </span>
          ))}
        </div>
      )}

      <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
        Berikutnya mangsa {data.berikutnya.nama}, mulai {data.berikutnya.mulai}. Pranata Mangsa
        adalah kalender tani Jawa berumur ratusan tahun; pembagiannya terbukti sejalan dengan pola
        curah hujan nyata.
      </div>
    </Card>
  );
}

/** Uji tanah: catat pH per lokasi, lalu cocokkan dengan syarat tanamannya. */
export function SoilSections() {
  const [data, setData] = useState<SoilResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [lokasiId, setLokasiId] = useState('');
  const [phInput, setPhInput] = useState('');
  const [texture, setTexture] = useState('');
  const [formTerbuka, setFormTerbuka] = useState(false);

  const reload = async () => {
    try {
      setData(await apiFetch<SoilResponse>('/garden/soil'));
    } catch (err) {
      setError(describeError(err, 'Gagal memuat uji tanah.'));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const simpan = async () => {
    const lokasi = lokasiId.trim();
    if (!lokasi) {
      setError('Pilih atau tulis lokasi yang diuji dulu.');
      return;
    }
    const ph = Number(phInput.replace(',', '.'));
    if (!Number.isFinite(ph)) {
      setError('Isi pH dengan angka, misalnya 6 atau 5,5.');
      return;
    }
    try {
      await apiFetch('/garden/soil', {
        method: 'POST',
        body: JSON.stringify({
          lokasiId: lokasi.startsWith('loc:') ? lokasi : `loc:${lokasi}`,
          lokasiLabel: lokasi.replace(/^loc:/, ''),
          ph,
          texture: texture || undefined,
        }),
      });
      setFormTerbuka(false);
      setLokasiId('');
      setPhInput('');
      setTexture('');
      setError(null);
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan hasil uji.'));
    }
  };

  const hapus = async (id: string) => {
    try {
      await apiFetch(`/garden/soil/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menghapus hasil uji.'));
    }
  };

  if (!data) return null;

  const terbaru = data.riwayat.filter((r) => r.terbaru);

  return (
    <div className="flex flex-col">
      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {data.salahTanah.length > 0 && (
        <Card title="🧪 Tanaman yang salah tanah">
          {data.salahTanah.map((s) => (
            <div key={s.plantingId} className="flex flex-col gap-1">
              <div className="flex gap-2 items-center">
                <span className="text-xs font-bold shrink-0" style={{ color: WARNA_PH[s.status] }}>
                  {LABEL_PH[s.status]}
                </span>
                <span className="text-xs" style={{ color: 'var(--text)' }}>
                  {s.nama} · {s.lokasiLabel} · pH {s.ph}
                </span>
              </div>
              {s.saran && (
                <div className="text-[11px] pl-1" style={{ color: 'var(--text2)' }}>{s.saran}</div>
              )}
            </div>
          ))}
          <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
            Tanaman yang mandek karena pH terlihat persis seperti tanaman yang kurang pupuk. Menambah
            pupuk tidak menolong — haranya sudah ada di tanah, tapi terkunci.
          </div>
        </Card>
      )}

      <Card title="🧪 Uji tanah">
        {terbaru.length === 0 && (
          <div className="text-xs" style={{ color: 'var(--text2)' }}>
            Belum ada tanah yang diukur. Kertas lakmus atau alat pH murah sudah cukup — yang penting
            angkanya tercatat, supaya syarat pH di katalog akhirnya ada pembandingnya.
          </div>
        )}

        {terbaru.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {r.lokasiLabel}
              </span>
              <span className="text-xs" style={{ color: 'var(--text3)' }}>
                pH {r.ph}
                {r.texture ? ` · tanah ${r.texture}` : ''} · {r.testedDate}
              </span>
            </div>
            <button
              className="px-2 py-1 rounded-lg text-[10px] font-semibold shrink-0"
              style={buttonStyle}
              onClick={() => hapus(r.id)}
            >
              Hapus
            </button>
          </div>
        ))}

        {data.belumDiuji.length > 0 && (
          <div className="text-[11px]" style={{ color: 'var(--text3)' }}>
            Belum diuji: {data.belumDiuji.map((b) => b.lokasiId.replace(/^loc:/, '')).join(', ')}
          </div>
        )}

        {!formTerbuka ? (
          <button
            className="px-3 py-2 rounded-xl text-xs font-semibold self-start"
            style={buttonStyle}
            onClick={() => setFormTerbuka(true)}
          >
            + Catat hasil uji
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              className="px-3 py-2 rounded-xl text-xs outline-none"
              style={inputStyle}
              placeholder="Lokasi, misalnya Bedengan depan"
              value={lokasiId}
              onChange={(e) => setLokasiId(e.target.value)}
              list="soil-lokasi"
            />
            <datalist id="soil-lokasi">
              {data.belumDiuji.map((b) => (
                <option key={b.lokasiId} value={b.lokasiId.replace(/^loc:/, '')} />
              ))}
              {terbaru.map((r) => (
                <option key={r.id} value={r.lokasiLabel} />
              ))}
            </datalist>

            <div className="flex gap-2">
              <input
                className="px-3 py-2 rounded-xl text-xs outline-none flex-1 min-w-0"
                style={inputStyle}
                placeholder="pH, misalnya 6,2"
                inputMode="decimal"
                value={phInput}
                onChange={(e) => setPhInput(e.target.value)}
              />
              <select
                className="px-3 py-2 rounded-xl text-xs outline-none"
                style={inputStyle}
                value={texture}
                onChange={(e) => setTexture(e.target.value)}
              >
                <option value="">Tekstur…</option>
                {data.tekstur.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
              Tekstur menentukan takaran saran: tanah pasir butuh dolomit jauh lebih sedikit
              daripada tanah liat untuk menggeser pH yang sama.
            </div>

            <div className="flex gap-2">
              <button
                className="px-3 py-2 rounded-xl text-xs font-semibold"
                style={buttonStyle}
                onClick={simpan}
              >
                Simpan
              </button>
              <button
                className="px-3 py-2 rounded-xl text-xs"
                style={{ ...buttonStyle, color: 'var(--text3)' }}
                onClick={() => { setFormTerbuka(false); setError(null); }}
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ══════════════════════════ TAB CATATAN ══════════════════════════

/** Perbanyakan: catat stek dan cangkok, lalu lihat metode mana yang berhasil. */
export function PropagationSections({ plantings }: { plantings: PlantingOption[] }) {
  const [data, setData] = useState<PropagationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formTerbuka, setFormTerbuka] = useState(false);
  const [plantId, setPlantId] = useState('');
  const [method, setMethod] = useState('stek');
  const [jumlah, setJumlah] = useState('');

  /** Catatan yang sedang diisi hasilnya; null berarti tidak ada. */
  const [mengisi, setMengisi] = useState<CatatanPerbanyakan | null>(null);
  const [berakar, setBerakar] = useState('');

  const reload = async () => {
    try {
      setData(await apiFetch<PropagationResponse>('/garden/propagation'));
    } catch (err) {
      setError(describeError(err, 'Gagal memuat catatan perbanyakan.'));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const simpan = async () => {
    const n = Number(jumlah);
    if (!Number.isFinite(n) || n < 1) {
      setError('Isi berapa banyak yang dipasang, minimal 1.');
      return;
    }
    if (!plantId) {
      setError('Pilih tanamannya dulu.');
      return;
    }
    try {
      await apiFetch('/garden/propagation', {
        method: 'POST',
        body: JSON.stringify({ plantId, method, countStarted: n }),
      });
      setFormTerbuka(false);
      setPlantId('');
      setJumlah('');
      setError(null);
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan catatan.'));
    }
  };

  const simpanHasil = async () => {
    if (!mengisi) return;
    const n = Number(berakar);
    if (!Number.isFinite(n) || n < 0) {
      setError('Isi berapa yang berakar, boleh 0.');
      return;
    }
    try {
      await apiFetch(`/garden/propagation/${mengisi.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ countRooted: n }),
      });
      setMengisi(null);
      setBerakar('');
      setError(null);
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan hasil.'));
    }
  };

  const hapus = async (id: string) => {
    try {
      await apiFetch(`/garden/propagation/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal menghapus catatan.'));
    }
  };

  if (!data) return null;

  /** Tanaman katalog yang sedang ditanam — sumber pilihan form. */
  const pilihanTanaman = data.saranKatalog.length > 0
    ? data.saranKatalog.map((s) => ({ id: s.plantId, label: `${s.emoji} ${s.nama}` }))
    : plantings.filter((p) => p.plantId).map((p) => ({ id: p.plantId!, label: p.label }));

  const saranTerpilih = data.saranKatalog.find((s) => s.plantId === plantId);

  return (
    <div className="flex flex-col">
      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {data.ringkasan.length > 0 && (
        <Card title="🌿 Metode yang berhasil di kebunmu">
          {data.ringkasan.map((r) => (
            <div key={r.method} className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{r.label}</span>
              <span className="text-xs" style={{ color: 'var(--text3)' }}>
                {r.rate}% berakar · {r.batch} batch · {r.started} pasang
              </span>
            </div>
          ))}
          <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
            Angka dari kebun ini sendiri, bukan dari panduan umum. Batch yang belum dihitung tidak
            ikut menurunkan persennya.
          </div>
        </Card>
      )}

      <Card title="✂️ Perbanyakan">
        {data.catatan.length === 0 && (
          <div className="text-xs" style={{ color: 'var(--text2)' }}>
            Belum ada catatan. Katalog sudah menyimpan cara memperbanyak tiap tanaman; yang belum
            ada adalah catatan apakah caranya berhasil di tanganmu.
          </div>
        )}

        {data.catatan.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2">
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                {c.nama} · {c.methodLabel}
              </span>
              <span className="text-xs" style={{ color: 'var(--text3)' }}>
                {c.countRooted === null
                  ? `${c.countStarted} dipasang ${c.startedDate} · belum dihitung`
                  : `${c.countRooted} dari ${c.countStarted} berakar · ${c.rate}%`}
              </span>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {c.countRooted === null && (
                <button
                  className="px-2 py-1 rounded-lg text-[10px] font-semibold"
                  style={buttonStyle}
                  onClick={() => { setMengisi(c); setBerakar(''); }}
                >
                  Isi hasil
                </button>
              )}
              <button
                className="px-2 py-1 rounded-lg text-[10px] font-semibold"
                style={buttonStyle}
                onClick={() => hapus(c.id)}
              >
                Hapus
              </button>
            </div>
          </div>
        ))}

        {mengisi && (
          <div className="flex flex-col gap-2 pt-1">
            <div className="text-xs" style={{ color: 'var(--text2)' }}>
              {mengisi.nama} — berapa dari {mengisi.countStarted} yang berakar?
            </div>
            <div className="flex gap-2">
              <input
                className="px-3 py-2 rounded-xl text-xs outline-none flex-1 min-w-0"
                style={inputStyle}
                placeholder="0 pun jawaban yang sah"
                inputMode="numeric"
                value={berakar}
                onChange={(e) => setBerakar(e.target.value)}
              />
              <button
                className="px-3 py-2 rounded-xl text-xs font-semibold"
                style={buttonStyle}
                onClick={simpanHasil}
              >
                Simpan
              </button>
              <button
                className="px-3 py-2 rounded-xl text-xs"
                style={{ ...buttonStyle, color: 'var(--text3)' }}
                onClick={() => { setMengisi(null); setError(null); }}
              >
                Batal
              </button>
            </div>
          </div>
        )}

        {!formTerbuka ? (
          <button
            className="px-3 py-2 rounded-xl text-xs font-semibold self-start"
            style={buttonStyle}
            onClick={() => setFormTerbuka(true)}
          >
            + Catat stek / cangkok
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <select
              className="px-3 py-2 rounded-xl text-xs outline-none"
              style={inputStyle}
              value={plantId}
              onChange={(e) => setPlantId(e.target.value)}
            >
              <option value="">Pilih tanaman…</option>
              {pilihanTanaman.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>

            {saranTerpilih && (
              <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
                Katalog: {saranTerpilih.teks}
              </div>
            )}

            <div className="flex gap-2">
              <select
                className="px-3 py-2 rounded-xl text-xs outline-none"
                style={inputStyle}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {(saranTerpilih?.metode.length ? saranTerpilih.metode : data.metodeSah).map((m) => (
                  <option key={m.method} value={m.method}>{m.label}</option>
                ))}
              </select>
              <input
                className="px-3 py-2 rounded-xl text-xs outline-none flex-1 min-w-0"
                style={inputStyle}
                placeholder="Berapa dipasang"
                inputMode="numeric"
                value={jumlah}
                onChange={(e) => setJumlah(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <button
                className="px-3 py-2 rounded-xl text-xs font-semibold"
                style={buttonStyle}
                onClick={simpan}
              >
                Simpan
              </button>
              <button
                className="px-3 py-2 rounded-xl text-xs"
                style={{ ...buttonStyle, color: 'var(--text3)' }}
                onClick={() => { setFormTerbuka(false); setError(null); }}
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Media tanam: yang bukan tanah punya tugas perawatan sendiri. */
export function MediaSection() {
  const [data, setData] = useState<MediaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      setData(await apiFetch<MediaResponse>('/garden/media'));
    } catch (err) {
      setError(describeError(err, 'Gagal memuat media tanam.'));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const ubah = async (plantingId: string, media: string) => {
    try {
      await apiFetch(`/garden/media/${plantingId}`, {
        method: 'PUT',
        body: JSON.stringify({ media }),
      });
      setError(null);
      reload();
    } catch (err) {
      setError(describeError(err, 'Gagal mengubah media.'));
    }
  };

  if (!data || data.daftar.length === 0) return null;

  const adaTugas = data.daftar.some((d) => d.tugas.length > 0);

  return (
    <div className="flex flex-col">
      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      <Card title="🪴 Media tanam">
        {data.daftar.map((d) => (
          <div key={d.plantingId} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold truncate min-w-0" style={{ color: 'var(--text)' }}>
                {d.nama}
              </span>
              <select
                className="px-2 py-1 rounded-lg text-[11px] outline-none shrink-0"
                style={inputStyle}
                value={d.media}
                onChange={(e) => ubah(d.plantingId, e.target.value)}
              >
                {data.pilihan.map((p) => (
                  <option key={p.media} value={p.media}>{p.label}</option>
                ))}
              </select>
            </div>
            {d.tugas.map((t, i) => (
              <div key={i} className="text-[11px] pl-1" style={{ color: 'var(--text2)' }}>· {t}</div>
            ))}
          </div>
        ))}

        {adaTugas && (
          <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
            Hidroponik tidak disiram — akarnya memang selalu di dalam air. Yang perlu dikerjakan
            adalah mengganti larutannya sebelum garamnya menumpuk.
          </div>
        )}
      </Card>
    </div>
  );
}
