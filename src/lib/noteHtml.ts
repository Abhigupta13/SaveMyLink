/** Plain-text preview and search — works on legacy plain notes and HTML bodies. */
export function noteBodyPlainText(htmlOrText: string): string {
  if (!htmlOrText) return '';
  let s = htmlOrText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<hr[^>]*>/gi, '\n—\n')
    .replace(/<input[^>]*type=["']?checkbox[^>]*\bchecked\b[^>]*>/gi, '☑ ')
    .replace(/<input[^>]*type=["']?checkbox[^>]*>/gi, '☐ ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function isNoteBodyEmpty(body: string): boolean {
  return noteBodyPlainText(body).length === 0;
}

const ALLOWED_TAGS = new Set([
  'p', 'br', 'div', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'span', 'input', 'font',
  'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);

/**
 * A color a browser's formatting command actually writes: hex, a name, or rgb().
 * Anything else (urls, expressions) is dropped.
 */
export function normalizeCssColor(raw: string): string | null {
  const c = raw.trim().toLowerCase().replace(/!important/g, '').trim();
  if (!c || c === 'inherit' || c === 'transparent' || c === 'currentcolor') return null;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(c)) return c;
  if (/^[a-z]{3,20}$/.test(c)) return c;
  const rgb = c.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/);
  if (!rgb) return null;
  const nums = [rgb[1], rgb[2], rgb[3]].map(n => Number(n));
  if (nums.some(n => n > 255)) return null;
  return `#${nums.map(n => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Keep only the decorations we show. `font` tags from execCommand become a colored span. */
function safeSpanStyle(style: string): string | null {
  const parts: string[] = [];
  const color = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  if (color) {
    const norm = normalizeCssColor(color[1]);
    if (norm) parts.push(`color: ${norm}`);
  }
  if (/font-weight\s*:\s*(bold|[6-9]00)\b/i.test(style)) parts.push('font-weight: bold');
  if (/font-style\s*:\s*italic\b/i.test(style)) parts.push('font-style: italic');
  if (/text-decoration(?:-line)?\s*:\s*[^;]*underline/i.test(style)) parts.push('text-decoration: underline');
  return parts.length ? parts.join('; ') : null;
}

function quotedAttr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
}

/**
 * A checkbox's checked state lives on the DOM property. innerHTML does not
 * include it until the attribute is written, so a tick never survived a save.
 */
export function reflectNoteCheckboxes(root: ParentNode) {
  root.querySelectorAll('input[type="checkbox"]').forEach(node => {
    const input = node as HTMLInputElement;
    if (input.checked) input.setAttribute('checked', '');
    else input.removeAttribute('checked');
  });
}

/** Strip unsafe markup before persisting or rendering shared notes. */
export function sanitizeNoteBody(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  if (!/<[a-z]/i.test(s)) return s;

  let out = s
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');

  out = out.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, tagName, attrs) => {
    const tag = String(tagName).toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (match.startsWith('</')) return tag === 'font' ? '</span>' : `</${tag}>`;

    if (tag === 'br') return '<br>';

    if (tag === 'hr') {
      return /note-divider/i.test(attrs) ? '<hr class="note-divider" contenteditable="false" />' : '';
    }

    if (tag === 'table') {
      return /note-table/i.test(attrs) ? '<table class="note-table">' : '<table class="note-table">';
    }

    if (tag === 'thead' || tag === 'tbody' || tag === 'tr') return `<${tag}>`;

    if (tag === 'th' || tag === 'td') return `<${tag}>`;

    if (tag === 'input') {
      if (/type\s*=\s*["']?checkbox/i.test(attrs)) {
        const checked = /checked/i.test(attrs) ? ' checked' : '';
        return `<input type="checkbox" contenteditable="false"${checked} />`;
      }
      return '';
    }

    if (tag === 'font') {
      const color = normalizeCssColor(quotedAttr(attrs, 'color'));
      return color ? `<span style="color: ${color}">` : '<span>';
    }

    if (tag === 'span') {
      if (/note-mention/i.test(attrs)) {
        const dm = attrs.match(/data-mention\s*=\s*["']([^"']*)["']/i);
        const label = dm?.[1]?.trim().slice(0, 80) || '';
        if (label && /^[\w\s\-_.(),]+$/i.test(label)) {
          const esc = label.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
          return `<span class="note-mention" data-mention="${esc}">`;
        }
        return '';
      }
      const style = safeSpanStyle(quotedAttr(attrs, 'style'));
      return style ? `<span style="${style}">` : '<span>';
    }

    if (tag === 'ul') {
      return /note-checklist/i.test(attrs) ? '<ul class="note-checklist">' : '<ul>';
    }

    return `<${tag}>`;
  });

  return out;
}

export function looksLikeNoteHtml(s: string): boolean {
  return /<(?:p|div|br|ul|ol|li|strong|b|em|i|u|span|input|hr|table|tr|td|th)\b/i.test(s);
}

/** Snippets for the rich editor toolbar (sanitized on save). */
export const NOTE_DIVIDER_SNIPPET = '<hr class="note-divider" contenteditable="false" /><p><br></p>';
export const NOTE_TABLE_SNIPPET =
  '<table class="note-table"><thead><tr><th> </th><th> </th></tr></thead><tbody><tr><td> </td><td> </td></tr><tr><td> </td><td> </td></tr></tbody></table><p><br></p>';

export function noteHasChecklist(body: string): boolean {
  return /class=["'][^"']*note-checklist|note-checklist|<input[^>]*type=["']?checkbox/i.test(body || '');
}
