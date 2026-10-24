import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The product docs a founder can read inside the app.
 *
 * The slug is the only thing a URL may name. The filename is looked up from this list and never
 * built from the request, so a path like `../package.json` has nothing to match and is not a file
 * we open. Order here is the order of the sidebar.
 */
export const PRODUCT_DOCS = [
  { slug: 'readme', file: 'README.md', title: 'Overview', blurb: 'What the docs are, and how they stay current' },
  { slug: 'features', file: 'features.md', title: 'Features', blurb: 'What a person can do, route by route' },
  { slug: 'tech', file: 'tech.md', title: 'Technology', blurb: 'Stack, data, actions, and deploy' },
  { slug: 'strategy', file: 'strategy.md', title: 'Strategy', blurb: 'The wedge, and what not to copy' },
  { slug: 'business', file: 'business.md', title: 'Business', blurb: 'Who it is for, distribution, and cost' },
  { slug: 'access', file: 'access.md', title: 'Access', blurb: 'Sign-in, roles, the safe, and limits' },
  { slug: 'versions', file: 'versions.md', title: 'Versions', blurb: 'What changed, and which number to bump' },
] as const;

export type DocSlug = (typeof PRODUCT_DOCS)[number]['slug'];

export interface DocMeta {
  slug: DocSlug;
  file: string;
  title: string;
  blurb: string;
  href: string;
}

export interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface LoadedDoc extends DocMeta {
  markdown: string;
  headings: Heading[];
}

const BY_SLUG = new Map(PRODUCT_DOCS.map(d => [d.slug, d]));
const BY_FILE = new Map(PRODUCT_DOCS.map(d => [d.file.toLowerCase(), d.slug]));

export function hrefFor(slug: DocSlug): string {
  return slug === 'readme' ? '/admin/docs' : `/admin/docs/${slug}`;
}

export function docBySlug(slug: string): DocMeta | null {
  const row = BY_SLUG.get(slug as DocSlug);
  if (!row) return null;
  return { slug: row.slug, file: row.file, title: row.title, blurb: row.blurb, href: hrefFor(row.slug) };
}

/**
 * The id on a heading and the id in "on this page" come from this one function.
 * Punctuation is dropped so "Meetings (the product)" and a hand-written #meetings-the-product agree.
 */
export function headingId(text: string): string {
  const id = text
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return id || 'section';
}

/** Visible heading text: links and inline code become their words, markers go. */
export function headingText(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ## and ### only, in document order, skipping anything inside a fence.
 * A repeated title gets -1, -2, … so two "Access" headings do not share an id.
 */
export function extractHeadings(markdown: string): Heading[] {
  const out: Heading[] = [];
  const seen = new Map<string, number>();
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = headingText(m[2]);
    let id = headingId(text);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n > 0) id = `${id}-${n}`;
    out.push({ id, text, level: m[1].length as 2 | 3 });
  }
  return out;
}

export type DocHref =
  | { kind: 'internal'; href: string }
  | { kind: 'external'; href: string }
  | { kind: 'hash'; href: string }
  | { kind: 'drop' };

function hashId(hash: string): string {
  let decoded = hash;
  try { decoded = decodeURIComponent(hash); } catch { /* a broken % stays as written */ }
  return headingId(decoded);
}

/**
 * A link written in the markdown. Relative `.md` links stay inside this reader.
 * Anything that leaves `docs/` — a source file, a `..` path — is dropped and the
 * words of the link stay on the page as text.
 */
export function rewriteDocHref(href: string | undefined): DocHref {
  if (!href) return { kind: 'drop' };
  const raw = href.trim();
  if (!raw) return { kind: 'drop' };
  if (/^(javascript|data|vbscript):/i.test(raw)) return { kind: 'drop' };
  if (raw.startsWith('//')) return { kind: 'drop' };
  if (raw.startsWith('#')) return { kind: 'hash', href: `#${hashId(raw.slice(1))}` };
  if (/^https?:\/\//i.test(raw)) return { kind: 'external', href: raw };
  if (/^mailto:/i.test(raw)) return { kind: 'external', href: raw };

  const hashAt = raw.indexOf('#');
  const pathPart = (hashAt === -1 ? raw : raw.slice(0, hashAt)).replace(/^\.\//, '');
  const hash = hashAt === -1 ? '' : raw.slice(hashAt + 1);
  if (!pathPart) return hash ? { kind: 'hash', href: `#${hashId(hash)}` } : { kind: 'drop' };
  if (pathPart.startsWith('/') || pathPart.includes('..') || pathPart.includes('\\') || pathPart.includes('/')) {
    return { kind: 'drop' };
  }
  const slug = BY_FILE.get(pathPart.toLowerCase());
  if (!slug) return { kind: 'drop' };
  const suffix = hash ? `#${hashId(hash)}` : '';
  return { kind: 'internal', href: `${hrefFor(slug)}${suffix}` };
}

export function loadProductDocs(): LoadedDoc[] {
  return PRODUCT_DOCS.map(meta => {
    const markdown = readFileSync(join(process.cwd(), 'docs', meta.file), 'utf8');
    return {
      slug: meta.slug,
      file: meta.file,
      title: meta.title,
      blurb: meta.blurb,
      href: hrefFor(meta.slug),
      markdown,
      headings: extractHeadings(markdown),
    };
  });
}
