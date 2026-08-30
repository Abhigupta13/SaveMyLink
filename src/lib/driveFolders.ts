/**
 * Where a file lands inside the user's own Google Drive.
 *
 * One root folder they will recognise, and under it one folder per place the file came from:
 *
 *   ALL-YOU-NEED/
 *     personal/      — notes and anything else not filed under a group
 *     digilocker/    — uploaded from the Digi Locker tab
 *     <Group name>/  — anything belonging to a project group
 *
 * The point of the tree is that it still makes sense when it is opened in Drive months later by
 * someone who has forgotten this app exists. That is the whole promise of keeping files in their
 * account rather than ours, so the names are the user's own words — the group's name — not ids.
 *
 * Pure and import-free on purpose: scripts/self-check.mjs runs it under plain node, which cannot
 * resolve `@/`.
 */

/** The one folder the app creates at the root of My Drive. */
export const DRIVE_ROOT = 'ALL-YOU-NEED';
/** Not filed under a group. */
export const PERSONAL_FOLDER = 'personal';
/** Uploaded from the Digi Locker tab, and not filed under a group. */
export const LOCKER_FOLDER = 'digilocker';

export type UploadSource = 'document' | 'note' | 'message' | 'feedback';

/** Control characters, which have no business in a file name and are header injection in a URL. */
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * Drive itself allows almost anything in a name, but one carrying a slash or a newline reads as a
 * broken path in every file browser, and a leading dot hides the folder outright. Kept close to the
 * user's own wording otherwise — this is the label they will scan for.
 */
export function safeFolderName(name: string | null | undefined, fallback = PERSONAL_FOLDER): string {
  const clean = String(name ?? '')
    .replace(CONTROL, ' ')
    .replace(/[\\/]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60)
    .trim();
  return clean || fallback;
}

/**
 * The file's own name in Drive.
 *
 * Deliberately NOT the slug-and-lowercase treatment the old S3 key used: that was fine for an
 * opaque object key nobody would ever read, and hostile for a file sitting in someone's Drive.
 * "Site survey (final).pdf" stays exactly that.
 */
export function safeFileName(name: string | null | undefined): string {
  const clean = String(name ?? '')
    .replace(CONTROL, ' ')
    .replace(/[\\/]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .slice(0, 120)
    .trim();
  return clean || 'file';
}

/**
 * Which sub-folder a file belongs in.
 *
 * A group always wins: a document filed under a project belongs with that project's work, whichever
 * screen it was uploaded from. Only when there is no group does the source decide, and that is what
 * separates "my passport" from "a note I typed".
 */
export function folderFor(source: UploadSource, projectName?: string | null): string {
  if (projectName && String(projectName).trim()) return safeFolderName(projectName, 'group');
  if (source === 'document') return LOCKER_FOLDER;
  if (source === 'feedback') return 'feedback';
  return PERSONAL_FOLDER;
}
