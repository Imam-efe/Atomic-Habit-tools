import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TernakAnimalsTab } from '../TernakAnimals';

afterEach(() => {
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderTab() {
  return render(
    <TernakAnimalsTab
      hewan={[]}
      subjekKandang={[]}
      prefill={null}
      clearPrefill={() => {}}
      focus={null}
      clearFocus={() => {}}
      onChanged={() => {}}
    />
  );
}

describe('TernakAnimals — peringatan POST ditampilkan (T5)', () => {
  it('menampilkan peringatan dari respons POST /ternak/hewan tepat setelah tersimpan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      id: 'h1',
      peringatan: '2 tugas perawatan spesies ini menempel ke kandang, jadi belum dijadwalkan karena hewan ini belum punya kandang. Pilih kandang untuk mengaktifkannya.',
    }, 201)));

    renderTab();
    fireEvent.click(screen.getByText('+ Tambah hewan'));
    fireEvent.change(screen.getByPlaceholderText('Nama jenis hewan (di luar katalog)'), {
      target: { value: 'Kadal kebun' },
    });
    fireEvent.click(screen.getByText('Simpan'));

    expect(await screen.findByText(/belum punya kandang/)).toBeInTheDocument();
  });

  it('tidak menampilkan apa pun ketika respons tidak membawa peringatan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'h1' }, 201)));

    renderTab();
    fireEvent.click(screen.getByText('+ Tambah hewan'));
    fireEvent.change(screen.getByPlaceholderText('Nama jenis hewan (di luar katalog)'), {
      target: { value: 'Kadal kebun' },
    });
    fireEvent.click(screen.getByText('Simpan'));

    await waitFor(() => expect(screen.queryByText('+ Tambah hewan')).toBeInTheDocument());
    expect(screen.queryByText(/belum punya kandang/)).not.toBeInTheDocument();
  });

  it('tombol tutup menghilangkan peringatan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'h1', peringatan: 'Peringatan uji.' }, 201)));

    renderTab();
    fireEvent.click(screen.getByText('+ Tambah hewan'));
    fireEvent.change(screen.getByPlaceholderText('Nama jenis hewan (di luar katalog)'), {
      target: { value: 'Kadal kebun' },
    });
    fireEvent.click(screen.getByText('Simpan'));

    const peringatan = await screen.findByText(/Peringatan uji\./);
    expect(peringatan).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Tutup peringatan'));
    expect(screen.queryByText(/Peringatan uji\./)).not.toBeInTheDocument();
  });
});
