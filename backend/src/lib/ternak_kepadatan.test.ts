/**
 * Uji kepadatan kandang.
 *
 * Akuarium 20 liter berisi sepuluh mas koki adalah kalimat kematian yang
 * pelan, dan tidak ada satu pun tugas terjadwal yang akan menangkapnya.
 */
import { describe, it, expect } from 'vitest';
import { cekKepadatan } from './ternak_kepadatan';

describe('cekKepadatan', () => {
  it('menghitung kebutuhan dari jumlah dikali liter per ekor', () => {
    const k = cekKepadatan(100, [{ animalId: 'koi', jumlah: 4, literPerEkor: 20 }])!;
    expect(k.butuhLiter).toBe(80);
    expect(k.tersedia).toBe(100);
    expect(k.kelebihan).toBe(0);
    expect(k.sesak).toBe(false);
  });

  it('menandai sesak dan menyebut kelebihannya', () => {
    const k = cekKepadatan(20, [{ animalId: 'mas-koki', jumlah: 10, literPerEkor: 30 }])!;
    expect(k.butuhLiter).toBe(300);
    expect(k.kelebihan).toBe(280);
    expect(k.sesak).toBe(true);
  });

  it('menjumlah beberapa spesies dalam satu kandang', () => {
    const k = cekKepadatan(100, [
      { animalId: 'guppy', jumlah: 8, literPerEkor: 5 },
      { animalId: 'koi', jumlah: 2, literPerEkor: 20 },
    ])!;
    expect(k.butuhLiter).toBe(80);
  });

  it('penghuni tanpa liter per ekor dilewati, bukan dihitung nol', () => {
    // Nol akan membuat kandang penuh terlihat lapang; dilewati membuat
    // angkanya tidak lengkap tapi tidak pernah berbohong ke arah aman.
    const k = cekKepadatan(50, [
      { animalId: null, jumlah: 5, literPerEkor: null },
      { animalId: 'guppy', jumlah: 4, literPerEkor: 5 },
    ])!;
    expect(k.butuhLiter).toBe(20);
  });

  it('kandang tanpa volume tidak bisa dinilai', () => {
    expect(cekKepadatan(null, [{ animalId: 'koi', jumlah: 4, literPerEkor: 20 }])).toBeNull();
  });

  it('kandang kosong tidak sesak', () => {
    const k = cekKepadatan(50, [])!;
    expect(k.butuhLiter).toBe(0);
    expect(k.sesak).toBe(false);
  });
});
