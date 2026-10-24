# Versions

Two product versions, plus this log.

| Track | Bump when | Source of truth |
| --- | --- | --- |
| Web | You intentionally cut a web release | `package.json` `version` (now `0.1.0`) |
| Android | Native shell, plugins, or `capacitor.config.ts` change and you ship an APK | `versionCode` / `versionName` in `android/app/build.gradle`, mirrored in `src/lib/appRelease.ts` (now `5` / `1.4`) |
| Docs | Any behavior, access, architecture, or strategy change | A bullet under Unreleased, below |

Web deploys do not bump the Android version. People already on 1.3 receive server and UI changes the moment Vercel finishes. They only need a new APK when the shell itself changes. The in-app banner compares `versionCode`, not the version name.

## How to record a change

Add bullets under **Unreleased** in the same change as the code. Present tense, one line, name the doc you updated. Do not mint a version number here.

When you actually bump `package.json` or the Android pair, move the relevant Unreleased bullets into a new section headed by that version and the date. Android notes in that section must match the `notes` array in `src/lib/appRelease.ts`, which is what the person installing the APK reads.

## Unreleased

- 24 Oct 2026 — Notes: divider and table in the editor; Jarvis builds checklists (with dividers), tables, and dividers in note bodies. Updated `docs/features.md`.
- 24 Oct 2026 — Notes checklists behave like Google Keep: boxes on the grid, tick in read view, strikethrough when done, Enter adds a row in edit. Updated `docs/features.md`.
- 24 Oct 2026 — Android Save from SMS (`/sms-inbox`): optional classic SMS inbox, pick messages to save as notes, tasks, or expenses. Updated `docs/features.md`, `docs/access.md`, and `docs/tech.md`.
- 24 Oct 2026 — Note formatting tools keep bold, lists, color, and checklist ticks, including after a phone tap. Updated `docs/features.md`.
- 24 Oct 2026 — Android app id and deep-link scheme are now `com.allyouneed.app` (removed `com.swaraj` segment). Updated `docs/tech.md` and `docs/README.md`.
- 24 Oct 2026 — Renamed SaveMyLink references to AllYouNeed. Updated `docs/tech.md` and `docs/README.md`.
- 24 Oct 2026 — Admins can read the product docs in the app at `/admin/docs`. Updated `docs/features.md` and `docs/access.md`.
- 24 Oct 2026 — Notes open in read view with optional edit; group, privacy, and card color live in a note options sheet. Updated `docs/features.md`.
- 24 Oct 2026 — Documentation baseline. Added `docs/` (features, tech, strategy, business, access, this log) and the Cursor and Claude rules that keep it current. No product behavior change.

## Android 1.3 (versionCode 4)

Shipped in the app as the published APK. User-facing notes from `src/lib/appRelease.ts`:

- Sign in with Google without leaving the app.
- Downloads and shared links open properly instead of doing nothing.
- Reminders ask for permission again if you said no the first time.
- Installing over an older copy no longer fails.

## Web 0.1.0

npm version as of the 24 Oct 2026 doc baseline. There is no older changelog in the repo. Product history before this file is the narrative in `DECISION.md` (last updated 30 Aug 2026) and the ops log in `ANDROID.md`.

Known drift at the baseline, recorded so the next edit does not "fix" the docs back to the stale story:

- `README.md` still documents S3. Uploads go to Google Drive.
- `.claude/TEAM_BRIEF.md` still says S3, `middleware.ts`, and a smaller API surface.
- `DECISION.md` still marks Private Safe-everywhere and the Drive move as in build. Both are in the code. Chat-attachment bytes left behind in Drive on project delete were still an open leak on 30 Aug 2026; check `src/lib/projectContent.ts` before calling that fixed.
- `DECISION.md` says Google sign-in inside the Android app is broken. version 1.3 shipped Custom Tab sign-in.
