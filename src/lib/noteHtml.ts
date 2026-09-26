/** Plain-text preview and search — works on legacy plain notes and HTML bodies. */
export function noteBodyPlainText(htmlOrText: string): string {
  if (!htmlOrText) return '';
  let s = htmlOrText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
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

const ALLOWED_TAGS = new Set(['p', 'br', 'div', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'span', 'input']);

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
    if (match.startsWith('</')) return `</${tag}>`;

    if (tag === 'br') return '<br>';

    if (tag === 'input') {
      if (/type\s*=\s*["']?checkbox/i.test(attrs)) {
        const checked = /checked/i.test(attrs) ? ' checked' : '';
        return `<input type="checkbox" contenteditable="false"${checked} />`;
      }
      return '';
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
      const m = attrs.match(/style\s*=\s*["']([^"']*)["']/i);
      const style = m?.[1]?.trim() || '';
      if (/^color\s*:\s*(#[0-9a-f]{3,8}|[a-z]+)$/i.test(style)) {
        return `<span style="${style.toLowerCase()}">`;
      }
      return '<span>';
    }

    if (tag === 'ul') {
      return /note-checklist/i.test(attrs) ? '<ul class="note-checklist">' : '<ul>';
    }

    return `<${tag}>`;
  });

  return out;
}

export function looksLikeNoteHtml(s: string): boolean {
  return /<(?:p|div|br|ul|ol|li|strong|b|em|i|u|span|input)\b/i.test(s);
}
