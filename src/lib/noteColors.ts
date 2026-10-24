import type { CSSProperties } from 'react';

/** Google Keep–style card backgrounds (light / dark friendly via color-mix on cards). */
export const NOTE_COLORS = [
  { id: '', label: 'Default' },
  { id: '#fff9b1', label: 'Yellow' },
  { id: '#f28b82', label: 'Red' },
  { id: '#fbbc04', label: 'Orange' },
  { id: '#ccff90', label: 'Green' },
  { id: '#a7ffeb', label: 'Teal' },
  { id: '#cbf0f8', label: 'Blue' },
  { id: '#d7aefb', label: 'Purple' },
  { id: '#e6c9a8', label: 'Brown' },
  { id: '#e8eaed', label: 'Gray' },
] as const;

export function noteCardStyle(color?: string | null): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    background: `color-mix(in srgb, ${color} 42%, var(--bg-secondary))`,
    borderColor: `color-mix(in srgb, ${color} 55%, var(--border-color))`,
  };
}
