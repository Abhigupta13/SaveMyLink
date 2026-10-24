import { describe, test, expect } from 'vitest';
import { prepareNoteBodyFromJarvis, noteChecklistHtml, NOTE_DIVIDER_HTML } from '@/lib/jarvisNoteBody';

describe('Jarvis note body', () => {
  test('plain bullet block becomes checklist with dividers', () => {
    const html = prepareNoteBodyFromJarvis('Groceries\n\n- Milk\n- Eggs\n- [x] Bread');
    expect(html).toContain('note-divider');
    expect(html).toContain('note-checklist');
    expect(html).toContain('Milk');
    expect(html).toContain('checked');
    expect(html).toContain('Bread');
  });

  test('markdown table becomes note-table', () => {
    const html = prepareNoteBodyFromJarvis('| Name | Qty |\n| --- | --- |\n| Milk | 2 |');
    expect(html).toContain('note-table');
    expect(html).toContain('Milk');
    expect(html).toContain('Qty');
  });

  test('checklist helper wraps dividers', () => {
    const html = noteChecklistHtml([{ text: 'A' }, { text: 'B', checked: true }]);
    expect(html.split(NOTE_DIVIDER_HTML).length - 1).toBe(2);
  });
});
