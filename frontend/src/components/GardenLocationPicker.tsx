/**
 * Kontrol pilih lokasi kebun: tombol GPS atau daftar kota.
 *
 * Dipakai di lebih dari satu layar (Kebun → Rencana, dan Pengaturan) — logika
 * geolocation, termasuk pembedaan kode error, hidup di satu tempat supaya
 * kedua tempat itu tidak bisa diam-diam berbeda perilaku.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';
import { CITIES_ID } from '@/data/cities_id';

interface Props {
  /** Dipanggil setelah lokasi berhasil tersimpan di server. */
  onSaved: () => void;
  onError: (message: string) => void;
}

export function GardenLocationPicker({ onSaved, onError }: Props) {
  const [saving, setSaving] = useState(false);

  const save = async (latitude: number, longitude: number, label?: string) => {
    setSaving(true);
    try {
      await apiFetch('/garden/location', {
        method: 'POST',
        body: JSON.stringify({ latitude, longitude, label }),
      });
      onSaved();
    } catch (err) {
      onError(
        err instanceof ApiError ? (err.body.message ?? 'Gagal menyimpan lokasi.') : 'Terjadi kesalahan jaringan.'
      );
    }
    setSaving(false);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      onError('Perangkat ini tidak mendukung deteksi lokasi. Pilih kota di bawah.');
      return;
    }
    setSaving(true);

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        save(Number(pos.coords.latitude.toFixed(4)), Number(pos.coords.longitude.toFixed(4))),
      (err) => {
        // Dibedakan per kode. Melaporkan semuanya sebagai "izin ditolak" keliru
        // dan menyesatkan: GPS mati atau mode pesawat memberi POSITION_UNAVAILABLE,
        // dan pengguna akan sia-sia mencari pengaturan izin yang sebetulnya
        // sudah benar.
        const message =
          err.code === err.PERMISSION_DENIED
            ? 'Izin lokasi ditolak. Pilih kota di bawah, atau aktifkan izin lokasi di pengaturan browser.'
            : err.code === err.POSITION_UNAVAILABLE
              ? 'Lokasi tidak bisa dibaca — GPS mati atau perangkat sedang mode pesawat. Pilih kota di bawah.'
              : 'Deteksi lokasi terlalu lama. Pilih kota di bawah.';
        onError(message);
        setSaving(false);
      },
      // Tanpa timeout, getCurrentPosition bisa menggantung tanpa batas dan
      // tombolnya terlihat macet selamanya.
      { timeout: 10_000, maximumAge: 600_000 }
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <motion.button
        className="py-2.5 rounded-xl text-xs font-semibold text-white"
        style={{ background: 'var(--accentFill)', opacity: saving ? 0.6 : 1 }}
        onClick={useMyLocation}
        disabled={saving}
        whileTap={saving ? {} : { scale: 0.97 }}
        transition={springs.snappy}
      >
        {saving ? 'Menyimpan…' : '📍 Pakai lokasi saya'}
      </motion.button>

      {/* Jalan keluar wajib ada. GPS bisa ditolak, mati, atau perangkatnya
          mode pesawat — tanpa pilihan manual, fiturnya mati permanen bagi
          orang yang tidak bisa atau tidak mau memberi izin lokasi. */}
      <div className="text-[10px] text-center font-semibold" style={{ color: 'var(--text3)' }}>
        atau pilih kota terdekat
      </div>
      <select
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
        style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
        value=""
        disabled={saving}
        onChange={(e) => {
          const city = CITIES_ID.find((c) => c.name === e.target.value);
          if (city) save(city.lat, city.lon, city.name);
        }}
      >
        <option value="">Pilih kota…</option>
        {CITIES_ID.map((city) => (
          <option key={city.name} value={city.name}>
            {city.name}
          </option>
        ))}
      </select>
    </div>
  );
}
