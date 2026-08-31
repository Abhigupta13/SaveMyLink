# ALL you need — shared team brief

Every team agent reads this first. It is the *product* context; the code is the
source of truth for anything mechanical.

## What this is
A Next.js 16 / React 19 app (App Router, server actions, MongoDB via mongoose,
NextAuth) + a thin Capacitor Android shell that loads the deployed site in a
webview. Started as a personal link saver; it is becoming a **team work OS**:
capture → organise → assign → follow through, with meetings as a first-class input.

## Intent (do not drift from this)
Built for the owner's own use FIRST, but aimed at small teams doing project work.
The thesis: a team should be able to run projects, tasks and meeting follow-through
without a layer of middle management chasing people. The app is the chaser.
Slack/Google Workspace are the reference points for onboarding a whole team —
not the feature set to copy.

## What exists today
- **Auth**: NextAuth (credentials + Google), bcrypt, password reset over SMTP,
  a private-content PIN (`privatePin`) gated by a signed cookie (`lib/safeCookie`).
- **Links** (`/links`): saved URLs, categories with domain auto-filing, tags,
  favourites, private flag, OG metadata scrape, dead-link cron, bulk import.
- **Notes** (`/notes`): body + attachments (S3), pinning, text extraction (pdf-parse).
- **Tasks** (`/tasks`): due dates, assignee by email (survives unregistered users,
  claimed on first read), project link, local notifications on Android.
- **Projects** (`/projects`, `/projects/[id]`): `ownerId` + `memberEmails[]`.
  **projectId is the sharing boundary** — everything carrying one is shared.
  Owner-only delete; members create/edit. `lib/projectAccess.ts` is the gate.
- **MOM** (`/mom`): record a meeting → transcribe (Groq whisper free / Sarvam paid
  for Hindi-Hinglish, email-allowlisted) → Gemini summary → candidate tasks/notes/
  brief the user confirms.
- **Jarvis** (`JarvisWidget`): LLM assistant over the user's own data, voice input.
- **Digi Locker** (`/d-locker`): documents/files, private S3 behind `/api/files`.
- **Contacts, Weekly digest, Import, Feedback inbox** (`ADMIN_EMAILS`).

## Architecture facts worth knowing before proposing anything
- **Almost no REST API.** Only `/api/auth/[...nextauth]` and `/api/files/[...key]`.
  Everything else is a **server action** in `src/actions/*`. That is the trust
  boundary — auth + ownership checks live at the top of each action.
- `middleware.ts` gates every route except auth/static.
- Shared helpers already exist; use them, do not re-invent:
  `lib/projectAccess` (access), `lib/storage` (S3), `lib/llm` (Gemini),
  `lib/sarvam`, `lib/mailer`, `lib/validation`, `lib/isAdmin`, `lib/nav`
  (single source of truth for navigation — desktop rail, mobile bar, home grid).
- `AGENTS.md`: this Next.js version has breaking changes vs. training data —
  read `node_modules/next/dist/docs/` before writing framework-level code.
- Tailwind v4, lucide-react icons, no component library.

## Known open ground (not yet built)
Real-time messaging/threads, notifications beyond Android-local, team-level
(vs project-level) membership and roles, audit trail, billing, web push,
onboarding flow, admin/org concept, i18n.

## House rules
- Lazy-but-correct: reuse before writing, smallest diff that actually fixes the
  root cause. Never lazy about auth, ownership checks, validation, or a11y.
- Every change stays consistent with the existing patterns above.
