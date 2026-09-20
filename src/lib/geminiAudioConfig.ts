/**
 * Pure audio-transcription constants/helpers — no llm/env imports.
 * scripts/self-check.mjs imports this under bare Node; geminiAudio.ts re-exports.
 */

/** Auditioned models, in order. Each one is a separate 20-requests/day allowance. */
export const AUDIO_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];

/** MediaRecorder → Gemini MIME normalization. */
export const audioMime = (type?: string | null) => {
  const base = String(type || '').split(';')[0].trim().toLowerCase();
  return base.startsWith('audio/') ? base : 'audio/webm';
};
