import { describe, test, expect } from 'vitest';
import { normalizeCssColor, sanitizeNoteBody, noteHasChecklist, noteBodyPlainText } from '@/lib/noteHtml';

describe('note formatting survives a save', () => {
  test('bold, lists, and checklists stay', () => {
    const html = sanitizeNoteBody(
      '<b>Bold</b> <i>and</i> <u>line</u><ul><li>one</li></ul><ul class="note-checklist"><li><input type="checkbox" checked></li></ul>',
    );
    expect(html).toContain('<b>Bold</b>');
    expect(html).toContain('<i>and</i>');
    expect(html).toContain('<u>line</u>');
    expect(html).toContain('<ul><li>one</li></ul>');
    expect(html).toContain('class="note-checklist"');
    expect(html).toContain('checked');
  });

  test('browser color markup becomes a span', () => {
    expect(normalizeCssColor('rgb(229, 72, 77)')).toBe('#e5484d');
    expect(sanitizeNoteBody('<font color="#e5484d">Red</font>')).toBe('<span style="color: #e5484d">Red</span>');
    expect(sanitizeNoteBody('<span style="color: rgb(0, 144, 255);">Blue</span>')).toBe('<span style="color: #0090ff">Blue</span>');
    expect(sanitizeNoteBody('<span style="font-weight: bold;">Thick</span>')).toContain('font-weight: bold');
  });

  test('divider and table survive sanitize', () => {
    const html = sanitizeNoteBody(
      '<p>Intro</p><hr class="note-divider" /><table class="note-table"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    );
    expect(html).toContain('note-divider');
    expect(html).toContain('note-table');
    expect(html).toContain('<th>A</th>');
  });

  test('checklist detection and plain-text ticks', () => {
    const html = '<ul class="note-checklist"><li><input type="checkbox" checked /> milk</li></ul>';
    expect(noteHasChecklist(html)).toBe(true);
    expect(noteBodyPlainText(html)).toContain('☑');
    expect(noteBodyPlainText('<ul class="note-checklist"><li><input type="checkbox" /> eggs</li></ul>')).toContain('☐');
  });

  test('unsafe color and scripts are dropped', () => {
    expect(normalizeCssColor('url(https://evil)')).toBeNull();
    expect(sanitizeNoteBody('<span style="color: url(https://evil)">x</span>')).toBe('<span>x</span>');
    expect(sanitizeNoteBody('<script>alert(1)</script><b>ok</b>')).toBe('<b>ok</b>');
  });
});
