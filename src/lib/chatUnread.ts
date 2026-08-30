import { Types } from 'mongoose';
import { Message } from '@/lib/models/Message';
import { ChatRead } from '@/lib/models/ChatRead';

/**
 * How many messages in this group's chat arrived after the reader last looked.
 *
 * Shared by the workspace loader and the mark-read action so the number the card shows and the
 * number clearing it are computed by the same rule — two copies of "what counts as unread" is how
 * a badge starts disagreeing with the thread underneath it.
 *
 * Three clauses, each load-bearing:
 *  · `deletedAt: null` — a tombstone still occupies the thread but is not something left to read.
 *  · `authorId: { $ne }` — you cannot have unread messages from yourself. Without this, posting
 *    into a group you are looking at makes its own card light up.
 *  · `createdAt: { $gt: lastReadAt }` — absent when there is no read row, which is what makes an
 *    unopened chat count as entirely unread.
 *
 * The caller must have cleared access to the project ALREADY. This takes a projectId and trusts
 * it; it is not a gate.
 */
export async function unreadMessageCount(projectId: string, userId: string): Promise<number> {
  const read = await ChatRead.findOne({ userId, projectId }).select('lastReadAt')
    .lean<{ lastReadAt?: Date } | null>();

  const filter: Record<string, unknown> = {
    projectId: new Types.ObjectId(projectId),
    deletedAt: null,
    authorId: { $ne: new Types.ObjectId(userId) },
  };
  if (read?.lastReadAt) filter.createdAt = { $gt: read.lastReadAt };

  // Served by the { projectId, createdAt } index the panel's own paging already relies on.
  return Message.countDocuments(filter);
}
