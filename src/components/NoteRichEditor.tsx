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
} from 'lucide-react';
import { sanitizeNoteBody } from '@/lib/noteHtml';
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
  const [picker, setPicker] = useState<{ top: number; left: number; items: NoteMentionOption[] } | null>(null);

  const imageMentions = useMemo(
    () => mentionAttachments.filter((a) => isImageAttachment(a)),
    [mentionAttachments],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (value === lastEmitted.current && el.innerHTML === value) return;
    lastEmitted.current = value;
    el.innerHTML = value || '';
  }, [value]);

  const emit = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const html = sanitizeNoteBody(el.innerHTML);
    lastEmitted.current = html;
    onChange(html);
  }, [onChange]);

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

  const focusEditor = () => rootRef.current?.focus();

  const run = (cmd: string, arg?: string) => {
    focusEditor();
    document.execCommand(cmd, false, arg);
    emit();
  };

  const insertChecklist = () => {
    focusEditor();
    document.execCommand(
      'insertHTML',
      false,
      '<ul class="note-checklist"><li><input type="checkbox" contenteditable="false" /> </li></ul>',
    );
    emit();
  };

  const onEditorInput = () => {
    emit();
    syncMentionPicker();
  };

  const onEditorKeyUp = () => syncMentionPicker();

  const onEditorClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'checkbox') {
      e.stopPropagation();
      emit();
    }
    syncMentionPicker();
  };

  const lineMinHeight = `${minRows * 1.65}em`;

  return (
    <div className="note-rich-editor">
      <div className="note-rich-toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" className="note-rich-btn" title="Bold" aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => run('bold')}>
          <Bold size={16} />
        </button>
        <button type="button" className="note-rich-btn" title="Italic" aria-label="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => run('italic')}>
          <Italic size={16} />
        </button>
        <button type="button" className="note-rich-btn" title="Underline" aria-label="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => run('underline')}>
          <Underline size={16} />
        </button>
        <span className="note-rich-sep" aria-hidden />
        <button type="button" className="note-rich-btn" title="Bullet list" aria-label="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={() => run('insertUnorderedList')}>
          <List size={16} />
        </button>
        <button type="button" className="note-rich-btn" title="Numbered list" aria-label="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => run('insertOrderedList')}>
          <ListOrdered size={16} />
        </button>
        <button type="button" className="note-rich-btn" title="Checklist" aria-label="Checklist" onMouseDown={(e) => e.preventDefault()} onClick={insertChecklist}>
          <ListChecks size={16} />
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
                focusEditor();
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
          <button
            type="button"
            className="note-rich-btn"
            title="Text color"
            aria-label="Text color"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => colorRef.current?.showPicker?.() ?? colorRef.current?.click()}
          >
            <Palette size={16} />
          </button>
          <input
            ref={colorRef}
            type="color"
            className="note-rich-color-input"
            defaultValue="#0090ff"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => run('foreColor', e.target.value)}
          />
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
