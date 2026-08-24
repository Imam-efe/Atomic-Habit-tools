import { describe, it, expect } from 'vitest';
import { growthPhase, fertilizeGuidance } from './garden_fertilize_phase';

describe('growthPhase', () => {
  it('menganggap tanaman muda sebagai fase semai', () => {
    expect(growthPhase(3, 30, false)).toBe('semai');
  });

  it('menganggap pertengahan umur sebagai fase vegetatif', () => {
    expect(growthPhase(15, 30, false)).toBe('vegetatif');
  });

  it('menganggap mendekati umur panen sebagai fase generatif', () => {
    expect(growthPhase(25, 30, false)).toBe('generatif');
  });

  it('tetap generatif setelah pernah dipanen, walau umur relatif kecil', () => {
    // Tanaman panen-berulang yang baru dipangkas ulang tetap dalam siklus produksi.
    expect(growthPhase(2, 30, true)).toBe('generatif');
  });

  it('tidak pernah membagi dengan nol saat umur panen tidak diketahui', () => {
    expect(() => growthPhase(10, 0, false)).not.toThrow();
    expect(growthPhase(10, 0, false)).toBe('generatif');
  });

  it('batas fase persis di tepi rasio', () => {
    expect(growthPhase(8, 30, false)).toBe('semai'); // rasio 0,267 < 0,3
    expect(growthPhase(9, 30, false)).toBe('vegetatif'); // rasio tepat 0,3 -> bukan < 0,3
    expect(growthPhase(20, 30, false)).toBe('vegetatif'); // rasio 0,667 < 0,7
    expect(growthPhase(21, 30, false)).toBe('generatif'); // rasio tepat 0,7 -> bukan < 0,7
  });
});

describe('fertilizeGuidance', () => {
  it('menyarankan dosis ringan untuk fase semai', () => {
    expect(fertilizeGuidance('semai')).toContain('ringan');
  });

  it('menyarankan nitrogen untuk fase vegetatif', () => {
    expect(fertilizeGuidance('vegetatif')).toContain('nitrogen');
  });

  it('menyarankan fosfor dan kalium untuk fase generatif', () => {
    expect(fertilizeGuidance('generatif')).toContain('fosfor');
    expect(fertilizeGuidance('generatif')).toContain('kalium');
  });
});
