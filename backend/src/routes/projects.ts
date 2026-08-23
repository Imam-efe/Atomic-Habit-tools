import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';
import { runJson } from '../lib/ai';

const projects = new Hono<AuthContext>();

projects.use('/*', requireAuth);

const PRIORITIES = ['low', 'normal', 'high'] as const;

interface DBProject {
  id: string;
  name: string;
  goal_id: string | null;
  created_at: number;
}

interface DBTask {
  id: string;
  project_id: string;
  name: string;
  status: string;
  goal_id: string | null;
  sort_order: number;
  created_at: number;
  due_date: string | null;
  priority: string | null;
}

interface DBGoal {
  id: string;
  identity_statement: string;
  color: string;
}

// GET /api/projects
projects.get('/', async (c) => {
  const user = c.get('user');

  const [pRows, tRows, gRows] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM projects WHERE user_id = ?1 ORDER BY created_at ASC').bind(user.sub).all<DBProject>(),
    c.env.DB.prepare(`
      SELECT t.*, td.due_date, td.priority
      FROM tasks t
      LEFT JOIN task_details td ON td.task_id = t.id
      WHERE t.user_id = ?1
      ORDER BY t.sort_order ASC, t.created_at ASC
    `).bind(user.sub).all<DBTask>(),
    c.env.DB.prepare('SELECT id, identity_statement, color FROM goals WHERE user_id = ?1').bind(user.sub).all<DBGoal>(),
  ]);

  const goalsMap = new Map((gRows.results ?? []).map(g => [g.id, g]));

  const projectsList = (pRows.results ?? []).map(p => {
    const linkedGoal = p.goal_id ? goalsMap.get(p.goal_id) : null;
    const projectTasks = (tRows.results ?? [])
      .filter(t => t.project_id === p.id)
      .map(t => {
        const taskGoal = t.goal_id ? goalsMap.get(t.goal_id) : null;
        return {
          id: t.id,
          name: t.name,
          status: t.status,
          goalId: t.goal_id,
          goalName: taskGoal ? taskGoal.identity_statement : null,
          goalColor: taskGoal ? taskGoal.color : null,
          dueDate: t.due_date,
          priority: t.priority ?? 'normal',
        };
      });

    return {
      id: p.id,
      name: p.name,
      goalId: p.goal_id,
      goalName: linkedGoal ? linkedGoal.identity_statement : null,
      goalColor: linkedGoal ? linkedGoal.color : null,
      tasks: projectTasks,
    };
  });

  return c.json(projectsList);
});

// POST /api/projects
projects.post('/', async (c) => {
  const user = c.get('user');
  type ProjectBody = { name?: string; goalId?: string };
  const body = await c.req.json<ProjectBody>().catch((): ProjectBody => ({}));

  const err = validate(body as Record<string, unknown>, { name: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO projects (id, user_id, name, goal_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(id, user.sub, body.name!.trim(), body.goalId ?? null, now).run();

  return c.json({ id, name: body.name!.trim(), goalId: body.goalId ?? null, tasks: [] }, 201);
});

// DELETE /api/projects/:id
projects.delete('/:id', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');

  await c.env.DB.prepare('DELETE FROM projects WHERE id = ?1 AND user_id = ?2').bind(projectId, user.sub).run();
  return c.json({ ok: true });
});

/** Upsert (or clear) a task's due date / priority row. Absence means neither is set. */
async function upsertTaskDetails(
  db: D1Database,
  taskId: string,
  dueDate: string | undefined,
  priority: string | undefined
): Promise<void> {
  const validPriority = PRIORITIES.includes(priority as (typeof PRIORITIES)[number]) ? priority! : 'normal';
  const validDue = dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null;

  if (!validDue && validPriority === 'normal') {
    // Back to the no-row default — nothing to store.
    await db.prepare('DELETE FROM task_details WHERE task_id = ?1').bind(taskId).run();
    return;
  }

  await db.prepare(`
    INSERT INTO task_details (task_id, due_date, priority, updated_at)
    VALUES (?1, ?2, ?3, unixepoch())
    ON CONFLICT(task_id) DO UPDATE SET due_date = ?2, priority = ?3, updated_at = unixepoch()
  `).bind(taskId, validDue, validPriority).run();
}

// POST /api/projects/:id/tasks
projects.post('/:id/tasks', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');
  type TaskBody = { name?: string; goalId?: string; dueDate?: string; priority?: string };
  const body = await c.req.json<TaskBody>().catch((): TaskBody => ({}));

  const err = validate(body as Record<string, unknown>, { name: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  // Verify project ownership
  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?1 AND user_id = ?2')
    .bind(projectId, user.sub)
    .first();

  if (!project) {
    return c.json({ error: 'project not found' }, 404);
  }

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  // Get max sort_order
  const maxSort = await c.env.DB.prepare('SELECT MAX(sort_order) as m FROM tasks WHERE project_id = ?1')
    .bind(projectId)
    .first<{ m: number | null }>();

  const nextSort = (maxSort?.m ?? 0) + 1;

  await c.env.DB.prepare(
    `INSERT INTO tasks (id, project_id, user_id, name, status, goal_id, sort_order, created_at)
     VALUES (?1, ?2, ?3, ?4, 'backlog', ?5, ?6, ?7)`
  ).bind(id, projectId, user.sub, body.name!.trim(), body.goalId ?? null, nextSort, now).run();

  await upsertTaskDetails(c.env.DB, id, body.dueDate, body.priority);

  return c.json({
    id, name: body.name!.trim(), status: 'backlog', goalId: body.goalId ?? null,
    dueDate: body.dueDate ?? null, priority: body.priority ?? 'normal',
  }, 201);
});

// PUT /api/projects/tasks/:taskId — edit name / due date / priority
projects.put('/tasks/:taskId', async (c) => {
  const user = c.get('user');
  const taskId = c.req.param('taskId');
  type TaskBody = { name?: string; dueDate?: string; priority?: string };
  const body = await c.req.json<TaskBody>().catch((): TaskBody => ({}));

  const err = validate(body as Record<string, unknown>, { name: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  const res = await c.env.DB.prepare('UPDATE tasks SET name = ?1 WHERE id = ?2 AND user_id = ?3')
    .bind(body.name!.trim(), taskId, user.sub).run();
  if (res.meta.changes === 0) return c.json({ error: 'task not found' }, 404);

  await upsertTaskDetails(c.env.DB, taskId, body.dueDate, body.priority);

  return c.json({ id: taskId, name: body.name!.trim(), dueDate: body.dueDate ?? null, priority: body.priority ?? 'normal' });
});

// POST /api/projects/tasks/:taskId/toggle
projects.post('/tasks/:taskId/toggle', async (c) => {
  const user = c.get('user');
  const taskId = c.req.param('taskId');

  const task = await c.env.DB.prepare('SELECT id, status FROM tasks WHERE id = ?1 AND user_id = ?2')
    .bind(taskId, user.sub)
    .first<{ id: string; status: string }>();

  if (!task) {
    return c.json({ error: 'task not found' }, 404);
  }

  const nextStatus = task.status === 'done' ? 'backlog' : 'done';

  await c.env.DB.prepare('UPDATE tasks SET status = ?1 WHERE id = ?2')
    .bind(nextStatus, taskId)
    .run();

  return c.json({ id: taskId, status: nextStatus });
});

// DELETE /api/projects/tasks/:taskId
projects.delete('/tasks/:taskId', async (c) => {
  const user = c.get('user');
  const taskId = c.req.param('taskId');

  await c.env.DB.prepare('DELETE FROM tasks WHERE id = ?1 AND user_id = ?2').bind(taskId, user.sub).run();
  return c.json({ ok: true });
});

interface RawBreakdown {
  tasks?: string[];
}

const BREAKDOWN_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      description: '5-8 nama tugas konkret untuk menyelesaikan proyek ini, tiap item singkat (kata kerja + objek)',
      items: { type: 'string' },
    },
  },
  required: ['tasks'],
} as const;

// POST /api/projects/:id/breakdown — AI drafts a task list, nothing written
//
// Same philosophy as quickadd: an extraction/generation model is occasionally
// off, so this returns a proposal the frontend shows as editable checkboxes
// and commits through the existing POST /:id/tasks per item the user keeps.
projects.post('/:id/breakdown', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');

  const project = await c.env.DB.prepare(
    `SELECT p.name, g.identity_statement
     FROM projects p
     LEFT JOIN goals g ON g.id = p.goal_id
     WHERE p.id = ?1 AND p.user_id = ?2`
  ).bind(projectId, user.sub).first<{ name: string; identity_statement: string | null }>();
  if (!project) return c.json({ error: 'project not found' }, 404);

  let draft: RawBreakdown | null = null;
  try {
    draft = await runJson<RawBreakdown>(
      c.env,
      [
        {
          role: 'system',
          content: 'Kamu membantu memecah proyek jadi daftar tugas konkret dalam Bahasa Indonesia. Setiap tugas harus bisa langsung dikerjakan (kata kerja + objek jelas), bukan sub-judul samar. Jangan beri penjelasan tambahan.',
        },
        {
          role: 'user',
          content: [
            `Proyek: "${project.name}"`,
            project.identity_statement ? `Terkait identitas: ${project.identity_statement}` : '',
          ].filter(Boolean).join('\n'),
        },
      ],
      BREAKDOWN_SCHEMA as unknown as Record<string, unknown>,
      { maxTokens: 400 }
    );
  } catch (err) {
    console.error('Project breakdown failed', err);
    return c.json({ error: 'Breakdown gagal' }, 502);
  }

  const tasks = (draft?.tasks ?? []).map(t => t.trim()).filter(Boolean).slice(0, 8);
  if (tasks.length === 0) return c.json({ error: 'Breakdown gagal' }, 502);

  return c.json({ tasks });
});

export default projects;
