# Strategy

Snapshot: 24 October 2026. The reasoning log through 30 August 2026 is `DECISION.md`. This file is the current stance. Change it when a product decision changes, and say why in `docs/versions.md`.

## The wedge

**Meetings for projects — the meeting-to-task loop. That is the product. Everything else supports it.**

Record a meeting. The app transcribes it, writes the summary, pulls out action items, assigns them, attaches dates, files notes on the project, and chases each person until the work is done. Nobody writes the minutes. Nobody is employed to chase.

The pitch is follow-through without a middle manager. Small teams do not lose work because nobody is capable. They lose it because a promise in a meeting never became a task with a name and a date. That gap is usually a person's job. This app is that person.

Landing line: "Record everything. Chase nobody."

Do not regress MOM. Changes to `src/actions/mom.ts`, the extraction prompt, `src/components/MomSection.tsx`, or the task-creation path outrank new features elsewhere.

## What the rest of the app is for

Personal and work live in one app on purpose. A work-only tool has a cold start: a team will not adopt something nobody already opens. People will open the place their links and reminders already live. Capture (Android share sheet, categories, Jarvis) is how the app gets opened on a Sunday so the Monday meeting has somewhere to go.

Sharing exists only inside a project you chose the members of. That is the answer to "will this leak?"

## What not to copy

Slack, Linear, Asana, and Jira were the reference for safety (roles, offboarding, history), not for hierarchy. Those tools grow more roles and more approval steps. That growth rebuilds the middle manager this product removes.

Standing refusals:

- Chat does not become tasks by itself. Messages can point at a task, a meeting, or a note. They are not a second task system.
- Chat is not Slack. There is no push. If a group sends under about one message per active group per week after four weeks, delete the feature (decision 30 Aug 2026).
- Do not add real-time messaging or threads unless the meeting-to-task loop is clearly winning and a prospect is lost without it. Argue before building.
- Do not add team-level roles above a project until a real team is blocked without them.
- Admin stays counts-only. Showing a title, a note, or a transcript means changing `/terms` in the same change.
- Hindi and Hinglish are not a nice-to-have. If meetings in those languages get worse, the product is unusable for the people it is aimed at.

## How decisions get made

From the working agreement in `DECISION.md`, still in force:

- Plan a feature or a bug before writing code.
- One round at a time.
- Product decisions stay with the founder. Ask rather than assume.
- Specialist context lives in `.claude/agents/` (`design-lead`, `backend-lead`, `devils-advocate`, `security-qa`) and `.claude/TEAM_BRIEF.md`.

## Honest limits to say out loud

- No iOS app. The website works on a phone browser. A thin iOS WebView risks App Store rejection (guideline 4.2) unless it has real native behavior.
- No Play Store listing yet. Install is a sideload, with two Android warnings. `/download` names them first.
- Private Safe is a PIN in front of the UI, not encryption. Say that if asked. Server-held encryption is a later decision, possibly a paid one.
- The assistant and the free meeting engine run on shared founder keys. See [business.md](business.md).
- "Personal and work" makes the one-line explanation harder. The one line is still the meeting loop.
