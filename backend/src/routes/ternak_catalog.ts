/**
 * Katalog hewan — daftar ringkas untuk memilih spesies, dan detail penuh
 * begitu satu spesies dipilih.
 *
 * Dua bentuk berbeda dengan sengaja. Daftar dibuka tiap kali pengguna mau
 * menambah hewan dan tidak butuh `cara` tiap tugas perawatan — mengirim
 * seluruh objek `Animal` di sana memperbesar muatannya berkali-kali lipat
 * untuk data yang tidak dipakai layar itu. Detail baru butuh semuanya, dan
 * hanya diminta sekali per spesies yang dilihat.
 *
 * Data ini murni bundel, bukan tabel — tidak ada query user_id di sini sama
 * sekali, katalog sama untuk semua orang. Tetap di belakang requireAuth
 * karena begitu aturannya untuk seluruh API ini, bukan karena datanya privat.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { ANIMALS, ANIMAL_BY_ID, type Animal } from '../data/animals';

const catalog = new Hono<AuthContext>();
catalog.use('/*', requireAuth);

function ringkas(a: Animal) {
  return {
    id: a.id,
    nama: a.nama,
    emoji: a.emoji,
    grup: a.grup,
    habitat: a.habitat,
    peran: a.peran,
    kesulitan: a.kesulitan,
    jumlahTugas: a.tugas.length,
  };
}

// GET /api/ternak/katalog?grup=&habitat=&peran=&kesulitan=&q=
//
// Setiap filter dicocokkan dengan kesetaraan langsung terhadap nilainya
// sendiri (bukan "kalau valid, saring; kalau tidak, lewati") — itu sebabnya
// nilai yang tidak dikenal otomatis menghasilkan daftar kosong, bukan seluruh
// katalog. Filter yang diam-diam diabaikan lebih membingungkan daripada hasil
// kosong: yang kedua terlihat jelas salah, yang pertama terlihat benar padahal
// tidak menyaring apa pun.
catalog.get('/katalog', (c) => {
  const grup = c.req.query('grup');
  const habitat = c.req.query('habitat');
  const peran = c.req.query('peran');
  const kesulitan = c.req.query('kesulitan');
  const q = c.req.query('q')?.trim().toLowerCase();

  const hasil = ANIMALS.filter((a) => {
    if (grup !== undefined && a.grup !== grup) return false;
    if (habitat !== undefined && a.habitat !== habitat) return false;
    if (peran !== undefined && a.peran !== peran) return false;
    if (kesulitan !== undefined && a.kesulitan !== kesulitan) return false;
    if (q && !a.nama.toLowerCase().includes(q) && !a.latin.toLowerCase().includes(q)) return false;
    return true;
  });

  return c.json({ hewan: hasil.map(ringkas) });
});

// GET /api/ternak/katalog/:animalId — objek penuh, termasuk seluruh `tugas`.
catalog.get('/katalog/:animalId', (c) => {
  const animalId = c.req.param('animalId');
  const animal = ANIMAL_BY_ID.get(animalId);
  if (!animal) return c.json({ error: 'hewan tidak ditemukan di katalog' }, 404);
  return c.json(animal);
});

export default catalog;
