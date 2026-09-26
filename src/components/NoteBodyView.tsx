'use client';

import { useEffect, useMemo, useRef } from 'react';
import { noteBodyPlainText, looksLikeNoteHtml, sanitizeNoteBody } from '@/lib/noteHtml';
import { mentionLabelOf, isImageAttachment } from '@/lib/noteMentionLabels';
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
}: Props) {
  const viewRef = useRef<HTMLDivElement>(null);
  const byLabel = useMemo(() => labelMap(attachments), [attachments]);

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

  if (mode === 'preview' || !looksLikeNoteHtml(body)) {
    const text = noteBodyPlainText(body);
    const shown = mode === 'preview' ? text.slice(0, maxPreview) : text;
    return <div className={className}>{shown}</div>;
  }

  const safe = sanitizeNoteBody(body);
  return (
    <div
      ref={viewRef}
      className={`note-rich-view ${className || ''}`.trim()}
      dangerouslySetInnerHTML={{ __html: safe }}
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
