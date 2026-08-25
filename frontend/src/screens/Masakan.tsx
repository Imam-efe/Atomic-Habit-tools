/**
 * Masakan — "isi kulkas segini, bisa masak apa?"
 *
 * Bedanya dengan Selamatkan Bahan di layar Harian: di sana daftarnya
 * ditentukan aplikasi (yang mau kedaluwarsa) dan bahan kurang tidak boleh
 * ada. Di sini pengguna yang memilih bahannya, dan bahan yang kurang justru
 * ditampilkan — karena keputusan yang sedang diambil adalah "masak sekarang
 * atau belanja dulu", dan itu butuh kedua sisinya.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';
import { AiPanel } from '@/components/AiPanel';

interface Ingredient {
  name: string;
  quantity: number;
  unit: string | null;
  daysLeft: number | null;
}

/**
 * Nama barang tidak unik di inventaris — belanja dua kali menghasilkan dua
 * baris "Telur" dengan tanggal kedaluwarsa berbeda. Chip-nya karena itu
 * dikunci dengan nama + urutan, bukan nama saja: kunci React yang kembar
 * membuat dua chip berpindah bersamaan dan React memperingatkan setiap render.
 */
function kunciBahan(i: Ingredient, index: number): string {
  return `${i.name}#${index}`;
}

interface Recipe {
  name: string;
  have: string[];
  missing: string[];
  steps: string[];
  minutes: number | null;
  servings: number | null;
  readiness: number;
}

interface PlannedDay {
  date: string;
  recipe: Recipe;
}

interface SavedRecipe extends Omit<Recipe, 'readiness'> {
  id: string;
  note: string | null;
  lastCookedDate: string | null;
  cookedCount: number;
}

function warnaKesiapan(percent: number): string {
  if (percent === 100) return 'var(--pos)';
  if (percent >= 60) return 'var(--info)';
  return 'var(--text3)';
}

function labelUmur(daysLeft: number | null): string {
  if (daysLeft === null) return '';
  if (daysLeft < 0) return ' · kedaluwarsa';
  if (daysLeft <= 3) return ` · sisa ${daysLeft} hari`;
  return '';
}

export function Masakan() {
  const { goBack } = useUIStore();

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extraText, setExtraText] = useState('');
  const [extra, setExtra] = useState<string[]>([]);
  const [craving, setCraving] = useState('');

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [saved, setSaved] = useState<SavedRecipe[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [openRecipe, setOpenRecipe] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Rencana mingguan: tujuh hari sekaligus, dan satu daftar belanja untuk
  // semuanya — bukan tujuh tugas belanja terpisah.
  const [plan, setPlan] = useState<{ days: PlannedDay[]; shoppingList: string[] } | null>(null);
  const [planning, setPlanning] = useState(false);

  const loadIngredients = async () => {
    try {
      const res = await apiFetch<{ ingredients: Ingredient[] }>('/cooking/ingredients');
      setIngredients(res.ingredients);
    } catch {}
  };

  const loadSaved = async () => {
    try {
      const res = await apiFetch<{ recipes: SavedRecipe[] }>('/cooking/recipes');
      setSaved(res.recipes);
    } catch {}
  };

  useEffect(() => { loadIngredients(); loadSaved(); }, []);

  const togglePick = (name: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const addExtra = () => {
    const nama = extraText.trim();
    if (!nama) return;
    // Bahan yang sudah tercatat di inventaris cukup dicentang, tidak perlu
    // masuk dua kali dengan penulisan yang sedikit berbeda.
    const sudahAda = ingredients.some((i) => i.name.toLowerCase() === nama.toLowerCase());
    if (sudahAda) {
      setPicked((prev) => new Set(prev).add(
        ingredients.find((i) => i.name.toLowerCase() === nama.toLowerCase())!.name
      ));
    } else if (!extra.some((e) => e.toLowerCase() === nama.toLowerCase())) {
      setExtra((prev) => [...prev, nama]);
    }
    setExtraText('');
  };

  const suggest = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    setRecipes([]);
    try {
      const res = await apiFetch<{ recipes: Recipe[]; message?: string }>('/cooking/suggest', {
        method: 'POST',
        body: JSON.stringify({
          ingredients: [...picked],
          extra,
          craving: craving.trim() || undefined,
        }),
      });
      setRecipes(res.recipes);
      if (res.message) setMessage(res.message);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.body.message ?? err.body.error ?? 'Gagal meminta saran masakan.'
          : 'Tidak ada jaringan.'
      );
    }
    setLoading(false);
  };

  const save = async (r: Recipe) => {
    try {
      await apiFetch('/cooking/recipes', {
        method: 'POST',
        body: JSON.stringify({
          name: r.name, have: r.have, missing: r.missing,
          steps: r.steps, minutes: r.minutes, servings: r.servings,
        }),
      });
      await loadSaved();
    } catch {
      setError('Gagal menyimpan resep.');
    }
  };

  /**
   * Takarannya ditanyakan, tidak ditebak: resep menyebut "bawang merah" tanpa
   * jumlah, dan mengurangi stok orang dengan angka karangan adalah kesalahan
   * yang tidak pernah terlihat sampai stoknya kacau.
   */
  const cook = async (r: SavedRecipe) => {
    const used: Array<{ name: string; quantity: number }> = [];
    for (const bahan of r.have) {
      const jawab = window.prompt(`Berapa ${bahan} yang terpakai? (kosongkan kalau tidak mau mengurangi stok)`);
      if (jawab === null) return;
      const jumlah = Number(jawab.replace(',', '.'));
      if (Number.isFinite(jumlah) && jumlah > 0) used.push({ name: bahan, quantity: jumlah });
    }

    // Masak lalu makan adalah satu peristiwa. Mencatatnya dua kali — sekali di
    // sini, sekali lagi di Nutrisi — membuat yang kedua hampir selalu terlewat,
    // dan log makan jadi bolong justru di hari pengguna benar-benar memasak.
    //
    // Kalorinya ditanyakan, tidak ditebak: resep tidak menyimpan gizi, dan
    // mengarang angka lebih buruk daripada tidak mencatat.
    let meal: { portion: string; calories?: number } | undefined;
    const kalori = window.prompt(
      `Catat ${r.name} ke log makan hari ini? Isi perkiraan kalorinya, atau kosongkan untuk melewati.`
    );
    if (kalori !== null && kalori.trim()) {
      const n = Number(kalori.replace(/[^\d.]/g, ''));
      meal = {
        portion: r.servings ? `1 dari ${r.servings} porsi` : '1 porsi',
        ...(Number.isFinite(n) && n > 0 ? { calories: n } : {}),
      };
    }

    setBusyId(r.id);
    try {
      const res = await apiFetch<{ mealLogged: boolean }>(`/cooking/recipes/${r.id}/cook`, {
        method: 'POST',
        body: JSON.stringify({ used, meal }),
      });
      await Promise.all([loadSaved(), loadIngredients()]);
      if (res.mealLogged) setMessage(`${r.name} masuk log makan hari ini.`);
    } catch {
      setError('Gagal menandai sudah dimasak.');
    }
    setBusyId(null);
  };

  const shop = async (r: SavedRecipe) => {
    setBusyId(r.id);
    try {
      await apiFetch(`/cooking/recipes/${r.id}/shop`, { method: 'POST', body: '{}' });
      setMessage(`Tugas belanja untuk ${r.name} masuk ke Kalender hari ini.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error ?? 'Gagal membuat tugas belanja.' : 'Tidak ada jaringan.');
    }
    setBusyId(null);
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await apiFetch(`/cooking/recipes/${id}`, { method: 'DELETE' });
      await loadSaved();
    } catch {
      setError('Gagal menghapus resep.');
    }
    setBusyId(null);
  };

  const buatRencana = async () => {
    setPlanning(true);
    setError('');
    setMessage('');
    try {
      const res = await apiFetch<{ days: PlannedDay[]; shoppingList: string[] }>('/cooking/plan', {
        method: 'POST',
        body: JSON.stringify({ note: craving.trim() || undefined }),
      });
      setPlan(res);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.body.message ?? err.body.error ?? 'Gagal menyusun rencana.'
          : 'Tidak ada jaringan.'
      );
    }
    setPlanning(false);
  };

  const belanjaMingguan = async () => {
    if (!plan || plan.shoppingList.length === 0) return;
    setPlanning(true);
    try {
      await apiFetch('/cooking/plan/shop', {
        method: 'POST',
        body: JSON.stringify({ items: plan.shoppingList }),
      });
      setMessage(`Satu tugas belanja berisi ${plan.shoppingList.length} bahan masuk ke Kalender.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error ?? 'Gagal membuat tugas belanja.' : 'Tidak ada jaringan.');
    }
    setPlanning(false);
  };

  const dipilih = picked.size + extra.length;
  // Dihitung dari nama unik, bukan jumlah baris: dua baris "Telur" hanya satu
  // pilihan, jadi membandingkan dengan ingredients.length tidak akan pernah
  // menyalakan "Kosongkan".
  const namaUnik = [...new Set(ingredients.map((i) => i.name))];
  const semuaTerpilih = namaUnik.length > 0 && picked.size === namaUnik.length;

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      <motion.div initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={springs.gentle} className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised-sm)', color: 'var(--text)' }}
            onClick={goBack}
            aria-label="Kembali"
          >
            ←
          </button>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.4px' }}>
              Masakan
            </h1>
            <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
              Pilih bahan, lihat apa yang bisa dimasak dan apa yang kurang
            </p>
          </div>
        </div>

        <AiPanel
          module="masakan"
          suggestions={['Apa yang bisa dimasak hari ini?', 'Bahan mana yang harus segera dipakai?']}
          onChanged={() => { loadIngredients(); loadSaved(); }}
        />

        {/* Pemilih bahan */}
        <div className="rounded-2xl p-3.5 space-y-3" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>Bahan yang dipakai</p>
            <button
              className="text-[10px] font-semibold"
              style={{ color: 'var(--accent)' }}
              onClick={() => setPicked(semuaTerpilih ? new Set() : new Set(namaUnik))}
            >
              {semuaTerpilih ? 'Kosongkan' : 'Pilih semua'}
            </button>
          </div>

          {ingredients.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
              Inventaris masih kosong. Ketik bahan yang kamu punya di bawah.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {ingredients.map((i, idx) => {
                const aktif = picked.has(i.name);
                const mendesak = i.daysLeft !== null && i.daysLeft <= 3;
                return (
                  <button
                    key={kunciBahan(i, idx)}
                    onClick={() => togglePick(i.name)}
                    className="text-[10px] px-2.5 py-1.5 rounded-lg"
                    style={{
                      background: aktif ? 'var(--accentFill)' : 'var(--bg)',
                      color: aktif ? '#fff' : mendesak ? 'var(--neg)' : 'var(--text2)',
                      boxShadow: aktif ? 'var(--neu-raised-sm)' : 'var(--neu-inset)',
                    }}
                  >
                    {i.name}
                    <span style={{ opacity: 0.75 }}>{labelUmur(i.daysLeft)}</span>
                  </button>
                );
              })}
            </div>
          )}

          {extra.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {extra.map((e) => (
                <button
                  key={e}
                  onClick={() => setExtra((prev) => prev.filter((x) => x !== e))}
                  className="text-[10px] px-2.5 py-1.5 rounded-lg"
                  style={{ background: 'var(--accentSoft)', color: 'var(--accent)', boxShadow: 'var(--neu-raised-sm)' }}
                >
                  {e} ✕
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              className="flex-1 min-w-0 px-3 py-2 rounded-xl text-[11px] outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              placeholder="Bahan lain yang belum tercatat"
              value={extraText}
              onChange={(e) => setExtraText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addExtra(); }}
            />
            <button
              className="px-3 py-2 rounded-xl text-[11px] font-bold flex-shrink-0"
              style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
              onClick={addExtra}
            >
              Tambah
            </button>
          </div>

          <input
            className="w-full px-3 py-2 rounded-xl text-[11px] outline-none"
            style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
            placeholder="Sedang ingin apa? (opsional, misal: berkuah, pedas)"
            value={craving}
            onChange={(e) => setCraving(e.target.value)}
          />

          <button
            className="neu-cta w-full py-2.5 rounded-xl text-[12px] font-bold text-white disabled:opacity-50"
            style={{ background: 'var(--accentFill)' }}
            onClick={suggest}
            disabled={loading}
          >
            {loading ? 'Memikirkan…' : dipilih > 0 ? `Cari masakan dari ${dipilih} bahan` : 'Cari masakan dari semua bahan'}
          </button>

          <button
            className="w-full py-2.5 rounded-xl text-[12px] font-bold disabled:opacity-50"
            style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
            onClick={buatRencana}
            disabled={planning}
          >
            {planning ? 'Menyusun…' : 'Susun rencana 7 hari'}
          </button>
        </div>

        {error && <p className="text-[11px]" style={{ color: 'var(--neg)' }}>{error}</p>}
        {message && <p className="text-[11px]" style={{ color: 'var(--text2)' }}>{message}</p>}

        {/* Rencana mingguan */}
        {plan && plan.days.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
              Rencana {plan.days.length} hari
            </p>

            {plan.shoppingList.length > 0 && (
              <div className="rounded-2xl p-3.5 space-y-2" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                <p className="text-[12px] font-bold" style={{ color: 'var(--text)' }}>
                  Belanja untuk seminggu · {plan.shoppingList.length} bahan
                </p>
                <p className="text-[11px]" style={{ color: 'var(--text2)' }}>
                  {plan.shoppingList.join(', ')}
                </p>
                <button
                  className="neu-cta px-3 py-2 rounded-xl text-[11px] font-bold text-white disabled:opacity-50"
                  style={{ background: 'var(--accentFill)' }}
                  onClick={belanjaMingguan}
                  disabled={planning}
                >
                  Kirim ke Kalender sebagai satu tugas
                </button>
              </div>
            )}

            {plan.days.map((d) => (
              <div key={d.date} className="rounded-2xl p-3 flex items-center justify-between gap-2"
                style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                <div className="min-w-0">
                  <p className="text-[10px]" style={{ color: 'var(--text3)' }}>{d.date}</p>
                  <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                    {d.recipe.name}
                  </p>
                  {d.recipe.missing.length > 0 && (
                    <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                      perlu beli: {d.recipe.missing.join(', ')}
                    </p>
                  )}
                </div>
                <button
                  className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg flex-shrink-0"
                  style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-inset)' }}
                  onClick={() => save(d.recipe)}
                >
                  Simpan
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Hasil saran */}
        {recipes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
              Saran masakan
            </p>
            {recipes.map((r) => (
              <div key={r.name} className="rounded-2xl p-3.5 space-y-2" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold truncate" style={{ color: 'var(--text)' }}>{r.name}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                      {r.minutes ? `${r.minutes} menit` : 'waktu tidak diperkirakan'}
                      {r.servings ? ` · ${r.servings} porsi` : ''}
                    </p>
                  </div>
                  <span className="text-[11px] font-bold flex-shrink-0" style={{ color: warnaKesiapan(r.readiness) }}>
                    {r.readiness}%
                  </span>
                </div>

                <p className="text-[11px]" style={{ color: 'var(--pos)' }}>
                  Ada: {r.have.length > 0 ? r.have.join(', ') : '—'}
                </p>
                {r.missing.length > 0 && (
                  <p className="text-[11px]" style={{ color: 'var(--text2)' }}>
                    Kurang: {r.missing.join(', ')}
                  </p>
                )}

                <AnimatePresence initial={false}>
                  {openRecipe === r.name && r.steps.length > 0 && (
                    <motion.div {...collapse} transition={springs.gentle} className="overflow-hidden">
                      {/* Pembungkusnya div, bukan ol: <ol> punya atribut `type`
                          sendiri yang bentrok dengan transition milik motion. */}
                      <ol className="space-y-1 pl-4 list-decimal">
                        {r.steps.map((s, i) => (
                          <li key={i} className="text-[11px]" style={{ color: 'var(--text2)' }}>{s}</li>
                        ))}
                      </ol>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex gap-2">
                  {r.steps.length > 0 && (
                    <button
                      className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg"
                      style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-inset)' }}
                      onClick={() => setOpenRecipe(openRecipe === r.name ? null : r.name)}
                    >
                      {openRecipe === r.name ? 'Tutup langkah' : 'Lihat langkah'}
                    </button>
                  )}
                  <button
                    className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-white"
                    style={{ background: 'var(--accentFill)' }}
                    onClick={() => save(r)}
                  >
                    Simpan
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Resep tersimpan */}
        {saved.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--text3)' }}>
              Resep tersimpan
            </p>
            {saved.map((r) => (
              <div key={r.id} className="rounded-2xl p-3.5 space-y-2" style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold truncate" style={{ color: 'var(--text)' }}>{r.name}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text3)' }}>
                      {r.cookedCount > 0 ? `Dimasak ${r.cookedCount}×` : 'Belum pernah dimasak'}
                      {r.lastCookedDate ? ` · terakhir ${r.lastCookedDate}` : ''}
                    </p>
                  </div>
                  <button
                    className="text-[10px] flex-shrink-0"
                    style={{ color: 'var(--text3)' }}
                    onClick={() => remove(r.id)}
                    disabled={busyId === r.id}
                    aria-label={`Hapus ${r.name}`}
                  >
                    Hapus
                  </button>
                </div>

                {r.missing.length > 0 && (
                  <p className="text-[11px]" style={{ color: 'var(--text2)' }}>Kurang: {r.missing.join(', ')}</p>
                )}

                <div className="flex gap-2 flex-wrap">
                  {r.have.length > 0 && (
                    <button
                      className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-white disabled:opacity-50"
                      style={{ background: 'var(--accentFill)' }}
                      onClick={() => cook(r)}
                      disabled={busyId === r.id}
                    >
                      Sudah dimasak
                    </button>
                  )}
                  {r.missing.length > 0 && (
                    <button
                      className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                      style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-inset)' }}
                      onClick={() => shop(r)}
                      disabled={busyId === r.id}
                    >
                      Belanja bahan kurang
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
