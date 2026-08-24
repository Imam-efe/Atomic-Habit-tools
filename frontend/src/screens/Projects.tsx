import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '@/stores/uiStore';
import { springs, collapse } from '@/tokens/motion';
import { apiFetch } from '@/lib/api';
import { todayISO } from '@/lib/date';

interface Task {
  id: string;
  name: string;
  status: string; // backlog | done
  goalId: string | null;
  goalName: string | null;
  goalColor: string | null;
  dueDate: string | null;
  priority: 'low' | 'normal' | 'high';
}

const PRIORITY_LABELS: Record<Task['priority'], string> = { low: 'Rendah', normal: 'Normal', high: 'Tinggi' };
const PRIORITY_COLORS: Record<Task['priority'], string> = { low: 'var(--text3)', normal: 'var(--info)', high: 'var(--neg)' };

interface Project {
  id: string;
  name: string;
  goalId: string | null;
  goalName: string | null;
  goalColor: string | null;
  tasks: Task[];
}

interface Goal {
  id: string;
  identityStatement: string;
  color: string;
}

export function Projects() {
  const { setSubScreen } = useUIStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals / forms state
  const [showAddProject, setShowAddProject] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectGoalId, setProjectGoalId] = useState('');
  const [savingProject, setSavingProject] = useState(false);

  const [addingTaskForProjId, setAddingTaskForProjId] = useState<string | null>(null);
  const [taskName, setTaskName] = useState('');
  const [taskGoalId, setTaskGoalId] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskPriority, setTaskPriority] = useState<Task['priority']>('normal');
  const [savingTask, setSavingTask] = useState(false);

  const [breakdownProjId, setBreakdownProjId] = useState<string | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState('');
  const [breakdownTasks, setBreakdownTasks] = useState<{ name: string; checked: boolean }[]>([]);
  const [breakdownSaving, setBreakdownSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [projData, goalsData] = await Promise.all([
        apiFetch<Project[]>('/projects'),
        apiFetch<Goal[]>('/goals'),
      ]);
      setProjects(projData);
      setGoals(goalsData);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreateProject = async () => {
    if (!projectName.trim()) return;
    setSavingProject(true);
    try {
      const newProj = await apiFetch<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: projectName.trim(),
          goalId: projectGoalId || undefined,
        }),
      });
      // reload or append
      setProjects(prev => [...prev, { ...newProj, tasks: [] }]);
      setProjectName('');
      setProjectGoalId('');
      setShowAddProject(false);
    } catch {}
    setSavingProject(false);
  };

  const handleDeleteProject = async (id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    await apiFetch(`/projects/${id}`, { method: 'DELETE' }).catch(() => load());
  };

  const handleCreateTask = async (projectId: string) => {
    if (!taskName.trim()) return;
    setSavingTask(true);
    try {
      const newTask = await apiFetch<Task>(`/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          name: taskName.trim(),
          goalId: taskGoalId || undefined,
          dueDate: taskDueDate || undefined,
          priority: taskPriority,
        }),
      });

      // Find the goal details if linked
      const matchedGoal = goals.find(g => g.id === taskGoalId);
      const enrichedTask = {
        ...newTask,
        goalName: matchedGoal ? matchedGoal.identityStatement : null,
        goalColor: matchedGoal ? matchedGoal.color : null,
      };

      setProjects(prev => prev.map(p => {
        if (p.id === projectId) {
          return { ...p, tasks: [...p.tasks, enrichedTask] };
        }
        return p;
      }));

      setTaskName('');
      setTaskGoalId('');
      setTaskDueDate('');
      setTaskPriority('normal');
      setAddingTaskForProjId(null);
    } catch {}
    setSavingTask(false);
  };

  const handleStartBreakdown = async (projectId: string) => {
    setBreakdownProjId(projectId);
    setBreakdownTasks([]);
    setBreakdownError('');
    setBreakdownLoading(true);
    try {
      const res = await apiFetch<{ tasks: string[] }>(`/projects/${projectId}/breakdown`, { method: 'POST' });
      setBreakdownTasks(res.tasks.map(name => ({ name, checked: true })));
    } catch {
      setBreakdownError('Gagal membuat breakdown. Coba lagi.');
    }
    setBreakdownLoading(false);
  };

  const handleConfirmBreakdown = async (projectId: string) => {
    const picked = breakdownTasks.filter(t => t.checked);
    if (picked.length === 0) { setBreakdownProjId(null); return; }
    setBreakdownSaving(true);
    try {
      for (const t of picked) {
        const newTask = await apiFetch<Task>(`/projects/${projectId}/tasks`, {
          method: 'POST',
          body: JSON.stringify({ name: t.name }),
        });
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, tasks: [...p.tasks, newTask] } : p));
      }
    } catch {}
    setBreakdownSaving(false);
    setBreakdownProjId(null);
    setBreakdownTasks([]);
  };

  const handleToggleTask = async (taskId: string) => {
    // Optimistic toggle
    setProjects(prev => prev.map(p => ({
      ...p,
      tasks: p.tasks.map(t => {
        if (t.id === taskId) {
          return { ...t, status: t.status === 'done' ? 'backlog' : 'done' };
        }
        return t;
      }),
    })));

    await apiFetch(`/projects/tasks/${taskId}/toggle`, { method: 'POST' }).catch(() => load());
  };

  const handleDeleteTask = async (taskId: string) => {
    setProjects(prev => prev.map(p => ({
      ...p,
      tasks: p.tasks.filter(t => t.id !== taskId),
    })));

    await apiFetch(`/projects/tasks/${taskId}`, { method: 'DELETE' }).catch(() => load());
  };

  return (
    <div className="min-h-screen px-5 pt-16 pb-tab-safe" style={{ background: 'var(--bg)' }}>
      {/* Header / Back button */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setSubScreen(null)}
          className="inline-flex items-center gap-1 text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Lainnya
        </button>

        <motion.button
          onClick={() => setShowAddProject(s => !s)}
          className="neu-cta w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: 'var(--accentFill)' }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </motion.button>
      </div>

      <h1 className="text-3xl font-extrabold tracking-tight mb-6" style={{ color: 'var(--text)', letterSpacing: '-0.6px' }}>
        Projects
      </h1>

      {/* Add Project Modal/Form */}
      <AnimatePresence>
        {showAddProject && (
          <motion.div
            className="rounded-[18px] p-4 mb-4 flex flex-col gap-3"
            style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={collapse}
          >
            <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>Tambah Project Baru</p>
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              placeholder="Nama project..."
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              autoFocus
            />
            <select
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--bg)', color: 'var(--text)', boxShadow: 'var(--neu-inset)' }}
              value={projectGoalId}
              onChange={e => setProjectGoalId(e.target.value)}
            >
              <option value="">Hubungkan ke Goal (Opsional)</option>
              {goals.map(g => (
                <option key={g.id} value={g.id}>
                  Saya adalah orang yang {g.identityStatement}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <motion.button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'var(--accentFill)', opacity: savingProject ? 0.6 : 1 }}
                onClick={handleCreateProject}
                disabled={savingProject}
                whileTap={{ scale: 0.97 }}
              >
                {savingProject ? 'Menyimpan...' : 'Simpan'}
              </motion.button>
              <motion.button
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                onClick={() => { setShowAddProject(false); setProjectName(''); }}
                whileTap={{ scale: 0.97 }}
              >
                Batal
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Projects List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-4xl">📁</p>
          <p className="text-base font-semibold" style={{ color: 'var(--text2)' }}>Belum ada project</p>
          <p className="text-sm" style={{ color: 'var(--text3)' }}>Tap + untuk buat project</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {projects.map((project) => (
            <motion.div
              key={project.id}
              className="rounded-[18px] p-4 flex flex-col gap-3"
              style={{ background: 'var(--surface)', boxShadow: 'var(--neu-raised)' }}
              layout="position"
            >
              {/* Project Title & Badge & Delete */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-bold" style={{ color: 'var(--text)' }}>
                    {project.name}
                  </h2>
                  {project.goalName && (
                    <span
                      className="inline-block text-[10px] font-bold uppercase tracking-wide px-2.5 py-0.5 mt-1.5 rounded-md"
                      style={{ background: (project.goalColor ?? '#7C5CFF') + '25', color: project.goalColor ?? '#7C5CFF' }}
                    >
                      {project.goalName}
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  {/* AI breakdown */}
                  <motion.button
                    className="w-7 h-7 rounded-full flex items-center justify-center text-sm"
                    style={{ background: 'var(--track)' }}
                    onClick={() => handleStartBreakdown(project.id)}
                    whileTap={{ scale: 0.85 }}
                    title="Breakdown AI"
                  >
                    ✨
                  </motion.button>
                  {/* Plus to add task */}
                  <motion.button
                    className="w-7 h-7 rounded-full flex items-center justify-center"
                    style={{ background: 'var(--track)' }}
                    onClick={() => {
                      setAddingTaskForProjId(project.id);
                      setTaskGoalId(project.goalId ?? '');
                      setTaskDueDate('');
                      setTaskPriority('normal');
                    }}
                    whileTap={{ scale: 0.85 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </motion.button>
                  {/* Delete project */}
                  <motion.button
                    className="w-7 h-7 rounded-full flex items-center justify-center"
                    onClick={() => handleDeleteProject(project.id)}
                    whileTap={{ scale: 0.85 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </motion.button>
                </div>
              </div>

              {/* AI Breakdown proposal panel */}
              <AnimatePresence>
                {breakdownProjId === project.id && (
                  <motion.div
                    className="p-3 rounded-xl flex flex-col gap-2.5"
                    style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>✨ Breakdown AI</p>
                    {breakdownLoading ? (
                      <p className="text-xs" style={{ color: 'var(--text3)' }}>Membuat daftar tugas...</p>
                    ) : breakdownError ? (
                      <p className="text-xs" style={{ color: 'var(--neg)' }}>{breakdownError}</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {breakdownTasks.map((t, i) => (
                          <label key={i} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                            <input
                              type="checkbox"
                              checked={t.checked}
                              onChange={e => setBreakdownTasks(prev => prev.map((x, xi) => xi === i ? { ...x, checked: e.target.checked } : x))}
                            />
                            {t.name}
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <motion.button
                        className="neu-cta flex-1 py-1.5 rounded-lg text-xs font-semibold text-white"
                        style={{ background: 'var(--accentFill)', opacity: breakdownSaving || breakdownLoading || breakdownTasks.length === 0 ? 0.6 : 1 }}
                        onClick={() => handleConfirmBreakdown(project.id)}
                        disabled={breakdownSaving || breakdownLoading || breakdownTasks.length === 0}
                        whileTap={{ scale: 0.97 }}
                      >
                        {breakdownSaving ? 'Menyimpan...' : 'Tambahkan Tugas Terpilih'}
                      </motion.button>
                      <button
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                        onClick={() => { setBreakdownProjId(null); setBreakdownTasks([]); }}
                      >
                        Batal
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Add Task Box inside this project */}
              <AnimatePresence>
                {addingTaskForProjId === project.id && (
                  <motion.div
                    className="p-3 rounded-xl flex flex-col gap-2.5"
                    style={{ background: 'var(--bg)', boxShadow: 'var(--neu-inset)' }}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <input
                      className="w-full bg-transparent text-sm outline-none px-1"
                      style={{ color: 'var(--text)' }}
                      placeholder="Nama tugas baru..."
                      value={taskName}
                      onChange={e => setTaskName(e.target.value)}
                      autoFocus
                    />
                    <select
                      className="w-full text-xs outline-none py-1 border-t"
                      style={{ background: 'transparent', color: 'var(--text2)', borderColor: 'var(--sep)' }}
                      value={taskGoalId}
                      onChange={e => setTaskGoalId(e.target.value)}
                    >
                      <option value="">Hubungkan ke Goal (Opsional)</option>
                      {goals.map(g => (
                        <option key={g.id} value={g.id}>
                          {g.identityStatement}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        className="flex-1 text-xs outline-none py-1 border-t"
                        style={{ background: 'transparent', color: 'var(--text2)', borderColor: 'var(--sep)' }}
                        value={taskDueDate}
                        onChange={e => setTaskDueDate(e.target.value)}
                      />
                      <select
                        className="text-xs outline-none py-1 border-t"
                        style={{ background: 'transparent', color: 'var(--text2)', borderColor: 'var(--sep)' }}
                        value={taskPriority}
                        onChange={e => setTaskPriority(e.target.value as Task['priority'])}
                      >
                        {(Object.keys(PRIORITY_LABELS) as Task['priority'][]).map(p => (
                          <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <motion.button
                        className="neu-cta flex-1 py-1.5 rounded-lg text-xs font-semibold text-white"
                        style={{ background: 'var(--accentFill)' }}
                        onClick={() => handleCreateTask(project.id)}
                        disabled={savingTask}
                        whileTap={{ scale: 0.97 }}
                      >
                        Tambah Tugas
                      </motion.button>
                      <button
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ background: 'var(--surface)', color: 'var(--text2)', boxShadow: 'var(--neu-raised-sm)' }}
                        onClick={() => { setAddingTaskForProjId(null); setTaskDueDate(''); setTaskPriority('normal'); }}
                      >
                        Batal
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Tasks List for project */}
              {project.tasks.length > 0 && (
                <div className="flex flex-col gap-2.5 mt-2 border-t pt-3" style={{ borderColor: 'var(--sep)' }}>
                  {project.tasks.map(task => {
                    const isDone = task.status === 'done';
                    const isOverdue = !isDone && !!task.dueDate && task.dueDate < todayISO();
                    return (
                      <motion.div
                        key={task.id}
                        className="flex items-center gap-3"
                        layout="position"
                      >
                        {/* Checkbox */}
                        <motion.button
                          className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border"
                          style={{
                            borderColor: isDone ? 'var(--accent)' : 'var(--text3)',
                            background: isDone ? 'var(--accentFill)' : 'transparent',
                          }}
                          onClick={() => handleToggleTask(task.id)}
                          whileTap={{ scale: 0.8 }}
                          transition={springs.snappy}
                        >
                          {isDone && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </motion.button>

                        {/* Task text and goal badge */}
                        <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                          <div className="min-w-0 flex flex-col">
                            <p
                              className="text-sm truncate"
                              style={{
                                color: isDone ? 'var(--text3)' : 'var(--text)',
                                textDecoration: isDone ? 'line-through' : 'none',
                              }}
                            >
                              {task.name}
                            </p>
                            {(task.dueDate || task.priority !== 'normal') && (
                              <div className="flex items-center gap-2 mt-0.5">
                                {task.dueDate && (
                                  <span
                                    className="text-[10px] font-semibold"
                                    style={{ color: isOverdue ? 'var(--neg)' : 'var(--text3)' }}
                                  >
                                    {isOverdue ? '⚠ ' : ''}{task.dueDate}
                                  </span>
                                )}
                                {task.priority !== 'normal' && (
                                  <span
                                    className="text-[10px] font-bold uppercase tracking-wide"
                                    style={{ color: PRIORITY_COLORS[task.priority] }}
                                  >
                                    {PRIORITY_LABELS[task.priority]}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {task.goalColor && (
                            <div
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ background: task.goalColor }}
                              title={task.goalName ?? ''}
                            />
                          )}
                        </div>

                        {/* Delete task */}
                        <motion.button
                          className="w-5 h-5 flex items-center justify-center opacity-40 hover:opacity-100"
                          onClick={() => handleDeleteTask(task.id)}
                          whileTap={{ scale: 0.8 }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </motion.button>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
