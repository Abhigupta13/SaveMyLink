/**
 * Account erasure — the destructive primitive, deliberately NOT a Server Action.
 *
 * This lives in lib/ rather than actions/ for one reason. Every exported async function in a
 * 'use server' module is registered as a callable RPC endpoint, reachable by direct POST and not
 * only through the UI (see node_modules/next/dist/docs/01-app/02-guides/data-security.md). These
 * two functions take their victim as an ARGUMENT — eraseAccount takes a userId and email,
 * purgeDeletedAccounts takes the clock it compares against — and neither reads a session. Exported
 * from actions/account.ts, that made "erase this account" and "purge every retained stub" two
 * unauthenticated endpoints whose only protection was Next's dead-code elimination happening to
 * tree-shake them. That is a build detail, not an access control.
 *
 * Here they are plain server-side functions: importable by the two gated callers that should have
 * them — deleteMyAccount (session + re-auth) and adminDeleteUser (admin allowlist) — and by a
 * repro script, which is what the original doc comment wanted, without also being an open door.
 *
 * The trust boundary is the CALLER. Nothing in this file checks a session, so nothing in this file
 * may ever be exported from a 'use server' module again.
 */

import { Types } from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import { Link } from '@/lib/models/Link';
import { Category } from '@/lib/models/Category';
import { Note } from '@/lib/models/Note';
import Task from '@/lib/models/Task';
import { Mom } from '@/lib/models/Mom';
import { Document } from '@/lib/models/Document';
import { Contact } from '@/lib/models/Contact';
import { Suggestion } from '@/lib/models/Suggestion';
import { Event } from '@/lib/models/Event';
import { JarvisSession } from '@/lib/models/JarvisSession';
import { Project } from '@/lib/models/Project';
import { deleteUploads } from '@/lib/storage';
import { deleteProjectContent } from '@/lib/projectContent';
import { chooseHandover, isPurgeDue, type HandoverCandidate } from '@/lib/accountDeletion';
import { dropAssignee } from '@/lib/dropAssignee';

/**
 * Hand over, or delete, every group this user CREATED (ownerId is theirs — the permanent creator
 * slot, which must point at a real account). Oldest co-owner inherits it, else the oldest plain
 * member is promoted, else the group is deleted with its content. Groups they were merely on are
 * handled separately: their email is simply pulled from the lists, touching nobody else's work.
 */
async function handOverOwnedGroups(userId: string, email: string) {
  const owned = await Project.find({ ownerId: userId });
  for (const project of owned) {
    const coOwnerEmails = (project.ownerEmails || []).filter(e => e && e !== email);
    const memberEmails = (project.memberEmails || []).filter(e => e && e !== email && !coOwnerEmails.includes(e));

    // Only registered accounts can inherit a group. Resolve both lists in one lookup.
    const accounts = await User.find({ email: { $in: [...coOwnerEmails, ...memberEmails] }, deletedAt: null })
      .select('email createdAt').lean<{ _id: Types.ObjectId; email: string; createdAt: Date }[]>();
    const byEmail = new Map(accounts.map(u => [u.email, u]));
    const pick = (emails: string[]): HandoverCandidate[] =>
      emails.filter(e => byEmail.has(e)).map(e => ({ email: e, createdAt: byEmail.get(e)!.createdAt }));

    const decision = chooseHandover(pick(coOwnerEmails), pick(memberEmails));
    if (decision.action === 'delete') {
      // The leaver is the actor here, and the last person on the group — so their own attachments
      // go from their own Drive, and anything an earlier member uploaded is detached, not destroyed.
      await deleteProjectContent(project._id, userId);
      await project.deleteOne();
      continue;
    }
    const heir = byEmail.get(decision.email)!;
    // The heir becomes the creator. Drop the leaver from every list; the heir stays wherever they
    // were (co-owners live in memberEmails too) and is now an owner by virtue of ownerId.
    project.ownerId = heir._id;
    project.ownerEmails = (project.ownerEmails || []).filter(e => e && e !== email);
    project.memberEmails = (project.memberEmails || []).filter(e => e && e !== email);
    project.viewerEmails = (project.viewerEmails || []).filter(e => e && e !== email);
    await project.save();
    // Off the group, off its tasks — the same rule removeMember follows. The work stays with the
    // heir; only the leaver's claim on it goes, so nothing points at an account that is being
    // erased. No trail: Event.deleteMany({ actorId }) below would delete it moments later.
    await dropAssignee(project._id, email, null);
  }
}

/**
 * The erase itself, session and re-auth already settled by the caller. Split out from
 * deleteMyAccount so the destructive path can be driven directly by a repro script on throwaway
 * accounts — the session-bound wrapper cannot be, and a delete with no undo has to be provable.
 */
export async function eraseAccount(userId: string, email: string, role: string) {
  const lower = email.toLowerCase();

  // 1. Groups they created: hand over to the oldest survivor, or delete if sole member.
  await handOverOwnedGroups(userId, lower);

  // 2. Groups they were only ON: drop them from every list, leaving all shared work in place —
  //    but not their claim on it, exactly like removeMember. A task left pointing at a deleted
  //    account is held by nobody and says so to nobody; if a co-assignee remains they inherit it
  //    as primary, and if not it lands in the group's "Needs an owner" band. Ids first, because
  //    the $pull is what makes them unfindable afterwards.
  const on = await Project.find({
    ownerId: { $ne: new Types.ObjectId(userId) },
    $or: [{ ownerEmails: lower }, { memberEmails: lower }, { viewerEmails: lower }],
  }).select('_id').lean<{ _id: Types.ObjectId }[]>();
  await Project.updateMany(
    { _id: { $in: on.map(p => p._id) } },
    { $pull: { ownerEmails: lower, memberEmails: lower, viewerEmails: lower } },
  );
  for (const p of on) await dropAssignee(p._id, lower, null);

  // 3. Their own PERSONAL content. Project-scoped work they authored stays with the surviving
  //    group — that is the whole point of the handover. Gather the storage keys before the rows go.
  const [docs, notes] = await Promise.all([
    Document.find({ user: userId, projectId: null }).select('key').lean<{ key?: string }[]>(),
    Note.find({ userId, projectId: null }).select('attachments.key').lean<{ attachments?: { key?: string }[] }[]>(),
  ]);
  const suggestions = await Suggestion.find({ userId }).select('shot.key').lean<{ shot?: { key?: string } }[]>();
  // No actor argument, deliberately: a feedback screenshot was stored in an ADMIN's Drive so that
  // reporting a bug never required a Drive of your own, and erasing this account has to reach it.
  // Everything else in this list is the user's own, so the rule would have allowed it anyway.
  await deleteUploads([
    ...docs.map(d => d.key),
    ...notes.flatMap(n => (n.attachments || []).map(a => a.key)),
    ...suggestions.map(s => s.shot?.key),
  ]);

  await Promise.all([
    Link.deleteMany({ userId }),
    Category.deleteMany({ userId }),
    Note.deleteMany({ userId, projectId: null }),
    Task.deleteMany({ userId, projectId: null }),
    Mom.deleteMany({ userId, projectId: null }),
    Document.deleteMany({ user: userId, projectId: null }),
    Contact.deleteMany({ userId }),
    Suggestion.deleteMany({ userId }),
    Event.deleteMany({ actorId: userId }),
    JarvisSession.deleteMany({ userId }),
  ]);

  // 4. Reduce the User row to the retained stub. Everything but name/email/role/deletedAt goes.
  await User.updateOne({ _id: userId }, {
    $set: { role: (role || '').trim().slice(0, 120), deletedAt: new Date() },
    $unset: {
      password: 1, resetToken: 1, resetTokenExpiry: 1, resetAttempts: 1,
      emailVerified: 1, verifyToken: 1, verifyTokenExpiry: 1, verifyAttempts: 1,
      privatePin: 1, pinAttempts: 1, pinLockedUntil: 1, image: 1, contactsSeeded: 1, shareNoticeSeen: 1,
      introDone: 1, introDismissed: 1, tourDone: 1,
      sarvamKey: 1, sarvamAccess: 1, sarvamAccessBy: 1, sarvamAccessAt: 1,
      // The retained stub must not keep a live third-party credential: the sealed refresh token is
      // standing permission to write into their Drive, and a deleted account has none.
      drive: 1,
    },
  });
}

/**
 * Remove retained stubs whose 90 days are up. No scheduler here on purpose — this is the function
 * a cron or an admin runs; scheduling it is a deploy concern, not a code one. Returns how many
 * rows were purged.
 */
export async function purgeDeletedAccounts(now: number = Date.now()) {
  await connectToDatabase();
  const stubs = await User.find({ deletedAt: { $ne: null } }).select('_id deletedAt')
    .lean<{ _id: Types.ObjectId; deletedAt?: Date | null }[]>();
  const due = stubs.filter(u => isPurgeDue(u.deletedAt, now)).map(u => u._id);
  if (!due.length) return { purged: 0 };
  await User.deleteMany({ _id: { $in: due } });
  return { purged: due.length };
}
