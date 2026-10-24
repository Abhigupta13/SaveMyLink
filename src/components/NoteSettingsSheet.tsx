'use client';

import { X } from 'lucide-react';
import { PrivateToggle } from '@/components/PrivateSafe';
import { NOTE_COLORS } from '@/lib/noteColors';

type Project = { _id: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  noteProject: string;
  onProjectChange: (id: string) => void;
  notePrivate: boolean;
  onPrivateChange: (v: boolean) => void;
  color: string;
  onColorChange: (c: string) => void;
};

export default function NoteSettingsSheet({
  open,
  onClose,
  projects,
  noteProject,
  onProjectChange,
  notePrivate,
  onPrivateChange,
  color,
  onColorChange,
}: Props) {
  if (!open) return null;

  const groupName = projects.find((p) => String(p._id) === noteProject)?.name;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="note-settings-title">Note options</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <p className="field-hint note-settings-hint">
          Group and privacy apply when you save. Personal notes are only yours; project notes are shared with the group.
        </p>

        {projects.length > 0 && (
          <label className="note-settings-label" htmlFor="note-settings-group">
            Group
          </label>
        )}
        {projects.length > 0 && (
          <select
            id="note-settings-group"
            className="field note-settings-field"
            value={noteProject}
            onChange={(e) => onProjectChange(e.target.value)}
          >
            <option value="">Personal — only me</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        <div className="note-settings-private">
          <PrivateToggle value={notePrivate} onChange={onPrivateChange} groupName={groupName} />
        </div>

        <p className="note-settings-label">Color</p>
        <div className="note-color-row" role="list">
          {NOTE_COLORS.map((c) => (
            <button
              key={c.id || 'default'}
              type="button"
              role="listitem"
              className={`note-color-swatch${color === c.id ? ' on' : ''}`}
              title={c.label}
              aria-label={c.label}
              aria-pressed={color === c.id}
              style={c.id ? { background: c.id } : undefined}
              onClick={() => onColorChange(c.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
