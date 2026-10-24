import Link from 'next/link';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { headingId, rewriteDocHref, type Heading } from '@/lib/productDocs';

/**
 * One markdown file, rendered. The heading ids are the same list `extractHeadings` already
 * computed, matched by the visible words, so the outline and the article cannot drift.
 * Raw HTML in the markdown is not enabled.
 */
export function DocArticle({ markdown, headings }: { markdown: string; headings: Heading[] }) {
  const left = headings.map(h => h);
  const take = (level: 2 | 3, children: ReactNode) => {
    const text = plainText(children).replace(/\s+/g, ' ').trim();
    const idx = left.findIndex(h => h.level === level && h.text === text);
    if (idx === -1) return headingId(text);
    const id = left[idx].id;
    left.splice(idx, 1);
    return id;
  };

  return (
    <div className="dv-article">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: () => null,
          h2: ({ children }) => <h2 id={take(2, children)}>{children}</h2>,
          h3: ({ children }) => <h3 id={take(3, children)}>{children}</h3>,
          a: ({ href, children }) => {
            const dest = rewriteDocHref(href);
            if (dest.kind === 'drop') return <span>{children}</span>;
            if (dest.kind === 'external') {
              return <a href={dest.href} target="_blank" rel="noreferrer">{children}</a>;
            }
            if (dest.kind === 'hash') return <a href={dest.href}>{children}</a>;
            return <Link href={dest.href}>{children}</Link>;
          },
          table: ({ children }) => (
            <div className="dv-table" tabIndex={0} role="region" aria-label="Table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function plainText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(plainText).join('');
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return plainText(props?.children);
  }
  return '';
}
