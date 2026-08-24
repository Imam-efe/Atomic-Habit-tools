/**
 * Layar Pengaturan.
 *
 * Kontrolnya dirender dari skema yang dikirim backend, bukan ditulis tangan
 * satu per satu. Menambah pengaturan baru cukup di registry backend — layar
 * ini otomatis menampilkannya, lengkap dengan batas dan penjelasannya.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';
import { GardenLocationPicker } from '@/components/GardenLocationPicker';

interface SettingDef {
  key: string;
  group: string;
  label: string;
  hint?: string;
  type: 'boolean' | 'number' | 'hour' | 'enum';
  default: boolean | number | string;
  min?: number;
  max?: number;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
}

interface SettingsResponse {
  groups: Array<{ id: string; label: string; icon: string }>;
  settings: SettingDef[];
  values: Record<string, boolean | number | string>;
}

interface DatabaseInfo {
  tables: Array<{ table: string; label: string; group: string; rows: number }>;
  empty: string[];
  photoBytes: number;
  purgeable: Array<{ table: string; label: string }>;
}

const describeError = (err: unknown, fallback: string) =>
  err instanceof ApiError ? (err.body.message ?? err.body.error ?? fallback) : 'Terjadi kesalahan jaringan.';

const formatBytes = (bytes: number) =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : bytes >= 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${bytes} byte`;

/** Satu baris kontrol, bentuknya ditentukan tipe di skema. */
function SettingRow({
  def,
  value,
  onChange,
  disabled,
}: {
  def: SettingDef;
  value: boolean | number | string;
  onChange: (next: boolean | number | string) => void;
  disabled: boolean;
}) {
  const isDefault = value === def.default;

  return (
    <div className="flex flex-col gap-1 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            {def.label}
            {/* Yang sudah diubah ditandai, supaya jelas apa yang bukan bawaan
                lagi tanpa harus membandingkan sendiri. */}
            {!isDefault && (
              <span className="text-[10px] font-normal ml-1.5" style={{ color: 'var(--accent)' }}>
                diubah
              </span>
            )}
          </span>
          {def.hint && (
            <span className="text-[11px] leading-snug mt-0.5" style={{ color: 'var(--text3)' }}>
              {def.hint}
            </span>
          )}
        </div>

        <div className="shrink-0">
          {def.type === 'boolean' ? (
            <motion.button
              className="w-12 h-7 rounded-full flex items-center px-0.5"
              style={{
                background: value ? 'var(--accentFill)' : 'var(--track)',
                justifyContent: value ? 'flex-end' : 'flex-start',
                opacity: disabled ? 0.5 : 1,
              }}
              onClick={() => onChange(!value)}
              disabled={disabled}
              whileTap={disabled ? {} : { scale: 0.94 }}
              transition={springs.snappy}
            >
              <motion.span
                className="w-6 h-6 rounded-full"
                style={{ background: 'white' }}
                layout
                transition={springs.snappy}
              />
            </motion.button>
          ) : def.type === 'hour' ? (
            <select
              className="px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              value={String(value)}
              disabled={disabled}
              onChange={(e) => onChange(Number(e.target.value))}
            >
              {Array.from({ length: (def.max ?? 23) - (def.min ?? 0) + 1 }, (_, i) => (def.min ?? 0) + i).map(
                (h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                )
              )}
            </select>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                className="w-20 px-3 py-2 rounded-xl text-sm outline-none text-right"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                inputMode="numeric"
                value={String(value)}
                disabled={disabled}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  // Kosong atau bukan angka dibiarkan apa adanya sampai
                  // pengguna selesai mengetik; backend yang menolak nilainya.
                  onChange(e.target.value === '' ? '' : Number.isFinite(n) ? n : value);
                }}
              />
              {def.unit && (
                <span className="text-[11px]" style={{ color: 'var(--text3)' }}>
                  {def.unit}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {(def.min !== undefined || def.max !== undefined) && def.type === 'number' && (
        <span className="text-[10px]" style={{ color: 'var(--text3)' }}>
          {def.min}–{def.max} {def.unit ?? ''}
        </span>
      )}
    </div>
  );
}

interface GardenLocation {
  latitude: number | null;
  longitude: number | null;
  label: string | null;
}

/**
 * Kartu lokasi kebun, tersendiri dari grup pengaturan berskema.
 *
 * Lokasi berupa pasangan lat/lon/label, bukan skalar tunggal — bentuk yang
 * tidak cocok dengan registry pengaturan generik (boolean/number/hour/enum).
 * Jadi ia disimpan dan dirender terpisah, bukan dipaksa masuk skema.
 *
 * Bug yang melatarbelakangi kartu ini: lokasi sebelumnya cuma bisa diatur
 * dari tab Kebun → Rencana, dan begitu tersimpan tidak ada jalan untuk
 * menggantinya dari sana pun. Kartu ini memberi jalur kedua yang selalu
 * bisa diubah atau dihapus, dari satu tempat yang sama dengan pengaturan
 * lain.
 */
function GardenLocationCard() {
  const [location, setLocation] = useState<GardenLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const loc = await apiFetch<GardenLocation>('/garden/location');
      const set = loc.latitude !== null ? loc : null;
      setLocation(set);
      setEditing(set === null);
    } catch (err) {
      setError(describeError(err, 'Gagal memuat lokasi.'));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const clear = async () => {
    if (!confirm('Hapus lokasi kebun? Pengingat siram berhenti menyesuaikan cuaca sampai lokasi diatur ulang.')) return;
    setError(null);
    try {
      await apiFetch('/garden/location', { method: 'DELETE' });
      setLocation(null);
      setEditing(true);
    } catch (err) {
      setError(describeError(err, 'Gagal menghapus lokasi.'));
    }
  };

  return (
    <motion.div
      className="rounded-[18px] p-4 mb-3 flex flex-col gap-2.5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.gentle, delay: 0.24 }}
    >
      <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
        📍 Lokasi kebun
      </div>
      <div className="text-[11px] leading-snug" style={{ color: 'var(--text3)' }}>
        Dipakai untuk menyesuaikan pengingat siram dengan curah hujan. Bisa diganti kapan saja.
      </div>

      {error && (
        <div
          className="rounded-xl p-3 text-xs border-l-[3px]"
          style={{ background: 'rgba(255, 159, 10, 0.1)', borderColor: '#ff9f0a', color: 'var(--text2)' }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs" style={{ color: 'var(--text2)' }}>
          Memuat…
        </div>
      ) : location && !editing ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm" style={{ color: 'var(--text)' }}>
            {location.label ?? `${location.latitude?.toFixed(2)}, ${location.longitude?.toFixed(2)}`}
          </span>
          <div className="flex gap-3 shrink-0">
            <button
              className="text-[11px] font-semibold"
              style={{ color: 'var(--accent)' }}
              onClick={() => setEditing(true)}
            >
              Ubah
            </button>
            <button className="text-[11px] font-semibold" style={{ color: '#ff3b30' }} onClick={clear}>
              Hapus
            </button>
          </div>
        </div>
      ) : (
        <>
          <GardenLocationPicker
            onSaved={() => {
              setEditing(false);
              load();
            }}
            onError={setError}
          />
          {location && (
            <button
              className="text-[11px] font-semibold self-start"
              style={{ color: 'var(--text3)' }}
              onClick={() => setEditing(false)}
            >
              Batal
            </button>
          )}
        </>
      )}
    </motion.div>
  );
}

export default function PengaturanScreen() {
  const [schema, setSchema] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean | number | string>>({});
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>('notifikasi');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [settings, db] = await Promise.all([
          apiFetch<SettingsResponse>('/settings'),
          // Statistik database tidak wajib ada supaya pengaturan tetap bisa
          // dibuka kalau bagian ini bermasalah.
          apiFetch<DatabaseInfo>('/settings/database').catch(() => null),
        ]);
        if (cancelled) return;
        setSchema(settings);
        setDraft(settings.values);
        setDatabase(db);
      } catch (err) {
        if (!cancelled) setError(describeError(err, 'Gagal memuat pengaturan.'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const dirtyKeys = schema
    ? Object.keys(draft).filter((k) => draft[k] !== schema.values[k])
    : [];

  const save = async () => {
    if (dirtyKeys.length === 0) return;
    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const payload: Record<string, unknown> = {};
      for (const key of dirtyKeys) payload[key] = draft[key];

      const res = await apiFetch<{
        saved: string[];
        rejected: Array<{ key: string; reason: string }>;
        values: Record<string, boolean | number | string>;
      }>('/settings', { method: 'PUT', body: JSON.stringify(payload) });

      setSchema((prev) => (prev ? { ...prev, values: res.values } : prev));
      setDraft(res.values);

      if (res.rejected.length > 0) {
        // Yang ditolak disebut satu per satu beserta alasannya; "gagal
        // menyimpan" saja tidak memberi tahu apa yang harus diperbaiki.
        const names = res.rejected
          .map((r) => `${schema?.settings.find((s) => s.key === r.key)?.label ?? r.key} — ${r.reason}`)
          .join('; ');
        setError(`Sebagian ditolak: ${names}`);
      }
      if (res.saved.length > 0) setStatus(`${res.saved.length} pengaturan disimpan.`);
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan.'));
    }
    setSaving(false);
  };

  const resetGroup = async (group: string) => {
    setSaving(true);
    try {
      const res = await apiFetch<{ values: Record<string, boolean | number | string> }>(
        '/settings/reset',
        { method: 'POST', body: JSON.stringify({ group }) }
      );
      setSchema((prev) => (prev ? { ...prev, values: res.values } : prev));
      setDraft(res.values);
      setStatus('Dikembalikan ke bawaan.');
    } catch (err) {
      setError(describeError(err, 'Gagal mengembalikan.'));
    }
    setSaving(false);
  };

  const purge = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ purged: Array<{ label: string; removed: number }> }>(
        '/settings/database/purge',
        { method: 'POST', body: JSON.stringify({ olderThanDays: 7 }) }
      );
      const total = res.purged.reduce((sum, p) => sum + p.removed, 0);
      setStatus(total > 0 ? `${total} baris sementara dibersihkan.` : 'Tidak ada yang perlu dibersihkan.');
      setDatabase(await apiFetch<DatabaseInfo>('/settings/database'));
    } catch (err) {
      setError(describeError(err, 'Gagal membersihkan.'));
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      <div className="mb-5">
        <h1
          className="text-3xl font-extrabold tracking-tight"
          style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}
        >
          Pengaturan
        </h1>
        <p className="text-xs font-semibold mt-1" style={{ color: 'var(--text2)' }}>
          Sesuaikan tiap modul dengan cara Anda memakainya
        </p>
      </div>

      <AnimatePresence>
        {(error || status) && (
          <motion.div
            className="rounded-[18px] p-3.5 mb-3 border-l-[3px] text-xs"
            style={{
              background: error ? 'rgba(255, 159, 10, 0.1)' : 'rgba(52, 199, 89, 0.1)',
              borderColor: error ? '#ff9f0a' : '#34c759',
              color: 'var(--text2)',
            }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            {error ?? status}
          </motion.div>
        )}
      </AnimatePresence>

      {!schema ? (
        <div className="text-sm text-center py-10" style={{ color: 'var(--text2)' }}>
          Memuat…
        </div>
      ) : (
        <>
          {schema.groups.map((group, i) => {
            const defs = schema.settings.filter((s) => s.group === group.id);
            if (defs.length === 0) return null;
            const isOpen = openGroup === group.id;
            const changed = defs.filter((d) => schema.values[d.key] !== d.default).length;

            return (
              <motion.div
                key={group.id}
                className="rounded-[18px] mb-3 overflow-hidden"
                style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springs.gentle, delay: i * 0.03 }}
              >
                <button
                  className="w-full flex items-center justify-between px-4 py-3.5 text-left"
                  onClick={() => setOpenGroup(isOpen ? null : group.id)}
                >
                  <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                    {group.icon} {group.label}
                    {changed > 0 && (
                      <span className="text-[10px] font-normal ml-1.5" style={{ color: 'var(--accent)' }}>
                        {changed} diubah
                      </span>
                    )}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text3)' }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      className="px-4 pb-3"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={collapse}
                    >
                      <div className="h-px mb-1" style={{ background: 'var(--sep)' }} />
                      {defs.map((def) => (
                        <SettingRow
                          key={def.key}
                          def={def}
                          value={draft[def.key] ?? def.default}
                          disabled={saving}
                          onChange={(next) => setDraft((prev) => ({ ...prev, [def.key]: next }))}
                        />
                      ))}
                      {changed > 0 && (
                        <button
                          className="text-[11px] font-semibold mt-2"
                          style={{ color: 'var(--text3)' }}
                          onClick={() => resetGroup(group.id)}
                        >
                          Kembalikan {group.label.toLowerCase()} ke bawaan
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}

          {/* Bukan bagian skema pengaturan — lat/lon/label tidak cocok tipe
              boolean/number/hour/enum yang didukung registry. Ditaruh dekat
              grup Kebun karena itulah yang memakainya. */}
          <GardenLocationCard />

          {/* ─────────────────────── DATABASE ─────────────────────── */}
          {database && (
            <motion.div
              className="rounded-[18px] p-4 mb-3 flex flex-col gap-2.5"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.gentle, delay: 0.3 }}
            >
              <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                🗄️ Data tersimpan
              </div>

              {database.tables.length === 0 ? (
                <div className="text-xs" style={{ color: 'var(--text2)' }}>
                  Belum ada data tersimpan.
                </div>
              ) : (
                database.tables.map((table) => (
                  <div key={table.table} className="flex justify-between text-sm">
                    <span style={{ color: 'var(--text)' }}>
                      {table.label}
                      <span className="text-[10px] ml-1.5" style={{ color: 'var(--text3)' }}>
                        {table.group}
                      </span>
                    </span>
                    <span className="text-xs shrink-0" style={{ color: 'var(--text2)' }}>
                      {table.rows.toLocaleString('id-ID')}
                    </span>
                  </div>
                ))
              )}

              {database.photoBytes > 0 && (
                <div className="text-xs" style={{ color: 'var(--text3)' }}>
                  Foto kebun memakai {formatBytes(database.photoBytes)}. Foto disimpan langsung di
                  database, jadi ini bagian yang paling cepat membesar.
                </div>
              )}

              <motion.button
                className="py-2.5 rounded-xl text-xs font-semibold mt-1"
                style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                onClick={purge}
                disabled={saving}
                whileTap={saving ? {} : { scale: 0.97 }}
                transition={springs.snappy}
              >
                Bersihkan cache & riwayat lebih dari 7 hari
              </motion.button>
              <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
                Hanya membuang cache dan penanda internal — catatan Anda tidak tersentuh.
              </div>
            </motion.div>
          )}

          {/* Tombol simpan mengambang di bawah, hanya muncul kalau ada yang diubah. */}
          <AnimatePresence>
            {dirtyKeys.length > 0 && (
              <motion.div
                className="sticky bottom-4 pt-2"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={springs.gentle}
              >
                <motion.button
                  className="w-full py-3.5 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'var(--accentFill)', opacity: saving ? 0.6 : 1 }}
                  onClick={save}
                  disabled={saving}
                  whileTap={saving ? {} : { scale: 0.97 }}
                  transition={springs.snappy}
                >
                  {saving ? 'Menyimpan…' : `Simpan ${dirtyKeys.length} perubahan`}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
