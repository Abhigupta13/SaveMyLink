// Minimal self-check for the pure helpers. Run: node scripts/self-check.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { extractUrl, hostnameOf, normalizeUrl, youtubeId, appUrl } from '../src/lib/url.ts';
import { escapeRegex } from '../src/lib/regex.ts';
import { envAllowlisted, sarvamSource } from '../src/lib/sarvam.ts';
import { seal, open as unseal } from '../src/lib/secretBox.ts';
import { isAdmin, adminEmails } from '../src/lib/isAdmin.ts';
import { suggestionEmail, inviteEmail, otpEmail } from '../src/lib/mailer.ts';
import { zonedToUtc, safeZone, DEFAULT_TZ, formatTime, formatDay, formatDate, formatInZone } from '../src/lib/time.ts';
import { checkOtp, hashOtp, newOtp, isSixDigits, MAX_OTP_ATTEMPTS } from '../src/lib/otp.ts';
import { projectScope, ownerScope, writerScope, isProjectOwner, isProjectCreator, isProjectViewer, canWrite, withinProject, canAccessDoc } from '../src/lib/scope.ts';
import { mergeContacts, peopleByProject } from '../src/lib/contacts.ts';
import { canWorkOn, canSignOff, needsOwner, assigneeEmailOf, assigneeEmailsOf, assigneesAfterLeaving } from '../src/lib/taskAccess.ts';
import { allowedAssignees, MAX_ASSIGNEES } from '../src/lib/validation.ts';
import { VERBS, phrase, sinceDays, DEFAULT_DAYS, fromMeeting } from '../src/lib/activity.ts';
import { projectNameMap, sharedLabel, needsShareNotice, memberCount } from '../src/lib/visibility.ts';
import { resolveRange, MAX_SPAN_DAYS } from '../src/lib/adminRange.ts';
import { INTRO_STEPS, introProgress, isIntroStep } from '../src/lib/intro.ts';
import { AUDIO_MODELS, audioMime } from '../src/lib/geminiAudio.ts';
import { chooseHandover, isPurgeDue } from '../src/lib/accountDeletion.ts';
import { retrieve, terms } from '../src/lib/retrieval.ts';
import { spendQuestion, dayKey, capMessage, SHARED_OUT_MESSAGE } from '../src/lib/jarvisLimit.ts';
import { isHowTo, EXTRA_PAGES, HOW_IT_WORKS } from '../src/lib/manual.ts';
import { pickVoice } from '../src/lib/voice.ts';

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

// The env allowlist gates a PAID API, so every ambiguous input must fail closed
const allowlist = (v) => { if (v === undefined) delete process.env.SARVAM_ENABLED_EMAILS; else process.env.SARVAM_ENABLED_EMAILS = v; };

allowlist(undefined);
assert.equal(envAllowlisted('a@x.com'), false, 'unset allowlist denies');
allowlist('');
assert.equal(envAllowlisted('a@x.com'), false, 'empty allowlist denies');
allowlist('a@x.com,b@y.com');
assert.equal(envAllowlisted('a@x.com'), true);
assert.equal(envAllowlisted('B@Y.COM'), true, 'match is case-insensitive');
assert.equal(envAllowlisted('c@z.com'), false, 'unlisted address denied');
assert.equal(envAllowlisted(null), false, 'no session email denies');
assert.equal(envAllowlisted(''), false, 'blank email denies');
allowlist(' a@x.com , b@y.com ');
assert.equal(envAllowlisted('a@x.com'), true, 'whitespace around entries tolerated');
allowlist(',,');
assert.equal(envAllowlisted(''), false, 'blank list entries never match a blank email');
allowlist(undefined);

// ---------------------------------------------------------------------------
// WHO pays for a Hindi meeting. Getting this order wrong is not a bug report, it is an invoice:
// resolve to 'env' for someone holding their own key and the founder pays for a customer who
// already paid Sarvam. Every branch, and every way in must fail closed.
const ENV_KEY = 'founder-key';
allowlist('listed@x.com');

// Own key wins over everything — including a grant, the env list, and having no env key at all
assert.equal(sarvamSource({ ownKey: 'k' }, ENV_KEY), 'own');
assert.equal(sarvamSource({ ownKey: 'k', sarvamAccess: true, email: 'listed@x.com' }, ENV_KEY), 'own',
  'their own key is billed to them even when they could have spent ours');
assert.equal(sarvamSource({ ownKey: 'k' }, null), 'own', 'own key needs no env key at all');

// An admin's grant, then the env list — both spending the founder's key
assert.equal(sarvamSource({ sarvamAccess: true }, ENV_KEY), 'granted');
assert.equal(sarvamSource({ email: 'listed@x.com' }, ENV_KEY), 'env');
assert.equal(sarvamSource({ sarvamAccess: true, email: 'listed@x.com' }, ENV_KEY), 'granted',
  'the grant is reported over the env list — the list is on its way out');

// Nobody else, however the fields arrive
assert.equal(sarvamSource({}, ENV_KEY), null, 'a plain account gets nothing');
assert.equal(sarvamSource({ email: 'stranger@x.com' }, ENV_KEY), null);
assert.equal(sarvamSource({ sarvamAccess: false, email: 'stranger@x.com' }, ENV_KEY), null, 'a revoked grant denies');
assert.equal(sarvamSource({ ownKey: '' }, ENV_KEY), null, 'an empty stored key is not a key');
assert.equal(sarvamSource({ ownKey: null, sarvamAccess: null, email: null }, ENV_KEY), null);

// No env key to spend means the two founder-funded routes are refused rather than promised —
// an account that reads as enabled and then dies at upload is the worse failure.
assert.equal(sarvamSource({ sarvamAccess: true }, null), null, 'a grant with no env key is not access');
assert.equal(sarvamSource({ email: 'listed@x.com' }, ''), null, 'the env list with no env key is not access');
allowlist(undefined);

// ---------------------------------------------------------------------------
// A dead Sarvam balance must cost a nicer transcript, not the meeting. Every step BEFORE the job
// is running falls through to the free chain — after that the audio is gone from our side and
// only Sarvam can finish it. This reads the source because the branch only fires while a paid
// third party is failing, which is not a state a test can put it in.
{
  const momSrc = readFileSync(new URL('../src/actions/mom.ts', import.meta.url), 'utf8');
  const paid = momSrc.slice(
    momSrc.indexOf('export async function uploadMomAudioSarvam'),
    momSrc.indexOf('export async function pollMomTranscription'));
  assert.ok(paid.length > 500, 'found the paid upload action');

  const steps = paid.match(/if \(!(job|upload|put|started)\.ok\)/g) || [];
  assert.equal(steps.length, 4, 'four Sarvam steps run before the job exists');
  assert.equal((paid.match(/fallBackToFree\(/g) || []).length, 4, 'and every one of them falls back');
  assert.ok(!/if \(!(job|upload|put|started)\.ok\) return \{ success: false/.test(paid),
    'no pre-job step returns an error instead of falling back');

  // One failure, one fallback. A retry here would let an exhausted balance eat a second call on
  // every single upload for as long as it stayed exhausted.
  assert.equal((paid.match(/createTranscriptionJob\(/g) || []).length, 1, 'Sarvam is never retried');

  // Both paths share ONE free chain, so a fix to it cannot land on one and miss the other.
  assert.equal((momSrc.match(/await freeTranscript\(/g) || []).length, 2,
    'the free path and the paid fallback call the same helper');

  // The extraction prompt is not this round's to touch — r4 said so out loud.
  assert.ok(momSrc.includes('You turn a meeting transcript into minutes plus actionable items.'),
    'the extraction prompt is still there, unrenamed');
}

// ---------------------------------------------------------------------------
// secretBox holds a THIRD PARTY's paid credential — a user's own Sarvam key. The failure that
// matters is not "it did not decrypt", it is "it decrypted to something else and we sent that
// somewhere as a credential". GCM is what makes tampering an error instead of garbage.
{
  const savedSecret = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = 'test-secret-for-self-check';

  const KEY = 'sk_live_abcdef0123456789';
  const box = seal(KEY);
  assert.equal(unseal(box), KEY, 'a sealed key comes back exactly');
  assert.ok(!box.includes(KEY), 'the plaintext never appears in the stored value');
  assert.ok(box.startsWith('v1.'), 'versioned, so the derivation can be rotated later');

  // Same input, different box every time — a reused IV in GCM leaks the plaintext outright,
  // and identical ciphertexts would also tell an attacker which two users share a key.
  assert.notEqual(seal(KEY), seal(KEY), 'a fresh IV per seal');

  // Tampering, in each position a byte could be flipped
  const [v, iv, enc, tag] = box.split('.');
  assert.equal(unseal([v, iv, enc, 'AAAAAAAAAAAAAAAAAAAAAA'].join('.')), null, 'a forged auth tag is refused');
  assert.equal(unseal([v, iv, enc.slice(0, -2) + 'AA', tag].join('.')), null, 'edited ciphertext is refused');
  assert.equal(unseal([v, 'AAAAAAAAAAAAAAAA', enc, tag].join('.')), null, 'a swapped IV is refused');
  assert.equal(unseal(['v2', iv, enc, tag].join('.')), null, 'an unknown version is refused, never guessed at');

  // Junk and absence read the same way: no key. Callers branch on null, so a throw here would
  // turn "this user has no key" into a 500 on the meetings page.
  assert.equal(unseal(''), null);
  assert.equal(unseal(null), null);
  assert.equal(unseal(undefined), null);
  assert.equal(unseal('not-a-box'), null);
  assert.equal(unseal(box.slice(0, 10)), null, 'a truncated box is refused');

  // A different NEXTAUTH_SECRET must NOT open an old box — that is what makes a stolen database
  // useless on its own, and what makes rotating the secret a real (visible) migration.
  process.env.NEXTAUTH_SECRET = 'a-completely-different-secret';
  assert.equal(unseal(box), null, 'the box does not open under another secret');

  // No secret at all is a broken deploy: refuse to seal rather than encrypting under sha256('')
  delete process.env.NEXTAUTH_SECRET;
  assert.throws(() => seal(KEY), /NEXTAUTH_SECRET/, 'never seals under an empty secret');
  assert.equal(unseal(box), null, 'and nothing opens without it');

  if (savedSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = savedSecret;
}

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

// ADMIN_EMAILS="" is a deliberate "nobody is an admin" — an empty string is set, not unset, and
// `||` read the two as the same thing and handed the inbox straight back to the founders.
process.env.ADMIN_EMAILS = '';
assert.deepEqual(adminEmails(), [], 'an empty list means no admins');
assert.equal(isAdmin('swarajdangare2016@gmail.com'), false, 'empty ADMIN_EMAILS does not restore the defaults');
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
// Several people on ONE task, any of whom may tick it.
//
// assigneeId/assigneeEmail stay the primary and assigneeIds/assigneeEmails carry the rest, with
// the invariant assigneeEmail === assigneeEmails[0]. The dangerous case is the SECOND assignee:
// a co-assignee who cannot close their own work is a silent permission strip, and the array
// arriving where a scalar used to be is exactly the shape idOf used to answer '' to.
const THIRD = 'u3';
const shared = (over = {}) => ({ projectId: 'p1', userId: OTHER, assigneeId: OTHER, assigneeEmail: 'boss@x.com',
  assigneeIds: [OTHER, ME], assigneeEmails: ['boss@x.com', 'me@x.com'], ...over });

assert.equal(canWorkOn(shared(), ME, 'me@x.com', false), true, 'a co-assignee ticks the shared task');
assert.equal(canWorkOn(shared(), OTHER, 'boss@x.com', false), true, 'and so does the primary');
assert.equal(canWorkOn(shared(), THIRD, 'nobody@x.com', false), false, 'a stranger still cannot');
// The id branch alone, with no email to fall back on — this is the one idOf used to strip.
assert.equal(canWorkOn({ projectId: 'p1', userId: OTHER, assigneeIds: [OTHER, ME] }, ME, 'me@x.com', false), true,
  'an array of raw ids matches its member');
assert.equal(canWorkOn({ projectId: 'p1', userId: OTHER, assigneeIds: [{ _id: OTHER, email: 'b@x.com' }, { _id: ME, email: 'me@x.com' }] }, ME, 'zz@x.com', false), true,
  'and so does an array of populated users');
assert.equal(canWorkOn({ projectId: 'p1', userId: OTHER, assigneeIds: [OTHER] }, ME, 'me@x.com', false), false,
  'an array that does not contain me opens nothing');
assert.equal(canWorkOn({ projectId: 'p1', userId: OTHER, assigneeIds: [] }, ME, 'me@x.com', false), false,
  'an empty list is not a wildcard');
assert.equal(canWorkOn({ projectId: 'p1', userId: OTHER, assigneeIds: [null, undefined, ''] }, ME, '', false), false,
  'blanks in the list never match a blank id');
// idOf's array branch, reached when a list lands in the SCALAR slot. `typeof [] === 'object'`, so
// before the branch existed it fell into the populated case, found no `_id`, and answered '' —
// silently stripping the assignee's right to tick their own task. It resolves to element zero,
// which is the primary, exactly as assigneeEmail === assigneeEmails[0] says.
assert.equal(canWorkOn({ projectId: 'p1', userId: OTHER, assigneeId: [ME, OTHER] }, ME, 'zz@x.com', false), true,
  'a list in the scalar id slot resolves to its primary instead of to nothing');
assert.equal(canWorkOn({ projectId: 'p1', userId: OTHER, assigneeId: [OTHER, ME] }, ME, 'zz@x.com', false), false,
  'and it is element zero specifically — the scalar slot never means "any of them"');
assert.equal(assigneeEmailOf({ assigneeId: [{ email: 'a@x.com' }], assigneeEmail: 'b@x.com' }), 'b@x.com',
  'a list in the scalar slot is not read as a populated user; the primary email answers');

// Unclaimed co-assignee: they signed up after the task was written, so only the email is there.
assert.equal(canWorkOn({ projectId: 'p1', userId: OTHER, assigneeEmails: ['boss@x.com', 'Me@X.com'] }, ME, 'me@x.com', false), true,
  'an unclaimed co-assignee ticks by email, case-insensitively');
// Sign-off is untouched by any of this: it is the owner's act, never the assignees'.
assert.equal(canSignOff(shared({ completed: true }), false), false, 'a co-assignee cannot sign off their own work');
assert.equal(canSignOff(shared({ completed: true }), true), true, 'an owner still can');

// assigneeEmailsOf: the primary leads, the list follows, duplicates collapse, and a row written
// before multi-assignee existed answers [assigneeEmail] — which is why no migration was needed.
assert.deepEqual(assigneeEmailsOf(shared()), ['boss@x.com', 'me@x.com'], 'primary first, then the rest');
assert.deepEqual(assigneeEmailsOf({ assigneeEmail: 'B@X.com' }), ['b@x.com'], 'a legacy row falls back to its primary');
assert.deepEqual(assigneeEmailsOf({ assigneeEmail: 'a@x.com', assigneeEmails: ['a@x.com'] }), ['a@x.com'], 'the primary is not listed twice');
assert.deepEqual(assigneeEmailsOf({}), [], 'nobody is nobody');
assert.equal(assigneeEmailOf(shared()), 'boss@x.com', 'assigneeEmailOf still answers the primary alone');

// needsOwner: shared work is held while ANY assignee is still in the group — one of three people
// leaving does not make the task ownerless.
assert.equal(needsOwner({ assigneeEmail: 'gone@x.com', assigneeEmails: ['gone@x.com', 'boss@x.com'] }, MEMBERS), false,
  'a remaining co-assignee holds it even when the primary left');
assert.equal(needsOwner({ assigneeEmail: 'boss@x.com', assigneeEmails: ['boss@x.com', 'gone@x.com'] }, MEMBERS), false,
  'and the primary holds it when the co-assignee left');
assert.equal(needsOwner({ assigneeEmail: 'gone@x.com', assigneeEmails: ['gone@x.com', 'also-gone@x.com'] }, MEMBERS), true,
  'only when every last one of them has left does it need an owner');

// assigneesAfterLeaving: which is why the band above can no longer be the compensating control.
// Removing someone from a group removes them from its tasks, so the list they leave behind is
// what gets written back — [0] is the new primary, and empty means genuinely unassigned.
const twoUp = { assigneeEmail: 'boss@x.com', assigneeEmails: ['boss@x.com', 'me@x.com'] };
assert.deepEqual(assigneesAfterLeaving(twoUp, 'BOSS@x.com'), ['me@x.com'],
  'the primary leaving promotes the next assignee, case-insensitively');
assert.deepEqual(assigneesAfterLeaving(twoUp, 'me@x.com'), ['boss@x.com'],
  'a co-assignee leaving does not disturb the primary');
assert.deepEqual(assigneesAfterLeaving({ assigneeEmail: 'gone@x.com' }, 'gone@x.com'), [],
  'the only assignee leaving unassigns the task rather than orphaning it on a stranger');
assert.equal(needsOwner({ assigneeEmails: assigneesAfterLeaving({ assigneeEmail: 'gone@x.com' }, 'gone@x.com') }, MEMBERS), true,
  'and that is exactly the state the "Needs an owner" band fires on');
assert.deepEqual(assigneesAfterLeaving(twoUp, 'nobody@x.com'), ['boss@x.com', 'me@x.com'],
  'a name that was never on it changes nothing');
assert.deepEqual(assigneesAfterLeaving({}, 'gone@x.com'), [], 'an unassigned task stays unassigned');

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

// ---------------------------------------------------------------------------
// Who can see it. The chip must never name a group the user is not in (the map only holds
// their own projects), and the first-share sheet asks once per group, never for personal work,
// and never again after "Don't show this again".
const groups = projectNameMap([{ _id: { toString: () => 'p1' }, name: 'Launch' }, { _id: 'p2', name: 'Site' }]);
assert.equal(sharedLabel({ projectId: 'p1' }, groups), 'Launch');
assert.equal(sharedLabel({ projectId: { toString: () => 'p2' } }, groups), 'Site', 'ObjectId or string, same answer');
assert.equal(sharedLabel({ projectId: 'p9' }, groups), null, 'a group I cannot see gets no name');
assert.equal(sharedLabel({}, groups), null, 'personal');
assert.equal(sharedLabel({ projectId: null }, groups), null);
assert.equal(needsShareNotice([], 'p1'), true, 'first share into a group asks');
assert.equal(needsShareNotice(['p1'], 'p1'), false, 'second share into the same group does not');
assert.equal(needsShareNotice(['p1'], 'p2'), true, 'a different group asks again');
assert.equal(needsShareNotice(['*'], 'p2'), false, '"Don\'t show this again" silences every group');
assert.equal(needsShareNotice([], ''), false, 'personal never asks');
assert.equal(needsShareNotice(undefined, null), false);
assert.equal(needsShareNotice(undefined, 'p1'), true, 'no record yet means never seen');
assert.equal(memberCount({ ownerId: { email: 'a@x.com' }, memberEmails: ['A@x.com', 'b@x.com'], viewerEmails: ['c@x.com'] }), 3, 'owner in memberEmails is not counted twice');
assert.equal(memberCount({ ownerId: 'rawid' }), 1, 'a raw id still counts the creator');
assert.equal(memberCount(null), 0);

// ---------------------------------------------------------------------------
// Getting started. A step is done by the record it leaves, or by an explicit mark for the
// ones that leave none; the meeting comes first because that is the product.
assert.equal(INTRO_STEPS[0].id, 'meeting', 'record a meeting is always the first step');
assert.equal(new Set(INTRO_STEPS.map(s => s.id)).size, INTRO_STEPS.length, 'ids are unique');
const none = introProgress({}, []);
assert.equal(none.remaining, INTRO_STEPS.length, 'a cold account has everything left');
assert.ok(none.steps.every(s => !s.done));
const some = introProgress({ meetings: 1, links: 3 }, ['jarvis']);
assert.equal(some.steps.find(s => s.id === 'meeting').done, true);
assert.equal(some.steps.find(s => s.id === 'link').done, true);
assert.equal(some.steps.find(s => s.id === 'jarvis').done, true, 'a manual step is done by its mark');
assert.equal(some.steps.find(s => s.id === 'note').done, false);
assert.equal(some.remaining, INTRO_STEPS.length - 3);
assert.equal(introProgress({ meetings: 0 }, undefined).steps[0].done, false, 'zero is not done');
assert.equal(introProgress({}, ['sample']).remaining, INTRO_STEPS.length, 'an unknown mark ticks nothing');
assert.equal(isIntroStep('jarvis'), true);
assert.equal(isIntroStep('drop table'), false, 'markIntro refuses anything that is not a step');
assert.equal(isIntroStep(null), false);

// ---------------------------------------------------------------------------
// Free Hindi transcription. MediaRecorder reports `audio/webm;codecs=opus` and Gemini rejects the
// parameterised type — a silent 400 there means every Hindi meeting quietly falls back to English,
// which looks exactly like the bug this round was built to fix.
assert.equal(audioMime('audio/webm;codecs=opus'), 'audio/webm', 'codec parameters are stripped');
assert.equal(audioMime('audio/webm'), 'audio/webm');
assert.equal(audioMime('AUDIO/OGG'), 'audio/ogg', 'lowercased');
assert.equal(audioMime(''), 'audio/webm', 'a stripped Content-Type is still a recording');
assert.equal(audioMime(undefined), 'audio/webm');
assert.equal(audioMime('application/octet-stream'), 'audio/webm', 'never sent as a non-audio type');

// Only auditioned models may serve audio. gemini-3.5-flash is in llm.ts's chat fallback chain and
// has Whisper's exact transliteration bug — it must never leak into this list.
assert.ok(AUDIO_MODELS.length > 0, 'there is always an audio model to try');
assert.ok(!AUDIO_MODELS.includes('gemini-3.5-flash'), '3.5 transliterates English into Devanagari');

// ---------------------------------------------------------------------------
// Narrowing a read to one project. The group workspace hands getNotes/getDocuments a projectId
// that came from the URL, so the id must only ever subtract from what the scope already allowed.
{
  const scope = { $or: [{ userId: 'me' }, { projectId: { $in: ['a', 'b'] } }] };

  // No id: the scope is handed back untouched, so the personal lists are unaffected.
  assert.deepEqual(withinProject(scope), scope, 'no projectId leaves the read scope alone');
  assert.deepEqual(withinProject(scope, ''), scope, 'an empty id is not a filter');

  // With one: BOTH conditions have to hold. A forged id lands outside the $in and matches nothing.
  const narrowed = withinProject(scope, 'c');
  assert.deepEqual(narrowed, { $and: [scope, { projectId: 'c' }] });
  assert.ok(narrowed.$and?.[0]?.$or, 'the membership half survives — it is not replaced');

  // The bug this shape exists to prevent: a spread would drop the $or's projectId and read
  // every group in the database. Guard the actions that call it, not just the helper.
  for (const file of ['../src/actions/note.ts', '../src/actions/document.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(src.includes('withinProject('), `${file} narrows through withinProject`);
    assert.ok(!/\{\s*\.\.\.scope,\s*projectId\s*\}/.test(src), `${file} never spreads the id over the scope`);
  }
}

// ---------------------------------------------------------------------------
// Who may touch one record. The project half is handed in (that answer needs a database); the
// half asserted here is the one that was missing — a record with NO project is not unowned, and
// reading "no projectId" as "no gate" left every personal meeting readable, re-transcribable and
// editable by any signed-in user who had its id.
{
  const personal = { userId: 'me' };
  const shared = { projectId: 'p1', userId: 'me' };

  assert.equal(canAccessDoc(personal, 'me', false), true, 'my own personal record is mine');
  assert.equal(canAccessDoc(personal, 'stranger', false), false, 'a stranger cannot touch a personal record');
  assert.equal(canAccessDoc(personal, 'stranger', true), false, 'and no project membership can grant it');

  assert.equal(canAccessDoc(shared, 'me', true), true, 'a member reaches a project record');
  assert.equal(canAccessDoc(shared, 'someone-else', true), true, 'membership, not authorship, is the gate there');
  assert.equal(canAccessDoc(shared, 'me', false), false, 'non-members refused even on a record they created');

  // Fails closed on missing halves rather than matching everything to everything.
  assert.equal(canAccessDoc({}, 'me', false), false, 'a record with no owner belongs to nobody');
  assert.equal(canAccessDoc(personal, '', false), false, 'no session id, no access');
  assert.equal(canAccessDoc(personal, undefined, false), false);
  assert.equal(canAccessDoc({ userId: { toString: () => 'me' } }, 'me', false), true, 'an ObjectId compares as a string');

  // The five MOM actions that gate an existing meeting must go through it. `memberSession(momScope(mom))`
  // is the shape that was wrong: it asks about a project the personal case does not have.
  const mom = readFileSync(new URL('../src/actions/mom.ts', import.meta.url), 'utf8');
  assert.ok(!mom.includes('momScope'), 'mom.ts no longer gates an existing meeting on its projectId alone');
  assert.equal((mom.match(/canAccess\(mom,/g) || []).length, 5, 'poll, extract, confirm, impact and update each check the document');
}

// ----------------------------------------------------------------------------------------------
// The /admin range picker hands the server a window, and a window from a client is untrusted: a
// reversed pair, a future date or a decade-wide span would each break a query or the chart. The
// clamping lives in one pure function so these rules can be asserted rather than hoped for.
{
  const DAY = 86_400_000;
  const now = Date.parse('2026-08-26T10:00:00Z');

  assert.equal(resolveRange('all', now).from.getTime(), 0, "'all time' starts at the epoch");
  assert.equal(resolveRange('7d', now).from.getTime(), now - 7 * DAY, '7d looks back exactly a week');
  assert.equal(resolveRange(undefined, now).from.getTime(), now - 7 * DAY, 'no choice means the 7-day default');
  assert.equal(resolveRange('nonsense', now).from.getTime(), now - 7 * DAY, 'an unknown preset falls back, it does not throw');

  // Reversed input is a real mis-click on two date fields, not a hypothetical.
  const flipped = resolveRange({ from: '2026-08-20', to: '2026-08-10' }, now);
  assert.ok(flipped.from <= flipped.to, 'a reversed custom range is put back in order');

  // A window may never run past now, or the trend chart grows empty bars into the future.
  const future = resolveRange({ from: '2026-08-01', to: '2027-01-01' }, now);
  assert.ok(future.to.getTime() <= now, 'a custom range never reaches past the present');

  const huge = resolveRange({ from: '2000-01-01', to: '2026-08-26' }, now);
  assert.ok((huge.to - huge.from) / DAY <= MAX_SPAN_DAYS + 1, 'a decade-wide span is capped');

  assert.equal(resolveRange('7d', now).buckets.unit, 'day', 'a short window charts by day');
  assert.equal(resolveRange('all', now).buckets.unit, 'month', 'all-time charts by month, not thousands of days');
  assert.ok(resolveRange('7d', now).buckets.keys.length >= 7, 'every day in the window gets a bucket, including empty ones');
  // 'all' starts at the epoch, so the month walk has no data-driven stop and only the cap holds it.
  // At 92 it drew ninety empty bars back to 2019 and squeezed the real months into three pixels.
  assert.ok(resolveRange('all', now).buckets.keys.length <= 24, 'all-time charts at most two years of months, so the bars stay wide enough to see');
}

// ----------------------------------------------------------------------------------------------
// Account deletion. Two decisions with no undo: who inherits a group whose creator is leaving, and
// when a retained stub is finally purged. Getting the first wrong orphans a team's shared work;
// getting the second wrong either keeps data too long or deletes it early — both break the
// disclosed-retention promise in /terms.
{
  const OLD = '2026-01-01', MID = '2026-04-01', NEW = '2026-08-01';

  // Oldest CO-OWNER wins, ahead of any member however old.
  assert.deepEqual(
    chooseHandover([{ email: 'b@x', createdAt: MID }, { email: 'a@x', createdAt: OLD }],
                   [{ email: 'm@x', createdAt: OLD }]),
    { action: 'transfer', email: 'a@x' }, 'oldest co-owner inherits');

  // No co-owner → oldest MEMBER is promoted.
  assert.deepEqual(
    chooseHandover([], [{ email: 'y@x', createdAt: NEW }, { email: 'x@x', createdAt: MID }]),
    { action: 'promote', email: 'x@x' }, 'oldest member is promoted when there is no co-owner');

  // Nobody else registered → the group is deleted, not left ownerless.
  assert.deepEqual(chooseHandover([], []), { action: 'delete' }, 'sole member means delete');

  // createdAt shapes are mixed in the wild (Date, ISO string, ms) — all must compare correctly.
  assert.deepEqual(
    chooseHandover([{ email: 'ms@x', createdAt: Date.parse(OLD) }, { email: 'd@x', createdAt: new Date(NEW) }], []),
    { action: 'transfer', email: 'ms@x' }, 'oldest wins across Date / string / number');

  // isPurgeDue: the 90-day line, and everything that must fail closed around it.
  const now = Date.parse('2026-08-26T00:00:00Z');
  const daysAgo = (n) => new Date(now - n * 86_400_000);
  assert.equal(isPurgeDue(daysAgo(91), now), true, '91 days is past the 90-day window');
  assert.equal(isPurgeDue(daysAgo(89), now), false, '89 days is still within retention');
  assert.equal(isPurgeDue(daysAgo(90), now), true, 'exactly 90 days is due');
  assert.equal(isPurgeDue(null, now), false, 'a live account (no deletedAt) is never purged');
  assert.equal(isPurgeDue(undefined, now), false, 'missing deletedAt is never purged');
  assert.equal(isPurgeDue('not a date', now), false, 'an unparseable stamp fails closed, it does not throw');
}

// ----------------------------------------------------------------------------------------------
// Jarvis retrieval. This decides what the assistant is allowed to see when it answers, so it has
// two jobs and both are load-bearing: pick the lines that actually answer the question, and never
// widen what is readable. The second one is a security property — scope comes from myProjectFilter
// upstream, and retrieval must be provably incapable of adding to it.
{
  const DAY = 86_400_000;
  const NOW = Date.parse('2026-08-26T12:00:00Z');
  const ago = (d) => NOW - d * DAY;
  const item = (o) => ({ body: '', line: `${o.type.toUpperCase()} id=${o.id} | ${o.title} | ${o.body || ''}`, ...o });

  const vault = [
    item({ id: 'l1', type: 'link', title: 'Ray.so — code screenshots', at: ago(300) }),
    item({ id: 'l2', type: 'link', title: 'Tailwind docs', at: ago(2) }),
    item({ id: 't1', type: 'task', title: 'Call the stainer vendor', at: ago(3), overdue: true }),
    item({ id: 't2', type: 'task', title: 'Read the annual report', at: ago(120), overdue: false }),
    item({ id: 'm1', type: 'mom', title: 'Weekly sync', at: ago(1), body: 'block tray elevator decided' }),
    item({ id: 'c1', type: 'contact', title: 'Abhishek Kumar', at: ago(40), body: '9876543210' }),
  ];
  const ids = (rows) => rows.map(r => r.id);

  // "What is urgent today" shares no words with anything. The overdue task must still come first,
  // and an old link must not — this is the exact question the old character-budget dump got wrong.
  const urgent = retrieve(vault, 'what is urgent today?', { now: NOW, limit: 3 });
  assert.equal(urgent[0].id, 't1', 'an overdue task leads "what is urgent today"');
  assert.ok(!ids(urgent).includes('l1'), 'a 300-day-old link is not what "urgent" means');

  // Naming a saved item exactly beats every other signal, recency included.
  assert.equal(retrieve(vault, 'tell me about Ray.so — code screenshots', { now: NOW, limit: 1 })[0].id, 'l1',
    'an exact title match wins outright');

  // Two items matching identically: the newer one goes in.
  const tie = [
    item({ id: 'old', type: 'note', title: 'Vendor pricing', at: ago(200) }),
    item({ id: 'new', type: 'note', title: 'Vendor pricing', at: ago(1) }),
  ];
  assert.equal(retrieve(tie, 'vendor pricing', { now: NOW, limit: 1 })[0].id, 'new', 'recency breaks a tie');

  // A type word in the question pulls that type up without inventing a match.
  assert.ok(ids(retrieve(vault, 'whose phone number do I have?', { now: NOW, limit: 2 })).includes('c1'),
    '"phone number" favours a contact');

  // THE SCOPE PROPERTY. Retrieval returns members of the array it was handed and nothing else, so
  // an item the scoped query never fetched cannot reach the prompt — even when the question quotes
  // its title word for word.
  const someoneElses = item({ id: 'x1', type: 'note', title: 'Acme payroll spreadsheet', at: ago(0) });
  const mine = retrieve(vault, 'show me the Acme payroll spreadsheet', { now: NOW, limit: 40 });
  assert.ok(!ids(mine).includes('x1'), 'an item outside the caller-supplied set can never be retrieved');
  assert.ok(mine.every(r => vault.includes(r)), 'every retrieved row is one of the rows passed in');
  assert.ok(!vault.includes(someoneElses), 'the out-of-scope fixture was never in the corpus, which is the point');

  // The budget holds both ways: a count cap and a character cap.
  assert.equal(retrieve(vault, 'anything', { now: NOW, limit: 2 }).length, 2, 'the line limit is respected');
  const fat = [item({ id: 'big', type: 'document', title: 'Contract', line: 'x'.repeat(5000) }), ...vault];
  assert.ok(!ids(retrieve(fat, 'contract', { now: NOW, maxChars: 1000 })).includes('big'),
    'one huge document cannot swallow the whole character budget');

  // A pinned id is what makes "add that one to my tasks" work: it stays in the prompt whatever it
  // scores. It is still only ever an id from the caller's own scoped set.
  assert.ok(ids(retrieve(vault, 'unrelated words entirely', { now: NOW, limit: 1, pinned: ['t2'] })).includes('t2'),
    'a pinned item from the previous answer stays resolvable');
  assert.ok(!ids(retrieve(vault, 'unrelated', { now: NOW, limit: 6, pinned: ['x1'] })).includes('x1'),
    'pinning an id we never fetched still cannot conjure it');

  assert.deepEqual(retrieve([], 'anything', { now: NOW }), [], 'an empty vault returns nothing, it does not throw');

  // Hindi and Hinglish reach Jarvis constantly; the tokenizer must not drop Devanagari.
  assert.ok(terms('कल की मीटिंग').length > 0, 'Devanagari survives tokenizing');
  assert.ok(!terms('what is my task').includes('is'), 'stop words are dropped');
}

// ----------------------------------------------------------------------------------------------
// Jarvis's daily allowance. Two ways to get this wrong and both are visible to users: refuse
// someone who still has questions left, or roll the day over on the server's clock so an Indian
// user's allowance resets at 5:30 in the morning.
{
  const T = '2026-08-26';
  const fresh = (n) => ({ count: n, date: T });

  assert.equal(spendQuestion(null, T, 5).allowed, true, 'a brand-new account may ask');
  assert.equal(spendQuestion(null, T, 5).count, 1, 'the first question counts as one');
  assert.equal(spendQuestion(null, T, 5).remaining, 4, 'four left after the first of five');
  assert.equal(spendQuestion(fresh(4), T, 5).allowed, true, 'the fifth question is still allowed');
  assert.equal(spendQuestion(fresh(4), T, 5).remaining, 0, 'and it is the last one');
  assert.equal(spendQuestion(fresh(5), T, 5).allowed, false, 'the sixth is refused');
  assert.equal(spendQuestion(fresh(5), T, 5).count, 5, 'a refused question does not increment the count');

  // Yesterday's count is not today's problem — no reset job, no cron, no midnight edge case.
  assert.equal(spendQuestion({ count: 99, date: '2026-08-25' }, T, 5).allowed, true, 'a stale day reads as zero used');
  assert.equal(spendQuestion({ count: 99, date: '2026-08-25' }, T, 5).count, 1, 'and starts counting again at one');

  // Admins are never refused, and are marked as uncounted rather than given a fake number.
  assert.equal(spendQuestion(fresh(500), T, 5, true).allowed, true, 'an admin is exempt');
  assert.equal(spendQuestion(fresh(500), T, 5, true).remaining, -1, 'an exempt caller reports "not counted"');

  // Garbage in the stored field must fail OPEN (the user keeps their questions), never closed.
  assert.equal(spendQuestion({ count: undefined, date: T }, T, 5).allowed, true, 'a missing count is zero used');
  assert.equal(spendQuestion({ count: -7, date: T }, T, 5).count, 1, 'a negative stored count cannot mint questions');
  assert.equal(spendQuestion({ count: 'x', date: T }, T, 5).allowed, true, 'an unparseable count does not lock anyone out');

  // The day is the ASKER's day. 00:30 in Kolkata is still the previous day in UTC; if the server's
  // clock decided, the allowance would roll over five and a half hours early.
  const justAfterMidnightIST = Date.parse('2026-08-26T19:00:00Z');   // 00:30 on the 27th in Kolkata
  assert.equal(dayKey(justAfterMidnightIST, 'Asia/Kolkata'), '2026-08-27', 'the day is read in the user\'s zone');
  assert.equal(dayKey(justAfterMidnightIST, 'UTC'), '2026-08-26', 'and it really does differ from the server\'s');
  assert.equal(dayKey(justAfterMidnightIST, 'Not/AZone'), '2026-08-27', 'a junk zone falls back, it does not throw');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(dayKey(Date.now(), 'America/New_York')), 'the key is a plain sortable date');

  // The two messages are different facts and must not collapse into one another.
  assert.ok(capMessage(5).includes('5'), 'the cap message names the actual limit');
  assert.ok(!SHARED_OUT_MESSAGE.includes('went wrong'), 'a spent shared quota is never reported as a generic failure');
}

// ----------------------------------------------------------------------------------------------
// The how-to gate. It decides whether the app's manual joins the prompt, and it has to be wrong in
// the cheap direction: a false positive costs a few hundred tokens on one turn, a false negative
// means the assistant cannot explain its own product. Loading it every turn is the inflation the
// retrieval work exists to remove, so "always true" is not an option either.
{
  for (const q of [
    'how do I share a note with my team?',
    'How do I record a meeting',
    'where is the private safe?',
    'how does this app work',
    'how to add someone to a project',
    'explain what a group is',
    'what can you do?',
    'meeting kaise record karu',
    'प्राइवेट सेफ कहाँ है',
    'can you delete a task?',
  ]) assert.equal(isHowTo(q), true, `should load the manual: "${q}"`);

  for (const q of [
    'what is urgent today?',
    'what did the vendor say about the pump price',
    'add a task to call Priya tomorrow at 5pm',
    'show my tasks',
    'save this link https://ray.so',
    'who is Abhishek',
    'and the one after that?',
  ]) assert.equal(isHowTo(q), false, `should NOT load the manual: "${q}"`);

  assert.equal(isHowTo(''), false, 'an empty question loads nothing');
  assert.equal(isHowTo(null), false, 'a missing question does not throw');

  // The manual must never contradict /terms — the Private Safe is a lock on a screen, not crypto.
  assert.ok(/not encryption/.test(HOW_IT_WORKS), 'the manual repeats the honest Private Safe line');
  assert.ok(/never shared/.test(HOW_IT_WORKS), 'the manual states that links are never shared');
  assert.ok(EXTRA_PAGES.every(p => p.href.startsWith('/')), 'every extra destination is an in-app route');
}

// ----------------------------------------------------------------------------------------------
// The voice rule: male on the non-Sarvam path (browser / Gemini TTS), female when Sarvam speaks.
// The Web Speech API reports no gender, so this is name matching, and the interesting cases are
// the ones where it must NOT guess: language always outranks gender, and a device with nothing
// installed must leave the voice unset rather than pick a wrong one.
{
  const V = (name, lang, extra = {}) => ({ name, lang, ...extra });
  const chrome = [
    V('Google UK English Female', 'en-GB'),
    V('Google UK English Male', 'en-GB'),
    V('Google US English', 'en-US', { default: true }),
    V('Google हिन्दी', 'hi-IN'),
    V('Microsoft Heera - English (India)', 'en-IN'),
    V('Microsoft Ravi - English (India)', 'en-IN'),
  ];

  assert.equal(pickVoice(chrome, 'en-GB', 'male').name, 'Google UK English Male', 'male is picked when named');
  assert.equal(pickVoice(chrome, 'en-GB', 'female').name, 'Google UK English Female', 'and female when asked for');
  assert.equal(pickVoice(chrome, 'en-IN', 'female').name, 'Microsoft Heera - English (India)', 'a known female name is recognised');

  // Language beats gender. A male English voice reading Devanagari is worse than a Hindi voice.
  assert.equal(pickVoice(chrome, 'hi-IN', 'male').lang, 'hi-IN', 'the requested language wins over the gender');

  // No male voice in that language at all: fall back within the language, never out of it.
  const femaleOnly = [V('Google UK English Female', 'en-GB'), V('Zira', 'en-US')];
  assert.equal(pickVoice(femaleOnly, 'en-GB', 'male').lang, 'en-GB', 'no male voice still keeps the language');

  // A regional variant is close enough when the exact tag is missing.
  assert.equal(pickVoice([V('Microsoft Ravi - English (India)', 'en-IN')], 'en-GB', 'male').lang, 'en-IN',
    'en-IN answers for en-GB rather than nothing');

  // Nothing installed → null, and the caller leaves utterance.voice alone, exactly as before.
  assert.equal(pickVoice([], 'en-IN', 'male'), null, 'an empty voice list picks nothing');
  assert.equal(pickVoice(null, 'en-IN', 'male'), null, 'a missing voice list does not throw');
  assert.equal(pickVoice(undefined, '', 'male'), null, 'no language and no voices is still safe');

  // A name that says neither is preferred over one that says the OPPOSITE.
  const mixed = [V('Microsoft Zira - English (US)', 'en-US'), V('Samantha', 'en-US'), V('Alex', 'en-US')];
  assert.equal(pickVoice(mixed, 'en-US', 'male').name, 'Alex', 'a known male name beats two known female ones');
  const noMale = [V('Microsoft Zira - English (US)', 'en-US'), V('Announcer', 'en-US')];
  assert.equal(pickVoice(noMale, 'en-US', 'male').name, 'Announcer', 'an unlabelled voice beats a known-female one');

  // Underscored tags turn up on Android.
  assert.equal(pickVoice([V('en_IN male', 'en_IN')], 'en-IN', 'male').lang, 'en_IN', 'en_IN and en-IN are the same language');
}

// ----------------------------------------------------------------------------------------------
// isProjectCreator, across BOTH shapes ownerId arrives in. A .lean() read gives a mongoose
// ObjectId, which is an object — and "it is an object, so it is a populated user" was the whole
// test. The consequence was silent and server-side only: canWrite said no on a group you created
// yourself, Jarvis dropped the write, and told you it had done it.
{
  const asId = { ownerId: 'u1', memberEmails: [], viewerEmails: [] };
  const asObjectIdLike = { ownerId: { toString: () => 'u1' }, memberEmails: [], viewerEmails: [] };
  const asPopulated = { ownerId: { _id: 'u1', email: 'me@x.com' }, memberEmails: [], viewerEmails: [] };

  assert.equal(isProjectCreator(asId, null, 'u1'), true, 'a plain id matches on userId');
  assert.equal(isProjectCreator(asObjectIdLike, 'me@x.com', 'u1'), true, 'an ObjectId is an id, not a populated user');
  assert.equal(isProjectCreator(asPopulated, 'me@x.com', null), true, 'a populated owner still matches on email');
  assert.equal(isProjectCreator(asPopulated, null, 'u1'), true, 'a populated owner also matches on its _id');

  // And still says no to everyone else, in every shape.
  assert.equal(isProjectCreator(asObjectIdLike, 'me@x.com', 'u2'), false, 'a different user is not the creator');
  assert.equal(isProjectCreator(asPopulated, 'someone@else.com', 'u2'), false, 'neither email nor id matching means no');
  assert.equal(isProjectCreator(asId, 'me@x.com', null), false, 'an id with no userId to compare against is not a match');
  assert.equal(isProjectCreator({ ownerId: null }, 'me@x.com', 'u1'), false, 'no owner is never a creator');

  // The consequence the bug actually had: writing into your own group.
  assert.equal(canWrite(asObjectIdLike, 'me@x.com', 'u1'), true, 'the creator may write to a group read with .lean()');
  assert.equal(canWrite(asObjectIdLike, 'stranger@x.com', 'u2'), false, 'and a stranger still may not');
}

// ----------------------------------------------------------------------------------------------
// Who may be PUT on a task. assigneeEmails arrives from a browser and lands in the named person's
// My Tasks, their search, the weekly digest, their phone reminders and — through Jarvis — an LLM
// prompt holding write primitives. Unchecked, it is not an assignment: it is a delivery mechanism
// for whatever the caller typed into the title, aimed at twenty strangers at once.
{
  const GROUP = ['Owner@x.com', 'member@x.com', 'client@x.com'];   // owner ∪ members ∪ viewers

  assert.deepEqual(allowedAssignees('member@x.com', [], GROUP), ['member@x.com']);
  assert.deepEqual(allowedAssignees('MEMBER@X.com', null, GROUP), ['member@x.com'], 'lowercased on both sides');
  assert.deepEqual(allowedAssignees(' member@x.com ', [], GROUP), ['member@x.com'], 'trimmed, not refused for it');
  assert.deepEqual(allowedAssignees('owner@x.com', ['client@x.com'], GROUP), ['owner@x.com', 'client@x.com'],
    'the primary leads, so assigneeEmail === assigneeEmails[0] still holds');

  // Not in the group: dropped in silence, exactly like a chip nobody ticked. Refusing the whole
  // write instead would turn one stale address into a save that will not go through.
  assert.deepEqual(allowedAssignees('stranger@x.com', [], GROUP), [], 'a non-member cannot be given work');
  assert.deepEqual(allowedAssignees('member@x.com', ['stranger@x.com'], GROUP), ['member@x.com'],
    'one outsider in the list does not travel, and does not break the rest');
  assert.deepEqual(allowedAssignees('member@x.com', [], []), [], 'an empty roster admits nobody');
  assert.deepEqual(allowedAssignees(null, undefined, GROUP), [], 'nothing sent is nobody assigned');

  // Not an address: refused before it can be stored, mailed, or matched on at signup.
  for (const junk of ['not-an-email', 'a@b', 'a@b.c', 'two words@x.com', 'a@b.com<script>'])
    assert.deepEqual(allowedAssignees(junk, [], [...GROUP, junk]), [],
      `not an address, even when the roster somehow contains it: "${junk}"`);

  // The cap is what stops one action writing an unbounded $in and an unbounded document.
  const crowd = Array.from({ length: 30 }, (_, i) => `p${i}@x.com`);
  assert.equal(allowedAssignees(crowd[0], crowd, crowd).length, MAX_ASSIGNEES, 'the cap holds against a full roster');
  assert.deepEqual(allowedAssignees('member@x.com', ['MEMBER@x.com', 'member@x.com'], GROUP), ['member@x.com'],
    'nobody is listed twice, whatever the casing');
}

// ----------------------------------------------------------------------------------------------
// Jarvis and the checkbox must answer to the SAME authority.
//
// The gate on the Jarvis path was a scoped find plus "am I a writer in this group", which never
// consulted canWorkOn — so a plain member could ask Jarvis to complete, reopen, retitle or rewrite
// a teammate's task while the checkbox on /tasks correctly refused her. And its Object.assign
// skipped the rule that reopening drops the sign-off, which is what keeps "signed off" a subset of
// "completed" on the funnel. Both are structural, so they are asserted structurally.
{
  const jarvis = readFileSync(new URL('../src/actions/jarvis.ts', import.meta.url), 'utf8');
  const task = readFileSync(new URL('../src/actions/task.ts', import.meta.url), 'utf8');
  const between = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to));

  const patch = between(jarvis, "a?.type === 'update_task'", "a?.type === 'update_note'");
  assert.ok(patch.length > 500, 'found the Jarvis update_task branch');
  assert.ok(patch.includes('await updateTask('), 'the field patch goes through updateTask');
  assert.ok(patch.includes('await toggleTask('), 'and a completion change through toggleTask');
  assert.ok(!/Object\.assign\(task,/.test(patch), 'Jarvis never assigns a task field itself');
  assert.ok(!/task\.save\(\)/.test(patch), 'and never saves one behind those gates');

  const make = between(jarvis, "a?.type === 'create_task'", "a?.type === 'create_note'");
  assert.ok(make.includes('await createTask('), 'and it creates through createTask, which checks the assignee');
  assert.ok(!/Task\.create\(/.test(jarvis), 'jarvis.ts writes no task rows of its own at all');

  // The authority both of those inherit.
  assert.equal((task.match(/canWorkOn\(task,/g) || []).length, 2, 'updateTask and toggleTask each ask canWorkOn');
  assert.ok(task.includes('if (!task.completed) task.set({ signedOffBy: undefined, signedOffAt: undefined })'),
    'reopening drops the sign-off, on the one path everything now reopens through');
}

// ----------------------------------------------------------------------------------------------
// Moving a task OUT of a group cannot smuggle assignees with it. The clear used to run inside the
// projectId branch and the assignee block ran after it, re-setting them from client input: a
// member who was an assignee could take the owner's task private, keep write on it through the
// assignee branch of canWorkOn, and leave the owner unable to see or delete it.
{
  const task = readFileSync(new URL('../src/actions/task.ts', import.meta.url), 'utf8');
  assert.ok(task.indexOf('if (!task.projectId) {') > task.indexOf('You cannot move work into that group'),
    'where the task lands is settled before who is on it');
  assert.ok(/if \(!task\.projectId\) \{[\s\S]{0,400}?\} else if \(data\.assigneeEmail !== undefined/.test(task),
    'assignee input is ignored outright when the task is being made personal');
  // One list builder, and it is the pure rule narrowed by the real group roster.
  assert.equal((task.match(/await assigneeList\(/g) || []).length, 2, 'createTask and updateTask share it');
  assert.ok(task.includes('allowedAssignees(primary, list, await projectPeople(projectId))'),
    'nothing else decides who may be assigned');
}

console.log('self-check: all assertions passed');
