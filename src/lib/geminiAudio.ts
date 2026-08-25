/**
 * Gemini native audio → transcript. This is the FREE Hindi/Hinglish path.
 *
 * Measured against Groq whisper-large-v3 on five real recordings (r4 gate test): Gemini won every
 * one for Hinglish — Devanagari for Hindi and Latin for English in the same sentence, correct task
 * counts and dates, real names ("Abhishek" where Whisper heard "Sobhasekh"). Whisper stays as the
 * fallback because it is what worked yesterday, and a recording that fails to transcribe at all is
 * worse than one transcribed badly.
 *
 * Known caveats, all measured, none fixed here:
 * - Free tier is **20 requests/day/model**, not the 1,500 the chat comments used to claim. Each
 *   auditioned model in AUDIO_MODELS is its own 20 — that is the only lever on the ceiling.
 * - Gemini invents proper nouns fluently (five different names across five runs of one clip; a
 *   glossary did not stop it). Nothing auto-assigns from a transcript name: extraction routes
 *   through `missing[]` and the confirm screen, which is the guard.
 * - It is 10-20x slower than Whisper (6-20s on clips under 31s). The "Transcribing…" state covers it.
 * - Clips over ~31s are untested, and inline base64 bounds the file at roughly 15 MB.
 *
 * ## Auditioning a model (this is how the daily ceiling goes up)
 * Quota is per model, so every model that passes adds another 20 requests/day. To qualify one:
 *   1. Add it to GEMINI_MODELS in `scratchpad/r4-test/transcribe.mjs` and run it against all five
 *      recordings in `public/uploads/mom/`.
 *   2. The r3 clip (`1787446679508-*.webm`) must come back as `autostainer का tub` — NOT
 *      `ऑटोस्टीनर`. Transliterating English into Devanagari is the exact bug that disqualifies
 *      `gemini-3.5-flash`, which otherwise looks fine.
 *   3. Only then add it to AUDIO_MODELS below.
 * A model that has not been through that must never serve audio — which is why this file has its
 * own list instead of borrowing `llm.ts`'s chat fallback chain.
 *
 * Auditioned and REJECTED (do not re-try these without new evidence):
 * - `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` — all romanise Hindi
 *   ("aaj ka meeting shuru karte hain") or transliterate English into Devanagari. Same failure
 *   as Whisper, which is the whole reason this path exists.
 * - `gemini-3.7-flash` — script is CORRECT, but it misheard "autostainer" as "auto strainer" and
 *   was returning 503 most of the time. Worth re-auditioning when it is less contended.
 * - `gemini-2.5-flash` — 404, no longer available to new keys.
 */

import type { SarvamResult } from '@/lib/sarvam';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Auditioned models, in order. Each one is a separate 20-requests/day allowance. */
export const AUDIO_MODELS = ['gemini-3.6-flash'];

/**
 * The script rule is the whole reason this beats Whisper — without it Gemini romanises Hindi or
 * transliterates English into Devanagari, and the transcript stops being readable by either side.
 * Verbatim, not translated: the extractor downstream does the translating, and it needs the
 * original words to route names and dates correctly.
 */
const PROMPT = `Transcribe this audio verbatim.

Rules:
- Write Hindi words in Devanagari script.
- Write English words in Latin script, spelled correctly (do NOT transliterate English into Devanagari).
- Keep code-switching exactly as spoken — do not translate.
- Mark speaker turns as "Speaker 1:", "Speaker 2:" only if more than one voice is audible.
- Preserve names, dates, numbers and times exactly as spoken.
- Output only the transcript. No preamble, no commentary. If nothing is audible, output exactly: [no speech]`;

const NO_SPEECH = '[no speech]';

// A 20-minute recording takes ~20s. Three minutes is the "something is wrong" line, not a target.
const TIMEOUT_MS = 3 * 60_000;

/**
 * MediaRecorder reports `audio/webm;codecs=opus`; Gemini wants a bare type and rejects the
 * parameterised one. Anything that is not audio at all is treated as webm — the recorder only
 * ever produces webm, so a surprising value means a stripped Content-Type, not a different format.
 */
export const audioMime = (type?: string | null) => {
  const base = String(type || '').split(';')[0].trim().toLowerCase();
  return base.startsWith('audio/') ? base : 'audio/webm';
};

/** Never throws. On any failure the caller falls back to Whisper, so the error is for the log. */
export async function transcribeAudio(audio: Blob): Promise<SarvamResult<{ text: string; model: string }>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: 'GEMINI_API_KEY not configured' };

  const data = Buffer.from(await audio.arrayBuffer()).toString('base64');
  const mime = audioMime(audio.type);
  let lastError = 'Transcription unavailable';

  for (const model of AUDIO_MODELS) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data } }] }],
          generationConfig: { temperature: 0 },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      console.error('Gemini audio call failed:', model, error);
      return { ok: false, error: 'Could not reach the transcription service' };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('Gemini audio error:', res.status, model, body.slice(0, 400));
      lastError = res.status === 429 ? 'Gemini audio quota is used up for today'
        : res.status === 503 ? 'Gemini is busy right now'
        : `Gemini rejected the recording (${res.status})`;
      continue;   // the next AUDITIONED model, and nothing else
    }

    const body = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = (body.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    // Silence comes back as the sentinel; store it as the empty transcript Whisper would have given.
    return { ok: true, data: { text: text === NO_SPEECH ? '' : text, model } };
  }

  return { ok: false, error: lastError };
}
