---
name: run-dev-local
description: Starts the AllYouNeed (ALL you need) Next.js dev server and returns the local URL. Use when the user asks to run the app locally, start dev, open localhost, or get the local development URL.
---

# Run app locally

## Command

From the repository root:

```bash
npm run dev
```

This runs `scripts/dev-safe.js`, which clears `.next` (with retries) then starts `next dev --webpack -H 0.0.0.0`.

Default URL: **http://localhost:3000** (matches `NEXTAUTH_URL` in local dev per `docs/tech.md`).

## Workflow

1. **Already running?** Check the terminals folder for an active `npm run dev` / `next dev`. If the server is up, skip starting another instance.
2. **Dependencies:** If `node_modules` is missing, run `npm install` once, then `npm run dev`.
3. **Start:** Run `npm run dev` with `block_until_ms: 0` (background). Working directory = repo root.
4. **Wait for ready:** Poll terminal output until you see Next.js ready (e.g. `Ready` / `Local:`) or confirm `http://localhost:3000` responds. Allow up to ~60s on first compile.
5. **Reply to the user:** Output **only** the URL on its own line, nothing else:

```
http://localhost:3000
```

If the server binds a different port (shown in terminal output), use that URL instead.

## Do not

- Do not use `npm run start` for local development (`start` is production after `build`).
- Do not paste long dev-server logs unless startup failed; then give a one-line error and the fix (e.g. install deps, free port 3000).
