import ogs from 'open-graph-scraper';
import { youtubeId } from '@/lib/url';

/**
 * Finding a link's title and preview image.
 *
 * Previews were coming back empty far more often than the web actually warrants, and there were
 * three separate reasons for it — all fixed here.
 *
 * 1. **Nothing identified itself as a browser.** open-graph-scraper sends `Origin` and
 *    `Accept: text/html` and no User-Agent at all (see its lib/request), so undici's default goes
 *    out or none does. A large share of the web — anything behind Cloudflare, most news sites,
 *    most retailers — answers that with a challenge page or a 403, which parses fine and contains
 *    no og:image. The scrape "succeeded" and returned nothing. Sending a real UA is the single
 *    biggest win here.
 *
 * 2. **The timeout was wrong by three orders of magnitude.** ogs takes `timeout` in SECONDS and
 *    this passed 5000, which is not five seconds but eighty-three minutes — so a host that
 *    accepted the connection and then stalled held the save open essentially forever, because the
 *    abort signal never fired.
 *
 * 3. **Only og:image and twitter:image were ever read**, and only as literal strings. Sites that
 *    publish their image through JSON-LD (nearly all news, recipe and product pages) or through
 *    the older `link[rel=image_src]` were treated as having no image, and any site that wrote a
 *    RELATIVE url — `/media/hero.jpg` — had that stored verbatim and rendered as a broken img.
 *
 * The fallback chain runs over the HTML ogs already fetched and hands back, so none of it costs a
 * second request. When it genuinely finds nothing it returns an empty string and says so honestly;
 * the card then collapses its image band rather than drawing a placeholder, because an invented
 * thumbnail is a worse answer than no thumbnail.
 */

/**
 * A current desktop Chrome string. This is not cloaking — it asks for the same page a person would
 * get, which is the page whose preview we are trying to show. A stale UA is treated as a bot by
 * some CDNs, so it is worth keeping roughly current.
 */
const PREVIEW_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Seconds, because that is what ogs multiplies by 1000. Long enough for a slow CDN, short enough
 *  that saving a link never feels hung — this runs inline with the save. */
const PREVIEW_TIMEOUT_SECONDS = 8;

/**
 * Resolve a candidate against the page it came from, and refuse anything that is not http(s).
 *
 * This is what makes relative (`/hero.jpg`), protocol-relative (`//cdn.site/hero.jpg`) and
 * document-relative (`img/hero.jpg`) sources work — all three were previously stored as-is and
 * rendered as a broken image. Dropping `data:` and `javascript:` here also means nothing that
 * reaches the database can be anything but a fetchable URL.
 */
export function absolutise(candidate: string, base: string): string {
  const raw = (candidate || '').trim();
  if (!raw) return '';
  try {
    const resolved = new URL(raw, base || undefined);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : '';
  } catch {
    return '';
  }
}

/** One attribute out of one already-matched tag. Attribute order varies, so the tag is found first
 *  and the attribute pulled out of it, rather than trying to match both in one pattern. */
function attrFrom(tag: string, attr: string): string {
  const m = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1].trim() : '';
}

function tagAttr(html: string, pattern: RegExp, attr: string): string {
  const tag = html.match(pattern);
  return tag ? attrFrom(tag[0], attr) : '';
}

/** Schema.org's `image` is a string, an object with a url, or an array of either — and it is
 *  routinely nested inside `@graph`, so this walks rather than reading one fixed path. */
function firstUrl(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = firstUrl(item);
      if (hit) return hit;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    const { url, contentUrl } = value as Record<string, unknown>;
    if (typeof url === 'string') return url.trim();
    if (typeof contentUrl === 'string') return contentUrl.trim();
  }
  return '';
}

/** Depth-capped so a pathological document cannot spin here. */
function walkForImage(node: unknown, depth: number): string {
  if (depth > 6 || !node || typeof node !== 'object') return '';
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = walkForImage(item, depth + 1);
      if (hit) return hit;
    }
    return '';
  }
  const obj = node as Record<string, unknown>;
  const direct = firstUrl(obj.image ?? obj.thumbnailUrl);
  if (direct) return direct;
  for (const value of Object.values(obj)) {
    const hit = walkForImage(value, depth + 1);
    if (hit) return hit;
  }
  return '';
}

function imageFromJsonLd(html: string): string {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  // Capped: a page with fifty JSON-LD blocks is not going to yield a better answer in the fiftieth.
  for (const block of blocks.slice(0, 5)) {
    const body = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    try {
      const hit = walkForImage(JSON.parse(body), 0);
      if (hit) return hit;
    } catch {
      // Malformed JSON-LD is common and is not an error worth surfacing — try the next block.
    }
  }
  return '';
}

/** A src that ends in a real raster image extension, ignoring any query or fragment. */
const IMAGE_EXTENSION = /\.(jpe?g|png|webp|avif|gif|bmp)(\?|#|$)/i;

/**
 * Last resort: the first image in the document that looks like content rather than furniture.
 *
 * The exclusions matter more than the inclusion. Without them the "preview" for most sites becomes
 * their header logo or a 1x1 analytics pixel, which looks like the feature working and is worse
 * than an empty band, because nobody reports it as broken.
 *
 * The positive-signal requirement was added after testing this against real pages: bbc.com's first
 * <img> is `static.files.bbci.co.uk/bbcdotcom/web/20260821-…-web-3`, an extensionless build asset
 * that is not an image at all. Nothing about the tag says so, so the only safe rule is to demand
 * evidence rather than assume — either the src names an image format, or the tag declares
 * dimensions big enough to be content. Anything that can prove neither is passed over, and the
 * card collapses instead of rendering a broken thumbnail.
 */
function firstContentImage(html: string): string {
  const tags = html.match(/<img[^>]+>/gi) || [];
  for (const tag of tags.slice(0, 40)) {
    // data-src as well as src: lazy-loaded images leave src empty or as a placeholder.
    const src = attrFrom(tag, 'src') || attrFrom(tag, 'data-src');
    if (!src || src.startsWith('data:')) continue;
    if (/\.svg(\?|#|$)/i.test(src)) continue;
    if (/(sprite|spacer|pixel|blank|1x1|avatar|icon|logo|badge|tracking|beacon)/i.test(src)) continue;

    // Declared dimensions, where present, are the cheapest way to reject furniture.
    const width = Number(attrFrom(tag, 'width'));
    const height = Number(attrFrom(tag, 'height'));
    if ((width && width < 200) || (height && height < 200)) continue;

    const looksBigEnough = width >= 200 && height >= 200;
    if (!IMAGE_EXTENSION.test(src) && !looksBigEnough) continue;
    return src;
  }
  return '';
}

const LINK_IMAGE_SRC = /<link[^>]+rel\s*=\s*["']image_src["'][^>]*>/i;
const META_ITEMPROP_IMAGE = /<meta[^>]+itemprop\s*=\s*["']image["'][^>]*>/i;
const META_THUMBNAIL = /<meta[^>]+name\s*=\s*["']thumbnail["'][^>]*>/i;

/**
 * Everything ogs does not look at, in descending order of how much the site meant it.
 *
 * Pure and network-free so tests/unit/metadata.test.ts can hold the ordering and the rejections to
 * account without reaching the internet — the same reason lib/punctuality and lib/taskAccess are
 * split from the code that calls them.
 */
export function previewFromHtml(html: string, base: string): string {
  if (!html) return '';
  const candidates = [
    imageFromJsonLd(html),
    tagAttr(html, LINK_IMAGE_SRC, 'href'),
    tagAttr(html, META_ITEMPROP_IMAGE, 'content'),
    tagAttr(html, META_THUMBNAIL, 'content'),
    firstContentImage(html),
  ];
  for (const candidate of candidates) {
    const absolute = absolutise(candidate, base);
    if (absolute) return absolute;
  }
  return '';
}

/** The document's own <title>, for sites that set no og:title. Better than showing a bare URL. */
export function titleFromHtml(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return m[1].replace(/\s+/g, ' ').trim().slice(0, 300);
}

export async function scrapeMetadata(url: string) {
  // YouTube: keyless thumbnail URL + oEmbed title — faster and more reliable than scraping
  const ytId = youtubeId(url);
  if (ytId) {
    let title = '';
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) title = (await res.json()).title || '';
    } catch {
      // keep empty title; thumbnail still works
    }
    return {
      title,
      image: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
      duration: '',
      quality: ''
    };
  }

  try {
    const { result, html } = await ogs({
      url,
      timeout: PREVIEW_TIMEOUT_SECONDS,
      fetchOptions: {
        headers: {
          'user-agent': PREVIEW_UA,
          // ogs defaults to a bare `Accept: text/html`, which some origins answer with a 406.
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
      },
    });

    // Relative sources resolve against where the page actually ENDED UP, not what was typed —
    // a shortener or an http→https redirect makes those two different, and the typed one would
    // resolve a relative image onto the wrong host.
    const base = result.ogUrl || result.requestUrl || url;
    const image =
      absolutise(result.ogImage?.[0]?.url ?? '', base) ||
      absolutise(result.twitterImage?.[0]?.url ?? '', base) ||
      previewFromHtml(html ?? '', base);

    return {
      title: result.ogTitle || result.twitterTitle || titleFromHtml(html ?? ''),
      image,
      duration: '', // Optional/Difficult without API
      quality: ''
    };
  } catch (error) {
    // A refusal, a timeout or an unreachable host all land here. Empty is the honest answer and the
    // caller renders it as "no preview" rather than as a failure the person has to act on.
    console.error('Exception while scraping metadata:', error);
    return { title: '', image: '', duration: '', quality: '' };
  }
}
