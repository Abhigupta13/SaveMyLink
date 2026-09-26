/** `@` labels for note attachments — unique per note, human-readable from the file name. */

export function baseNameFromFile(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'image';
  const noExt = trimmed.replace(/\.[^.]+$/, '').trim();
  return (noExt || trimmed).slice(0, 40);
}

export function assignMentionLabel(fileName: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  let base = baseNameFromFile(fileName);
  if (!base) base = 'image';
  let label = base;
  let n = 2;
  while (used.has(label.toLowerCase())) {
    label = `${base} ${n++}`;
  }
  return label;
}

export type NoteAttachLike = { name: string; mentionLabel?: string; mimeType?: string };

export function mentionLabelOf(a: NoteAttachLike, siblings: NoteAttachLike[]): string {
  if (a.mentionLabel?.trim()) return a.mentionLabel.trim();
  const idx = siblings.indexOf(a);
  const prior = siblings.slice(0, idx >= 0 ? idx : siblings.length).map((x) => x.mentionLabel || baseNameFromFile(x.name));
  return assignMentionLabel(a.name, prior);
}

export function isImageAttachment(a: { mimeType?: string; name?: string }) {
  if ((a.mimeType || '').startsWith('image/')) return true;
  const ext = (a.name || '').split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'heic'].includes(ext);
}
