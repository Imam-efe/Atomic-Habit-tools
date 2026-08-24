/**
 * Membaca rencana yang dikembalikan model, sebelum apa pun dijalankan.
 *
 * Dipisahkan dari rutenya supaya bisa diuji tanpa database dan tanpa AI:
 * bagian yang paling mungkin salah di alur ini bukan SQL-nya, melainkan
 * bentuk jawaban model — nama alat yang tidak ada, argumen yang bukan
 * objek, daftar aksi yang panjangnya tak masuk akal. Semuanya harus
 * berhenti di sini, bukan di tengah eksekusi ketika sebagian sudah tertulis.
 */

import { TOOL_BY_NAME, type AgentTool } from './agent_tools';

export interface PlannedAction {
  tool: AgentTool;
  args: Record<string, unknown>;
}

export interface ParsedPlan {
  jawaban: string;
  actions: PlannedAction[];
  /** Nama alat yang diminta model tapi tidak dikenal. Dilaporkan, tidak dijalankan. */
  unknownTools: string[];
}

/**
 * Batas jumlah aksi per permintaan.
 *
 * "Buatkan daftar tanaman" wajar menghasilkan satu aksi berisi banyak
 * tanaman; yang tidak wajar adalah model mengulang alat yang sama belasan
 * kali karena salah paham. Batas ini menjaga satu kesalahpahaman tetap
 * murah.
 */
export const MAX_ACTIONS = 6;

/**
 * Ubah jawaban mentah model menjadi rencana yang sudah tersaring.
 *
 * Jawaban yang tidak berbentuk sama sekali menghasilkan rencana kosong,
 * bukan lemparan galat: pengguna lebih baik mendapat "belum bisa membantu"
 * daripada layar error, dan pemanggil sudah punya jalur itu.
 */
export function parsePlan(raw: unknown, allowed: readonly AgentTool[]): ParsedPlan {
  const empty: ParsedPlan = { jawaban: '', actions: [], unknownTools: [] };
  if (typeof raw !== 'object' || raw === null) return empty;

  const obj = raw as Record<string, unknown>;
  const jawaban = typeof obj.jawaban === 'string' ? obj.jawaban.trim() : '';

  const allowedNames = new Set(allowed.map((t) => t.name));
  const actions: PlannedAction[] = [];
  const unknownTools: string[] = [];

  const list = Array.isArray(obj.aksi) ? obj.aksi : [];
  for (const item of list) {
    if (actions.length >= MAX_ACTIONS) break;
    if (typeof item !== 'object' || item === null) continue;

    const entry = item as Record<string, unknown>;
    const name = typeof entry.alat === 'string' ? entry.alat.trim() : '';
    if (!name) continue;

    // Alat di luar cakupan layar ditolak sama seperti alat yang tidak ada:
    // panel Kebun tidak boleh menulis ke buku kas hanya karena model
    // menyebut namanya.
    const tool = allowedNames.has(name) ? TOOL_BY_NAME.get(name) : undefined;
    if (!tool) {
      if (!unknownTools.includes(name)) unknownTools.push(name);
      continue;
    }

    const args =
      typeof entry.argumen === 'object' && entry.argumen !== null
        ? (entry.argumen as Record<string, unknown>)
        : {};

    actions.push({ tool, args });
  }

  return { jawaban, actions, unknownTools };
}
