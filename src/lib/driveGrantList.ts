/**
 * WHO a file is offered to, and WHICH files may be offered — the whole decision, with no Google in
 * it and nothing that touches a request.
 *
 * Split out of driveGrants.ts for one reason: that file imports `next/server` for `after()`, and
 * `scripts/self-check.mjs` runs under node's strip-only type removal, which cannot resolve it. The
 * house rule is that lib/ logic stays importable so it can be asserted for real — the two rules
 * below (never the uploader, never another person's file) are exactly the kind that must be tested
 * rather than read, because getting either wrong hands somebody's file to the wrong audience.
 */

/**
 * Per file. A group this big is not the shape this app is for, and the cap is what stops one upload
 * into a runaway member list turning into hundreds of calls on somebody's Google quota.
 */
export const MAX_GRANTS = 25;

/**
 * Who to offer the file to. Lowercased and deduplicated because a roster is four hand-typed lists
 * stitched together (`projectPeople`) and the same person often appears in two of them — the same
 * address twice is two calls to Google for one outcome.
 *
 * The uploader is dropped: they already own the file, and Google answers a permission naming the
 * file's own owner with an error, which would burn the first slot of the cap on every upload.
 */
export function grantRecipients(
  people: (string | null | undefined)[] | null | undefined,
  uploaderEmail?: string | null,
): string[] {
  const me = String(uploaderEmail || '').trim().toLowerCase();
  const out = new Set<string>();
  for (const person of people || []) {
    const email = String(person || '').trim().toLowerCase();
    if (!email || email === me) continue;
    out.add(email);
    if (out.size >= MAX_GRANTS) break;
  }
  return [...out];
}
