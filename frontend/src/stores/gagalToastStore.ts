/**
 * Toast "gagal menyimpan", satu untuk seluruh aplikasi.
 *
 * Ada dua puluh tempat di layar-layar ini yang menulis ke server di dalam
 * `try { ... } catch {}` — simpan goal, tambah project, atur batas anggaran,
 * ubah profil, dan seterusnya. Saat permintaannya gagal, tidak ada apa pun
 * yang terjadi di layar: formulirnya diam, tombolnya kembali normal, dan
 * pengguna menyimpulkan ketukannya tidak masuk lalu menekan lagi. Kalau
 * percobaan berikutnya berhasil, yang lahir adalah catatan ganda.
 *
 * Kelas bug yang sama sudah tiga kali diperbaiki satu per satu di repo ini
 * (formulir Tanam di Kebun, pesan sanitasi, tiga loader Ternak). Toast bersama
 * memutusnya sekaligus: tiap pemanggil cukup satu baris, tanpa menyentuh
 * render layarnya masing-masing — jadi cakupannya penuh tanpa dua puluh
 * perubahan tata letak yang masing-masing bisa salah.
 */

import { create } from 'zustand';
import { pesanGagal } from '@/lib/pesanGagal';

interface GagalToastState {
  pesan: string | null;
  timerId: ReturnType<typeof setTimeout> | null;
  tampilkan: (pesan: string) => void;
  tutup: () => void;
}

/** Lebih lama dari toast undo: pesan kegagalan perlu sempat dibaca. */
const DURASI_MS = 6000;

export const useGagalToastStore = create<GagalToastState>((set, get) => ({
  pesan: null,
  timerId: null,

  tampilkan: (pesan) => {
    const prev = get().timerId;
    if (prev) clearTimeout(prev);
    const timerId = setTimeout(() => set({ pesan: null, timerId: null }), DURASI_MS);
    set({ pesan, timerId });
  },

  tutup: () => {
    const { timerId } = get();
    if (timerId) clearTimeout(timerId);
    set({ pesan: null, timerId: null });
  },
}));

/**
 * Laporkan satu aksi tulis yang gagal.
 *
 * @param aksi Kalimat tanpa titik, mis. "Gagal menyimpan goal".
 */
export function tampilkanGagal(aksi: string, err: unknown): void {
  useGagalToastStore.getState().tampilkan(pesanGagal(aksi, err));
}
