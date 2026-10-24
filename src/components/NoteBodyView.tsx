'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  noteBodyPlainText,
  looksLikeNoteHtml,
  noteHasChecklist,
  sanitizeNoteBody,
  reflectNoteCheckboxes,
} from '@/lib/noteHtml';
import { mentionLabelOf, isImageAttachment } from '@/lib/noteMentionLabels';

function emitBodyFromView(root: HTMLDivElement, onBodyChange?: (html: string) => void) {
  if (!onBodyChange) return;
  reflectNoteCheckboxes(root);
  onBodyChange(sanitizeNoteBody(root.innerHTML));
}
type Attachment = {
  key: string;
  name: string;
  url: string;
  mimeType?: string;
  mentionLabel?: string;
};

type Props = {
  body: string;
  attachments?: Attachment[];
  mode?: 'preview' | 'full';
  maxPreview?: number;
  className?: string;
  /** Tap checklist boxes in read or grid preview (Keep-style). */
  interactive?: boolean;
  onBodyChange?: (html: string) => void;
  /** Stop card click when toggling a box on the grid. */
  stopCheckboxPropagation?: boolean;
};

function labelMap(attachments: Attachment[]) {
  const map = new Map<string, Attachment>();
  for (const a of attachments) {
    map.set(mentionLabelOf(a, attachments).toLowerCase(), a);
  }
  return map;
}

export default function NoteBodyView({
  body,
  attachments = [],
  mode = 'full',
  maxPreview = 160,
  className,
  interactive,
  onBodyChange,
  stopCheckboxPropagation,
}: Props) {
  const viewRef = useRef<HTMLDivElement>(null);
  const byLabel = useMemo(() => labelMap(attachments), [attachments]);

  useEffect(() => {
    if (!viewRef.current || !looksLikeNoteHtml(body)) return;
    reflectNoteCheckboxes(viewRef.current);
  }, [body, mode]);

  useEffect(() => {
    if (mode !== 'full' || !viewRef.current) return;
    const root = viewRef.current;
    root.querySelectorAll('.note-mention').forEach((el) => {
      const label = (el as HTMLElement).dataset.mention?.toLowerCase();
      if (!label) return;
      const att = byLabel.get(label);
      if (!att || !isImageAttachment(att)) return;
      if (el.nextElementSibling?.classList.contains('note-mention-figure')) return;
      const fig = document.createElement('figure');
      fig.className = 'note-mention-figure';
      const img = document.createElement('img');
      img.src = att.url;
      img.alt = att.name;
      img.loading = 'lazy';
      fig.appendChild(img);
      el.insertAdjacentElement('afterend', fig);
    });
  }, [body, byLabel, mode]);

  if (!body) return null;

  const richPreview = mode === 'preview' && noteHasChecklist(body) && looksLikeNoteHtml(body);

  if ((mode === 'preview' && !richPreview) || !looksLikeNoteHtml(body)) {
    const text = noteBodyPlainText(body);
    const shown = mode === 'preview' ? text.slice(0, maxPreview) : text;
    return <div className={className}>{shown}</div>;
  }

  const safe = sanitizeNoteBody(body);
  const richClass = [
    'note-rich-view',
    interactive ? 'note-rich-view-interactive' : '',
    richPreview ? 'note-rich-view-preview' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={viewRef}
      className={richClass}
      dangerouslySetInnerHTML={{ __html: safe }}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        const isBox = t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'checkbox';
        if (isBox && stopCheckboxPropagation) e.stopPropagation();
        if (!interactive || !viewRef.current || !isBox) return;
        queueMicrotask(() => emitBodyFromView(viewRef.current!, onBodyChange));
      }}
    />
  );
}

/** Read-only note body with inline images for @mentions (editor preview while writing). */
export function NoteBodyReadout({ body, attachments }: { body: string; attachments: Attachment[] }) {
  if (!body && !attachments.length) return null;
  return (
    <div className="note-readout">
      {body ? <NoteBodyView body={body} attachments={attachments} mode="full" /> : null}
    </div>
  );
}
