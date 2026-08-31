import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch, ApiError } from '@/lib/api';

interface Brief {
  date: string;
  habits: {
    items: Array<{ id: string; name: string; time: string | null; streak: number; done: boolean }>;
    pending: number;
    total: number;
  };
  events: Array<{ id: string; title: string; event_time: string | null; note: string | null }>;
  safeToSpend: {
    monthlyLimit: number;
    spent: number;
    upcomingBills: number;
    remaining: number;
    daysLeft: number;
    perDay: number;
    overBudget: boolean;
    spentToday: number;
  };
  bills: {
    bills: Array<{ id: string; personName: string; amount: number; dueDate: string; daysUntil: number }>;
    total: number;
    coveringAccount: { id: string; name: string; balance: number } | null;
    totalBalance: number;
  };
  missed: Array<{ id: string; name: string; streak: number; twoMin: string | null }>;
  expiring: Array<{ id: string; name: string; quantity: number; unit: string; daysLeft: number }>;
  kids: Array<{ kidName: string; title: string; type: string; time: string | null; note: string | null }>;
  kebun: {
    perluSiram: number;
    perluPupuk: number;
    siapPanen: number;
    terlantar: number;
    contoh: string[];
  };
}

interface Suggestion {
  habitId: string;
  habitName: string;
  currentTime: string;
  clashesWith: string;
  suggestedTime: string | null;
  fallbackTwoMin: string | null;
}

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

/** Kartu bersurface neumorphic, bentuk yang sama dipakai seluruh layar ini. */
function Card({
  title,
  accent,
  children,
  delay = 0,
}: {
  title: string;
  accent?: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      className="rounded-[18px] p-4 mb-3 flex flex-col gap-2.5"
      style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.gentle, delay }}
    >
      <div className="text-sm font-bold" style={{ color: accent ?? 'var(--text)' }}>
        {title}
      </div>
      {children}
    </motion.div>
  );
}

export default function HarianScreen() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [clashes, setClashes] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Bentrok jadwal diambil terpisah supaya kegagalannya tidak mengosongkan
        // seluruh ringkasan — bagian ini yang paling bisa dikorbankan.
        const [briefData, clashData] = await Promise.all([
          apiFetch<Brief>('/daily/brief'),
          apiFetch<{ suggestions: Suggestion[] }>('/daily/reschedule').catch(() => ({ suggestions: [] })),
        ]);
        if (cancelled) return;
        setBrief(briefData);
        setClashes(clashData.suggestions);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? (err.body.message ?? 'Gagal memuat.') : 'Terjadi kesalahan jaringan.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      <div className="mb-5">
        <h1
          className="text-3xl font-extrabold tracking-tight"
          style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}
        >
          Pagi Ini
        </h1>
        {brief && (
          <p className="text-xs font-semibold mt-1" style={{ color: 'var(--text2)' }}>
            {new Date(brief.date).toLocaleDateString('id-ID', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
        )}
      </div>

      {loading && (
        <motion.div
          className="text-sm text-center py-10"
          style={{ color: 'var(--text2)' }}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={springs.gentle}
        >
          Menyusun ringkasan…
        </motion.div>
      )}

      <AnimatePresence>
        {error && (
          <motion.div
            className="rounded-[18px] p-4 mb-3 border-l-[3px]"
            style={{ background: 'rgba(255, 159, 10, 0.1)', borderColor: '#ff9f0a' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              {error}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {brief && (
        <>
          {/* Jangan bolos dua kali — paling atas: paling mendesak dan paling
              cepat hilang kesempatannya. */}
          {brief.missed.length > 0 && (
            <Card title="🔁 Jangan bolos dua kali" accent="#ff9f0a">
              {brief.missed.map((habit) => (
                <div key={habit.id} className="flex flex-col gap-0.5">
                  <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                    {habit.name}
                    {habit.streak > 0 && (
                      <span className="text-xs font-normal" style={{ color: 'var(--text3)' }}>
                        {' '}· streak {habit.streak} hari
                      </span>
                    )}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text2)' }}>
                    {habit.twoMin
                      ? `Versi 2 menit: ${habit.twoMin}`
                      : 'Kerjakan versi terkecilnya saja hari ini.'}
                  </div>
                </div>
              ))}
            </Card>
          )}

          <Card title="✅ Kebiasaan hari ini" delay={0.04}>
            {brief.habits.total === 0 ? (
              <div className="text-xs" style={{ color: 'var(--text2)' }}>
                Belum ada kebiasaan yang dilacak.
              </div>
            ) : (
              <>
                <div className="text-xs" style={{ color: 'var(--text2)' }}>
                  {brief.habits.pending} dari {brief.habits.total} menunggu
                </div>
                {brief.habits.items
                  .filter((h) => !h.done)
                  .slice(0, 5)
                  .map((habit) => (
                    <div key={habit.id} className="flex justify-between text-sm">
                      <span style={{ color: 'var(--text)' }}>{habit.name}</span>
                      {habit.time && (
                        <span className="text-xs" style={{ color: 'var(--text3)' }}>
                          {habit.time}
                        </span>
                      )}
                    </div>
                  ))}
              </>
            )}
          </Card>

          {brief.events.length > 0 && (
            <Card title="📅 Agenda" delay={0.08}>
              {brief.events.map((event) => (
                <div key={event.id} className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text)' }}>{event.title}</span>
                  {event.event_time && (
                    <span className="text-xs" style={{ color: 'var(--text3)' }}>
                      {event.event_time}
                    </span>
                  )}
                </div>
              ))}
            </Card>
          )}

          {clashes.length > 0 && (
            <Card title="🕐 Jadwal bentrok" accent="#ff9f0a" delay={0.1}>
              {clashes.map((clash) => (
                <div key={clash.habitId} className="flex flex-col gap-0.5">
                  <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                    {clash.habitName} ({clash.currentTime}) bentrok dengan {clash.clashesWith}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text2)' }}>
                    {clash.suggestedTime
                      ? `Coba geser ke ${clash.suggestedTime}.`
                      : clash.fallbackTwoMin
                        ? `Hari ini penuh — cukup versi 2 menitnya: ${clash.fallbackTwoMin}.`
                        : 'Hari ini penuh — kerjakan versi terkecilnya saja.'}
                  </div>
                </div>
              ))}
            </Card>
          )}

          <Card
            title="💰 Sisa aman hari ini"
            accent={brief.safeToSpend.overBudget ? '#ff3b30' : undefined}
            delay={0.12}
          >
            {brief.safeToSpend.monthlyLimit === 0 ? (
              <div className="text-xs" style={{ color: 'var(--text2)' }}>
                Belum ada limit budget bulan ini. Atur limit dulu di Uang supaya angkanya bisa dihitung.
              </div>
            ) : brief.safeToSpend.overBudget ? (
              <>
                <div className="text-2xl font-extrabold" style={{ color: '#ff3b30' }}>
                  Lewat {rupiah(Math.abs(brief.safeToSpend.remaining))}
                </div>
                <div className="text-xs" style={{ color: 'var(--text2)' }}>
                  Limit {rupiah(brief.safeToSpend.monthlyLimit)} · terpakai{' '}
                  {rupiah(brief.safeToSpend.spent)} · tagihan {rupiah(brief.safeToSpend.upcomingBills)}
                </div>
              </>
            ) : (
              <>
                <div className="text-2xl font-extrabold" style={{ color: 'var(--text)' }}>
                  {rupiah(brief.safeToSpend.perDay)}
                </div>
                <div className="text-xs" style={{ color: 'var(--text2)' }}>
                  Sisa {rupiah(brief.safeToSpend.remaining)} untuk {brief.safeToSpend.daysLeft} hari
                  {brief.safeToSpend.upcomingBills > 0 &&
                    ` · sudah dipotong tagihan ${rupiah(brief.safeToSpend.upcomingBills)}`}
                </div>
                {brief.safeToSpend.spentToday > 0 && (
                  <div
                    className="text-xs font-semibold"
                    style={{
                      color:
                        brief.safeToSpend.spentToday > brief.safeToSpend.perDay ? '#ff9f0a' : '#34c759',
                    }}
                  >
                    Hari ini sudah {rupiah(brief.safeToSpend.spentToday)}
                  </div>
                )}
              </>
            )}
          </Card>

          {brief.bills.bills.length > 0 && (
            <Card title="💳 Tagihan" accent="#ff9f0a" delay={0.16}>
              {brief.bills.bills.map((bill) => (
                <div key={bill.id} className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text)' }}>{bill.personName}</span>
                  <span className="text-xs" style={{ color: bill.daysUntil < 0 ? '#ff3b30' : 'var(--text2)' }}>
                    {rupiah(bill.amount)} ·{' '}
                    {bill.daysUntil < 0
                      ? `telat ${Math.abs(bill.daysUntil)} hari`
                      : bill.daysUntil === 0
                        ? 'hari ini'
                        : `${bill.daysUntil} hari lagi`}
                  </span>
                </div>
              ))}
              <div className="text-xs" style={{ color: 'var(--text2)' }}>
                {brief.bills.coveringAccount
                  ? `Saldo cukup di ${brief.bills.coveringAccount.name}.`
                  : brief.bills.totalBalance < brief.bills.total
                    ? `Total saldo ${rupiah(brief.bills.totalBalance)}, kurang ${rupiah(brief.bills.total - brief.bills.totalBalance)}.`
                    : 'Tidak ada satu rekening yang cukup — perlu gabungan.'}
              </div>
            </Card>
          )}

          {brief.kids.length > 0 && (
            <Card title="🎒 Jadwal anak hari ini" delay={0.2}>
              {brief.kids.map((kid, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text)' }}>
                    {kid.kidName} · {kid.title}
                    {kid.note && (
                      <span className="text-xs" style={{ color: 'var(--text3)' }}>
                        {' '}({kid.note})
                      </span>
                    )}
                  </span>
                  {kid.time && (
                    <span className="text-xs" style={{ color: 'var(--text3)' }}>
                      {kid.time}
                    </span>
                  )}
                </div>
              ))}
            </Card>
          )}

          {brief.expiring.length > 0 && (
            <Card title="🥬 Segera dipakai" accent="#ff9f0a" delay={0.24}>
              {brief.expiring.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span style={{ color: 'var(--text)' }}>
                    {item.name} ({item.quantity} {item.unit})
                  </span>
                  <span className="text-xs" style={{ color: item.daysLeft < 0 ? '#ff3b30' : 'var(--text2)' }}>
                    {item.daysLeft < 0
                      ? `lewat ${Math.abs(item.daysLeft)} hari`
                      : item.daysLeft === 0
                        ? 'hari ini'
                        : `${item.daysLeft} hari lagi`}
                  </span>
                </div>
              ))}
              <div className="text-xs" style={{ color: 'var(--text3)' }}>
                Buka Inventaris untuk minta saran masakan dari bahan ini.
              </div>
            </Card>
          )}

          {/* Kebun punya tugas harian sama seperti kebiasaan dan tagihan, tapi
              sampai sekarang ia satu-satunya modul yang tidak pernah muncul di
              Pagi Ini — jadi ia hanya dikerjakan kalau tabnya kebetulan
              dibuka. */}
          {brief.kebun && (brief.kebun.perluSiram + brief.kebun.perluPupuk + brief.kebun.siapPanen + brief.kebun.terlantar) > 0 && (
            <Card title="🌱 Kebun hari ini" delay={0.28}>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {brief.kebun.perluSiram > 0 && (
                  <span style={{ color: 'var(--text)' }}>💧 {brief.kebun.perluSiram} perlu disiram</span>
                )}
                {brief.kebun.perluPupuk > 0 && (
                  <span style={{ color: 'var(--text)' }}>🌿 {brief.kebun.perluPupuk} perlu dipupuk</span>
                )}
                {brief.kebun.siapPanen > 0 && (
                  <span style={{ color: 'var(--text)' }}>🧺 {brief.kebun.siapPanen} siap panen</span>
                )}
                {brief.kebun.terlantar > 0 && (
                  <span style={{ color: '#ff3b30' }}>🕸️ {brief.kebun.terlantar} lama tak tersentuh</span>
                )}
              </div>
              {brief.kebun.contoh.length > 0 && (
                <div className="text-xs" style={{ color: 'var(--text3)' }}>
                  {brief.kebun.contoh.join(', ')}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
