import { describe, it, expect } from 'vitest';
import { familyOf, checkRotation, type LocationPlanting } from './garden_rotation';

describe('familyOf', () => {
  it('mengenali famili terong-terongan', () => {
    expect(familyOf('tomat')).toBe('Solanaceae');
    expect(familyOf('cabai-rawit')).toBe('Solanaceae');
  });

  it('mengembalikan null untuk tanaman tanpa famili yang dipetakan', () => {
    // Pohon buah tahunan sengaja tidak dipetakan — rotasi tidak berlaku untuknya.
    expect(familyOf('mangga')).toBeNull();
  });
});

const p = (overrides: Partial<LocationPlanting>): LocationPlanting => ({
  plantingId: 'x',
  plantId: 'tomat',
  label: 'Tomat',
  location: 'Bedeng A',
  plantedDate: '2026-01-01',
  ...overrides,
});

describe('checkRotation', () => {
  it('tidak memperingatkan kalau lokasi hanya pernah ditanami sekali', () => {
    expect(checkRotation([p({})])).toEqual([]);
  });

  it('memperingatkan famili sama berturut-turut di lokasi sama', () => {
    const result = checkRotation([
      p({ plantingId: 'p1', plantId: 'tomat', label: 'Tomat', plantedDate: '2026-01-01' }),
      p({ plantingId: 'p2', plantId: 'cabai-rawit', label: 'Cabai', plantedDate: '2026-06-01' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].plantingId).toBe('p2');
    expect(result[0].previousLabel).toBe('Tomat');
    expect(result[0].familyLabel).toBe('terong-terongan');
  });

  it('tidak memperingatkan famili berbeda berturut-turut', () => {
    const result = checkRotation([
      p({ plantingId: 'p1', plantId: 'tomat', plantedDate: '2026-01-01' }),
      p({ plantingId: 'p2', plantId: 'kangkung', label: 'Kangkung', plantedDate: '2026-06-01' }),
    ]);
    expect(result).toEqual([]);
  });

  it('rotasi yang benar (famili beda) memutus rantai famili sama sebelumnya', () => {
    // Tomat -> kangkung (rotasi benar) -> cabai. Cabai dan tomat satu famili,
    // tapi keduanya tidak lagi bertetangga langsung karena kangkung menyela —
    // jadi tidak boleh ditandai seolah tomat dan cabai berturut-turut.
    const result = checkRotation([
      p({ plantingId: 'p1', plantId: 'tomat', plantedDate: '2025-01-01' }),
      p({ plantingId: 'p2', plantId: 'kangkung', label: 'Kangkung', plantedDate: '2025-06-01' }),
      p({ plantingId: 'p3', plantId: 'cabai-rawit', label: 'Cabai', plantedDate: '2026-01-01' }),
    ]);
    expect(result).toEqual([]);
  });

  it('hanya melaporkan satu peringatan untuk pasangan terbaru, walau rantai famili sama lebih dari dua', () => {
    const result = checkRotation([
      p({ plantingId: 'p1', plantId: 'tomat', plantedDate: '2025-01-01' }),
      p({ plantingId: 'p2', plantId: 'cabai-rawit', label: 'Cabai', plantedDate: '2025-06-01' }),
      p({ plantingId: 'p3', plantId: 'terong', label: 'Terong', plantedDate: '2026-01-01' }),
    ]);
    // Tiga-tiganya Solanaceae berturut-turut, tapi hanya pasangan terbaru yang dilaporkan.
    expect(result).toHaveLength(1);
    expect(result[0].plantingId).toBe('p3');
    expect(result[0].previousLabel).toBe('Cabai');
  });

  it('mengabaikan tanaman yang familinya tidak dipetakan', () => {
    const result = checkRotation([
      p({ plantingId: 'p1', plantId: 'mangga', label: 'Mangga', plantedDate: '2026-01-01' }),
      p({ plantingId: 'p2', plantId: 'mangga', label: 'Mangga', plantedDate: '2026-06-01' }),
    ]);
    expect(result).toEqual([]);
  });

  it('memisahkan lokasi berbeda satu sama lain', () => {
    const result = checkRotation([
      p({ plantingId: 'p1', plantId: 'tomat', location: 'Bedeng A', plantedDate: '2026-01-01' }),
      p({ plantingId: 'p2', plantId: 'cabai-rawit', location: 'Bedeng A', plantedDate: '2026-06-01' }),
      p({ plantingId: 'p3', plantId: 'kangkung', location: 'Bedeng B', plantedDate: '2026-01-01' }),
      p({ plantingId: 'p4', plantId: 'ubi-jalar', location: 'Bedeng B', plantedDate: '2026-06-01' }),
    ]);
    expect(result.map((r) => r.plantingId).sort()).toEqual(['p2', 'p4']);
  });
});
