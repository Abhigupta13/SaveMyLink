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
export const config = {
  matcher: [
    // `suspended` is public for the same reason `auth` is: the person who needs to read it is, by
    // definition, the person this gate has just refused. Behind the gate it would bounce them to
    // the sign-in page they cannot get past, and the screen explaining that would never be seen.
    "/((?!api/auth|auth|terms|download|suspended|_next/static|_next/image|.*\\.[a-z0-9]+$|$).*)",
  ]
}
