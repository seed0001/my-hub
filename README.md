# my-hub

A phone-first **personal command center** with a built-in **agentic AI assistant** that acts as your planner and build architect. Track everything you're making, let the assistant turn ideas into roadmaps and copy-paste-ready build prompts, and stay on top of it all with reminders, focus sessions, and long-term memory. Installs to your home screen as a PWA. Built with Next.js, Postgres, and OpenRouter; designed to deploy on [Railway](https://railway.app).

---

## What it is

my-hub is a single-screen "hub" you run from your phone. It has two halves that work together:

1. **A workspace** — your projects, documents, bookmarks, reminders, and focus timer.
2. **An AI assistant** that can *see and act on* that entire workspace. It's a real agent: it calls tools to create and edit your data, search the web, remember things about you, and schedule notifications — not just a chat box.

The assistant's signature job is the **build pipeline**: you talk an idea through with it, it produces a structured **roadmap**, and then it writes **build prompts** — complete, self-contained instruction documents you hand off to a separate coding agent (e.g. Claude Code) to actually write the code. The assistant plans and architects; it never writes application code itself.

---

## Features

### 📱 Phone-first PWA
- Installable to the home screen, runs standalone (full-screen, no browser chrome), dark UI tuned for a phone.
- A five-tab bottom bar: **Today · Assistant · Projects · Docs · Bookmarks**.
- Tolerant of flaky connections — data refetches on demand and reminders keep polling when offline.

### 🤖 Agentic AI assistant
- Powered by OpenRouter (any model slug — Claude, GPT, etc.), with **streaming** replies.
- A true tool-calling agent loop: it can take multiple rounds of actions per message, showing an action chip for each thing it does, then refreshing the affected parts of your hub live.
- Every reply is grounded in your full hub state — projects, docs, bookmarks, reminders, focus status, memories, and your profile are all fed in as context.
- Conversation history is saved; you can also have replies **read aloud** (see Voice).

### 🧭 The build pipeline — roadmaps & build prompts
- **Roadmaps**: the assistant breaks an idea into phases and milestones as a checklist artifact (`- [ ]` tasks it can tick off over time).
- **Build prompts** (`kind: prompt`): the core deliverable — complete, standalone instructions structured as **Objective · Context · Requirements · Constraints · Acceptance criteria**, written to be copy-pasted straight to a coding agent that can't see your hub.
- The assistant works one phase/feature at a time rather than dumping everything into one prompt, and it edits documents with **targeted find/replace** instead of rewriting them wholesale.

### 📁 Projects
- Track everything you're building: status (**Idea → Planning → Active → Paused → Done → Archived**), description, live-site and repo links, an accent color, and pinning.
- Each project has a **running update feed** — a timeline of status notes you or the assistant post.

### 📄 Docs (Artifacts)
- A catalog of markdown documents — roadmaps, specs, notes, and build prompts — each with a friendly sequential ID (`A-12`).
- The assistant can create, read, edit (find/replace or append), and delete them, and attach them to a project.

### ⏰ Reminders & push notifications
- Schedule reminders by absolute time or "in N minutes," optionally tied to a project.
- A **background dispatcher** delivers due reminders as **web-push notifications** (even when the app is closed) when VAPID keys are configured.
- Without push set up, an **in-app poller** surfaces due reminders as banners every 30s, so the phone still buzzes while the app is open.

### 🎯 Focus sessions
- Start a timed work block on a project; it auto-schedules a "time's up" reminder.
- Projects rotate on a **round-robin** — the reminder names which in-motion project is next up, so you touch everything over a day/week.

### 🔖 Bookmarks
- Save links with titles, categories, tags, notes, and auto-fetched favicons. Search and filter instantly.

### 🧠 Long-term memory & living profile
- The assistant **silently learns** durable facts about you (where you live, your tools, habits, decisions) and saves them to memory as you chat.
- It maintains a **living profile document** — an organized markdown bio (About, Location, Work & projects, Interests & hobbies, Preferences & working style) — kept current with targeted edits. View it from the profile sheet.

### 🌐 Web access
- The assistant can **search the web** (DuckDuckGo, no API key needed) and **fetch a page** to read its text before answering, citing sources.

### 🔊 Voice
- Assistant replies can be spoken aloud via **Microsoft Edge's free TTS** (default voice `en-US-AndrewMultilingualNeural`), with markdown cleaned up for natural listening.

### 🔐 Accounts
- Email/password login with bcrypt-hashed passwords and signed-JWT session cookies. Every piece of data is scoped to the signed-in user, and middleware protects all pages.

---

## The assistant's toolbox

Under the hood the agent has these tools (all scoped to the current user):

| Area | Tools |
|---|---|
| Projects | `create_project`, `update_project`, `delete_project`, `add_project_update` |
| Docs | `create_artifact`, `read_artifact`, `edit_artifact`, `delete_artifact` |
| Bookmarks | `create_bookmark`, `update_bookmark`, `delete_bookmark` |
| Reminders | `create_reminder`, `update_reminder` |
| Focus | `start_focus_session`, `get_focus_state` |
| Memory & profile | `save_memory`, `forget_memory`, `update_profile` |
| Web | `web_search`, `fetch_webpage` |

---

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL via Prisma 6 |
| Auth | bcryptjs + `jose` (JWT session cookies) |
| AI | OpenRouter (OpenAI-compatible, streaming, tool-calling) |
| Web push | `web-push` (VAPID) + a boot-time background dispatcher |
| Voice | `msedge-tts` (Microsoft Edge free TTS) |
| PWA | Web app manifest + service worker notifications |

---

## Environment variables

Copy `.env.example` to `.env` for local dev, and set these in Railway for production:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string. On Railway, reference the Postgres plugin: `${{ Postgres.DATABASE_URL }}`. |
| `AUTH_SECRET` | ✅ | Long random string for signing sessions. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `OPENROUTER_API_KEY` | ✅ (for AI) | Get one at https://openrouter.ai/keys |
| `OPENROUTER_MODEL` | ⬜ | Model slug, e.g. `anthropic/claude-3.5-sonnet` (default) or `openai/gpt-4o-mini`. Browse https://openrouter.ai/models |
| `APP_URL` | ⬜ | Your public URL, used for OpenRouter attribution headers. |
| `VAPID_PUBLIC_KEY` | ⬜ | Web-push public key for reminder notifications. Generate: `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | ⬜ | Web-push private key (keep secret). |
| `VAPID_SUBJECT` | ⬜ | Contact for push, e.g. `mailto:you@example.com`. |
| `TTS_VOICE` | ⬜ | Edge TTS voice for spoken replies (default `en-US-AndrewMultilingualNeural`). |

> Push notifications and voice are optional — the app runs fine without them. If VAPID keys are absent, reminders still surface in-app; if `TTS_VOICE` is unset, the default voice is used.

---

## Deploy on Railway

1. **Create a project** → *Deploy from GitHub repo* → pick `seed0001/my-hub`.
2. **Add a database:** in the project, click *New → Database → Add PostgreSQL*.
3. **Wire the database URL:** open the app service → *Variables* → add `DATABASE_URL` = `${{ Postgres.DATABASE_URL }}`.
4. **Add the rest of the variables** (`AUTH_SECRET`, `OPENROUTER_API_KEY`, optionally `OPENROUTER_MODEL`, `APP_URL`, VAPID keys, `TTS_VOICE`).
5. **Deploy.** Railway runs `npm run build`, then `npm run start`. On start, the app runs `prisma db push` to sync the schema automatically — no manual migration step.
6. **Generate a domain:** app service → *Settings → Networking → Generate Domain*. Set `APP_URL` to that URL.
7. Visit the domain, click **Register**, and create your account. On your phone, use the browser's *Add to Home Screen* to install it.

> The schema is synced with `prisma db push` on every boot (`start` uses `--accept-data-loss`; it's additive and safe here). If you later want versioned migrations, switch to `prisma migrate`.

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
    api/
      auth/          # register, login, logout
      projects/      # projects + per-project status updates
      bookmarks/     # bookmarks CRUD
      artifacts/     # documents (roadmaps, specs, notes, build prompts)
      reminders/     # reminders CRUD + due polling
      focus/         # focus session state
      memories/      # long-term memory CRUD
      profile/       # living user profile
      push/          # VAPID key + push subscription
      chat/          # the agent loop (streaming, tool-calling)
      tts/           # text-to-speech (Edge TTS)
    login/  register/ # auth pages
    page.tsx          # dashboard (server component, loads all data)
    manifest.ts       # PWA manifest
    layout.tsx  globals.css
  components/          # Dashboard, Today, ChatPanel, Projects, Artifacts,
                       # Bookmarks, ProfileSheet, Modal, AuthForm
  lib/
    agentTools.ts     # tool definitions + executor (the assistant's "hands")
    openrouter.ts     # streaming + SSE tool-call parsing
    webSearch.ts      # DuckDuckGo search + page fetch
    reminderDispatcher.ts # background web-push loop (started from instrumentation)
    tts.ts  speechText.ts # voice synthesis + markdown-to-speech cleanup
    push.ts  pushClient.ts # web-push server + client subscription
    auth.ts  db.ts  time.ts  types.ts
  instrumentation.ts  # boots the reminder dispatcher on server start
  middleware.ts       # protects pages, redirects guests to /login
prisma/
  schema.prisma       # User, Project, ProjectUpdate, Bookmark, Artifact,
                       # Reminder, FocusSession, Memory, UserProfile,
                       # PushSubscription, ChatMessage
```
