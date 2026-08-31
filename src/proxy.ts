import { withAuth } from "next-auth/middleware"

/* Next 16 renamed the `middleware` convention to `proxy`; the old filename still works but is
   deprecated. The runtime here is nodejs and cannot be configured, which is fine — withAuth only
   verifies the session cookie. */
export default withAuth({
  pages: {
    signIn: "/auth/signin",
  },
})

// Everything is behind auth except the pages a stranger has to be able to reach: the landing page,
// the auth screens, the APK download and the terms it links to. A download link that demands a
// login before it will hand over the app is a link nobody installs.
//
// Files are excluded by having an extension rather than by name. The old list named favicon.ico
// and app-debug.apk one at a time, and so missed app/icon.svg and app/apple-icon.png — Next
// serves those metadata routes from the app root, not from _next/static, so a signed-out visitor
// asking for the tab icon got a 307 to the sign-in page and no icon on the two screens every new
// visitor sees first. No route in this app has a dot in it, so the shape is safe to key on.
// `api/drive` is exempt because the Android app runs Drive consent in a Chrome Custom Tab, which
// has its own cookie jar and therefore no session — this gate bounced it to the sign-in page before
// either route could look at what it was actually holding. Both routes authorize themselves and
// always did:
//
//   connect   session, or an HMAC handoff token mintable only by a POST from a signed-in WebView
//   callback  a signed state whose uid must match the session; in the native flow the signature IS
//             the proof, and the single-use nonce cookie still binds it to the tab that started
//
// This is narrower than it looks — those are the only two routes under api/drive. `api/files` stays
// behind the gate, because that one hands out file bytes.
// Each literal is followed by `(?:/|$)` so it matches a whole path SEGMENT, not a prefix. Without
// that boundary the exemptions leak to any route that merely starts with the same characters —
// `/downloads`, `/authors`, `/terms-of-service`, `/api/drives` would all have been waved past the
// gate. None of those exist today, which is exactly what makes it worth fixing now: the failure
// direction is "accidentally public", and whoever adds one of those routes in six months would
// inherit it silently. Same class of bug as the `startsWith('/auth')` one in lib/nav.ts.
//
// The last two alternatives stay OUTSIDE the boundary group on purpose — they are shapes, not path
// literals. `.*\.[a-z0-9]+$` is "anything with a file extension" (that is what keeps the APK, the
// favicon and app/icon.svg reachable to a signed-out visitor), and `$` is the landing page.
export const config = {
  matcher: [
    // `suspended` is public for the same reason `auth` is: the person who needs to read it is, by
    // definition, the person this gate has just refused. Behind the gate it would bounce them to
    // the sign-in page they cannot get past, and the screen explaining that would never be seen.
    "/((?!(?:api/auth|api/drive|auth|terms|download|suspended|_next/static|_next/image)(?:/|$)|.*\\.[a-z0-9]+$|$).*)",
  ]
}
