import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { useGagalToastStore } from '@/stores/gagalToastStore';

/**
 * Pemberitahuan kegagalan menyimpan, dipasang sekali di akar aplikasi.
 *
 * Sengaja terpisah dari UndoToast: yang itu berbentuk tawaran ("Terhapus.
 * Undo?") dan selalu membawa tombol Undo, sedangkan yang ini kabar buruk yang
 * tidak bisa dibatalkan — cuma perlu dibaca lalu ditutup. Warnanya juga
 * berbeda supaya tidak tertukar sekilas.
 */
export function GagalToast() {
  const { pesan, tutup } = useGagalToastStore();

  return (
    <AnimatePresence>
      {pesan && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={springs.gentle}
          className="fixed left-4 right-4 z-50 rounded-2xl px-4 py-3 flex items-start gap-3"
          style={{
            bottom: 'calc(78px + env(safe-area-inset-bottom, 0px))',
            background: '#B3261E',
            boxShadow: 'var(--neu-raised-lg)',
            maxWidth: '400px',
            margin: '0 auto',
          }}
        >
          <span className="text-sm flex-shrink-0">⚠️</span>
          <p className="text-sm flex-1 min-w-0" style={{ color: '#fff' }}>{pesan}</p>
          <button
            onClick={tutup}
            aria-label="Tutup"
            className="text-sm font-bold flex-shrink-0"
            style={{ color: '#fff', opacity: 0.85 }}
          >
            Tutup
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
