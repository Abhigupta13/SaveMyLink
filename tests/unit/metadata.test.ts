import { describe, test, expect } from 'vitest';
import { absolutise, previewFromHtml, titleFromHtml } from '@/lib/metadata';

/**
 * Finding a preview image in a page that did not make it easy.
 *
 * The network half of scrapeMetadata cannot be tested without reaching the internet, but everything
 * that decides WHICH url wins — and, more importantly, which candidates get rejected — is pure and
 * belongs under test. The rejections are the part worth guarding: a fallback chain that happily
 * returns a tracking pixel or a header logo looks like the feature working, so nobody reports it,
 * and every card quietly shows the wrong picture.
 */

const BASE = 'https://example.com/articles/one';

describe('absolutise', () => {
  test('keeps an absolute url', () => {
    expect(absolutise('https://cdn.example.com/a.jpg', BASE)).toBe('https://cdn.example.com/a.jpg');
  });

  /** The three shapes that used to be stored verbatim and render as a broken image. */
  test('resolves root-relative, document-relative and protocol-relative sources', () => {
    expect(absolutise('/media/hero.jpg', BASE)).toBe('https://example.com/media/hero.jpg');
    expect(absolutise('hero.jpg', BASE)).toBe('https://example.com/articles/hero.jpg');
    expect(absolutise('//cdn.example.com/hero.jpg', BASE)).toBe('https://cdn.example.com/hero.jpg');
  });

  test('refuses anything that is not http(s)', () => {
    expect(absolutise('data:image/png;base64,iVBORw0KGgo=', BASE)).toBe('');
    expect(absolutise('javascript:alert(1)', BASE)).toBe('');
    expect(absolutise('', BASE)).toBe('');
  });

  test('survives a base it cannot parse rather than throwing', () => {
    expect(absolutise('not a url', '')).toBe('');
  });
});

describe('previewFromHtml', () => {
  test('nothing in, nothing out', () => {
    expect(previewFromHtml('', BASE)).toBe('');
    expect(previewFromHtml('<html><body><p>no images here</p></body></html>', BASE)).toBe('');
  });

  /** The case that covers most news, recipe and product pages. */
  test('reads JSON-LD, including a bare string image', () => {
    const html = `<script type="application/ld+json">
      {"@type":"NewsArticle","image":"https://cdn.example.com/ld.jpg"}</script>`;
    expect(previewFromHtml(html, BASE)).toBe('https://cdn.example.com/ld.jpg');
  });

  test('reads JSON-LD where image is an object, an array, or buried in @graph', () => {
    const obj = `<script type="application/ld+json">{"image":{"url":"https://c.example.com/o.jpg"}}</script>`;
    expect(previewFromHtml(obj, BASE)).toBe('https://c.example.com/o.jpg');

    const arr = `<script type="application/ld+json">{"image":["https://c.example.com/a.jpg","https://c.example.com/b.jpg"]}</script>`;
    expect(previewFromHtml(arr, BASE)).toBe('https://c.example.com/a.jpg');

    const graph = `<script type="application/ld+json">
      {"@graph":[{"@type":"Person"},{"@type":"Article","image":{"url":"/g.jpg"}}]}</script>`;
    expect(previewFromHtml(graph, BASE)).toBe('https://example.com/g.jpg');
  });

  test('malformed JSON-LD is skipped, not fatal, and a later block still wins', () => {
    const html = `
      <script type="application/ld+json">{ this is not json </script>
      <script type="application/ld+json">{"thumbnailUrl":"https://cdn.example.com/two.jpg"}</script>`;
    expect(previewFromHtml(html, BASE)).toBe('https://cdn.example.com/two.jpg');
  });

  test('falls back to link[rel=image_src] and the itemprop/thumbnail metas', () => {
    expect(previewFromHtml('<link rel="image_src" href="/is.jpg">', BASE))
      .toBe('https://example.com/is.jpg');
    expect(previewFromHtml('<meta itemprop="image" content="/ip.jpg">', BASE))
      .toBe('https://example.com/ip.jpg');
    expect(previewFromHtml('<meta name="thumbnail" content="/tn.jpg">', BASE))
      .toBe('https://example.com/tn.jpg');
  });

  test('attribute order does not matter', () => {
    expect(previewFromHtml('<link href="/is.jpg" rel="image_src">', BASE))
      .toBe('https://example.com/is.jpg');
  });

  /** Ordering is the contract: what the site declared beats what we guessed from the body. */
  test('a declared image outranks the first body image', () => {
    const html = `
      <script type="application/ld+json">{"image":"https://cdn.example.com/declared.jpg"}</script>
      <img src="https://cdn.example.com/body.jpg" width="800" height="600">`;
    expect(previewFromHtml(html, BASE)).toBe('https://cdn.example.com/declared.jpg');
  });

  describe('the last-resort body image', () => {
    test('takes a plausible content image', () => {
      const html = '<img src="/photos/hero.jpg" width="1200" height="630">';
      expect(previewFromHtml(html, BASE)).toBe('https://example.com/photos/hero.jpg');
    });

    test('picks up a lazy-loaded source', () => {
      const html = '<img src="" data-src="/photos/lazy.jpg" width="900" height="500">';
      expect(previewFromHtml(html, BASE)).toBe('https://example.com/photos/lazy.jpg');
    });

    /* The whole point of the exclusions. Each of these would render as a "working" preview. */
    test('rejects furniture: pixels, sprites, logos, icons and svg', () => {
      for (const src of [
        '/img/tracking-pixel.gif', '/assets/sprite.png', '/static/logo.png',
        '/i/icon-192.png', '/img/1x1.gif', '/brand/mark.svg', '/u/avatar.jpg',
      ]) {
        expect(previewFromHtml(`<img src="${src}" width="800" height="600">`, BASE)).toBe('');
      }
    });

    test('rejects an image that declares itself too small', () => {
      expect(previewFromHtml('<img src="/photos/thumb.jpg" width="80" height="80">', BASE)).toBe('');
      expect(previewFromHtml('<img src="/photos/strip.jpg" width="900" height="12">', BASE)).toBe('');
    });

    test('rejects a data: uri', () => {
      expect(previewFromHtml('<img src="data:image/gif;base64,R0lGOD" width="800" height="600">', BASE)).toBe('');
    });

    test('undeclared dimensions are fine when the src names an image format', () => {
      expect(previewFromHtml('<img src="/photos/plain.jpg">', BASE)).toBe('https://example.com/photos/plain.jpg');
      expect(previewFromHtml('<img src="/photos/plain.webp?v=2">', BASE)).toBe('https://example.com/photos/plain.webp?v=2');
    });

    /**
     * The real one, found by running the chain against bbc.com: its first <img> is
     * `static.files.bbci.co.uk/bbcdotcom/web/20260821-…-web-3`, a build asset that is not an image.
     * Extensionless AND undimensioned means we cannot show it is an image, and a broken thumbnail
     * is worse than none — so it has to lose.
     */
    test('refuses an extensionless src that declares no dimensions', () => {
      expect(previewFromHtml('<img src="/bbcdotcom/web/20260821-111954-d28c495a96-web-3">', BASE)).toBe('');
    });

    test('but accepts an extensionless src that declares content dimensions', () => {
      expect(previewFromHtml('<img src="/cdn/opaque-id" width="1200" height="630">', BASE))
        .toBe('https://example.com/cdn/opaque-id');
    });

    test('skips furniture and keeps looking rather than giving up at the first image', () => {
      const html = `
        <img src="/static/logo.png" width="200" height="60">
        <img src="/img/pixel.gif" width="1" height="1">
        <img src="/photos/real.jpg" width="1200" height="800">`;
      expect(previewFromHtml(html, BASE)).toBe('https://example.com/photos/real.jpg');
    });
  });
});

describe('titleFromHtml', () => {
  test('reads and tidies the document title', () => {
    expect(titleFromHtml('<title>  A   headline\n  here </title>')).toBe('A headline here');
  });

  test('no title is an empty string, not a throw', () => {
    expect(titleFromHtml('<html><body>hi</body></html>')).toBe('');
  });

  test('a runaway title is capped', () => {
    expect(titleFromHtml(`<title>${'x'.repeat(500)}</title>`).length).toBe(300);
  });
});
