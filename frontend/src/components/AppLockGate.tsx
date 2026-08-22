import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { isAppLockEnabled, verifyAppLock } from '@/lib/appLock';

// Re-lock only after the app has been backgrounded for a while — a brief
// tab switch or a system permission sheet stealing focus shouldn't force a
// fresh Face ID prompt every time.
const RELOCK_AFTER_MS = 10000;

export function AppLockGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [locked, setLocked] = useState(false);
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isAppLockEnabled()) {
      setChecking(false);
      return;
    }
    setLocked(true);
    verifyAppLock().then((ok) => {
      setLocked(!ok);
      setChecking(false);
    });
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (!isAppLockEnabled() || !hiddenAt) return;
      if (Date.now() - hiddenAt > RELOCK_AFTER_MS) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const retry = async () => {
    const ok = await verifyAppLock();
    setLocked(!ok);
  };

  if (checking) {
    return <div className="min-h-screen" style={{ background: 'var(--bg)' }} />;
  }

  if (locked) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-screen flex flex-col items-center justify-center gap-4 px-8 text-center"
        style={{ background: 'var(--bg)' }}
      >
        <div className="text-5xl">🔒</div>
        <p className="text-lg font-bold" style={{ color: 'var(--text)' }}>Fayolla Terkunci</p>
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Verifikasi Face ID / Touch ID untuk melanjutkan
        </p>
        <motion.button
          onClick={retry}
          whileTap={{ scale: 0.95 }}
          transition={springs.snappy}
          className="neu-cta px-6 py-3 rounded-full font-bold text-white mt-2"
          style={{ background: 'var(--accentFill)' }}
        >
          Buka Kunci
        </motion.button>
      </motion.div>
    );
  }

  return <>{children}</>;
}
