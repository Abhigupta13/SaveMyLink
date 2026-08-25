// Minimal self-check for the pure helpers. Run: node scripts/self-check.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { extractUrl, hostnameOf, normalizeUrl, youtubeId, appUrl } from '../src/lib/url.ts';
import { escapeRegex } from '../src/lib/regex.ts';
import { hinglishEnabled } from '../src/lib/sarvam.ts';
import { isAdmin, adminEmails } from '../src/lib/isAdmin.ts';
import { suggestionEmail, inviteEmail, otpEmail } from '../src/lib/mailer.ts';
import { zonedToUtc, safeZone, DEFAULT_TZ, formatTime, formatDay, formatDate, formatInZone } from '../src/lib/time.ts';
import { checkOtp, hashOtp, newOtp, isSixDigits, MAX_OTP_ATTEMPTS } from '../src/lib/otp.ts';
import { projectScope, ownerScope, writerScope, isProjectOwner, isProjectCreator, isProjectViewer, canWrite } from '../src/lib/scope.ts';
import { mergeContacts, peopleByProject } from '../src/lib/contacts.ts';
import { canWorkOn, canSignOff, needsOwner, assigneeEmailOf } from '../src/lib/taskAccess.ts';
import { VERBS, phrase, sinceDays, DEFAULT_DAYS, fromMeeting } from '../src/lib/activity.ts';

// extractUrl
assert.equal(extractUrl('check this https://youtu.be/abc123 out'), 'https://youtu.be/abc123');
assert.equal(extractUrl('no link here'), null);

// hostnameOf
assert.equal(hostnameOf('https://www.YouTube.com/watch?v=x'), 'youtube.com');
assert.equal(hostnameOf('not a url'), '');

// normalizeUrl strips tracking + hash + trailing slash
assert.equal(
  normalizeUrl('https://www.example.com/page/?utm_source=x&keep=1&si=abc#frag'),
  'https://example.com/page?keep=1'
);

// youtubeId across URL shapes
assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=z'), 'dQw4w9WgXcQ');
assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ?si=z'), 'dQw4w9WgXcQ');
assert.equal(youtubeId('https://youtube.com/shorts/abcdefg1234'), 'abcdefg1234');
assert.equal(youtubeId('https://vimeo.com/12345'), null);
assert.equal(youtubeId('https://notyoutube.com/watch?v=x'), null);

// escapeRegex makes user input regex-safe
assert.doesNotThrow(() => new RegExp(escapeRegex('c++ (test) [1.2]')));
assert.ok(new RegExp(escapeRegex('a.b')).test('a.b'));
assert.ok(!new RegExp(escapeRegex('a.b')).test('axb'));

// hinglishEnabled gates a PAID API, so every ambiguous input must fail closed
const allowlist = (v) => { if (v === undefined) delete process.env.SARVAM_ENABLED_EMAILS; else process.env.SARVAM_ENABLED_EMAILS = v; };

allowlist(undefined);
assert.equal(hinglishEnabled('a@x.com'), false, 'unset allowlist denies');
allowlist('');
assert.equal(hinglishEnabled('a@x.com'), false, 'empty allowlist denies');
allowlist('a@x.com,b@y.com');
assert.equal(hinglishEnabled('a@x.com'), true);
assert.equal(hinglishEnabled('B@Y.COM'), true, 'match is case-insensitive');
assert.equal(hinglishEnabled('c@z.com'), false, 'unlisted address denied');
assert.equal(hinglishEnabled(null), false, 'no session email denies');
assert.equal(hinglishEnabled(''), false, 'blank email denies');
allowlist(' a@x.com , b@y.com ');
assert.equal(hinglishEnabled('a@x.com'), true, 'whitespace around entries tolerated');
allowlist(',,');
assert.equal(hinglishEnabled(''), false, 'blank list entries never match a blank email');
allowlist(undefined);

// Both founders reach /admin with nothing configured. This is the regression test for Abhishek
// silently losing access the next time someone deploys without setting ADMIN_EMAILS.
delete process.env.ADMIN_EMAILS;
assert.deepEqual(adminEmails(), ['swarajdangare2016@gmail.com', 'abhishek.akg13@gmail.com'], 'both founders by default');
assert.equal(isAdmin('swarajdangare2016@gmail.com'), true);
assert.equal(isAdmin('ABHISHEK.AKG13@GMAIL.COM'), true, 'case-insensitive');
assert.equal(isAdmin('abhishek.akg13@gmail.com.c'), false, 'a near-miss address is not an admin');
assert.equal(isAdmin('someone@else.com'), false, 'nobody else, by default');
assert.equal(isAdmin(''), false);
assert.equal(isAdmin(null), false);

// ADMIN_EMAILS overrides completely, including narrowing the list — a misconfigured Vercel
// variable must lock people out visibly rather than silently leaving the defaults in place
process.env.ADMIN_EMAILS = 'swarajdangare2016@gmail.com';
assert.equal(isAdmin('abhishek.akg13@gmail.com'), false, 'the env list replaces the default, it does not extend it');
assert.equal(isAdmin('swarajdangare2016@gmail.com'), true);

// Admin allowlist gates the feedback inbox, so it fails closed the same way
process.env.ADMIN_EMAILS = 'boss@x.com, Other@Y.com';
assert.deepEqual(adminEmails(), ['boss@x.com', 'other@y.com'], 'trimmed and lowercased');
assert.equal(isAdmin('BOSS@X.COM'), true, 'match is case-insensitive');
assert.equal(isAdmin('stranger@x.com'), false, 'unlisted address denied');
assert.equal(isAdmin(null), false, 'no email denies');
assert.equal(isAdmin(''), false, 'blank email denies');
delete process.env.ADMIN_EMAILS;

// A suggestion is user-typed text dropped into an HTML email — it must not carry markup through
const evil = suggestionEmail({ kind: 'bug', message: '<script>alert(1)</script> & <b>bold</b>', from: 'a@b.com' });
assert.ok(!evil.html.includes('<script>'), 'script tag must not survive into the email');
assert.ok(evil.html.includes('&lt;script&gt;'), 'it is escaped, not stripped');
assert.ok(evil.html.includes('&amp;'), 'ampersands escaped');
assert.ok(!evil.html.includes('View screenshot'), 'no screenshot button when there is no shot');
assert.ok(suggestionEmail({ kind: 'idea', message: 'x', from: 'a@b.com', shotUrl: 'https://h/s' })
  .html.includes('View screenshot'), 'screenshot button appears when there is one');


// A model writes a bare wall clock in the USER's zone; parsing it in the SERVER's zone is what
// made "tomorrow 5pm" fire at 22:30 in India. These pin the whole bug shut.
const iso = (d) => d.toISOString();
assert.equal(iso(zonedToUtc('2026-08-26T17:00', 'Asia/Kolkata')), '2026-08-26T11:30:00.000Z', 'IST wall clock anchors 5.5h back');
assert.equal(iso(zonedToUtc('2026-08-26T17:00', 'UTC')), '2026-08-26T17:00:00.000Z', 'UTC is its own wall clock');
assert.equal(iso(zonedToUtc('2026-01-15T12:00', 'America/New_York')), '2026-01-15T17:00:00.000Z', 'winter offset');
assert.equal(iso(zonedToUtc('2026-07-15T12:00', 'America/New_York')), '2026-07-15T16:00:00.000Z', 'summer offset — DST is read, not assumed');
assert.equal(iso(zonedToUtc('2026-08-26T17:00:30', 'Asia/Kolkata')), '2026-08-26T11:30:30.000Z', 'seconds survive');

// Already-zoned input round-trips through the confirm screen and must never shift twice
assert.equal(iso(zonedToUtc('2026-08-26T11:30:00.000Z', 'Asia/Kolkata')), '2026-08-26T11:30:00.000Z', 'ISO with Z passes through');
assert.equal(iso(zonedToUtc('2026-08-26T17:00:00+05:30', 'UTC')), '2026-08-26T11:30:00.000Z', 'explicit offset wins over the zone argument');
const already = new Date('2026-08-26T11:30:00.000Z');
assert.equal(iso(zonedToUtc(already, 'Asia/Kolkata')), iso(already), 'a Date is returned untouched');

// Callers rely on null to keep their existing "no due date" branch
assert.equal(zonedToUtc(null), null);
assert.equal(zonedToUtc(''), null);
assert.equal(zonedToUtc(undefined), null);
assert.equal(zonedToUtc('sometime next week'), null, 'prose is not a date');

// A client sends the zone, so junk must not lose the date entirely
assert.equal(safeZone('Not/AZone'), DEFAULT_TZ, 'unknown zone falls back');
assert.equal(safeZone(''), DEFAULT_TZ, 'blank falls back');
assert.equal(safeZone(null), DEFAULT_TZ, 'missing falls back');
assert.equal(safeZone('Asia/Kolkata'), 'Asia/Kolkata', 'a real zone is kept');
assert.equal(DEFAULT_TZ, 'Asia/Kolkata', 'the fallback is India, never UTC');
assert.ok(zonedToUtc('2026-08-26T17:00', 'Not/AZone') instanceof Date, 'a bad zone still yields a date');

// Every clock the user reads is 12-hour with am/pm, and it must not drift back to the device locale
const noon = '2026-08-26T06:30:00.000Z';   // 12:00 in Kolkata
assert.equal(formatTime(noon, 'Asia/Kolkata'), '12:00 pm');
assert.equal(formatTime('2026-08-26T11:30:00.000Z', 'Asia/Kolkata'), '5:00 pm', 'the 17:00 case reads as 5 pm');
assert.equal(formatTime('2026-08-26T18:30:00.000Z', 'Asia/Kolkata'), '12:00 am', 'midnight is 12 am, never 24:00');
assert.equal(formatTime('2026-08-25T22:45:00.000Z', 'Asia/Kolkata'), '4:15 am');
assert.equal(formatDay(noon, 'Asia/Kolkata'), '26 Aug');
// A bare toLocaleDateString() renders 8/26/2026 on a US-locale browser. Pinning the locale is the
// whole point — day-first, never month-first, whatever the device is set to.
assert.equal(formatDate(noon, 'Asia/Kolkata'), '26 Aug 2026', 'dates carry the year day-first');
assert.ok(!formatDate(noon, 'Asia/Kolkata').startsWith('8/'), 'never US month/day order');
assert.equal(formatDate(null), '');
assert.equal(formatInZone(noon, 'Asia/Kolkata'), '26 Aug, 12:00 pm');
assert.equal(formatTime(null), '', 'nothing renders for no date');
assert.equal(formatInZone('not a date', 'Asia/Kolkata'), '', 'junk renders as nothing, not "Invalid Date"');

// OTP gates both password reset and email verification — every ambiguous state must fail closed
const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 1);
const code = '123456';
const good = { token: hashOtp(code), expiry: future, attempts: 0 };
assert.equal(checkOtp(good, code), 'ok');
assert.equal(checkOtp(good, '654321'), 'wrong');
assert.equal(checkOtp({ ...good, expiry: past }, code), 'expired', 'an expired code is dead even if correct');
assert.equal(checkOtp({ ...good, token: null }, code), 'expired', 'no pending code reads as expired, not as a match');
assert.equal(checkOtp({ ...good, expiry: null }, code), 'expired');
assert.equal(checkOtp({ ...good, attempts: MAX_OTP_ATTEMPTS }, code), 'locked', 'lockout beats a correct code');
assert.equal(checkOtp({ ...good, attempts: MAX_OTP_ATTEMPTS + 1 }, code), 'locked');
assert.equal(checkOtp({ token: 'short', expiry: future, attempts: 0 }, code), 'wrong', 'a malformed stored token never matches');
assert.equal(checkOtp(good, ''), 'wrong');
assert.ok(isSixDigits('012345') && !isSixDigits('12345') && !isSixDigits('abcdef') && !isSixDigits(''));
assert.ok(/^\d{6}$/.test(newOtp()), 'codes are always 6 digits, leading zeros kept');
assert.notEqual(hashOtp('123456'), '123456', 'only the hash is ever stored');

// One invite template, two shapes — a projectless invite must not leak "undefined" into the copy
const withProject = inviteEmail({ projectName: 'Mogli', inviterName: 'Swaraj', link: 'https://x/y', hasAccount: true });
assert.ok(withProject.subject.includes('Mogli') && withProject.html.includes('Mogli'));
const noProject = inviteEmail({ inviterName: 'Swaraj', link: 'https://x/y', hasAccount: false });
assert.ok(!noProject.subject.includes('undefined') && !noProject.html.includes('undefined') && !noProject.text.includes('undefined'), 'no stray undefined without a project');
assert.ok(noProject.html.includes('Create your account'), 'a stranger is asked to sign up');

// The code email serves reset and verification; the wrong copy on the wrong one is a support ticket
assert.ok(otpEmail('123456', 'S', 'verify').subject.includes('confirmation'));
assert.ok(otpEmail('123456', 'S').subject.includes('password reset'), 'reset stays the default');
assert.ok(otpEmail('123456', 'S', 'verify').html.includes('123456'));

// Project membership is granted by raw email string. Until a signup proves it owns that address
// the string is only a claim, so the memberEmails branch must not appear for an unverified user —
// this is the regression test for "register boss@theirclient.com and read all their work".
const scoped = (verified) => JSON.stringify(projectScope('u1', 'Boss@Client.com', verified));
assert.equal(scoped(false), JSON.stringify({ $or: [{ ownerId: 'u1' }] }), 'unverified claims nothing by email');
assert.ok(scoped(true).includes('boss@client.com'), 'verified matches, lowercased');
assert.ok(scoped(false).includes('ownerId'), 'an unverified user still keeps the projects they created');
assert.equal(JSON.stringify(projectScope('u1', '', true)), JSON.stringify({ $or: [{ ownerId: 'u1' }] }), 'a blank email never matches a blank memberEmails entry');
assert.equal(JSON.stringify(projectScope('u1', null, true)), JSON.stringify({ $or: [{ ownerId: 'u1' }] }), 'no session email claims nothing');

// Owner rights are granted by email too, so the verification gate has to hold here as well —
// an unverified account claiming an owner address would get DELETE rights over a team's shared
// work, which is strictly worse than the read access that gate was built for.
const owned = (verified) => JSON.stringify(ownerScope('u1', 'Boss@Client.com', verified));
assert.equal(owned(false), JSON.stringify({ $or: [{ ownerId: 'u1' }] }), 'unverified claims no ownership by email');
assert.ok(owned(true).includes('ownerEmails'), 'verified co-owner matches');
assert.ok(owned(true).includes('boss@client.com'), 'lowercased');
assert.ok(owned(false).includes('ownerId'), 'a creator never loses their own project');
assert.equal(JSON.stringify(ownerScope('u1', '', true)), JSON.stringify({ $or: [{ ownerId: 'u1' }] }), 'a blank email never matches a blank ownerEmails entry');

// Display side. The creator is permanent; co-owners are equal except for deleting the project.
const proj = { ownerId: { email: 'Creator@x.com' }, ownerEmails: ['Co@x.com'], memberEmails: ['co@x.com', 'member@x.com'] };
assert.ok(isProjectOwner(proj, 'creator@x.com'), 'creator is an owner');
assert.ok(isProjectOwner(proj, 'CO@X.COM'), 'co-owner is an owner, case-insensitively');
assert.ok(!isProjectOwner(proj, 'member@x.com'), 'a plain member is not');
assert.ok(!isProjectOwner(proj, 'stranger@x.com'));
assert.ok(!isProjectOwner(proj, ''), 'no email owns nothing');
assert.ok(!isProjectOwner(null, 'creator@x.com'), 'no project owns nothing');
assert.ok(isProjectCreator(proj, 'Creator@x.com'), 'creator is the creator');
assert.ok(!isProjectCreator(proj, 'co@x.com'), 'a co-owner is NOT the creator — they cannot delete the project');

// A raw document carries ownerId as an id, not a populated {email}; one rule reads both shapes
const raw = { ownerId: 'user-1', ownerEmails: ['co@x.com'] };
assert.ok(isProjectOwner(raw, 'anything@x.com', 'user-1'), 'creator matched by id');
assert.ok(isProjectCreator(raw, 'anything@x.com', 'user-1'));
assert.ok(isProjectOwner(raw, 'CO@x.com', 'someone-else'), 'co-owner still matched by email');
assert.ok(!isProjectOwner(raw, 'member@x.com', 'someone-else'));
assert.ok(!isProjectCreator(raw, 'co@x.com', 'someone-else'), 'a co-owner is not the creator on a raw doc either');

// Every project that predates co-ownership has no ownerEmails at all — it must behave as before
const old = { ownerId: { email: 'creator@x.com' }, memberEmails: ['member@x.com'] };
assert.ok(isProjectOwner(old, 'creator@x.com'), 'sole owner unchanged');
assert.ok(!isProjectOwner(old, 'member@x.com'), 'members gain nothing');

// Links that leave this machine must carry the public address, not whatever host the code runs on.
// The bug this pins shut: an invite sent from a dev box arrived with a localhost link.
const env = (pub, auth) => {
  if (pub === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = pub;
  if (auth === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = auth;
};
const savedPub = process.env.NEXT_PUBLIC_APP_URL, savedAuth = process.env.NEXTAUTH_URL;

env('https://live.example.com', 'http://localhost:3000');
assert.equal(appUrl(), 'https://live.example.com', 'the public address beats the auth URL');
env('https://live.example.com/', 'http://localhost:3000');
assert.equal(appUrl() + '/download', 'https://live.example.com/download', 'trailing slash trimmed, never a double slash');
env('https://live.example.com///', undefined);
assert.equal(appUrl(), 'https://live.example.com', 'several trailing slashes trimmed');
env(undefined, 'https://fallback.example.com/');
assert.equal(appUrl(), 'https://fallback.example.com', 'falls back before the new variable is deployed');
env(undefined, undefined);
assert.equal(appUrl(), '', 'empty, never the string "undefined" — callers concatenate onto it');
env(savedPub, savedAuth);

// A verification code must never be handed back to whoever asked for it in production — that is
// account takeover by design: sign up as someone else, read the code off the screen, and you are
// them. The reveal is gated on NODE_ENV, not on whether mail happens to be working.
{
  const authSrc = readFileSync(new URL('../src/actions/auth.ts', import.meta.url), 'utf8');
  assert.ok(authSrc.includes("process.env.NODE_ENV !== 'production'"), 'the dev code reveal is gated on NODE_ENV');
  // Two branches hand a code back, both labelled 'dev only' and both behind that gate.
  // resendVerification only re-exposes what sendCode returned, so it inherits the gate.
  assert.equal(authSrc.split('dev only').length - 1, 2, 'exactly two dev-only code reveals');
  assert.equal(authSrc.split(', code };').length - 1, 2, 'and nothing else returns a raw code');
}

// One address book. A person from a project and a person you typed in must never appear twice,
// and an address you deleted must not come back on the next page load.
const PROJECTS = [
  { name: 'Mowgli', ownerId: { email: 'Me@x.com' }, memberEmails: ['Boss@X.com', 'new@x.com'] },
  { name: 'M400', ownerId: { email: 'Me@x.com' }, memberEmails: ['boss@x.com'] },
];

const byEmail = peopleByProject(PROJECTS, 'me@x.com');
assert.deepEqual(byEmail.get('boss@x.com'), ['Mowgli', 'M400'], 'both projects, matched case-insensitively');
assert.ok(!byEmail.has('me@x.com'), 'you are never your own contact');

// A contact added by hand whose address is on a project picks up its chips — the half that was
// missing before: a saved teammate showed nothing about the projects they share with you.
const saved = [{ email: 'Boss@X.com', name: 'The Boss', phone: '123' }, { name: 'No Email Person' }];
const m = mergeContacts({ contacts: saved, projects: PROJECTS, seeded: [], myEmail: 'me@x.com' });
assert.deepEqual(m.missing, ['new@x.com'], 'only the person with no contact row is created');
const rows = m.withProjects(saved);
assert.deepEqual(rows.find(r => r.name === 'The Boss').projects, ['Mowgli', 'M400'], 'saved contact gets chips');
assert.deepEqual(rows.find(r => r.name === 'No Email Person').projects, [], 'no email, no chips, still listed');
assert.equal(rows.length, 2, 'merging never drops a contact');
assert.equal(rows[0].name, 'No Email Person', 'sorted by name');

// The whole point of contactsSeeded: a deleted contact stays deleted
const afterDelete = mergeContacts({ contacts: [], projects: PROJECTS, seeded: ['Boss@X.com', 'new@x.com'], myEmail: 'me@x.com' });
assert.deepEqual(afterDelete.missing, [], 'nothing is re-created once seeded, whatever the casing');

// A fresh account with nothing seeded gets everyone once
const fresh = mergeContacts({ contacts: [], projects: PROJECTS, seeded: null, myEmail: 'me@x.com' });
assert.deepEqual(fresh.missing.sort(), ['boss@x.com', 'new@x.com'], 'first load seeds every teammate');

// ---------------------------------------------------------------------------
// Who may close a task, who may sign it off, and what counts as unheld.
// The completion gate is what stops a stranger closing your work; needsOwner is the whole
// reason the "Needs an owner" band exists. Both are worth holding to account without a database.

const ME = 'u1', OTHER = 'u2';
const projTask = (over = {}) => ({ projectId: 'p1', userId: OTHER, ...over });

// The assignee ticks their own work; nobody else wanders in.
assert.equal(canWorkOn(projTask({ assigneeId: ME }), ME, 'me@x.com', false), true, 'assignee ticks their own');
assert.equal(canWorkOn(projTask({ assigneeId: OTHER }), ME, 'me@x.com', false), false, 'a stranger cannot');
assert.equal(canWorkOn(projTask({ userId: ME, assigneeId: OTHER }), ME, 'me@x.com', false), true, 'the person who wrote it down can');

// Assigned by email and never claimed: no assigneeId exists yet, and without this branch the
// assignee cannot tick their own task until an unrelated read happens to claim it.
assert.equal(canWorkOn(projTask({ assigneeEmail: 'Me@X.com' }), ME, 'me@x.com', false), true, 'unclaimed email assignment still ticks');
assert.equal(canWorkOn(projTask({ assigneeEmail: 'them@x.com' }), ME, 'me@x.com', false), false, 'someone else\'s email does not');
assert.equal(canWorkOn(projTask({ assigneeEmail: '' }), ME, '', false), false, 'blank never matches blank');

// The bug this round fixes: an owner who is neither creator nor assignee was locked out of a
// task in their own group. And an owner of some OTHER group is still nobody here.
assert.equal(canWorkOn(projTask({ assigneeId: OTHER }), ME, 'me@x.com', true), true, 'an owner can tick');
assert.equal(canWorkOn({ userId: OTHER, assigneeId: OTHER }, ME, 'me@x.com', true), false, 'no project, no owner branch');

// idOf: a populated {_id,email,name} and a raw id are the same person; two different populated
// objects are not. Naive String() on the populated shape gives '[object Object]' for BOTH, which
// would open the gate for the wrong person — the one genuinely dangerous line in taskAccess.
assert.equal(canWorkOn(projTask({ assigneeId: { _id: ME, email: 'me@x.com' } }), ME, 'me@x.com', false), true, 'populated assignee matches its raw id');
assert.equal(canWorkOn(projTask({ assigneeId: { _id: OTHER, email: 'them@x.com' } }), ME, 'zz@x.com', false), false, 'two populated objects are not automatically equal');

// Sign-off: owner only, group only, finished work only. Approving unfinished work is what would
// make "signed off" stop being a subset of "completed" on the funnel.
assert.equal(canSignOff({ projectId: 'p1', completed: true }, true), true);
assert.equal(canSignOff({ projectId: 'p1', completed: true }, false), false, 'a member cannot sign off');
assert.equal(canSignOff({ projectId: 'p1', completed: false }, true), false, 'unfinished work cannot be signed off');
assert.equal(canSignOff({ completed: true }, true), false, 'a personal task has nobody to sign it off');

// assigneeEmailOf: the populated email wins, the raw string is the fallback, both lowercased.
assert.equal(assigneeEmailOf({ assigneeId: { email: 'A@X.com' }, assigneeEmail: 'b@x.com' }), 'a@x.com');
assert.equal(assigneeEmailOf({ assigneeEmail: 'B@X.com' }), 'b@x.com');
assert.equal(assigneeEmailOf({}), '');

// needsOwner: open work nobody in the group is holding.
const MEMBERS = ['Boss@X.com', 'me@x.com'];
assert.equal(needsOwner({ assigneeEmail: 'gone@x.com' }, MEMBERS), true, "an ex-member's task needs an owner");
assert.equal(needsOwner({ assigneeEmail: 'boss@x.com' }, MEMBERS), false, 'a current member holds theirs, matched case-insensitively');
assert.equal(needsOwner({ assigneeId: { email: 'BOSS@x.com' } }, MEMBERS), false, 'the populated shape counts too');
assert.equal(needsOwner({}, MEMBERS), true, 'never assigned is exactly the same failure');
assert.equal(needsOwner({ assigneeEmail: 'gone@x.com', completed: true }, MEMBERS), false, 'finished work needs nobody');

// ---------------------------------------------------------------------------
// The activity trail's vocabulary.
// The failure worth catching here is a verb an action emits that the renderer cannot phrase.
// It is invisible until somebody opens the page and reads a raw enum at themselves, and the
// writer and the reader live in different files, which is exactly how it would ship.

for (const verb of VERBS) {
  const said = phrase(verb, 'the thing');
  assert.ok(said, `every verb has a phrasing: ${verb}`);
  assert.ok(!said.includes(verb), `${verb} reads as English, not as its own enum`);
}
assert.equal(phrase('task_completed', 'Do mapping'), 'completed Do mapping');
assert.equal(phrase('not_a_real_verb', 'x'), '', 'an unknown verb renders as nothing, never as an enum');
assert.equal(phrase('task_created', '   '), 'added something', 'a blank subject still reads as a sentence');
assert.equal(phrase('task_created', null), 'added something');

// `days` arrives from a client control, so junk falls back to the week instead of returning
// the entire history of the group.
const NOW = Date.UTC(2026, 7, 25);
const daysBack = (v) => Math.round((NOW - sinceDays(v, NOW).getTime()) / 86400000);
assert.equal(daysBack(undefined), DEFAULT_DAYS, 'no value means a working week');
assert.equal(daysBack(30), 30);
assert.equal(daysBack('30'), 30, 'a form value arrives as a string');
assert.equal(daysBack(0), DEFAULT_DAYS, 'zero would return nothing at all');
assert.equal(daysBack(-5), DEFAULT_DAYS, 'a negative window would query the future');
assert.equal(daysBack('drop table'), DEFAULT_DAYS, 'junk falls back rather than throwing');
assert.equal(daysBack(99999), 365, 'and the ceiling holds');

// ---------------------------------------------------------------------------
// The view-only role. The one round where a bug is a data leak rather than an annoyance, so
// these assertions are about what a viewer must NOT reach as much as what they must.

const VIEWER = 'client@x.com';
const withViewer = { ownerId: { email: 'me@x.com' }, ownerEmails: [], memberEmails: ['dev@x.com'], viewerEmails: [VIEWER] };

// A viewer reads. That is the whole point of the role.
{
  const read = projectScope('u1', VIEWER, true);
  assert.ok(read.$or.some(b => b.viewerEmails === VIEWER), 'a verified viewer can see the group');
}
// ...but the same email must NOT appear in the write scope, or the role means nothing.
{
  const write = writerScope('u1', VIEWER, true);
  assert.ok(!write.$or.some(b => b.viewerEmails), 'writerScope has no viewer branch at all');
  assert.equal(write.$or.length, 2, 'writerScope is owner + member, nothing else');
}
// ...and never anywhere near owner rights.
{
  const own = ownerScope('u1', VIEWER, true);
  assert.ok(!own.$or.some(b => b.viewerEmails), 'ownerScope never grows a viewer branch');
}

// Verification gates the viewer branch exactly as it gates members. Skipping it would reopen the
// hole the whole email-verification round was built to close, on a new field.
{
  const unverified = projectScope('u1', VIEWER, false);
  assert.equal(unverified.$or.length, 1, 'an unverified viewer sees only what they own');
  assert.ok(!JSON.stringify(unverified).includes(VIEWER), 'and their claimed address appears nowhere');
}

// canWrite is the single question every control asks.
assert.equal(canWrite(withViewer, VIEWER), false, 'a viewer changes nothing');
assert.equal(canWrite(withViewer, 'dev@x.com'), true, 'a member does');
assert.equal(canWrite(withViewer, 'me@x.com'), true, 'so does the creator');
assert.equal(canWrite(withViewer, 'nobody@x.com'), false, 'and a stranger is not a member by default');
assert.equal(canWrite(null, 'dev@x.com'), false, 'no project, no write');

assert.equal(isProjectViewer(withViewer, VIEWER), true);
assert.equal(isProjectViewer(withViewer, 'dev@x.com'), false);
assert.equal(isProjectViewer(withViewer, 'ME@x.com'), false, 'the creator is never a viewer');

// Being in two lists resolves to the HIGHER power. A viewer entry added by mistake must not
// quietly strip a real member of access they had yesterday.
const both = { ...withViewer, memberEmails: ['dev@x.com', VIEWER] };
assert.equal(isProjectViewer(both, VIEWER), false, 'membership outranks a viewer entry');
assert.equal(canWrite(both, VIEWER), true, 'and they keep writing');
const ownerAndViewer = { ...withViewer, ownerEmails: [VIEWER], memberEmails: ['dev@x.com', VIEWER] };
assert.equal(isProjectViewer(ownerAndViewer, VIEWER), false, 'an owner is never demoted by a viewer entry');
assert.equal(canWrite(ownerAndViewer, VIEWER), true);

// A view-only client can be given work and still may not close it — the assigneeEmail branch
// of canWorkOn is the one gate a viewer can otherwise reach, which is why the actions ask
// canWriteProject first and this assertion exists to say so out loud.
assert.equal(canWorkOn({ projectId: 'p1', assigneeEmail: VIEWER }, 'u9', VIEWER, false), true,
  'canWorkOn alone would let an assigned viewer tick — the write gate has to run before it');

// ---------------------------------------------------------------------------
// Where a note came from.
// The broken version of this reads "from undefined" at a user, and the interesting case — a note
// that outlived the meeting it came out of — is invisible in dev because you have to delete a
// meeting to see it. Hence a test rather than a look.

assert.equal(fromMeeting({ momId: 'm1', momTitle: 'Meeting Aug 23' }), 'from Meeting Aug 23');
assert.equal(fromMeeting({ momId: 'm1', momTitle: undefined }), 'from a deleted meeting',
  'the reference outlives the meeting, and the note says so rather than passing as typed');
assert.equal(fromMeeting({ momId: 'm1', momTitle: '  ' }), 'from a deleted meeting', 'a blank title is not a title');
assert.equal(fromMeeting({}), '', 'a note that never came from a meeting claims nothing');
assert.equal(fromMeeting({ momId: null, momTitle: 'ghost' }), '', 'no momId, no origin, whatever else is lying around');
assert.ok(!fromMeeting({ momId: 'm1', momTitle: undefined }).includes('undefined'));

console.log('self-check: all assertions passed');
