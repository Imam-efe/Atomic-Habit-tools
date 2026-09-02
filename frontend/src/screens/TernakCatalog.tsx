/**
 * Tab Katalog — cari dan filter spesies, lalu lihat detailnya.
 *
 * `legal` dan `bahaya` ditampilkan sebagai dua kartu berwarna di ATAS daftar
 * tugas, bukan baris terakhir yang gampang dilewati sambil scroll. Salah
 * satunya soal melanggar hukum (sugar glider, sebagian kura-kura), yang lain
 * soal anak kecil tertular salmonella dari kura-kura brazil — keduanya bukan
 * catatan kaki.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { describeError, inputStyle, buttonStyle, type PilihanSubjek } from './Ternak';

const GRUP_OPTIONS = [
  ['mamalia', 'Mamalia'], ['unggas', 'Unggas'], ['ikan-tawar', 'Ikan air tawar'],
  ['ikan-laut', 'Ikan air laut'], ['reptil', 'Reptil'], ['amfibi', 'Amfibi'],
  ['ternak-besar', 'Ternak besar'], ['serangga', 'Serangga'],
] as const;
const HABITAT_OPTIONS = [
  ['darat', 'Darat'], ['air-tawar', 'Air tawar'], ['air-payau', 'Air payau'], ['air-laut', 'Air laut'],
] as const;
const PERAN_OPTIONS = [['peliharaan', 'Peliharaan'], ['produksi', 'Produksi'], ['keduanya', 'Keduanya']] as const;
const KESULITAN_OPTIONS = [['mudah', 'Mudah'], ['sedang', 'Sedang'], ['sulit', 'Sulit']] as const;

const KESULITAN_COLOR: Record<string, string> = { mudah: 'var(--pos)', sedang: 'var(--warn)', sulit: 'var(--neg)' };

interface HewanRingkas {
  id: string; nama: string; emoji: string; grup: string; habitat: string;
  peran: string; kesulitan: string; jumlahTugas: number;
}

interface TugasKatalog {
  kode: string; nama: string; tiapHari: number; mulaiHari: number;
  sasaran: 'kandang' | 'hewan'; cara: string; penting: boolean;
}

interface AnimalDetail {
  id: string; nama: string; latin: string; grup: string; habitat: string; emoji: string; peran: string;
  umurTahun: [number, number]; dewasaBulan: number | null;
  suhuC: [number, number] | null; phAir: [number, number] | null; salinitasPpt: [number, number] | null;
  ruangMinimal: string; literPerEkor: number | null;
  pakan: string; frekuensiPakan: string; sosial: string;
  tugas: TugasKatalog[]; penyakit: string[]; kesulitan: string;
  legal: string | null; bahaya: string | null; tips: string;
}

export function TernakCatalogTab({
  subjekKandang, onPelihara,
}: {
  subjekKandang: PilihanSubjek[];
  onPelihara: (animal: { id: string; nama: string; emoji: string }, kandangId: string | null) => void;
}) {
  const [q, setQ] = useState('');
  const [grup, setGrup] = useState('');
  const [habitat, setHabitat] = useState('');
  const [peran, setPeran] = useState('');
  const [kesulitan, setKesulitan] = useState('');

  const [hasil, setHasil] = useState<HewanRingkas[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [detail, setDetail] = useState<AnimalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  /**
   * Kandang tujuan — boleh dikosongkan di sini, tapi bukan berarti tidak
   * penting: banyak spesies punya tugas rawat yang menempel ke kandang
   * (ganti air, bersih kandang), bukan ke hewannya. Tanpa kandang, tugas itu
   * tidak dijadwalkan siapa pun sampai kandangnya diisi belakangan.
   */
  const [kandangTujuan, setKandangTujuan] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (grup) params.set('grup', grup);
      if (habitat) params.set('habitat', habitat);
      if (peran) params.set('peran', peran);
      if (kesulitan) params.set('kesulitan', kesulitan);
      const res = await apiFetch<{ hewan: HewanRingkas[] }>(`/ternak/katalog${params.toString() ? `?${params}` : ''}`);
      setHasil(res.hewan);
      setLoadFailed(false);
    } catch {
      // Gagal memuat katalog BUKAN "tidak ada spesies yang cocok" — pesannya
      // harus menawarkan coba lagi, bukan menyarankan mengubah filter yang
      // sebenarnya sudah benar.
      setLoadFailed(true);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [q, grup, habitat, peran, kesulitan]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    setKandangTujuan('');
    try {
      setDetail(await apiFetch<AnimalDetail>(`/ternak/katalog/${id}`));
    } catch (err) {
      setDetailError(describeError(err, 'Gagal memuat detail spesies.'));
    }
    setDetailLoading(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[18px] p-3.5 flex flex-col gap-2" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        <input className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
          placeholder="Cari nama atau nama latin…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <select className="rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} value={grup} onChange={(e) => setGrup(e.target.value)}>
            <option value="">Semua golongan</option>
            {GRUP_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} value={habitat} onChange={(e) => setHabitat(e.target.value)}>
            <option value="">Semua habitat</option>
            {HABITAT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} value={peran} onChange={(e) => setPeran(e.target.value)}>
            <option value="">Semua peran</option>
            {PERAN_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} value={kesulitan} onChange={(e) => setKesulitan(e.target.value)}>
            <option value="">Semua kesulitan</option>
            {KESULITAN_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-14">
          <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : loadFailed ? (
        <div className="flex flex-col items-center justify-center py-14 text-center gap-2">
          <p className="text-3xl">📡</p>
          <p className="font-semibold text-sm" style={{ color: 'var(--text2)' }}>Gagal memuat katalog</p>
          <button className="neu-cta px-4 py-2 rounded-xl text-xs font-bold text-white" style={{ background: 'var(--accentFill)' }} onClick={load}>
            Coba lagi
          </button>
        </div>
      ) : hasil.length === 0 ? (
        <p className="text-xs text-center py-10" style={{ color: 'var(--text3)' }}>Tidak ada spesies yang cocok. Coba ubah filter.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {hasil.map((a) => (
            <motion.button
              key={a.id}
              className="rounded-[16px] p-3 text-left flex flex-col gap-1"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              whileTap={{ scale: 0.97 }}
              transition={springs.snappy}
              onClick={() => openDetail(a.id)}
            >
              <span className="text-xl" aria-hidden>{a.emoji}</span>
              <span className="text-xs font-bold truncate" style={{ color: 'var(--text)' }}>{a.nama}</span>
              <span className="text-[10px]" style={{ color: KESULITAN_COLOR[a.kesulitan] ?? 'var(--text3)' }}>{a.kesulitan}</span>
            </motion.button>
          ))}
        </div>
      )}

      {(detailLoading || detail || detailError) && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          onClick={() => { setDetail(null); setDetailError(''); }}
        >
          <motion.div
            className="w-full max-w-[430px] max-h-[85vh] overflow-y-auto rounded-t-[24px] p-5"
            style={{ background: 'var(--surface)' }}
            initial={{ y: 60 }} animate={{ y: 0 }} transition={springs.gentle}
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading && <p className="text-xs text-center py-8" style={{ color: 'var(--text3)' }}>Memuat…</p>}
            {detailError && (
              <>
                <p className="text-xs mb-3" style={{ color: 'var(--neg)' }}>{detailError}</p>
                <button className="w-full py-2 rounded-xl text-xs font-bold" style={buttonStyle} onClick={() => { setDetail(null); setDetailError(''); }}>Tutup</button>
              </>
            )}
            {detail && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl" aria-hidden>{detail.emoji}</span>
                  <div>
                    <p className="text-lg font-extrabold" style={{ color: 'var(--text)' }}>{detail.nama}</p>
                    <p className="text-[11px] italic" style={{ color: 'var(--text3)' }}>{detail.latin}</p>
                  </div>
                </div>

                {/* Legal dan bahaya menonjol, sebelum apa pun yang lain —
                    inilah yang menentukan boleh-tidaknya dan aman-tidaknya
                    dipelihara di rumah. */}
                {detail.legal && (
                  <div className="rounded-xl p-3 border-l-[3px]" style={{ background: 'rgba(255,59,48,0.08)', borderColor: 'var(--neg)' }}>
                    <p className="text-[11px] font-extrabold mb-0.5" style={{ color: 'var(--neg)' }}>⚖️ Status hukum</p>
                    <p className="text-xs" style={{ color: 'var(--text)' }}>{detail.legal}</p>
                  </div>
                )}
                {detail.bahaya && (
                  <div className="rounded-xl p-3 border-l-[3px]" style={{ background: 'rgba(255,159,10,0.1)', borderColor: 'var(--warn)' }}>
                    <p className="text-[11px] font-extrabold mb-0.5" style={{ color: 'var(--warn)' }}>⚠️ Risiko bagi manusia</p>
                    <p className="text-xs" style={{ color: 'var(--text)' }}>{detail.bahaya}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-[11px]" style={{ color: 'var(--text2)' }}>
                  <p>Umur: {detail.umurTahun[0]}–{detail.umurTahun[1]} tahun</p>
                  <p>Kesulitan: <span style={{ color: KESULITAN_COLOR[detail.kesulitan] }}>{detail.kesulitan}</span></p>
                  <p>Ruang: {detail.ruangMinimal}</p>
                  <p>Sosial: {detail.sosial}</p>
                  {detail.suhuC && <p>Suhu air: {detail.suhuC[0]}–{detail.suhuC[1]}°C</p>}
                  {detail.phAir && <p>pH air: {detail.phAir[0]}–{detail.phAir[1]}</p>}
                  {detail.salinitasPpt && <p>Salinitas: {detail.salinitasPpt[0]}–{detail.salinitasPpt[1]} ppt</p>}
                </div>

                <div className="text-[11px]" style={{ color: 'var(--text2)' }}>
                  <p className="font-bold" style={{ color: 'var(--text)' }}>Pakan</p>
                  <p>{detail.pakan} · {detail.frekuensiPakan}</p>
                </div>

                {detail.penyakit.length > 0 && (
                  <div className="text-[11px]" style={{ color: 'var(--text2)' }}>
                    <p className="font-bold" style={{ color: 'var(--text)' }}>Penyakit umum</p>
                    <p>{detail.penyakit.join(', ')}</p>
                  </div>
                )}

                <div>
                  <p className="text-[11px] font-bold mb-1" style={{ color: 'var(--text)' }}>Jadwal rawat ({detail.tugas.length})</p>
                  <div className="flex flex-col gap-1.5">
                    {detail.tugas.map((t) => (
                      <div key={t.kode} className="rounded-lg p-2" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
                        <p className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                          {t.nama} {t.penting && '⚠️'} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· tiap {t.tiapHari} hari</span>
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--text3)' }}>{t.cara}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {detail.tips && (
                  <div className="text-[11px]" style={{ color: 'var(--text2)' }}>
                    <p className="font-bold" style={{ color: 'var(--text)' }}>Tips</p>
                    <p>{detail.tips}</p>
                  </div>
                )}

                {subjekKandang.length > 0 && (
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold" style={{ color: 'var(--text3)' }}>Kandang tujuan</span>
                    <select className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
                      value={kandangTujuan} onChange={(e) => setKandangTujuan(e.target.value)}>
                      <option value="">Belum ditentukan</option>
                      {subjekKandang.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
                    </select>
                    <span className="text-[10px]" style={{ color: 'var(--text3)' }}>
                      Sebagian tugas rawat menempel ke kandang, bukan ke hewannya — tanpa kandang, tugas itu belum terjadwal.
                    </span>
                  </label>
                )}

                <motion.button
                  className="w-full py-3 rounded-xl text-sm font-bold text-white"
                  style={{ background: 'var(--accentFill)' }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    onPelihara({ id: detail.id, nama: detail.nama, emoji: detail.emoji }, kandangTujuan || null);
                    setDetail(null);
                  }}
                >
                  🐾 Pelihara ini
                </motion.button>
                <button className="w-full py-2 rounded-xl text-xs font-bold" style={buttonStyle} onClick={() => setDetail(null)}>Tutup</button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
