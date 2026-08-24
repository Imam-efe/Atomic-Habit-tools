import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { isAppLockEnabled, isBiometricAvailable, enableAppLock, disableAppLock } from '@/lib/appLock';

const VAPID_PUBLIC_KEY = 'BPOZXYPVRv_DxSObMXImgYoCWH582IyoDQAqqVAbKaJgqEMa7go2RUgDRSwIYLhOKZuKSJgBsU7SFVWg72MMqnI';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function formatRp(n: number) {
  return n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}

export function More() {
  const { session, accounts, switchAccount, logout } = useAuthStore();
  const { theme, setTheme, accent, setAccent, setSubScreen } = useUIStore();
  const [switching, setSwitching] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [shortcutToken, setShortcutToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [appLockOn, setAppLockOn] = useState(false);
  const [appLockAvailable, setAppLockAvailable] = useState(true);
  const [appLockBusy, setAppLockBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setAppLockOn(isAppLockEnabled());
    isBiometricAvailable().then(setAppLockAvailable);
  }, []);

  const handleToggleAppLock = async () => {
    if (appLockBusy) return;
    setAppLockBusy(true);
    if (appLockOn) {
      disableAppLock();
      setAppLockOn(false);
    } else {
      const ok = await enableAppLock();
      if (ok) {
        setAppLockOn(true);
      } else {
        alert('Gagal mengaktifkan Face ID/Touch ID. Pastikan perangkat Anda mendukung dan coba lagi.');
      }
    }
    setAppLockBusy(false);
  };

  // Bank accounts state
  const [bankAccounts, setBankAccounts] = useState<{ id: string; name: string; account_type: string; balance: number }[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [newBankName, setNewBankName] = useState('');
  const [newBankType, setNewBankType] = useState('Bank');
  const [newBankBalance, setNewBankBalance] = useState('');
  const [showAddBank, setShowAddBank] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [importingData, setImportingData] = useState(false);

  const fetchBankAccounts = async () => {
    setLoadingBanks(true);
    try {
      const res = await apiFetch<any[]>('/bank-accounts');
      setBankAccounts(res);
    } catch {}
    setLoadingBanks(false);
  };

  const handleAddBank = async () => {
    if (!newBankName.trim()) return;
    setSavingBank(true);
    try {
      await apiFetch('/bank-accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: newBankName.trim(),
          account_type: newBankType,
          balance: parseInt(newBankBalance.replace(/\D/g, '')) || 0
        })
      });
      fetchBankAccounts();
      setNewBankName('');
      setNewBankBalance('');
      setShowAddBank(false);
    } catch {}
    setSavingBank(false);
  };

  const handleDeleteBank = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus rekening ini? Semua alokasi transaksi dengan rekening ini akan terlepas.')) return;
    try {
      await apiFetch(`/bank-accounts/${id}`, { method: 'DELETE' });
      fetchBankAccounts();
    } catch {}
  };

  const fetchShortcutToken = async () => {
    setLoadingToken(true);
    try {
      const res = await apiFetch<{ token: string | null }>('/shortcut/token');
      setShortcutToken(res.token);
    } catch {}
    setLoadingToken(false);
  };

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setPushEnabled(!!sub);
        });
      });
    }
    fetchShortcutToken();
    fetchBankAccounts();
  }, []);

  const handleRegenerateToken = async () => {
    if (shortcutToken && !confirm('Apakah Anda yakin ingin mengganti API Key Shortcut Anda? Shortcut lama Anda tidak akan berfungsi lagi.')) {
      return;
    }
    setRegenerating(true);
    try {
      const res = await apiFetch<{ token: string }>('/shortcut/token/regenerate', { method: 'POST' });
      setShortcutToken(res.token);
      alert('API Key baru berhasil dibuat!');
    } catch (err) {
      alert('Gagal membuat API Key: ' + (err as Error).message);
    } finally {
      setRegenerating(false);
    }
  };

  const handleCopyToken = () => {
    if (!shortcutToken) return;
    navigator.clipboard.writeText(shortcutToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTogglePush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Browser atau PWA Anda tidak mendukung Push Notifications.');
      return;
    }

    if (pushEnabled) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
        }
        setPushEnabled(false);
      } catch (err) {
        alert('Gagal mematikan notifikasi: ' + (err as Error).message);
      }
    } else {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          alert('Izin notifikasi ditolak. Silakan aktifkan izin di pengaturan Safari/iOS Anda.');
          return;
        }

        const reg = await navigator.serviceWorker.ready;
        const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });

        const keys = {
          p256dh: btoa(String.fromCharCode.apply(null, new Uint8Array(sub.getKey('p256dh')!) as unknown as number[])),
          auth: btoa(String.fromCharCode.apply(null, new Uint8Array(sub.getKey('auth')!) as unknown as number[])),
        };

        await apiFetch('/notifications/subscribe', {
          method: 'POST',
          body: JSON.stringify({
            endpoint: sub.endpoint,
            keys,
          }),
        });

        setPushEnabled(true);
      } catch (err) {
        alert('Gagal mengaktifkan notifikasi. Catatan: Untuk iPhone/iOS, aplikasi harus ditambahkan ke Home Screen (PWA) terlebih dahulu agar notifikasi dapat berfungsi.');
        console.error(err);
      }
    }
  };

  const handleSendTestPush = async () => {
    setTestingPush(true);
    try {
      const res = await apiFetch<{ success: boolean; count: number }>('/notifications/test', { method: 'POST' });
      if (res.success && res.count > 0) {
        alert('Notifikasi tes berhasil dikirim!');
      } else {
        alert('Gagal mengirim notifikasi tes. Pastikan perangkat Anda terdaftar dan terhubung.');
      }
    } catch (err) {
      alert('Gagal memanggil API tes: ' + (err as Error).message);
    } finally {
      setTestingPush(false);
    }
  };

  const handleSwitchAccount = async (userId: string) => {
    if (userId === session?.user.id) return;
    setSwitching(userId);
    try {
      await switchAccount(userId);
    } catch {
      alert('Gagal ganti akun. Coba login ulang.');
    } finally {
      setSwitching(null);
    }
  };

  const handleAddAccount = () => {
    navigate('/login');
  };

  const handleLogout = () => {
    logout();
  };

  const handleThemeChange = async (t: 'dark' | 'light') => {
    setTheme(t);
    try {
      await apiFetch('/auth/profile', { method: 'PUT', body: JSON.stringify({ theme: t }) });
    } catch {}
  };

  const handleAccentChange = async (a: 'violet' | 'green' | 'blue' | 'orange') => {
    setAccent(a);
    try {
      await apiFetch('/auth/profile', { method: 'PUT', body: JSON.stringify({ accent: a }) });
    } catch {}
  };

  const handleExportData = async () => {
    // Foto jurnal kebun disimpan sebagai data URL, jadi satu tanaman yang
    // rajin difoto bisa membuat berkas ekspor membengkak sampai gagal diunduh.
    // Karena itu ditanyakan, bukan diputuskan diam-diam ke salah satu arah.
    const withPhotos = window.confirm(
      'Sertakan foto jurnal kebun?\n\n' +
      'OK — foto ikut, berkas jauh lebih besar dan bisa gagal di perangkat lama.\n' +
      'Batal — semua data lain tetap ikut, tanpa foto.'
    );

    setExportingData(true);
    try {
      const data = await apiFetch<Record<string, unknown> & { skipped_tables?: string[] }>(
        `/export${withPhotos ? '?photos=1' : ''}`,
        { method: 'GET' }
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fayolla-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.URL.revokeObjectURL(url);

      // Apa yang tidak ikut disebut terang-terangan: backup yang diam-diam
      // tidak lengkap lebih berbahaya daripada yang mengaku tidak lengkap.
      const skipped = data.skipped_tables ?? [];
      alert(
        skipped.length > 0
          ? 'Data berhasil diekspor, tanpa foto jurnal kebun.'
          : 'Data berhasil diekspor, termasuk foto jurnal kebun.'
      );
    } catch (error) {
      alert('Gagal mengekspor data.');
      console.error(error);
    } finally {
      setExportingData(false);
    }
  };

  const handleImportData = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setImportingData(true);
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const result = await apiFetch<{ imported_count: number }>('/export', { method: 'POST', body: JSON.stringify(payload) });
        alert(`Data berhasil diimpor: ${result.imported_count} records.`);
      } catch (error) {
        alert('Gagal mengimpor data. Pastikan file valid.');
        console.error(error);
      } finally {
        setImportingData(false);
      }
    };
    input.click();
  };

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      <h1
        className="text-3xl font-extrabold tracking-tight mb-6"
        style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}
      >
        Lainnya
      </h1>

      {/* Accounts section */}
      <section className="mb-6">
        <p
          className="text-xs font-bold uppercase tracking-widest mb-3"
          style={{ color: 'var(--text3)' }}
        >
          AKUN AKTIF & SWITCHER
        </p>

        <div
          className="rounded-[18px] overflow-hidden"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
        >
          {accounts.map((account, i) => {
            const isActive = account.userId === session?.user.id;
            return (
              <div key={account.userId}>
                {i > 0 && (
                  <div className="h-px mx-4" style={{ background: 'var(--sep)' }} />
                )}
                <motion.button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  onClick={() => handleSwitchAccount(account.userId)}
                  disabled={switching === account.userId}
                  whileTap={{ scale: 0.98 }}
                  transition={springs.snappy}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                    style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}
                  >
                    {account.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="font-semibold truncate"
                      style={{ color: 'var(--text)' }}
                    >
                      {account.name}
                    </p>
                    <p className="text-sm truncate" style={{ color: 'var(--text2)' }}>
                      {account.role}
                    </p>
                  </div>
                  <AnimatePresence>
                    {isActive && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        transition={springs.bouncy}
                        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          background: 'var(--accentFill)',
                          // A 20px status dot, not a button: shallow shadow, and
                          // none of .neu-cta's press behaviour.
                          boxShadow: 'var(--neu-raised-sm)',
                        }}
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="white"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {switching === account.userId && (
                    <div
                      className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
                      style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
                    />
                  )}
                </motion.button>
              </div>
            );
          })}

          <div className="h-px mx-4" style={{ background: 'var(--sep)' }} />
          <motion.button
            className="w-full flex items-center gap-3 px-4 py-3 text-left"
            onClick={handleAddAccount}
            whileTap={{ scale: 0.98 }}
            transition={springs.snappy}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accentSoft)' }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" x2="12" y1="5" y2="19" />
                <line x1="5" x2="19" y1="12" y2="12" />
              </svg>
            </div>
            <span className="font-semibold" style={{ color: 'var(--accent)' }}>
              Tambah akun
            </span>
          </motion.button>
        </div>
      </section>

      {/* Sub-screens (Active Modules) */}
      <section className="mb-6">
        <p
          className="text-xs font-bold uppercase tracking-widest mb-3"
          style={{ color: 'var(--text3)' }}
        >
          MODUL LAINNYA
        </p>
        <div
          className="rounded-[18px] overflow-hidden"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
        >
          {[
            { label: 'Projects', id: 'projects', desc: 'Kelola tugas & project terkait goal', path: null },
            { label: 'Aktivitas', id: 'activity', desc: 'Pelacakan waktu & alokasi harian', path: null },
            { label: 'Nutrisi', id: 'nutrition', desc: 'Log makanan & hitung kkal / protein', path: null },
            { label: 'Kalender Haid', id: 'menstrual', desc: 'Pelacakan menstruasi & masa subur', path: null },
            { label: 'Stok & Inventaris', id: 'inventory', desc: 'Manajemen stok makanan & produk', path: null },
            { label: 'Jadwal Anak', id: 'kids-schedule', desc: 'Jadwal pelajaran, rutinitas & aktivitas anak', path: null },
            { label: 'Laporan Keuangan', id: 'financial-report', desc: 'Rekap Laba Rugi, Neraca, & Utang', path: null },
            { label: 'Review Mingguan', id: 'weekly-review', desc: 'Refleksi kebiasaan & penyesuaian mingguan', path: null },
            { label: 'Rekap Bulanan', id: 'monthly-review', desc: 'Narasi AI bulanan: kebiasaan, keuangan & identitas', path: null },
            { label: 'Heatmap Kebiasaan', id: 'habit-heatmap', desc: 'Visualisasi 52 minggu konsistensi kebiasaan', path: null },
            { label: 'Pelunasan Utang', id: 'debt-planner', desc: 'Kalkulator snowball & avalanche payoff', path: null },
            { label: 'Pusat Notifikasi', id: 'notification-center', desc: 'Pengingat custom ke iPhone, jam & interval bebas', path: null },
            { label: 'Pencapaian', id: 'achievements', desc: 'Koleksi lencana dari streak, budget & pelunasan utang', path: null },
            { label: 'Catatan', id: 'notes', desc: 'Catatan bebas, bisa didikte & dihubungkan ke kebiasaan/goal', path: null },
            { label: 'Pengaturan', id: 'pengaturan', desc: 'Jam notifikasi, ambang tiap modul & manajemen data', path: null },
            { label: 'Pagi Ini', id: 'harian', desc: 'Ringkasan harian: kebiasaan, agenda, sisa aman, tagihan & jadwal anak', path: null },
            { label: 'Tutup Hari', id: 'tutup-hari', desc: 'Ritual malam 3 menit: refleksi, mood & tiga prioritas besok', path: null },
            { label: 'Pola', id: 'pola', desc: 'Hubungan kebiasaan dengan tidur, langkah & pengeluaran', path: null },
            { label: 'Pembuat Shortcut', id: 'shortcuts', desc: 'Generator iOS Shortcuts dari deskripsi natural', path: '/shortcuts' },
          ].map((item, i) => (
            <div key={item.id}>
              {i > 0 && (
                <div className="h-px mx-4" style={{ background: 'var(--sep)' }} />
              )}
              <motion.button
                className="w-full flex items-center justify-between px-4 py-3.5 text-left"
                onClick={() => item.path ? navigate(item.path) : setSubScreen(item.id)}
                whileTap={{ scale: 0.98 }}
                transition={springs.snappy}
              >
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--text)' }}>{item.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text2)' }}>{item.desc}</p>
                </div>
                <span style={{ color: 'var(--text3)' }} className="text-lg">›</span>
              </motion.button>
            </div>
          ))}
        </div>
      </section>

      {/* Settings / Tampilan */}
      <section className="mb-6">
        <p
          className="text-xs font-bold uppercase tracking-widest mb-3"
          style={{ color: 'var(--text3)' }}
        >
          TAMPILAN & PENGATURAN
        </p>
        <div
          className="rounded-[18px] p-4 flex flex-col gap-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
        >
          {/* Theme toggler */}
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--text)' }} className="font-semibold text-sm">Mode Gelap</span>
            <button
              className="w-12 h-7 rounded-full p-1 transition-colors relative"
              style={{ background: theme === 'dark' ? 'var(--accentFill)' : 'var(--track)' }}
              onClick={() => handleThemeChange(theme === 'dark' ? 'light' : 'dark')}
            >
              <motion.div
                className="w-5 h-5 bg-white rounded-full"
                layout="position"
                transition={springs.snappy}
                style={{ marginLeft: theme === 'dark' ? 'auto' : '0' }}
              />
            </button>
          </div>

          <div className="h-px" style={{ background: 'var(--sep)' }} />

          {/* Accent picker */}
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--text)' }} className="font-semibold text-sm">Warna Aksen</span>
            <div className="flex gap-2.5">
              {(['violet', 'green', 'blue', 'orange'] as const).map(colorKey => {
                const colors = {
                  violet: '#7C5CFF',
                  green: 'var(--pos)',
                  blue: '#0A84FF',
                  orange: 'var(--warn)'
                };
                const hex = colors[colorKey];
                const isSelected = accent === colorKey;
                return (
                  <button
                    key={colorKey}
                    onClick={() => handleAccentChange(colorKey)}
                    className="w-7 h-7 rounded-full flex items-center justify-center relative"
                    style={{
                      background: hex,
                      border: isSelected ? '2px solid white' : 'none',
                      boxShadow: isSelected ? `0 0 0 2px ${hex}` : 'none'
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* App Lock Section */}
      {appLockAvailable && (
        <section className="mb-6">
          <p
            className="text-xs font-bold uppercase tracking-widest mb-3"
            style={{ color: 'var(--text3)' }}
          >
            PRIVASI
          </p>
          <div
            className="rounded-[18px] p-4 flex items-center justify-between"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
          >
            <div>
              <span style={{ color: 'var(--text)' }} className="font-semibold text-sm block">Kunci Aplikasi</span>
              <span className="text-[11px] block mt-0.5" style={{ color: 'var(--text2)' }}>
                Verifikasi Face ID / Touch ID setiap kembali ke aplikasi
              </span>
            </div>
            <button
              className="w-12 h-7 rounded-full p-1 transition-colors relative flex-shrink-0"
              style={{ background: appLockOn ? 'var(--accentFill)' : 'var(--track)' }}
              onClick={handleToggleAppLock}
              disabled={appLockBusy}
            >
              <motion.div
                className="w-5 h-5 bg-white rounded-full"
                layout="position"
                transition={springs.snappy}
                style={{ marginLeft: appLockOn ? 'auto' : '0' }}
              />
            </button>
          </div>
        </section>
      )}

      {/* Push Notifications Section */}
      <section className="mb-6">
        <p
          className="text-xs font-bold uppercase tracking-widest mb-3"
          style={{ color: 'var(--text3)' }}
        >
          NOTIFIKASI PENGINGAT
        </p>
        <div
          className="rounded-[18px] p-4 flex flex-col gap-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <span style={{ color: 'var(--text)' }} className="font-semibold text-sm block">Notifikasi Harian</span>
              <span className="text-[11px] block mt-0.5" style={{ color: 'var(--text2)' }}>Terima pengingat kebiasaan di iPhone Anda</span>
            </div>
            <button
              className="w-12 h-7 rounded-full p-1 transition-colors relative"
              style={{ background: pushEnabled ? 'var(--accentFill)' : 'var(--track)' }}
              onClick={handleTogglePush}
            >
              <motion.div
                className="w-5 h-5 bg-white rounded-full"
                layout="position"
                transition={springs.snappy}
                style={{ marginLeft: pushEnabled ? 'auto' : '0' }}
              />
            </button>
          </div>

          {pushEnabled && (
            <>
              <div className="h-px" style={{ background: 'var(--sep)' }} />
              <button
                className="w-full py-2.5 rounded-xl text-xs font-bold text-center border"
                style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                disabled={testingPush}
                onClick={handleSendTestPush}
              >
                {testingPush ? 'Mengirim...' : 'Kirim Notifikasi Tes'}
              </button>
            </>
          )}
        </div>
      </section>

      {/* Integrasi Shortcut iPhone Section */}
      <section className="mb-6">
        <p
          className="text-xs font-bold uppercase tracking-widest mb-3"
          style={{ color: 'var(--text3)' }}
        >
          INTEGRASI SHORTCUT IPHONE
        </p>
        <div
          className="rounded-[18px] p-4 flex flex-col gap-4"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
        >
          <div>
            <span style={{ color: 'var(--text)' }} className="font-semibold text-sm block">API Key Pintasan</span>
            <span className="text-[11px] block mt-0.5" style={{ color: 'var(--text2)' }}>Gunakan API Key ini untuk menghubungkan aplikasi Shortcuts iPhone Anda</span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              className="flex-1 px-3 py-2.5 rounded-xl text-xs outline-none font-mono"
              style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-inset)' }}
              value={loadingToken ? 'Memuat...' : (shortcutToken || 'Belum ada API Key')}
            />
            {shortcutToken && (
              <button
                className="neu-cta px-4 py-2.5 rounded-xl text-xs font-bold text-white flex-shrink-0"
                style={{ background: 'var(--accentFill)' }}
                onClick={handleCopyToken}
              >
                {copied ? 'Tersalin!' : 'Salin'}
              </button>
            )}
          </div>

          <button
            className="w-full py-2.5 rounded-xl text-xs font-bold text-center border"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
            disabled={regenerating}
            onClick={handleRegenerateToken}
          >
            {regenerating ? 'Memproses...' : (shortcutToken ? 'Regenerasi API Key' : 'Buat API Key Baru')}
          </button>

          {shortcutToken && (
            <div className="rounded-xl p-3 text-xs leading-relaxed flex flex-col gap-2" style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
              <span className="font-bold text-[var(--warn)]">💡 Panduan Cepat iOS Shortcut:</span>
              <ol className="list-decimal pl-4 flex flex-col gap-1.5" style={{ color: 'var(--text2)' }}>
                <li>Buka aplikasi <strong>Shortcuts</strong> di iPhone.</li>
                <li>Buat Shortcut baru, tambahkan aksi <strong>Get Contents of URL</strong>.</li>
                <li>Isi URL: <code className="bg-black/20 px-1 rounded select-all text-[11px]">https://fayolla-api.imamefe4.workers.dev/api/shortcut/&lt;endpoint&gt;</code></li>
                <li>Ubah Method menjadi <strong>POST</strong>.</li>
                <li>Tambahkan Headers:
                  <ul className="list-disc pl-4 mt-0.5 text-[10px]">
                    <li><code className="bg-black/20 px-1 rounded">Authorization</code> : <code className="bg-black/20 px-1 rounded">Bearer {shortcutToken}</code></li>
                    <li><code className="bg-black/20 px-1 rounded">Content-Type</code> : <code className="bg-black/20 px-1 rounded">application/json</code></li>
                  </ul>
                </li>
                <li>Pilih JSON Request Body sesuai kebutuhan:
                  <ul className="list-disc pl-4 mt-1 text-[10px] flex flex-col gap-1">
                    <li><strong>Tambah Tugas:</strong> Endpoint <code className="text-[var(--accent)]">/tasks</code><br />Body: <code className="text-[var(--text2)]">{"{ \"projectName\": \"Inbox\", \"taskName\": \"Tugas baru\" }"}</code></li>
                    <li><strong>Centang Habit:</strong> Endpoint <code className="text-[var(--accent)]">/habits/toggle</code><br />Body: <code className="text-[var(--text2)]">{"{ \"habitName\": \"Minum Air Putih\" }"}</code></li>
                    <li><strong>Catat Pengeluaran:</strong> Endpoint <code className="text-[var(--accent)]">/budget</code><br />Body: <code className="text-[var(--text2)]">{"{ \"type\": \"expense\", \"amount\": 20000, \"category\": \"Makanan\", \"note\": \"Kopi\" }"}</code></li>
                    <li><strong>Baca Notifikasi (polling):</strong> Endpoint <code className="text-[var(--accent)]">/notifications?token=&lt;API_KEY&gt;</code> dengan Method <strong>GET</strong> tanpa Headers.<br />Mengembalikan notifikasi sistem (pengingat habit, alert kadaluarsa) yang belum dibaca — cocok untuk Automation berkala. Panduan lengkap ada di <code className="bg-black/20 px-1 rounded">docs/shortcuts</code> repo.</li>
                    <li><strong>Kirim Data Apple Health:</strong> Endpoint <code className="text-[var(--accent)]">/health</code><br />Body: <code className="text-[var(--text2)]">{"{ \"metrics\": { \"sleep_minutes\": 430, \"steps\": 8200 } }"}</code><br />Metrik yang diterima: <code className="bg-black/20 px-1 rounded">sleep_minutes</code>, <code className="bg-black/20 px-1 rounded">steps</code>, <code className="bg-black/20 px-1 rounded">resting_hr</code>, <code className="bg-black/20 px-1 rounded">active_energy</code>, <code className="bg-black/20 px-1 rounded">weight_kg</code>. Data ini yang dipakai layar <strong>Pola</strong>.</li>
                  </ul>
                </li>
              </ol>

              {/* Panduan tersendiri: kirim-Health adalah satu-satunya endpoint
                  yang butuh aksi Health di dalam Shortcut, bukan sekadar
                  Get Contents of URL. */}
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--sep)' }}>
                <div className="text-[11px] font-bold mb-1" style={{ color: 'var(--text)' }}>
                  Automation Apple Health (untuk layar Pola)
                </div>
                <ol className="list-decimal pl-4 text-[10px] flex flex-col gap-1" style={{ color: 'var(--text2)' }}>
                  <li>Shortcuts → Automation → buat Personal Automation <strong>Time of Day</strong>, misalnya jam 08:00.</li>
                  <li>Tambah aksi <strong>Find Health Samples</strong>: Sleep Analysis, hari ini, hitung total menit.</li>
                  <li>Tambah <strong>Find Health Samples</strong> kedua untuk Steps, hari ini, jumlahkan.</li>
                  <li>Tambah <strong>Get Contents of URL</strong> ke endpoint <code className="text-[var(--accent)]">/health</code>, Method POST, Headers seperti di atas, Body JSON berisi kedua angka tadi.</li>
                  <li>Matikan <strong>Ask Before Running</strong> supaya berjalan sendiri tiap pagi.</li>
                </ol>
                <div className="text-[10px] mt-1.5" style={{ color: 'var(--text3)' }}>
                  Angka di luar batas wajar ditolak, jadi salah satuan (jam vs menit) tidak akan
                  diam-diam merusak analisis. Cek hasilnya dengan GET ke endpoint yang sama.
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Rekening & E-Wallet */}
      <section className="mb-6">
        <div className="flex justify-between items-center mb-3">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text3)' }}>
            REKENING & E-WALLET
          </p>
          <button
            onClick={() => setShowAddBank(s => !s)}
            className="text-xs font-bold"
            style={{ color: 'var(--accent)' }}
          >
            {showAddBank ? 'Batal' : '+ Tambah'}
          </button>
        </div>

        {/* Add Bank Form */}
        <AnimatePresence>
          {showAddBank && (
            <motion.div
              className="rounded-[18px] p-4 mb-3"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={collapse}
            >
              <div className="flex flex-col gap-2.5">
                <input
                  className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  placeholder="Nama Bank/E-Wallet (contoh: BCA, GoPay)"
                  value={newBankName}
                  onChange={e => setNewBankName(e.target.value)}
                />
                <div className="flex gap-2">
                  <select
                    className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                    value={newBankType}
                    onChange={e => setNewBankType(e.target.value)}
                  >
                    <option value="Bank">🏦 Bank</option>
                    <option value="E-Wallet">📱 E-Wallet</option>
                    <option value="Tunai">💵 Cash/Tunai</option>
                  </select>
                  <input
                    className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                    placeholder="Saldo Awal (Rp)"
                    value={newBankBalance}
                    onChange={e => setNewBankBalance(e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                  />
                </div>
                <button
                  onClick={handleAddBank}
                  disabled={savingBank}
                  className="neu-cta w-full py-2.5 rounded-xl text-xs font-bold text-white"
                  style={{ background: 'var(--accentFill)' }}
                >
                  {savingBank ? 'Menyimpan...' : 'Simpan Rekening'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bank Accounts List */}
        <div
          className="rounded-[18px] overflow-hidden"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
        >
          {loadingBanks ? (
            <div className="flex items-center justify-center py-4">
              <div className="w-4 h-4 rounded-full border border-t-transparent animate-spin"
                style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
            </div>
          ) : bankAccounts.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: 'var(--text3)' }}>
              Belum ada rekening terdaftar.
            </p>
          ) : (
            bankAccounts.map((bank, i) => (
              <div key={bank.id}>
                {i > 0 && <div className="h-px mx-4" style={{ background: 'var(--sep)' }} />}
                <div className="flex items-center justify-between px-4 py-3 text-xs">
                  <div>
                    <span className="font-semibold block" style={{ color: 'var(--text)' }}>
                      {bank.name}
                    </span>
                    <span className="text-[10px] block uppercase" style={{ color: 'var(--text3)' }}>
                      {bank.account_type === 'Bank' ? '🏦 Bank' : bank.account_type === 'E-Wallet' ? '📱 E-Wallet' : '💵 Tunai'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold" style={{ color: 'var(--text)' }}>
                      {formatRp(bank.balance)}
                    </span>
                    <button
                      onClick={() => handleDeleteBank(bank.id)}
                      className="w-6 h-6 flex items-center justify-center bg-red-950/10 rounded-lg"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--neg)" strokeWidth="2.5">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Export/Import Data Section */}
      <section className="mb-6">
        <p
          className="text-xs font-bold uppercase tracking-widest mb-3"
          style={{ color: 'var(--text3)' }}
        >
          DATA & BACKUP
        </p>
        <div className="flex gap-3">
          <motion.button
            className="neu-cta flex-1 py-3 rounded-xl text-xs font-bold text-white"
            style={{ background: 'var(--accentFill)' }}
            disabled={exportingData}
            onClick={handleExportData}
            whileTap={{ scale: 0.97 }}
            transition={springs.snappy}
          >
            {exportingData ? 'Mengekspor...' : '📥 Ekspor Data'}
          </motion.button>
          <motion.button
            className="flex-1 py-3 rounded-xl text-xs font-bold border"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
            disabled={importingData}
            onClick={handleImportData}
            whileTap={{ scale: 0.97 }}
            transition={springs.snappy}
          >
            {importingData ? 'Mengimpor...' : '📤 Impor Data'}
          </motion.button>
        </div>
      </section>

      {/* Logout */}
      <motion.button
        className="w-full py-3 rounded-2xl font-semibold text-center"
        style={{ background: 'rgba(255,69,58,0.12)', color: 'var(--neg)' }}
        onClick={handleLogout}
        whileTap={{ scale: 0.97 }}
        transition={springs.snappy}
      >
        Keluar
      </motion.button>
    </div>
  );
}
