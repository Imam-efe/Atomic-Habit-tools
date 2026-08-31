import { describe, it, expect } from 'vitest';
import { susunLembarKerja, type TugasKebun } from '../gardenWorksheet';

const tugas = (over: Partial<TugasKebun> = {}): TugasKebun => ({
  plantingId: 'p1', label: 'Tomat', location: 'Bedengan A',
  action: 'siram', dueDate: '2026-03-02', overdueDays: 0, ...over,
});

describe('susunLembarKerja', () => {
  it('selalu tepat tujuh hari berurutan', () => {
    const l = susunLembarKerja([], '2026-03-02');
    expect(l.hari).toHaveLength(7);
    expect(l.hari.map((h) => h.date)).toEqual([
      '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
      '2026-03-06', '2026-03-07', '2026-03-08',
    ]);
    expect(l.selesai).toBe('2026-03-08');
  });

  it('hari kosong tetap ikut tercetak', () => {
    // Baris kosong memberi tahu "Kamis memang tidak ada kerjaan"; hari yang
    // dilompati hanya menyisakan pertanyaan apakah datanya hilang.
    const l = susunLembarKerja([tugas({ dueDate: '2026-03-02' })], '2026-03-02');
    expect(l.hari[0].tugas).toHaveLength(1);
    expect(l.hari[3].tugas).toEqual([]);
  });

  it('memberi nama hari Indonesia', () => {
    const l = susunLembarKerja([], '2026-03-02'); // Senin
    expect(l.hari[0].dayName).toBe('Senin');
    expect(l.hari[6].dayName).toBe('Minggu');
  });

  it('memisahkan tugas terlewat dari hari pertama', () => {
    // Utang minggu lalu bukan pekerjaan hari Senin — menaruhnya di sana
    // membuatnya terlihat terjadwal, padahal itu keputusan tersendiri.
    const l = susunLembarKerja(
      [tugas({ dueDate: '2026-02-25', overdueDays: 5 }), tugas({ dueDate: '2026-03-02' })],
      '2026-03-02'
    );
    expect(l.terlewat).toHaveLength(1);
    expect(l.terlewat[0].dueDate).toBe('2026-02-25');
    expect(l.hari[0].tugas).toHaveLength(1);
  });

  it('mengurutkan siram, pupuk, lalu panen di dalam satu hari', () => {
    const l = susunLembarKerja(
      [
        tugas({ action: 'panen', label: 'A' }),
        tugas({ action: 'siram', label: 'B' }),
        tugas({ action: 'pupuk', label: 'C' }),
      ],
      '2026-03-02'
    );
    expect(l.hari[0].tugas.map((t) => t.action)).toEqual(['siram', 'pupuk', 'panen']);
  });

  it('aksi sejenis diurutkan menurut nama tanaman', () => {
    const l = susunLembarKerja(
      [tugas({ label: 'Zucchini' }), tugas({ label: 'Bayam' })],
      '2026-03-02'
    );
    expect(l.hari[0].tugas.map((t) => t.label)).toEqual(['Bayam', 'Zucchini']);
  });

  it('aksi tak dikenal diletakkan di akhir, bukan dibuang', () => {
    const l = susunLembarKerja(
      [tugas({ action: 'pangkas', label: 'A' }), tugas({ action: 'siram', label: 'B' })],
      '2026-03-02'
    );
    expect(l.hari[0].tugas.map((t) => t.action)).toEqual(['siram', 'pangkas']);
  });

  it('totalTugas menghitung yang terlewat sekaligus yang terjadwal', () => {
    const l = susunLembarKerja(
      [tugas({ dueDate: '2026-02-20' }), tugas({ dueDate: '2026-03-02' }), tugas({ dueDate: '2026-03-05' })],
      '2026-03-02'
    );
    expect(l.totalTugas).toBe(3);
  });

  it('tugas di luar minggu ini tidak ikut terhitung', () => {
    const l = susunLembarKerja([tugas({ dueDate: '2026-04-01' })], '2026-03-02');
    expect(l.totalTugas).toBe(0);
    expect(l.terlewat).toEqual([]);
  });

  it('melewati pergantian bulan dengan benar', () => {
    const l = susunLembarKerja([], '2026-02-26');
    expect(l.hari.map((h) => h.date)).toEqual([
      '2026-02-26', '2026-02-27', '2026-02-28',
      '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04',
    ]);
  });
});
