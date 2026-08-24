/**
 * The one rule that decides whether you can see someone else's work.
 *
 * Project membership is granted by raw email string (`memberEmails`). Until a signup proves it
 * owns that address the string is only a claim — without this gate, registering
 * boss@theirclient.com would inherit every task, meeting transcript and document ever shared to
 * it. Ownership is different: `ownerId` is a real user id and was never claimable by typing an
 * address, so an unverified account keeps every project it created. Withholding those would lock
 * existing users out of their own work to close a hole they were never in.
 *
 * Lives apart from projectAccess.ts, which pulls in mongoose, purely so scripts/self-check.mjs can
 * assert this without a database. It is the rule most worth having a test on.
 */
export function projectScope(userId: string, email: string | null | undefined, verified: boolean) {
  const or: Record<string, unknown>[] = [{ ownerId: userId }];
  const normalized = (email || '').trim().toLowerCase();
  if (verified && normalized) or.push({ memberEmails: normalized });
  return { $or: or };
}

/** What the client gets back: getProjects populates ownerId as {email, name}, elsewhere it is a raw id. */
export interface OwnableProject {
  ownerId?: { email?: string | null } | string | null;
  ownerEmails?: (string | null | undefined)[] | null;
}

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

/**
 * The server-side gate for anything only an owner may do: add or remove members, rename, delete
 * shared work. `ownerId` is the creator and always matches. The `ownerEmails` branch is gated on
 * verification for the same reason `memberEmails` is — an unverified signup claiming an owner
 * address would otherwise get delete rights over a team's shared work, which is strictly worse
 * than the read access that gate was built for.
 *
 * Deleting the whole project is NOT this — that stays `{ ownerId }`, creator only, because it is
 * the one action with no undo.
 */
export function ownerScope(userId: string, email: string | null | undefined, verified: boolean) {
  const or: Record<string, unknown>[] = [{ ownerId: userId }];
  const normalized = lower(email);
  if (verified && normalized) or.push({ ownerEmails: normalized });
  return { $or: or };
}

/**
 * The creator, or anyone since promoted. Pass `myUserId` when holding a raw document, whose
 * `ownerId` is an id rather than the `{email}` the client receives — one rule for both shapes,
 * because two spellings of "is this person an owner" is how the answers start disagreeing.
 */
export function isProjectOwner(
  project: OwnableProject | null | undefined,
  myEmail: string | null | undefined,
  myUserId?: string | null,
): boolean {
  if (!project) return false;
  if (isProjectCreator(project, myEmail, myUserId)) return true;
  const me = lower(myEmail);
  return !!me && (project.ownerEmails || []).some(e => lower(e) === me);
}

/** The creator alone — permanent, cannot be demoted, and the only one who may delete the project. */
export function isProjectCreator(
  project: OwnableProject | null | undefined,
  myEmail: string | null | undefined,
  myUserId?: string | null,
): boolean {
  const owner = project?.ownerId;
  if (!owner) return false;
  if (typeof owner === 'object') {
    const me = lower(myEmail);
    return !!me && lower(owner.email) === me;
  }
  return !!myUserId && String(owner) === String(myUserId);
}
