import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';

const projects = new Hono<AuthContext>();

projects.use('/*', requireAuth);

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
    c.env.DB.prepare('SELECT * FROM tasks WHERE user_id = ?1 ORDER BY sort_order ASC, created_at ASC').bind(user.sub).all<DBTask>(),
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

// POST /api/projects/:id/tasks
projects.post('/:id/tasks', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');
  type TaskBody = { name?: string; goalId?: string };
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

  return c.json({ id, name: body.name!.trim(), status: 'backlog', goalId: body.goalId ?? null }, 201);
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

export default projects;
