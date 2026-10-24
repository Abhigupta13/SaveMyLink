---
description: Update docs/ when behavior, access, architecture, or strategy changes
---

# Keep docs/ current

`docs/` is the current description of ALL YOU NEED. The code wins if they disagree — then fix the doc in the same change. This applies to edits from Cursor and from Claude.

When a change alters what the app does, who can do it, how it is built, or why it exists:

1. Update the one matching file. Do not copy the same fact into a second doc.
2. Add a dated bullet under **Unreleased** in `docs/versions.md`. Do not invent a version number.
3. If you ship an Android APK, that note must match `android/app/build.gradle` and `src/lib/appRelease.ts` (`versionCode`, `versionName`, and the user-facing `notes`).
4. If you change this checklist, change `.cursor/rules/docs-sync.mdc` and the "Keeping these current" section of `docs/README.md` in the same edit.

| Change | File |
| --- | --- |
| Features, routes, user flows | `docs/features.md` |
| Stack, models, actions, env names, deploy | `docs/tech.md` |
| Positioning, wedge, what not to build | `docs/strategy.md` |
| Audience, pricing, distribution, AI cost | `docs/business.md` |
| Auth, roles, PIN, admin, limits, public routes | `docs/access.md` |

Skip docs for comments, formatting, and refactors that do not change behavior.

Never write secret values. Environment variable names only.

`README.md`, `DECISION.md`, `ANDROID.md`, and `.claude/TEAM_BRIEF.md` are history and ops notes, not the current spec. Do not rewrite them to match a feature change. If a sentence there would send the next session the wrong way, add a one-line pointer at `docs/` instead.

```markdown
<!-- versions.md -->
## Unreleased

- 24 Oct 2026 — Project chat no longer accepts file attachments. Updated `docs/features.md`.
```
