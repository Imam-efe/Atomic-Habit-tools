import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';

const achievements = new Hono<AuthContext>();
achievements.use('/*', requireAuth);

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earned: boolean;
  progress: number;
  currentValue: number;
  targetValue: number;
}

function badge(id: string, name: string, description: string, icon: string, current: number, target: number): Badge {
  return {
    id,
    name,
    description,
    icon,
    earned: current >= target,
    progress: Math.min(100, Math.round((current / target) * 100)),
    currentValue: Math.min(current, target),
    targetValue: target,
  };
}

// GET /api/achievements — badges derived from existing data, no separate
// "achievements" table: each one is a pure function of state that already
// exists (streaks, completion counts, paid debts, logged transactions), so
// there is nothing here to fall out of sync with the real numbers.
achievements.get('/', async (c) => {
  const user = c.get('user');

  const [maxStreakRow, completionsRow, debtsPaidRow, budgetCountRow] = await Promise.all([
    c.env.DB.prepare('SELECT COALESCE(MAX(streak), 0) as v FROM habits WHERE user_id = ?1')
      .bind(user.sub).first<{ v: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as v FROM habit_completions WHERE user_id = ?1')
      .bind(user.sub).first<{ v: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as v FROM debts WHERE user_id = ?1 AND status = 'paid'")
      .bind(user.sub).first<{ v: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as v FROM budget_entries WHERE user_id = ?1')
      .bind(user.sub).first<{ v: number }>(),
  ]);

  const maxStreak = maxStreakRow?.v ?? 0;
  const completions = completionsRow?.v ?? 0;
  const debtsPaid = debtsPaidRow?.v ?? 0;
  const budgetCount = budgetCountRow?.v ?? 0;

  const badges: Badge[] = [
    badge('streak-7', 'Seminggu Penuh', 'Streak 7 hari pada satu kebiasaan', '🔥', maxStreak, 7),
    badge('streak-30', 'Sebulan Konsisten', 'Streak 30 hari pada satu kebiasaan', '🏆', maxStreak, 30),
    badge('streak-100', 'Seratus Hari', 'Streak 100 hari pada satu kebiasaan', '💎', maxStreak, 100),
    badge('completions-10', 'Pemula', '10 kali menyelesaikan kebiasaan', '✅', completions, 10),
    badge('completions-50', 'Berkembang', '50 kali menyelesaikan kebiasaan', '⭐', completions, 50),
    badge('completions-200', 'Master Kebiasaan', '200 kali menyelesaikan kebiasaan', '👑', completions, 200),
    badge('debt-1', 'Bebas Sedikit', 'Melunasi 1 utang', '💸', debtsPaid, 1),
    badge('debt-5', 'Bebas Finansial', 'Melunasi 5 utang', '🎉', debtsPaid, 5),
    badge('budget-10', 'Mulai Mencatat', '10 transaksi tercatat', '📝', budgetCount, 10),
    badge('budget-100', 'Disiplin Finansial', '100 transaksi tercatat', '💰', budgetCount, 100),
  ];

  return c.json({
    badges,
    earnedCount: badges.filter(b => b.earned).length,
    totalCount: badges.length,
  });
});

export default achievements;
