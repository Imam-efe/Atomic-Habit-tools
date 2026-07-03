import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';

interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  expiry_date: string | null;
  purchase_date: string | null;
  category: string;
  note: string | null;
}

interface BankAccount {
  id: string;
  name: string;
  account_type: string;
  balance: number;
}

const CATEGORIES = ['Bahan Makanan', 'Bahan Dapur', 'Kebutuhan Mandi', 'Obat-obatan', 'Lainnya'];
const UNITS = ['pcs', 'kg', 'gr', 'liter', 'ml', 'box', 'pack', 'botol'];

function formatRp(n: number) {
  return n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}

export function Inventory() {
  const { setSubScreen } = useUIStore();
  const [activeTab, setActiveTab] = useState<'stok' | 'belanja'>('stok');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua');
  const [selectedStatus, setSelectedStatus] = useState<'Semua' | 'Aman' | 'Masa Pakai Tipis' | 'Kedaluwarsa'>('Semua');

  // Form State for Stock Items
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('pcs');
  const [expiryDate, setExpiryDate] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState('Bahan Makanan');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Buy Modal State (Links to Budget module)
  const [buyingItem, setBuyingItem] = useState<InventoryItem | null>(null);
  const [buyPrice, setBuyPrice] = useState('');
  const [buyQuantity, setBuyQuantity] = useState('1');
  const [buyExpiryDate, setBuyExpiryDate] = useState('');
  const [buyBankId, setBuyBankId] = useState('');
  const [savingPurchase, setSavingPurchase] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [invRes, banksRes] = await Promise.all([
        apiFetch<InventoryItem[]>('/inventory'),
        apiFetch<BankAccount[]>('/bank-accounts')
      ]);
      setItems(invRes);
      setBankAccounts(banksRes);
      if (banksRes.length > 0) {
        setBuyBankId(banksRes[0].id);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);

    const payload = {
      name: name.trim(),
      quantity: parseFloat(quantity) || 0,
      unit,
      expiry_date: expiryDate || null,
      purchase_date: purchaseDate || null,
      category,
      note: note.trim() || null
    };

    try {
      if (editingId) {
        await apiFetch(`/inventory/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await apiFetch('/inventory', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      load();
      resetForm();
    } catch {}
    setSaving(false);
  };

  // Record a purchase, update stock in inventory, and deduct budget
  const handleConfirmPurchase = async () => {
    if (!buyingItem) return;
    const price = parseInt(buyPrice.replace(/\D/g, ''));
    const qty = parseFloat(buyQuantity) || 1;
    if (!price || price <= 0) return;
    setSavingPurchase(true);

    try {
      // 1. Update stock quantity in inventory
      await apiFetch(`/inventory/${buyingItem.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: buyingItem.name,
          quantity: qty,
          unit: buyingItem.unit,
          expiry_date: buyExpiryDate || null,
          purchase_date: new Date().toISOString().slice(0, 10),
          category: buyingItem.category,
          note: buyingItem.note
        })
      });

      // 2. Add expense log to Budget module
      await apiFetch('/budget', {
        method: 'POST',
        body: JSON.stringify({
          type: 'expense',
          amount: price,
          category: buyingItem.category === 'Bahan Makanan' || buyingItem.category === 'Bahan Dapur' ? 'Makanan & Minuman' : 'Kebutuhan Rumah Tangga',
          note: `Beli ${buyingItem.name} (${qty} ${buyingItem.unit})`,
          date: new Date().toISOString().slice(0, 10),
          bank_account_id: buyBankId || undefined
        })
      });

      load();
      setBuyingItem(null);
      setBuyPrice('');
      setBuyQuantity('1');
      setBuyExpiryDate('');
    } catch {}
    setSavingPurchase(false);
  };

  const handleEdit = (item: InventoryItem) => {
    setEditingId(item.id);
    setName(item.name);
    setQuantity(String(item.quantity));
    setUnit(item.unit);
    setExpiryDate(item.expiry_date || '');
    setPurchaseDate(item.purchase_date || '');
    setCategory(item.category);
    setNote(item.note || '');
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Apakah Anda yakin ingin menghapus bahan ini dari inventaris?')) return;
    setItems(prev => prev.filter(item => item.id !== id));
    try {
      await apiFetch(`/inventory/${id}`, { method: 'DELETE' });
    } catch {
      load();
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setQuantity('1');
    setUnit('pcs');
    setExpiryDate('');
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setCategory('Bahan Makanan');
    setNote('');
    setShowForm(false);
  };

  const getExpiryStatus = (expiryDateStr: string | null) => {
    if (!expiryDateStr) return { label: 'Aman (Tanpa Ed)', color: '#34C759', status: 'Aman' as const };
    const expiry = new Date(expiryDateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);

    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { label: 'Kedaluwarsa', color: '#FF453A', status: 'Kedaluwarsa' as const, days: Math.abs(diffDays) };
    } else if (diffDays <= 3) {
      return { label: `Kedaluwarsa ${diffDays} hari`, color: '#FF9F0A', status: 'Masa Pakai Tipis' as const, days: diffDays };
    } else {
      return { label: `Sisa ${diffDays} hari`, color: '#34C759', status: 'Aman' as const, days: diffDays };
    }
  };

  // Determine Shopping list items (Quantity <= 0 OR expired)
  const shoppingItems = items.filter(item => {
    const isOutOfStock = item.quantity <= 0;
    const isExpired = item.expiry_date && getExpiryStatus(item.expiry_date).status === 'Kedaluwarsa';
    return isOutOfStock || isExpired;
  });

  const filteredItems = items.filter(item => {
    // Search filter
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.note && item.note.toLowerCase().includes(search.toLowerCase()));

    // Category filter
    const matchesCategory = selectedCategory === 'Semua' || item.category === selectedCategory;

    // Status filter
    const statusInfo = getExpiryStatus(item.expiry_date);
    const matchesStatus = selectedStatus === 'Semua' || statusInfo.status === selectedStatus;

    // In Stock tab -> don't show items with 0 quantity
    const isAvailable = item.quantity > 0;

    return matchesSearch && matchesCategory && matchesStatus && isAvailable;
  });

  return (
    <div className="min-h-screen px-5 pt-16 pb-28" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => setSubScreen(null)}
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
        >
          <span style={{ color: 'var(--accent)' }} className="text-xl">‹</span>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.5px' }}>
            Stok & Inventaris
          </h1>
          <p className="text-xs" style={{ color: 'var(--text2)' }}>
            Manajemen stok & evaluasi masa pakai bahan
          </p>
        </div>
        <motion.button
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: 'var(--accent)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={() => {
            if (activeTab === 'belanja') {
              // Add item to shopping list means creating a stock item with quantity 0
              setName('');
              setQuantity('0');
              setShowForm(true);
            } else {
              if (showForm) resetForm(); else setShowForm(true);
            }
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </motion.button>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl mb-4" style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}>
        <button
          onClick={() => { setActiveTab('stok'); setShowForm(false); }}
          className="py-2.5 rounded-lg text-xs font-bold text-center"
          style={{
            background: activeTab === 'stok' ? 'var(--bg)' : 'transparent',
            color: activeTab === 'stok' ? 'var(--text)' : 'var(--text3)',
          }}
        >
          📦 Daftar Stok ({items.filter(i => i.quantity > 0).length})
        </button>
        <button
          onClick={() => { setActiveTab('belanja'); setShowForm(false); }}
          className="py-2.5 rounded-lg text-xs font-bold text-center"
          style={{
            background: activeTab === 'belanja' ? 'var(--bg)' : 'transparent',
            color: activeTab === 'belanja' ? 'var(--text)' : 'var(--text3)',
          }}
        >
          🛒 Butuh Belanja ({shoppingItems.length})
        </button>
      </div>

      {/* Add / Edit Form Panel */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            className="rounded-[20px] p-4 mb-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.smooth}
          >
            <p className="text-sm font-bold mb-3" style={{ color: 'var(--text)' }}>
              {editingId ? 'Edit Barang' : activeTab === 'belanja' ? 'Catat Rencana Belanja Baru' : 'Tambah Barang'}
            </p>

            <div className="flex flex-col gap-2.5">
              <input
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                placeholder="Nama Barang (contoh: Susu UHT, Sabun Mandi)"
                value={name}
                onChange={e => setName(e.target.value)}
              />

              <div className="flex gap-2">
                <input
                  className="flex-1 px-3.5 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                  placeholder="Jumlah"
                  value={quantity}
                  disabled={activeTab === 'belanja' && !editingId} // default 0 for new shopping item
                  onChange={e => setQuantity(e.target.value)}
                  type="number"
                  step="any"
                />
                <select
                  className="w-28 px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                  value={unit}
                  onChange={e => setUnit(e.target.value)}
                >
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>

              {activeTab === 'stok' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text3)' }}>
                      Tanggal Beli
                    </label>
                    <input
                      type="date"
                      className="w-full px-3 py-2.5 rounded-xl text-xs outline-none"
                      style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                      value={purchaseDate}
                      onChange={e => setPurchaseDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text3)' }}>
                      Kedaluwarsa
                    </label>
                    <input
                      type="date"
                      className="w-full px-3 py-2.5 rounded-xl text-xs outline-none"
                      style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                      value={expiryDate}
                      onChange={e => setExpiryDate(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <select
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>

              <input
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                placeholder="Catatan / Posisi simpan (opsional)"
                value={note}
                onChange={e => setNote(e.target.value)}
              />

              <div className="flex gap-2 mt-2">
                <motion.button
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'var(--accent)', opacity: saving ? 0.6 : 1 }}
                  whileTap={{ scale: 0.97 }}
                  transition={springs.snappy}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </motion.button>
                <motion.button
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: 'var(--track)', color: 'var(--text2)' }}
                  whileTap={{ scale: 0.97 }}
                  transition={springs.snappy}
                  onClick={resetForm}
                >
                  Batal
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Purchase Modal Overlay */}
      <AnimatePresence>
        {buyingItem && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-[360px] rounded-3xl p-5 flex flex-col gap-4 shadow-2xl"
              style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
            >
              <div>
                <span className="text-[10px] font-bold text-orange-400 block uppercase mb-1">🛒 KONFIRMASI BELANJA</span>
                <h3 className="text-base font-bold text-white" style={{ color: 'var(--text)' }}>
                  Beli {buyingItem.name}?
                </h3>
                <p className="text-xs text-neutral-400">Barang akan diisi kembali ke stok inventaris.</p>
              </div>

              <div className="flex flex-col gap-3">
                <input
                  className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                  placeholder="Total Harga Belanja (Rp)"
                  value={buyPrice}
                  onChange={e => setBuyPrice(e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                />

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-bold text-neutral-400 block mb-1 uppercase">Jumlah Stok Baru</label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                      style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                      value={buyQuantity}
                      onChange={e => setBuyQuantity(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-neutral-400 block mb-1 uppercase">Expiry Baru (opsional)</label>
                    <input
                      type="date"
                      className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                      style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                      value={buyExpiryDate}
                      onChange={e => setBuyExpiryDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-bold text-neutral-400 block uppercase">Potong Dari Bank/E-Wallet</label>
                  <select
                    className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--sep)' }}
                    value={buyBankId}
                    onChange={e => setBuyBankId(e.target.value)}
                  >
                    <option value="">Cash/Tunai (Tanpa Bank)</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({formatRp(b.balance)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleConfirmPurchase}
                    disabled={savingPurchase}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white"
                    style={{ background: 'var(--accent)' }}
                  >
                    {savingPurchase ? 'Menyimpan...' : 'Bayar & Update Stok'}
                  </button>
                  <button
                    onClick={() => setBuyingItem(null)}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold"
                    style={{ background: 'var(--track)', color: 'var(--text2)' }}
                  >
                    Batal
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SEARCH AND FILTERS */}
      <div className="flex flex-col gap-3 mb-5">
        {/* Search */}
        <div className="relative">
          <input
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--sep)' }}
            placeholder={activeTab === 'stok' ? 'Cari barang di stok...' : 'Cari di daftar belanja...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <svg className="absolute left-3 top-3.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>

        {/* Categories Horizontal Scroll */}
        <div className="overflow-x-auto -mx-5 px-5 flex gap-1.5 scrollbar-none">
          {['Semua', ...CATEGORIES].map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className="px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all"
              style={{
                background: selectedCategory === cat ? 'var(--accentSoft)' : 'var(--surface)',
                color: selectedCategory === cat ? 'var(--accent)' : 'var(--text2)',
                border: `1px solid ${selectedCategory === cat ? 'var(--accent)' : 'var(--sep)'}`,
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Expiry Status Filter Tab (Only shown in Stok view) */}
        {activeTab === 'stok' && (
          <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}>
            {(['Semua', 'Aman', 'Masa Pakai Tipis', 'Kedaluwarsa'] as const).map(status => (
              <button
                key={status}
                onClick={() => setSelectedStatus(status)}
                className="py-1.5 rounded-lg text-[10px] font-bold text-center"
                style={{
                  background: selectedStatus === status ? 'var(--bg)' : 'transparent',
                  color: selectedStatus === status ? 'var(--text)' : 'var(--text3)',
                }}
              >
                {status === 'Masa Pakai Tipis' ? 'Warning' : status}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* FEED LIST */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : activeTab === 'stok' ? (
        /* STOK TAB */
        filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-4xl mb-3">📦</p>
            <p className="font-semibold text-sm" style={{ color: 'var(--text2)' }}>Stok Kosong</p>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>Belum ada barang di kategori ini</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filteredItems.map(item => {
              const exp = getExpiryStatus(item.expiry_date);
              return (
                <motion.div
                  key={item.id}
                  layout
                  className="rounded-[16px] p-3.5 flex flex-col gap-2.5 relative overflow-hidden"
                  style={{
                    background: 'var(--surface)',
                    border: `1px solid ${exp.status === 'Kedaluwarsa' ? 'rgba(255,69,58,0.25)' : exp.status === 'Masa Pakai Tipis' ? 'rgba(255,159,10,0.25)' : 'var(--sep)'}`,
                  }}
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: exp.color }} />

                  <div className="pl-2.5 flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm truncate" style={{ color: 'var(--text)' }}>
                          {item.name}
                        </h3>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider"
                          style={{ background: 'var(--track)', color: 'var(--text2)' }}>
                          {item.category}
                        </span>
                      </div>

                      <p className="text-xs font-semibold mt-1" style={{ color: 'var(--text2)' }}>
                        Jumlah: <span style={{ color: 'var(--text)' }}>{item.quantity} {item.unit}</span>
                      </p>

                      {item.note && (
                        <p className="text-[11px] italic mt-1" style={{ color: 'var(--text3)' }}>
                          📝 {item.note}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px]" style={{ color: 'var(--text3)' }}>
                        {item.purchase_date && (
                          <span>Beli: {new Date(item.purchase_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
                        )}
                        {item.expiry_date && (
                          <span>ED: {new Date(item.expiry_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2.5 flex-shrink-0 ml-2">
                      <span className="text-[10px] font-bold px-2 py-1 rounded-lg uppercase tracking-wider text-white"
                        style={{ background: exp.color }}>
                        {exp.label}
                      </span>

                      <div className="flex gap-1.5">
                        <motion.button
                          className="w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ background: 'var(--track)' }}
                          whileTap={{ scale: 0.85 }}
                          onClick={() => handleEdit(item)}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </motion.button>
                        <motion.button
                          className="w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ background: 'rgba(255,69,58,0.12)' }}
                          whileTap={{ scale: 0.85 }}
                          onClick={() => handleDelete(item.id)}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FF453A" strokeWidth="2.5">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </motion.button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )
      ) : (
        /* SHOPPING LIST TAB */
        shoppingItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-4xl mb-3">🛒</p>
            <p className="font-semibold text-sm" style={{ color: 'var(--text2)' }}>Daftar Belanja Bersih</p>
            <p className="text-xs" style={{ color: 'var(--text3)' }}>Semua stok terisi & aman dari kedaluwarsa</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {shoppingItems.map(item => {
              const isExpired = item.expiry_date && getExpiryStatus(item.expiry_date).status === 'Kedaluwarsa';
              return (
                <motion.div
                  key={item.id}
                  layout
                  className="rounded-[16px] p-4 flex items-center justify-between gap-3"
                  style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm text-white" style={{ color: 'var(--text)' }}>
                        {item.name}
                      </h4>
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase"
                        style={{
                          background: isExpired ? 'rgba(255,69,58,0.12)' : 'rgba(255,159,10,0.12)',
                          color: isExpired ? '#FF453A' : '#FF9F0A'
                        }}>
                        {isExpired ? 'Kedaluwarsa 🚨' : 'Habis 📦'}
                      </span>
                    </div>
                    <span className="text-xs block mt-0.5" style={{ color: 'var(--text3)' }}>
                      Kategori: {item.category} {item.unit ? `(${item.unit})` : ''}
                    </span>
                    {item.note && <span className="text-[10px] block italic text-neutral-400">📝 {item.note}</span>}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Beli & Catat Keuangan button */}
                    <button
                      onClick={() => setBuyingItem(item)}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-3 py-1.5 rounded-xl text-xs"
                    >
                      Beli ✓
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-2 rounded-xl bg-red-950/10"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FF453A" strokeWidth="2.5">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
