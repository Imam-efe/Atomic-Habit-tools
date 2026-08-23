import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';
import { isVoiceSupported, startVoiceInput, type VoiceSession } from '@/lib/voice';

interface Note {
  id: string;
  body: string;
  summary: string | null;
  linkedHabitId: string | null;
  linkedHabitName: string | null;
  linkedGoalId: string | null;
  linkedGoalStatement: string | null;
  createdAt: number;
  updatedAt: number;
}

interface LinkOption {
  id: string;
  name: string;
}

/** First line as the visual title, matching every notes app's convention — no separate stored field. */
function splitBody(body: string): { title: string; rest: string } {
  const idx = body.indexOf('\n');
  if (idx === -1) return { title: body, rest: '' };
  return { title: body.slice(0, idx), rest: body.slice(idx + 1).trim() };
}

function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Notes() {
  const { goBack } = useUIStore();
  const [notes, setNotes] = useState<Note[]>([]);
  const [habits, setHabits] = useState<LinkOption[]>([]);
  const [goals, setGoals] = useState<LinkOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [body, setBody] = useState('');
  const [linkHabitId, setLinkHabitId] = useState('');
  const [linkGoalId, setLinkGoalId] = useState('');
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);

  const [summarizing, setSummarizing] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceRef = useRef<VoiceSession | null>(null);
  const voiceAvailable = useRef(isVoiceSupported());

  const load = async () => {
    setLoading(true);
    try {
      const [notesData, habitsData, goalsData] = await Promise.all([
        apiFetch<Note[]>('/notes'),
        apiFetch<{ id: string; name: string }[]>('/habits'),
        apiFetch<{ id: string; identityStatement: string }[]>('/goals'),
      ]);
      setNotes(notesData);
      setHabits(habitsData.map(h => ({ id: h.id, name: h.name })));
      setGoals(goalsData.map(g => ({ id: g.id, name: g.identityStatement })));
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const beginListening = () => {
    if (listening) {
      voiceRef.current?.stop();
      return;
    }
    const session = startVoiceInput({
      onPartial: setBody,
      onResult: setBody,
      onEnd: () => {
        setListening(false);
        voiceRef.current = null;
      },
    });
    if (session) {
      voiceRef.current = session;
      setListening(true);
    }
  };

  const addNote = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const created = await apiFetch<Note>('/notes', {
        method: 'POST',
        body: JSON.stringify({
          body: body.trim(),
          linkedHabitId: linkHabitId || undefined,
          linkedGoalId: linkGoalId || undefined,
        }),
      });
      setNotes(prev => [created, ...prev]);
      setBody('');
      setLinkHabitId('');
      setLinkGoalId('');
      setShowAdd(false);
    } catch {}
    setSaving(false);
  };

  const deleteNote = async (id: string) => {
    const prev = notes;
    setNotes(n => n.filter(x => x.id !== id));
    try {
      await apiFetch(`/notes/${id}`, { method: 'DELETE' });
    } catch {
      setNotes(prev);
    }
  };

  const summarize = async (id: string) => {
    if (summarizing) return;
    setSummarizing(id);
    try {
      const res = await apiFetch<{ summary: string }>(`/notes/${id}/summarize`, { method: 'POST' });
      setNotes(n => n.map(x => x.id === id ? { ...x, summary: res.summary } : x));
    } catch {}
    setSummarizing(null);
  };

  return (
    <div className="min-h-screen px-5 pt-14 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      <div className="flex items-center gap-3 mb-6">
        <motion.button
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={goBack}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </motion.button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text)', letterSpacing: '-0.5px' }}>
            Catatan
          </h1>
          {notes.length > 0 && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text2)' }}>{notes.length} catatan</p>
          )}
        </div>
        <motion.button
          className="neu-cta w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--accentFill)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={() => setShowAdd(s => !s)}
          aria-label="Tambah catatan baru"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </motion.button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            <div className="flex items-start gap-2">
              <textarea
                ref={textareaRef}
                rows={4}
                placeholder="Tulis apa saja…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
                style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                autoFocus
              />
              {voiceAvailable.current && (
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={beginListening}
                  aria-label={listening ? 'Berhenti merekam' : 'Dikte suara'}
                  aria-pressed={listening}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-[16px] flex-shrink-0"
                  style={{
                    background: listening ? 'var(--accentFill)' : 'var(--bg)',
                    color: listening ? '#fff' : 'var(--text2)',
                    boxShadow: listening ? 'none' : 'var(--neu-raised-sm)',
                  }}
                >
                  {listening ? '⏹' : '🎤'}
                </motion.button>
              )}
            </div>

            {(habits.length > 0 || goals.length > 0) && (
              <div className="flex gap-2">
                {habits.length > 0 && (
                  <select
                    value={linkHabitId}
                    onChange={(e) => setLinkHabitId(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-xl text-xs outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  >
                    <option value="">Hubungkan ke kebiasaan…</option>
                    {habits.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                )}
                {goals.length > 0 && (
                  <select
                    value={linkGoalId}
                    onChange={(e) => setLinkGoalId(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-xl text-xs outline-none"
                    style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
                  >
                    <option value="">Hubungkan ke goal…</option>
                    {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <motion.button
                onClick={addNote}
                disabled={saving || !body.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold neu-cta disabled:opacity-50"
                style={{ background: 'var(--accentFill)', color: '#fff' }}
                whileTap={{ scale: 0.97 }}
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </motion.button>
              <button
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                onClick={() => { setShowAdd(false); setBody(''); setLinkHabitId(''); setLinkGoalId(''); }}
              >
                Batal
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : notes.length === 0 && !showAdd ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-4xl">📝</p>
          <p className="text-base font-semibold" style={{ color: 'var(--text2)' }}>Belum ada catatan</p>
          <p className="text-sm text-center" style={{ color: 'var(--text3)' }}>Tap + untuk menulis atau mendikte catatan pertama</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence>
            {notes.map((n) => {
              const { title, rest } = splitBody(n.body);
              return (
                <motion.div
                  key={n.id}
                  layout="position"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="rounded-[18px] p-4"
                  style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
                >
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <p className="text-sm font-bold flex-1 min-w-0 truncate" style={{ color: 'var(--text)' }}>{title}</p>
                    <button
                      onClick={() => deleteNote(n.id)}
                      aria-label="Hapus catatan"
                      className="w-6 h-6 flex items-center justify-center opacity-40 hover:opacity-100 flex-shrink-0"
                    >
                      🗑️
                    </button>
                  </div>
                  {rest && (
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap mb-2" style={{ color: 'var(--text2)' }}>
                      {rest}
                    </p>
                  )}

                  {(n.linkedHabitName || n.linkedGoalStatement) && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {n.linkedHabitName && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}>
                          🔁 {n.linkedHabitName}
                        </span>
                      )}
                      {n.linkedGoalStatement && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}>
                          🎯 {n.linkedGoalStatement}
                        </span>
                      )}
                    </div>
                  )}

                  {n.summary && (
                    <p className="text-[11px] italic mb-2" style={{ color: 'var(--info)' }}>
                      ✨ {n.summary}
                    </p>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-[10px]" style={{ color: 'var(--text3)' }}>{formatDate(n.createdAt)}</span>
                    {!n.summary && (
                      <button
                        onClick={() => summarize(n.id)}
                        disabled={summarizing === n.id}
                        className="text-[10px] font-bold disabled:opacity-50"
                        style={{ color: 'var(--accent)' }}
                      >
                        {summarizing === n.id ? 'Meringkas…' : '✨ Ringkas'}
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
