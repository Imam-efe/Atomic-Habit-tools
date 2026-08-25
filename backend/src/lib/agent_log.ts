/**
 * Jejak aksi agen, dan pembatalannya.
 *
 * Agen menulis langsung ke sepuluh tabel. Dua hal jadi wajib begitu itu
 * benar: pengguna harus bisa melihat apa yang terjadi, dan harus bisa
 * membatalkannya. Tanpa yang kedua, satu daftar sepuluh tanaman yang salah
 * berarti sepuluh penghapusan manual — dan orang berhenti memakai fitur yang
 * kesalahannya lebih mahal daripada mengetik sendiri.
 *
 * Yang membuat pembatalan sederhana adalah id baris disimpan saat aksinya
 * berjalan. Membatalkan tidak perlu menebak apa pun, tidak perlu mencocokkan
 * waktu, dan tidak pernah menyentuh baris yang tidak dibuat agen.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { nanoid } from './nanoid';
import { TOOL_BY_NAME, type AgentTool, type ToolContext } from './agent_tools';

export interface LoggedAction {
  id: string;
  tool: string;
  module: string;
  message: string | null;
  summary: string;
  rowIds: string[];
  status: 'dijalankan' | 'dibatalkan';
  createdAt: number;
  undoneAt: number | null;
  /** Salah kalau alatnya tidak lagi dikenal, atau tidak ada baris untuk dihapus. */
  undoable: boolean;
}

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Aksi yang sudah pernah dicatat dengan id ini, atau null.
 *
 * Dipakai untuk kiriman ulang dari antrean offline: permintaan yang sudah
 * sampai tapi jawabannya tidak pernah diterima klien akan dikirim lagi, dan
 * tanpa penjagaan ini pengeluaran yang sama tercatat dua kali.
 */
export async function findAction(
  db: D1Database,
  userId: string,
  id: string
): Promise<{ summary: string; rowIds: string[] } | null> {
  const row = await db.prepare(
    'SELECT summary, row_ids_json FROM agent_actions WHERE id = ?1 AND user_id = ?2'
  ).bind(id, userId).first<{ summary: string; row_ids_json: string }>();

  return row ? { summary: row.summary, rowIds: parseList(row.row_ids_json) } : null;
}

/**
 * Catat satu aksi yang sudah berjalan. Mengembalikan id catatannya.
 *
 * `id` boleh datang dari klien supaya kiriman ulang bisa dikenali. Formatnya
 * dibatasi pemanggil; INSERT tetap membawa user_id, jadi id yang ditebak
 * hanya bisa bentrok dengan milik sendiri.
 */
export async function recordAction(
  db: D1Database,
  userId: string,
  entry: {
    tool: string;
    module: string;
    message: string;
    args: Record<string, unknown>;
    summary: string;
    rowIds: string[];
    undoMeta?: Record<string, unknown>;
    id?: string;
  }
): Promise<string> {
  const id = entry.id ?? nanoid();
  await db.prepare(
    `INSERT INTO agent_actions
       (id, user_id, tool, module, message, args_json, row_ids_json, undo_meta_json, summary, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'dijalankan')`
  ).bind(
    id, userId, entry.tool, entry.module,
    entry.message.slice(0, 500),
    JSON.stringify(entry.args).slice(0, 4000),
    JSON.stringify(entry.rowIds),
    JSON.stringify(entry.undoMeta ?? {}),
    entry.summary.slice(0, 300)
  ).run();

  return id;
}

/** Riwayat aksi terbaru, terbaru dulu. */
export async function listActions(
  db: D1Database,
  userId: string,
  limit = 50
): Promise<LoggedAction[]> {
  const rows = await db.prepare(
    `SELECT id, tool, module, message, summary, row_ids_json, status, created_at, undone_at
       FROM agent_actions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2`
  ).bind(userId, Math.min(200, Math.max(1, limit))).all<{
    id: string; tool: string; module: string; message: string | null; summary: string;
    row_ids_json: string; status: string; created_at: number; undone_at: number | null;
  }>();

  return (rows.results ?? []).map((r) => {
    const rowIds = parseList(r.row_ids_json);
    return {
      id: r.id,
      tool: r.tool,
      module: r.module,
      message: r.message,
      summary: r.summary,
      rowIds,
      status: r.status === 'dibatalkan' ? 'dibatalkan' : 'dijalankan',
      createdAt: r.created_at,
      undoneAt: r.undone_at,
      undoable: r.status === 'dijalankan' && rowIds.length > 0 && TOOL_BY_NAME.has(r.tool),
    };
  });
}

export type UndoOutcome =
  | { ok: true; removed: number }
  | { ok: false; reason: 'tidak_ditemukan' | 'sudah_dibatalkan' | 'tidak_bisa_dibatalkan' };

/**
 * Batalkan satu aksi.
 *
 * Menghapus hanya baris yang tercatat dibuat aksi itu, di tabel yang
 * dideklarasikan alatnya, dan selalu dengan `user_id` — jadi id yang
 * ditebak-tebak tidak bisa menghapus milik orang lain.
 *
 * Baris yang sudah lebih dulu dihapus pengguna secara manual bukan kegagalan:
 * hasil akhirnya sama-sama "sudah tidak ada", dan aksinya tetap ditandai
 * dibatalkan supaya tidak menggantung di riwayat selamanya.
 */
export async function undoAction(
  db: D1Database,
  userId: string,
  actionId: string,
  today: string
): Promise<UndoOutcome> {
  const row = await db.prepare(
    `SELECT tool, row_ids_json, undo_meta_json, status
       FROM agent_actions WHERE id = ?1 AND user_id = ?2`
  ).bind(actionId, userId).first<{
    tool: string; row_ids_json: string; undo_meta_json: string; status: string;
  }>();

  if (!row) return { ok: false, reason: 'tidak_ditemukan' };
  if (row.status === 'dibatalkan') return { ok: false, reason: 'sudah_dibatalkan' };

  const tool: AgentTool | undefined = TOOL_BY_NAME.get(row.tool);
  if (!tool) return { ok: false, reason: 'tidak_bisa_dibatalkan' };

  const ids = parseList(row.row_ids_json);
  if (ids.length === 0) return { ok: false, reason: 'tidak_bisa_dibatalkan' };

  const ctx: ToolContext = { db, userId, today };

  // Pembatalan khusus dulu, selagi baris utamanya masih ada untuk ditelusuri.
  if (tool.undo) await tool.undo(ctx, ids, parseObject(row.undo_meta_json));

  const placeholders = ids.map((_, i) => `?${i + 2}`).join(',');
  const deleted = await db.prepare(
    `DELETE FROM ${tool.table} WHERE user_id = ?1 AND id IN (${placeholders})`
  ).bind(userId, ...ids).run();

  await db.prepare(
    "UPDATE agent_actions SET status = 'dibatalkan', undone_at = unixepoch() WHERE id = ?1 AND user_id = ?2"
  ).bind(actionId, userId).run();

  return { ok: true, removed: deleted.meta.changes ?? 0 };
}
