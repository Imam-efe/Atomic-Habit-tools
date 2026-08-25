/**
 * Riwayat aksi AI.
 *
 * Agen menulis langsung ke sepuluh tabel. Tanpa layar ini, data yang muncul
 * tiba-tiba tidak bisa ditelusuri: tidak ada cara tahu apakah baris itu
 * diketik sendiri, dibuat AI, atau dari mana asalnya. Yang ditampilkan bukan
 * hanya hasilnya tapi juga permintaan aslinya — pertanyaan yang sebenarnya
 * diajukan pengguna adalah "kenapa ini ada?", bukan "apa ini?".
 *
 * Membatalkan dari sini bekerja persis seperti dari panel AI: menghapus baris
 * yang dibuat aksi itu, dan hanya itu.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface AgentAction {
  id: string;
  tool: string;
  module: string;
  message: string | null;
  summary: string;
  rowIds: string[];
  status: 'dijalankan' | 'dibatalkan';
  createdAt: number;
  undoneAt: number | null;
  undoable: boolean;
}

const MODULE_ICON: Record<string, string> = {
  kebun: '🌱', inventaris: '📦', kebiasaan: '✅', kalender: '📅',
  catatan: '📝', proyek: '🗂️', nutrisi: '🍽️', masakan: '🍳', uang: '💰',
};

function waktu(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function RiwayatAi() {
  const { goBack } = useUIStore();
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await apiFetch<{ actions: AgentAction[] }>('/agent/history');
      setActions(res.actions);
    } catch {
      setError('Gagal memuat riwayat.');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const undo = async (a: AgentAction) => {
    setBusyId(a.id);
    setError('');
    try {
      await apiFetch('/agent/undo', { method: 'POST', body: JSON.stringify({ actionId: a.id }) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error ?? 'Gagal membatalkan.' : 'Tidak ada jaringan.');
    }
    setBusyId(null);
  };

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      <motion.div initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={springs.gentle} className="space-y-4">
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
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.4px' }}>
              Yang AI lakukan
            </h1>
            <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
              Setiap aksi yang ditulis AI, beserta permintaan aslinya
            </p>
          </div>
        </div>

        {error && <p className="text-[11px]" style={{ color: 'var(--neg)' }}>{error}</p>}

        {loading ? (
          <p className="text-[11px]" style={{ color: 'var(--text3)' }}>Memuat…</p>
        ) : actions.length === 0 ? (
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
            <p className="text-[12px]" style={{ color: 'var(--text2)' }}>
              AI belum menulis apa pun. Aksi akan muncul di sini begitu kamu menyuruhnya
              membuat, mencatat, atau menambahkan sesuatu lewat panel ✨ di layar mana pun.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {actions.map((a) => {
              const dibatalkan = a.status === 'dibatalkan';
              return (
                <div
                  key={a.id}
                  className="rounded-2xl p-3.5 space-y-1.5"
                  style={{
                    background: 'var(--surface)',
                    boxShadow: 'var(--neu-raised)',
                    opacity: dibatalkan ? 0.6 : 1,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                        <span aria-hidden>{MODULE_ICON[a.module] ?? '✨'} </span>
                        <span style={{ textDecoration: dibatalkan ? 'line-through' : undefined }}>
                          {a.summary}
                        </span>
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text3)' }}>
                        {waktu(a.createdAt)} · {a.tool}
                        {a.rowIds.length > 1 ? ` · ${a.rowIds.length} baris` : ''}
                        {dibatalkan && a.undoneAt ? ` · dibatalkan ${waktu(a.undoneAt)}` : ''}
                      </p>
                    </div>

                    {a.undoable && (
                      <button
                        className="text-[10px] font-semibold flex-shrink-0 disabled:opacity-50"
                        style={{ color: 'var(--text3)' }}
                        onClick={() => undo(a)}
                        disabled={busyId === a.id}
                      >
                        {busyId === a.id ? 'Membatalkan…' : 'Batalkan'}
                      </button>
                    )}
                  </div>

                  {/* Permintaan aslinya: ini yang menjawab "kenapa ini ada?" */}
                  {a.message && (
                    <p
                      className="text-[10px] italic rounded-lg px-2 py-1.5"
                      style={{ color: 'var(--text2)', background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
                    >
                      “{a.message}”
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </motion.div>
    </div>
  );
}
