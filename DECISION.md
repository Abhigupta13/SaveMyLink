# Decisions

A running record of what we chose, and why. Read the "why" — the choices are only obvious
once you remember the reasoning, and the reasoning is what makes the next choice easy.

Last updated: 30 Aug 2026.

---

## 1. What was done, and why

### Round 1 — Verified signup, onboarding emails, contact invites, download page ✅ built

**Email verification at signup (OTP).**
Project membership is granted by raw email string (`memberEmails`), and signup never checked
that the address belonged to you. Anyone could register `boss@theirclient.com` and inherit every
task, meeting transcript and document ever shared to that address. Google sign-ins were safe
(Google verified them); password signups were not.
Chosen over "verify only when claiming an invite" because it also creates the moment onboarding
communication belongs in — the same work fixes the security hole and the cold-start problem.

**Enforced at project access, not at sign-in.**
`src/lib/scope.ts` withholds the `memberEmails` branch for an unverified user. Sign-in stays open,
so no existing tester is locked out and nobody loses their own vault. Only *shared* work is hidden.
No cutover-date branch anywhere — an old row simply has no `emailVerified` stamp.
**Ownership is deliberately not gated.** `ownerId` is a real user id and was never claimable by
typing an address, so an unverified account keeps every project it created. Gating it would have
locked existing users out of their own work to close a hole they were never in.

**An unverified account is taken over by a later signup.**
Otherwise someone could squat `yourboss@company.com`, and when the real owner signed up and
verified with the emailed code they would be verifying the *squatter's* password. Whoever can open
the inbox wins the account.

**A password reset also counts as verification.** Proving control of the inbox is exactly what the
OTP asks for; asking twice is friction with no gain.

**Invited users get invite + code. Cold signups get code + welcome.**
An invited teammate would otherwise receive three emails in ninety seconds, which is spam
behaviour aimed at the single most important user — the teammate deciding whether the team adopts
this. The invite is a better welcome than a generic one anyway.
The code email stays plain and transactional: mail sent through a Gmail app password gets filtered
when it is stuffed with feature copy, and the reader only wants six digits.

**Contact → invite loop, offered and never automatic.**
Saving someone with no account is the one moment the app knows a real person is worth inviting —
the only organic growth loop it has. It is offered because the message goes out under the user's
name, and an app that quietly emails your address book gets marked as spam. The action only sends
to an address already saved as the caller's own contact, or it would be an open mail relay.

**`/download` page with QR, and a share button in Profile.**
A raw `.apk` link hands a non-technical person two frightening warnings and no explanation. The
page names both warnings before they appear, which is what actually gets the app installed. QR is
rendered on the server so the encoder never reaches the browser bundle.

**`/terms` says plainly that the operator can read stored content.**
Including the Private Safe, which is a PIN check in the UI and not encryption. People are asking
this question unprompted. A claim you have to walk back later ends a product's credibility
permanently; being early and honest costs nothing.

**Copy balanced for personal *and* work.**
A work-only tool has a cold-start problem: you cannot get a team to adopt something nobody already
uses on their own.

**`middleware.ts` → `proxy.ts`.** Next 16 deprecated the old filename. `AGENTS.md` says heed
deprecation notices; the build confirms it is clean.

### Timezone bug ✅ fixed

Jarvis and the meeting extractor ask the AI for a bare wall clock (`2026-08-26T17:00`). That text
carries no zone, so `new Date()` read it in the **server's** zone — on a UTC server "tomorrow 5pm"
became 22:30 in India, and every reminder fired against that wrong instant.
The phone was already sending the real timezone on both paths; the server threw it away at the last
step. `src/lib/time.ts` now anchors it correctly, with `Asia/Kolkata` as the fallback instead of UTC.

Also fixed: `jarvis.ts` kept the timezone in a module-level variable shared by the whole process, so
two people asking at once could be answered in each other's zone. Harmless with one user,
guaranteed to bite with a team.

**The backfill was deliberately NOT run.** A preview showed only ~1 of 10 stored meeting deadlines
was actually wrong — the rest were extracted on a machine already running IST and are correct. A
blanket shift would have corrupted 7 good rows to fix 1 bad one. Fixed by hand instead, and the
migration script was deleted rather than left in the repo as a hazard.

### Co-owners on a project ✅ built

**Any owner can promote another owner.** Trusting someone with ownership includes trusting their
judgement about the next one.
**Only the creator can delete the project** — the one action with no undo. A co-owner having a bad
day should not be able to erase a team's history.
**The creator is permanent**, so someone you promoted cannot lock you out of your own project.
**You can only promote an existing member**, so ownership is never granted to a typo.

The feature itself was small. The work was that ownership was being checked about **20 different
ways** across server gates, read scope and client display. All of them now route through
`src/lib/scope.ts`. Adding co-ownership to twelve of twenty and forgetting eight would have left
either broken screens or security holes, and the forgotten ones are never the ones you notice.

**A gap in Round 1 was found and closed here.** `jarvis.ts`, `search.ts`, `contact.ts` and `mom.ts`
each built the project query inline instead of calling the helper, so the email-verification gate
did not apply on those paths — an unverified account could still read a shared project through
Jarvis or search. The Round 1 claim that "every project read routes through one place" was not
true until now. It is the same scatter problem, and the reason the rule now lives in exactly one
file that nothing is allowed to duplicate.

`ownerEmails` is gated on verification exactly like `memberEmails`. Without that the Round 1 hole
would have reopened in a worse form: an unverified signup claiming an owner address would get
delete rights over shared work, not merely read access.

**Not built:** an email telling someone they were made an owner. They are already a member and see
the chip. Add it if promotion turns out to happen between people who are not already talking.

### 12-hour clock ✅ built

Seven screens each formatted times their own way, several leaving it to the device locale — so the
same task could read "17:00" on one screen and "5:00 pm" on another, which looks like two different
due dates. One formatter in `src/lib/time.ts` now, always 12-hour with am/pm.

### One canonical app URL ✅ built

Six places each worked out the app's own address independently, five of them from `NEXTAUTH_URL`.
That variable has to be `localhost` in development or sign-in breaks, so it can never also mean
"where this app lives on the internet" — and using it for both meant **an invite sent from a dev
machine arrived with a localhost link the recipient could not open**. The visible symptom was the
share button; the damaging one was the email.

`NEXT_PUBLIC_APP_URL` is now the public address and `appUrl()` in `src/lib/url.ts` is the only
thing that reads it. **It must also be set in Vercel's environment variables.**

### Admin dashboard ✅ built

`/admin`, for the two founders (both addresses are the **code default** in `src/lib/isAdmin.ts`, so
a deploy with no `ADMIN_EMAILS` set still lets both in; the env var still overrides, including to
narrow the list). Feedback lives inside it; `/feedback-inbox` still works and links across.

**Counts only, deliberately.** `/terms` tells users "we do not read your content", and an admin
dashboard is exactly where that quietly stops being true. Nothing on the page shows a title, a note
body or a transcript. Everything worth knowing right now is answerable from counts, so the line
costs nothing — and crossing it later means changing `/terms` in the same commit.

**No invented "active users" number.** There is no `lastSeenAt` on `User` and `updatedAt` only moves
on a password or PIN change, so the figure shown is *people who created something in the last 7
days*, labelled as exactly that. A metric you cannot trust is worse than no metric.

**The chart colours are their own validated tokens**, not the UI accent — an ordinal ramp with
monotone lightness whose pale end still clears the surface, and a single-series fill inside each
mode's lightness band at ≥3:1. Both modes were run through the validator rather than eyeballed.

The section to actually watch is **Meeting → task**: meetings recorded → action items found →
confirmed as tasks → completed. If people record meetings and never confirm the tasks, that is the
most important fact about this product, and nothing showed it before.

### UI bugs, and the process change that follows ⚠️ lesson

Three real bugs shipped in one session because every UI change went from head to file without ever
being rendered:

- **OTP boxes overflowed the verify banner.** `.otp-box` is `flex: 1`, sized to fill the narrow auth
  card; dropped into a full-width bar, six of them ran off the screen.
- **The admin funnel bar overflowed its card.** Meetings → action items is an *expansion*, not a
  funnel stage — one meeting yields several items — so 18 items from 16 meetings rendered at 113%
  width and "113% of the step above" was a meaningless sentence. The funnel now starts at the action
  items, where each stage really is a subset of the one before, meetings are context above it, and
  every bar is clamped so no data shape can overflow again.
- **`.tile-icon` reused outside the Home grid.** Its width and height come from
  `.tiles.grid`/`.tiles.list` parent selectors, so on its own it has no intrinsic size and stretches
  to the height of the text beside it — a tall pill instead of a square chip. Now `.row-icon`.

**The process change: render it and look at it before saying it is done.** The `dataviz` skill's own
last step says exactly this and it was skipped every time. Colour was validated with a script and
still the layout was wrong, because a validator checks colour, not geometry. Browser screenshots at
both themes are now part of finishing any UI work, not an optional extra.

### Project groups behave like a WhatsApp group ✅ built (five rounds)

Researched how Slack, Linear, Asana and Jira handle roles, completion, offboarding and history,
then cut the findings against the thesis. **The rule: take their safety practices, refuse their
hierarchy.** Every one of those tools trends toward more roles and more approval steps — which is
exactly how you rebuild the middle manager this product removes.

**One word: owner.** Whoever creates a group is an owner; owners can make more owners; everyone
with the badge reads the same. Two protections stay but are not advertised: the creator cannot be
demoted or removed (same as WhatsApp), and only the creator can delete the group — the one action
with no undo. A "Created by X · date" line says who started it, in case you need to ask.

**The assignee ticks their own work; owners sign off.** RACI, which every tool encodes:
*Responsible* does the work, *Accountable* approves it. Two people, two acts — not a locked checkbox.
The earlier instinct was owners-only; the research said that puts the person who did the work back
in the position of asking someone to tick it, which is the chasing this app exists to remove. Also
fixed a bug: an owner who neither created nor was assigned a task could not tick it in their own
group.

**Nothing gets dropped.** `removeMember` used to `$unset` the departing person's assignments,
silently orphaning their tasks — the worst possible bug for an app whose pitch is "nothing gets
forgotten". Tasks now keep their assignee and surface in a **Needs an owner** band at the top of
the group. The same `$unset` had a second caller in `jarvis.ts`; both fixed.

**An activity trail, recording from now on.** History cannot be backfilled, so it started now. Every
write appends an `Event`; the group page shows **What changed**. This is the screen that most
directly replaces a manager's "what happened since Friday".

**A view-only role** for clients and stakeholders. Sequenced last, after the trail, because it
rewrites every permission gate and a bug there is a data leak. Two leaks were found and closed
during the build that the plan had not anticipated: Jarvis could write to a view-only group (its
context and its write scope were the same set), and a viewer could edit a note they had authored
after someone else filed it into the group. **Not yet tested with a real second account** — the
pure rules are asserted exhaustively, but proving a viewer is refused server-side needs a second
login before this ships.

**Notes belong to the group.** "Write a note" inside a group used to link to `/notes` with no
project context and land on Personal. There is now an inline composer. `Note` gained a `momId` to
match `Task`, so meeting notes are traceable and deletable; deleting a meeting shows what it
produced and asks, default keep — a meeting becoming real work is the product's whole pitch, and a
routine cleanup must never undo it.

**Three decisions made in the build, all sound:** one `setProjectRole` action instead of separate
promote/demote (three roles with pairwise actions was heading back to twenty ways to check
ownership); `memberSession` defaults to the strict write gate so the safe setting is the one you
get by forgetting; sign-off requires `completed` and un-ticking clears it, so the admin funnel
cannot show signed-off unfinished work.

**Leaving a group takes your claim on its work with you** (Round E, finding 3). Removal used to
leave assignments intact, with the "Needs an owner" band as the compensating control — but once a
task could have several assignees, that band only fires when *nobody* left is a member, so a task
shared with a second person never surfaced and the removed person kept reading its title and
description through My Tasks, search, Jarvis and their phone reminders. Being an assignee IS read
access. The founder's call: removing someone from a group removes them from its tasks. Promote,
don't orphan — the next assignee becomes primary; if they were the only one, the task goes
unassigned and lands in the band exactly as before. The task, its due date, its author and its
history all stay. Every exit routes through one function (`lib/dropAssignee`): the owner removing
someone, the same thing asked of Jarvis, and **account deletion**, which had the identical hole.

**MOM was tested end to end** with a real LLM call in Round E. This regenerated the Mowgli meeting's
summary text — transcript and original tasks intact, wording changed.

### Working agreements

- **Plan mode for every feature and bug** before any code is written.
- **One round at a time**, reviewed before the next starts.
- **Questions over assumptions** — decisions stay with the founder.
- Reuse existing agents rather than spawning new ones; keep them compact.
- Four standing specialists live in `.claude/agents/`: `design-lead`, `backend-lead`,
  `devils-advocate`, `security-qa`. Shared context in `.claude/TEAM_BRIEF.md`.

---

## 2. Selling points

### The one-sentence wedge

**MOM for projects — the meeting-to-task loop. This is THE product; everything else supports it.**

Record a meeting and the app does the rest: transcribes it, writes the summary, pulls out the
action items, assigns them to the right people, attaches dates, files notes against the project,
and then chases each person until it is done. **No one has to write the minutes, no one has to
chase, and the middle manager whose whole job was doing that is not needed.**

Slack does not do it. Notion does not record. Project tools assume somebody maintains them. This
is the sentence to lead every demo, every landing page and the in-app introduction with.

> **Engineering rule: do not regress MOM.** It is the feature the company rests on. Changes near
> `src/actions/mom.ts`, the extraction prompt, `src/components/MomSection.tsx` or the task-creation
> path get tested against real recordings before shipping, and improvements to it outrank new
> features elsewhere. `security-qa` and `backend-lead` both treat a MOM regression as critical.

### Why the loop matters commercially

The pitch is **follow-through without a middle manager**. Small teams do not lose work because
nobody is capable — they lose it because the thing agreed in a meeting never became a task with a
name and a date on it. That gap is normally filled by a person whose whole job is chasing. This app
is the chaser.

### Supporting strengths

- **Hindi and Hinglish meetings actually work.** Whisper cannot do it — it never emits romanized
  Hinglish and mis-hears spoken Hindi as Urdu. Sarvam handles code-switching. For an Indian
  team this is not a feature, it is the difference between usable and not.
- **Personal and work in one app.** People will not open a work tool on a Sunday. They will open the
  place their recipes, flat listings and reminders already live — and that is the app that ends up
  having the meeting notes in it on Monday. Adoption comes from the personal half.
- **Capture is one tap from anywhere.** Android share sheet, straight into the vault, title and
  thumbnail filled in.
- **Reminders that actually reach a phone**, escalating: a day before, an hour before, at the
  deadline, then every morning until it is done.
- **Ask, don't search.** Jarvis answers from your own saved content, by voice, in English or Hindi.
- **Nothing is shared by accident.** A project is the only sharing boundary, and you choose who is
  on it.

### Who to sell to

Groups doing project work who have meetings, make promises, and do not keep a project tool open:
small agencies, contractor and site teams, clinics, studios, hardware/robotics teams. They
recognise the problem instantly because they live it.

### What weakens the pitch (know these before a demo)

- **No iOS app yet.** One person on an iPhone and the "whole team onboards" story wobbles. The web
  app works and syncs, but it is an answer you have to give rather than one you never need.
- **No Play Store listing yet**, so installing means clearing two Android warnings.
- **No real-time messaging.** If a prospect expects Slack, say plainly that this is not that.
- **Private Safe is not encrypted yet.** Answer honestly if asked (see Round 7).
- **"Personal and work" makes it harder to explain in one line.** Worth it for adoption, but the
  one-liner must still be the meeting-to-task loop.

---

## 3. Pending decisions and ideas

### Planned rounds

| # | Round | Status |
|---|---|---|
| 1 | Verified signup, onboarding emails, contact invites, download page | ✅ built, untested |
| — | Timezone fix (Jarvis + MOM) | ✅ built, untested |
| — | 12-hour clock everywhere | ✅ built, untested |
| — | Co-owners on a project | ✅ built, untested |
| — | One canonical app URL (`NEXT_PUBLIC_APP_URL`) | ✅ built · **needs setting in Vercel** |
| — | Admin dashboard at `/admin`, both founders | ✅ built, untested |
| — | `middleware.ts` → `proxy.ts` (Next 16 deprecation) | ✅ built |
| — | Contacts merged into one address book, project chips | ✅ built, untested |
| — | Project groups: owner chip, created-by, "Project groups" heading | ✅ built |
| — | Assignee ticks / owner signs off; offboarding keeps tasks; Needs-an-owner band | ✅ built, untested |
| — | Activity trail ("What changed") | ✅ built, untested |
| — | View-only role | ✅ built · **tested by Swaraj with a second account, 26 Aug 2026** |
| — | Notes composer in-group; `Note.momId`; meeting-delete choice | ✅ built, MOM tested end to end |
| — | **Route gate actually running** — `proxy.ts` moved to `src/` (it was never loaded at the repo root; pages exposed empty shells, never data) | ✅ built, proven by signed-out curls |
| — | Landing page, brand mark, auth pages, Android icon (4 commits) | ✅ built, needs visual pass on a deploy |
| 2 | "Who can see my data" — shared tags in search/digest/Jarvis, first-share confirm, Your data page | ✅ built, needs signed-in visual pass |
| 3 | In-app introduction — **spotlight tour** (replaced the checklist, 26 Aug 2026), sample meeting via real extraction, empty-state hints | ✅ built, untested |
| 4 | Free Hindi meetings — Gemini audio + bring-your-own Sarvam key | ✅ built · **gate test run against five real recordings**; Gemini is now the default free engine, Whisper the fallback |
| 5 | Jarvis — local retrieval (no extra AI call), per-user daily cap, conversation memory, powers, confirm-before-shared-write, voice rule | ✅ built, untested |
| — | Per-task reminder timing — you choose when a task starts chasing, default 85% of the way to the due date | ✅ built, untested |
| — | Admin date-range control (Today · 7d · 30d · 90d · All time · Custom) | ✅ built, untested |
| — | Account deletion with disclosed 90-day retention | ✅ built · **tested end to end 30 Aug 2026**, including the group-handover path |
| — | Multi-assignee tasks — one shared task, several people, any of them ticks it | ✅ built · security passes ran |
| 8 | **Project chat** — a room per group, `@person` / `/task` `/mom` `/note` references, 5s poll while open | ✅ built 30 Aug 2026, **attachments deferred** behind Drive storage |
| — | Weekly digest on Home — "urgent, needs attention" + "saved this week" under the vault tiles | ✅ built 30 Aug 2026 |
| 9 | **Private Safe everywhere** — `isPrivate` on notes, tasks, meetings, documents, contacts; Jarvis blind to private when locked | 🔄 in build 30 Aug 2026 |
| 10 | **Files move to each user's own Google Drive** — `ALL-YOU-NEED/{personal, digilocker, <Group>}` | 🔄 in build 30 Aug 2026 · **blocked on Google Cloud Console + OAuth verification** |
| 6 | Distribution — Play Store org account, iOS, **Android app shortcuts** (long-press menu + draggable per-tab icons, decided 25 Aug 2026) | paperwork can start now · **shortcuts not started** (no `shortcuts.xml`) |
| 7 | Encrypt the Private Safe (server-held key) | when a prospect pushes back |

### Decided, not yet built

- ~~**Admin date-range control (queued 26 Aug 2026).**~~ **Built** — `src/lib/adminRange.ts`.

- **Account deletion (disclosed retention), decided 26 Aug 2026 — ✅ BUILT.** A "Delete my
  account" button in Profile scrubs the user's links, notes, tasks, meetings/transcripts, documents
  (+ S3), contacts, Private Safe PIN and Sarvam key. **Retained for 90 days, then purged:** name,
  email, role-in-company. `/terms` states this in one plain sentence — retention is disclosed, never
  hidden (an undisclosed-retention version was explicitly rejected: it breaks the "your data stays
  yours" promise and violates DPDP/GDPR). Group handover on owner deletion: auto-transfer to the
  oldest co-owner → else promote the oldest member → else delete the group with a warning. Role is
  captured once on the delete screen (no new signup/profile field). Confirm dialog + re-auth before
  it runs; sign out to landing after.

- **Round 4:** starts with a **test, not code** — run Gemini against the real recordings in
  `public/uploads/mom/` and compare transcripts against Whisper's before building anything. Hindi
  has come back as Urdu before; nothing gets built until real output is reviewed.
- **Round 4:** bring-your-own Sarvam key — encrypted before storage, never returned to the browser,
  shown as `•••• last4`, with a plain note at the field that Sarvam bills them directly and how to
  revoke it. Links to `/terms`.
- **Round 3:** cold signups are *offered* a sample project, never given one unasked.
- **Round 5 — Jarvis powers to add:** save a link, navigate/open pages, answer "how do I…" about the
  app. The last one is loaded **only when the question looks like a how-to**, or the manual inflates
  every single turn — the opposite of the point.
- **Round 5:** confirm-before-write for anything touching a shared project; silent for personal.
  With a toggle to switch confirmation off.
- **Round 5 — Jarvis voice:** a **male** voice whenever speech comes from the non-Sarvam path
  (browser / Gemini TTS); a **female** voice whenever Sarvam speaks (Hindi / Hinglish).
- **Round 7:** server-held key, so a stolen database is useless while PIN reset by email still
  works. True user-only-passphrase encryption stays possible later as a paid tier.

### Decided 30 Aug 2026

- **Project chat is a room, not a task factory.** A group gets one thread. Messages do NOT become
  tasks automatically; what keeps it from being a WhatsApp group is that you can point at the work —
  `@person`, `/task`, `/mom`, `/note` — and those references are stored as data the server
  re-resolves against that project, never as text. A mention reads inline in the sentence; a task or
  meeting rides underneath as a card. **Everyone on the project can post, viewers included** — the
  one place a viewer may write, isolated in `canChat` (`lib/scope.ts`) so reversing it is one line.
  Removal is app-side and immediate. **The honest limit, said in the UI: nothing here rings a phone.**
  There is no push channel of any kind, so a message cannot reach a closed app.
  **Kill metric:** messages per active group per week. Under ~1 after four weeks, delete the feature.

- **The Private Safe covers everything, and only personal things.** `isPrivate` now exists on notes,
  tasks, meetings, documents and contacts as well as links. Two rules, in `lib/privacy.ts`:
  **private is personal-only** — a record carrying a `projectId` belongs to its group and can never
  be private, because a padlock teammates can open is worse than no padlock, it gets believed; and
  **the safe swaps the personal vault rather than adding to it**, which is what links and categories
  have always done. Group records are untouched by either state: unlocking your own safe must not
  hide work you share. **Jarvis is the deliberate exception and adds instead of swapping** — locked,
  it has no knowledge of private content at all; unlocked, it can see everything. An assistant that
  answers "what are my tasks?" with only the secret ones is broken.

- **Files move to each user's own Google Drive, and the app keeps none.** Folder tree
  `ALL-YOU-NEED/{personal, digilocker, <Group name>}`, where a group always wins over the tab the
  upload came from. Files land in the **uploader's** Drive; members get read access two ways — the
  app proxies the bytes (authoritative, and the only path that works for a teammate with no Google
  account) *and* a Drive `reader` permission is granted (convenience, best-effort, never depended
  on). **A removed member keeps the Drive copy** — app access ends at once, the Drive permission is
  not revoked. Chosen knowingly against `dropAssignee`'s rule, so it is now a disclosure obligation:
  say it in the share sheet. Feedback screenshots go to an admin's Drive so a reporter with no Drive
  can still send a bug report. The motive is cost, and the honest claim is "your files live in your
  Drive", not "we cannot see them" — the server holds a token that can read them.
  **Blocked on paperwork, not code:** the Drive API must be enabled and the callback URI registered,
  and until the OAuth app is verified Google kills refresh tokens every 7 days.

- **The weekly digest also appears on Home**, under the vault tiles: "urgent — needs attention" then
  "saved this week", capped at four each with a link through to `/digest`. One query and one set of
  components serve both screens (`lib/digest.ts`, `components/DigestSections.tsx`) — a second,
  prettier copy for Home is how the two quietly stop agreeing about what "overdue" means.

### Open questions

- **iOS timing.** $99/year, and no Mac needed (Capacitor + Codemagic's free tier covers the builds).
  The real risk is Apple rejecting a thin webview wrapper under Guideline 4.2 — the iOS build must
  ship genuine native behaviour, not just load the site.
- **Play Store org account** needs a free D-U-N-S number from Dun & Bradstreet, which takes a few
  weeks. Worth starting now: it **skips the 12-testers-for-14-days wall** entirely.
- **Deadline to plan around:** Google will require apps to be registered to a verified developer to
  install on certified Android devices — Sept 30 2026 in Brazil/Indonesia/Singapore/Thailand,
  **globally in 2027**. The direct-APK download has an expiry date. The org account handles it.
- **Pricing.** Not discussed yet. Worth deciding before the Play listing.
- **Who pays for the AI.** Currently the founder's own free-tier keys. Gemini's free tier is
  1,500 requests/day shared across **every user on one key** — that is a hard wall, not a slope,
  and it breaks for everyone at once. Round 5 moves it out of sight; pricing has to catch up
  eventually.

### Known bugs, found 30 Aug 2026

- **`NEXTAUTH_URL` points at a deployment that no longer exists.** Signing out redirects to
  `https://save-my-link-akg.vercel.app`, which returns `404: DEPLOYMENT_NOT_FOUND`. Everything that
  builds an absolute URL — invite links, the QR on `/download`, and the Drive OAuth callback — is
  downstream of this, so it has to be settled before Drive can be registered in Google's console.
- **Google sign-in is broken inside the Android app.** `GoogleButton` calls `signIn('google')` with
  no platform check, and Google has blocked OAuth in embedded webviews since July 2023
  (`disallowed_useragent`). Needs Custom Tabs (`@capacitor/browser`) — the same work Drive connect
  needs, which is the argument for doing them together.
- **`deleteProject` deletes only Tasks.** Notes, Meetings, Documents and the activity trail survive
  as unreachable rows, and their files were never deleted. Chat messages are now cleaned up; the
  rest are not. This gets worse the day files live in a user's Drive, where an orphan burns *their*
  15GB. Fix by reusing `deleteProjectContent`, which already exists and is correct in `account.ts`.
  Fixed 30 Aug 2026: `deleteProjectContent` moved to `lib/projectContent.ts` and shared by both
  paths, content erased *before* the project row so a failure is retryable rather than orphaning,
  and the actor passed to `deleteUpload` so a group delete never destroys a teammate's file out of
  that teammate's own Drive. Still open: **chat attachments.** Messages are deleted but their
  `attachments[].key`s are not collected, so those bytes stay in the poster's Drive with no row
  left pointing at them — the same leak, one collection over, and it predates this round.
- **`npm run dev` did not work on Windows.** `scripts/dev-safe.js` spawned `npx.cmd` without
  `shell: true`, which Node 20+ refuses (`EINVAL`). Fixed 30 Aug 2026.
- **The local-upload fallback writes inside `public/`**, so files were also served statically at
  `/uploads/<key>` with no auth check at all. It disappears when Drive replaces the backend.

### Ideas not yet committed to

- **A viewer can be assigned a task they can never complete.** `needsOwner` does not flag it
  because they are on the group. Arguably that task does need an owner. Decide before a real
  client is made a viewer.
- `claimAssignments` writes `assigneeId` onto group tasks for any matching email, viewers
  included — the one write a viewer can still trigger. It changes nothing a person chose, so it was
  left; worth knowing.
- Web push, so reminders reach the browser and not only the Android app.
- Home-screen **widgets** (live tile with today's tasks) — native Android widget provider +
  data bridge out of the webview; revisit after the Play Store listing exists. App shortcuts
  (Round 6) cover the quick-access need until then.
- An email when someone is made a project owner.
- Letting the creator hand over or step down from a project — currently they are permanent, which
  is right for a mutiny but wrong for someone leaving the company.
- Team-level membership and roles, above individual projects.
- An audit trail — who changed what, in a shared project.
- Real-time messaging or threads. **Argue hard before building this**; it is where "we're like
  Slack" swallows a product that is currently better than Slack at one specific thing.
- A PWA, so iPhone users can install from Safari. Cheap, but it cannot do reliable scheduled
  reminders, so it complements the Android app rather than replacing it.
