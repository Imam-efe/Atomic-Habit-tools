/**
 * Ternak — kandang, hewan, jadwal rawat, dan empat peringatan yang membunuh
 * hewan kalau luput dibaca.
 *
 * Empat berkas sejak awal, bukan satu yang dipecah nanti seperti Garden.tsx
 * (2400+ baris). Berkas ini memuat kerangka bersama — data, antrean offline,
 * peringatan, tab Hari Ini dan Kandang — sementara Hewan, Katalog, dan
 * Kesehatan hidup di berkasnya sendiri dan tampil sebagai tab di sini.
 *
 * `PilihanSubjek` diekspor supaya ketiga tab lain memakai satu bentuk yang
 * sama untuk "pilih kandang atau hewan" — dropdown pindah kandang di Hewan,
 * dropdown kandang di formulir tambah hewan dari Katalog, dan dropdown
 * hewan/kandang di formulir ukur/tes air Kesehatan semuanya dibangun dari
 * daftar yang sama, bukan masing-masing menyusun sendiri dengan aturan
 * penyaringan yang bisa diam-diam berbeda.
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/date';
import { isNetworkError, newClientId, queueFor } from '@/lib/offlineQueue';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { AiPanel } from '@/components/AiPanel';
import { TernakAnimalsTab } from './TernakAnimals';
import { TernakCatalogTab } from './TernakCatalog';
import { TernakHealthTab } from './TernakHealth';

// ─────────────────────────── TIPE BERSAMA ───────────────────────────

/** Subjek generik — kandang atau hewan — dipakai tiga tab lain sebagai bentuk dropdown. */
export interface PilihanSubjek {
  tipe: 'kandang' | 'hewan';
  id: string;
  nama: string;
}

export interface KandangItem {
  id: string;
  nama: string;
  jenis: string;
  habitat: string;
  volumeLiter: number | null;
  lokasi: string | null;
  tanggalMulai: string;
  status: string;
  jumlahPenghuni: number;
}

export interface HewanItem {
  id: string;
  kandangId: string | null;
  animalId: string | null;
  nama: string;
  emoji: string;
  jumlah: number;
  status: string;
  tanggalMasuk: string;
  kesulitan: string | null;
  /** true = spesiesnya punya tugas bersasaran kandang tapi hewan ini belum punya kandang, jadi tugas itu dorman. */
  tugasKandangDorman: boolean;
  /** true = di antara tugas dorman itu, ada minimal satu yang `penting` — kelalaiannya bisa berujung mati. */
  tugasKandangDormanPenting: boolean;
}

interface TernakResponse {
  today: string;
  kandang: KandangItem[];
  hewan: HewanItem[];
  ringkasan: { kandangAktif: number; hewanHidup: number; ekorTotal: number };
}

export interface TugasJadwal {
  subjekTipe: 'kandang' | 'hewan';
  subjekId: string;
  nama: string;
  kodeTugas: string;
  labelTugas: string;
  cara: string;
  penting: boolean;
  berikutnya: string;
  telat: number;
  sumberInterval: 'katalog' | 'ubahan';
}

interface JadwalResponse {
  today: string;
  tugas: TugasJadwal[];
  jatuhTempo: TugasJadwal[];
  penting: TugasJadwal[];
}

export interface KepadatanItem {
  kandangId: string;
  nama: string;
  volumeLiter: number;
  butuhLiter: number;
  tersedia: number;
  kelebihan: number;
  sesak: boolean;
}

export interface KarantinaItem {
  hewanId: string;
  kandangId: string;
  nama: string;
  tanggalMasuk: string;
  selesai: string;
  sisaHari: number;
}

export const JENIS_KANDANG_OPTIONS = ['akuarium', 'kandang', 'kolam', 'umbaran'] as const;
export const HABITAT_OPTIONS = ['darat', 'air-tawar', 'air-payau', 'air-laut'] as const;
export const STATUS_HEWAN_OPTIONS = ['hidup', 'mati', 'dilepas', 'dijual'] as const;

export const HABITAT_LABEL: Record<string, string> = {
  darat: 'Darat', 'air-tawar': 'Air tawar', 'air-payau': 'Air payau', 'air-laut': 'Air laut',
};
export const JENIS_KANDANG_LABEL: Record<string, string> = {
  akuarium: 'Akuarium', kandang: 'Kandang', kolam: 'Kolam', umbaran: 'Umbaran',
};
export const STATUS_HEWAN_LABEL: Record<string, string> = {
  hidup: 'Hidup', mati: 'Mati', dilepas: 'Dilepas', dijual: 'Dijual',
};

export const describeError = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? (err.body.message ?? err.body.error ?? fallback) : 'Terjadi kesalahan jaringan.';

export const inputStyle = { background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' } as const;
export const buttonStyle = { background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' } as const;

const TABS = [
  ['hari-ini', '📋', 'Hari Ini'],
  ['kandang', '🏠', 'Kandang'],
  ['hewan', '🐾', 'Hewan'],
  ['kesehatan', '❤️‍🩹', 'Kesehatan'],
  ['katalog', '📖', 'Katalog'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function TernakScreen() {
  const { goBack } = useUIStore();
  const userId = useAuthStore((s) => s.session?.user.id ?? '');
  const queue = useMemo(() => queueFor(userId), [userId]);
  const [pendingWrites, setPendingWrites] = useState(0);
  useEffect(() => { setPendingWrites(queue.size()); }, [queue]);

  const [tab, setTab] = useState<Tab>('hari-ini');
  const [data, setData] = useState<TernakResponse | null>(null);
  const [jadwal, setJadwal] = useState<JadwalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  /** Muat terakhir gagal — dibedakan tegas dari ternak yang memang belum diisi. */
  const [loadFailed, setLoadFailed] = useState(false);

  // Peringatan tambahan. Masing-masing gagal sendiri-sendiri: satu kandang
  // yang gagal dites amonianya tidak boleh menyembunyikan peringatan
  // kepadatan atau karantina yang berhasil dimuat.
  const [kepadatan, setKepadatan] = useState<KepadatanItem[]>([]);
  const [karantina, setKarantina] = useState<KarantinaItem[]>([]);
  const [amoniaKandang, setAmoniaKandang] = useState<{ kandangId: string; nama: string }[]>([]);
  // Gagal dimuat HARUS beda tampilannya dari "sudah dicek, tidak ada masalah"
  // — kalau tidak, kandang yang amonianya belum sempat dites akan terlihat
  // sama amannya dengan kandang yang sungguh sudah dites dan bersih.
  const [kepadatanError, setKepadatanError] = useState(false);
  const [karantinaError, setKarantinaError] = useState(false);
  const [amoniaError, setAmoniaError] = useState(false);

  /** Baris jadwal yang carany-nya sedang dibuka, keyed subjekTipe|subjekId|kodeTugas. */
  const [openCara, setOpenCara] = useState<string | null>(null);
  /** Baris yang sedang dicatat — dipakai supaya tombolnya tidak bisa diketuk dobel. */
  const [logging, setLogging] = useState<string | null>(null);
  const [logError, setLogError] = useState('');

  /** Diisi tombol "Pelihara ini" di Katalog; dibaca oleh tab Hewan untuk membuka formulirnya. */
  const [prefillHewan, setPrefillHewan] = useState<
    { animalId: string; nama: string; emoji: string; kandangId: string | null } | null
  >(null);
  /** Subjek yang harus disorot begitu tab tujuannya terbuka, dari peringatan atau baris jadwal. */
  const [focus, setFocus] = useState<PilihanSubjek | null>(null);

  const loadKepadatan = async () => {
    try {
      setKepadatan((await apiFetch<{ kepadatan: KepadatanItem[] }>('/ternak/kepadatan')).kepadatan);
      setKepadatanError(false);
    } catch {
      setKepadatan([]);
      setKepadatanError(true);
    }
  };

  const loadKarantina = async () => {
    try {
      setKarantina((await apiFetch<{ today: string; karantina: KarantinaItem[] }>('/ternak/karantina')).karantina);
      setKarantinaError(false);
    } catch {
      setKarantina([]);
      setKarantinaError(true);
    }
  };

  /**
   * Amonia hanya kelihatan dari tes air TERAKHIR tiap kandang berair — tidak
   * ada endpoint ringkas untuk semua kandang sekaligus, jadi diambil
   * satu-satu. Kandang yang gagal dites tidak menyembunyikan kandang lain
   * yang berhasil.
   */
  const loadAmonia = async (kandang: KandangItem[]) => {
    const berair = kandang.filter((k) => k.habitat !== 'darat' && k.status === 'aktif');
    let gagal = false;
    const hasil = await Promise.all(
      berair.map(async (k) => {
        try {
          const res = await apiFetch<{ air: Array<{ penilaian: Array<{ parameter: string; status: string }> }> }>(
            `/ternak/air/${k.id}`
          );
          const terakhir = res.air[0];
          const bahaya = terakhir?.penilaian.some((p) => p.parameter === 'amonia' && p.status === 'bahaya');
          return bahaya ? { kandangId: k.id, nama: k.nama } : null;
        } catch {
          // Satu kandang yang gagal dicek tidak boleh diam-diam terlihat
          // seaman kandang yang benar-benar sudah dites dan bersih.
          gagal = true;
          return null;
        }
      })
    );
    setAmoniaKandang(hasil.filter((x): x is { kandangId: string; nama: string } => x !== null));
    setAmoniaError(gagal);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [t, j] = await Promise.all([
        apiFetch<TernakResponse>('/ternak'),
        apiFetch<JadwalResponse>('/ternak/jadwal?hari=14'),
      ]);
      setData(t);
      setJadwal(j);
      setLoadFailed(false);
      // Tidak menunggu (`void`): peringatan tambahan ini boleh menyusul
      // belakangan tanpa membuat layar utama menunggu tiga panggilan lagi.
      void loadKepadatan();
      void loadKarantina();
      void loadAmonia(t.kandang);
    } catch {
      // Gagal muat TIDAK boleh terlihat seperti "belum ada ternak" — itu
      // persis bug yang pernah ada di Kebun, dan di sini taruhannya nyawa
      // hewan: pengguna yang mengira datanya hilang akan mendaftarkan ulang
      // hewan yang sebenarnya masih ada di server, jadi dobel.
      setLoadFailed(true);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const onShown = (e: Event) => {
      if ((e as CustomEvent).detail === 'ternak') load();
    };
    window.addEventListener('fayolla:tab-shown', onShown);
    return () => window.removeEventListener('fayolla:tab-shown', onShown);
  }, []);

  // Kirim ulang catatan yang tertahan begitu jaringan kembali — pola sama
  // dengan Kebun.
  useEffect(() => {
    let cancelled = false;
    const flush = async () => {
      if (queue.size() === 0) return;
      const result = await queue.flush((path, body) =>
        apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
      );
      if (cancelled) return;
      setPendingWrites(result.remaining);
      if (result.sent > 0) load();
    };
    flush();
    window.addEventListener('online', flush);
    return () => { cancelled = true; window.removeEventListener('online', flush); };
  }, [queue]);

  /** Catat sekali ketuk dari baris jadwal. Gagal jaringan masuk antrean, bukan hilang. */
  const catatTugas = async (t: TugasJadwal) => {
    const kunci = `${t.subjekTipe}|${t.subjekId}|${t.kodeTugas}`;
    setLogging(kunci);
    setLogError('');
    const clientId = newClientId();
    const path = '/ternak/log';
    const body = { subjekTipe: t.subjekTipe, subjekId: t.subjekId, kodeTugas: t.kodeTugas, tanggal: todayISO() };
    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify({ ...body, clientId }) });
      await load();
    } catch (err) {
      if (isNetworkError(err)) {
        queue.enqueue({ clientId, path, body, queuedAt: Date.now() });
        setPendingWrites(queue.size());
      } else {
        setLogError(describeError(err, `Gagal mencatat ${t.labelTugas}.`));
      }
    }
    setLogging(null);
  };

  // Bentuk seragam untuk semua dropdown "pilih kandang/hewan" di tiga tab lain.
  const subjekKandang: PilihanSubjek[] = (data?.kandang ?? []).map((k) => ({ tipe: 'kandang', id: k.id, nama: k.nama }));
  const subjekHewan: PilihanSubjek[] = (data?.hewan ?? [])
    .filter((h) => h.status === 'hidup')
    .map((h) => ({ tipe: 'hewan', id: h.id, nama: h.nama }));

  const gotoFocus = (subjek: PilihanSubjek, tujuan: Tab) => {
    setFocus(subjek);
    setTab(tujuan);
  };

  const handlePelihara = (animal: { id: string; nama: string; emoji: string }, kandangId: string | null) => {
    setPrefillHewan({ animalId: animal.id, nama: animal.nama, emoji: animal.emoji, kandangId });
    setTab('hewan');
  };

  // ─────────────────────────── KANDANG: form tambah/ubah ───────────────────────────
  const [kandangForm, setKandangForm] = useState<{
    id: string | null; nama: string; jenis: string; habitat: string;
    volumeLiter: string; lokasi: string; tanggalMulai: string;
  } | null>(null);
  const [kandangSaving, setKandangSaving] = useState(false);
  const [kandangError, setKandangError] = useState('');

  const openTambahKandang = () => {
    setKandangForm({ id: null, nama: '', jenis: 'akuarium', habitat: 'air-tawar', volumeLiter: '', lokasi: '', tanggalMulai: todayISO() });
    setKandangError('');
  };
  const openUbahKandang = (k: KandangItem) => {
    setKandangForm({
      id: k.id, nama: k.nama, jenis: k.jenis, habitat: k.habitat,
      volumeLiter: k.volumeLiter?.toString() ?? '', lokasi: k.lokasi ?? '', tanggalMulai: k.tanggalMulai,
    });
    setKandangError('');
  };

  const simpanKandang = async () => {
    if (!kandangForm) return;
    const nama = kandangForm.nama.trim();
    if (!nama) { setKandangError('Nama kandang wajib diisi.'); return; }
    setKandangSaving(true);
    setKandangError('');
    try {
      const body = {
        nama, jenis: kandangForm.jenis, habitat: kandangForm.habitat,
        volumeLiter: kandangForm.volumeLiter ? Number(kandangForm.volumeLiter) : undefined,
        lokasi: kandangForm.lokasi.trim() || undefined,
        tanggalMulai: kandangForm.tanggalMulai,
      };
      if (kandangForm.id) {
        await apiFetch(`/ternak/kandang/${kandangForm.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiFetch('/ternak/kandang', { method: 'POST', body: JSON.stringify(body) });
      }
      setKandangForm(null);
      await load();
    } catch (err) {
      setKandangError(describeError(err, 'Gagal menyimpan kandang.'));
    }
    setKandangSaving(false);
  };

  const hapusKandang = async (id: string) => {
    if (!confirm('Hapus kandang ini? Hewan di dalamnya tidak ikut terhapus, tapi jadi tanpa kandang.')) return;
    try {
      await apiFetch(`/ternak/kandang/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setKandangError(describeError(err, 'Gagal menghapus kandang.'));
    }
  };

  const summary = data?.ringkasan;

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      <div className="flex items-center gap-3 mb-5">
        <button
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text)' }}
          onClick={goBack}
          aria-label="Kembali"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.4px' }}>
            Ternak
          </h1>
          <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
            Hewan peliharaan & ternak: jadwal rawat, kandang, tes air
          </p>
          {pendingWrites > 0 && (
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--warn)' }}>
              📴 {pendingWrites} catatan menunggu jaringan — akan terkirim otomatis
            </p>
          )}
        </div>
      </div>

      <AiPanel
        module="ternak"
        suggestions={['Apa yang harus dikerjakan hari ini?', 'Kandang mana yang paling berisiko?']}
        onChanged={() => load()}
      />

      {summary && (summary.kandangAktif > 0 || summary.hewanHidup > 0) && (
        <div className="grid grid-cols-3 gap-2 mt-4 mb-4">
          {[
            { label: 'Kandang', value: summary.kandangAktif },
            { label: 'Jenis hewan', value: summary.hewanHidup },
            { label: 'Ekor', value: summary.ekorTotal },
          ].map((s) => (
            <div key={s.label} className="rounded-[14px] py-2.5 text-center"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
              <p className="text-lg font-black" style={{ color: 'var(--text)' }}>{s.value}</p>
              <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-5 gap-1 p-1 rounded-xl mb-4"
        style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        {TABS.map(([id, emoji, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="py-2.5 rounded-lg text-center flex flex-col items-center gap-0.5"
            style={{ background: tab === id ? 'var(--bg)' : 'transparent' }}
            title={label}
          >
            <span className="text-base">{emoji}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : loadFailed && !data ? (
        /* Gagal memuat BUKAN "belum ada ternak". Layar kosong yang sebenarnya
           akan mengajak menambah hewan; layar ini justru harus mencegah
           penambahan ulang selagi data lama masih di server. */
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-4xl">📡</p>
          <p className="font-semibold text-sm" style={{ color: 'var(--text2)' }}>Gagal memuat ternak</p>
          <p className="text-xs mb-2" style={{ color: 'var(--text3)' }}>
            Data kandang dan hewanmu aman di server — ini cuma gagal mengambilnya.
          </p>
          <button
            className="neu-cta px-4 py-2 rounded-xl text-xs font-bold text-white"
            style={{ background: 'var(--accentFill)' }}
            onClick={load}
          >
            Coba lagi
          </button>
        </div>
      ) : tab === 'hari-ini' ? (
        <HariIniTab
          data={data}
          jadwal={jadwal}
          kepadatan={kepadatan}
          karantina={karantina}
          amoniaKandang={amoniaKandang}
          kepadatanError={kepadatanError}
          karantinaError={karantinaError}
          amoniaError={amoniaError}
          openCara={openCara}
          setOpenCara={setOpenCara}
          logging={logging}
          logError={logError}
          onCatat={catatTugas}
          onFocusKandang={(id, nama) => gotoFocus({ tipe: 'kandang', id, nama }, 'kandang')}
          onFocusHewan={(id, nama) => gotoFocus({ tipe: 'hewan', id, nama }, 'hewan')}
          onFocusKesehatan={(id, nama, jenis) => gotoFocus({ tipe: jenis, id, nama }, 'kesehatan')}
        />
      ) : tab === 'kandang' ? (
        <KandangTab
          kandang={data?.kandang ?? []}
          hewan={data?.hewan ?? []}
          focus={focus}
          onClearFocus={() => setFocus(null)}
          form={kandangForm}
          setForm={setKandangForm}
          saving={kandangSaving}
          error={kandangError}
          onTambah={openTambahKandang}
          onUbah={openUbahKandang}
          onSimpan={simpanKandang}
          onBatal={() => setKandangForm(null)}
          onHapus={hapusKandang}
        />
      ) : tab === 'hewan' ? (
        <TernakAnimalsTab
          hewan={data?.hewan ?? []}
          subjekKandang={subjekKandang}
          prefill={prefillHewan}
          clearPrefill={() => setPrefillHewan(null)}
          focus={focus?.tipe === 'hewan' ? focus : null}
          clearFocus={() => setFocus(null)}
          onChanged={load}
        />
      ) : tab === 'kesehatan' ? (
        <TernakHealthTab
          hewan={data?.hewan ?? []}
          kandang={data?.kandang ?? []}
          subjekHewan={subjekHewan}
          subjekKandang={subjekKandang}
          kepadatan={kepadatan}
          karantina={karantina}
          focus={focus}
          clearFocus={() => setFocus(null)}
          onChanged={load}
        />
      ) : (
        <TernakCatalogTab subjekKandang={subjekKandang} onPelihara={handlePelihara} />
      )}
    </div>
  );
}

// ─────────────────────────── TAB HARI INI ───────────────────────────

function relativeTelat(telat: number): string {
  if (telat === 0) return 'hari ini';
  return `telat ${telat} hari`;
}

function HariIniTab({
  data, jadwal, kepadatan, karantina, amoniaKandang,
  kepadatanError, karantinaError, amoniaError,
  openCara, setOpenCara, logging, logError, onCatat,
  onFocusKandang, onFocusHewan, onFocusKesehatan,
}: {
  data: { kandang: KandangItem[]; hewan: HewanItem[] } | null;
  jadwal: JadwalResponse | null;
  kepadatan: KepadatanItem[];
  karantina: KarantinaItem[];
  amoniaKandang: { kandangId: string; nama: string }[];
  kepadatanError: boolean;
  karantinaError: boolean;
  amoniaError: boolean;
  openCara: string | null;
  setOpenCara: (v: string | null) => void;
  logging: string | null;
  logError: string;
  onCatat: (t: TugasJadwal) => void;
  onFocusKandang: (id: string, nama: string) => void;
  onFocusHewan: (id: string, nama: string) => void;
  onFocusKesehatan: (id: string, nama: string, jenis: 'kandang' | 'hewan') => void;
}) {
  const sesak = kepadatan.filter((k) => k.sesak);
  const pentingTelat = (jadwal?.penting ?? []).filter((t) => t.telat > 0);
  // Strip ini khusus ancaman nyawa — hanya hewan yang tugas kandang
  // dormannya mengandung minimal satu tugas `penting` masuk sini. Populasi
  // lebih luas (mis. kucing rumahan yang tugas litter-nya dorman tapi tidak
  // fatal) tetap dapat catatan informasional di TernakAnimals.tsx.
  const dorman = (data?.hewan ?? []).filter((h) => h.tugasKandangDormanPenting);
  const tidakAdaApaApa =
    (!data || (data.kandang.length === 0 && data.hewan.length === 0)) &&
    sesak.length === 0 && pentingTelat.length === 0 && amoniaKandang.length === 0
    && karantina.length === 0 && dorman.length === 0
    && !kepadatanError && !karantinaError && !amoniaError;

  if (tidakAdaApaApa) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <p className="text-4xl">🐾</p>
        <p className="font-semibold text-sm" style={{ color: 'var(--text2)' }}>Belum ada kandang atau hewan</p>
        <p className="text-xs" style={{ color: 'var(--text3)' }}>Mulai dari tab Kandang, atau pilih dari Katalog</p>
      </div>
    );
  }

  const gagalMuat = [
    kepadatanError && 'kepadatan kandang',
    amoniaError && 'tes amonia',
    karantinaError && 'status karantina',
  ].filter((x): x is string => typeof x === 'string');

  return (
    <div className="flex flex-col gap-3">
      {/* Gagal dimuat ditampilkan tegas, bukan disamarkan jadi "tidak ada
          masalah" — pengguna yang amonianya belum sempat dicek tidak boleh
          mengira kandangnya sudah dinyatakan aman. */}
      {gagalMuat.length > 0 && (
        <div className="rounded-xl p-2.5 text-[11px]" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-inset)', color: 'var(--text3)' }}>
          📡 Gagal memuat {gagalMuat.join(', ')} — bukan berarti aman, cuma belum berhasil dicek. Tarik untuk muat ulang.
        </div>
      )}

      {/* Lima peringatan yang membunuh hewan, di atas daftar — bukan
          menunggu ditemukan di sub-layar. */}
      {pentingTelat.length > 0 && (
        <div className="rounded-[18px] p-3.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)', borderLeft: '3px solid var(--neg)' }}>
          <p className="text-xs font-extrabold mb-1.5" style={{ color: 'var(--neg)' }}>
            🚨 {pentingTelat.length} tugas penting telat
          </p>
          <div className="flex flex-col gap-1">
            {pentingTelat.slice(0, 5).map((t) => (
              <button
                key={`${t.subjekTipe}-${t.subjekId}-${t.kodeTugas}`}
                className="text-left text-[11px]"
                style={{ color: 'var(--text2)' }}
                onClick={() => t.subjekTipe === 'kandang' ? onFocusKandang(t.subjekId, t.nama) : onFocusHewan(t.subjekId, t.nama)}
              >
                {t.nama} — {t.labelTugas}, telat {t.telat} hari
              </button>
            ))}
            {pentingTelat.length > 5 && (
              <p className="text-[11px] font-semibold" style={{ color: 'var(--text3)' }}>
                +{pentingTelat.length - 5} lainnya
              </p>
            )}
          </div>
        </div>
      )}

      {sesak.length > 0 && (
        <div className="rounded-[18px] p-3.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)', borderLeft: '3px solid var(--warn)' }}>
          <p className="text-xs font-extrabold mb-1.5" style={{ color: 'var(--warn)' }}>
            🏠 {sesak.length} kandang kelebihan penghuni
          </p>
          <div className="flex flex-col gap-1">
            {sesak.map((k) => (
              <button
                key={k.kandangId}
                className="text-left text-[11px]"
                style={{ color: 'var(--text2)' }}
                onClick={() => onFocusKesehatan(k.kandangId, k.nama, 'kandang')}
              >
                {k.nama} — butuh {k.butuhLiter}L, tersedia {k.tersedia}L (kurang {k.kelebihan}L)
              </button>
            ))}
          </div>
        </div>
      )}

      {amoniaKandang.length > 0 && (
        <div className="rounded-[18px] p-3.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)', borderLeft: '3px solid var(--neg)' }}>
          <p className="text-xs font-extrabold mb-1.5" style={{ color: 'var(--neg)' }}>
            ☠️ Amonia terdeteksi di {amoniaKandang.length} kandang
          </p>
          <p className="text-[11px] mb-1" style={{ color: 'var(--text2)' }}>
            Ganti 30–50% air sekarang dan hentikan pakan sehari.
          </p>
          <div className="flex flex-col gap-1">
            {amoniaKandang.map((k) => (
              <button
                key={k.kandangId}
                className="text-left text-[11px] font-semibold"
                style={{ color: 'var(--neg)' }}
                onClick={() => onFocusKesehatan(k.kandangId, k.nama, 'kandang')}
              >
                {k.nama}
              </button>
            ))}
          </div>
        </div>
      )}

      {karantina.length > 0 && (
        <div className="rounded-[18px] p-3.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)', borderLeft: '3px solid var(--warn)' }}>
          <p className="text-xs font-extrabold mb-1.5" style={{ color: 'var(--warn)' }}>
            🦠 {karantina.length} hewan belum selesai karantina
          </p>
          <div className="flex flex-col gap-1">
            {karantina.map((k) => (
              <button
                key={k.hewanId}
                className="text-left text-[11px]"
                style={{ color: 'var(--text2)' }}
                onClick={() => onFocusHewan(k.hewanId, k.nama)}
              >
                {k.nama} — {k.sisaHari} hari lagi (selesai {k.selesai})
              </button>
            ))}
          </div>
        </div>
      )}

      {dorman.length > 0 && (
        <div className="rounded-[18px] p-3.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)', borderLeft: '3px solid var(--warn)' }}>
          <p className="text-xs font-extrabold mb-1.5" style={{ color: 'var(--warn)' }}>
            💤 {dorman.length} hewan belum punya kandang — tugasnya belum terjadwal
          </p>
          <p className="text-[11px] mb-1" style={{ color: 'var(--text2)' }}>
            Sebagian tugas perawatan spesies ini menempel ke kandang, bukan ke hewannya — tanpa kandang, tugas itu diam saja.
          </p>
          <div className="flex flex-col gap-1">
            {dorman.slice(0, 5).map((h) => (
              <button
                key={h.id}
                className="text-left text-[11px]"
                style={{ color: 'var(--text2)' }}
                onClick={() => onFocusHewan(h.id, h.nama)}
              >
                {h.emoji} {h.nama}
              </button>
            ))}
            {dorman.length > 5 && (
              <p className="text-[11px] font-semibold" style={{ color: 'var(--text3)' }}>
                +{dorman.length - 5} lainnya
              </p>
            )}
          </div>
        </div>
      )}

      {logError && (
        <div className="rounded-xl p-3 text-xs border-l-[3px]" style={{ background: 'rgba(255,159,10,0.1)', borderColor: '#ff9f0a', color: 'var(--text2)' }}>
          {logError}
        </div>
      )}

      {jadwal && jadwal.tugas.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>Jadwal rawat</p>
          {jadwal.tugas.map((t) => {
            const kunci = `${t.subjekTipe}|${t.subjekId}|${t.kodeTugas}`;
            const isOpen = openCara === kunci;
            return (
              <motion.div key={kunci} layout="position" className="rounded-[16px] p-3" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                <button className="w-full text-left flex items-center gap-2" onClick={() => setOpenCara(isOpen ? null : kunci)}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                      {t.labelTugas} {t.penting && <span title="Penting">⚠️</span>}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--text3)' }}>{t.nama}</p>
                  </div>
                  <span className="text-[11px] font-bold flex-shrink-0" style={{ color: t.telat > 0 ? 'var(--neg)' : 'var(--text3)' }}>
                    {relativeTelat(t.telat)}
                  </span>
                </button>
                {isOpen && t.cara && (
                  <p className="text-[11px] mt-2 pt-2 border-t" style={{ color: 'var(--text2)', borderColor: 'var(--sep)' }}>
                    {t.cara}
                  </p>
                )}
                <motion.button
                  className="w-full mt-2 py-2 rounded-xl text-xs font-bold"
                  style={{ ...buttonStyle, opacity: logging === kunci ? 0.6 : 1 }}
                  whileTap={{ scale: 0.97 }}
                  transition={springs.snappy}
                  disabled={logging === kunci}
                  onClick={() => onCatat(t)}
                >
                  {logging === kunci ? 'Mencatat…' : '✓ Catat'}
                </motion.button>
              </motion.div>
            );
          })}
        </div>
      )}

      {jadwal && jadwal.tugas.length === 0 && (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text3)' }}>
          Tidak ada jadwal rawat dalam 14 hari ke depan.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────── TAB KANDANG ───────────────────────────

interface KandangFormState {
  id: string | null; nama: string; jenis: string; habitat: string;
  volumeLiter: string; lokasi: string; tanggalMulai: string;
}

function KandangTab({
  kandang, hewan, focus, onClearFocus, form, setForm, saving, error, onTambah, onUbah, onSimpan, onBatal, onHapus,
}: {
  kandang: KandangItem[];
  hewan: HewanItem[];
  focus: PilihanSubjek | null;
  onClearFocus: () => void;
  form: KandangFormState | null;
  setForm: (f: KandangFormState) => void;
  saving: boolean;
  error: string;
  onTambah: () => void;
  onUbah: (k: KandangItem) => void;
  onSimpan: () => void;
  onBatal: () => void;
  onHapus: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(focus?.tipe === 'kandang' ? focus.id : null);

  useEffect(() => {
    if (focus?.tipe === 'kandang') {
      setOpenId(focus.id);
      onClearFocus();
    }
  }, [focus]);

  return (
    <div className="flex flex-col gap-3">
      {!form && (
        <motion.button
          className="w-full py-2.5 rounded-xl text-xs font-bold"
          style={buttonStyle}
          whileTap={{ scale: 0.97 }}
          transition={springs.snappy}
          onClick={onTambah}
        >
          + Tambah kandang
        </motion.button>
      )}

      {form && (
        <div className="rounded-[18px] p-4 flex flex-col gap-2.5" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{form.id ? 'Ubah kandang' : 'Kandang baru'}</p>
          <input className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
            placeholder="Nama kandang" value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} />
          <div className="flex gap-2">
            <select className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
              value={form.jenis} onChange={(e) => setForm({ ...form, jenis: e.target.value })}>
              {JENIS_KANDANG_OPTIONS.map((j) => <option key={j} value={j}>{JENIS_KANDANG_LABEL[j]}</option>)}
            </select>
            <select className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
              value={form.habitat} onChange={(e) => setForm({ ...form, habitat: e.target.value })}>
              {HABITAT_OPTIONS.map((h) => <option key={h} value={h}>{HABITAT_LABEL[h]}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <input type="number" inputMode="decimal" min={0} className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
              placeholder="Volume (liter, opsional)" value={form.volumeLiter} onChange={(e) => setForm({ ...form, volumeLiter: e.target.value })} />
            <input className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
              placeholder="Lokasi (opsional)" value={form.lokasi} onChange={(e) => setForm({ ...form, lokasi: e.target.value })} />
          </div>
          <input type="date" className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}
            value={form.tanggalMulai} onChange={(e) => setForm({ ...form, tanggalMulai: e.target.value })} />
          {error && <p className="text-xs" style={{ color: 'var(--neg)' }}>{error}</p>}
          <div className="flex gap-2">
            <motion.button className="flex-1 py-2 rounded-xl text-xs font-bold" style={{ ...buttonStyle, opacity: saving ? 0.6 : 1 }}
              whileTap={{ scale: 0.97 }} disabled={saving} onClick={onSimpan}>
              {saving ? 'Menyimpan…' : 'Simpan'}
            </motion.button>
            <button className="flex-1 py-2 rounded-xl text-xs font-bold" style={buttonStyle} onClick={onBatal}>Batal</button>
          </div>
        </div>
      )}

      {kandang.length === 0 && !form && (
        <p className="text-xs text-center py-10" style={{ color: 'var(--text3)' }}>Belum ada kandang.</p>
      )}

      {kandang.map((k) => {
        const isOpen = openId === k.id;
        const penghuni = hewan.filter((h) => h.kandangId === k.id && h.status === 'hidup');
        return (
          <motion.div key={k.id} layout="position" className="rounded-[18px] p-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
            <button className="w-full text-left flex items-center gap-2" onClick={() => setOpenId(isOpen ? null : k.id)}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: 'var(--text)' }}>{k.nama}</p>
                <p className="text-[11px] truncate" style={{ color: 'var(--text3)' }}>
                  {JENIS_KANDANG_LABEL[k.jenis]} · {HABITAT_LABEL[k.habitat]}
                  {k.volumeLiter ? ` · ${k.volumeLiter}L` : ''}{k.lokasi ? ` · ${k.lokasi}` : ''}
                </p>
              </div>
              <span className="text-xs font-bold flex-shrink-0" style={{ color: 'var(--text2)' }}>{k.jumlahPenghuni} ekor</span>
            </button>
            {isOpen && (
              <div className="mt-2 pt-2 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--sep)' }}>
                <p className="text-[11px]" style={{ color: 'var(--text2)' }}>
                  Status: {k.status === 'aktif' ? 'Aktif' : 'Nonaktif'} · Mulai {k.tanggalMulai}
                </p>
                {penghuni.length > 0 && (
                  <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
                    Penghuni: {penghuni.map((h) => h.nama).join(', ')}
                  </p>
                )}
                <div className="flex gap-2 mt-1">
                  <button className="flex-1 py-1.5 rounded-lg text-[11px] font-bold" style={buttonStyle} onClick={() => onUbah(k)}>Ubah</button>
                  <button className="flex-1 py-1.5 rounded-lg text-[11px] font-bold" style={{ ...buttonStyle, color: 'var(--neg)' }} onClick={() => onHapus(k.id)}>Hapus</button>
                </div>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
