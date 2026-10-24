# Rules and access

Snapshot: 24 October 2026. Permission rules live in `src/lib/scope.ts` (pure, no database) and `src/lib/projectAccess.ts` (loads the project, then calls those rules). Do not reimplement the checks inside an action. `scripts/self-check.mjs` asserts the pure rules.

Privacy of personal rows: `src/lib/privacy.ts`. Shared-versus-mine labelling: `src/lib/visibility.ts`.

## Who can open a page

`src/proxy.ts` requires a session except:

| Public | Why |
| --- | --- |
| `/` | Landing page |
| `/auth/*` | Sign-in, sign-up, reset, native handoff |
| `/terms` | Linked before an account exists |
| `/download` | The APK must be reachable before login |
| `/suspended` | The person who needs it has just been refused a session |
| `/api/auth/*` | NextAuth and native handoff |
| `/api/drive/*` | Custom Tab has no session cookie. Each handler still checks a session or a signed token |
| Files with an extension, `_next/static`, `_next/image` | Icons, the APK, Next assets |

`/api/files` stays behind the session. It also checks that the caller may read that storage key.

Everything else, including `/admin`, `/admin/docs`, and `/your-data`, requires a session. Admin is a second check inside the page and the actions.

## Sign-in

| Provider | When |
| --- | --- |
| Email and password | Always. Passwords are bcrypt hashes |
| Google | When `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. Google accounts count as email-verified |
| `native-handoff` | Android only, after the Custom Tab. Not a button |

A `suspendedAt` stamp blocks sign-in and sends the person to `/suspended`.

Email verification (6-digit code, 10 minutes, 5 attempts) is required to **join other people's projects**, not to sign in and not to use projects you created. `ownerId` is a user id, so it was never claimable by typing an address. `memberEmails`, `viewerEmails`, and `ownerEmails` are ignored until `emailVerified` is set. A password reset counts as verification. An unverified account at an address is replaced by a later signup that proves the inbox.

## Project roles

Membership is an email string on the project, plus `ownerId` for the creator.

| Role | Stored as | Can |
| --- | --- | --- |
| Creator | `ownerId` | Everything an owner can. Cannot be demoted or removed. The only person who can delete the project |
| Co-owner | `ownerEmails` | Owner actions except delete-project. Must already be a member before promotion. Any owner may promote |
| Member | `memberEmails` | Read and write. Not member admin |
| Viewer | `viewerEmails` | Read. May post in chat (`canChat`). Cannot edit tasks, notes, or meetings |

If someone is on two lists, the higher power wins. A viewer who is also a member stays a member.

Unverified email: you still see projects you created. You do not see projects that listed your address.

Personal record (no `projectId`): only the `userId` on the row. A missing project is not a missing check.

**Offboarding.** Removing a member strips them from that group's tasks. The task, due date, author, and history stay. If no assignee remains, the task appears in **Needs an owner**. Account deletion uses the same function.

**Tasks.** Any assignee may mark complete. An owner signs off. Sign-off requires completed. Clearing complete clears sign-off.

**Viewers and tasks.** A viewer can still be named on a task they are not allowed to complete. That case is known and not yet decided (`DECISION.md`). Do not treat it as intended product.

**Chat** is the one write a viewer has. Reversing it is `canChat` in `src/lib/scope.ts`, not a change to `canWrite`.

**First share.** The first time you file something into a project, the app asks you to confirm who can see it (`src/actions/visibility.ts`).

## Private Safe

A 4-digit PIN on the user. It hides and shows **personal** private rows (links, categories, notes, tasks, meetings, documents, contacts, expenses). It is not encryption. `/terms` says the operator can read stored content, including the safe.

Rules in `src/lib/privacy.ts`:

- A row with a `projectId` cannot be private. A padlock teammates could open would be believed and would be false.
- Locking the safe swaps the personal vault. It does not hide group work.
- Jarvis, while locked, sees none of the private personal content. While unlocked, it can see it. Jarvis adds private rows when unlocked; it does not swap the way the lists do.

PIN check: 5 failures, then 15 minutes (`src/lib/pinLock.ts`). A correct PIN sets an HMAC cookie for 12 hours.

## Admin

`/admin` and the admin actions require `isAdmin` (`src/lib/isAdmin.ts`).

- Default allowlist is the two founder addresses in that file, so a deploy with no env still lets them in.
- `ADMIN_EMAILS` replaces the default entirely. An empty value means nobody. It does not fall back.

Powers: usage counts, meeting funnel, date range, feedback list, grant or revoke Sarvam access, suspend or unsuspend, delete a user (same erase path as self-serve delete). The screen does not show titles, bodies, or transcripts.

`/admin/docs` uses the same admin check, then reads the markdown in `docs/`. A signed-in non-admin gets not found. It is not in the public nav. The URL may only name a slug from `src/lib/productDocs.ts`; the filename is never taken from the request.

## Sarvam access

Resolved in this order (`src/lib/sarvamAccess.ts`):

1. The user's own key, saved from Profile, sealed at rest, billed to them by Sarvam.
2. An admin grant (`sarvamAccess` on the user). Spends `SARVAM_API_KEY`.
3. Deprecated `SARVAM_ENABLED_EMAILS`.
4. None. Transcription stays on Gemini audio, then Whisper.

## Limits

| Limit | Value | Where |
| --- | --- | --- |
| Jarvis questions | 5 per user per local calendar day. Admins exempt | `src/lib/jarvisLimit.ts` |
| Shared Gemini pool | One founder key for every user. Empty pool returns a specific message | `src/lib/llm.ts` |
| Email code | 5 attempts, 10-minute life | `src/lib/otp.ts` |
| PIN | 5 attempts, then 15 minutes | `src/lib/pinLock.ts` |
| Ordinary upload | 4MB | `src/lib/storage.ts` |
| Meeting audio action | 30MB body limit | `next.config.ts` |

There is no feature-flag service. Per-user switches that exist: `jarvisConfirmShared`, intro and tour flags, `shareNoticeSeen`, admin Sarvam grant, suspension.

## Android SMS (Save from SMS)

- **Who:** Signed-in user on the native APK only. The website cannot read SMS.
- **When:** Only after the user opens `/sms-inbox` (linked from Profile in the app) and grants `READ_SMS` / `RECEIVE_SMS` at runtime.
- **What leaves the phone:** Nothing until the user saves a chosen message as a note, task, or expense through the review sheet. No full inbox sync to MongoDB.
- **What is not read:** RCS / Google Messages chat threads that are not stored as classic SMS in the Telephony provider.
- **Fallback:** Share plain text from another app to `/capture` (no SMS permission).
- **Local state:** Saved message ids are kept on device (`@capacitor/preferences`) to hide rows already filed into the vault.

## Account deletion

Self-serve on Profile, or admin delete. Requires re-auth and the PIN if one is set.

Removed: links, notes, tasks, meetings, documents, contacts, PIN, Sarvam key, and the user's files from app access. Groups they created are handed to the oldest co-owner, otherwise the oldest member is promoted, otherwise the group is deleted after a warning.

Kept 90 days, then purged: name, email, and the role captured on the delete screen. `/terms` states this.
