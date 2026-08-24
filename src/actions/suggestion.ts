'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Suggestion } from "@/lib/models/Suggestion";
import { getServerSession } from "next-auth";
import { saveUpload } from "@/lib/storage";
import { isAdmin, adminEmails } from "@/lib/isAdmin";
import { sendMail, suggestionEmail } from "@/lib/mailer";

/**
 * "Help us improve" — anyone signed in can send a bug, an idea, or anything else, with an
 * optional screenshot. Only an admin reads them back.
 */

export async function submitSuggestion(formData: FormData) {
  try {
    await connectToDatabase();
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const message = String(formData.get('message') || '').trim();
    if (!message) return { success: false, error: 'Tell us what happened first' };
    const kinds = ['bug', 'idea', 'other'] as const;
    const kindIn = String(formData.get('kind') || 'other') as typeof kinds[number];
    const kind = kinds.includes(kindIn) ? kindIn : 'other';

    let shot;
    const file = formData.get('file') as File | null;
    if (file && file.size) {
      // Same 4MB guard as note attachments: Vercel caps a serverless body at ~4.5MB and a
      // readable message beats an opaque platform 413. Screenshots are downscaled client-side.
      if (file.size > 4 * 1024 * 1024) return { success: false, error: 'Screenshot is too large (max 4MB)' };
      const { key, url, mimeType, size } = await saveUpload(session.user.id, file);
      shot = { key, url, mimeType, size };   // no extractText — it is a picture of a broken screen
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
        const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
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

    return { success: true };
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
