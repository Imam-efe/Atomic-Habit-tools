/**
 * Catat cepat: satu kalimat masuk, satu catatan keluar.
 *
 * Dulu layar ini punya jalur AI-nya sendiri — endpoint parse terpisah, skema
 * niat terpisah, dan satu kartu konfirmasi yang ditulis tangan untuk tiap
 * jenis catatan. Agen melakukan pekerjaan yang persis sama: menebak maksud
 * dari sebuah kalimat lalu menulisnya ke modul yang benar.
 *
 * Dua jalur untuk satu pekerjaan berarti dua tempat yang harus diperbaiki
 * setiap kali ada yang salah, dan dua perilaku berbeda untuk kalimat yang
 * sama. Layar ini sekarang membungkus panel AI yang sama dengan yang ada di
 * setiap layar — tanpa modul, jadi seluruh alat tersedia — dan yang tersisa
 * di sini hanyalah yang memang milik overlay ini: cara membukanya, dikte yang
 * langsung menyala dari tombol mikrofon, dan cara menutupnya.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { isVoiceSupported, startVoiceInput, type VoiceSession } from '@/lib/voice';
import { useCommandStore, notifyDataChanged } from '@/stores/commandStore';
import { AiPanel } from '@/components/AiPanel';

export function QuickAdd() {
  const { overlay, startListening, close } = useCommandStore();
  const open = overlay === 'quickadd';

  const [dictated, setDictated] = useState('');
  const [listening, setListening] = useState(false);
  const voiceRef = useRef<VoiceSession | null>(null);

  const stopVoice = () => {
    voiceRef.current?.cancel();
    voiceRef.current = null;
    setListening(false);
  };

  const handleClose = () => {
    stopVoice();
    setDictated('');
    close();
  };

  /**
   * Dikte mengisi kotak panel, tidak langsung mengirim.
   *
   * Pengenalan suara Indonesia sering meleset satu-dua kata, dan agen
   * sekarang bisa menulis langsung — mengirim tanpa dilihat dulu berarti
   * kesalahan dengar berubah jadi baris di database.
   */
  const beginListening = () => {
    if (listening) {
      voiceRef.current?.stop();
      return;
    }
    const session = startVoiceInput({
      onPartial: setDictated,
      onResult: setDictated,
      onEnd: () => { setListening(false); voiceRef.current = null; },
      onError: () => { setListening(false); voiceRef.current = null; },
    });
    if (session) {
      voiceRef.current = session;
      setListening(true);
    }
  };

  // Dibuka dari tombol mikrofon: langsung mendengarkan.
  useEffect(() => {
    if (open && startListening && isVoiceSupported()) beginListening();
    if (!open) stopVoice();
  }, [open, startListening]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={springs.gentle}
          className="fixed inset-0 z-50 flex items-start justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.4)', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)' }}
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, y: -18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.97 }}
            transition={springs.gentle}
            className="w-full space-y-3"
            style={{ maxWidth: 460 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-extrabold text-white">Catat cepat</h2>
              <button
                className="text-[12px] font-semibold text-white"
                style={{ opacity: 0.8 }}
                onClick={handleClose}
              >
                Tutup
              </button>
            </div>

            {listening && (
              <p className="text-[11px] text-white" style={{ opacity: 0.85 }}>
                🎙 Mendengarkan… kalimatnya masuk ke kotak di bawah.
              </p>
            )}

            <AiPanel
              module={undefined}
              defaultOpen
              initialMessage={dictated}
              suggestions={[
                'Beli kopi 25rb pakai BCA',
                'Sudah siram kangkung',
                'Ingatkan kontrol dokter Jumat jam 9',
              ]}
              onChanged={() => notifyDataChanged('beranda')}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
