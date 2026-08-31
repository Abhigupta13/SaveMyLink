import { NextRequest, NextResponse } from 'next/server';

/**
 * Step one of native Google sign-in: the page the Chrome Custom Tab opens on.
 *
 * All it does is post the browser into NextAuth's Google flow. It exists because NextAuth v4 will
 * not start OAuth from a GET — `/api/auth/signin/google` needs a POST carrying a CSRF token — so
 * something has to fetch that token and submit the form. Doing it here rather than in the WebView
 * is the whole point: from here on, everything happens in a real Chrome, which is the only user
 * agent Google will accept.
 *
 * The CSRF token comes from NextAuth's own /api/auth/csrf endpoint rather than being minted here.
 * Reimplementing the token/hash pair would mean copying an internal detail that is free to change
 * under a patch release, and getting it subtly wrong looks like a random sign-in failure.
 */

// sha256 rendered base64url is 43 characters; the range allows for a future change of hash without
// making this a second place that has to be edited in lockstep.
const CHALLENGE = /^[A-Za-z0-9_-]{32,128}$/;

export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('challenge') ?? '';

  // Validated, not escaped. The value is interpolated into a script below, so the only safe move is
  // to refuse anything that is not already inert — a character class with no quote, angle bracket
  // or backslash in it cannot break out of the string it lands in.
  if (!CHALLENGE.test(challenge)) {
    return new NextResponse('Bad request: missing or malformed challenge.', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const callbackUrl = `/api/auth/native/done?challenge=${challenge}`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signing in…</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100dvh; display:flex; align-items:center; justify-content:center;
         font: 500 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background:#faf9f7; color:#3d3a36; padding:24px; text-align:center; }
  @media (prefers-color-scheme: dark) { body { background:#1c1b19; color:#e8e4de; } }
  a { color:#c96442; }
</style>
</head><body>
<p id="msg">Taking you to Google…</p>
<noscript><p>JavaScript is required. <a href="/auth/signin">Open the sign-in page instead.</a></p></noscript>
<script>
(async function () {
  try {
    var res = await fetch('/api/auth/csrf', { credentials: 'include' });
    var data = await res.json();
    if (!data || !data.csrfToken) throw new Error('no csrf token');
    var form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/auth/signin/google';
    function add(name, value) {
      var input = document.createElement('input');
      input.type = 'hidden'; input.name = name; input.value = value;
      form.appendChild(input);
    }
    add('csrfToken', data.csrfToken);
    add('callbackUrl', '${callbackUrl}');
    document.body.appendChild(form);
    form.submit();
  } catch (e) {
    // A dead end here is a blank tab and a person with no idea what happened, so say something.
    document.getElementById('msg').innerHTML =
      'Could not reach Google sign-in. Close this tab and use your email and password instead.';
  }
})();
</script>
</body></html>`;

  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Nothing here is worth keeping; a cached copy would carry a stale challenge.
      'cache-control': 'no-store',
    },
  });
}
