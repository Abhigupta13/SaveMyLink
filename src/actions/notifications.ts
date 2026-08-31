'use server';

/**
 * What happened in your groups while you were not looking.
 *
 * Two sources, one list, because "did I miss anything" is one question:
 *  · MESSAGES — what people said in group chats. The thing this page was asked for.
 *  · ACTIVITY — the Event trail: tasks created and completed, members added, meetings filed.
 *
 * No new collection. Message and Event both already carry projectId + actor + time and are both
 * indexed that way, and the User row already had room for one timestamp. A notifications table
 * would have been a third copy of facts these two already hold, kept in sync by hand.
 *
 * SCOPE, and it is the same rule the rest of the app now follows: only groups the caller can
 * actually open, via myProjectIds, which applies the email-verification gate. A feed is a read
 * path like any other, and "someone assigned me something" is not a licence to read a group's
 * chat. Own actions are excluded throughout — you cannot have missed your own message.
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import { Types } from 'mongoose';
import { Message } from '@/lib/models/Message';
import { Event } from '@/lib/models/Event';
import { Project } from '@/lib/models/Project';
import { User } from '@/lib/models/User';
import { myProjectIds } from '@/lib/projectAccess';
import { phrase } from '@/lib/activity';
import { NOTIFICATION_WINDOW_DAYS, MAX_NOTIFICATIONS, MESSAGE_VERB, previewOf } from '@/lib/notifications';

export interface NotificationItem {
  id: string;
  kind: 'message' | 'activity';
  /** Already-phrased English. The client renders it, never re-derives it. */
  text: string;
  /** Who did it, for the avatar and the "Asha" in "Asha said". */
  actor: string;
  projectId: string;
  projectName: string;
  at: string;
  unread: boolean;
  href: string;
}

/**
 * The feed, newest first, with how many of them are new since the page was last opened.
 *
 * `unread` is a timestamp comparison rather than a per-item read flag: one date on the User row
 * against each item's own time. A per-item flag would need a row per person per notification —
 * thousands of writes to record something nobody asked to keep.
 */
export async function getNotifications() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false as const, error: 'Unauthorized' };
    await connectToDatabase();

    const userId = session.user.id;
    const me = new Types.ObjectId(userId);
    const mine = await myProjectIds(userId, session.user.email);
    if (!mine.length) return { success: true as const, items: [], unread: 0 };

    const since = new Date(Date.now() - NOTIFICATION_WINDOW_DAYS * 24 * 3600e3);
    const readAt = (await User.findById(userId).select('notificationsReadAt')
      .lean<{ notificationsReadAt?: Date | null } | null>())?.notificationsReadAt ?? null;

    const [projects, messages, events] = await Promise.all([
      Project.find({ _id: { $in: mine } }).select('name').lean<{ _id: Types.ObjectId; name: string }[]>(),
      Message.find({
        projectId: { $in: mine },
        authorId: { $ne: me },      // you cannot miss your own message
        deletedAt: null,            // a tombstone is not something left to read
        createdAt: { $gte: since },
      }).populate('authorId', 'name email').sort({ createdAt: -1 }).limit(MAX_NOTIFICATIONS).lean(),
      Event.find({
        projectId: { $in: mine },
        actorId: { $ne: me },
        at: { $gte: since },
        /* Posting to a chat writes BOTH a Message and a 'message_posted' Event — the trail records
           it so the group's activity tab can show "posted …" alongside everything else. Reading
           both here listed every message twice, once as itself and once as its own trail entry.
           The Message wins: it carries the attachments and gets the better preview. */
        verb: { $ne: MESSAGE_VERB },
      }).populate('actorId', 'name email').sort({ at: -1 }).limit(MAX_NOTIFICATIONS).lean(),
    ]);

    const nameOf = new Map(projects.map(p => [String(p._id), p.name]));
    const who = (u: unknown) => {
      const person = u as { name?: string; email?: string } | null;
      return person?.name || (person?.email ? person.email.split('@')[0] : 'Someone');
    };
    const isNew = (at: Date) => !readAt || at.getTime() > new Date(readAt).getTime();

    const items: NotificationItem[] = [
      ...messages.map(m => {
        const at = new Date(m.createdAt);
        return {
          id: String(m._id),
          kind: 'message' as const,
          text: `${who(m.authorId)}: ${previewOf(m.body, (m.attachments || []).length)}`,
          actor: who(m.authorId),
          projectId: String(m.projectId),
          projectName: nameOf.get(String(m.projectId)) || 'a group',
          at: at.toISOString(),
          unread: isNew(at),
          href: `/projects/${String(m.projectId)}`,
        };
      }),
      ...events.map(e => {
        const at = new Date(e.at);
        return {
          id: String(e._id),
          kind: 'activity' as const,
          // phrase() is the same vocabulary the group's own activity tab renders, so a verb can
          // never appear here as a raw enum that reads fine over there.
          text: `${who(e.actorId)} ${phrase(e.verb, e.subject)}`,
          actor: who(e.actorId),
          projectId: String(e.projectId),
          projectName: nameOf.get(String(e.projectId)) || 'a group',
          at: at.toISOString(),
          unread: isNew(at),
          href: `/projects/${String(e.projectId)}`,
        };
      }),
    ]
      // Merged then re-sorted: two already-sorted lists interleaved by time is the whole point of
      // showing them together rather than as two tabs nobody switches between.
      .filter(i => i.text.trim())
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX_NOTIFICATIONS);

    return { success: true as const, items, unread: items.filter(i => i.unread).length };
  } catch (error) {
    console.error('Failed to load notifications:', error);
    return { success: false as const, error: 'Could not load notifications' };
  }
}

/**
 * Everything up to now has been seen.
 *
 * Stamped with the server's clock, not a time the client sent: a phone whose clock runs fast would
 * otherwise mark future messages read before they arrived.
 */
export async function markNotificationsRead() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false as const, error: 'Unauthorized' };
    await connectToDatabase();
    await User.updateOne({ _id: session.user.id }, { $set: { notificationsReadAt: new Date() } });
    return { success: true as const };
  } catch (error) {
    console.error('Failed to mark notifications read:', error);
    return { success: false as const, error: 'Could not update' };
  }
}

/** Just the number, for the bell. Cheap enough to call on every page load. */
export async function unreadNotificationCount() {
  const res = await getNotifications();
  return res.success ? res.unread : 0;
}
