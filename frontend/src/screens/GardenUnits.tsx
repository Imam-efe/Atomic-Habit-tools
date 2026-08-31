/**
 * Kelola nomor pot: ubah kode yang tercetak, tukar dua nomor, pensiunkan pot.
 *
 * Yang perlu dijaga di layar ini: penukaran tidak pernah terjadi tanpa
 * pengguna menyetujuinya. Server menjawab 409 dengan usulnya, dan layar
 * mengubahnya jadi pilihan tegas — bukan menimpa lalu memberi tahu sesudahnya.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';

export interface PotUnit {
  unitNo: number;
  code: string;
  retired: boolean;
}

interface UnitsResponse {
  plantingId: string;
  nama: string;
  units: PotUnit[];
  kodeRingkas: string;
  maxCodeLen: number;
}

interface UsulTukar {
  plantingId: string;
  unitNo: number;
  code: string;
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

export function UnitManager({
  plantingId,
  onClose,
  onChanged,
}: {
  plantingId: string;
  onClose: () => void;
  /** Dipanggil setiap kali ada perubahan, supaya daftar tanaman ikut segar. */
  onChanged?: () => void;
}) {
  const [data, setData] = useState<UnitsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Pot yang sedang diedit kodenya; null berarti tidak ada. */
  const [mengedit, setMengedit] = useState<number | null>(null);
  const [kodeInput, setKodeInput] = useState('');

  /** Usul tukar dari server, menunggu jawaban pengguna. */
  const [usul, setUsul] = useState<{ unitNo: number; kode: string; lawan: UsulTukar } | null>(null);

  const reload = async () => {
    try {
      setData(await apiFetch<UnitsResponse>(`/garden/units/${plantingId}`));
    } catch (err) {
      setError(describeError(err, 'Gagal memuat nomor pot.'));
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantingId]);

  const selesai = () => {
    setMengedit(null);
    setKodeInput('');
    setUsul(null);
    setError(null);
    setBusy(false);
    reload();
    onChanged?.();
  };

  const simpanKode = async (unitNo: number, kode: string, izinkanTukar = false) => {
    setBusy(true);
    try {
      await apiFetch(`/garden/units/${plantingId}/${unitNo}`, {
        method: 'PATCH',
        body: JSON.stringify({ code: kode, ...(izinkanTukar ? { izinkanTukar: true } : {}) }),
      });
      selesai();
    } catch (err) {
      setBusy(false);
      // 409 bukan kegagalan — server menemukan kode ini dipakai pot lain dan
      // menawarkan tukar. Yang salah adalah menimpanya diam-diam.
      if (err instanceof ApiError && err.status === 409) {
        const lawan = (err.body as { usulTukar?: UsulTukar }).usulTukar;
        if (lawan) {
          setUsul({ unitNo, kode, lawan });
          setError(null);
          return;
        }
      }
      setError(describeError(err, 'Gagal menyimpan kode.'));
    }
  };

  const tambahPot = async () => {
    setBusy(true);
    try {
      await apiFetch(`/garden/units/${plantingId}`, { method: 'POST' });
      selesai();
    } catch (err) {
      setBusy(false);
      setError(describeError(err, 'Gagal menambah pot.'));
    }
  };

  const ubahStatus = async (unitNo: number, retired: boolean) => {
    setBusy(true);
    try {
      await apiFetch(`/garden/units/${plantingId}/${unitNo}/${retired ? 'retire' : 'restore'}`, {
        method: 'POST',
      });
      selesai();
    } catch (err) {
      setBusy(false);
      setError(describeError(err, 'Gagal mengubah status pot.'));
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-sheet flex items-end justify-center bg-black/60 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-[460px] rounded-t-3xl p-5 max-h-[85vh] flex flex-col gap-3"
        style={{ background: 'var(--surface)' }}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={springs.smooth}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-base font-bold" style={{ color: 'var(--text)' }}>
            Nomor pot{data ? ` · ${data.nama}` : ''}
          </div>
          <button
            className="px-3 py-1.5 rounded-xl text-xs font-semibold"
            style={buttonStyle}
            onClick={onClose}
          >
            Tutup
          </button>
        </div>

        {error && (
          <div
            className="rounded-xl p-3 text-xs border-l-[3px]"
            style={{ background: 'rgba(255, 69, 58, 0.1)', borderColor: '#ff453a', color: 'var(--text2)' }}
          >
            {error}
          </div>
        )}

        {usul && (
          <div
            className="rounded-xl p-3 flex flex-col gap-2"
            style={{ background: 'rgba(255, 159, 10, 0.12)', color: 'var(--text2)' }}
          >
            <div className="text-xs">
              Kode <b>#{usul.kode}</b> sedang dipakai pot lain. Tukar nomornya? Pot itu akan memakai
              kode pot ini.
            </div>
            <div className="flex gap-2">
              <button
                className="px-3 py-2 rounded-xl text-xs font-semibold"
                style={{ ...buttonStyle, color: 'var(--text)' }}
                disabled={busy}
                onClick={() => simpanKode(usul.unitNo, usul.kode, true)}
              >
                Tukar dengan #{usul.lawan.code}
              </button>
              <button
                className="px-3 py-2 rounded-xl text-xs"
                style={{ ...buttonStyle, color: 'var(--text3)' }}
                onClick={() => setUsul(null)}
              >
                Batal
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto flex flex-col gap-2">
          {data?.units.length === 0 && (
            <div className="text-xs" style={{ color: 'var(--text2)' }}>
              Belum ada pot pada catatan ini. Tambahkan satu untuk mulai menomori.
            </div>
          )}

          {data?.units.map((u) => (
            <div
              key={u.unitNo}
              className="rounded-xl p-3 flex items-center justify-between gap-2"
              style={{ background: 'var(--bg)', opacity: u.retired ? 0.5 : 1 }}
            >
              {mengedit === u.unitNo ? (
                <>
                  <input
                    className="px-3 py-2 rounded-xl text-sm outline-none flex-1 min-w-0"
                    style={inputStyle}
                    autoFocus
                    maxLength={data.maxCodeLen}
                    value={kodeInput}
                    onChange={(e) => setKodeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') simpanKode(u.unitNo, kodeInput); }}
                  />
                  <button
                    className="px-3 py-2 rounded-xl text-xs font-semibold shrink-0"
                    style={buttonStyle}
                    disabled={busy}
                    onClick={() => simpanKode(u.unitNo, kodeInput)}
                  >
                    Simpan
                  </button>
                  <button
                    className="px-2 py-2 rounded-xl text-xs shrink-0"
                    style={{ ...buttonStyle, color: 'var(--text3)' }}
                    onClick={() => { setMengedit(null); setUsul(null); setError(null); }}
                  >
                    Batal
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="text-lg font-bold px-2 py-1 rounded-lg"
                    style={{ color: 'var(--text)', boxShadow: 'var(--neu-raised-sm)' }}
                    onClick={() => { setMengedit(u.unitNo); setKodeInput(u.code); setUsul(null); }}
                  >
                    #{u.code}
                  </button>
                  <span className="text-[11px] flex-1" style={{ color: 'var(--text3)' }}>
                    {u.retired ? 'pensiun' : 'aktif'}
                  </span>
                  <button
                    className="px-2 py-1 rounded-lg text-[10px] font-semibold shrink-0"
                    style={buttonStyle}
                    disabled={busy}
                    onClick={() => ubahStatus(u.unitNo, !u.retired)}
                  >
                    {u.retired ? 'Aktifkan lagi' : 'Pensiunkan'}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <button
          className="px-3 py-2 rounded-xl text-xs font-semibold self-start"
          style={buttonStyle}
          disabled={busy}
          onClick={tambahPot}
        >
          + Tambah pot
        </button>

        <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
          Mengganti kode hanya mengganti yang tercetak di label. Riwayat perawatan tetap menempel
          pada pot yang sama, jadi "sudah dipupuk" kemarin tidak ikut berpindah.
        </div>
      </motion.div>
    </motion.div>
  );
}
