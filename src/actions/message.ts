'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import { Message, MAX_MESSAGE_CHARS, type IMessageRef, type MessageRefKind } from "@/lib/models/Message";
import { ChatRead } from "@/lib/models/ChatRead";
import { unreadMessageCount } from "@/lib/chatUnread";
import Task from "@/lib/models/Task";
import { Mom } from "@/lib/models/Mom";
import { Note } from "@/lib/models/Note";
import { recordEvent } from "@/lib/models/Event";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { projectForMember, projectPeople } from "@/lib/projectAccess";
import { canChat, isProjectCreator, type OwnableProject } from "@/lib/scope";
import { Project } from "@/lib/models/Project";
import { saveUpload, deleteUpload } from "@/lib/storage";
import { grantProjectReaders } from "@/lib/driveGrants";
import { extractText } from "@/lib/docText";

/**
 * The project chat.
 *
 * Attachments go into the uploader's own Google Drive, in this group's folder, and come back out
 * through `/api/files` — which means a teammate with no Google account can still open them, and a
 * member removed from the group loses access to them the moment `myProjectIds` stops containing it.
 */

/** One page of the panel, and the most a poll will ever hand back in one go. */
const PAGE = 50;
/** More than this in one message is a paste, not a conversation. */
const MAX_REFS = 10;

/**
 * Who is asking, and the project row itself — canChat reads the role lists straight off it.
 *
 * projectForMember is the gate for BOTH reading and posting. It is the read scope, which already
 * includes viewers, and canChat then decides posting on top of it. Splitting it that way keeps the
 * posting rule inside one predicate in lib/scope.ts instead of leaving it implied by whichever gate
 * function a caller reached for — which is how two screens start disagreeing about what a role can do.
 */
async function chatSession(projectId?: string | null) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !projectId) return null;
  await connectToDatabase();
  const project = await projectForMember(projectId, session.user.id, session.user.email);
  if (!project) return null;
  return {
    // Same cast every other action makes on a raw project document (project.ts:188, jarvis.ts:360):
    // the pure predicates read role lists off both a populated row and a lean one.
    project: project as unknown as OwnableProject,
    userId: session.user.id,
    email: (session.user.email || '').toLowerCase(),
  };
}

/**
 * Refs arrive from the browser as ids and addresses, and both are claims until checked.
 *
 * Every one is resolved against THIS project before it is stored: a task, meeting or note must
 * actually carry this projectId, and a person must be on the roster projectPeople returns — the same
 * rule allowedAssignees applies to assignment, for the same reason. Without it, a crafted id would
 * let anyone confirm the existence of, and read the title of, a row in someone else's group.
 *
 * Anything that does not resolve is dropped silently rather than failing the send. The message is
 * what the person meant to deliver; losing it over a stale chip is the worse bug.
 *
 * `label` is captured here, at write time, and never resolved again on read. That is what keeps a
 * chip readable after the task it points at has been deleted — which is exactly when someone goes
 * looking for what was said about it.
 */
async function resolveRefs(raw: unknown, projectId: string): Promise<IMessageRef[]> {
  if (!Array.isArray(raw) || !raw.length) return [];

  const kinds: MessageRefKind[] = ['task', 'mom', 'note', 'user'];
  const wanted = raw
    .filter((r): r is { kind: MessageRefKind; id?: string; email?: string } =>
      !!r && typeof r === 'object' && kinds.includes((r as { kind?: MessageRefKind }).kind as MessageRefKind))
    .slice(0, MAX_REFS);
  if (!wanted.length) return [];

  const idsFor = (kind: MessageRefKind) =>
    [...new Set(wanted.filter(r => r.kind === kind && r.id).map(r => String(r.id)))];

  const people = wanted.some(r => r.kind === 'user') ? await projectPeople(projectId) : [];
  const roster = new Set(people.map(e => e.toLowerCase()));

  // One query per kind, not one per ref: a message mentioning four tasks should not cost four round
  // trips. Each query is scoped to this project, so it doubles as the ownership check.
  const [tasks, moms, notes] = await Promise.all([
    idsFor('task').length
      ? Task.find({ _id: { $in: idsFor('task') }, projectId }).select('title').lean<{ _id: unknown; title?: string }[]>()
      : [],
    idsFor('mom').length
      ? Mom.find({ _id: { $in: idsFor('mom') }, projectId }).select('title').lean<{ _id: unknown; title?: string }[]>()
      : [],
    idsFor('note').length
      ? Note.find({ _id: { $in: idsFor('note') }, projectId }).select('title body').lean<{ _id: unknown; title?: string; body?: string }[]>()
      : [],
  ]);

  const trim = (s?: string) => String(s || '').trim().slice(0, 80);
  const found = new Map<string, string>();
  for (const t of tasks) found.set(`task:${String(t._id)}`, trim(t.title) || 'a task');
  for (const m of moms) found.set(`mom:${String(m._id)}`, trim(m.title) || 'a meeting');
  for (const n of notes) found.set(`note:${String(n._id)}`, trim(n.title) || trim(n.body) || 'a note');

  const out: IMessageRef[] = [];
  for (const r of wanted) {
    if (r.kind === 'user') {
      const email = String(r.email || '').trim().toLowerCase();
      if (email && roster.has(email)) out.push({ kind: 'user', email, label: email });
      continue;
    }
    const label = found.get(`${r.kind}:${String(r.id)}`);
    if (label) out.push({ kind: r.kind, id: String(r.id) as unknown as IMessageRef['id'], label });
  }
  return out;
}

/**
 * One project's chat.
 *
 * Three shapes, one query: `after` is what the poll sends (only what has arrived since), `before`
 * pages backwards through history, and neither means the newest page. Always returned oldest-first,
 * which is the order it renders in — the index is newest-first because that is how you take the LAST
 * fifty messages of a long thread without reading the other nine hundred.
 */
export async function getMessages(projectId: string, opts?: { after?: string; before?: string; limit?: number }) {
  try {
    const ctx = await chatSession(projectId);
    if (!ctx) return { success: false, error: 'Not a member of this project' };

    const limit = Math.min(Math.max(Number(opts?.limit) || PAGE, 1), PAGE);
    const filter: Record<string, unknown> = { projectId };

    const at = (v?: string) => {
      if (!v) return null;
      const d = new Date(v);
      // An unparseable date would become `createdAt: {$gt: Invalid Date}`, which matches nothing and
      // looks exactly like an empty chat. Ignore it and serve the newest page instead.
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const after = at(opts?.after);
    const before = at(opts?.before);
    if (after) filter.createdAt = { $gt: after };
    else if (before) filter.createdAt = { $lt: before };

    const rows = await Message.find(filter)
      .select('-attachments.text')
      .populate('authorId', 'email name')
      .sort({ createdAt: after ? 1 : -1 })
      .limit(limit)
      .lean();

    const messages = after ? rows : rows.reverse();
    return { success: true, messages: JSON.parse(JSON.stringify(messages)) };
  } catch (error) {
    console.error('Failed to get messages:', error);
    return { success: false, error: 'Could not load the chat' };
  }
}

/**
 * The reader has seen this chat up to now. Called when the panel opens and again whenever the poll
 * delivers into an open panel, so a conversation being watched live never accrues a badge.
 *
 * `lastReadAt` only ever moves forward. Two tabs, or a poll landing a moment after an open, arrive
 * in whatever order the network gives them, and the older stamp winning would resurrect messages
 * the person has already read. The upsert claims the row; the `$max` decides the value.
 *
 * Gated like every other read of this chat — a projectId you are not a member of writes nothing.
 */
export async function markChatRead(projectId: string) {
  try {
    const ctx = await chatSession(projectId);
    if (!ctx) return { success: false as const, error: 'Not a member of this project' };

    await ChatRead.updateOne(
      { userId: ctx.userId, projectId },
      { $max: { lastReadAt: new Date() } },
      { upsert: true },
    );
    return { success: true as const };
  } catch (error) {
    // Best-effort by design: failing to record a read must never break opening the chat. The count
    // stays high for now and the next open corrects it.
    console.error('Failed to mark chat read:', error);
    return { success: false as const, error: 'Could not mark the chat read' };
  }
}

/** What the chat card shows: messages from other people that arrived after this reader last looked. */
export async function getUnreadCount(projectId: string) {
  try {
    const ctx = await chatSession(projectId);
    if (!ctx) return { success: false as const, error: 'Not a member of this project' };
    return { success: true as const, unread: await unreadMessageCount(projectId, ctx.userId) };
  } catch (error) {
    console.error('Failed to count unread messages:', error);
    return { success: false as const, error: 'Could not count unread messages' };
  }
}

/** Post one message. */
export async function sendMessage(projectId: string, body: string, refs?: unknown, file?: File | null) {
  try {
    const ctx = await chatSession(projectId);
    if (!ctx) return { success: false, error: 'Not a member of this project' };
    if (!canChat(ctx.project, ctx.email, ctx.userId)) {
      return { success: false, error: 'You cannot post in this group' };
    }

    const text = String(body || '').trim().slice(0, MAX_MESSAGE_CHARS);
    const hasFile = file instanceof File && file.size > 0;
    // A photo of the damaged pallet with no caption is a whole message. Text OR a file is enough.
    if (!text && !hasFile) return { success: false, error: 'Nothing to send' };

    const resolved = await resolveRefs(refs, projectId);

    const attachments = [];
    if (hasFile) {
      // Into the uploader's Drive under this group's folder, like every other project file. The
      // upload happens BEFORE the row is written: a message that appears without its attachment,
      // because the upload failed after the insert, is worse than one that never sent.
      const projectName = (await Project.findById(projectId).select('name').lean<{ name?: string } | null>())?.name;
      const saved = await saveUpload(ctx.userId, file, { source: 'message', projectName });
      if (!saved.ok) {
        return {
          success: false,
          error: saved.message,
          needsDrive: saved.reason === 'no_drive' || saved.reason === 'drive_revoked',
        };
      }
      // Same extraction the locker and notes do, so Jarvis can answer from inside a shared file.
      const extracted = await extractText(saved.buffer, saved.mimeType, file.name);
      attachments.push({
        name: file.name, key: saved.key, url: saved.url,
        mimeType: saved.mimeType, size: saved.size, text: extracted,
      });
    }

    const created = await Message.create({
      projectId,
      authorId: ctx.userId,
      body: text,
      refs: resolved,
      attachments,
    });

    // Chat is the impatient surface — the message has to land instantly, so the grants go out
    // after the response like everywhere else. Nothing here is what makes the file openable.
    grantProjectReaders({
      projectId,
      uploaderId: ctx.userId,
      uploaderEmail: ctx.email,
      keys: attachments.map(a => a.key),
    });

    // The trail is where "what did I miss" gets answered, and a chat it never mentions is a
    // conversation you can only find by opening the chat. recordEvent truncates to 140 and never
    // throws, so a lost trail row can never cost somebody their message.
    await recordEvent({ projectId, actorId: ctx.userId, verb: 'message_posted', subject: text || attachments[0]?.name });

    revalidatePath(`/projects/${projectId}`);
    const sent = await Message.findById(created._id).select('-attachments.text').populate('authorId', 'email name').lean();
    return { success: true, message: JSON.parse(JSON.stringify(sent)) };
  } catch (error) {
    console.error('Failed to send message:', error);
    return { success: false, error: 'Message not sent' };
  }
}

/** Fix a typo in your own message. Authors only — an admin may remove, never rewrite. */
export async function editMessage(id: string, body: string) {
  try {
    await connectToDatabase();
    const message = await Message.findById(id);
    if (!message || message.deletedAt) return { success: false, error: 'Message not found' };

    // Re-gated through the project even though authorship is checked next: an author who has since
    // left the group must not keep a write into it.
    const ctx = await chatSession(String(message.projectId));
    if (!ctx) return { success: false, error: 'Not a member of this project' };
    if (String(message.authorId) !== String(ctx.userId)) {
      return { success: false, error: 'You can only edit your own messages' };
    }

    const next = String(body || '').trim().slice(0, MAX_MESSAGE_CHARS);
    if (!next) return { success: false, error: 'Nothing to save' };

    message.body = next;
    message.editedAt = new Date();
    await message.save();

    revalidatePath(`/projects/${message.projectId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to edit message:', error);
    return { success: false, error: 'Could not save the edit' };
  }
}

/**
 * Remove a message. The author, or the project's creator acting as the group's admin.
 *
 * isProjectCreator, not isProjectOwner: a promoted co-owner runs the group's work, but taking
 * somebody's words out of a shared record is the creator's alone — the same reasoning that makes
 * deleting the group itself permanent to the creator.
 *
 * A tombstone rather than a delete, so the conversation around it keeps its shape.
 */
export async function deleteMessage(id: string) {
  try {
    await connectToDatabase();
    const message = await Message.findById(id);
    if (!message) return { success: false, error: 'Message not found' };

    const ctx = await chatSession(String(message.projectId));
    if (!ctx) return { success: false, error: 'Not a member of this project' };

    const mine = String(message.authorId) === String(ctx.userId);
    const admin = isProjectCreator(ctx.project, ctx.email, ctx.userId);
    if (!mine && !admin) return { success: false, error: 'Only the author or the group admin can remove this' };
    if (message.deletedAt) return { success: true };

    // The bytes go too. A tombstone that leaves the file reachable through /api/files has removed
    // the words and kept the evidence. Only ever from the actor's own Drive — deleteUpload refuses
    // to reach into somebody else's, which is why the author or the creator-admin both work here.
    for (const a of message.attachments || []) {
      await deleteUpload(a.key, ctx.userId).catch(err => console.error('Attachment not removed', a.key, err));
    }
    message.body = '';
    message.refs = [];
    message.attachments = [];
    message.deletedAt = new Date();
    await message.save();

    revalidatePath(`/projects/${message.projectId}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete message:', error);
    return { success: false, error: 'Could not remove the message' };
  }
}
