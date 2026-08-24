import { Project } from '@/lib/models/Project';
import { User } from '@/lib/models/User';
import { projectScope, ownerScope } from '@/lib/scope';

/**
 * Membership is granted by raw email string, and until a signup proves it owns that address the
 * string is just a claim — anyone could register boss@theirclient.com and inherit every task,
 * meeting transcript and document ever shared to it.
 *
 * The check lives here rather than at sign-in on purpose: existing accounts keep working and
 * nobody is locked out of their own vault, but shared work stays invisible until the address is
 * confirmed. Every project-scoped read in the app routes through this file, so this is the one
 * place it has to hold.
 *
 * ponytail: one indexed lookup per project-scope call. Move it into the JWT in lib/auth.ts if it
 * ever shows up in profiling.
 */
async function isVerified(userId: string) {
  const user = await User.findById(userId).select('emailVerified').lean<{ emailVerified?: Date | null } | null>();
  return !!user?.emailVerified;
}

// A project is visible to its owner and to invited member emails
export async function projectForMember(projectId: string, userId: string, email?: string | null) {
  return Project.findOne({ _id: projectId, ...projectScope(userId, email, await isVerified(userId)) });
}

/**
 * Every project I can see. Anything carrying one of these ids is shared with me even
 * though I did not create it — that is what makes a project a workspace rather than a tag.
 */
export async function myProjectIds(userId: string, email?: string | null) {
  const projects = await Project.find(projectScope(userId, email, await isVerified(userId)))
    .select('_id').lean();
  return projects.map(p => p._id);
}

/**
 * The read filter, verification lookup already done. Jarvis, search, contacts and MOM each used to
 * build this query inline, which meant the verification gate simply did not apply on those paths —
 * an unverified account could still read a project it had been invited to. Anything that needs the
 * scope now asks for it here.
 */
export async function myProjectFilter(userId: string, email?: string | null) {
  return projectScope(userId, email, await isVerified(userId));
}

/** ownerScope with the verification lookup already done — the filter every owner-only action uses. */
export async function ownerFilter(userId: string, email?: string | null) {
  return ownerScope(userId, email, await isVerified(userId));
}

/**
 * Deleting shared work is an owner's call — the creator or anyone they promoted. Members can
 * create and edit inside a project but not remove: losing a teammate's task to someone else's
 * tidy-up is not recoverable. Personal records (no projectId) stay with whoever created them.
 */
export async function canDelete(doc: { projectId?: any; userId?: any }, userId: string, email?: string | null) {
  if (doc.projectId) {
    return !!(await Project.exists({ _id: doc.projectId, ...(await ownerFilter(userId, email)) }));
  }
  return String(doc.userId) === String(userId);
}

/** Mine, or in one of my projects. The standard read scope for project-aware records. */
export async function mineOrMyProjects(userId: string, email: string | null | undefined, ownerField = 'userId') {
  const ids = await myProjectIds(userId, email);
  return { $or: [{ [ownerField]: userId }, { projectId: { $in: ids } }] };
}
