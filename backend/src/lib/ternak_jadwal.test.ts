/**
 * Uji inti penjadwalan ternak.
 *
 * Yang paling menentukan di sini bukan aritmetika tanggalnya, melainkan
 * penyaringan sasaran: tugas ganti air milik akuarium, bukan milik tiap ikan
 * di dalamnya.
 */
import { describe, it, expect } from 'vitest';
import { jadwalSubjek, type Subjek, type Ubahan } from './ternak_jadwal';
import type { TugasKatalog } from '../data/animals';

const HARI_INI = '2026-06-01';

const tugasGantiAir: TugasKatalog = {
  kode: 'ganti-air',
  nama: 'Ganti air 25%',
  tiapHari: 7,
  mulaiHari: 7,
  sasaran: 'kandang',
  cara: 'Sedot 25% air dasar dengan selang, ganti air baru yang sudah diendapkan.',
  penting: true,
};

const tugasVaksin: TugasKatalog = {
  kode: 'vaksin',
  nama: 'Vaksin tahunan',
  tiapHari: 365,
  mulaiHari: 56,
  sasaran: 'hewan',
  cara: 'Ke dokter hewan. Seri pertama umur delapan sampai dua belas minggu.',
  penting: true,
};

const KATALOG = [tugasGantiAir, tugasVaksin];

function subjek(over: Partial<Subjek> = {}): Subjek {
  return {
    tipe: 'hewan', id: 'h1', nama: 'Guppy',
    animalId: 'guppy', mulai: '2026-01-01', ...over,
  };
}

describe('penyaringan sasaran', () => {
  it('jadwal kandang hanya memuat tugas bersasaran kandang', () => {
    const hasil = jadwalSubjek(
      subjek({ tipe: 'kandang', id: 'k1', nama: 'Akuarium depan' }),
      KATALOG, [], new Map(), HARI_INI
    );
    expect(hasil.map((t) => t.kodeTugas)).toEqual(['ganti-air']);
  });

  it('jadwal hewan hanya memuat tugas bersasaran hewan', () => {
    const hasil = jadwalSubjek(subjek(), KATALOG, [], new Map(), HARI_INI);
    expect(hasil.map((t) => t.kodeTugas)).toEqual(['vaksin']);
  });
});

describe('tanggal jatuh tempo', () => {
  it('tugas pertama dihitung dari mulai + mulaiHari, bukan + tiapHari', () => {
    const hasil = jadwalSubjek(subjek(), [tugasVaksin], [], new Map(), HARI_INI);
    expect(hasil[0].berikutnya).toBe('2026-02-26');
  });

  it('sesudah pernah dikerjakan, dihitung dari log terakhir + interval', () => {
    const hasil = jadwalSubjek(
      subjek(), [tugasVaksin], [], new Map([['vaksin', '2026-05-01']]), HARI_INI
    );
    expect(hasil[0].berikutnya).toBe('2027-05-01');
    expect(hasil[0].telat).toBe(0);
  });

  it('telat dihitung dalam hari penuh', () => {
    const hasil = jadwalSubjek(
      subjek({ tipe: 'kandang' }), [tugasGantiAir], [],
      new Map([['ganti-air', '2026-05-20']]), HARI_INI
    );
    expect(hasil[0].berikutnya).toBe('2026-05-27');
    expect(hasil[0].telat).toBe(5);
  });

  it('tepat pada hari jatuh tempo belum dihitung telat', () => {
    const hasil = jadwalSubjek(
      subjek({ tipe: 'kandang' }), [tugasGantiAir], [],
      new Map([['ganti-air', '2026-05-25']]), HARI_INI
    );
    expect(hasil[0].berikutnya).toBe('2026-06-01');
    expect(hasil[0].telat).toBe(0);
  });
});

describe('hewan di luar katalog', () => {
  it('animalId null menghasilkan daftar kosong, bukan melempar', () => {
    const hasil = jadwalSubjek(
      subjek({ animalId: null }), KATALOG, [], new Map(), HARI_INI
    );
    expect(hasil).toEqual([]);
  });
});

describe('override', () => {
  it('tiapHari dari ubahan mengalahkan katalog', () => {
    const ubahan: Ubahan[] = [{
      kodeTugas: 'vaksin', tiapHari: 180, nonaktif: false,
      namaKustom: null, caraKustom: null,
    }];
    const hasil = jadwalSubjek(
      subjek(), [tugasVaksin], ubahan, new Map([['vaksin', '2026-01-01']]), HARI_INI
    );
    expect(hasil[0].berikutnya).toBe('2026-06-30');
    expect(hasil[0].sumberInterval).toBe('ubahan');
  });

  it('tiapHari null pada ubahan tetap memakai interval katalog', () => {
    const ubahan: Ubahan[] = [{
      kodeTugas: 'vaksin', tiapHari: null, nonaktif: false,
      namaKustom: 'Vaksin dari drh. Rina', caraKustom: null,
    }];
    const hasil = jadwalSubjek(
      subjek(), [tugasVaksin], ubahan, new Map([['vaksin', '2026-01-01']]), HARI_INI
    );
    expect(hasil[0].berikutnya).toBe('2027-01-01');
    expect(hasil[0].sumberInterval).toBe('katalog');
    expect(hasil[0].labelTugas).toBe('Vaksin dari drh. Rina');
  });

  it('nonaktif menghilangkan tugas dari jadwal', () => {
    const ubahan: Ubahan[] = [{
      kodeTugas: 'vaksin', tiapHari: null, nonaktif: true,
      namaKustom: null, caraKustom: null,
    }];
    expect(jadwalSubjek(subjek(), [tugasVaksin], ubahan, new Map(), HARI_INI)).toEqual([]);
  });

  it('caraKustom mengalahkan cara katalog', () => {
    const ubahan: Ubahan[] = [{
      kodeTugas: 'vaksin', tiapHari: null, nonaktif: false,
      namaKustom: null, caraKustom: 'Bawa ke klinik depan pasar, buka Sabtu pagi.',
    }];
    const hasil = jadwalSubjek(subjek(), [tugasVaksin], ubahan, new Map(), HARI_INI);
    expect(hasil[0].cara).toBe('Bawa ke klinik depan pasar, buka Sabtu pagi.');
  });
});

describe('tugas custom', () => {
  it('ubahan dengan kode di luar katalog jadi tugas tambahan', () => {
    const ubahan: Ubahan[] = [{
      kodeTugas: 'obat-pasca-operasi', tiapHari: 1, nonaktif: false,
      namaKustom: 'Antibiotik pasca steril',
      caraKustom: 'Setengah tablet pagi, dicampur pakan basah.',
    }];
    const hasil = jadwalSubjek(subjek(), [tugasVaksin], ubahan, new Map(), HARI_INI);
    expect(hasil.map((t) => t.kodeTugas).sort()).toEqual(['obat-pasca-operasi', 'vaksin']);
    const custom = hasil.find((t) => t.kodeTugas === 'obat-pasca-operasi')!;
    expect(custom.labelTugas).toBe('Antibiotik pasca steril');
    expect(custom.penting).toBe(false);
  });

  it('tugas custom tanpa tiapHari diabaikan, bukan dijadwalkan tiap nol hari', () => {
    const ubahan: Ubahan[] = [{
      kodeTugas: 'entah', tiapHari: null, nonaktif: false,
      namaKustom: 'Entah', caraKustom: null,
    }];
    expect(jadwalSubjek(subjek(), [], ubahan, new Map(), HARI_INI)).toEqual([]);
  });
});

describe('urutan', () => {
  it('yang paling telat lebih dulu', () => {
    const hasil = jadwalSubjek(
      subjek({ tipe: 'kandang' }),
      [tugasGantiAir, { ...tugasGantiAir, kode: 'sikat', nama: 'Sikat kaca', tiapHari: 30 }],
      [],
      new Map([['ganti-air', '2026-05-28'], ['sikat', '2026-01-01']]),
      HARI_INI
    );
    expect(hasil[0].kodeTugas).toBe('sikat');
  });
});

describe('kekebalan zona waktu', () => {
  it('hasilnya sama walau tanggalnya melintasi awal bulan', () => {
    const hasil = jadwalSubjek(
      subjek({ tipe: 'kandang' }), [tugasGantiAir], [],
      new Map([['ganti-air', '2026-02-25']]), '2026-03-04'
    );
    expect(hasil[0].berikutnya).toBe('2026-03-04');
    expect(hasil[0].telat).toBe(0);
  });
});
