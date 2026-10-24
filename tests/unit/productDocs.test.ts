import { createElement } from 'react';
import { describe, test, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocArticle } from '@/components/admin/DocArticle';
import {
  docBySlug, extractHeadings, headingId, loadProductDocs, rewriteDocHref,
} from '@/lib/productDocs';

describe('product docs allowlist', () => {
  test('a slug is the only way in', () => {
    expect(docBySlug('features')?.href).toBe('/admin/docs/features');
    expect(docBySlug('readme')?.href).toBe('/admin/docs');
    expect(docBySlug('README')).toBeNull();
    expect(docBySlug('../package')).toBeNull();
    expect(docBySlug('features/../../package.json')).toBeNull();
    expect(docBySlug('')).toBeNull();
  });
});

describe('heading ids', () => {
  test('punctuation and a repeated title', () => {
    expect(headingId('Meetings (the product)')).toBe('meetings-the-product');
    const headings = extractHeadings([
      '# Title',
      '',
      '## Access',
      '',
      '```',
      '## Not a heading',
      '```',
      '',
      '## Access',
      '### Who can open a page',
    ].join('\n'));
    expect(headings.map(h => h.id)).toEqual(['access', 'access-1', 'who-can-open-a-page']);
    expect(headings.map(h => h.level)).toEqual([2, 2, 3]);
  });
});

describe('markdown links stay inside the reader', () => {
  test('a sibling doc, a hash, an outside path', () => {
    expect(rewriteDocHref('features.md')).toEqual({ kind: 'internal', href: '/admin/docs/features' });
    expect(rewriteDocHref('./access.md#Admin')).toEqual({ kind: 'internal', href: '/admin/docs/access#admin' });
    expect(rewriteDocHref('README.md')).toEqual({ kind: 'internal', href: '/admin/docs' });
    expect(rewriteDocHref('#Project roles')).toEqual({ kind: 'hash', href: '#project-roles' });
    expect(rewriteDocHref('../DECISION.md')).toEqual({ kind: 'drop' });
    expect(rewriteDocHref('src/lib/scope.ts')).toEqual({ kind: 'drop' });
    expect(rewriteDocHref('javascript:alert(1)')).toEqual({ kind: 'drop' });
    expect(rewriteDocHref('https://example.com/a')).toEqual({ kind: 'external', href: 'https://example.com/a' });
  });
});

describe('the files on disk', () => {
  test('every listed doc loads and features still has the meeting section', () => {
    const all = loadProductDocs();
    expect(all.map(d => d.slug)).toEqual(['readme', 'features', 'tech', 'strategy', 'business', 'access', 'versions']);
    const features = all.find(d => d.slug === 'features');
    expect(features?.headings.some(h => h.id === 'meetings-the-product')).toBe(true);
  });

  test('each section id is on the rendered heading', () => {
    const features = loadProductDocs().find(d => d.slug === 'features');
    if (!features) throw new Error('features doc missing');
    const html = renderToStaticMarkup(
      createElement(DocArticle, { markdown: features.markdown, headings: features.headings }),
    );
    for (const heading of features.headings) {
      expect(html).toContain(`id="${heading.id}"`);
    }
    expect(html).toContain('href="/admin/docs/tech"');
  });
});
