/**
 * "Who else can see this?" — the pure rules behind the shared chip and the first-share notice.
 *
 * Links have no projectId and are always private; notes, tasks, documents and meetings are shared
 * exactly when they carry one. Mongoose-free so scripts/self-check.mjs can assert it.
 */
export function projectNameMap(projects: { _id: unknown; name: string }[]) {
  return new Map(projects.map(p => [String(p._id), p.name]));
}

/** The chip text for one record, or null when it is personal or in a group I cannot see. */
export function sharedLabel(item: { projectId?: unknown }, names: Map<string, string>): string | null {
  const id = item?.projectId ? String(item.projectId) : '';
  return (id && names.get(id)) || null;
}

/**
 * Show the "everyone in {group} will see this" sheet? Once per project, and never again once the
 * user ticked "Don't show this again" (stored as '*'). A personal record ('' projectId) never asks.
 */
export function needsShareNotice(seen: readonly string[] | null | undefined, projectId: string | null | undefined): boolean {
  if (!projectId) return false;
  const list = seen || [];
  return !list.includes('*') && !list.includes(projectId);
}

/** How many people can see a group's work: creator + members + viewers, counted once each. */
export function memberCount(project: {
  ownerId?: { email?: string | null } | string | null;
  memberEmails?: (string | null | undefined)[] | null;
  viewerEmails?: (string | null | undefined)[] | null;
} | null | undefined): number {
  if (!project) return 0;
  const owner = typeof project.ownerId === 'object' ? project.ownerId?.email : null;
  const all = [owner, ...(project.memberEmails || []), ...(project.viewerEmails || [])]
    .map(e => String(e || '').trim().toLowerCase()).filter(Boolean);
  return Math.max(1, new Set(all).size);
}
