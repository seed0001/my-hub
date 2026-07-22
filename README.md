# my-hub

A personal command center — your projects, bookmarks, and a built-in AI assistant, all in one place. Built with Next.js, Postgres, and OpenRouter. Designed to deploy on [Railway](https://railway.app).

## Features

- **Accounts** — email/password login with secure session cookies (bcrypt + signed JWT).
- **Projects** — track everything you're building: status (Idea → Planning → Active → Paused → Done → Archived), descriptions, live/repo links, pinning, and a running feed of status updates per project.
- **Bookmarks** — save web addresses with titles, categories, tags, notes, and auto-fetched favicons. Search and filter instantly.
- **AI assistant** — a chat panel powered by OpenRouter that *sees your projects and bookmarks* and helps you plan, summarize status, and stay organized. Conversation history is saved.

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL via Prisma |
| Auth | bcryptjs + `jose` (JWT) session cookies |
| AI | OpenRouter (OpenAI-compatible, streaming) |

---

## Environment variables

Copy `.env.example` to `.env` for local dev, and set these in Railway for production:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string. On Railway, reference the Postgres plugin (see below). |
| `AUTH_SECRET` | ✅ | Long random string for signing sessions. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `OPENROUTER_API_KEY` | ✅ (for AI) | Get one at https://openrouter.ai/keys |
| `OPENROUTER_MODEL` | ⬜ | Model slug, e.g. `anthropic/claude-3.5-sonnet` (default) or `openai/gpt-4o-mini`. Browse https://openrouter.ai/models |
| `APP_URL` | ⬜ | Your public URL, used for OpenRouter attribution headers. |

---

## Deploy on Railway

1. **Create a project** → *Deploy from GitHub repo* → pick `seed0001/my-hub`.
2. **Add a database:** in the project, click *New → Database → Add PostgreSQL*. Railway provisions it and exposes a `DATABASE_URL`.
3. **Wire the database URL:** open the app service → *Variables* → add `DATABASE_URL` with value `${{ Postgres.DATABASE_URL }}` (Railway's reference syntax so it always points at the DB plugin).
4. **Add the rest of the variables** (`AUTH_SECRET`, `OPENROUTER_API_KEY`, optionally `OPENROUTER_MODEL`, `APP_URL`).
5. **Deploy.** Railway runs `npm run build`, then `npm run start`. On start, the app runs `prisma db push` to sync the schema to the database automatically — no manual migration step needed the first time.
6. **Generate a domain:** app service → *Settings → Networking → Generate Domain*. Set `APP_URL` to that URL.
7. Visit the domain, click **Register**, and create your account.

> The schema is synced with `prisma db push` on every boot. It's additive and safe for a single-user hub. If you later want versioned migrations, switch to `prisma migrate`.

---

## Local development

```bash
# 1. Install deps
npm install

# 2. Set up env
cp .env.example .env
# edit .env — point DATABASE_URL at a local or Railway Postgres, set AUTH_SECRET + OPENROUTER_API_KEY

# 3. Push schema to your database
npm run db:push

# 4. Run
npm run dev
```

Open http://localhost:3000 and register an account.

Useful scripts:

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run db:push` — sync Prisma schema to the DB
- `npm run db:studio` — open Prisma Studio to inspect data

---

## Project structure

```
src/
  app/
    api/            # route handlers: auth, projects, bookmarks, chat
    login/          # login page
    register/       # register page
    page.tsx        # dashboard (server component, loads data)
    layout.tsx
    globals.css
  components/        # Dashboard, Projects, Bookmarks, ChatPanel, Modal, AuthForm
  lib/
    auth.ts         # session cookie + JWT helpers
    db.ts           # Prisma client singleton
    openrouter.ts   # AI streaming client
    types.ts        # shared DTO types
  middleware.ts     # protects pages, redirects guests to /login
prisma/
  schema.prisma     # User, Project, ProjectUpdate, Bookmark, ChatMessage
```
