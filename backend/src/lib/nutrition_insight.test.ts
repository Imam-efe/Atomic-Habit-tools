import { ALG_UMUM, computeAlgPercent, buildWarnings, scaleServing } from './nutrition_insight.ts';

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

// Separuh acuan kalori -> 50%.
checkEqual(
  computeAlgPercent({ calories: ALG_UMUM.calories / 2, protein: 0, fat: 0, saturatedFat: 0, carbs: 0, sugar: 0, sodium: 0 }).calories,
  50,
  'separuh acuan kalori = 50%'
);

// Natrium di atas ambang 20% ALG -> masuk warnings, menyebut "Natrium".
const highSodium = computeAlgPercent({ calories: 100, protein: 1, fat: 1, saturatedFat: 1, carbs: 10, sugar: 1, sodium: 500 });
check(buildWarnings(highSodium).some(w => w.includes('Natrium')), 'natrium tinggi memicu warning');

// Semua di bawah ambang -> tidak ada warning.
const lowEverything = computeAlgPercent({ calories: 100, protein: 1, fat: 1, saturatedFat: 1, carbs: 10, sugar: 1, sodium: 50 });
checkEqual(buildWarnings(lowEverything), [], 'semua di bawah ambang = tanpa warning');

// scaleServing mengalikan tiap field numerik.
checkEqual(scaleServing({ calories: 100, protein: 2 }, 3), { calories: 300, protein: 6 }, 'scaleServing mengalikan tiap field');
// servingsPerPack tidak valid (0, undefined) -> null, bukan dikalikan 0.
checkEqual(scaleServing({ calories: 100 }, 0), null, 'servingsPerPack 0 -> null');
checkEqual(scaleServing({ calories: 100 }, undefined), null, 'servingsPerPack undefined -> null');

console.log('nutrition_insight.test.ts OK');
