/**
 * The SECOND, convenience-only way a group-mate reaches a file: it also appears in their own Drive.
 *
 * `/api/files` stays the authoritative read path and is the only one that has to work — it proxies
 * the bytes out of the uploader's Drive after checking the reader is in the project, and it works
 * for a teammate who signed up with a password and has no Google account at all. Everything here is
 * on top of that. So if every single grant fails, nothing is broken: the file still opens, in the
 * app, for everyone entitled to it.
 *
 * That is what licenses the shape of this file, which would be indefensible for load-bearing work:
 * no queue, no retry, no outbox, no record of what succeeded. `shareReader` already swallows its own
 * failure per recipient, and the common failure is not an outage — it is an address with no Google
 * account behind it, which will fail identically forever. A retry would spend quota to be told so
 * again. The whole batch runs inside `after()` so an upload returns to the user immediately rather
 * than waiting on N round trips to Google.
 *
 * `reader`, never writer: the file is in the UPLOADER's personal Drive, and a teammate who could
 * edit or delete it there would be changing something this app cannot see, undo, or explain.
 *
 * ── The seam a future revoke-on-removal hooks into ──
 * Removing someone from a project does NOT take their Drive copy away. App access ends at once
 * (`myProjectIds` stops containing the group); the Drive permission stays, the way a downloaded file
 * would. That is a deliberate decision (DECISION.md, 30 Aug) and it is disclosed on /terms, but it
 * is the one place this file disagrees with `lib/dropAssignee.ts` — which exists precisely because
 * leaving a group has to take your read access with you.
 *
 * When it is time to close that gap, the hook is `dropAssignee(projectId, email, actorId)`: every
 * way out of a group already routes through it (an owner removing someone, the same thing asked of
 * Jarvis, an account deletion), so a `revokeReader` pass belongs beside that call and nowhere else —
 * a second removal path that forgets it is how one of the three quietly keeps leaking. It needs what
 * this file does not: the permission id per (file, person), because Drive's DELETE takes an id and
 * finding it means listing permissions on every file in the group. That is the N×M job this round
 * refused, and it is also why there is no backfill when somebody JOINS. Files added before they
 * arrived stay app-only for them.
 */

import { after } from 'next/server';
import { shareReader } from '@/lib/drive';
import { driveAccessToken } from '@/lib/driveAuth';
import { projectPeople } from '@/lib/projectAccess';
import { grantRecipients } from '@/lib/driveGrantList';
import { grantableFileIds } from '@/lib/driveKey';

export { grantRecipients, MAX_GRANTS } from '@/lib/driveGrantList';
export { grantableFileIds } from '@/lib/driveKey';

/**
 * Share these files with everyone on the project, in the background. Returns nothing on purpose —
 * there is no outcome a caller could usefully branch on, and one that awaited an outcome would have
 * put N round trips to Google back on the response path.
 *
 * The selection happens synchronously, before `after`, so the overwhelmingly common cases (a
 * personal upload, a link with no bytes, a note moved between two of my own lists) schedule no
 * background work at all.
 */
export function grantProjectReaders(opts: {
  projectId: unknown;
  uploaderId: string;
  uploaderEmail?: string | null;
  keys: (string | null | undefined)[];
}): void {
  const fileIds = grantableFileIds(opts.keys, opts.uploaderId);
  if (!opts.projectId || !fileIds.length) return;

  after(async () => {
    try {
      const recipients = grantRecipients(await projectPeople(opts.projectId), opts.uploaderEmail);
      if (!recipients.length) return;
      // Asked for here rather than passed in: this runs after the response, and a token minted
      // during the request may already have been the last minutes of its hour.
      const token = await driveAccessToken(opts.uploaderId);
      if (!token) return;   // disconnected since the upload — the proxy still serves everyone
      for (const fileId of fileIds) {
        for (const email of recipients) await shareReader(token, fileId, email);
      }
    } catch (error) {
      // Nothing above may surface to the user: the response went out long ago, and the read path
      // this decorates never depended on any of it.
      console.error('Drive grants skipped for project', String(opts.projectId), error);
    }
  });
}
