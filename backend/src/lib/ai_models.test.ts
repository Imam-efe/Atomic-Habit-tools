/**
 * Nama model hanya boleh hidup di satu berkas.
 *
 * Modul kebun pernah gagal menjawab selama berhari-hari karena satu nama
 * model yang sudah ditarik dari katalog Workers AI. Perbaikannya waktu itu
 * mengganti satu baris di lib/ai.ts — tapi tiga berkas lain menyimpan
 * salinannya sendiri dan ikut mati tanpa ada yang menyadarinya, karena
 * kegagalannya berbentuk fitur yang diam, bukan error yang terlihat.
 *
 * Uji ini menutup celah itu: model dideklarasikan di lib/ai.ts, dan berkas
 * lain mengimpor dari sana.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('nama model Workers AI', () => {
  it('hanya muncul di lib/ai.ts', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1);
      if (rel === 'lib/ai.ts' || rel.endsWith('.test.ts')) continue;

      const source = readFileSync(file, 'utf8');
      for (const [line, text] of source.split('\n').entries()) {
        // Sebutan di dalam komentar tidak apa-apa — yang berbahaya adalah
        // string yang benar-benar dikirim ke env.AI.run().
        if (/^\s*(\/\/|\*|\/\*)/.test(text)) continue;
        if (/['"`]@cf\//.test(text)) offenders.push(`${rel}:${line + 1}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('memakai varian llama-3.1 yang masih didukung', async () => {
    // Varian tanpa akhiran sudah deprecated dan menolak permintaan saat
    // dijalankan; -fp8 adalah penggantinya dengan kontrak yang sama.
    const { TEXT_MODEL } = await import('./ai');
    expect(TEXT_MODEL).not.toBe('@cf/meta/llama-3.1-8b-instruct');
    expect(TEXT_MODEL).toMatch(/-fp8$/);
  });
});
