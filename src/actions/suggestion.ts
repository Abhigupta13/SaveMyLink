'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Suggestion } from "@/lib/models/Suggestion";
import { getServerSession } from "next-auth";
import { saveUpload } from "@/lib/storage";
import { isAdmin, adminEmails } from "@/lib/isAdmin";
import { feedbackDriveEmail } from "@/lib/feedbackDrive";
import { User } from "@/lib/models/User";
import { sendMail, suggestionEmail, resolvedEmail } from "@/lib/mailer";
import { shareUrl } from '@/lib/url';
import { isValidObjectId } from "mongoose";
import { after } from "next/server";

/**
 * "Help us improve" — anyone signed in can send a bug, an idea, or anything else, with an
 * optional screenshot. Only an admin reads them back.
 */

export async function submitSuggestion(formData: FormData) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    await connectToDatabase();
    const message = String(formData.get('message') || '').trim();
    if (!message) return { success: false, error: 'Tell us what happened first' };
    const kinds = ['bug', 'idea', 'other'] as const;
    const kindIn = String(formData.get('kind') || 'other') as typeof kinds[number];
    const kind = kinds.includes(kindIn) ? kindIn : 'other';

    /* Fail open, always. A lost screenshot beats a lost bug report, and the reports worth having
       come from the people least likely to have connected a Drive. Every failure below — no admin
       Drive configured, that Drive disconnected, its quota full, the file too big — drops the image
       and sends the report anyway.

       Note this changes the old behaviour deliberately: the 4MB guard used to `return` an error and
       throw the whole report away. */
    let shot;
    let shotDropped: string | undefined;
    const file = formData.get('file') as File | null;
    if (file && file.size) {
      const adminEmail = feedbackDriveEmail();
      const owner = adminEmail
        ? await User.findOne({ email: adminEmail, deletedAt: null }).select('_id').lean<{ _id: unknown } | null>()
        : null;
      if (!owner) {
        shotDropped = 'unavailable';
        console.error('[suggestion] no FEEDBACK_DRIVE_EMAIL with a connected Drive — screenshot dropped');
      } else {
        // The screenshot goes to the ADMIN's Drive, not the reporter's: it is being sent to us, and
        // asking someone to connect Google before they can report a bug is how bugs stop arriving.
        const saved = await saveUpload(String(owner._id), file, { source: 'feedback' });
        if (saved.ok) shot = { key: saved.key, url: saved.url, mimeType: saved.mimeType, size: saved.size };
        else { shotDropped = saved.reason; console.error('[suggestion] screenshot dropped:', saved.reason); }
      }
    }

    const from = (session.user.email || '').toLowerCase();
    const page = String(formData.get('page') || '').slice(0, 200);
    const userAgent = String(formData.get('userAgent') || '').slice(0, 400);

    await Suggestion.create({
      userId: session.user.id,
      email: from,
      kind, message, page, userAgent, shot,
    });

    // Mail the admins so a report is seen today rather than whenever the inbox is next opened.
    // Deliberately after the write and deliberately swallowed: the suggestion is already saved,
    // so a broken SMTP box must not tell the reporter their message was lost.
    try {
      const to = adminEmails().join(',');
      if (to) {
        const base = shareUrl();
        await sendMail({
          to,
          replyTo: from || undefined,   // hitting reply answers the reporter, not us
          ...suggestionEmail({
            kind, message, from: from || 'a signed-in user', page, userAgent,
            shotUrl: shot && base ? `${base}${shot.url}` : undefined,
          }),
        });
      }
    } catch (error) {
      console.error('Suggestion saved but the notification email failed:', error);
    }

    // The toast says "Sent" either way, and adds what happened to the image when one was dropped —
    // silently losing an attachment the person deliberately took is worse than admitting it.
    return { success: true, shotDropped };
  } catch (error) {
    console.error('Failed to submit suggestion:', error);
    return { success: false, error: 'Could not send that — try again' };
  }
}

export async function getSuggestions(view: 'open' | 'resolved' = 'open') {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    // Same answer for signed-out and non-admin: the inbox does not advertise that it exists
    if (!session?.user?.id || !isAdmin(session.user.email)) return { success: false, error: 'Not found' };

    /* Filtered in the database rather than in the page. The list is capped at 200 and resolved
       reports are kept forever, so a client-side filter would eventually push the open ones —
       the whole reason anyone opens this page — off the end of the fetch. */
    const resolved = view === 'resolved';
    const filter = resolved ? { resolvedAt: { $ne: null } } : { resolvedAt: null };
    // Resolved reads as "what did we close, most recently"; open still reads by when it arrived.
    const sort: Record<string, -1> = resolved ? { resolvedAt: -1 } : { createdAt: -1 };

    const [suggestions, open, done] = await Promise.all([
      Suggestion.find(filter).sort(sort).limit(200).lean(),
      Suggestion.countDocuments({ resolvedAt: null }),
      Suggestion.countDocuments({ resolvedAt: { $ne: null } }),
    ]);
    return { success: true, suggestions: JSON.parse(JSON.stringify(suggestions)), counts: { open, resolved: done } };
  } catch (error) {
    console.error('Failed to get suggestions:', error);
    return { success: false, error: 'Failed to fetch suggestions' };
  }
}

/**
 * An admin closes a report, and the person who wrote it hears back.
 *
 * Two things this is built around:
 *
 * 1. The reporter is thanked EXACTLY once. The check for "already resolved" and the write that
 *    resolves it are one atomic findOneAndUpdate on `resolvedAt: null`, so a double-tap, or two
 *    admins on the same report, race in the database instead of in a read-then-write window.
 *    Whoever loses matches nothing, sends nothing, and is told it was already closed.
 * 2. The resolution is committed BEFORE the mail is attempted, and a failed send never rolls it
 *    back. A dead SMTP box is our problem to retry; losing the admin's decision — and with it the
 *    record that this was dealt with — is worse than an email that did not arrive. The action
 *    says so in its result instead, and the outcome is stored so the inbox can keep saying it.
 */
export async function resolveSuggestion(id: string, note?: string) {
  try {
    const session = await getServerSession(authOptions);
    // Gated on the SESSION email. Nothing the client sends decides who may close a report.
    if (!session?.user?.id || !isAdmin(session.user.email)) return { success: false as const, error: 'Not found' };
    await connectToDatabase();
    if (!isValidObjectId(id)) return { success: false as const, error: 'Unknown report' };

    const by = (session.user.email || '').toLowerCase();
    const said = String(note || '').trim().slice(0, 1000);

    const claimed = await Suggestion.findOneAndUpdate(
      { _id: id, resolvedAt: null },
      { $set: { resolvedAt: new Date(), resolvedBy: by, resolveNote: said } },
      { new: true },
    ).lean<{ _id: unknown; email?: string; message: string; userId?: unknown; resolvedAt: Date } | null>();

    if (!claimed) {
      // Either it is already closed — the common case, and a no-op by design — or the id is junk.
      const existing = await Suggestion.findById(id)
        .select('resolvedAt resolvedBy resolveNote resolveMail')
        .lean<{ resolvedAt?: Date; resolvedBy?: string; resolveNote?: string; resolveMail?: string } | null>();
      if (!existing?.resolvedAt) return { success: false as const, error: 'Unknown report' };
      return {
        success: true as const, already: true, mailed: (existing.resolveMail || 'none') as 'sent' | 'failed' | 'none',
        resolvedAt: existing.resolvedAt.toISOString(), resolvedBy: existing.resolvedBy || '', note: existing.resolveNote || '',
      };
    }

    /* Some reports carry no address at all — `email` defaults to '' and is filled from the session,
       so anyone signed in without one leaves it blank. Those close silently. Reporting that as a
       sent email would have the admin believe a person was answered who never heard from us. */
    /* Some reports carry no address at all, and that is knowable instantly — so it is answered
       instantly. Everything else goes to SMTP, which is the slow part. */
    const mailed: 'pending' | 'none' = claimed.email ? 'pending' : 'none';
    await Suggestion.updateOne({ _id: id }, { $set: { resolveMail: mailed } }).catch(() => {});

    /* The send runs AFTER the response. Waiting on SMTP left the admin looking at "Closing…" for
       several seconds per ticket, and nothing in that wait was theirs to act on: the report is
       already closed and durable by this point, and a failed send does not un-close it. The
       outcome is written to the row rather than returned, so the Resolved tab still tells the
       truth about who actually heard from us — a beat later instead of instantly. */
    if (claimed.email) {
      // Captured before after(): the callback outlives this scope, and TypeScript will not carry
      // the narrowing across that boundary.
      const to = claimed.email;
      after(async () => {
        let outcome: 'sent' | 'failed' = 'failed';
        try {
          // The name makes it read like a person wrote it; the report only stores an address.
          const who = claimed.userId
            ? await User.findById(claimed.userId).select('name').lean<{ name?: string } | null>()
            : null;
          const posted = await sendMail({
            to,
            ...resolvedEmail({ message: claimed.message, note: said, name: who?.name }),
          });
          // sendMail answers `delivered: false` rather than throwing when SMTP is unconfigured, and
          // "we sent it" has to mean a message actually left. Otherwise a deploy with no SMTP
          // credentials would tell the admin, honestly and wrongly, that everyone had been thanked.
          outcome = posted.delivered ? 'sent' : 'failed';
        } catch (error) {
          console.error('Suggestion resolved but the thank-you email failed:', error);
        }
        // Best-effort: the resolution is already durable, and losing only the send outcome costs
        // the inbox a label, not the record.
        await Suggestion.updateOne({ _id: id }, { $set: { resolveMail: outcome } })
          .catch(err => console.error('Suggestion mail outcome not recorded:', err));
      });
    }

    return {
      success: true as const, already: false, mailed,
      resolvedAt: claimed.resolvedAt.toISOString(), resolvedBy: by, note: said,
    };
  } catch (error) {
    console.error('Failed to resolve suggestion:', error);
    return { success: false as const, error: 'Could not close that — try again' };
  }
}
