/**
 * Push harian: Radar Tagihan, Besok Anak, Jangan Bolos Dua Kali, dan Pagi Ini.
 *
 * Semuanya berbagi bentuk yang sama: dijalankan pada satu jam Jakarta,
 * mengumpulkan per pengguna yang punya langganan push, klaim dedup lewat
 * daily_alert_sent, lalu kirim satu push agregat. Klaim dilepas kembali kalau
 * ternyata pengguna tidak punya subscription aktif, supaya besok masih dicoba.
 */

import type { Env } from '../types';
import { sendPushToUser } from '../lib/push';
import { claimDailyAlert, releaseDailyAlert, type AlertKind } from './daily_alert';
import { computeSafeToSpend } from './safe_to_spend';
import { getBillRadar, getKidsFor, getMissedYesterday, getExpiringItems, shiftDate } from './daily';
import { jakartaToday } from './validate';
import { loadSettingsFor, bool, num, type ResolvedSettings } from './settings';

/** Jam Jakarta saat ini (0..23). */
export function jakartaHour(): number {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
}

/** Rupiah ringkas: 1.500.000 jadi "Rp1,5 jt", 45.000 jadi "Rp45 rb". */
export function formatRupiah(amount: number): string {
  if (amount >= 1_000_000) {
    const juta = amount / 1_000_000;
    return `Rp${(Math.round(juta * 10) / 10).toString().replace('.', ',')} jt`;
  }
  if (amount >= 1_000) return `Rp${Math.round(amount / 1_000)} rb`;
  return `Rp${amount}`;
}

/** Pengguna yang bisa menerima push sama sekali. */
async function pushableUsers(env: Env): Promise<string[]> {
  const rows = await env.DB.prepare(
    'SELECT DISTINCT user_id FROM push_subscriptions'
  ).all<{ user_id: string }>();
  return (rows.results ?? []).map((r) => r.user_id);
}

/**
 * Pengguna yang mengaktifkan alert ini, pada jam yang mereka pilih.
 *
 * Jam diperiksa per pengguna, bukan sekali di awal fungsi: dua orang bisa
 * memilih jam berbeda untuk alert yang sama, dan cron menyala tiap menit
 * sehingga tiap jam pasti terlewati.
 */
async function recipientsFor(
  env: Env,
  enabledKey: string,
  hourKey: string | null
): Promise<Array<{ userId: string; settings: ResolvedSettings }>> {
  const ids = await pushableUsers(env);
  if (ids.length === 0) return [];

  const settingsById = await loadSettingsFor(env.DB, ids);
  const now = jakartaHour();

  return ids
    .map((userId) => ({ userId, settings: settingsById.get(userId)! }))
    .filter(({ settings }) => {
      if (!bool(settings, enabledKey)) return false;
      return hourKey === null || num(settings, hourKey) === now;
    });
}

/**
 * Kirim satu push beserta catatan di Notification Center, dengan dedup harian.
 * Mengembalikan false kalau dilewati (sudah dikirim, atau tidak ada langganan).
 */
async function sendDaily(
  env: Env,
  userId: string,
  kind: AlertKind,
  date: string,
  payload: { title: string; body: string; url: string; data?: Record<string, unknown> }
): Promise<boolean> {
  if (!(await claimDailyAlert(env.DB, userId, kind, date))) return false;

  try {
    await env.DB.prepare(
      `INSERT INTO notification_events (id, user_id, type, title, body, payload)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    )
      .bind(
        crypto.randomUUID(),
        userId,
        kind,
        payload.title,
        payload.body,
        JSON.stringify({ ...(payload.data ?? {}), url: payload.url })
      )
      .run();
  } catch (err) {
    console.error(`[daily_push] gagal mencatat event ${kind}`, err);
  }

  const result = await sendPushToUser(env, userId, {
    title: payload.title,
    body: payload.body,
    url: payload.url,
  });

  if (result.subscriptions === 0) {
    // Tidak ada perangkat yang menerima — jangan biarkan hari ini terhitung
    // sudah dikirim, kalau tidak pengguna kehilangan alert ini selamanya.
    await releaseDailyAlert(env.DB, userId, kind, date);
    return false;
  }

  return true;
}

/** Radar Tagihan — pagi, H-3 sebelum jatuh tempo. */
export async function triggerBillRadar(env: Env): Promise<void> {
  const today = jakartaToday();

  for (const { userId, settings } of await recipientsFor(env, 'notify.bill_radar', 'notify.bill_radar.hour')) {
    const radar = await getBillRadar(env.DB, userId, today, num(settings, 'money.bill_horizon_days'));
    if (radar.bills.length === 0) continue;

    const overdue = radar.bills.filter((b) => b.daysUntil < 0);
    const lines = radar.bills.map((bill) => {
      const when =
        bill.daysUntil < 0
          ? `telat ${Math.abs(bill.daysUntil)} hari`
          : bill.daysUntil === 0
            ? 'hari ini'
            : `${bill.daysUntil} hari lagi`;
      return `• ${bill.personName} ${formatRupiah(bill.amount)} — ${when}`;
    });

    if (radar.coveringAccount) {
      lines.push(`Saldo cukup di ${radar.coveringAccount.name}.`);
    } else if (radar.totalBalance < radar.total) {
      lines.push(`Total saldo ${formatRupiah(radar.totalBalance)}, kurang ${formatRupiah(radar.total - radar.totalBalance)}.`);
    } else {
      lines.push('Tidak ada satu rekening yang cukup — perlu gabungan.');
    }

    await sendDaily(env, userId, 'bill_radar', today, {
      title: overdue.length > 0 ? '⚠️ Ada tagihan telat' : '💳 Tagihan segera jatuh tempo',
      body: lines.join('\n'),
      url: '/lainnya',
      data: { total: radar.total, count: radar.bills.length },
    });
  }
}

/** Besok Anak — malam, sebelum tidur, saat masih sempat menyiapkan. */
export async function triggerKidsPrep(env: Env): Promise<void> {
  const today = jakartaToday();
  const tomorrow = shiftDate(today, 1);

  for (const { userId } of await recipientsFor(env, 'notify.kids_prep', 'notify.kids_prep.hour')) {
    const items = await getKidsFor(env.DB, userId, tomorrow);
    if (items.length === 0) continue;

    const byKid = new Map<string, typeof items>();
    for (const item of items) {
      if (!byKid.has(item.kidName)) byKid.set(item.kidName, []);
      byKid.get(item.kidName)!.push(item);
    }

    const lines = [...byKid.entries()].map(([kid, list]) => {
      const detail = list
        .map((i) => (i.time ? `${i.time} ${i.title}` : i.title) + (i.note ? ` (${i.note})` : ''))
        .join(', ');
      return `• ${kid}: ${detail}`;
    });

    const earliest = items.find((i) => i.time)?.time;
    if (earliest) lines.push(`Paling pagi jam ${earliest}.`);

    await sendDaily(env, userId, 'kids_prep', today, {
      title: '🎒 Persiapan anak besok',
      body: lines.join('\n'),
      url: '/lainnya',
      data: { date: tomorrow, count: items.length },
    });
  }
}

/**
 * Jangan Bolos Dua Kali — pagi, saat harinya masih panjang.
 *
 * Sengaja pagi, bukan malam: nudge ini gunanya memberi kesempatan menyelamatkan
 * hari, bukan mengabarkan kegagalan saat sudah tidak sempat berbuat apa-apa.
 */
export async function triggerMissTwice(env: Env): Promise<void> {
  const today = jakartaToday();

  for (const { userId } of await recipientsFor(env, 'notify.miss_twice', 'notify.miss_twice.hour')) {
    const missed = await getMissedYesterday(env.DB, userId, today);
    if (missed.length === 0) continue;

    const top = missed[0];
    const fallback = top.twoMin
      ? `Versi 2 menitnya: ${top.twoMin}.`
      : 'Kerjakan versi terkecilnya saja hari ini.';

    const body =
      missed.length === 1
        ? `${top.name} terlewat kemarin. Jangan bolos dua kali — ${fallback}`
        : `${missed.length} kebiasaan terlewat kemarin (${missed.map((m) => m.name).join(', ')}). Mulai dari ${top.name}. ${fallback}`;

    await sendDaily(env, userId, 'miss_twice', today, {
      title: '🔁 Jangan bolos dua kali',
      body,
      url: '/kebiasaan',
      data: { habits: missed.map((m) => ({ id: m.id, name: m.name })) },
    });
  }
}

/** Pagi Ini — satu ringkasan lintas modul, menggantikan buka enam layar. */
export async function triggerMorningBrief(env: Env): Promise<void> {
  const today = jakartaToday();

  for (const { userId, settings } of await recipientsFor(env, 'notify.morning_brief', 'notify.morning_brief.hour')) {
    const [habitRow, events, safe, expiring, kids] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN EXISTS (
                  SELECT 1 FROM habit_completions c
                  WHERE c.habit_id = h.id AND c.user_id = ?1 AND c.completed_date = ?2
                ) THEN 1 ELSE 0 END) AS done
         FROM habits h WHERE h.user_id = ?1`
      )
        .bind(userId, today)
        .first<{ total: number; done: number | null }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM calendar_events
         WHERE user_id = ?1 AND event_date = ?2 AND is_done = 0`
      )
        .bind(userId, today)
        .first<{ n: number }>(),
      computeSafeToSpend(env.DB, userId, today),
      getExpiringItems(env.DB, userId, today, num(settings, 'inventory.expiry_days')),
      getKidsFor(env.DB, userId, today),
    ]);

    const totalHabits = habitRow?.total ?? 0;
    const pending = totalHabits - (habitRow?.done ?? 0);
    const eventCount = events?.n ?? 0;

    // Pengguna yang belum punya apa-apa di sistem tidak perlu dibangunkan oleh
    // ringkasan kosong.
    if (totalHabits === 0 && eventCount === 0 && expiring.length === 0 && kids.length === 0) continue;

    const lines: string[] = [];
    if (totalHabits > 0) lines.push(`✅ ${pending} dari ${totalHabits} kebiasaan menunggu`);
    if (eventCount > 0) lines.push(`📅 ${eventCount} agenda hari ini`);
    if (safe.overBudget) {
      lines.push(`💸 Budget bulan ini sudah lewat ${formatRupiah(Math.abs(safe.remaining))}`);
    } else if (safe.monthlyLimit > 0) {
      lines.push(`💰 Aman dipakai hari ini ${formatRupiah(safe.perDay)}`);
    }
    if (expiring.length > 0) lines.push(`🥬 ${expiring.length} stok perlu segera dipakai`);
    if (kids.length > 0) lines.push(`🎒 ${kids.length} jadwal anak`);

    await sendDaily(env, userId, 'morning_brief', today, {
      title: '☀️ Pagi Ini',
      body: lines.join('\n'),
      url: '/',
      data: { pending, eventCount },
    });
  }
}
