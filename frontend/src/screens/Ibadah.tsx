/**
 * Ibadah — jadwal salat, puasa sunnah, dan zakat.
 *
 * Tiga hal dalam satu layar karena ketiganya dibuka pada saat yang sama dan
 * tidak satu pun cukup besar untuk berdiri sendiri. Yang paling sering dilihat
 * ditaruh paling atas: waktu salat berikutnya, lalu puasa besok, baru zakat
 * yang ditengok beberapa kali setahun.
 *
 * Tidak ada panel AI di sini, dan itu disengaja. Waktu salat ditentukan posisi
 * matahari, zakat ditentukan aturan yang tetap, puasa ditentukan kalender
 * Hijriah. Menyerahkan salah satunya ke model bahasa hanya menambah
 * kemungkinan salah pada angka yang seharusnya pasti.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';
import { formatRp } from '@/lib/currency';

type PrayerName = 'subuh' | 'terbit' | 'dzuhur' | 'ashar' | 'maghrib' | 'isya';

const URUTAN_SALAT: PrayerName[] = ['subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];

const LABEL_SALAT: Record<PrayerName, string> = {
  subuh: 'Subuh', terbit: 'Terbit', dzuhur: 'Dzuhur',
  ashar: 'Ashar', maghrib: 'Maghrib', isya: 'Isya',
};

interface Salat {
  perluLokasi?: boolean;
  message?: string;
  date?: string;
  times?: Record<PrayerName, string>;
  berikutnya?: { name: PrayerName; label: string; time: string; inMinutes: number; besok: boolean } | null;
  lokasi?: { label: string | null; latitude: number; longitude: number };
  metode?: { method: string; asrMethod: string; adjust: Partial<Record<PrayerName, number>> };
  catatan?: string;
}

interface HariPuasa {
  date: string;
  kinds: string[];
  labels: string[];
  dayName: string;
  hijri: string;
  sudahDicatat: boolean;
}

interface Puasa {
  today: { date: string; kinds: Array<{ kind: string; label: string }>; sudahDicatat: boolean };
  mendatang: HariPuasa[];
  ringkasan: {
    total: number;
    seninKamisBerturut: number;
    perJenis: Array<{ kind: string; label: string; jumlah: number }>;
  };
  riwayat: Array<{ fast_date: string; kind: string; note: string | null }>;
}

interface Zakat {
  pengaturan: {
    hargaPerGram: number; jenisNisab: 'emas' | 'perak'; gramNisab: number;
    kadar: number; haulStartDate: string | null; pengurangPenghasilan: number;
    hargaDiperbaruiPada: string | null;
  };
  sumber: { kas: string; asetLain: string | null; utang: string | null; penghasilan: string };
  maal: { hartaBersih: number; nisabRupiah: number; wajib: boolean; zakat: number; kurang: number };
  penghasilan: { dasar: number; nisabBulanan: number; wajib: boolean; zakat: number; rataBulanan: number };
  haul: { mulai: string; jatuhTempo: string; sisaHari: number; jatuhTempoHariIni: boolean; sudahLewat: boolean } | null;
  riwayat: Array<{
    id: string; kind: string; amount_idr: number; paid_date: string;
    recipient: string | null; note: string | null;
  }>;
  perluHargaLogam: boolean;
}

/** "1 jam 20 menit" dari menit, karena "80 menit" tidak dibaca sebagai waktu. */
function sisaWaktu(menit: number): string {
  if (menit < 60) return `${menit} menit lagi`;
  const jam = Math.floor(menit / 60);
  const sisa = menit % 60;
  return sisa === 0 ? `${jam} jam lagi` : `${jam} jam ${sisa} menit lagi`;
}

function tanggalPendek(iso: string): string {
  const [, b, t] = iso.split('-');
  const bulan = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${Number(t)} ${bulan[Number(b)] ?? ''}`;
}

export function Ibadah() {
  const { goBack } = useUIStore();

  const [salat, setSalat] = useState<Salat | null>(null);
  const [puasa, setPuasa] = useState<Puasa | null>(null);
  const [zakat, setZakat] = useState<Zakat | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [aturSalat, setAturSalat] = useState(false);
  const [aturZakat, setAturZakat] = useState(false);
  const [bukaBayar, setBukaBayar] = useState(false);

  // Formulir pengaturan zakat, dipisah dari data supaya ketikan tidak hilang
  // tiap kali data dimuat ulang.
  const [harga, setHarga] = useState('');
  const [jenisNisab, setJenisNisab] = useState<'emas' | 'perak'>('emas');
  const [haulMulai, setHaulMulai] = useState('');
  const [pengurang, setPengurang] = useState('');

  const [bayarJenis, setBayarJenis] = useState<'maal' | 'penghasilan'>('maal');
  const [bayarJumlah, setBayarJumlah] = useState('');
  const [bayarPenerima, setBayarPenerima] = useState('');

  const load = async () => {
    try {
      const [s, p, z] = await Promise.all([
        apiFetch<Salat>('/ibadah/salat'),
        apiFetch<Puasa>('/ibadah/puasa'),
        apiFetch<Zakat>('/ibadah/zakat'),
      ]);
      setSalat(s);
      setPuasa(p);
      setZakat(z);
      setHarga(z.pengaturan.hargaPerGram ? String(z.pengaturan.hargaPerGram) : '');
      setJenisNisab(z.pengaturan.jenisNisab);
      setHaulMulai(z.pengaturan.haulStartDate ?? '');
      setPengurang(z.pengaturan.pengurangPenghasilan ? String(z.pengaturan.pengurangPenghasilan) : '');
      setError('');
    } catch {
      setError('Gagal memuat data ibadah.');
    }
  };

  useEffect(() => { load(); }, []);

  const simpanZakat = async () => {
    setBusy(true);
    try {
      await apiFetch('/ibadah/zakat', {
        method: 'PUT',
        body: JSON.stringify({
          hargaPerGram: Number(harga.replace(/[^\d]/g, '')) || 0,
          jenisNisab,
          haulStartDate: haulMulai || null,
          pengurangPenghasilan: Number(pengurang.replace(/[^\d]/g, '')) || 0,
        }),
      });
      setAturZakat(false);
      await load();
    } catch {
      setError('Gagal menyimpan pengaturan zakat.');
    }
    setBusy(false);
  };

  const simpanMetodeSalat = async (patch: { method?: string; asrMethod?: string; adjust?: Record<string, number> }) => {
    if (!salat?.metode) return;
    setBusy(true);
    try {
      await apiFetch('/ibadah/salat', {
        method: 'PUT',
        body: JSON.stringify({
          method: patch.method ?? salat.metode.method,
          asrMethod: patch.asrMethod ?? salat.metode.asrMethod,
          adjust: patch.adjust ?? salat.metode.adjust,
        }),
      });
      setSalat(await apiFetch<Salat>('/ibadah/salat'));
    } catch {
      setError('Gagal menyimpan pengaturan jadwal salat.');
    }
    setBusy(false);
  };

  const geserSatu = (nama: PrayerName, delta: number) => {
    const sekarang = { ...(salat?.metode?.adjust ?? {}) } as Record<string, number>;
    const baru = Math.max(-30, Math.min(30, (sekarang[nama] ?? 0) + delta));
    if (baru === 0) delete sekarang[nama];
    else sekarang[nama] = baru;
    simpanMetodeSalat({ adjust: sekarang });
  };

  const tandaiPuasa = async (date: string, kind: string | undefined, sudah: boolean) => {
    setBusy(true);
    try {
      if (sudah) {
        await apiFetch(`/ibadah/puasa/${date}`, { method: 'DELETE' });
      } else {
        await apiFetch('/ibadah/puasa', { method: 'POST', body: JSON.stringify({ date, kind }) });
      }
      setPuasa(await apiFetch<Puasa>('/ibadah/puasa'));
    } catch {
      setError('Gagal menyimpan catatan puasa.');
    }
    setBusy(false);
  };

  const catatBayar = async () => {
    const jumlah = Number(bayarJumlah.replace(/[^\d]/g, ''));
    if (!jumlah) {
      setError('Isi jumlah zakat yang ditunaikan.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/ibadah/zakat/bayar', {
        method: 'POST',
        body: JSON.stringify({ kind: bayarJenis, amount: jumlah, recipient: bayarPenerima.trim() || undefined }),
      });
      setBayarJumlah('');
      setBayarPenerima('');
      setBukaBayar(false);
      setZakat(await apiFetch<Zakat>('/ibadah/zakat'));
    } catch {
      setError('Gagal mencatat pembayaran zakat.');
    }
    setBusy(false);
  };

  const hapusBayar = async (id: string) => {
    setBusy(true);
    try {
      await apiFetch(`/ibadah/zakat/bayar/${id}`, { method: 'DELETE' });
      setZakat(await apiFetch<Zakat>('/ibadah/zakat'));
    } catch {
      setError('Gagal menghapus catatan.');
    }
    setBusy(false);
  };

  const kartu = { background: 'var(--surface)', boxShadow: 'var(--neu-raised)' };
  const inputStyle = {
    background: 'var(--bg)', boxShadow: 'var(--neu-inset)', color: 'var(--text)',
  };

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.gentle}
        className="space-y-4"
      >
        <div className="flex items-center gap-3">
          <button
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text)' }}
            onClick={goBack}
            aria-label="Kembali"
          >
            ←
          </button>
          <div>
            <h1
              className="text-2xl font-extrabold tracking-tight"
              style={{ color: 'var(--text)', letterSpacing: '-0.4px' }}
            >
              Ibadah
            </h1>
            <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
              Jadwal salat, puasa sunnah, dan hitungan zakat
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ ...kartu, color: 'var(--neg)' }}>
            {error}
          </div>
        )}

        {/* ───────────────────────── SALAT ───────────────────────── */}
        <div className="rounded-2xl p-3.5 space-y-3" style={kartu}>
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>Jadwal salat</p>
            {salat?.times && (
              <button
                className="text-[10px] font-semibold"
                style={{ color: 'var(--accent)' }}
                onClick={() => setAturSalat((v) => !v)}
              >
                {aturSalat ? 'Tutup' : 'Sesuaikan'}
              </button>
            )}
          </div>

          {salat?.perluLokasi && (
            <p className="text-[11px]" style={{ color: 'var(--text2)' }}>{salat.message}</p>
          )}

          {salat?.berikutnya && (
            <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--accentSoft)' }}>
              <p className="text-[11px]" style={{ color: 'var(--accent)' }}>
                {salat.berikutnya.besok ? 'Besok' : 'Berikutnya'}
              </p>
              <p className="text-[19px] font-extrabold" style={{ color: 'var(--accent)' }}>
                {salat.berikutnya.label} {salat.berikutnya.time}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--accent)', opacity: 0.85 }}>
                {sisaWaktu(salat.berikutnya.inMinutes)}
              </p>
            </div>
          )}

          {salat?.times && (
            <div className="grid grid-cols-3 gap-2">
              {URUTAN_SALAT.map((nama) => {
                const aktif = salat.berikutnya?.name === nama;
                return (
                  <div
                    key={nama}
                    className="rounded-xl px-2 py-2 text-center"
                    style={{
                      background: 'var(--bg)',
                      boxShadow: aktif ? 'var(--neu-raised-sm)' : 'var(--neu-inset)',
                    }}
                  >
                    <p className="text-[10px]" style={{ color: 'var(--text3)' }}>{LABEL_SALAT[nama]}</p>
                    <p className="text-[15px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>
                      {salat.times![nama]}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {salat?.lokasi && (
            <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
              {salat.lokasi.label ?? `${salat.lokasi.latitude.toFixed(3)}, ${salat.lokasi.longitude.toFixed(3)}`}
              {salat.catatan ? ` · ${salat.catatan}` : ''}
            </p>
          )}

          <AnimatePresence initial={false}>
            {aturSalat && salat?.metode && (
              <motion.div {...collapse} className="overflow-hidden">
                <div className="space-y-3 pt-1">
                  <div>
                    <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text2)' }}>
                      Sudut Subuh dan Isya
                    </p>
                    <div className="flex gap-2">
                      {[
                        { id: 'kemenag', label: 'Kemenag 20°/18°' },
                        { id: 'mwl', label: 'MWL 18°/17°' },
                      ].map((m) => (
                        <button
                          key={m.id}
                          className="flex-1 text-[10px] px-2 py-2 rounded-lg font-semibold"
                          style={
                            salat.metode!.method === m.id
                              ? { background: 'var(--accentFill)', color: '#fff', boxShadow: 'var(--neu-raised-sm)' }
                              : { background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-inset)' }
                          }
                          onClick={() => simpanMetodeSalat({ method: m.id })}
                          disabled={busy}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text2)' }}>
                      Ashar
                    </p>
                    <div className="flex gap-2">
                      {[
                        { id: 'syafii', label: 'Syafi’i' },
                        { id: 'hanafi', label: 'Hanafi' },
                      ].map((m) => (
                        <button
                          key={m.id}
                          className="flex-1 text-[10px] px-2 py-2 rounded-lg font-semibold"
                          style={
                            salat.metode!.asrMethod === m.id
                              ? { background: 'var(--accentFill)', color: '#fff', boxShadow: 'var(--neu-raised-sm)' }
                              : { background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-inset)' }
                          }
                          onClick={() => simpanMetodeSalat({ asrMethod: m.id })}
                          disabled={busy}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text2)' }}>
                      Geser menit agar sama dengan masjid setempat
                    </p>
                    <div className="space-y-1.5">
                      {URUTAN_SALAT.map((nama) => {
                        const geser = salat.metode!.adjust[nama] ?? 0;
                        return (
                          <div key={nama} className="flex items-center justify-between">
                            <span className="text-[11px]" style={{ color: 'var(--text2)' }}>
                              {LABEL_SALAT[nama]}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                className="w-7 h-7 rounded-lg text-[13px] font-bold"
                                style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text)' }}
                                onClick={() => geserSatu(nama, -1)}
                                disabled={busy}
                                aria-label={`Majukan ${LABEL_SALAT[nama]} satu menit`}
                              >
                                −
                              </button>
                              <span
                                className="text-[11px] font-bold tabular-nums w-10 text-center"
                                style={{ color: geser === 0 ? 'var(--text3)' : 'var(--accent)' }}
                              >
                                {geser > 0 ? `+${geser}` : geser}
                              </span>
                              <button
                                className="w-7 h-7 rounded-lg text-[13px] font-bold"
                                style={{ background: 'var(--bg)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text)' }}
                                onClick={() => geserSatu(nama, 1)}
                                disabled={busy}
                                aria-label={`Mundurkan ${LABEL_SALAT[nama]} satu menit`}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ───────────────────────── PUASA ───────────────────────── */}
        <div className="rounded-2xl p-3.5 space-y-3" style={kartu}>
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>Puasa sunnah</p>
            {puasa && puasa.ringkasan.total > 0 && (
              <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                {puasa.ringkasan.total} hari tercatat
                {puasa.ringkasan.seninKamisBerturut > 1
                  ? ` · ${puasa.ringkasan.seninKamisBerturut} pekan berturut`
                  : ''}
              </p>
            )}
          </div>

          {puasa && puasa.today.kinds.length > 0 && (
            <div
              className="rounded-xl px-3 py-2.5 flex items-center justify-between gap-3"
              style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
            >
              <div>
                <p className="text-[12px] font-bold" style={{ color: 'var(--text)' }}>
                  Hari ini {puasa.today.kinds.map((k) => k.label).join(' · ')}
                </p>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                  {puasa.today.sudahDicatat ? 'Sudah dicatat' : 'Belum dicatat'}
                </p>
              </div>
              <button
                className="text-[10px] px-3 py-2 rounded-lg font-semibold flex-shrink-0"
                style={
                  puasa.today.sudahDicatat
                    ? { background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }
                    : { background: 'var(--accentFill)', color: '#fff', boxShadow: 'var(--neu-raised-sm)' }
                }
                onClick={() =>
                  tandaiPuasa(puasa.today.date, puasa.today.kinds[0]?.kind, puasa.today.sudahDicatat)
                }
                disabled={busy}
              >
                {puasa.today.sudahDicatat ? 'Batalkan' : 'Catat'}
              </button>
            </div>
          )}

          {puasa && puasa.mendatang.length > 0 && (
            <div className="space-y-1.5">
              {puasa.mendatang.slice(0, 8).map((h) => (
                <button
                  key={h.date}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left"
                  style={{
                    background: 'var(--bg)',
                    boxShadow: h.sudahDicatat ? 'var(--neu-raised-sm)' : 'var(--neu-inset)',
                  }}
                  onClick={() => tandaiPuasa(h.date, h.kinds[0], h.sudahDicatat)}
                  disabled={busy}
                >
                  <div>
                    <p className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                      {h.dayName}, {tanggalPendek(h.date)} · {h.labels.join(' · ')}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--text3)' }}>{h.hijri}</p>
                  </div>
                  <span
                    className="text-[10px] font-bold flex-shrink-0"
                    style={{ color: h.sudahDicatat ? 'var(--pos)' : 'var(--text3)' }}
                  >
                    {h.sudahDicatat ? '✓' : 'catat'}
                  </span>
                </button>
              ))}
            </div>
          )}

          <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
            Tanggal Hijriah dihitung secara tabular, jadi bisa berbeda satu hari dari penetapan pemerintah.
          </p>
        </div>

        {/* ───────────────────────── ZAKAT ───────────────────────── */}
        <div className="rounded-2xl p-3.5 space-y-3" style={kartu}>
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>Zakat</p>
            <button
              className="text-[10px] font-semibold"
              style={{ color: 'var(--accent)' }}
              onClick={() => setAturZakat((v) => !v)}
            >
              {aturZakat ? 'Tutup' : 'Pengaturan'}
            </button>
          </div>

          {zakat?.perluHargaLogam && (
            <p className="text-[11px]" style={{ color: 'var(--text2)' }}>
              Nisab butuh harga {zakat.pengaturan.jenisNisab} per gram hari ini. Harganya berubah tiap hari
              dan tidak diambil otomatis — isi di Pengaturan.
            </p>
          )}

          {zakat && !zakat.perluHargaLogam && (
            <div className="space-y-2">
              <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                  Zakat maal · harta bersih {formatRp(zakat.maal.hartaBersih)}
                </p>
                {zakat.maal.wajib ? (
                  <p className="text-[19px] font-extrabold" style={{ color: 'var(--text)' }}>
                    {formatRp(zakat.maal.zakat)}
                  </p>
                ) : (
                  <p className="text-[12px] font-semibold" style={{ color: 'var(--text2)' }}>
                    Belum mencapai nisab — kurang {formatRp(zakat.maal.kurang)}
                  </p>
                )}
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                  Nisab {zakat.pengaturan.gramNisab} gram {zakat.pengaturan.jenisNisab} = {formatRp(zakat.maal.nisabRupiah)}
                </p>
              </div>

              <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                  Zakat penghasilan · {zakat.sumber.penghasilan} {formatRp(zakat.penghasilan.rataBulanan)}/bulan
                </p>
                {zakat.penghasilan.wajib ? (
                  <p className="text-[17px] font-extrabold" style={{ color: 'var(--text)' }}>
                    {formatRp(zakat.penghasilan.zakat)}<span className="text-[11px] font-semibold">/bulan</span>
                  </p>
                ) : (
                  <p className="text-[12px] font-semibold" style={{ color: 'var(--text2)' }}>
                    Di bawah nisab bulanan {formatRp(zakat.penghasilan.nisabBulanan)}
                  </p>
                )}
              </div>

              {zakat.haul && (
                <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                  Haul mulai {tanggalPendek(zakat.haul.mulai)}, genap {tanggalPendek(zakat.haul.jatuhTempo)} —{' '}
                  {zakat.haul.jatuhTempoHariIni
                    ? 'jatuh tempo hari ini'
                    : zakat.haul.sudahLewat
                      ? `lewat ${Math.abs(zakat.haul.sisaHari)} hari`
                      : `${zakat.haul.sisaHari} hari lagi`}
                </p>
              )}

              <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                Kas dari {zakat.sumber.kas.toLowerCase()}
                {zakat.sumber.asetLain ? `; aset lain dari ${zakat.sumber.asetLain.toLowerCase()}` : ''}.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              className="flex-1 text-[11px] px-3 py-2.5 rounded-xl font-semibold"
              style={{ background: 'var(--accentFill)', color: '#fff', boxShadow: 'var(--neu-raised-sm)' }}
              onClick={() => setBukaBayar((v) => !v)}
            >
              {bukaBayar ? 'Tutup' : 'Catat zakat ditunaikan'}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {bukaBayar && (
              <motion.div {...collapse} className="overflow-hidden">
                <div className="space-y-2 pt-1">
                  <div className="flex gap-2">
                    {(['maal', 'penghasilan'] as const).map((k) => (
                      <button
                        key={k}
                        className="flex-1 text-[10px] px-2 py-2 rounded-lg font-semibold capitalize"
                        style={
                          bayarJenis === k
                            ? { background: 'var(--accentFill)', color: '#fff', boxShadow: 'var(--neu-raised-sm)' }
                            : { background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-inset)' }
                        }
                        onClick={() => setBayarJenis(k)}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                  <input
                    className="w-full text-[12px] px-3 py-2.5 rounded-xl outline-none"
                    style={inputStyle}
                    inputMode="numeric"
                    placeholder="Jumlah (Rp)"
                    value={bayarJumlah}
                    onChange={(e) => setBayarJumlah(e.target.value)}
                  />
                  <input
                    className="w-full text-[12px] px-3 py-2.5 rounded-xl outline-none"
                    style={inputStyle}
                    placeholder="Penerima (opsional)"
                    value={bayarPenerima}
                    onChange={(e) => setBayarPenerima(e.target.value)}
                  />
                  <button
                    className="w-full text-[11px] px-3 py-2.5 rounded-xl font-semibold"
                    style={{ background: 'var(--accentFill)', color: '#fff', boxShadow: 'var(--neu-raised-sm)' }}
                    onClick={catatBayar}
                    disabled={busy}
                  >
                    Simpan
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {aturZakat && (
              <motion.div {...collapse} className="overflow-hidden">
                <div className="space-y-2 pt-1">
                  <div className="flex gap-2">
                    {(['emas', 'perak'] as const).map((j) => (
                      <button
                        key={j}
                        className="flex-1 text-[10px] px-2 py-2 rounded-lg font-semibold"
                        style={
                          jenisNisab === j
                            ? { background: 'var(--accentFill)', color: '#fff', boxShadow: 'var(--neu-raised-sm)' }
                            : { background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-inset)' }
                        }
                        onClick={() => setJenisNisab(j)}
                      >
                        Nisab {j} {j === 'emas' ? '85' : '595'} gram
                      </button>
                    ))}
                  </div>
                  <input
                    className="w-full text-[12px] px-3 py-2.5 rounded-xl outline-none"
                    style={inputStyle}
                    inputMode="numeric"
                    placeholder={`Harga ${jenisNisab} per gram (Rp)`}
                    value={harga}
                    onChange={(e) => setHarga(e.target.value)}
                  />
                  {zakat?.pengaturan.hargaDiperbaruiPada && (
                    <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                      Harga terakhir diperbarui {tanggalPendek(zakat.pengaturan.hargaDiperbaruiPada)}.
                    </p>
                  )}
                  <label className="block text-[10px]" style={{ color: 'var(--text3)' }}>
                    Tanggal harta mencapai nisab (awal haul)
                    <input
                      className="w-full text-[12px] px-3 py-2.5 rounded-xl outline-none mt-1"
                      style={inputStyle}
                      type="date"
                      value={haulMulai}
                      onChange={(e) => setHaulMulai(e.target.value)}
                    />
                  </label>
                  <input
                    className="w-full text-[12px] px-3 py-2.5 rounded-xl outline-none"
                    style={inputStyle}
                    inputMode="numeric"
                    placeholder="Pengurang penghasilan per bulan (kosong = dari kotor)"
                    value={pengurang}
                    onChange={(e) => setPengurang(e.target.value)}
                  />
                  <button
                    className="w-full text-[11px] px-3 py-2.5 rounded-xl font-semibold"
                    style={{ background: 'var(--accentFill)', color: '#fff', boxShadow: 'var(--neu-raised-sm)' }}
                    onClick={simpanZakat}
                    disabled={busy}
                  >
                    Simpan pengaturan
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {zakat && zakat.riwayat.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[11px] font-semibold" style={{ color: 'var(--text2)' }}>Sudah ditunaikan</p>
              {zakat.riwayat.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between px-3 py-2 rounded-xl"
                  style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
                >
                  <div>
                    <p className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                      {formatRp(r.amount_idr)} · {r.kind}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                      {tanggalPendek(r.paid_date)}{r.recipient ? ` · ${r.recipient}` : ''}
                    </p>
                  </div>
                  <button
                    className="text-[10px] font-semibold flex-shrink-0"
                    style={{ color: 'var(--neg)' }}
                    onClick={() => hapusBayar(r.id)}
                    disabled={busy}
                  >
                    Hapus
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
