/**
 * Tiap tautan notifikasi harus benar-benar mendarat di suatu layar.
 *
 * Service worker membuka `origin + url` dan router aplikasi memakai catch-all
 * "/*", jadi pathname yang tidak ada di peta deep link frontend akan diam-diam
 * jatuh ke Beranda — notifikasi tetap muncul, tapi tapnya membawa pengguna ke
 * tempat yang salah, tanpa galat di mana pun. Tes ini membaca petanya langsung
 * supaya satu-satunya sumber kebenaran tetap satu berkas, bukan dua daftar yang
 * pelan-pelan menyimpang.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const AKAR_BACKEND = join(__dirname, '..');
const PETA_FRONTEND = join(__dirname, '../../../frontend/src/lib/deepLinks.ts');

function berkasTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nama) => {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) return berkasTs(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

/** Path yang dikenali frontend, dibaca dari kunci DEEP_LINKS. */
function pathTerdaftar(): Set<string> {
  const isi = readFileSync(PETA_FRONTEND, 'utf8');
  const blok = isi.slice(isi.indexOf('export const DEEP_LINKS'));
  return new Set([...blok.matchAll(/'(\/[a-z-]*)':\s*\{/g)].map((m) => m[1]));
}

describe('tautan notifikasi push', () => {
  it('peta deep link frontend terbaca dan tidak kosong', () => {
    // Kalau berkasnya dipindah atau bentuknya berubah, tes di bawah akan lulus
    // kosong tanpa memeriksa apa pun — jadi keterbacaannya diuji lebih dulu.
    const terdaftar = pathTerdaftar();
    expect(terdaftar.size).toBeGreaterThan(3);
    expect(terdaftar.has('/ternak')).toBe(true);
  });

  it('tiap url payload push ada di peta deep link frontend', () => {
    const terdaftar = pathTerdaftar();
    const temuan: string[] = [];

    for (const berkas of berkasTs(AKAR_BACKEND)) {
      const isi = readFileSync(berkas, 'utf8');
      for (const m of isi.matchAll(/url:\s*'([^']*)'/g)) {
        const url = m[1];
        if (!terdaftar.has(url)) {
          temuan.push(`${berkas.slice(AKAR_BACKEND.length + 1)}: url '${url}'`);
        }
      }
    }

    expect(
      temuan,
      `tautan notifikasi berikut tidak ada di frontend/src/lib/deepLinks.ts, jadi tapnya akan jatuh ke Beranda:\n${temuan.join('\n')}`
    ).toEqual([]);
  });
});
