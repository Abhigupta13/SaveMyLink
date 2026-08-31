import { NextResponse } from 'next/server';

/**
 * The page a Chrome Custom Tab shows on its way back into the app.
 *
 * Deliberately an HTML page rather than a 302 to the custom scheme. Chrome declines to follow a
 * *server* redirect into an external app in several configurations, and when it declines the result
 * is a blank tab and a person with no idea whether what they just did worked. A script navigation
 * covers the normal case and the button covers the rest — at this point in either flow the work has
 * already succeeded server-side, so stranding someone here would be the worst possible moment.
 */
export function nativeReturnPage(deepLink: string, message: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Returning to the app…</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100dvh; display:flex; flex-direction:column; align-items:center;
         justify-content:center; gap:16px; padding:24px; text-align:center;
         font: 500 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background:#faf9f7; color:#3d3a36; }
  @media (prefers-color-scheme: dark) { body { background:#1c1b19; color:#e8e4de; } }
  a.btn { display:inline-block; background:#c96442; color:#fff; text-decoration:none;
          padding:12px 22px; border-radius:12px; font-weight:700; }
  a { color:#c96442; }
</style>
</head><body>
<p>${message}</p>
<a class="btn" href="${deepLink}">Open ALL you need</a>
<script>location.replace(${JSON.stringify(deepLink)});</script>
</body></html>`;

  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
