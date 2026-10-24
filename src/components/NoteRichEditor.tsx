'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  ListChecks,
  Palette,
  AtSign,
  Minus,
  Table,
} from 'lucide-react';
import { sanitizeNoteBody, reflectNoteCheckboxes, NOTE_DIVIDER_SNIPPET, NOTE_TABLE_SNIPPET } from '@/lib/noteHtml';
import { detectMention, keepMention, queryOf, type MentionTrigger } from '@/lib/mentionTrigger';
import {
  getEditorPlainCaret,
  insertMentionHtml,
  plainTextBeforeCaret,
} from '@/lib/noteEditableMention';
import { isImageAttachment } from '@/lib/noteMentionLabels';

const COLORS = [
  { label: 'Default', value: '' },
  { label: 'Red', value: '#e5484d' },
  { label: 'Orange', value: '#f76808' },
  { label: 'Green', value: '#30a46c' },
  { label: 'Blue', value: '#0090ff' },
  { label: 'Purple', value: '#8e4ec6' },
];

export type NoteMentionOption = {
  key: string;
  label: string;
  url: string;
  mimeType?: string;
};

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minRows?: number;
  /** Image attachments on this note — type `@` to insert a reference. */
  mentionAttachments?: NoteMentionOption[];
};

export default function NoteRichEditor({
  value,
  onChange,
  placeholder,
  minRows = 14,
  mentionAttachments = [],
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);
  const colorRef = useRef<HTMLInputElement>(null);
  const mentionOpen = useRef<MentionTrigger | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [picker, setPicker] = useState<{ top: number; left: number; items: NoteMentionOption[] } | null>(null);
  const [pressed, setPressed] = useState({ bold: false, italic: false, underline: false, ul: false, ol: false });

  const imageMentions = useMemo(
    () => mentionAttachments.filter((a) => isImageAttachment(a)),
    [mentionAttachments],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const next = value || '';
    // The browser's innerHTML and the sanitized string differ by quotes and
    // whitespace. Rewriting the DOM on that difference wipes the caret and the
    // formatting the toolbar just applied.
    if (sanitizeNoteBody(el.innerHTML) === sanitizeNoteBody(next)) {
      lastEmitted.current = next;
      return;
    }
    lastEmitted.current = next;
    el.innerHTML = next;
  }, [value]);

  useEffect(() => {
    const remember = () => {
      const el = rootRef.current;
      const sel = window.getSelection();
      if (!el || !sel?.rangeCount) return;
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      if (node !== el && !el.contains(node)) return;
      savedRange.current = range.cloneRange();
      try {
        setPressed({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          ul: document.queryCommandState('insertUnorderedList'),
          ol: document.queryCommandState('insertOrderedList'),
        });
      } catch { /* some webviews throw when the document has no selection */ }
    };
    document.addEventListener('selectionchange', remember);
    return () => document.removeEventListener('selectionchange', remember);
  }, []);

  const emit = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    reflectNoteCheckboxes(el);
    const html = sanitizeNoteBody(el.innerHTML);
    lastEmitted.current = html;
    onChange(html);
  }, [onChange]);

  /**
   * The toolbar is outside the editor. On a phone the tap moves the selection
   * off the note before click runs, so bold and lists applied to nothing.
   * The last range that was inside the note is put back first.
   */
  const restoreSelection = () => {
    const el = rootRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = savedRange.current;
    const anchor = range?.commonAncestorContainer;
    if (range && anchor && (anchor === el || el.contains(anchor))) {
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    const fresh = document.createRange();
    fresh.selectNodeContents(el);
    fresh.collapse(false);
    sel.removeAllRanges();
    sel.addRange(fresh);
    savedRange.current = fresh.cloneRange();
  };

  const syncMentionPicker = useCallback(() => {
    const el = rootRef.current;
    if (!el || !imageMentions.length) {
      mentionOpen.current = null;
      setPicker(null);
      return;
    }
    const caret = getEditorPlainCaret(el);
    if (caret == null) {
      mentionOpen.current = null;
      setPicker(null);
      return;
    }
    const before = plainTextBeforeCaret(el, caret);
    const open =
      keepMention(mentionOpen.current, before, before.length) ??
      detectMention(before, before.length);
    mentionOpen.current = open;
    if (!open) {
      setPicker(null);
      return;
    }
    const q = queryOf(before, open, before.length);
    const items = imageMentions.filter((m) => m.label.toLowerCase().includes(q));
    if (!items.length) {
      setPicker(null);
      return;
    }
    const sel = window.getSelection();
    if (sel?.rangeCount && sel.getRangeAt(0).getBoundingClientRect) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const host = el.getBoundingClientRect();
      setPicker({
        top: rect.bottom - host.top + 6,
        left: Math.max(8, rect.left - host.left),
        items,
      });
    } else {
      setPicker({ top: 40, left: 8, items });
    }
  }, [imageMentions]);

  const pickMention = (label: string) => {
    const el = rootRef.current;
    const open = mentionOpen.current;
    if (!el || !open) return;
    const caret = getEditorPlainCaret(el);
    if (caret == null) return;
    insertMentionHtml(el, open, caret, label);
    mentionOpen.current = null;
    setPicker(null);
    emit();
    el.focus();
  };

  const focusEditor = () => restoreSelection();

  const run = (cmd: string, arg?: string) => {
    restoreSelection();
    document.execCommand(cmd, false, arg);
    emit();
  };

  const insertHtml = (html: string) => {
    focusEditor();
    document.execCommand('insertHTML', false, html);
    emit();
  };

  const insertChecklist = () => {
    insertHtml('<ul class="note-checklist"><li><input type="checkbox" contenteditable="false" /> </li></ul>');
  };

  const insertDivider = () => insertHtml(NOTE_DIVIDER_SNIPPET);

  const insertTable = () => insertHtml(NOTE_TABLE_SNIPPET);

  const onEditorInput = () => {
    emit();
    syncMentionPicker();
  };

  const onEditorKeyUp = () => syncMentionPicker();

  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const el = rootRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    let node: Node | null = sel.anchorNode;
    while (node && node !== el) {
      if (node instanceof HTMLLIElement && node.closest('ul.note-checklist')) {
        e.preventDefault();
        const li = node;
        const next = document.createElement('li');
        next.innerHTML = '<input type="checkbox" contenteditable="false" /> ';
        li.insertAdjacentElement('afterend', next);
        const range = document.createRange();
        const afterBox = next.childNodes[next.childNodes.length - 1];
        if (afterBox) {
          range.setStart(afterBox, afterBox.textContent?.length ? 1 : 0);
        } else {
          range.selectNodeContents(next);
        }
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        savedRange.current = range.cloneRange();
        emit();
        return;
      }
      node = node.parentNode;
    }
  };

  const onEditorClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'checkbox') {
      e.stopPropagation();
      // The tick flips as the click's default action, after this handler.
      queueMicrotask(() => emit());
    }
    syncMentionPicker();
  };

  const lineMinHeight = `${minRows * 1.65}em`;

  return (
    <div className="note-rich-editor">
      <div className="note-rich-toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" className="note-rich-btn" title="Bold" aria-label="Bold" aria-pressed={pressed.bold} onMouseDown={(e) => e.preventDefault()} onClick={() => run('bold')}>
          <Bold size={16} />
        </button>
        <button type="button" className="note-rich-btn" title="Italic" aria-label="Italic" aria-pressed={pressed.italic} onMouseDown={(e) => e.preventDefault()} onClick={() => run('italic')}>
          <Italic size={16} />
        </button>
        <button type="button" className="note-rich-btn" title="Underline" aria-label="Underline" aria-pressed={pressed.underline} onMouseDown={(e) => e.preventDefault()} onClick={() => run('underline')}>
          <Underline size={16} />
        </button>
        <span className="note-rich-sep" aria-hidden />
        <button type="button" className="note-rich-btn" title="Bullet list" aria-label="Bullet list" aria-pressed={pressed.ul} onMouseDown={(e) => e.preventDefault()} onClick={() => run('insertUnorderedList')}>
          <List size={16} />
        </button>
        <button type="button" className="note-rich-btn" title="Numbered list" aria-label="Numbered list" aria-pressed={pressed.ol} onMouseDown={(e) => e.preventDefault()} onClick={() => run('insertOrderedList')}>
          <ListOrdered size={16} />
        </button>
        <button type="button" className="note-rich-btn" title="Checklist" aria-label="Checklist" onMouseDown={(e) => e.preventDefault()} onClick={insertChecklist}>
          <ListChecks size={16} />
        </button>
        <button type="button" className="note-rich-btn" title="Divider" aria-label="Divider" onMouseDown={(e) => e.preventDefault()} onClick={insertDivider}>
          <Minus size={16} />
        </button>
        <button type="button" className="note-rich-btn" title="Table" aria-label="Table" onMouseDown={(e) => e.preventDefault()} onClick={insertTable}>
          <Table size={16} />
        </button>
        {imageMentions.length > 0 && (
          <>
            <span className="note-rich-sep" aria-hidden />
            <button
              type="button"
              className="note-rich-btn"
              title="Reference an image (@)"
              aria-label="Reference an attached image"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                restoreSelection();
                document.execCommand('insertText', false, '@');
                emit();
                syncMentionPicker();
              }}
            >
              <AtSign size={16} />
            </button>
          </>
        )}
        <span className="note-rich-sep" aria-hidden />
        <div className="note-rich-colors">
        <label className="note-rich-color" title="Text color">
          <span className="note-rich-btn" aria-hidden="true">
            <Palette size={16} />
          </span>
          <input
            ref={colorRef}
            type="color"
            className="note-rich-color-input"
            defaultValue="#0090ff"
            aria-label="Text color"
            onChange={(e) => run('foreColor', e.target.value)}
          />
        </label>
          {COLORS.filter((c) => c.value).map((c) => (
            <button
              key={c.value}
              type="button"
              className="note-rich-swatch"
              title={c.label}
              aria-label={c.label}
              style={{ background: c.value }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run('foreColor', c.value)}
            />
          ))}
        </div>
      </div>
      <div className="note-rich-editor-wrap">
        <div
          ref={rootRef}
          className="note-rich-body field bare-input"
          contentEditable
          role="textbox"
          aria-multiline
          data-placeholder={placeholder}
          suppressContentEditableWarning
          onInput={onEditorInput}
          onKeyUp={onEditorKeyUp}
          onKeyDown={onEditorKeyDown}
          onClick={onEditorClick}
          onBlur={() => {
            emit();
            setTimeout(() => setPicker(null), 150);
          }}
          style={{ minHeight: lineMinHeight }}
        />
        {picker && (
          <ul className="note-mention-picker" role="listbox" style={{ top: picker.top, left: picker.left }}>
            {picker.items.map((item) => (
              <li key={item.key}>
                <button type="button" role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => pickMention(item.label)}>
                  <span className="note-mention-picker-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt="" />
                  </span>
                  <span>@{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {imageMentions.length > 0 && (
        <p className="note-mention-hint">Type <strong>@</strong> in the note to reference an attached image.</p>
      )}
    </div>
  );
}
