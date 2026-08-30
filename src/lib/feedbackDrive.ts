import { isAdmin } from '@/lib/isAdmin';

/**
 * Whose Drive holds the screenshots people attach to a bug report.
 *
 * Not the reporter's. Under "no Drive, no uploads" the person least likely to have connected one is
 * exactly the person hitting a bug, and a lost screenshot is a lost bug report. So the image goes to
 * an admin's Drive and the reporter needs nothing.
 *
 * **Its own env var, deliberately not `ADMIN_EMAILS`.** That is a *list* and an *authorisation
 * allowlist*; taking its first entry would make an auth list silently double as a storage
 * destination, so adding or reordering an admin would quietly redirect every user's screenshot into
 * a different person's Google account, with no deploy and no signal. One value, one meaning.
 *
 * The `isAdmin` cross-check is cheap and worth it: a typo — or a tampered env var — would otherwise
 * route every reporter's screen into an arbitrary Google account.
 */
export function feedbackDriveEmail(): string | null {
  const configured = (process.env.FEEDBACK_DRIVE_EMAIL || '').trim().toLowerCase();
  if (!configured) return null;
  return isAdmin(configured) ? configured : null;
}
