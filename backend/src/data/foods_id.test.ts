import { searchCuratedFoods, CURATED_FOODS } from './foods_id.ts';

// Backend tidak punya @types/node (lihat Global Constraints) — 'node:assert'
// tidak resolvable di bawah tsc --noEmit meski jalan fine di runtime node.
// Helper lokal ini menghindari import itu sepenuhnya, jadi tsc tetap bersih.
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}
function checkEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`FAIL: ${message} — got ${a}, expected ${e}`);
}

// Nama penuh cocok.
check(searchCuratedFoods('nasi goreng').some(f => f.id === 'nasi-goreng'), 'nasi goreng ditemukan');
// Alias cocok (nama dagang umum).
check(searchCuratedFoods('indomie').some(f => f.id === 'mie-goreng-instan'), 'alias indomie ditemukan');
// Query kosong -> array kosong, bukan seluruh katalog.
checkEqual(searchCuratedFoods(''), [], 'query kosong');
// Query tidak cocok apa pun -> array kosong.
checkEqual(searchCuratedFoods('xyz-tidak-ada-di-katalog'), [], 'query tidak cocok');
// Tidak ada id duplikat di katalog.
const ids = CURATED_FOODS.map(f => f.id);
checkEqual(new Set(ids).size, ids.length, 'tidak ada id duplikat');
// Setiap entri punya angka gizi non-negatif.
for (const f of CURATED_FOODS) {
  check(f.calories >= 0 && f.protein >= 0 && f.carbs >= 0 && f.fat >= 0 && f.fiber >= 0 && f.sodium >= 0 && f.sugar >= 0, `angka negatif di ${f.id}`);
}

console.log(`foods_id.test.ts OK — ${CURATED_FOODS.length} entri`);
