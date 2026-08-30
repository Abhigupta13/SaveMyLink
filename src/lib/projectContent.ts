import { Types } from 'mongoose';
import { Note } from '@/lib/models/Note';
import Task from '@/lib/models/Task';
import { Mom } from '@/lib/models/Mom';
import { Document } from '@/lib/models/Document';
import { Event } from '@/lib/models/Event';
import { Message } from '@/lib/models/Message';
import { deleteUploads } from '@/lib/storage';

/**
 * Erase every project-scoped record of a group that is going away — the group being deleted
 * outright, or its last remaining member deleting their account.
 *
 * It lives here rather than in either action because projectId IS the sharing boundary: anything
 * carrying one is reachable only through a project, so a collection this function forgets is not
 * merely left behind, it is unreachable. Its rows stay in nobody's myProjectIds, which makes them
 * invisible to every read path AND undeletable through every screen — and a forgotten Document
 * goes on occupying space in a real person's Drive with nothing left that could ever free it.
 * Two copies of that list is one copy too many.
 *
 * `actorUserId` is required, not optional: it is the person who clicked, and lib/storage refuses to
 * destroy bytes from anyone else's Drive. A group's files can come from several members' Drives,
 * and the owner deleting the group is entitled to erase the app's rows — not to reach into a
 * teammate's personal Drive. Those attachments are detached and left where they are.
 */
export async function deleteProjectContent(projectId: Types.ObjectId | string, actorUserId: string) {
  const [docs, notes] = await Promise.all([
    Document.find({ projectId }).select('key').lean<{ key?: string }[]>(),
    Note.find({ projectId }).select('attachments.key').lean<{ attachments?: { key?: string }[] }[]>(),
  ]);
  await deleteUploads([
    ...docs.map(d => d.key),
    ...notes.flatMap(n => (n.attachments || []).map(a => a.key)),
  ], actorUserId);
  await Promise.all([
    Note.deleteMany({ projectId }),
    Task.deleteMany({ projectId }),
    Mom.deleteMany({ projectId }),
    Document.deleteMany({ projectId }),
    Event.deleteMany({ projectId }),
    // The group is going, so its conversation goes with it. Messages in a group that SURVIVES are
    // deliberately kept, name and all — that decision lives in the account-deletion path, not here.
    Message.deleteMany({ projectId }),
  ]);
}
