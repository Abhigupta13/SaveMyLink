'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export interface DocNavItem {
  slug: string;
  title: string;
  blurb: string;
  href: string;
  headings: { id: string; text: string }[];
}

/**
 * The two levels of the reader: the documents, then the sections of the one open now.
 * Typing filters both. The article itself is rendered on the server and passed in as children.
 */
export function DocShell({
  docs,
  current,
  children,
}: {
  docs: DocNavItem[];
  current: string;
  children: ReactNode;
}) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const open = docs.find(d => d.slug === current) ?? docs[0];

  const rows = docs.map(d => {
    const titleHit = d.title.toLowerCase().includes(query) || d.blurb.toLowerCase().includes(query);
    const hits = d.headings.filter(h => h.text.toLowerCase().includes(query));
    return {
      ...d,
      show: !query || titleHit || hits.length > 0,
      outline: query ? (titleHit ? d.headings : hits) : [],
    };
  });
  const visible = rows.filter(d => d.show);
  const onPage = (open?.headings ?? []).filter(h => !query || h.text.toLowerCase().includes(query));

  return (
    <div className="container docsview">
      <header className="dv-top">
        <Link href="/admin" className="dv-back">Admin</Link>
        <p className="dv-eyebrow">Founders only</p>
        <h1>{open?.title}</h1>
        {open?.blurb && <p className="dv-lede">{open.blurb}</p>}
        <input
          className="dv-search"
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Filter documents and sections"
          aria-label="Filter documents and sections"
          autoComplete="off"
        />
      </header>

      <div className="dv-layout">
        <nav className="dv-docs" aria-label="Documents">
          {visible.length === 0 && <p className="dv-empty">Nothing matches.</p>}
          {query ? (
            <ul className="dv-results">
              {visible.map(d => (
                <li key={d.slug}>
                  <Link href={d.href} aria-current={d.slug === current ? 'page' : undefined}>{d.title}</Link>
                  {d.outline.length > 0 && (
                    <ul>
                      {d.outline.map(h => (
                        <li key={h.id}>
                          {d.slug === current
                            ? <a href={`#${h.id}`}>{h.text}</a>
                            : <Link href={`${d.href}#${h.id}`}>{h.text}</Link>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="dv-pills">
              {docs.map(d => (
                <li key={d.slug}>
                  <Link href={d.href} aria-current={d.slug === current ? 'page' : undefined}>{d.title}</Link>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <nav className="dv-onpage" aria-label="On this page">
          <p className="dv-onpage-label">On this page</p>
          {onPage.length === 0
            ? <p className="dv-empty">{query ? 'Nothing on this page.' : 'No sections.'}</p>
            : (
              <ul>
                {onPage.map(h => (
                  <li key={h.id}><a href={`#${h.id}`}>{h.text}</a></li>
                ))}
              </ul>
            )}
        </nav>

        <div className="dv-main">{children}</div>
      </div>
    </div>
  );
}
