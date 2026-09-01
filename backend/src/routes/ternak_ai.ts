/**
 * Diagnosa AI dan tanya jawab kontekstual untuk ternak.
 *
 * Meniru `/api/garden/diagnose` dan `/api/garden/:id/ask` persis — model,
 * penanganan galat, dan batas token yang sama — supaya dua modul AI di
 * backend ini tidak diam-diam menyimpang satu sama lain untuk pekerjaan yang
 * sama persis, cuma beda spesiesnya.
 *
 * Tidak ada tes rute di berkas ini. Keduanya memanggil model dan hasilnya
 * tidak deterministik — yang bisa diuji dengan berarti adalah penyusun
 * konteksnya kalau suatu saat ditarik jadi fungsi murni tersendiri di lib/.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { runJson, runText, SCHEMA_MODEL } from '../lib/ai';
import { ANIMAL_BY_ID } from '../data/animals';
import { namaSubjekHewan } from './ternak';

const ternakAi = new Hono<AuthContext>();
ternakAi.use('/*', requireAuth);

/**
 * Kalimat penutup wajib pada setiap diagnosis dan jawaban.
 *
 * Ditempel di kode, bukan cuma dititipkan lewat prompt sistem — model bisa
 * lupa menyertakannya, apalagi kalau jawabannya sudah panjang, dan ini bukan
 * hal yang boleh "kadang-kadang" muncul. Pemeriksaan `includes` di bawah
 * mencegahnya dobel kalau model kebetulan sudah menyebutnya sendiri.
 */
const BUKAN_PENGGANTI_DOKTER = 'Ini bukan pengganti pemeriksaan dokter hewan.';

function tutupDenganDisclaimer(teks: string): string {
  const t = teks.trim();
  if (t.toLowerCase().includes('dokter hewan')) return t;
  return t ? `${t} ${BUKAN_PENGGANTI_DOKTER}` : BUKAN_PENGGANTI_DOKTER;
}

interface HewanKonteksRow {
  animal_id: string | null;
  nama_kustom: string | null;
  nama_panggilan: string | null;
}

/**
 * Konteks satu hewan untuk AI: nama, penyakit umum spesiesnya, rentang air
 * kalau relevan. Dipakai diagnosa maupun tanya, supaya keduanya menjelaskan
 * hewan yang sama dengan cara yang sama.
 *
 * String kosong (bukan error) kalau hewanId tidak diisi atau bukan milik
 * pengguna ini — sama seperti `/api/garden/diagnose` yang diam-diam
 * melanjutkan tanpa konteks kalau plantingId-nya tidak ditemukan, daripada
 * menolak seluruh permintaan gara-gara satu referensi opsional yang meleset.
 */
async function konteksHewan(db: D1Database, userId: string, hewanId: string): Promise<string> {
  const row = await db.prepare(
    'SELECT animal_id, nama_kustom, nama_panggilan FROM ternak_hewan WHERE id = ?1 AND user_id = ?2'
  ).bind(hewanId, userId).first<HewanKonteksRow>();
  if (!row) return '';

  const animal = row.animal_id ? ANIMAL_BY_ID.get(row.animal_id) : undefined;
  const nama = namaSubjekHewan(row);

  const baris = [`Hewan: ${nama}${animal ? ` (${animal.nama}, ${animal.latin})` : ''}.`];
  if (animal) {
    if (animal.penyakit.length) baris.push(`Penyakit umum pada spesies ini: ${animal.penyakit.join(', ')}.`);
    if (animal.suhuC) baris.push(`Suhu air ideal: ${animal.suhuC[0]}-${animal.suhuC[1]}°C.`);
    if (animal.phAir) baris.push(`pH air ideal: ${animal.phAir[0]}-${animal.phAir[1]}.`);
    if (animal.salinitasPpt) baris.push(`Salinitas ideal: ${animal.salinitasPpt[0]}-${animal.salinitasPpt[1]} ppt.`);
    if (animal.bahaya) baris.push(`Risiko bagi manusia: ${animal.bahaya}.`);
  }
  return baris.join(' ');
}

interface RawDiagnosis {
  diagnosis?: string;
  confidence?: string;
  cause?: string;
  treatment?: string[];
  prevention?: string;
  urgency?: string;
}

const DIAGNOSIS_SCHEMA = {
  type: 'object',
  properties: {
    diagnosis: { type: 'string', description: 'Nama penyakit/masalah yang paling mungkin' },
    confidence: { type: 'string', enum: ['tinggi', 'sedang', 'rendah'] },
    cause: { type: 'string', description: 'Penyebabnya, 1-2 kalimat' },
    treatment: {
      type: 'array',
      items: { type: 'string' },
      description: '3-5 langkah penanganan konkret, dahulukan cara yang murah dan bisa dikerjakan sendiri',
    },
    prevention: { type: 'string', description: 'Cara mencegah berulang, 1-2 kalimat' },
    urgency: { type: 'string', enum: ['segera', 'minggu-ini', 'pantau'] },
  },
  required: ['diagnosis', 'cause', 'treatment'],
} as const;

// POST /api/ternak/diagnosa — { hewanId?, gejala, foto? } → diagnosis hama/penyakit
//
// Gejala hewan tidak bisa ditabelkan seperti interval perawatan, jadi ini
// murni AI. Foto opsional; kalau ada, dipakai model vision yang sama dengan
// diagnosa kebun dan OCR struk.
ternakAi.post('/diagnosa', async (c) => {
  const user = c.get('user');
  type Body = { hewanId?: string; gejala?: string; foto?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const gejala = body.gejala?.trim();
  const foto = body.foto?.trim();
  if (!gejala && !foto) return c.json({ error: 'isi gejala atau unggah foto' }, 400);
  if (foto) {
    if (!foto.startsWith('data:image/')) return c.json({ error: 'foto harus data URL' }, 400);
    if (foto.length > 6_000_000) return c.json({ error: 'foto terlalu besar' }, 413);
  }

  const context = body.hewanId ? await konteksHewan(c.env.DB, user.sub, body.hewanId) : '';
  const userText = [context, gejala ? `Gejala yang terlihat: ${gejala}` : 'Lihat foto terlampir.']
    .filter(Boolean).join('\n');

  let raw: RawDiagnosis | null = null;
  try {
    raw = await runJson<RawDiagnosis>(
      c.env,
      [
        {
          role: 'system',
          content: 'Kamu dokter hewan untuk pemelihara ternak dan hewan peliharaan rumahan di Indonesia. Diagnosis masalah dari gejala atau foto yang diberikan, lalu beri langkah penanganan yang bisa langsung dikerjakan pemiliknya di rumah. Dahulukan solusi yang murah dan bahan yang mudah didapat; sebut kebutuhan obat resep atau periksa ke dokter hewan kalau memang perlu. Semua dalam Bahasa Indonesia. Kalau gejalanya terlalu umum, katakan begitu lewat confidence rendah, jangan mengarang.',
        },
        {
          role: 'user',
          content: foto
            ? [
                { type: 'text' as const, text: userText },
                { type: 'image_url' as const, image_url: { url: foto } },
              ]
            : userText,
        },
      ],
      DIAGNOSIS_SCHEMA as unknown as Record<string, unknown>,
      { model: SCHEMA_MODEL, maxTokens: 700 }
    );
  } catch (err) {
    console.error('Ternak diagnosa failed', err);
    return c.json({ error: 'Diagnosis gagal' }, 502);
  }

  if (!raw?.diagnosis) return c.json({ error: 'Tidak bisa mendiagnosis dari data ini' }, 422);

  return c.json({
    diagnosis: raw.diagnosis.slice(0, 120),
    confidence: ['tinggi', 'sedang', 'rendah'].includes(raw.confidence ?? '') ? raw.confidence : 'sedang',
    cause: (raw.cause ?? '').slice(0, 400),
    treatment: (raw.treatment ?? []).filter(t => typeof t === 'string' && t.trim()).slice(0, 6).map(t => t.trim().slice(0, 250)),
    // Kalimat penutup ditempel di sini, bukan diserahkan ke model — lihat
    // catatan di `tutupDenganDisclaimer`.
    prevention: tutupDenganDisclaimer((raw.prevention ?? '').slice(0, 400)),
    urgency: ['segera', 'minggu-ini', 'pantau'].includes(raw.urgency ?? '') ? raw.urgency : 'minggu-ini',
  });
});

// POST /api/ternak/tanya — { hewanId?, pertanyaan } → tanya jawab kontekstual
//
// Sama pola dengan /api/garden/:id/ask: pertanyaan bebas pengguna, dijawab
// dengan konteks satu hewan kalau hewanId disebut, bukan jawaban generik yang
// bisa didapat dari mesin pencari mana pun.
ternakAi.post('/tanya', async (c) => {
  const user = c.get('user');
  type Body = { hewanId?: string; pertanyaan?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const pertanyaan = body.pertanyaan?.trim();
  if (!pertanyaan) return c.json({ error: 'pertanyaan wajib diisi' }, 400);
  if (pertanyaan.length > 500) return c.json({ error: 'pertanyaan terlalu panjang, maksimal 500 karakter' }, 400);

  const context = body.hewanId ? await konteksHewan(c.env.DB, user.sub, body.hewanId) : '';

  let answer = '';
  try {
    answer = await runText(
      c.env,
      [
        {
          role: 'system',
          content: 'Kamu pendamping pemelihara ternak dan hewan peliharaan untuk rumah tangga Indonesia. Jawab pertanyaan pengguna memakai konteks hewan yang diberikan kalau ada. Jawaban singkat (2-4 kalimat), spesifik, Bahasa Indonesia, tanpa markdown. Kalau pertanyaannya menyangkut gejala sakit atau butuh keputusan medis, sarankan periksa ke dokter hewan daripada menebak-nebak.',
        },
        { role: 'user', content: context ? `${context}\n\nPertanyaan: ${pertanyaan}` : pertanyaan },
      ],
      { maxTokens: 350 }
    );
  } catch (err) {
    console.error('Ternak tanya failed', err);
    return c.json({ error: 'AI service unavailable', detail: String(err) }, 502);
  }

  if (!answer.trim()) return c.json({ error: 'AI returned empty response' }, 502);

  return c.json({ pertanyaan, jawaban: tutupDenganDisclaimer(answer) });
});

export default ternakAi;
