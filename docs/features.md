# Features

Snapshot: 24 October 2026. Routes live under `src/app/`. Almost every mutation is a server action in `src/actions/`, not a REST endpoint.

Signed-out visitors see the landing page. Signed-in people land on Home. Global chrome (`src/app/layout.tsx`) includes the top nav, Jarvis, the spotlight tour, Android listeners (share intent, native auth, back button, network gate, reminders), and the Drive-connect result.

## Home and onboarding

- **Landing** (`/`, signed out). Pitch on the page: "Record everything. Chase nobody." Tabs walk Meetings, Tasks, Jarvis, Save anything, and Project groups. Loop shown: record, read the room, confirm, chase. Copy lives in `src/components/LandingPage.tsx`.
- **Home** (`/`, signed in). Vault tiles, Getting Started checklist (`src/lib/intro.ts`), punctuality score, a short weekly digest, notifications, and an update banner when the installed APK is behind `src/lib/appRelease.ts`.
- **Spotlight tour** (`src/components/Tour.tsx`). MOM-first. Can be started from `/your-data`.
- **Sample meeting.** Offered to a new account, never created unasked (`src/actions/intro.ts`).

## Capture

- **Links** (`/links`). Save a URL, auto-file by domain into a category, tags, favourites, private flag, Open Graph title and image, dead-link flag. Dead links are marked by `scripts/check-dead-links.js` (intended weekly cron).
- **Import** (`/import`). Paste or CSV of URLs.
- **Android share sheet.** A share from another app opens `/links?add=1&url=…`, or stashes the URL until sign-in (`src/lib/shareIntent.ts`).
- **Capture** (`/capture`). A URL redirects into add-link. Anything else opens a quick note.
- **Save from SMS** (`/sms-inbox`, Android app only). After optional `READ_SMS` consent, lists classic SMS on the device (not RCS chat). Multi-select, then save each as a note, task, or expense. SMS text is not stored on the server until you confirm. Profile links here when running in the APK. Denied permission: share one message from Google Messages via the existing share sheet to `/capture`.
- **Search** (`/search`). One search across the person's own records and the groups they can see. Shared hits are labelled as shared.
- **Digest** (`/digest`, and a short copy on Home). "Needs attention" and "saved this week". Both screens use `src/lib/digest.ts` and `DigestSections.tsx` so they cannot drift apart.

## Meetings (the product)

`/mom` and the recorder inside a project workspace.

1. Record or upload audio.
2. Transcribe. Order: the user's Sarvam key or an admin grant (paid Hindi/Hinglish) when that path is available; otherwise Gemini audio; Groq Whisper as the floor. See [access.md](access.md) for who gets Sarvam.
3. Gemini writes a summary and candidate tasks and notes.
4. The person confirms. Nothing becomes a real task until they do.
5. Confirmed tasks and notes keep a `momId`. Deleting a meeting shows what it produced and defaults to keeping that work.

Engineering rule from `DECISION.md`: do not regress this loop. Changes near `src/actions/mom.ts`, the extraction prompt, `src/components/MomSection.tsx`, or task creation need a real recording before they ship.

## Tasks

`/tasks`, and the task list inside a project.

- Due date, reminder schedule (default about 85% of the way to the due date; overridable per task and as a profile default), several assignees, link back to a meeting or a saved link.
- Assignee by email works before that person has an account. The task is claimed when they sign up with that address.
- The assignee marks the work done. An owner signs off. Unticking clears the sign-off.
- Android local notifications fire the reminders (`ReminderBootstrap`, exact alarms). There is no web push.
- Removing someone from a group removes them from that group's tasks (`src/lib/dropAssignee.ts`). The task stays. If nobody is left, it shows in **Needs an owner**.

## Project groups

`/projects` and `/projects/[id]`. A project is the only way to share. Personal records have no `projectId` and stay with their creator.

Workspace sections: Meetings, All tasks, Notes, Chat, People, What changed, Files, About. Owners can rename, invite, change roles, export PDF (`/projects/[id]/print`), and delete. Only the creator can delete the group.

- **Chat.** One room per group. `@person`, `/task`, `/mom`, `/note` are stored references, not plain text. Viewers may post (`canChat` in `src/lib/scope.ts`). The UI says chat does not ring a phone: there is no push. Polls while the room is open.
- **Activity.** Writes append an `Event`. The group shows **What changed**. History was not backfilled.
- **Notes in the group.** Inline composer. A note filed into a group belongs to the group.

Roles and the Private Safe rule are in [access.md](access.md).

## Notes, files, expenses, contacts

- **Notes** (`/notes`). Keep-style grid: tap a note to read the full text; edit when you want. The formatting bar (bold, italic, underline, lists, checklist, divider, table, text color) keeps the selection, including on a phone, and the saved HTML keeps that formatting. Checklist rows show real boxes on the grid and in read view — tap to tick without opening edit; checked lines strike through like Keep. In edit, Enter adds another checklist row. **Jarvis** can create note checklists (with a divider before and after the list), tables, and dividers — from HTML or from plain bullet / markdown table text. Pin, attachments, PDF text extraction, group and Private Safe options in a note options sheet, optional meeting link.
- **Digi Locker** (`/d-locker`). Personal and group documents. Jarvis can read extracted PDF text when the person is allowed to see that file.
- **Files** live in the uploader's Google Drive under `ALL-YOU-NEED/{personal, digilocker, <group>}`. No Drive connected means no upload. Reads go through `/api/files`. Detail in [tech.md](tech.md).
- **Expenses** (`/expenses`). Personal ledger: spend and investment, categories, import, receipt extract, private flag. Amounts are shown in INR.
- **Contacts** (`/contacts`). Address book. People from projects show up. Invite email is offered, never sent automatically, and only to an address already saved as the caller's contact.

## Jarvis

Floating assistant (`JarvisWidget`) on signed-in screens except auth and the suspended page.

- Answers from the person's own records (local retrieval, then the model).
- Can save a link, navigate, and create or update records.
- Writes that touch a shared project ask for confirmation first. Personal writes do not. The confirm step can be turned off in Profile (`jarvisConfirmShared`, default on).
- "How do I…?" loads the in-app manual (`src/lib/manual.ts`) only for those questions.
- Voice questions are transcribed, then answered.
- Five questions per person per calendar day in their timezone. Admins are exempt. When the shared Gemini pool is empty, the message says so.
- While Private Safe is locked, Jarvis does not see private personal content.

## Profile, privacy pages, admin

- **Profile** (`/profile`). Theme, column layout, Private Safe PIN, Google Drive connect, Sarvam key, Jarvis confirm toggle, reminder default, share-the-app (points at `/download`), account switcher, feedback, delete account.
- **Your data** (`/your-data`). Plain explanation plus counts of what you filed into each group. Counts only — no titles or bodies. Starts the tour.
- **Terms** (`/terms`, public). Says the operator can read stored content, the PIN is not encryption, files sit in the user's Google Drive, which AI providers are used, and that a deleted account's name, email, and role are kept 90 days.
- **Notifications** (`/notifications`). In-app feed for group activity and messages. Not a push channel.
- **Download** (`/download`, public). QR and the debug APK, with the sideload warnings named before Android shows them.
- **Admin** (`/admin`). Counts, the meeting-to-task funnel, feedback, and user actions (grant Sarvam, suspend, delete). No note bodies, titles, or transcripts. `/feedback-inbox` is the same feedback data.
- **Product docs** (`/admin/docs`). Founders only. Renders this `docs/` folder in the app: one page per file, with that file's sections beside it. Profile and the admin dashboard both link here. The markdown files stay the source; the page does not keep a second copy.
- **Suspended** (`/suspended`, public). Shown when an admin has suspended the account.
- **Sarvam key guide** (`/sarvam-key`). How to bring your own key and that Sarvam bills that person.

## Account

- Sign up, sign in, forgot password (`/auth/*`). Email and password, or Google when configured.
- Email verification is a 6-digit code, 10 minutes, 5 attempts. It gates **shared** project access, not sign-in and not projects you created. A password reset counts as verification. A later signup that proves the inbox takes over an unverified account at that address.
- Several signed-in accounts can be parked and switched (`src/actions/accounts.ts`).
- Delete account is on Profile: re-auth, and the PIN if one is set. Content is removed. Name, email, and role are retained 90 days, then purged. If you created a group, it transfers to the oldest co-owner, else the oldest member is promoted, else the group is deleted with a warning.

## Android shell

Capacitor loads the deployed site. Native pieces: share-to-save, SMS inbox picker (`SmsInbox` plugin), Chrome Custom Tab for Google sign-in and Drive consent, file download handling, local notifications, back button, network gate. `/download` serves `public/app-debug.apk`. The in-app update banner compares the installed `versionCode` with `LATEST` in `src/lib/appRelease.ts`.
