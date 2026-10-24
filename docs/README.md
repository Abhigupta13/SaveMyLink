# ALL YOU NEED — documentation

This folder is the current description of the product. The code is the source of truth. When they disagree, fix the doc in the same change.

**Product.** ALL YOU NEED (repo folder `AllYouNeed`, npm package `allyouneed`) is a personal vault and a small-team work tool. The product is the meeting-to-task loop: record a meeting, get a transcript and summary, confirm action items, then chase them until they are done. Links, notes, files, and Jarvis exist so people already use the app before a team meeting lands in it.

**Live web app.** `https://allyouneedvault.vercel.app`  
**Android application id.** `com.allyouneed.app`  
**Doc snapshot.** 24 October 2026

| Track | Where it lives | Current |
| --- | --- | --- |
| Web package | `package.json` `version` | `0.1.0` |
| Android shell | `android/app/build.gradle` and `src/lib/appRelease.ts` | versionName `1.3`, versionCode `4` |
| These docs | `docs/versions.md` | baseline 24 Oct 2026 |

The web app and the APK are not the same release. Almost every product change ships by redeploying the Next.js app. The APK is a thin shell (share sheet, notifications, native sign-in). Rebuild it only when `android/`, Capacitor plugins, or `capacitor.config.ts` change, then bump both Gradle and `LATEST` in `src/lib/appRelease.ts` together.

## What to read

| File | Covers |
| --- | --- |
| [features.md](features.md) | What a person can do, route by route |
| [tech.md](tech.md) | Stack, data, server actions, env names, deploy |
| [strategy.md](strategy.md) | Why the product exists and what not to copy |
| [business.md](business.md) | Who it is for, money, distribution, AI cost |
| [access.md](access.md) | Sign-in, project roles, Private Safe, admin, limits |
| [versions.md](versions.md) | What changed, dated |

## Keeping these current

Do this for every change that alters behavior, access, architecture, or the reason the product exists — whether the edit came from Cursor or Claude.

1. Update the matching file from the table above. One fact lives in one file. Link across; do not paste the same rule into three docs.
2. Add a dated bullet under **Unreleased** in [versions.md](versions.md). Do not invent a version number. Promote that list into a numbered release only when a version is actually bumped (`package.json`, or the Android pair).
3. An Android release must name the same `versionCode`, `versionName`, and user-facing notes as `android/app/build.gradle` and `src/lib/appRelease.ts`.
4. Never write secret values. Environment variable **names** only.
5. Skip the docs for comments, formatting, and refactors that do not change behavior.

Cursor loads [`.cursor/rules/docs-sync.mdc`](../.cursor/rules/docs-sync.mdc). Claude loads [`.claude/rules/docs-sync.md`](../.claude/rules/docs-sync.md). If you change the checklist, change both rules and this section together.

## Older notes — not the current spec

These files stay in the repo as history and ops notes. Where they disagree with `docs/` or the code, `docs/` and the code win.

| File | Use it for |
| --- | --- |
| `DECISION.md` | Why a choice was made, through 30 Aug 2026. Several rows still say "in build" for work that has since shipped (Private Safe on every personal type, Google Drive storage, native Google sign-in). |
| `ANDROID.md` | Android and Vercel incident log. |
| `README.md` | How to run the app. Its S3 section is stale: uploads go to the user's Google Drive. See [tech.md](tech.md). |
| `.claude/TEAM_BRIEF.md` | Short brief for specialist agents. It still mentions S3 and `middleware.ts`. |
