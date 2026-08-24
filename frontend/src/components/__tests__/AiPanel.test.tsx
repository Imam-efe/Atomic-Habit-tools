/**
 * Panel AI dipasang di sembilan layar, jadi satu cacat di sini muncul di
 * sembilan tempat. Yang diuji adalah perilaku yang menentukan apakah
 * pengguna bisa mempercayainya: aksi uang tidak pernah tersimpan diam-diam,
 * layar hanya dimuat ulang kalau memang ada yang berubah, dan kegagalan
 * terlihat alih-alih hilang.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { AiPanel } from '../AiPanel';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Balas /agent dengan satu jawaban tetap; /agent/confirm dengan yang lain. */
function mockAgent(reply: unknown, confirmReply: unknown = { status: 'dijalankan', ringkasan: 'Tersimpan.' }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void init;
    return String(url).includes('/agent/confirm') ? json(confirmReply) : json(reply);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function bukaPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Tanya atau suruh AI/i }));
}

async function tanya(user: ReturnType<typeof userEvent.setup>, teks: string) {
  await bukaPanel(user);
  await user.type(screen.getByPlaceholderText(/Contoh:/i), teks);
  await user.click(screen.getByRole('button', { name: 'Kirim' }));
}

describe('AiPanel', () => {
  it('menampilkan jawaban AI', async () => {
    mockAgent({ jawaban: 'Kangkung belum disiram dua hari.', aksi: [], alatTidakDikenal: [] });
    const user = userEvent.setup();
    render(<AiPanel module="kebun" />);

    await tanya(user, 'kebunku gimana?');
    expect(await screen.findByText(/Kangkung belum disiram dua hari/)).toBeInTheDocument();
  });

  it('mengirim modul layar supaya alatnya dibatasi', async () => {
    const fetchMock = mockAgent({ jawaban: 'ok', aksi: [], alatTidakDikenal: [] });
    const user = userEvent.setup();
    render(<AiPanel module="kebun" />);

    await tanya(user, 'halo');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ module: 'kebun', message: 'halo' });
  });

  it('memuat ulang layar setelah ada aksi yang benar-benar berjalan', async () => {
    mockAgent({
      jawaban: 'Sudah saya buatkan.',
      aksi: [{ alat: 'kebun.tanam', modul: 'kebun', status: 'dijalankan', ringkasan: '3 tanaman dicatat.' }],
      alatTidakDikenal: [],
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<AiPanel module="kebun" onChanged={onChanged} />);

    await tanya(user, 'buatkan daftar tanaman');
    expect(await screen.findByText(/3 tanaman dicatat/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('tidak memuat ulang layar untuk pertanyaan biasa', async () => {
    // Pertanyaan tidak mengubah apa pun; memuat ulang membuat layar berkedip
    // tanpa alasan.
    mockAgent({ jawaban: 'Ada 3 tanaman.', aksi: [], alatTidakDikenal: [] });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<AiPanel module="kebun" onChanged={onChanged} />);

    await tanya(user, 'ada berapa tanaman?');
    await screen.findByText(/Ada 3 tanaman/);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('menahan aksi uang dan menampilkan angkanya sebelum disimpan', async () => {
    // Menyetujui sesuatu yang tidak terlihat bukan persetujuan.
    mockAgent({
      jawaban: 'Mau saya catat?',
      aksi: [{
        alat: 'uang.catat', modul: 'uang', status: 'perlu_konfirmasi',
        ringkasan: 'Perlu persetujuanmu sebelum disimpan.',
        argumen: { jenis: 'expense', jumlah: 50000 },
      }],
      alatTidakDikenal: [],
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<AiPanel module="uang" onChanged={onChanged} />);

    await tanya(user, 'catat jajan 50rb');
    expect(await screen.findByText(/jumlah: 50000/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simpan' })).toBeInTheDocument();
    // Belum tersimpan sampai ditekan.
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('menyimpan aksi uang hanya setelah tombol ditekan', async () => {
    const fetchMock = mockAgent({
      jawaban: 'Mau saya catat?',
      aksi: [{
        alat: 'uang.catat', modul: 'uang', status: 'perlu_konfirmasi',
        ringkasan: 'Perlu persetujuanmu.', argumen: { jenis: 'expense', jumlah: 50000 },
      }],
      alatTidakDikenal: [],
    }, { status: 'dijalankan', ringkasan: 'Pengeluaran Rp50.000 dicatat.' });

    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<AiPanel module="uang" onChanged={onChanged} />);

    await tanya(user, 'catat jajan 50rb');
    await user.click(await screen.findByRole('button', { name: 'Simpan' }));

    expect(await screen.findByText(/Pengeluaran Rp50.000 dicatat/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();

    const confirmCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/agent/confirm'));
    expect(JSON.parse(String(confirmCall?.[1]?.body))).toMatchObject({
      tool: 'uang.catat',
      args: { jenis: 'expense', jumlah: 50000 },
    });
  });

  it('menampilkan aksi yang gagal, tidak menyembunyikannya', async () => {
    mockAgent({
      jawaban: 'Sebagian gagal.',
      aksi: [
        { alat: 'kebun.tanam', modul: 'kebun', status: 'dijalankan', ringkasan: '1 tanaman dicatat.' },
        { alat: 'kebun.rawat', modul: 'kebun', status: 'gagal', ringkasan: 'tidak menemukan tanaman "anggur"' },
      ],
      alatTidakDikenal: [],
    });
    const user = userEvent.setup();
    render(<AiPanel module="kebun" />);

    await tanya(user, 'tanam lalu siram anggur');
    expect(await screen.findByText(/tidak menemukan tanaman/)).toBeInTheDocument();
    expect(screen.getByText(/1 tanaman dicatat/)).toBeInTheDocument();
  });

  it('menjelaskan saat AI meminta alat di luar layar ini', async () => {
    mockAgent({ jawaban: 'Hmm.', aksi: [], alatTidakDikenal: ['uang.catat'] });
    const user = userEvent.setup();
    render(<AiPanel module="kebun" />);

    await tanya(user, 'catat pengeluaran');
    expect(await screen.findByText(/tidak bisa dikerjakan dari layar ini/i)).toBeInTheDocument();
  });

  it('menampilkan pesan saat AI sedang tidak bisa dihubungi', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'ai_unavailable', message: 'AI sedang sibuk.' }, 503)));
    const user = userEvent.setup();
    render(<AiPanel module="kebun" />);

    await tanya(user, 'halo');
    expect(await screen.findByText('AI sedang sibuk.')).toBeInTheDocument();
  });

  it('menampilkan pesan saat jaringan mati', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const user = userEvent.setup();
    render(<AiPanel module="kebun" />);

    await tanya(user, 'halo');
    expect(await screen.findByText(/Tidak ada jaringan/)).toBeInTheDocument();
  });

  it('tidak mengirim pertanyaan kosong', async () => {
    const fetchMock = mockAgent({ jawaban: 'x', aksi: [], alatTidakDikenal: [] });
    const user = userEvent.setup();
    render(<AiPanel module="kebun" />);

    await bukaPanel(user);
    expect(screen.getByRole('button', { name: 'Kirim' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('menawarkan contoh pertanyaan yang bisa langsung ditekan', async () => {
    const fetchMock = mockAgent({ jawaban: 'ok', aksi: [], alatTidakDikenal: [] });
    const user = userEvent.setup();
    render(<AiPanel module="kebun" suggestions={['Tanaman mana yang perlu disiram?']} />);

    await bukaPanel(user);
    await user.click(screen.getByRole('button', { name: 'Tanaman mana yang perlu disiram?' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.message).toBe('Tanaman mana yang perlu disiram?');
  });

  it('tetap tertutup sampai pengguna membukanya', () => {
    mockAgent({ jawaban: 'x', aksi: [], alatTidakDikenal: [] });
    render(<AiPanel module="kebun" />);
    expect(screen.queryByPlaceholderText(/Contoh:/i)).not.toBeInTheDocument();
  });
});
