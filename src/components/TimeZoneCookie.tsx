'use client';
import { useEffect } from 'react';

/**
 * Publishes the browser's IANA time zone to the server as a cookie.
 *
 * Every clock the user reads has to be their clock. On the client that is free — omit the zone and
 * toLocaleString uses the device's. On the SERVER there is no device, so the same call silently
 * uses the runtime's zone, which on Vercel is UTC: a task due 11:30 am in India rendered as
 * "6:00 am" in the weekly digest while the Jarvis chat beside it said 11:30. Same instant, two
 * clocks, and the one that was wrong was the one that looked authoritative.
 *
 * A cookie rather than a prop drilled from a client component, for the same reason `theme` is a
 * cookie: the server can then render the right value on the FIRST pass, with no flash of a wrong
 * time and no hydration mismatch to suppress. It also means anything server-side that later needs
 * a zone — the digest email, a scheduled reminder — has one to read.
 *
 * Written on every mount rather than once, because a zone is not a preference: it changes when the
 * person gets on a plane, and the stale value would be wrong in exactly the situation where the
 * clock matters most. `lax` and non-httpOnly on purpose — this is written by script and read by
 * the server, carries nothing secret, and must survive a normal navigation.
 */
export default function TimeZoneCookie() {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      // Re-writing an identical value costs nothing and keeps the expiry rolling forward.
      document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // A browser that cannot name its own zone leaves the server on its DEFAULT_TZ fallback.
    }
  }, []);

  return null;
}
