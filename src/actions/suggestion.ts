'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Suggestion } from "@/lib/models/Suggestion";
import { getServerSession } from "next-auth";
import { saveUpload } from "@/lib/storage";
import { isAdmin, adminEmails } from "@/lib/isAdmin";
import { feedbackDriveEmail } from "@/lib/feedbackDrive";
import { User } from "@/lib/models/User";
import { sendMail, suggestionEmail } from "@/lib/mailer";
import { shareUrl } from '@/lib/url';

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

export async function getSuggestions() {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    // Same answer for signed-out and non-admin: the inbox does not advertise that it exists
    if (!session?.user?.id || !isAdmin(session.user.email)) return { success: false, error: 'Not found' };
    const suggestions = await Suggestion.find().sort({ createdAt: -1 }).limit(200).lean();
    return { success: true, suggestions: JSON.parse(JSON.stringify(suggestions)) };
  } catch (error) {
    console.error('Failed to get suggestions:', error);
    return { success: false, error: 'Failed to fetch suggestions' };
  }
}
