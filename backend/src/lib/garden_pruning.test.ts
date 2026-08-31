import { describe, it, expect } from 'vitest';
import { jadwalPangkas } from './garden_pruning';
import { PLANTS } from '../data/plants';

const aturan = { mulaiHari: 30, ulangHari: 14, catatan: 'Buang tunas air.' };

describe('jadwalPangkas', () => {
  it('null untuk tanaman tanpa aturan pangkas', () => {
    // Kebanyakan sayuran daun memang tidak dipangkas.
    expect(jadwalPangkas(undefined, '2026-07-01', null, '2026-08-31')).toBeNull();
  });

  it('pangkas pertama dihitung dari tanggal tanam', () => {
    const j = jadwalPangkas(aturan, '2026-08-01', null, '2026-08-15');
    expect(j!.berikutnya).toBe('2026-08-31');
    expect(j!.telat).toBe(0);
  });

  it('sesudah dipangkas, berikutnya dihitung dari pangkas terakhir', () => {
    const j = jadwalPangkas(aturan, '2026-07-01', '2026-08-20', '2026-08-25');
    expect(j!.berikutnya).toBe('2026-09-03');
    expect(j!.telat).toBe(0);
  });

  it('yang lewat tenggat melaporkan berapa hari telat', () => {
    // Pangkas terakhir 1 Agustus + 14 hari = jatuh tempo 15 Agustus.
    const j = jadwalPangkas(aturan, '2026-07-01', '2026-08-01', '2026-08-31');
    expect(j!.berikutnya).toBe('2026-08-15');
    expect(j!.telat).toBe(16);
  });

  it('tanaman yang terlalu muda belum dijadwalkan telat', () => {
    const j = jadwalPangkas(aturan, '2026-08-25', null, '2026-08-31');
    expect(j!.telat).toBe(0);
  });

  it('tepat pada hari jatuh tempo belum dihitung telat', () => {
    const j = jadwalPangkas(aturan, '2026-08-01', null, '2026-08-31');
    expect(j!.telat).toBe(0);
  });

  it('tanggalnya tidak bergeser oleh zona waktu', () => {
    // Melewati pergantian bulan dan batas DST di belahan bumi mana pun.
    const j = jadwalPangkas(aturan, '2026-03-01', null, '2026-03-15');
    expect(j!.berikutnya).toBe('2026-03-31');
  });
});

describe('kolom pruning di katalog', () => {
  const berpangkas = PLANTS.filter((p) => p.pruning);

  it('ada isinya, tapi tidak untuk seluruh katalog', () => {
    // Mengisi aturan pangkas untuk semua tanaman berarti menebak, dan tebakan
    // yang tampil seyakin fakta lebih buruk daripada kolom yang kosong.
    expect(berpangkas.length).toBeGreaterThan(0);
    expect(berpangkas.length).toBeLessThan(PLANTS.length / 2);
  });

  it('angkanya masuk akal dan urut', () => {
    for (const p of berpangkas) {
      expect(p.pruning!.mulaiHari, p.id).toBeGreaterThan(0);
      expect(p.pruning!.ulangHari, p.id).toBeGreaterThan(0);
      // Pangkas pertama tidak mungkin lebih cepat daripada jarak antar pangkas
      // berikutnya — itu berarti tanamannya dipangkas sebelum tumbuh.
      expect(p.pruning!.mulaiHari, p.id).toBeGreaterThanOrEqual(p.pruning!.ulangHari);
    }
  });

  it('tiap aturan menjelaskan apa yang dipangkas', () => {
    // "Pangkas" tanpa keterangan tidak membantu siapa pun berdiri di depan
    // tanaman memegang gunting.
    for (const p of berpangkas) {
      expect(p.pruning!.catatan.length, p.id).toBeGreaterThan(20);
    }
  });

  it('tidak ada tanaman hias yang diberi aturan pangkas panen', () => {
    // Hias punya `ornamental.grooming` sendiri; dua sumber aturan untuk hal
    // yang sama akan saling bertentangan diam-diam.
    for (const p of berpangkas) {
      expect(p.ornamental, p.id).toBeUndefined();
    }
  });
});
