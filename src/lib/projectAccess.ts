import { Project } from '@/lib/models/Project';

// A project is visible to its owner and to invited member emails
export function projectForMember(projectId: string, userId: string, email?: string | null) {
  return Project.findOne({
    _id: projectId,
    $or: [{ ownerId: userId }, { memberEmails: (email || '').toLowerCase() }],
  });
}
