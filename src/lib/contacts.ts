/**
 * Merging your address book with the people on your projects.
 *
 * Pure and mongoose-free so scripts/self-check.mjs can assert the rules that matter: that an
 * address is matched case-insensitively (or the same person appears twice), that you are never
 * your own contact, and that an address already seeded is never re-created — which is the only
 * thing making a deleted contact stay deleted.
 */

export interface MergeableContact {
  email?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ProjectPeopleSource {
  name: string;
  ownerId?: { email?: string | null } | null;
  memberEmails?: (string | null | undefined)[] | null;
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** email -> the names of the projects that person shares with me. Excludes me. */
export function peopleByProject(projects: ProjectPeopleSource[], myEmail?: string | null) {
  const me = norm(myEmail);
  const out = new Map<string, string[]>();
  for (const p of projects || []) {
    for (const raw of [p.ownerId?.email, ...(p.memberEmails || [])]) {
      const email = norm(raw);
      if (!email || email === me) continue;
      out.set(email, [...(out.get(email) || []), p.name]);
    }
  }
  return out;
}

/**
 * `missing` is who needs a Contact created; `withProjects` is the single list to render.
 * A contact with no email simply carries no projects — it is still yours and still listed.
 */
export function mergeContacts<T extends MergeableContact>(opts: {
  contacts: T[];
  projects: ProjectPeopleSource[];
  seeded?: (string | null | undefined)[] | null;
  myEmail?: string | null;
}) {
  const onProjects = peopleByProject(opts.projects, opts.myEmail);
  const have = new Set((opts.contacts || []).map(c => norm(c.email)).filter(Boolean));
  const seeded = new Set((opts.seeded || []).map(norm).filter(Boolean));

  const missing = [...onProjects.keys()].filter(e => !have.has(e) && !seeded.has(e));

  const withProjects = (list: T[]) => list
    .map(c => ({ ...c, projects: onProjects.get(norm(c.email)) || [] }))
    .sort((a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')));

  return { onProjects, missing, withProjects };
}
