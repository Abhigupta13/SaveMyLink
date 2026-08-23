import { Project } from '@/lib/models/Project';

// A project is visible to its owner and to invited member emails
export function projectForMember(projectId: string, userId: string, email?: string | null) {
  return Project.findOne({
    _id: projectId,
    $or: [{ ownerId: userId }, { memberEmails: (email || '').toLowerCase() }],
  });
}

/**
 * Every project I can see. Anything carrying one of these ids is shared with me even
 * though I did not create it — that is what makes a project a workspace rather than a tag.
 */
export async function myProjectIds(userId: string, email?: string | null) {
  const projects = await Project.find({
    $or: [{ ownerId: userId }, { memberEmails: (email || '').toLowerCase() }],
  }).select('_id').lean();
  return projects.map(p => p._id);
}

/**
 * Deleting shared work is the project owner's call. Members can create and edit inside a
 * project but not remove — losing a teammate's task to someone else's tidy-up is not
 * recoverable. Personal records (no projectId) stay with whoever created them.
 */
export async function canDelete(doc: { projectId?: any; userId?: any }, userId: string) {
  if (doc.projectId) return !!(await Project.exists({ _id: doc.projectId, ownerId: userId }));
  return String(doc.userId) === String(userId);
}

/** Mine, or in one of my projects. The standard read scope for project-aware records. */
export async function mineOrMyProjects(userId: string, email: string | null | undefined, ownerField = 'userId') {
  const ids = await myProjectIds(userId, email);
  return { $or: [{ [ownerField]: userId }, { projectId: { $in: ids } }] };
}
