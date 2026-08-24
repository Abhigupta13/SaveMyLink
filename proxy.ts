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
export const config = {
  matcher: [
    "/((?!api/auth|auth|terms|download|app-debug.apk|_next/static|_next/image|favicon.ico|$).*)",
  ]
}
