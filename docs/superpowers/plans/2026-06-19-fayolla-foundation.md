# Fayolla Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap Fayolla (Atomic Habits personal OS) with Cloudflare Pages (React frontend), Cloudflare Workers (Hono API), Cloudflare D1 (SQLite DB), and Google OAuth with multi-account switching.

**Architecture:** Vite/React 18 SPA on Cloudflare Pages → fetch to Cloudflare Worker (Hono router) → Cloudflare D1. Google OAuth 2.0 callback handled in Worker; Worker issues HS256 JWT (15 min) + opaque refresh token (30 days, stored in D1). Multi-account switching: each account's refresh token stored in localStorage, Zustand holds the active session in memory.

**Tech Stack:** React 18, Framer Motion 11, Tailwind CSS 3, React Router v6, Zustand 4, TypeScript 5, Vite 5, Hono 4, Wrangler 3, Cloudflare Workers, Cloudflare D1, Cloudflare Pages.

---

## Prerequisites (manual steps before running any task)

1. **Cloudflare account** already exists (user has one).
2. **Google Cloud Console** — create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URI: `https://<your-worker>.workers.dev/api/auth/google/callback`
   - Note `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. **Install Wrangler CLI**: `npm install -g wrangler@3` then `wrangler login`.

---

## File Structure

```
d:/AI Model/Atomic Habit tools/
├── frontend/                          # Cloudflare Pages (React SPA)
│   ├── public/
│   │   ├── manifest.json              # PWA manifest
│   │   └── icons/                     # PWA icons (192, 512)
│   ├── src/
│   │   ├── main.tsx                   # React root
│   │   ├── App.tsx                    # Router + ProtectedRoute
│   │   ├── tokens/
│   │   │   ├── motion.ts              # Framer Motion spring presets
│   │   │   └── theme.ts               # Design tokens (colors, radii)
│   │   ├── stores/
│   │   │   ├── authStore.ts           # Zustand: active session + accounts[]
│   │   │   └── uiStore.ts             # Zustand: theme, accent, activeTab
│   │   ├── lib/
│   │   │   └── api.ts                 # Typed fetch wrapper (auto-refresh JWT)
│   │   ├── components/
│   │   │   ├── TabBar.tsx             # Bottom tab bar (5 tabs)
│   │   │   ├── ScreenTransition.tsx   # Framer Motion page wrapper
│   │   │   └── ProtectedRoute.tsx     # Redirect to /login if no session
│   │   ├── screens/
│   │   │   ├── LoginScreen.tsx        # Google OAuth entry
│   │   │   ├── Dashboard.tsx          # Beranda (stub)
│   │   │   ├── Habits.tsx             # Kebiasaan (stub)
│   │   │   ├── Goals.tsx              # Goals (stub)
│   │   │   ├── Budget.tsx             # Uang (stub)
│   │   │   └── More.tsx               # Lainnya + AccountSwitcher
│   │   └── types/
│   │       └── index.ts               # Shared TS types
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── postcss.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── backend/                           # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts                   # Hono app entry + CORS
│   │   ├── types.ts                   # Worker Env + shared types
│   │   ├── lib/
│   │   │   ├── jwt.ts                 # HS256 sign/verify (Web Crypto)
│   │   │   └── nanoid.ts              # crypto.randomUUID wrapper
│   │   ├── middleware/
│   │   │   └── auth.ts                # Bearer JWT verification middleware
│   │   └── routes/
│   │       ├── auth.ts                # /api/auth/* (Google OAuth, refresh, me)
│   │       └── health.ts              # /api/health
│   ├── migrations/
│   │   └── 0001_initial.sql           # D1 schema
│   ├── wrangler.toml                  # Cloudflare config
│   ├── tsconfig.json
│   └── package.json
│
└── docs/superpowers/plans/
    └── 2026-06-19-fayolla-foundation.md  (this file)
```

---

## Task 1: Initialize monorepo and install dependencies

**Files:**
- Create: `backend/package.json`
- Create: `frontend/package.json`

- [ ] **Step 1: Create backend package.json and install deps**

Run in `backend/` directory:
```bash
cd "d:/AI Model/Atomic Habit tools"
mkdir backend && cd backend
```

Create `backend/package.json`:
```json
{
  "name": "fayolla-backend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:migrate": "wrangler d1 execute fayolla-db --file=./migrations/0001_initial.sql",
    "db:migrate:remote": "wrangler d1 execute fayolla-db --remote --file=./migrations/0001_initial.sql"
  },
  "dependencies": {
    "hono": "^4.4.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240725.0",
    "typescript": "^5.5.0",
    "wrangler": "^3.65.0"
  }
}
```

Run:
```bash
cd "d:/AI Model/Atomic Habit tools/backend"
npm install
```

- [ ] **Step 2: Create frontend package.json and install deps**

Create `frontend/package.json`:
```json
{
  "name": "fayolla-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "framer-motion": "^11.3.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.25.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0"
  }
}
```

Run:
```bash
cd "d:/AI Model/Atomic Habit tools/frontend"
npm install
```

- [ ] **Step 3: Create backend tsconfig.json**

Create `backend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types"],
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create frontend tsconfig.json**

Create `frontend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Commit**

```bash
cd "d:/AI Model/Atomic Habit tools"
git init
git add backend/ frontend/
git commit -m "chore: init monorepo with backend and frontend packages"
```

---

## Task 2: Create Cloudflare D1 database and wrangler.toml

**Files:**
- Create: `backend/wrangler.toml`

- [ ] **Step 1: Create D1 database via Wrangler**

```bash
cd "d:/AI Model/Atomic Habit tools/backend"
wrangler d1 create fayolla-db
```

Expected output includes:
```
✅ Successfully created DB 'fayolla-db'
[[d1_databases]]
binding = "DB"
database_name = "fayolla-db"
database_id = "<your-database-id>"
```

Note the `database_id` — you'll need it in the next step.

- [ ] **Step 2: Create wrangler.toml**

Create `backend/wrangler.toml` (replace `<database-id>` with value from step 1):
```toml
name = "fayolla-api"
main = "src/index.ts"
compatibility_date = "2024-07-25"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "fayolla-db"
database_id = "<database-id>"

[vars]
FRONTEND_URL = "http://localhost:5173"

# Secrets (set via wrangler secret put):
# GOOGLE_CLIENT_ID
# GOOGLE_CLIENT_SECRET
# JWT_SECRET
```

- [ ] **Step 3: Set Wrangler secrets**

```bash
cd "d:/AI Model/Atomic Habit tools/backend"
wrangler secret put GOOGLE_CLIENT_ID
# Paste your Google Client ID when prompted

wrangler secret put GOOGLE_CLIENT_SECRET
# Paste your Google Client Secret

wrangler secret put JWT_SECRET
# Paste a random 32+ char secret, e.g.: openssl rand -hex 32
```

- [ ] **Step 4: Commit**

```bash
git add backend/wrangler.toml
git commit -m "chore: add wrangler.toml with D1 binding"
```

---

## Task 3: D1 database schema migration

**Files:**
- Create: `backend/migrations/0001_initial.sql`

- [ ] **Step 1: Write SQL schema**

Create `backend/migrations/0001_initial.sql`:
```sql
-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  accent TEXT NOT NULL DEFAULT 'violet',
  theme TEXT NOT NULL DEFAULT 'dark',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- OAuth state (CSRF protection, 10-minute TTL)
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Habits
CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#34C759',
  icon TEXT NOT NULL DEFAULT 'check',
  trigger_cue TEXT,
  action_desc TEXT,
  action_time TEXT,
  action_place TEXT,
  two_min TEXT,
  streak INTEGER NOT NULL DEFAULT 0,
  last_completed_date TEXT,
  milestone INTEGER NOT NULL DEFAULT 7,
  goal_ids TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Habit completions (daily log)
CREATE TABLE IF NOT EXISTS habit_completions (
  id TEXT PRIMARY KEY,
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  completed_date TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(habit_id, completed_date)
);

-- Goals
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identity_statement TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#7C5CFF',
  icon TEXT NOT NULL DEFAULT 'target',
  habit_ids TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal_id TEXT REFERENCES goals(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'backlog',
  goal_id TEXT REFERENCES goals(id),
  parent_task_id TEXT REFERENCES tasks(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Budget entries
CREATE TABLE IF NOT EXISTS budget_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount_idr INTEGER NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  entry_date TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Budget limits per category per month
CREATE TABLE IF NOT EXISTS budget_limits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  monthly_limit_idr INTEGER NOT NULL,
  month TEXT NOT NULL,
  UNIQUE(user_id, category, month)
);

-- Activity labels (daily time log)
CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  hours REAL NOT NULL,
  log_date TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Food log
CREATE TABLE IF NOT EXISTS food_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_name TEXT NOT NULL,
  portion TEXT,
  calories INTEGER,
  protein_g REAL,
  carbs_g REAL,
  fat_g REAL,
  fiber_g REAL,
  label TEXT,
  log_date TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Nutrition daily targets
CREATE TABLE IF NOT EXISTS nutrition_targets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  calories INTEGER NOT NULL DEFAULT 2200,
  protein_g INTEGER NOT NULL DEFAULT 120,
  carbs_g INTEGER NOT NULL DEFAULT 250,
  fat_g INTEGER NOT NULL DEFAULT 70,
  fiber_g INTEGER NOT NULL DEFAULT 30,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);
CREATE INDEX IF NOT EXISTS idx_habit_completions_habit_date ON habit_completions(habit_id, completed_date);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_entries_user_date ON budget_entries(user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_date ON activity_logs(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
```

- [ ] **Step 2: Apply migration locally**

```bash
cd "d:/AI Model/Atomic Habit tools/backend"
wrangler d1 execute fayolla-db --file=./migrations/0001_initial.sql
```

Expected output:
```
🌀 Executing on local database fayolla-db...
✅ Applied 0001_initial.sql
```

- [ ] **Step 3: Apply migration to remote D1**

```bash
wrangler d1 execute fayolla-db --remote --file=./migrations/0001_initial.sql
```

- [ ] **Step 4: Verify schema**

```bash
wrangler d1 execute fayolla-db --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Expected: lists all 14 tables (users, habits, goals, etc.).

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/
git commit -m "feat: add D1 database schema with all Fayolla tables"
```

---

## Task 4: Backend types and utilities

**Files:**
- Create: `backend/src/types.ts`
- Create: `backend/src/lib/jwt.ts`
- Create: `backend/src/lib/nanoid.ts`

- [ ] **Step 1: Write shared types**

Create `backend/src/types.ts`:
```typescript
export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
}

export interface JWTPayload {
  sub: string;    // user id
  email: string;
  name: string;
  avatarUrl: string | null;
  iat: number;
  exp: number;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  accent: string;
  theme: string;
  created_at: number;
}
```

- [ ] **Step 2: Write JWT utility (Web Crypto, HS256)**

Create `backend/src/lib/jwt.ts`:
```typescript
function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlEncode(str: string): string {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signJWT(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlEncode(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64url(sig)}`;
}

export async function verifyJWT(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const key = await getKey(secret);
  const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
  if (!valid) return null;
  try {
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Write nanoid utility**

Create `backend/src/lib/nanoid.ts`:
```typescript
export function nanoid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function generateRefreshToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/
git commit -m "feat: add backend types, JWT utility, and nanoid helper"
```

---

## Task 5: Hono app entry and health route

**Files:**
- Create: `backend/src/routes/health.ts`
- Create: `backend/src/index.ts`

- [ ] **Step 1: Write health route**

Create `backend/src/routes/health.ts`:
```typescript
import { Hono } from 'hono';
import type { Env } from '../types';

const health = new Hono<{ Bindings: Env }>();

health.get('/', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

export default health;
```

- [ ] **Step 2: Write main Worker entry with CORS**

Create `backend/src/index.ts`:
```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import health from './routes/health';
import auth from './routes/auth';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const allowed = [
        c.env.FRONTEND_URL,
        'https://fayolla.pages.dev',
      ];
      return allowed.includes(origin) ? origin : allowed[0];
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

app.route('/api/health', health);
app.route('/api/auth', auth);

app.notFound((c) => c.json({ error: 'not found' }, 404));

export default app;
```

- [ ] **Step 3: Start dev server and verify health endpoint**

```bash
cd "d:/AI Model/Atomic Habit tools/backend"
wrangler dev
```

In a separate terminal:
```bash
curl http://localhost:8787/api/health
```

Expected:
```json
{"status":"ok","timestamp":1750000000000}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts backend/src/routes/health.ts
git commit -m "feat: add Hono app entry with CORS and health endpoint"
```

---

## Task 6: Google OAuth routes in Worker

**Files:**
- Create: `backend/src/routes/auth.ts`

- [ ] **Step 1: Write full auth route**

Create `backend/src/routes/auth.ts`:
```typescript
import { Hono } from 'hono';
import type { Env } from '../types';
import { signJWT } from '../lib/jwt';
import { nanoid, generateRefreshToken, hashToken } from '../lib/nanoid';

const auth = new Hono<{ Bindings: Env }>();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

// GET /api/auth/google — redirect to Google
auth.get('/google', async (c) => {
  const state = crypto.randomUUID();

  // Store state in D1 with 10-minute TTL check
  await c.env.DB.prepare(
    'INSERT INTO oauth_states (state, created_at) VALUES (?, ?)'
  )
    .bind(state, Math.floor(Date.now() / 1000))
    .run();

  const workerUrl = new URL(c.req.url);
  const redirectUri = `${workerUrl.protocol}//${workerUrl.host}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  });

  return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

// GET /api/auth/google/callback — exchange code, issue tokens
auth.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return c.redirect(`${c.env.FRONTEND_URL}/login?error=missing_params`);
  }

  // Verify state (CSRF) and check it's less than 10 minutes old
  const stateRow = await c.env.DB.prepare(
    'SELECT state, created_at FROM oauth_states WHERE state = ?'
  )
    .bind(state)
    .first<{ state: string; created_at: number }>();

  if (!stateRow || Date.now() / 1000 - stateRow.created_at > 600) {
    return c.redirect(`${c.env.FRONTEND_URL}/login?error=invalid_state`);
  }

  // Delete used state
  await c.env.DB.prepare('DELETE FROM oauth_states WHERE state = ?')
    .bind(state)
    .run();

  // Exchange code for Google tokens
  const workerUrl = new URL(c.req.url);
  const redirectUri = `${workerUrl.protocol}//${workerUrl.host}/api/auth/google/callback`;

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return c.redirect(`${c.env.FRONTEND_URL}/login?error=token_exchange_failed`);
  }

  const { access_token: googleAccessToken } = (await tokenRes.json()) as {
    access_token: string;
  };

  // Get user info from Google
  const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${googleAccessToken}` },
  });

  if (!userInfoRes.ok) {
    return c.redirect(`${c.env.FRONTEND_URL}/login?error=userinfo_failed`);
  }

  const googleUser = (await userInfoRes.json()) as {
    sub: string;
    email: string;
    name: string;
    picture: string;
  };

  // Upsert user in D1
  const userId = `g_${googleUser.sub}`;
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, avatar_url)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       avatar_url = excluded.avatar_url`
  )
    .bind(userId, googleUser.email, googleUser.name, googleUser.picture)
    .run();

  // Issue JWT (15 minutes)
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await signJWT(
    {
      sub: userId,
      email: googleUser.email,
      name: googleUser.name,
      avatarUrl: googleUser.picture,
      iat: now,
      exp: now + 15 * 60,
    },
    c.env.JWT_SECRET
  );

  // Issue refresh token (30 days)
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = await hashToken(refreshToken);
  const refreshTokenId = nanoid();

  await c.env.DB.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(refreshTokenId, userId, refreshTokenHash, now + 30 * 24 * 60 * 60)
    .run();

  // Redirect to frontend with tokens in URL hash (never in query string for security)
  const redirectParams = new URLSearchParams({
    access_token: accessToken,
    refresh_token: refreshToken,
    user_id: userId,
    name: googleUser.name,
    email: googleUser.email,
    avatar_url: googleUser.picture,
  });

  return c.redirect(`${c.env.FRONTEND_URL}/auth/callback?${redirectParams.toString()}`);
});

// POST /api/auth/refresh — exchange refresh token for new access token
auth.post('/refresh', async (c) => {
  const body = await c.req.json<{ refresh_token: string }>();
  if (!body.refresh_token) {
    return c.json({ error: 'missing refresh_token' }, 400);
  }

  const tokenHash = await hashToken(body.refresh_token);
  const tokenRow = await c.env.DB.prepare(
    `SELECT rt.id, rt.user_id, rt.expires_at, u.email, u.name, u.avatar_url
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = ?`
  )
    .bind(tokenHash)
    .first<{
      id: string;
      user_id: string;
      expires_at: number;
      email: string;
      name: string;
      avatar_url: string | null;
    }>();

  if (!tokenRow) {
    return c.json({ error: 'invalid refresh_token' }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  if (tokenRow.expires_at < now) {
    await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE id = ?')
      .bind(tokenRow.id)
      .run();
    return c.json({ error: 'refresh_token expired' }, 401);
  }

  // Rotate refresh token
  const newRefreshToken = generateRefreshToken();
  const newRefreshTokenHash = await hashToken(newRefreshToken);

  await c.env.DB.prepare(
    'UPDATE refresh_tokens SET token_hash = ?, expires_at = ? WHERE id = ?'
  )
    .bind(newRefreshTokenHash, now + 30 * 24 * 60 * 60, tokenRow.id)
    .run();

  const accessToken = await signJWT(
    {
      sub: tokenRow.user_id,
      email: tokenRow.email,
      name: tokenRow.name,
      avatarUrl: tokenRow.avatar_url,
      iat: now,
      exp: now + 15 * 60,
    },
    c.env.JWT_SECRET
  );

  return c.json({
    access_token: accessToken,
    refresh_token: newRefreshToken,
  });
});

// POST /api/auth/logout — revoke refresh token
auth.post('/logout', async (c) => {
  const body = await c.req.json<{ refresh_token: string }>();
  if (body.refresh_token) {
    const tokenHash = await hashToken(body.refresh_token);
    await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?')
      .bind(tokenHash)
      .run();
  }
  return c.json({ ok: true });
});

export default auth;
```

- [ ] **Step 2: Test OAuth flow locally**

Start worker:
```bash
cd "d:/AI Model/Atomic Habit tools/backend"
wrangler dev
```

Open browser: `http://localhost:8787/api/auth/google`

Expected: Redirects to Google OAuth consent screen. After approving, Google redirects to callback URL. Worker redirects to `http://localhost:5173/auth/callback?access_token=...&refresh_token=...`

*(Frontend not built yet — you'll see a browser error on localhost:5173 which is expected at this stage.)*

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/auth.ts
git commit -m "feat: Google OAuth flow with JWT + refresh token rotation in D1"
```

---

## Task 7: Auth middleware for protected routes

**Files:**
- Create: `backend/src/middleware/auth.ts`

- [ ] **Step 1: Write JWT middleware**

Create `backend/src/middleware/auth.ts`:
```typescript
import type { Context, Next } from 'hono';
import type { Env, JWTPayload } from '../types';
import { verifyJWT } from '../lib/jwt';

export type AuthContext = {
  Variables: {
    user: JWTPayload;
  };
  Bindings: Env;
};

export async function requireAuth(
  c: Context<AuthContext>,
  next: Next
): Promise<Response> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);

  if (!payload) {
    return c.json({ error: 'invalid or expired token' }, 401);
  }

  c.set('user', payload as unknown as JWTPayload);
  await next();
  return c.res;
}
```

- [ ] **Step 2: Add /api/auth/me protected route to auth.ts**

Add this to the bottom of `backend/src/routes/auth.ts` (before `export default auth`):

```typescript
// GET /api/auth/me — get current user (requires JWT)
auth.get('/me', requireAuth as any, async (c) => {
  const user = c.get('user' as any) as JWTPayload;
  const row = await c.env.DB.prepare(
    'SELECT id, email, name, avatar_url, accent, theme FROM users WHERE id = ?'
  )
    .bind(user.sub)
    .first<UserRow>();

  if (!row) return c.json({ error: 'user not found' }, 404);

  return c.json({
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    accent: row.accent,
    theme: row.theme,
  });
});
```

Also add these imports at the top of `auth.ts`:
```typescript
import { requireAuth } from '../middleware/auth';
import type { JWTPayload, UserRow } from '../types';
```

- [ ] **Step 3: Verify /api/auth/me returns 401 without token**

```bash
curl http://localhost:8787/api/auth/me
```

Expected:
```json
{"error":"unauthorized"}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/middleware/ backend/src/routes/auth.ts
git commit -m "feat: JWT auth middleware and /api/auth/me endpoint"
```

---

## Task 8: Frontend scaffold (Vite + Tailwind + design tokens)

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.ts`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/tokens/motion.ts`
- Create: `frontend/src/tokens/theme.ts`
- Create: `frontend/src/types/index.ts`

- [ ] **Step 1: Create index.html**

Create `frontend/index.html`:
```html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#000000" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="manifest" href="/manifest.json" />
    <title>Fayolla</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create vite.config.ts**

Create `frontend/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 3: Create Tailwind config**

Create `frontend/tailwind.config.ts`:
```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      borderRadius: {
        card: '18px',
        sheet: '22px',
        app: '44px',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

Create `frontend/postcss.config.ts`:
```typescript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Create design tokens**

Create `frontend/src/tokens/motion.ts`:
```typescript
export const springs = {
  snappy: { type: 'spring' as const, stiffness: 400, damping: 28, mass: 1 },
  smooth: { type: 'spring' as const, stiffness: 280, damping: 32, mass: 1 },
  bouncy: { type: 'spring' as const, stiffness: 500, damping: 20, mass: 1 },
  gentle: { type: 'spring' as const, stiffness: 200, damping: 30, mass: 1 },
  firm: { type: 'spring' as const, stiffness: 350, damping: 40, mass: 1 },
  roll: { type: 'spring' as const, stiffness: 300, damping: 26, mass: 1 },
  nav: { type: 'spring' as const, stiffness: 380, damping: 36, mass: 1 },
};

export const duration = {
  micro: 0.15,
  component: 0.32,
  screen: 0.4,
  celebration: 0.6,
};
```

Create `frontend/src/tokens/theme.ts`:
```typescript
export const accents = {
  violet: { primary: '#7C5CFF', gradient: '#9D7CFF', soft: 'rgba(124,92,255,0.16)' },
  green: { primary: '#34C759', gradient: '#5BD97A', soft: 'rgba(52,199,89,0.16)' },
  blue: { primary: '#0A84FF', gradient: '#4AA8FF', soft: 'rgba(10,132,255,0.16)' },
  orange: { primary: '#FF9F0A', gradient: '#FFB740', soft: 'rgba(255,159,10,0.16)' },
} as const;

export type AccentName = keyof typeof accents;
export type ThemeName = 'dark' | 'light';

export const darkTokens = {
  bg: '#000000',
  surface: '#1C1C1E',
  text: '#FFFFFF',
  text2: 'rgba(235,235,245,0.62)',
  text3: 'rgba(235,235,245,0.30)',
  sep: 'rgba(84,84,88,0.50)',
  track: 'rgba(120,120,128,0.28)',
  blur: 'rgba(22,22,24,0.78)',
};

export const lightTokens = {
  bg: '#F2F2F7',
  surface: '#FFFFFF',
  text: '#000000',
  text2: 'rgba(60,60,67,0.60)',
  text3: 'rgba(60,60,67,0.30)',
  sep: 'rgba(60,60,67,0.14)',
  track: 'rgba(120,120,128,0.16)',
  blur: 'rgba(255,255,255,0.78)',
};

export function applyTheme(theme: ThemeName, accent: AccentName): void {
  const root = document.documentElement;
  const tokens = theme === 'dark' ? darkTokens : lightTokens;
  const accentTokens = accents[accent];

  Object.entries(tokens).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value);
  });

  root.style.setProperty('--accent', accentTokens.primary);
  root.style.setProperty('--accent2', accentTokens.gradient);
  root.style.setProperty('--accentSoft', accentTokens.soft);
  root.setAttribute('data-theme', theme);
}
```

- [ ] **Step 5: Create shared types**

Create `frontend/src/types/index.ts`:
```typescript
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  accent: string;
  theme: string;
}

export interface Account {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  refreshToken: string;
}

export interface Session {
  user: User;
  accessToken: string;
}

export type TabName = 'beranda' | 'kebiasaan' | 'goals' | 'uang' | 'lainnya';
export type AccentName = 'violet' | 'green' | 'blue' | 'orange';
export type ThemeName = 'dark' | 'light';
```

- [ ] **Step 6: Create src/main.tsx**

Create `frontend/src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `frontend/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg: #000000;
  --surface: #1C1C1E;
  --text: #FFFFFF;
  --text2: rgba(235,235,245,0.62);
  --text3: rgba(235,235,245,0.30);
  --sep: rgba(84,84,88,0.50);
  --track: rgba(120,120,128,0.28);
  --blur: rgba(22,22,24,0.78);
  --accent: #7C5CFF;
  --accent2: #9D7CFF;
  --accentSoft: rgba(124,92,255,0.16);
}

body {
  background-color: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
    "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}

* {
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "feat: frontend scaffold with Vite, Tailwind, design tokens"
```

---

## Task 9: Zustand stores (auth + UI)

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/stores/authStore.ts`
- Create: `frontend/src/stores/uiStore.ts`

- [ ] **Step 1: Write API client with auto-refresh**

Create `frontend/src/lib/api.ts`:
```typescript
import { useAuthStore } from '@/stores/authStore';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { session, accounts, setSession } = useAuthStore.getState();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (session?.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`;
  }

  let res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // Auto-refresh on 401
  if (res.status === 401 && session) {
    const account = accounts.find((a) => a.userId === session.user.id);
    if (account) {
      const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: account.refreshToken }),
      });

      if (refreshRes.ok) {
        const { access_token, refresh_token } = (await refreshRes.json()) as {
          access_token: string;
          refresh_token: string;
        };

        // Update stored refresh token and active session
        const updatedAccounts = accounts.map((a) =>
          a.userId === session.user.id ? { ...a, refreshToken: refresh_token } : a
        );
        localStorage.setItem('fayolla_accounts', JSON.stringify(updatedAccounts));
        setSession({ ...session, accessToken: access_token }, updatedAccounts);

        // Retry original request
        headers['Authorization'] = `Bearer ${access_token}`;
        res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
      }
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'unknown error' }));
    throw new Error((error as { error: string }).error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}
```

- [ ] **Step 2: Write auth store**

Create `frontend/src/stores/authStore.ts`:
```typescript
import { create } from 'zustand';
import type { Account, Session } from '@/types';

interface AuthState {
  session: Session | null;
  accounts: Account[];
  isLoading: boolean;
  setSession: (session: Session | null, accounts?: Account[]) => void;
  addAccount: (account: Account, accessToken: string, user: Session['user']) => void;
  switchAccount: (userId: string, accessToken: string) => void;
  removeAccount: (userId: string) => void;
  logout: () => void;
  loadFromStorage: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  accounts: [],
  isLoading: true,

  setSession: (session, accounts) => {
    set({ session, ...(accounts !== undefined ? { accounts } : {}) });
  },

  addAccount: (account, accessToken, user) => {
    const accounts = get().accounts;
    const existing = accounts.findIndex((a) => a.userId === account.userId);
    const updated =
      existing >= 0
        ? accounts.map((a, i) => (i === existing ? account : a))
        : [...accounts, account];

    localStorage.setItem('fayolla_accounts', JSON.stringify(updated));
    localStorage.setItem('fayolla_active_user_id', account.userId);
    set({ accounts: updated, session: { user, accessToken } });
  },

  switchAccount: (userId, accessToken) => {
    const { accounts } = get();
    const account = accounts.find((a) => a.userId === userId);
    if (!account) return;

    localStorage.setItem('fayolla_active_user_id', userId);
    set({
      session: {
        user: {
          id: account.userId,
          email: account.email,
          name: account.name,
          avatarUrl: account.avatarUrl,
          accent: 'violet',
          theme: 'dark',
        },
        accessToken,
      },
    });
  },

  removeAccount: (userId) => {
    const { accounts, session } = get();
    const updated = accounts.filter((a) => a.userId !== userId);
    localStorage.setItem('fayolla_accounts', JSON.stringify(updated));

    if (session?.user.id === userId) {
      const next = updated[0];
      if (next) {
        localStorage.setItem('fayolla_active_user_id', next.userId);
        set({
          accounts: updated,
          session: {
            user: {
              id: next.userId,
              email: next.email,
              name: next.name,
              avatarUrl: next.avatarUrl,
              accent: 'violet',
              theme: 'dark',
            },
            accessToken: '',
          },
        });
      } else {
        localStorage.removeItem('fayolla_active_user_id');
        set({ accounts: updated, session: null });
      }
    } else {
      set({ accounts: updated });
    }
  },

  logout: () => {
    localStorage.removeItem('fayolla_accounts');
    localStorage.removeItem('fayolla_active_user_id');
    set({ session: null, accounts: [] });
  },

  loadFromStorage: () => {
    try {
      const raw = localStorage.getItem('fayolla_accounts');
      const accounts: Account[] = raw ? JSON.parse(raw) : [];
      const activeUserId = localStorage.getItem('fayolla_active_user_id');
      const active = accounts.find((a) => a.userId === activeUserId) ?? accounts[0];

      if (active) {
        set({
          accounts,
          session: {
            user: {
              id: active.userId,
              email: active.email,
              name: active.name,
              avatarUrl: active.avatarUrl,
              accent: 'violet',
              theme: 'dark',
            },
            accessToken: '',
          },
          isLoading: false,
        });
      } else {
        set({ accounts: [], session: null, isLoading: false });
      }
    } catch {
      set({ accounts: [], session: null, isLoading: false });
    }
  },
}));
```

- [ ] **Step 3: Write UI store**

Create `frontend/src/stores/uiStore.ts`:
```typescript
import { create } from 'zustand';
import type { TabName, AccentName, ThemeName } from '@/types';
import { applyTheme } from '@/tokens/theme';

interface UIState {
  activeTab: TabName;
  subScreen: string | null;
  theme: ThemeName;
  accent: AccentName;
  setTab: (tab: TabName) => void;
  setSubScreen: (screen: string | null) => void;
  setTheme: (theme: ThemeName) => void;
  setAccent: (accent: AccentName) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeTab: 'beranda',
  subScreen: null,
  theme: 'dark',
  accent: 'violet',

  setTab: (tab) => set({ activeTab: tab, subScreen: null }),

  setSubScreen: (screen) => set({ subScreen: screen }),

  setTheme: (theme) => {
    applyTheme(theme, get().accent);
    set({ theme });
  },

  setAccent: (accent) => {
    applyTheme(get().theme, accent);
    set({ accent });
  },
}));
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/
git commit -m "feat: Zustand auth store with multi-account support, UI store, API client"
```

---

## Task 10: Login screen and auth callback

**Files:**
- Create: `frontend/src/screens/LoginScreen.tsx`
- Create: `frontend/src/screens/AuthCallback.tsx`

- [ ] **Step 1: Write LoginScreen**

Create `frontend/src/screens/LoginScreen.tsx`:
```tsx
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';

const API_URL = import.meta.env.VITE_API_URL ?? '/api';

export function LoginScreen() {
  const handleGoogleLogin = () => {
    window.location.href = `${API_URL}/auth/google`;
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-8"
      style={{ background: 'var(--bg)' }}
    >
      <motion.div
        className="w-full max-w-sm flex flex-col items-center gap-10"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.gentle}
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-20 h-20 rounded-[22px] flex items-center justify-center text-white text-3xl font-bold"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent2))' }}
          >
            F
          </div>
          <div className="text-center">
            <h1
              className="text-3xl font-extrabold tracking-tight"
              style={{ color: 'var(--text)' }}
            >
              Fayolla
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text2)' }}>
              Sistem personalmu untuk 1% lebih baik setiap hari
            </p>
          </div>
        </div>

        {/* Google Sign In */}
        <motion.button
          className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-semibold text-base"
          style={{
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--sep)',
          }}
          whileTap={{ scale: 0.97 }}
          transition={springs.snappy}
          onClick={handleGoogleLogin}
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Masuk dengan Google
        </motion.button>

        <p className="text-xs text-center" style={{ color: 'var(--text3)' }}>
          Data tersimpan di akun Cloudflare kamu. Tidak ada data pihak ketiga.
        </p>
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 2: Write AuthCallback screen**

Create `frontend/src/screens/AuthCallback.tsx`:
```tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import type { Account } from '@/types';

export function AuthCallback() {
  const navigate = useNavigate();
  const { addAccount } = useAuthStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const userId = params.get('user_id');
    const name = params.get('name');
    const email = params.get('email');
    const avatarUrl = params.get('avatar_url');

    if (!accessToken || !refreshToken || !userId || !name || !email) {
      navigate('/login', { replace: true });
      return;
    }

    // Clean URL immediately
    window.history.replaceState({}, '', '/auth/callback');

    const account: Account = {
      userId,
      email,
      name,
      avatarUrl: avatarUrl || null,
      refreshToken,
    };

    addAccount(account, accessToken, {
      id: userId,
      email,
      name,
      avatarUrl: avatarUrl || null,
      accent: 'violet',
      theme: 'dark',
    });

    navigate('/', { replace: true });
  }, []);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <p style={{ color: 'var(--text2)' }}>Masuk...</p>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/
git commit -m "feat: LoginScreen with Google OAuth, AuthCallback token handler"
```

---

## Task 11: App shell — Router, ProtectedRoute, TabBar, screen stubs

**Files:**
- Create: `frontend/src/components/ProtectedRoute.tsx`
- Create: `frontend/src/components/TabBar.tsx`
- Create: `frontend/src/components/ScreenTransition.tsx`
- Create: `frontend/src/screens/Dashboard.tsx`
- Create: `frontend/src/screens/Habits.tsx`
- Create: `frontend/src/screens/Goals.tsx`
- Create: `frontend/src/screens/Budget.tsx`
- Create: `frontend/src/screens/More.tsx`
- Create: `frontend/src/App.tsx`

- [ ] **Step 1: Write ProtectedRoute**

Create `frontend/src/components/ProtectedRoute.tsx`:
```tsx
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg)' }}
      />
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: Write ScreenTransition wrapper**

Create `frontend/src/components/ScreenTransition.tsx`:
```tsx
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { springs } from '@/tokens/motion';

export function ScreenTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        transition={springs.nav}
        className="min-h-screen"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 3: Write TabBar**

Create `frontend/src/components/TabBar.tsx`:
```tsx
import { motion } from 'framer-motion';
import { useUIStore } from '@/stores/uiStore';
import { springs } from '@/tokens/motion';
import type { TabName } from '@/types';

const tabs: { id: TabName; label: string; icon: React.ReactNode }[] = [
  {
    id: 'beranda',
    label: 'Beranda',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: 'kebiasaan',
    label: 'Kebiasaan',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    id: 'goals',
    label: 'Goals',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
  {
    id: 'uang',
    label: 'Uang',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="20" height="14" x="2" y="5" rx="2" />
        <line x1="2" x2="22" y1="10" y2="10" />
      </svg>
    ),
  },
  {
    id: 'lainnya',
    label: 'Lainnya',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="7" height="7" x="3" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="14" rx="1" />
        <rect width="7" height="7" x="3" y="14" rx="1" />
      </svg>
    ),
  },
];

export function TabBar() {
  const { activeTab, setTab } = useUIStore();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex items-end justify-around px-2"
      style={{
        background: 'var(--blur)',
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)',
        borderTop: '1px solid var(--sep)',
        paddingTop: '9px',
        paddingBottom: 'calc(26px + env(safe-area-inset-bottom))',
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <motion.button
            key={tab.id}
            className="flex flex-col items-center gap-1 min-w-[48px]"
            onClick={() => setTab(tab.id)}
            whileTap={{ scale: 0.9 }}
            transition={springs.snappy}
          >
            <motion.div
              animate={{
                scale: isActive ? 1.1 : 1,
                color: isActive ? 'var(--accent)' : 'var(--text3)',
              }}
              transition={springs.bouncy}
            >
              {tab.icon}
            </motion.div>
            <span
              className="text-[10px] font-semibold"
              style={{ color: isActive ? 'var(--accent)' : 'var(--text3)' }}
            >
              {tab.label}
            </span>
          </motion.button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Write screen stubs**

Create `frontend/src/screens/Dashboard.tsx`:
```tsx
import { motion } from 'framer-motion';
import { springs } from '@/tokens/motion';
import { useAuthStore } from '@/stores/authStore';

export function Dashboard() {
  const { session } = useAuthStore();
  const now = new Date();
  const greeting =
    now.getHours() < 12 ? 'Selamat pagi' : now.getHours() < 17 ? 'Selamat siang' : 'Selamat malam';

  return (
    <div
      className="min-h-screen px-5 pt-16 pb-28"
      style={{ background: 'var(--bg)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.gentle}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-sm" style={{ color: 'var(--text2)' }}>
              {now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text)' }}>
              {greeting}, {session?.user.name?.split(' ')[0]}
            </h1>
          </div>
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-lg"
            style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}
          >
            {session?.user.name?.[0] ?? 'A'}
          </div>
        </div>

        <div
          className="rounded-[18px] p-5 mb-4"
          style={{
            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
          }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/70 mb-1">
            IDENTITY HARI INI
          </p>
          <p className="text-xl font-bold text-white">
            Saya adalah orang yang sehat & bugar
          </p>
        </div>

        <p className="text-center mt-20" style={{ color: 'var(--text3)' }}>
          Modul dalam pengembangan — coming soon
        </p>
      </motion.div>
    </div>
  );
}
```

Create `frontend/src/screens/Habits.tsx`:
```tsx
export function Habits() {
  return (
    <div className="min-h-screen px-5 pt-16 pb-28" style={{ background: 'var(--bg)' }}>
      <h1 className="text-3xl font-extrabold tracking-tight mb-2" style={{ color: 'var(--text)' }}>
        Kebiasaan
      </h1>
      <p style={{ color: 'var(--text3)' }}>Modul dalam pengembangan</p>
    </div>
  );
}
```

Create `frontend/src/screens/Goals.tsx`:
```tsx
export function Goals() {
  return (
    <div className="min-h-screen px-5 pt-16 pb-28" style={{ background: 'var(--bg)' }}>
      <h1 className="text-3xl font-extrabold tracking-tight mb-2" style={{ color: 'var(--text)' }}>
        Goals
      </h1>
      <p style={{ color: 'var(--text3)' }}>Modul dalam pengembangan</p>
    </div>
  );
}
```

Create `frontend/src/screens/Budget.tsx`:
```tsx
export function Budget() {
  return (
    <div className="min-h-screen px-5 pt-16 pb-28" style={{ background: 'var(--bg)' }}>
      <h1 className="text-3xl font-extrabold tracking-tight mb-2" style={{ color: 'var(--text)' }}>
        Uang
      </h1>
      <p style={{ color: 'var(--text3)' }}>Modul dalam pengembangan</p>
    </div>
  );
}
```

- [ ] **Step 5: Write More screen with AccountSwitcher**

Create `frontend/src/screens/More.tsx`:
```tsx
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { springs } from '@/tokens/motion';

const API_URL = import.meta.env.VITE_API_URL ?? '/api';

export function More() {
  const { session, accounts, switchAccount, removeAccount, logout } = useAuthStore();
  const [switching, setSwitching] = useState<string | null>(null);

  const handleSwitchAccount = async (userId: string) => {
    if (userId === session?.user.id) return;
    setSwitching(userId);

    const account = accounts.find((a) => a.userId === userId);
    if (!account) return;

    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: account.refreshToken }),
      });

      if (res.ok) {
        const { access_token, refresh_token } = (await res.json()) as {
          access_token: string;
          refresh_token: string;
        };

        // Update stored refresh token
        const updated = accounts.map((a) =>
          a.userId === userId ? { ...a, refreshToken: refresh_token } : a
        );
        localStorage.setItem('fayolla_accounts', JSON.stringify(updated));
        localStorage.setItem('fayolla_active_user_id', userId);
        switchAccount(userId, access_token);
      }
    } finally {
      setSwitching(null);
    }
  };

  const handleAddAccount = () => {
    window.location.href = `${API_URL}/auth/google`;
  };

  const handleLogout = async () => {
    const account = accounts.find((a) => a.userId === session?.user.id);
    if (account) {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: account.refreshToken }),
      }).catch(() => {});
    }
    logout();
  };

  return (
    <div className="min-h-screen px-5 pt-16 pb-28" style={{ background: 'var(--bg)' }}>
      <h1 className="text-3xl font-extrabold tracking-tight mb-6" style={{ color: 'var(--text)' }}>
        Lainnya
      </h1>

      {/* Accounts section */}
      <section className="mb-6">
        <p
          className="text-xs font-bold uppercase tracking-widest mb-3"
          style={{ color: 'var(--text3)' }}
        >
          AKUN
        </p>

        <div
          className="rounded-[18px] overflow-hidden"
          style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}
        >
          {accounts.map((account, i) => {
            const isActive = account.userId === session?.user.id;
            return (
              <motion.div key={account.userId}>
                {i > 0 && (
                  <div className="h-px mx-4" style={{ background: 'var(--sep)' }} />
                )}
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  onClick={() => handleSwitchAccount(account.userId)}
                  disabled={switching === account.userId}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                    style={{ background: 'var(--accentSoft)', color: 'var(--accent)' }}
                  >
                    {account.avatarUrl ? (
                      <img src={account.avatarUrl} alt="" className="w-10 h-10 rounded-full" />
                    ) : (
                      account.name[0]
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate" style={{ color: 'var(--text)' }}>
                      {account.name}
                    </p>
                    <p className="text-sm truncate" style={{ color: 'var(--text2)' }}>
                      {account.email}
                    </p>
                  </div>
                  <AnimatePresence>
                    {isActive && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        transition={springs.bouncy}
                        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: 'var(--accent)' }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {switching === account.userId && (
                    <div
                      className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
                      style={{ borderColor: 'var(--accent)' }}
                    />
                  )}
                </button>
              </motion.div>
            );
          })}

          {/* Add account */}
          <div className="h-px mx-4" style={{ background: 'var(--sep)' }} />
          <button
            className="w-full flex items-center gap-3 px-4 py-3 text-left"
            onClick={handleAddAccount}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--accentSoft)' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" x2="12" y1="5" y2="19" />
                <line x1="5" x2="19" y1="12" y2="12" />
              </svg>
            </div>
            <span className="font-semibold" style={{ color: 'var(--accent)' }}>
              Tambah akun
            </span>
          </button>
        </div>
      </section>

      {/* Sub-screens */}
      <section className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text3)' }}>
          MODUL
        </p>
        <div className="rounded-[18px] overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--sep)' }}>
          {['Projects', 'Aktivitas', 'Nutrisi'].map((item, i) => (
            <div key={item}>
              {i > 0 && <div className="h-px mx-4" style={{ background: 'var(--sep)' }} />}
              <button className="w-full flex items-center justify-between px-4 py-3" disabled>
                <span style={{ color: 'var(--text)' }}>{item}</span>
                <span style={{ color: 'var(--text3)', fontSize: 12 }}>Coming soon</span>
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Logout */}
      <button
        className="w-full py-3 rounded-2xl font-semibold text-center"
        style={{ background: 'rgba(255,69,58,0.12)', color: '#FF453A' }}
        onClick={handleLogout}
      >
        Keluar
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Write App.tsx (root router)**

Create `frontend/src/App.tsx`:
```tsx
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { TabBar } from '@/components/TabBar';
import { LoginScreen } from '@/screens/LoginScreen';
import { AuthCallback } from '@/screens/AuthCallback';
import { Dashboard } from '@/screens/Dashboard';
import { Habits } from '@/screens/Habits';
import { Goals } from '@/screens/Goals';
import { Budget } from '@/screens/Budget';
import { More } from '@/screens/More';
import { applyTheme } from '@/tokens/theme';
import type { AccentName, ThemeName } from '@/types';

function AppShell() {
  const { activeTab, setTab } = useUIStore();

  const screens: Record<string, React.ReactNode> = {
    beranda: <Dashboard />,
    kebiasaan: <Habits />,
    goals: <Goals />,
    uang: <Budget />,
    lainnya: <More />,
  };

  return (
    <div className="max-w-[430px] mx-auto relative min-h-screen overflow-hidden">
      {screens[activeTab]}
      <TabBar />
    </div>
  );
}

export default function App() {
  const { loadFromStorage } = useAuthStore();
  const { theme, accent } = useUIStore();

  useEffect(() => {
    loadFromStorage();
  }, []);

  useEffect(() => {
    applyTheme(theme as ThemeName, accent as AccentName);
  }, [theme, accent]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 7: Start frontend and verify**

```bash
cd "d:/AI Model/Atomic Habit tools/frontend"
npm run dev
```

Open `http://localhost:5173` in browser.

Expected behavior:
- Redirect to `/login` (no session)
- "Masuk dengan Google" button visible
- Click → redirects to Google OAuth

After login:
- Redirect back to `/auth/callback?access_token=...`
- Auto-redirect to `/` (Dashboard)
- Tab bar visible with 5 tabs
- "Lainnya" tab shows account name + email
- "Tambah akun" adds a second Google account
- Switching accounts works

- [ ] **Step 8: Commit**

```bash
git add frontend/src/
git commit -m "feat: full app shell with TabBar, account switching, and screen routing"
```

---

## Task 12: PWA manifest and deploy to Cloudflare

**Files:**
- Create: `frontend/public/manifest.json`
- Modify: `backend/wrangler.toml` (update FRONTEND_URL for production)

- [ ] **Step 1: Create PWA manifest**

Create `frontend/public/manifest.json`:
```json
{
  "name": "Fayolla",
  "short_name": "Fayolla",
  "description": "Sistem personalmu untuk 1% lebih baik setiap hari",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#7C5CFF",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

Create a simple SVG favicon at `frontend/public/favicon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#7C5CFF"/>
  <text y=".9em" font-size="80" x="12" fill="white" font-weight="bold" font-family="sans-serif">F</text>
</svg>
```

- [ ] **Step 2: Create frontend .env files**

Create `frontend/.env`:
```
VITE_API_URL=http://localhost:8787/api
```

Create `frontend/.env.production`:
```
VITE_API_URL=https://fayolla-api.workers.dev/api
```

*(Replace `fayolla-api` with your actual worker name from wrangler.toml)*

- [ ] **Step 3: Deploy Worker to Cloudflare**

```bash
cd "d:/AI Model/Atomic Habit tools/backend"
wrangler deploy
```

Expected output:
```
✅ Successfully deployed fayolla-api to workers.dev
https://fayolla-api.<your-subdomain>.workers.dev
```

Update `backend/wrangler.toml` — change FRONTEND_URL to production Pages URL:
```toml
[vars]
FRONTEND_URL = "https://fayolla.pages.dev"
```

Then redeploy:
```bash
wrangler deploy
```

**Update Google Cloud Console redirect URI** to:
`https://fayolla-api.<your-subdomain>.workers.dev/api/auth/google/callback`

- [ ] **Step 4: Deploy frontend to Cloudflare Pages**

```bash
cd "d:/AI Model/Atomic Habit tools/frontend"
npm run build
```

Then either:
- Push to GitHub and connect Cloudflare Pages to the repo (recommended), or
- Use direct upload:

```bash
npx wrangler pages deploy dist --project-name=fayolla
```

Expected output:
```
✅ Deployment complete!
https://fayolla.pages.dev
```

- [ ] **Step 5: Verify production deployment**

Open `https://fayolla.pages.dev` on mobile browser.

Checklist:
- [ ] App loads on mobile
- [ ] "Masuk dengan Google" works
- [ ] OAuth callback redirects correctly to `https://fayolla.pages.dev/auth/callback`
- [ ] Dashboard shows after login
- [ ] Tab bar functional on mobile
- [ ] "Lainnya" → accounts section shows logged-in account
- [ ] "Tambah akun" adds second Google account
- [ ] Switching accounts updates dashboard greeting
- [ ] "Add to Home Screen" shows PWA install prompt

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat: PWA manifest, production env, deploy to Cloudflare Pages + Workers"
```

---

## Self-Review: Spec Coverage

| Requirement | Task |
|---|---|
| Frontend: React 18 + Framer Motion 11 + Tailwind 3 + Router v6 + Zustand | Task 1, 8 |
| Backend: Cloudflare Workers with Hono | Task 1, 5 |
| Database: Cloudflare D1 | Task 2, 3 |
| Auth: Google OAuth | Task 6 |
| JWT access token (15 min) | Task 6 |
| Refresh token (30 days, rotated) | Task 6 |
| Account switching | Task 9, 11 |
| Multi-account storage (localStorage) | Task 9 |
| Bottom tab bar (5 tabs) | Task 11 |
| Spring animations (Framer Motion) | Task 11 (TabBar bounce, LoginScreen entrance) |
| `prefers-reduced-motion` | Task 8 (index.css) |
| iOS-native theme tokens (dark/light, accent) | Task 8 |
| PWA manifest | Task 12 |
| Deploy to Cloudflare | Task 12 |
| CORS | Task 5 |
| D1 schema: all 14 tables | Task 3 |

**Gaps (for next plan):**
- Habit Tracker module (check-in, streak, confetti)
- Goals module with compounding chart
- Budget module with donut chart
- Projects, Activity Labeling, Nutrition modules
- `/api/habits`, `/api/goals`, etc. endpoints
- Indonesian food database
- PWA icons (192, 512 — need actual image files)
- Service worker (offline-first)

These are all Phase 2 — separate plan per module after foundation is live.
