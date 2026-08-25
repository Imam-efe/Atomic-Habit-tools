import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';

const netWorth = new Hono<AuthContext>();

netWorth.use('/*', requireAuth);

// GET /api/net-worth
// Returns current net worth + last 6 months of snapshots
netWorth.get('/', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();
  const currentMonth = today.slice(0, 7); // YYYY-MM

  // Compute current assets and liabilities
  //
  // `debts` menyimpan dua hal yang berlawanan: utang (kita berutang) dan
  // piutang (orang berutang ke kita). Menjumlahkan keduanya sebagai kewajiban
  // membuat meminjamkan uang menurunkan kekayaan bersih — dan membuat layar
  // ini berselisih dengan Laporan Keuangan, yang menghitungnya dengan benar.
  const [assetsRes, debtRows] = await Promise.all([
    c.env.DB.prepare(
      'SELECT COALESCE(SUM(balance), 0) as total FROM bank_accounts WHERE user_id = ?1'
    ).bind(user.sub).first<{ total: number }>(),
    c.env.DB.prepare(
      `SELECT type, COALESCE(SUM(amount_idr), 0) as total FROM debts
       WHERE user_id = ?1 AND status != 'paid'
       GROUP BY type`
    ).bind(user.sub).all<{ type: string; total: number }>(),
  ]);

  const perJenis = debtRows.results ?? [];
  const liabilities = perJenis.find((d) => d.type === 'debt')?.total ?? 0;
  const receivables = perJenis.find((d) => d.type === 'receivable')?.total ?? 0;

  const assets = (assetsRes?.total ?? 0) + receivables;
  const currentNetWorth = assets - liabilities;

  // Upsert snapshot for current month
  await c.env.DB.prepare(`
    INSERT INTO net_worth_snapshots (id, user_id, month, assets, liabilities, net_worth)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(user_id, month)
    DO UPDATE SET assets = excluded.assets, liabilities = excluded.liabilities, net_worth = excluded.net_worth
  `).bind(nanoid(), user.sub, currentMonth, assets, liabilities, currentNetWorth).run();

  // Fetch last 6 months of snapshots
  const historyRes = await c.env.DB.prepare(`
    SELECT month, assets, liabilities, net_worth
    FROM net_worth_snapshots
    WHERE user_id = ?1
    ORDER BY month DESC
    LIMIT 6
  `).bind(user.sub).all<{ month: string; assets: number; liabilities: number; net_worth: number }>();

  const history = (historyRes.results ?? []).reverse(); // oldest → newest for chart

  return c.json({
    current: {
      assets,
      // Dipisah supaya layar bisa menunjukkan bagian mana dari harta yang
      // masih ada di tangan orang lain.
      receivables,
      liabilities,
      net_worth: currentNetWorth,
      month: currentMonth,
    },
    history,
  });
});

export default netWorth;
