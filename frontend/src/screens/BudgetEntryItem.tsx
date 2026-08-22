import React, { memo } from 'react';
import { motion } from 'framer-motion';

interface BudgetEntry {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  note: string | null;
  date: string;
  bank_account_id: string | null;
  receipt_img: string | null;
  recurrence?: string | null;
}

interface BudgetBank {
  id: string;
  name: string;
  account_type: string;
  balance: number;
}

function formatRp(n: number) {
  return n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}

interface Props {
  entry: BudgetEntry;
  bankAccounts: BudgetBank[];
  onOpen: (entry: BudgetEntry) => void;
  animated?: boolean;
}

export const BudgetEntryItem = memo(function BudgetEntryItem({
  entry,
  bankAccounts,
  onOpen,
  animated = true,
}: Props) {
  const matchedBank = bankAccounts.find(b => b.id === entry.bank_account_id);

  const content = (
    <div
      className="rounded-[14px] px-4 py-3.5 flex items-center gap-3 relative overflow-hidden cursor-pointer"
      style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
      onClick={() => onOpen(entry)}
    >
      <div
        className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-base"
        style={{
          background:
            entry.type === 'income' ? 'rgba(52,199,89,0.15)' : 'rgba(255,69,58,0.12)',
        }}
      >
        {entry.type === 'income' ? '📈' : '📉'}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
            {entry.category}
          </p>
          <span className="text-[9px]" style={{ color: 'var(--text3)' }}>
            {entry.date}
          </span>
        </div>
        {entry.note && (
          <p className="text-xs truncate" style={{ color: 'var(--text3)' }}>
            {entry.note}
          </p>
        )}

        {matchedBank && (
          <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/5 mt-1 text-[var(--text2)]">
            🏦 {matchedBank.name}
          </span>
        )}
      </div>

      {entry.receipt_img && (
        <div className="w-8 h-8 rounded-lg overflow-hidden border border-zinc-700 flex-shrink-0">
          <img
            src={entry.receipt_img}
            className="w-full h-full object-cover"
            onClick={() => alert('Foto Struk terlampir')}
          />
        </div>
      )}

      <p
        className="text-sm font-bold flex-shrink-0"
        style={{
          color: entry.type === 'income' ? 'var(--pos)' : 'var(--neg)',
        }}
      >
        {entry.type === 'income' ? '+' : '-'}
        {formatRp(entry.amount)}
      </p>
    </div>
  );

  return animated ? (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
    >
      {content}
    </motion.div>
  ) : (
    content
  );
});
