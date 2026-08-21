import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { CHART_PALETTE } from '@/constants/colors';
import { createWorker } from 'tesseract.js';

interface BudgetEntry {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  note: string | null;
  date: string;
  bank_account_id: string | null;
  receipt_img: string | null;
  recurrence?: string | null;
}

interface BudgetData {
  entries: BudgetEntry[];
  summary: { income: number; expense: number; balance: number };
}

interface BankAccount {
  id: string;
  name: string;
  account_type: string;
  balance: number;
}

interface CategoryLimit {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
}

const EXPENSE_CATEGORIES = [
  'Makanan & Minuman',
  'Transportasi & Bensin',
  'Kebutuhan Rumah Tangga',
  'Belanja Bulanan',
  'Tagihan & Utilitas',
  'Pendidikan & Anak',
  'Kesehatan & Obat',
  'Hiburan & Rekreasi',
  'Cicilan & Utang',
  'Investasi & Tabungan',
  'Lainnya'
];

const INCOME_CATEGORIES = ['Gaji', 'Freelance', 'Investasi', 'Bisnis', 'Lainnya'];

const MOCK_MERCHANTS = [
  { name: 'Kopi Kenangan', amount: 35000, category: 'Makanan & Minuman' },
  { name: 'SPBU Pertamina', amount: 150000, category: 'Transportasi & Bensin' },
  { name: 'Indomaret', amount: 85400, category: 'Kebutuhan Rumah Tangga' },
  { name: 'Kimia Farma', amount: 42000, category: 'Kesehatan & Obat' },
  { name: 'Superindo', amount: 320000, category: 'Belanja Bulanan' },
  { name: 'Solaria', amount: 185000, category: 'Makanan & Minuman' }
];

function formatRp(n: number) {
  return n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}

type RangePreset = '7d' | '30d' | '3m' | 'custom';

function jakartaToday() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

function jakartaDaysAgo(n: number) {
  return new Date(Date.now() + 7 * 3600000 - n * 86400000).toISOString().slice(0, 10);
}

function computeRange(preset: RangePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const today = jakartaToday();
  if (preset === '7d') return { from: jakartaDaysAgo(6), to: today };
  if (preset === '30d') return { from: jakartaDaysAgo(29), to: today };
  if (preset === '3m') return { from: jakartaDaysAgo(89), to: today };
  return { from: customFrom || today, to: customTo || today };
}

function parseOcrText(text: string): { merchant: string; amount: number; category: string; date: string } {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // 1. Find Merchant Name
  let merchant = 'Toko Terdeteksi';
  const filterKeywords = ['no', 'telp', 'jalan', 'jl.', 'phone', 'http', 'www', 'tgl', 'date', 'faktur', 'receipt', 'inv', 'transaksi'];
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i].toLowerCase();
    if (!filterKeywords.some(kw => line.includes(kw)) && !/\d{2,4}[-/.]\d{2}[-/.]\d{2,4}/.test(line) && line.length > 2) {
      merchant = lines[i].replace(/\b\w/g, c => c.toUpperCase());
      break;
    }
  }

  // 2. Find Date
  let dateStr = new Date().toISOString().slice(0, 10);
  const dateRegexes = [
    /(\d{4})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])/, // YYYY-MM-DD
    /(0[1-9]|[12]\d|3[01])[-/.](0[1-9]|1[0-2])[-/.](20\d{2}|\d{2})/, // DD-MM-YYYY or DD-MM-YY
  ];
  for (const line of lines) {
    let matched = false;
    for (const regex of dateRegexes) {
      const match = line.match(regex);
      if (match) {
        if (regex.source.startsWith('(\\d{4})')) {
          dateStr = `${match[1]}-${match[2]}-${match[3]}`;
        } else {
          const year = match[3].length === 2 ? `20${match[3]}` : match[3];
          dateStr = `${year}-${match[2]}-${match[1]}`;
        }
        matched = true;
        break;
      }
    }
    if (matched) break;
  }

  // 3. Find Amount
  let foundAmounts: { val: number; lineIndex: number; isTotalLine: boolean }[] = [];
  const totalKeywords = ['total', 'jumlah', 'net', 'grand', 'bayar', 'cash', 'tunai', 'debit', 'rp'];
  
  lines.forEach((line, idx) => {
    const lowerLine = line.toLowerCase();
    const isTotalLine = totalKeywords.some(kw => lowerLine.includes(kw)) && !lowerLine.includes('diskon') && !lowerLine.includes('promo') && !lowerLine.includes('item');
    
    const matches = line.match(/(?:Rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d{4,9})/gi);
    if (matches) {
      matches.forEach(match => {
        let cleaned = match.replace(/rp/i, '').replace(/\s/g, '');
        if (cleaned.endsWith(',00') || cleaned.endsWith('.00')) {
          cleaned = cleaned.slice(0, -3);
        }
        cleaned = cleaned.replace(/[.,]/g, '');
        const val = parseInt(cleaned, 10);
        if (val >= 1000 && val <= 50000000) {
          foundAmounts.push({ val, lineIndex: idx, isTotalLine });
        }
      });
    }
  });

  let amount = 0;
  const totalLines = foundAmounts.filter(a => a.isTotalLine);
  if (totalLines.length > 0) {
    amount = Math.max(...totalLines.map(a => a.val));
  } else if (foundAmounts.length > 0) {
    amount = Math.max(...foundAmounts.map(a => a.val));
  }

  // 4. Predict Category
  let category = 'Lainnya';
  const textLower = text.toLowerCase();
  
  const categoryKeywords: { [key: string]: string[] } = {
    'Makanan & Minuman': ['makan', 'minum', 'resto', 'cafe', 'kopi', 'coffee', 'bakso', 'mie', 'nasi', 'burger', 'pizza', 'food', 'drink', 'restoran', 'kuliner', 'warung', 'soto', 'tea', 'teh'],
    'Transportasi & Bensin': ['gojek', 'grab', 'gocar', 'grabcar', 'ride', 'bensin', 'pertamina', 'spbu', 'parkir', 'toll', 'tol', 'shell'],
    'Kebutuhan Rumah Tangga': ['sabun', 'shampoo', 'detergen', 'pewangi', 'tisu', 'tissue', 'odol', 'sikat', 'cuci', 'piring', 'bersih'],
    'Belanja Bulanan': ['indo', 'alfa', 'mart', 'supermarket', 'hypermart', 'transmart', 'carefour', 'grocery', 'belanja', 'pasar', 'toko', 'alfamidi'],
    'Tagihan & Utilitas': ['listrik', 'pln', 'pdam', 'internet', 'wifi', 'indihome', 'pulsa', 'bpjs', 'asuransi', 'telepon', 'subscription', 'netflix', 'spotify', 'air', 'token'],
    'Pendidikan & Anak': ['sekolah', 'buku', 'kursus', 'les', 'spp', 'kuliah', 'susu', 'popok', 'pampers', 'mainan', 'baby', 'anak'],
    'Kesehatan & Obat': ['apotek', 'obat', 'resep', 'sakit', 'klinik', 'puskesmas', 'dokter', 'hospital', 'sehat', 'vitamin', 'paracetamol', 'farma'],
    'Hiburan & Rekreasi': ['cinema', 'bioskop', 'movie', 'game', 'timezone', 'karaoke', 'rekreasi', 'wisata', 'tiket', 'nonton', 'mall'],
    'Cicilan & Utang': ['cicilan', 'angsuran', 'bayar utang', 'kredit', 'leasing', 'mandiri tunas', 'fif', 'adira'],
    'Investasi & Tabungan': ['investasi', 'tabung', 'saham', 'reksadana', 'emas', 'bibit', 'bareksa']
  };

  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(kw => textLower.includes(kw))) {
      category = cat;
      break;
    }
  }

  return { merchant, amount, category, date: dateStr };
}

export function Budget() {
  const [activeSubTab, setActiveSubTab] = useState<'transaksi' | 'budgeting'>('transaksi');
  const [data, setData] = useState<BudgetData | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [categoryLimits, setCategoryLimits] = useState<CategoryLimit[]>([]);
  const [loading, setLoading] = useState(true);

  // Transaction Form state
  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState('');
  const [recurrence, setRecurrence] = useState<'' | 'daily' | 'weekly' | 'monthly'>('');

  // View/Edit sheet state
  const [viewEntry, setViewEntry] = useState<BudgetEntry | null>(null);
  const [drillCategory, setDrillCategory] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editType, setEditType] = useState<'income' | 'expense'>('expense');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editBankAccountId, setEditBankAccountId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [receiptImg, setReceiptImg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // OCR Scanner Modal State
  const [showOcrModal, setShowOcrModal] = useState(false);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrResult, setOcrResult] = useState<{ merchant: string; amount: number; category: string; date: string } | null>(null);
  const [ocrFileUploaded, setOcrFileUploaded] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // Budget Limit Form state
  const [selectedLimitCat, setSelectedLimitCat] = useState(EXPENSE_CATEGORIES[0]);
  const [limitVal, setLimitVal] = useState('');
  const [savingLimit, setSavingLimit] = useState(false);

  // Calculator state
  const [calcDisplay, setCalcDisplay] = useState('');
  const [calcFormula, setCalcFormula] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ocrFileInputRef = useRef<HTMLInputElement>(null);

  const [rangePreset, setRangePreset] = useState<RangePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { from, to } = computeRange(rangePreset, customFrom, customTo);
      const [budgetRes, banksRes, limitsRes] = await Promise.all([
        apiFetch<BudgetData>(`/budget?from=${from}&to=${to}`),
        apiFetch<BankAccount[]>('/bank-accounts'),
        apiFetch<CategoryLimit[]>(`/budget/limits?month=${new Date().toISOString().slice(0, 7)}`)
      ]);

      setData(budgetRes);
      setBankAccounts(banksRes);
      setCategoryLimits(limitsRes);

      if (banksRes.length > 0 && !bankAccountId) {
        setBankAccountId(banksRes[0].id);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeSubTab, rangePreset, customFrom, customTo]);

  // Handle receipt image upload & compression
  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const max_size = 1200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > max_size) {
            height *= max_size / width;
            width = max_size;
          }
        } else {
          if (height > max_size) {
            width *= max_size / height;
            height = max_size;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        setReceiptImg(compressedBase64);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // OCR Real Scanner
  const triggerOcrScan = async (fileOrMock: File | 'mock') => {
    setOcrScanning(true);
    setOcrResult(null);
    setOcrError(null);

    if (fileOrMock === 'mock') {
      // Simulate 2.5 second scan laser animation
      setTimeout(() => {
        const randomTx = MOCK_MERCHANTS[Math.floor(Math.random() * MOCK_MERCHANTS.length)];
        setOcrResult({
          merchant: randomTx.name,
          amount: randomTx.amount,
          category: randomTx.category,
          date: new Date().toISOString().slice(0, 10)
        });
        setOcrScanning(false);
      }, 2000);
      return;
    }

    try {
      const worker = await createWorker('ind+eng');
      const { data: { text } } = await worker.recognize(fileOrMock);
      await worker.terminate();

      if (!text || text.trim().length === 0) {
        throw new Error("Tidak ada teks yang berhasil dibaca. Pastikan foto struk cukup terang dan tajam.");
      }

      const parsed = parseOcrText(text);
      setOcrResult(parsed);
    } catch (err: any) {
      console.error(err);
      setOcrError(err.message || "Gagal memproses struk. Silakan coba unggah foto yang lebih jelas.");
    } finally {
      setOcrScanning(false);
    }
  };

  const handleOcrFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOcrFileUploaded(true);
    
    // Run OCR on the original File for better accuracy
    triggerOcrScan(file);

    // Compress in parallel for storage
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const max_size = 1200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > max_size) {
            height *= max_size / width;
            width = max_size;
          }
        } else {
          if (height > max_size) {
            width *= max_size / height;
            height = max_size;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        setReceiptImg(compressedBase64);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const applyOcrResult = () => {
    if (!ocrResult) return;
    setAmount(String(ocrResult.amount));
    setNote(ocrResult.merchant);
    setCategory(ocrResult.category);
    setDate(ocrResult.date);
    setShowOcrModal(false);
    setOcrResult(null);
    setOcrFileUploaded(false);
    setOcrError(null);
  };

  const addEntry = async () => {
    const amt = parseInt(amount.replace(/\D/g, ''));
    if (!amt || amt <= 0) return;
    setSaving(true);
    try {
      await apiFetch<BudgetEntry>('/budget', {
        method: 'POST',
        body: JSON.stringify({
          type,
          amount: amt,
          category,
          note: note.trim() || undefined,
          date,
          bank_account_id: bankAccountId || undefined,
          receipt_img: receiptImg || undefined,
          recurrence: recurrence || undefined,
        }),
      });
      load();
      setAmount('');
      setNote('');
      setReceiptImg(null);
      setRecurrence('');
      setShowAdd(false);
    } catch {}
    setSaving(false);
  };

  const deleteEntry = async (id: string) => {
    setData(d => d ? {
      ...d,
      entries: d.entries.filter(e => e.id !== id)
    } : d);

    try {
      await apiFetch(`/budget/${id}`, { method: 'DELETE' });
      load();
    } catch {
      load();
    }
  };

  const openSheet = (entry: BudgetEntry) => {
    setViewEntry(entry);
    setEditMode(false);
    setEditType(entry.type);
    setEditAmount(String(entry.amount));
    setEditCategory(entry.category);
    setEditNote(entry.note ?? '');
    setEditDate(entry.date);
    setEditBankAccountId(entry.bank_account_id ?? '');
  };

  const saveEdit = async () => {
    if (!viewEntry) return;
    const amt = parseInt(editAmount.replace(/\D/g, ''));
    if (!amt || amt <= 0) return;
    setSavingEdit(true);
    try {
      await apiFetch(`/budget/${viewEntry.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          type: editType,
          amount: amt,
          category: editCategory,
          note: editNote.trim() || undefined,
          date: editDate,
          bank_account_id: editBankAccountId || undefined,
        }),
      });
      setViewEntry(null);
      setEditMode(false);
      load();
    } catch {}
    setSavingEdit(false);
  };

  const handleUpdateLimit = async () => {
    const limit = parseInt(limitVal.replace(/\D/g, ''));
    if (limit === undefined || isNaN(limit)) return;
    setSavingLimit(true);
    try {
      await apiFetch('/budget/limits', {
        method: 'POST',
        body: JSON.stringify({
          category: selectedLimitCat,
          limit,
          month: new Date().toISOString().slice(0, 7)
        })
      });
      setLimitVal('');
      load();
    } catch {}
    setSavingLimit(false);
  };

  // Calculator Logic
  const pressCalcButton = (val: string) => {
    if (val === 'C') {
      setCalcDisplay('');
      setCalcFormula('');
    } else if (val === '=') {
      try {
        const sanitized = calcFormula.replace(/[^0-9+\-*/.]/g, '');
        const res = Function(`"use strict"; return (${sanitized})`)();
        if (res !== undefined && !isNaN(res)) {
          setCalcDisplay(String(res));
          setCalcFormula(String(res));
        } else {
          setCalcDisplay('Error');
        }
      } catch {
        setCalcDisplay('Error');
      }
    } else {
      setCalcDisplay(prev => prev + val);
      setCalcFormula(prev => prev + val);
    }
  };

  const applyCalculatorValue = () => {
    if (calcDisplay && !isNaN(parseFloat(calcDisplay))) {
      setAmount(String(Math.round(parseFloat(calcDisplay))));
      if (showAdd) {
        window.scrollTo({ top: 100, behavior: 'smooth' });
      } else {
        setShowAdd(true);
        window.scrollTo({ top: 100, behavior: 'smooth' });
      }
    }
  };

  const cats = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  return (
    <div className="min-h-screen px-5 pt-16 pb-28" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}>
          Keuangan
        </h1>
        <motion.button
          className="neu-cta w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: 'var(--accentFill)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={() => { setShowAdd(s => !s); if (!showAdd) setActiveSubTab('transaksi'); }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </motion.button>
      </div>

      {/* Main Tabs switcher */}
      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl mb-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
        <button
          onClick={() => setActiveSubTab('transaksi')}
          className="py-2 rounded-lg text-xs font-bold text-center"
          style={{
            background: activeSubTab === 'transaksi' ? 'var(--bg)' : 'transparent',
            color: activeSubTab === 'transaksi' ? 'var(--text)' : 'var(--text3)',
          }}
        >
          📝 Transaksi
        </button>
        <button
          onClick={() => setActiveSubTab('budgeting')}
          className="py-2 rounded-lg text-xs font-bold text-center"
          style={{
            background: activeSubTab === 'budgeting' ? 'var(--bg)' : 'transparent',
            color: activeSubTab === 'budgeting' ? 'var(--text)' : 'var(--text3)',
          }}
        >
          📊 Budgeting
        </button>
      </div>

      {/* OCR Scanner Modal */}
      <AnimatePresence>
        {showOcrModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/70 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-[380px] rounded-3xl p-5 flex flex-col gap-4 shadow-2xl relative overflow-hidden"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ scale: 0.9, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 30 }}
            >
              <div>
                <span className="text-[10px] font-black text-[var(--accent)] block uppercase mb-1">🤖 AI RECEIPT SCANNER</span>
                <h3 className="text-base font-bold text-white" style={{ color: 'var(--text)' }}>
                  Pindai Struk Belanja Anda
                </h3>
                <p className="text-xs text-[var(--text2)]">Analisis cepat toko, jumlah, tanggal & kategori menggunakan AI.</p>
              </div>

              {/* Upload area or Scanner view */}
              <div
                className="min-h-[11rem] rounded-2xl flex flex-col items-center justify-center border border-dashed relative overflow-hidden bg-black/25 p-2"
                style={{ borderColor: 'var(--sep)' }}
              >
                {ocrScanning && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45">
                    {/* Glowing scanning laser line */}
                    <motion.div
                      className="absolute left-0 right-0 h-1 bg-red-500 shadow-[0_0_10px_#ff0000] z-10"
                      initial={{ top: '0%' }}
                      animate={{ top: '100%' }}
                      transition={{ duration: 1.2, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
                    />
                    <p className="text-xs font-bold text-[var(--neg)] animate-pulse z-10">Menganalisis Struk...</p>
                  </div>
                )}

                {ocrError && (
                  <div className="p-3 w-full text-center text-[var(--neg)] text-xs flex flex-col gap-2">
                    <p>⚠️ {ocrError}</p>
                    <button
                      onClick={() => setOcrError(null)}
                      className="text-xs font-bold underline"
                      style={{ color: 'var(--accent)' }}
                    >
                      Coba Lagi
                    </button>
                  </div>
                )}

                {!ocrScanning && !ocrResult && !ocrError && (
                  <div className="flex flex-col items-center gap-2.5 py-4">
                    <button
                      onClick={() => ocrFileInputRef.current?.click()}
                      className="neu-cta px-4 py-2 rounded-xl text-xs font-bold text-white shadow-md hover:opacity-90 active:scale-95 transition-all"
                      style={{ background: 'var(--accentFill)' }}
                    >
                      📁 Pilih Foto Struk
                    </button>
                    <input
                      type="file"
                      accept="image/*"
                      ref={ocrFileInputRef}
                      className="hidden"
                      onChange={handleOcrFileSelected}
                    />
                    <span className="text-[10px] text-[var(--text3)]">ATAU</span>
                    <button
                      onClick={() => triggerOcrScan('mock')}
                      className="text-xs font-bold underline hover:opacity-80 transition-opacity"
                      style={{ color: 'var(--accent)' }}
                    >
                      Pindai Cepat (Simulasi)
                    </button>
                  </div>
                )}

                {ocrResult && !ocrScanning && (
                  <div className="w-full max-h-64 overflow-y-auto pr-1 flex flex-col gap-3 text-xs">
                    <div className="flex justify-between items-center border-b border-white/5 pb-1">
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">HASIL DETEKSI OCR ✓</span>
                      {receiptImg && (
                        <img src={receiptImg} alt="Receipt preview" className="w-8 h-8 rounded object-cover border border-white/10" />
                      )}
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-[var(--text2)] font-semibold">Nama Toko / Catatan</label>
                      <input
                        type="text"
                        value={ocrResult.merchant}
                        onChange={(e) => setOcrResult({ ...ocrResult, merchant: e.target.value })}
                        className="w-full bg-black/45 text-white rounded-xl p-2 border border-white/10 outline-none focus:border-violet-400 text-xs"
                      />
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-[var(--text2)] font-semibold">Jumlah Pembayaran (Rp)</label>
                      <input
                        type="number"
                        value={ocrResult.amount || ''}
                        onChange={(e) => setOcrResult({ ...ocrResult, amount: parseInt(e.target.value, 10) || 0 })}
                        className="w-full bg-black/45 text-white rounded-xl p-2 border border-white/10 outline-none focus:border-violet-400 text-xs font-bold text-emerald-400"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-[var(--text2)] font-semibold">Kategori</label>
                      <select
                        value={ocrResult.category}
                        onChange={(e) => setOcrResult({ ...ocrResult, category: e.target.value })}
                        className="w-full bg-black/45 text-white rounded-xl p-2 border border-white/10 outline-none focus:border-violet-400 text-xs"
                        style={{ colorScheme: 'dark' }}
                      >
                        {EXPENSE_CATEGORIES.map(cat => (
                          <option key={cat} value={cat} className="bg-neutral-900 text-white">{cat}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-[var(--text2)] font-semibold">Tanggal</label>
                      <input
                        type="date"
                        value={ocrResult.date}
                        onChange={(e) => setOcrResult({ ...ocrResult, date: e.target.value })}
                        className="w-full bg-black/45 text-white rounded-xl p-2 border border-white/10 outline-none focus:border-violet-400 text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                {ocrResult && (
                  <button
                    onClick={applyOcrResult}
                    className="neu-cta flex-1 py-2.5 rounded-xl text-xs font-bold text-white"
                    style={{ background: 'var(--accentFill)' }}
                  >
                    📥 Terapkan Ke Formulir
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowOcrModal(false);
                    setOcrResult(null);
                    setOcrFileUploaded(false);
                  }}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold"
                  style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                >
                  Tutup
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add form */}
      <AnimatePresence>
        {showAdd && activeSubTab === 'transaksi' && (
          <motion.div
            className="rounded-[18px] p-4 mb-4"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.smooth}
          >
            <div className="flex justify-between items-center mb-3">
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Tambah Transaksi</p>
              <button
                type="button"
                onClick={() => setShowOcrModal(true)}
                className="neu-cta px-3 py-1 rounded-lg text-xs font-bold text-white"
                style={{ background: 'var(--accentFill)' }}
              >
                🤖 AI Scan Struk
              </button>
            </div>

            {/* Type toggle */}
            <div className="flex gap-2 mb-3">
              {(['expense', 'income'] as const).map(t => (
                <motion.button
                  key={t}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold"
                  style={{
                    background: type === t ? (t === 'expense' ? 'var(--negFill)' : 'var(--posFill)') : 'var(--track)',
                    color: type === t ? 'white' : 'var(--text2)',
                  }}
                  whileTap={{ scale: 0.97 }}
                  transition={springs.snappy}
                  onClick={() => { setType(t); setCategory(t === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]); }}
                >
                  {t === 'expense' ? 'Pengeluaran' : 'Pemasukan'}
                </motion.button>
              ))}
            </div>

            <div className="flex flex-col gap-2.5 mb-3">
              <input
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Jumlah (Rp)"
                value={amount}
                onChange={e => setAmount(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
              />

              <div className="grid grid-cols-2 gap-2">
                <select
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                >
                  {cats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <input
                  type="date"
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={date}
                  onChange={e => setDate(e.target.value)}
                />
              </div>

              {/* Bank accounts allocator */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[var(--text2)] uppercase tracking-wider pl-1">Sumber Uang / Bank</label>
                <select
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={bankAccountId}
                  onChange={e => setBankAccountId(e.target.value)}
                >
                  <option value="">Cash/Tunai (Tanpa Bank)</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.account_type} - {formatRp(b.balance)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[var(--text2)] uppercase tracking-wider pl-1">Pengulangan (Opsional)</label>
                <select
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={recurrence}
                  onChange={e => setRecurrence(e.target.value as '' | 'daily' | 'weekly' | 'monthly')}
                >
                  <option value="">Tidak berulang</option>
                  <option value="daily">Setiap hari</option>
                  <option value="weekly">Setiap minggu</option>
                  <option value="monthly">Setiap bulan</option>
                </select>
              </div>

              <input
                className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                placeholder="Catatan / Keterangan (opsional)"
                value={note}
                onChange={e => setNote(e.target.value)}
              />

              {/* Receipt photo upload */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-[var(--text2)] uppercase tracking-wider pl-1">Lampirkan Struk / Nota</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold"
                    style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                  >
                    📸 Pilih Struk
                  </button>
                  <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handleReceiptUpload}
                  />
                  {receiptImg && (
                    <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-emerald-500">
                      <img src={receiptImg} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setReceiptImg(null)}
                        className="absolute right-0 top-0 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[8px]"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <motion.button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: type === 'expense' ? 'var(--negFill)' : 'var(--posFill)', opacity: saving ? 0.6 : 1 }}
                whileTap={{ scale: 0.97 }}
                transition={springs.snappy}
                onClick={addEntry}
                disabled={saving}
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </motion.button>
              <motion.button
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                whileTap={{ scale: 0.97 }}
                transition={springs.snappy}
                onClick={() => { setShowAdd(false); setAmount(''); setNote(''); setReceiptImg(null); setRecurrence(''); }}
              >
                Batal
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* VIEW: TRANSAKSI */}
      {activeSubTab === 'transaksi' && (
        <div className="flex flex-col gap-4">
          {/* Date Range Filter */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-1.5">
              {(['7d', '30d', '3m', 'custom'] as RangePreset[]).map(p => (
                <motion.button
                  key={p}
                  className="flex-1 py-1.5 rounded-xl text-[11px] font-bold"
                  style={{
                    background: rangePreset === p ? 'var(--accentFill)' : 'var(--track)',
                    color: rangePreset === p ? 'white' : 'var(--text2)',
                  }}
                  whileTap={{ scale: 0.95 }}
                  transition={springs.snappy}
                  onClick={() => setRangePreset(p)}
                >
                  {p === '7d' ? '7 Hari' : p === '30d' ? '30 Hari' : p === '3m' ? '3 Bulan' : 'Kustom'}
                </motion.button>
              ))}
            </div>
            {rangePreset === 'custom' && (
              <motion.div
                className="flex gap-2 items-center"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={springs.smooth}
              >
                <input
                  type="date"
                  className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                />
                <span className="text-xs" style={{ color: 'var(--text3)' }}>–</span>
                <input
                  type="date"
                  className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                />
              </motion.div>
            )}
          </div>
          {/* Summary card */}
          {data && (
            <motion.div
              className="rounded-[18px] p-4"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.gentle}
            >
              <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text3)' }}>
                RINGKASAN {new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }).toUpperCase()}
              </p>
              <div className="flex gap-3">
                <div className="flex-1 rounded-xl p-3" style={{ background: 'rgba(52,199,89,0.1)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--pos)' }}>Pemasukan</p>
                  <p className="text-base font-bold" style={{ color: 'var(--pos)' }}>{formatRp(data.summary.income)}</p>
                </div>
                <div className="flex-1 rounded-xl p-3" style={{ background: 'rgba(255,69,58,0.1)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--neg)' }}>Pengeluaran</p>
                  <p className="text-base font-bold" style={{ color: 'var(--neg)' }}>{formatRp(data.summary.expense)}</p>
                </div>
              </div>
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--sep)' }}>
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text3)' }}>Saldo Bulan Ini</p>
                    <p className="text-xl font-bold" style={{ color: data.summary.balance >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                      {formatRp(data.summary.balance)}
                    </p>
                  </div>
                  {data.summary.income > 0 && (
                    <div className="text-right">
                      <span className="text-[10px] font-bold uppercase tracking-wider block" style={{ color: 'var(--text3)' }}>Saving Rate</span>
                      <span className="text-sm font-bold text-emerald-400">
                        {Math.round(((data.summary.income - data.summary.expense) / data.summary.income) * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Category distribution chart */}
          {data && data.summary.expense > 0 && (
            <motion.div
              className="rounded-[18px] p-4"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            >
              <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text3)' }}>
                Distribusi Pengeluaran
              </p>
              <div className="h-4 rounded-lg overflow-hidden flex mb-4">
                {(() => {
                  const expenseEntries = data.entries.filter(e => e.type === 'expense');
                  const totalExpense = data.summary.expense;
                  const expenseCatMap: Record<string, number> = {};
                  expenseEntries.forEach(e => {
                    expenseCatMap[e.category] = (expenseCatMap[e.category] || 0) + e.amount;
                  });

                  const expenseCategoriesList = Object.entries(expenseCatMap)
                    .map(([name, amount]) => ({
                      name,
                      amount,
                      pct: totalExpense > 0 ? (amount / totalExpense) * 100 : 0
                    }))
                    .sort((a, b) => b.amount - a.amount);

                  const colors = CHART_PALETTE;

                  return (
                    <div className="w-full flex h-full">
                      {expenseCategoriesList.map((cat, idx) => (
                        <div
                          key={cat.name}
                          style={{
                            background: colors[idx % colors.length],
                            width: `${cat.pct}%`
                          }}
                          title={`${cat.name}: ${formatRp(cat.amount)} (${Math.round(cat.pct)}%)`}
                        />
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(() => {
                  const expenseEntries = data.entries.filter(e => e.type === 'expense');
                  const totalExpense = data.summary.expense;
                  const expenseCatMap: Record<string, number> = {};
                  expenseEntries.forEach(e => {
                    expenseCatMap[e.category] = (expenseCatMap[e.category] || 0) + e.amount;
                  });

                  const expenseCategoriesList = Object.entries(expenseCatMap)
                    .map(([name, amount]) => ({
                      name,
                      amount,
                      pct: totalExpense > 0 ? (amount / totalExpense) * 100 : 0
                    }))
                    .sort((a, b) => b.amount - a.amount);

                  const colors = CHART_PALETTE;

                  return expenseCategoriesList.map((cat, idx) => (
                    <div key={cat.name} className="flex items-center gap-1.5 text-[10px]">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colors[idx % colors.length] }} />
                      <span style={{ color: 'var(--text2)' }} className="truncate flex-1">{cat.name}</span>
                      <span style={{ color: 'var(--text)' }} className="font-bold">{Math.round(cat.pct)}%</span>
                    </div>
                  ));
                })()}
              </div>
            </motion.div>
          )}

          {/* Transactions List */}
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
            </div>
          ) : data?.entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-3xl mb-2">💰</p>
              <p className="font-semibold text-sm" style={{ color: 'var(--text2)' }}>Belum Ada Transaksi</p>
              <p className="text-xs" style={{ color: 'var(--text3)' }}>Tekan "+" untuk mencatat pengeluaran/pemasukan</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <AnimatePresence>
                {data?.entries.map(entry => (
                  <motion.div
                    key={entry.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="rounded-[14px] px-4 py-3.5 flex items-center gap-3 relative overflow-hidden cursor-pointer"
                    style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
                    onClick={() => openSheet(entry)}
                  >
                    <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-base"
                      style={{ background: entry.type === 'income' ? 'rgba(52,199,89,0.15)' : 'rgba(255,69,58,0.12)' }}>
                      {entry.type === 'income' ? '📈' : '📉'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>{entry.category}</p>
                        <span className="text-[9px]" style={{ color: 'var(--text3)' }}>{entry.date}</span>
                      </div>
                      {entry.note && <p className="text-xs truncate" style={{ color: 'var(--text3)' }}>{entry.note}</p>}
                      
                      {/* Show allocated bank account */}
                      {entry.bank_account_id && (() => {
                        const matchedBank = bankAccounts.find(b => b.id === entry.bank_account_id);
                        return matchedBank ? (
                          <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/5 mt-1 text-[var(--text2)]">
                            🏦 {matchedBank.name}
                          </span>
                        ) : null;
                      })()}
                    </div>

                    {/* Receipt thumb if attached */}
                    {entry.receipt_img && (
                      <div className="w-8 h-8 rounded-lg overflow-hidden border border-zinc-700 flex-shrink-0">
                        <img src={entry.receipt_img} className="w-full h-full object-cover" onClick={() => alert('Foto Struk terlampir')} />
                      </div>
                    )}

                    <p className="text-sm font-bold flex-shrink-0"
                      style={{ color: entry.type === 'income' ? 'var(--pos)' : 'var(--neg)' }}>
                      {entry.type === 'income' ? '+' : '-'}{formatRp(entry.amount)}
                    </p>

                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* VIEW: BUDGETING */}
      {activeSubTab === 'budgeting' && (
        <div className="flex flex-col gap-4">
          {/* Add/Update Limit Panel */}
          <div className="rounded-[18px] p-4" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text2)' }}>
              Set Limit Bulanan Kategori
            </p>
            <div className="flex flex-col gap-2.5">
              <select
                className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                value={selectedLimitCat}
                onChange={e => setSelectedLimitCat(e.target.value)}
              >
                {EXPENSE_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>

              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  placeholder="Batas Limit (Rp)"
                  value={limitVal}
                  onChange={e => setLimitVal(e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                />
                <button
                  onClick={handleUpdateLimit}
                  disabled={savingLimit}
                  className="neu-cta px-4 py-2 rounded-xl text-xs font-bold text-white flex-shrink-0"
                  style={{ background: 'var(--accentFill)' }}
                >
                  {savingLimit ? 'Menyimpan...' : 'Simpan Batas'}
                </button>
              </div>
            </div>
          </div>

          {/* Budget Progress Lists */}
          <div className="flex flex-col gap-3">
            {categoryLimits.map(cat => {
              const spentPct = cat.limit > 0 ? (cat.spent / cat.limit) * 100 : 0;
              const progressColor = spentPct >= 100 ? 'var(--neg)' : spentPct >= 80 ? 'var(--warn)' : 'var(--accent)';
              
              return (
                <div
                  key={cat.category}
                  className="rounded-[16px] p-4 flex flex-col gap-2.5 cursor-pointer active:opacity-80"
                  style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
                  onClick={() => setDrillCategory(cat.category)}
                >
                  <div className="flex justify-between items-center text-xs">
                    <div>
                      <span className="font-bold text-sm block" style={{ color: 'var(--text)' }}>
                        {cat.category}
                      </span>
                      {cat.limit > 0 && (
                        <span className="text-[10px] block mt-0.5" style={{ color: 'var(--text3)' }}>
                          Sisa Budget: <span className="font-semibold text-emerald-400">{formatRp(cat.remaining)}</span>
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-xs block" style={{ color: 'var(--text)' }}>
                        {formatRp(cat.spent)} <span style={{ color: 'var(--text3)' }}>/ {cat.limit > 0 ? formatRp(cat.limit) : '∞'}</span>
                      </span>
                      {cat.limit > 0 && (
                        <span className="text-[9px] font-bold block mt-0.5" style={{ color: progressColor }}>
                          {Math.round(spentPct)}% {spentPct >= 100 ? 'LIMIT TERCAPAI 🚨' : spentPct >= 80 ? 'WARNING ⚠️' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {cat.limit > 0 && (
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          background: progressColor,
                          width: `${Math.min(100, spentPct)}%`
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CALCULATOR WIDGET */}
      <div className="mt-8 pt-5" style={{ borderTop: '1px solid var(--sep)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text2)] pl-1 mb-2.5">🧮 KALKULATOR BANTUAN</p>
        <div className="rounded-[18px] p-4 flex flex-col gap-3" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
          {/* Calc Display */}
          <div className="px-3.5 py-2.5 rounded-xl text-right text-base font-mono flex items-center justify-between"
            style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}>
            <span className="text-xs" style={{ color: 'var(--text3)' }}>{calcFormula || 'Formula'}</span>
            <span className="font-bold text-lg" style={{ color: 'var(--text)' }}>{calcDisplay || '0'}</span>
          </div>

          {/* Calc Buttons grid */}
          <div className="grid grid-cols-4 gap-2">
            {['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', 'C', '=', '+'].map(btn => {
              const isOperator = ['/', '*', '-', '+', '='].includes(btn);
              const isClear = btn === 'C';
              
              return (
                <button
                  key={btn}
                  onClick={() => pressCalcButton(btn)}
                  className="py-2.5 rounded-xl text-sm font-bold flex items-center justify-center transition-all"
                  style={{
                    background: isClear ? 'rgba(255,69,58,0.12)' : isOperator ? 'var(--track)' : 'var(--bg)',
                    color: isClear ? 'var(--neg)' : 'var(--text)',
                    border: '1px solid var(--sep)'
                  }}
                >
                  {btn}
                </button>
              );
            })}
          </div>

          {/* Apply Value CTA Button */}
          {calcDisplay && !isNaN(parseFloat(calcDisplay)) && (
            <button
              onClick={applyCalculatorValue}
              className="neu-cta w-full py-2 rounded-xl text-xs font-bold text-white transition-all"
              style={{ background: 'var(--accentFill)' }}
            >
              📥 Gunakan Hasil ({formatRp(parseFloat(calcDisplay))}) Ke Jumlah Form
            </button>
          )}
        </div>
      </div>
      {/* Category Drill-Down Fullscreen Modal */}
      <AnimatePresence>
        {drillCategory && (() => {
          const drillEntries = data?.entries.filter(e => e.category === drillCategory) ?? [];
          const catLimit = categoryLimits.find(c => c.category === drillCategory);
          const totalSpent = drillEntries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
          const totalIncome = drillEntries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
          const grouped = drillEntries.reduce<Record<string, BudgetEntry[]>>((acc, e) => {
            if (!acc[e.date]) acc[e.date] = [];
            acc[e.date].push(e);
            return acc;
          }, {});
          const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

          return (
            <motion.div
              className="fixed inset-0 z-50 max-w-[430px] mx-auto flex flex-col"
              style={{ background: 'var(--bg)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={springs.smooth}
            >
              <div className="flex items-center gap-3 px-5 pt-6 pb-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--sep)' }}>
                <button onClick={() => setDrillCategory(null)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--text)' }}>
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <div className="flex-1">
                  <p className="font-bold text-base" style={{ color: 'var(--text)' }}>{drillCategory}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text3)' }}>{drillEntries.length} transaksi</p>
                </div>
              </div>
              <div className="flex gap-3 px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--sep)' }}>
                {totalSpent > 0 && (
                  <div className="flex-1 rounded-xl p-3" style={{ background: 'rgba(255,69,58,0.08)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Total Keluar</p>
                    <p className="text-base font-extrabold text-[var(--neg)]">{formatRp(totalSpent)}</p>
                  </div>
                )}
                {totalIncome > 0 && (
                  <div className="flex-1 rounded-xl p-3" style={{ background: 'rgba(52,199,89,0.08)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Total Masuk</p>
                    <p className="text-base font-extrabold text-[var(--pos)]">{formatRp(totalIncome)}</p>
                  </div>
                )}
                {catLimit && catLimit.limit > 0 && (
                  <div className="flex-1 rounded-xl p-3" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-inset)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>Sisa Limit</p>
                    <p className="text-base font-extrabold" style={{ color: catLimit.remaining <= 0 ? 'var(--neg)' : 'var(--pos)' }}>
                      {formatRp(catLimit.remaining)}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {drillEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-2">
                    <p className="text-3xl">📭</p>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text2)' }}>Tidak ada transaksi</p>
                    <p className="text-xs" style={{ color: 'var(--text3)' }}>Dalam rentang tanggal yang dipilih</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    {sortedDates.map(date => (
                      <div key={date}>
                        <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text3)' }}>
                          {new Date(date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </p>
                        <div className="flex flex-col gap-2">
                          {grouped[date].map(entry => (
                            <div key={entry.id}
                              className="rounded-[14px] px-4 py-3 flex items-center gap-3 cursor-pointer"
                              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
                              onClick={() => { setDrillCategory(null); setTimeout(() => openSheet(entry), 300); }}>
                              <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-sm"
                                style={{ background: entry.type === 'income' ? 'rgba(52,199,89,0.15)' : 'rgba(255,69,58,0.12)' }}>
                                {entry.type === 'income' ? '📈' : '📉'}
                              </div>
                              <div className="flex-1 min-w-0">
                                {entry.note && <p className="text-xs truncate" style={{ color: 'var(--text3)' }}>{entry.note}</p>}
                              </div>
                              <p className="text-sm font-bold flex-shrink-0"
                                style={{ color: entry.type === 'income' ? 'var(--pos)' : 'var(--neg)' }}>
                                {entry.type === 'income' ? '+' : '-'}{formatRp(entry.amount)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Transaction View/Edit Bottom Sheet */}
      <AnimatePresence>
        {viewEntry && (
          <>
            <motion.div
              className="fixed inset-0 z-40"
              style={{ background: 'rgba(0,0,0,0.5)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setViewEntry(null); setEditMode(false); }}
            />
            <motion.div
              className="fixed bottom-0 left-0 right-0 z-50 max-w-[430px] mx-auto rounded-t-[24px] p-5 pb-10"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-sheet)', maxHeight: '88vh', overflowY: 'auto' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={springs.smooth}
            >
              <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: 'var(--sep)' }} />
              <div className="flex justify-between items-center mb-5">
                <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                  style={{
                    background: editMode ? 'rgba(10,132,255,0.15)' : viewEntry.type === 'expense' ? 'rgba(255,69,58,0.15)' : 'rgba(52,199,89,0.15)',
                    color: editMode ? '#0A84FF' : viewEntry.type === 'expense' ? 'var(--neg)' : 'var(--pos)'
                  }}>
                  {editMode ? '✏️ Edit' : viewEntry.type === 'expense' ? 'Pengeluaran' : 'Pemasukan'}
                </span>
                <div className="flex gap-2 items-center">
                  <button onClick={() => setEditMode(!editMode)} className="text-xs px-3 py-1.5 rounded-xl font-semibold" style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}>
                    {editMode ? 'Batal' : '✏️ Edit'}
                  </button>
                  <button onClick={() => { setViewEntry(null); setEditMode(false); }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text3)' }}>
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
              {!editMode ? (
                <div className="flex flex-col gap-3">
                  <p className="text-3xl font-extrabold" style={{ color: viewEntry.type === 'income' ? 'var(--pos)' : 'var(--neg)' }}>
                    {viewEntry.type === 'income' ? '+' : '-'}{formatRp(viewEntry.amount)}
                  </p>
                  <div className="flex flex-col gap-0 text-sm">
                    {[
                      { label: 'Kategori', value: viewEntry.category },
                      { label: 'Tanggal', value: viewEntry.date },
                      ...(viewEntry.note ? [{ label: 'Catatan', value: viewEntry.note }] : []),
                      ...(viewEntry.bank_account_id ? [{ label: 'Bank / Dompet', value: '🏦 ' + (bankAccounts.find(b => b.id === viewEntry.bank_account_id)?.name ?? '') }] : []),
                      ...(viewEntry.recurrence ? [{ label: 'Pengulangan', value: '🔁 ' + (viewEntry.recurrence === 'daily' ? 'Setiap hari' : viewEntry.recurrence === 'weekly' ? 'Setiap minggu' : 'Setiap bulan') }] : []),
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between py-2.5" style={{ borderBottom: '1px solid var(--sep)' }}>
                        <span style={{ color: 'var(--text3)' }}>{label}</span>
                        <span className="font-semibold text-right max-w-[60%]" style={{ color: 'var(--text)' }}>{value}</span>
                      </div>
                    ))}
                  </div>
                  {viewEntry.receipt_img && (
                    <div className="mt-2">
                      <p className="text-xs mb-2" style={{ color: 'var(--text3)' }}>Foto Struk</p>
                      <img src={viewEntry.receipt_img} className="w-full rounded-xl object-cover max-h-48" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <div className="flex gap-2 mb-1">
                    {(['expense', 'income'] as const).map(t => (
                      <motion.button key={t} className="flex-1 py-2 rounded-xl text-sm font-semibold"
                        style={{ background: editType === t ? (t === 'expense' ? 'var(--negFill)' : 'var(--posFill)') : 'var(--track)', color: editType === t ? 'white' : 'var(--text2)' }}
                        whileTap={{ scale: 0.97 }} transition={springs.snappy}
                        onClick={() => { setEditType(t); setEditCategory(t === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]); }}>
                        {t === 'expense' ? 'Pengeluaran' : 'Pemasukan'}
                      </motion.button>
                    ))}
                  </div>
                  <input className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                    placeholder="Jumlah (Rp)" value={editAmount} inputMode="numeric"
                    onChange={e => setEditAmount(e.target.value.replace(/\D/g, ''))} />
                  <div className="grid grid-cols-2 gap-2">
                    <select className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                      value={editCategory} onChange={e => setEditCategory(e.target.value)}>
                      {(editType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input type="date" className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                      value={editDate} onChange={e => setEditDate(e.target.value)} />
                  </div>
                  <select className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                    value={editBankAccountId} onChange={e => setEditBankAccountId(e.target.value)}>
                    <option value="">Cash/Tunai (Tanpa Bank)</option>
                    {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} ({b.account_type})</option>)}
                  </select>
                  <input className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                    placeholder="Catatan (opsional)" value={editNote} onChange={e => setEditNote(e.target.value)} />
                </div>
              )}
              <div className="flex gap-2 mt-5">
                {editMode && (
                  <motion.button className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                    style={{ background: 'var(--accentFill)', opacity: savingEdit ? 0.6 : 1 }}
                    whileTap={{ scale: 0.97 }} transition={springs.snappy}
                    onClick={saveEdit} disabled={savingEdit}>
                    {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                  </motion.button>
                )}
                <motion.button className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: 'rgba(255,69,58,0.12)', color: 'var(--neg)' }}
                  whileTap={{ scale: 0.97 }} transition={springs.snappy}
                  onClick={() => { deleteEntry(viewEntry!.id); setViewEntry(null); setEditMode(false); }}>
                  🗑️ Hapus
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
