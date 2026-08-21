import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { springs } from '@/tokens/motion';
import type { Account, User } from '@/types';

export function LoginScreen() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const addAccount = useAuthStore(s => s.addAccount);
  const navigate = useNavigate();

  const handleLogin = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) { setError('Nama minimal 2 karakter'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json() as { access_token?: string; refresh_token?: string; user?: User; error?: string };
      if (!res.ok || !data.access_token || !data.refresh_token || !data.user) {
        setError(data.error ?? 'Login gagal');
        return;
      }
      const account: Account = {
        userId: data.user.id,
        name: data.user.name,
        role: data.user.role,
        refreshToken: data.refresh_token,
      };
      addAccount(account, data.access_token, data.user);
      navigate('/');
    } catch {
      setError('Tidak bisa terhubung ke server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-8"
      style={{ background: 'var(--bg)' }}
    >
      <motion.div
        className="w-full max-w-sm flex flex-col items-center gap-10"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.gentle}
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-20 h-20 rounded-[22px] flex items-center justify-center text-white text-3xl font-bold"
            style={{
              background: 'linear-gradient(135deg, var(--accentFill), var(--accentFill2))',
              boxShadow: 'var(--neu-raised-lg)',
            }}
          >
            F
          </div>
          <div className="text-center">
            <h1
              className="text-3xl font-extrabold tracking-tight"
              style={{ color: 'var(--text)' }}
            >
              Fayolla
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text2)' }}>
              Masuk dengan namamu
            </p>
          </div>
        </div>

        {/* Name input */}
        <div className="w-full flex flex-col gap-3">
          <input
            type="text"
            placeholder="Nama kamu..."
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            className="w-full px-4 py-3 rounded-2xl text-base outline-none"
            style={{
              background: 'var(--surface)',
              color: 'var(--text)',
              boxShadow: 'var(--neu-inset)',
            }}
            autoFocus
          />
          {error && (
            <p className="text-sm" style={{ color: 'var(--neg)' }}>{error}</p>
          )}
          <motion.button
            className="neu-cta w-full py-4 rounded-2xl font-semibold text-base text-white"
            style={{ background: 'var(--accentFill)' }}
            whileTap={{ scale: 0.97 }}
            transition={springs.snappy}
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? 'Masuk...' : 'Masuk'}
          </motion.button>
        </div>

        <p className="text-xs text-center" style={{ color: 'var(--text3)' }}>
          Data tersimpan di akun Cloudflare kamu. Tidak ada data pihak ketiga.
        </p>
      </motion.div>
    </div>
  );
}
