/**
 * Uji aturan cache service worker.
 *
 * sw.js selama ini tidak punya tes sama sekali, dan justru di situlah bug
 * paling merusak bersembunyi: shell aplikasi disajikan cache-first dengan nama
 * cache yang tidak pernah berubah, jadi tiap deploy menyisakan pengguna di
 * build lama selamanya. Semua yang sudah pernah dibuka tetap jalan — sehingga
 * aplikasinya tampak sehat — tapi `import()` malas ke chunk yang belum pernah
 * diambil menunjuk nama berkas yang sudah dihapus dari server.
 *
 * Berkasnya plain JS di public/, jadi dijalankan di dalam scope palsu.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SW = readFileSync(join(__dirname, '../../../public/sw.js'), 'utf8');

interface Pendengar { [k: string]: (event: unknown) => void }

/** Scope service worker seadanya: cukup untuk menjalankan handler fetch. */
function muatSw(opts: { adaDiCache: boolean; jaringanHidup: boolean }) {
  const pendengar: Pendengar = {};
  const dicache: string[] = [];
  const diambilDariJaringan: string[] = [];

  const respons = (status: number) => ({ status, type: 'basic', clone: () => respons(status) });

  const scope = {
    self: {
      addEventListener: (nama: string, fn: (e: unknown) => void) => { pendengar[nama] = fn; },
      skipWaiting: () => {},
      clients: { claim: () => {} },
      registration: { showNotification: () => {} },
      location: { origin: 'https://app.test' },
    },
    location: { origin: 'https://app.test' },
    caches: {
      open: async () => ({ put: (req: { url: string }) => { dicache.push(req.url); }, addAll: async () => {} }),
      match: async () => (opts.adaDiCache ? respons(200) : undefined),
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async (req: { url: string }) => {
      diambilDariJaringan.push(req.url);
      if (!opts.jaringanHidup) throw new TypeError('Failed to fetch');
      return respons(200);
    },
    URL,
    Response: class { constructor(_b: unknown, _i: unknown) {} },
    clients: { matchAll: async () => [], openWindow: async () => {} },
  };

  vm.createContext(scope);
  vm.runInContext(SW, scope);
  return { pendengar, dicache, diambilDariJaringan };
}

/** Permintaan dokumen (buka aplikasi / reload) vs permintaan aset ber-hash. */
function permintaan(url: string, jenis: 'dokumen' | 'aset') {
  return {
    url,
    method: 'GET',
    mode: jenis === 'dokumen' ? 'navigate' : 'no-cors',
    headers: { get: (h: string) => (h === 'accept' && jenis === 'dokumen' ? 'text/html' : '') },
  };
}

async function jalankanFetch(pendengar: Pendengar, req: unknown) {
  let hasil: Promise<unknown> | undefined;
  await pendengar.fetch({ request: req, respondWith: (p: Promise<unknown>) => { hasil = p; } });
  return hasil ? await hasil : undefined;
}

describe('service worker: shell tidak boleh membeku di build lama', () => {
  let sw: ReturnType<typeof muatSw>;

  beforeEach(() => { sw = muatSw({ adaDiCache: true, jaringanHidup: true }); });

  it('dokumen diambil dari jaringan meski ada salinan di cache', async () => {
    // Inti perbaikannya. Kalau ini cache-first, index.html lama akan disajikan
    // selamanya dan menunjuk nama chunk yang sudah tidak ada di server.
    await jalankanFetch(sw.pendengar, permintaan('https://app.test/', 'dokumen'));
    expect(sw.diambilDariJaringan).toContain('https://app.test/');
  });

  it('aset ber-hash tetap cache-first — namanya sudah menjamin isinya', async () => {
    await jalankanFetch(sw.pendengar, permintaan('https://app.test/assets/index-abc123.js', 'aset'));
    expect(sw.diambilDariJaringan).not.toContain('https://app.test/assets/index-abc123.js');
  });

  it('dokumen jatuh ke cache saat jaringan mati, jadi offline tetap terpakai', async () => {
    const mati = muatSw({ adaDiCache: true, jaringanHidup: false });
    const res = await jalankanFetch(mati.pendengar, permintaan('https://app.test/', 'dokumen'));
    expect(res).toBeDefined();
  });
});

describe('service worker: cache lama harus benar-benar terbuang', () => {
  it('nama cache diturunkan dari satu konstanta versi', () => {
    // Nama yang dipatok tetap membuat handler activate tidak pernah menghapus
    // apa pun: filternya membandingkan terhadap nama yang sama persis.
    expect(SW).toMatch(/const VERSION = '[^']+'/);
    expect(SW).toMatch(/const CACHE_NAME = `fayolla-\$\{VERSION\}`/);
    expect(SW).toMatch(/const RUNTIME_CACHE = `fayolla-runtime-\$\{VERSION\}`/);
    expect(SW).toMatch(/const API_CACHE = `fayolla-api-\$\{VERSION\}`/);
  });
});
