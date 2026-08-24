# Decisions

A running record of what we chose, and why. Read the "why" — the choices are only obvious
once you remember the reasoning, and the reasoning is what makes the next choice easy.

Last updated: 25 Aug 2026.

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
| 2 | "Who can see my data" — shared badges, first-share confirm, Your data page | next |
| 3 | In-app introduction — getting-started checklist, per-section explainers | planned |
| 4 | Free Hindi meetings — Gemini audio + bring-your-own Sarvam key | planned |
| 5 | Jarvis — retrieval instead of whole-vault dump, plus new powers | planned |
| 6 | Distribution — Play Store org account, iOS | paperwork can start now |
| 7 | Encrypt the Private Safe (server-held key) | when a prospect pushes back |

### Decided, not yet built

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
- **Round 7:** server-held key, so a stolen database is useless while PIN reset by email still
  works. True user-only-passphrase encryption stays possible later as a paid tier.

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

### Ideas not yet committed to

- Web push, so reminders reach the browser and not only the Android app.
- An email when someone is made a project owner.
- Letting the creator hand over or step down from a project — currently they are permanent, which
  is right for a mutiny but wrong for someone leaving the company.
- Team-level membership and roles, above individual projects.
- An audit trail — who changed what, in a shared project.
- Real-time messaging or threads. **Argue hard before building this**; it is where "we're like
  Slack" swallows a product that is currently better than Slack at one specific thing.
- A PWA, so iPhone users can install from Safari. Cheap, but it cannot do reliable scheduled
  reminders, so it complements the Android app rather than replacing it.
