# Business

Snapshot: 24 October 2026. Pricing has not been decided. Do not invent a price, a plan name, or a revenue number in the product or in these docs.

## Who it is for

The first user is the founder. The buyer it is aimed at is a small group that has meetings, makes promises, and does not keep a project tool open: small agencies, contractor and site teams, clinics, studios, hardware and robotics teams. They already know the pain. The app does not have to teach them they have a chasing problem.

India-shaped usage matters. Hindi and Hinglish meetings have to work, or the pitch fails in the room where it is being sold.

Personal capture (links, notes, expenses, reminders) is the adoption path, not a second company. The work product is the meeting loop inside a project group.

## What is free today

There is no billing, no plan, and no paywall in the app.

- The website and the APK are free to use.
- Gemini and Groq run on the founder's keys, shared by every user.
- Sarvam (better Hindi/Hinglish transcription) is either the user's own key, billed by Sarvam to them, or an admin grant that spends the founder's Sarvam key.
- Files sit in the user's Google Drive, so the app does not pay a storage bill. The cost moved to their Drive quota.
- Email is whatever SMTP account is configured.

## The cost that will force a price

Gemini's free tier is a shared ceiling, not a gentle throttle. One key serves every user. MOM extraction and Jarvis spend from the same pool. Jarvis is capped at 5 questions per person per day so one person cannot empty the pool before lunch (`src/lib/jarvisLimit.ts`). When the pool is empty, everyone hears that it is empty.

That cap is a bridge. It is not a business model. Pricing has to be decided before a Play Store listing, because a public install multiplies the number of people on those keys.

A paid Private Safe (encryption with a server-held key, so a stolen database is useless and email reset still works) was left open in `DECISION.md`. It is not built.

## Distribution

| Channel | Status |
| --- | --- |
| Web | Deployed on Vercel (`allyouneedvault.vercel.app`) |
| Android | Debug APK on `/download`, with a QR code. versionName 1.3, versionCode 4 |
| Play Store | Not listed. An organisation account needs a D-U-N-S number and skips the 12-testers-for-14-days rule |
| iOS | Not started. Apple Developer is a yearly fee. The build needs native behavior beyond a WebView |
| Invites | A user may email someone already in their contacts. The app never emails an address book on its own |

Sideload has an expiry. Google is requiring apps on certified devices to come from a verified developer: some countries from 30 September 2026, globally in 2027. The organisation Play account is the path through that. Direct APK is the path until then.

Growth loops that exist: the contact invite (opt-in), the Profile share button, and `/download`. There is no referral program and no public marketplace.

## What the admin watches

`/admin` is counts only. The number that matters is the meeting funnel: meetings recorded, action items found, tasks confirmed, tasks completed. If people record and never confirm, the product is not doing its job. "Active users" is people who created something in the window, not a guessed last-seen.

Feedback from "Help us improve" lands in the same screen. Admins can grant Sarvam, suspend, or delete a user. They cannot read content from that screen.

## Legal posture already written down

`/terms` is public and plain. It says the operator can read the database, the PIN is not encryption, which processors see meeting audio and questions, and what deletion retains for 90 days. An undisclosed retention period was rejected. Changing any of those facts means changing the terms in the same change.
