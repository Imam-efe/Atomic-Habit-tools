/**
 * "Selamatkan Bahan" — saran masakan dari stok yang mau kedaluwarsa.
 *
 * Pemisahan yang disengaja: modul ini menyusun prompt dan membaca jawabannya,
 * sedangkan daftar bahannya datang dari lib/daily.ts. Jadi aturan "bahan mana
 * yang mendesak" hanya hidup di satu tempat, dipakai bersama oleh push
 * kedaluwarsa yang sudah ada dan fitur ini.
 */

import type { ExpiringItem } from './daily';
import { TEXT_MODEL } from './ai';

const AI_TIMEOUT_MS = 8000;

export interface RecipeIdea {
  name: string;
  /** Bahan dari stok yang terpakai, apa adanya seperti tertulis di inventaris. */
  uses: string[];
  /** Langkah singkat, bukan resep lengkap. */
  steps: string[];
  minutes: number | null;
}

export interface AiRunner {
  AI: { run(model: string, options: Record<string, unknown>): Promise<unknown> };
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('bad_reply');
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error('bad_reply');
  }
}

/**
 * Saring usulan model terhadap stok nyata.
 *
 * Model bebas mengarang nama masakan, tapi tidak boleh mengarang bahan yang
 * tidak dimiliki pengguna — itu mengubah "pakai yang ada" menjadi daftar
 * belanja, yang justru kebalikan dari gunanya fitur ini.
 */
export function parseRecipes(payload: unknown, available: string[]): RecipeIdea[] {
  const known = new Map(available.map((name) => [name.toLowerCase(), name]));
  const raw = (payload as { recipes?: unknown })?.recipes;
  if (!Array.isArray(raw)) throw new Error('bad_reply');

  const recipes: RecipeIdea[] = [];
  for (const item of raw.slice(0, 3)) {
    if (typeof item !== 'object' || item === null) continue;
    const { name, uses, steps, minutes } = item as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) continue;

    const matched = Array.isArray(uses)
      ? uses
          .filter((u): u is string => typeof u === 'string')
          .map((u) => known.get(u.trim().toLowerCase()))
          .filter((u): u is string => u !== undefined)
      : [];

    // Usulan yang tak menyentuh satu pun bahan mendesak tidak menyelamatkan apa pun.
    if (matched.length === 0) continue;

    recipes.push({
      name: name.trim(),
      uses: [...new Set(matched)],
      steps: Array.isArray(steps)
        ? steps.filter((s): s is string => typeof s === 'string').slice(0, 5)
        : [],
      minutes: typeof minutes === 'number' && Number.isFinite(minutes) ? Math.round(minutes) : null,
    });
  }

  if (recipes.length === 0) throw new Error('bad_reply');
  return recipes;
}

/**
 * @throws Error('ai_timeout' | 'bad_reply' | 'ai_error')
 */
export async function suggestRecipes(
  env: AiRunner,
  items: ExpiringItem[]
): Promise<RecipeIdea[]> {
  const names = items.map((i) => i.name);
  const listing = items
    .map((i) => {
      const urgency =
        i.daysLeft < 0 ? 'sudah lewat tanggal' : i.daysLeft === 0 ? 'hari ini' : `${i.daysLeft} hari lagi`;
      return `- ${i.name} (${i.quantity} ${i.unit}, ${urgency})`;
    })
    .join('\n');

  let response: unknown;
  try {
    response = await Promise.race([
      env.AI.run(TEXT_MODEL, {
        messages: [
          {
            role: 'system',
            content: `Kamu membantu memasak dari bahan yang hampir kedaluwarsa supaya tidak terbuang.

Balas HANYA objek JSON, tanpa penjelasan dan tanpa pagar kode:
{"recipes":[{"name":"...","uses":["..."],"steps":["..."],"minutes":30}]}

Aturan:
- Maksimal 3 usulan masakan rumahan Indonesia yang sederhana.
- "uses" HANYA boleh berisi nama bahan persis seperti pada daftar. Jangan
  menambah bahan yang tidak ada di daftar.
- Dahulukan bahan yang paling mendesak.
- "steps" maksimal 5 langkah pendek.`,
          },
          { role: 'user', content: `Bahan yang harus segera dipakai:\n${listing}` },
        ],
        max_tokens: 700,
      }),
      new Promise((_r, reject) => setTimeout(() => reject(new Error('ai_timeout')), AI_TIMEOUT_MS)),
    ]);
  } catch (err) {
    if (err instanceof Error && err.message === 'ai_timeout') throw err;
    throw new Error('ai_error');
  }

  const text = (response as { response?: string })?.response;
  if (typeof text !== 'string' || !text.trim()) throw new Error('bad_reply');

  return parseRecipes(extractJson(text), names);
}
