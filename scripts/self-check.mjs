// Minimal self-check for the pure helpers. Run: node scripts/self-check.mjs
import assert from 'node:assert';
import { extractUrl, hostnameOf, normalizeUrl, youtubeId } from '../src/lib/url.ts';
import { escapeRegex } from '../src/lib/regex.ts';
import { hinglishEnabled } from '../src/lib/sarvam.ts';

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

console.log('self-check: all assertions passed');
