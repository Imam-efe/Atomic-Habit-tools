import { Hono } from 'hono';
import { validateDescription } from '../lib/shortcut-validation';

type ShortcutsContext = {
  Bindings: {
    ai?: any;
    SHORTCUT_SIGNING_CERT?: string;
    SHORTCUT_CERT_PASSWORD?: string;
  };
};

const shortcuts = new Hono<ShortcutsContext>();

// POST /api/shortcuts/generate - Generate a shortcut from description
shortcuts.post('/generate', async (c) => {
  // Parse request body
  let body: { description?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_request', message: 'Invalid JSON' }, 400);
  }

  const { description } = body;

  // Validate input
  const validation = validateDescription(description || '');
  if (!validation.valid) {
    return c.json({ error: 'invalid_input', message: validation.error }, 400);
  }

  // TODO: Implement AI generation (Task 2)
  // TODO: Implement signing (Task 3)
  // TODO: Implement error handling (Task 4)

  return c.json({ error: 'not_implemented', message: 'Feature not yet implemented' }, 501);
});

export default shortcuts;
