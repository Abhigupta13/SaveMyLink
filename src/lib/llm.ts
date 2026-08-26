/**
 * The one place the chat provider is configured. Jarvis and MOM extraction both route through
 * here, so switching provider or model is a single edit rather than two files drifting apart.
 *
 * Chat runs on Gemini: Groq's free tier allows 8k tokens per MINUTE and 200k per day, and a
 * full-vault prompt is ~3-9k tokens, so a couple of dozen questions exhausted the day. Gemini is
 * bounded by REQUESTS rather than tokens, so a growing vault costs nothing extra — but the free
 * allowance is 20 requests/day/model (measured in the r4 gate test, not the 1,500 this comment
 * used to claim). The fallback chain below is what turns that into 60: the quota is per model.
 *
 * Audio does NOT belong here. It runs through `lib/geminiAudio`, which pins its own list of
 * auditioned models — this chain is ordered by chat reliability, and gemini-3.5-flash in it
 * transliterates English into Devanagari, which would silently ruin a Hindi transcript.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

// Pinned, not an alias. gemini-flash-latest looked like the safe choice — it survives Google's
// renames, and gemini-3-flash was already a 404 by the time this file was written — but measured
// against real-sized requests it answered 1 of 4 and returned 503 for the rest, while 3.6 and 3.5
// took every one. The alias evidently points at whatever is most contended. Reliability beats
// rename-proofing: a 404 is one obvious env change, a 75% failure rate is a broken assistant.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

// Contention differs sharply between models at any given moment, so a busy one falls through
// to another rather than costing the turn. Ordered by measured reliability.
const FALLBACKS = ['gemini-3.5-flash', 'gemini-3.7-flash'];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Google's message, whichever envelope it arrives in — an error body is sometimes the bare
 * object and sometimes a single-element array wrapping it. Reading only the object shape
 * threw away the half that says what actually went wrong.
 */
function errorReason(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    return (Array.isArray(parsed) ? parsed[0] : parsed)?.error?.message || null;
  } catch {
    return null;
  }
}

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };
/**
 * `code` exists so a caller can tell "the free quota is gone until tomorrow" apart from "something
 * broke" — they are different facts and the user deserves the true one. Only 429 sets it.
 */
export type ChatResult = { ok: true; data: any } | { ok: false; error: string; code?: 'rate_limited' };

/**
 * Models are asked for JSON, but a provider that ignores response_format tends to return it
 * wrapped in a ```json fence or with a sentence in front. Salvage that rather than failing the
 * whole turn: find the outermost braces and parse those.
 */
export function parseLooseJSON(raw: string): any {
  const text = (raw || '').trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
}

/** One JSON chat completion. Never throws — callers get a message they can show the user. */
export async function chatJSON(messages: ChatMsg[]): Promise<ChatResult> {
  if (!process.env.GEMINI_API_KEY) return { ok: false, error: 'GEMINI_API_KEY not configured' };

  const call = (model: string) => fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GEMINI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages }),
  });

  const models = [MODEL, ...FALLBACKS.filter(m => m !== MODEL)];
  let lastError = 'Assistant unavailable';
  let lastCode: 'rate_limited' | undefined;

  for (const model of models) {
    // Two goes at each model before moving on: 503s often clear within a second or two
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await call(model);
      } catch (error) {
        console.error('LLM call failed:', model, error);
        break;   // network, not capacity — another model on the same host will not help
      }

      if (res.status === 503) {
        lastError = 'Gemini is busy right now. Try again in a moment.';
        lastCode = undefined;
        console.warn(`LLM busy: ${model} (attempt ${attempt + 1})`);
        if (attempt === 0) { await sleep(1200); continue; }
        break;   // this model is saturated — fall through to the next one
      }

      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after')) || 3;
        const body = await res.text();
        const reason = errorReason(body);
        console.warn('LLM rate limited:', model, reason);
        lastError = reason ? `Rate limited — ${reason}` : 'Rate limited. Give it a minute.';
        lastCode = 'rate_limited';

        // A short per-minute burst on this model clears in seconds — one wait beats a dead turn
        if (wait <= 10 && attempt === 0) { await sleep(wait * 1000); continue; }

        // Then fall through to the next model. The free quota is per MODEL, not per project —
        // verified directly: with 3.6-flash returning 429, both 3.5 and 3.7 answered 200 while
        // 3.6 stayed limited. So three models is three separate allowances, and only when all
        // of them are exhausted is the turn actually lost.
        break;
      }

      if (!res.ok) {
        const body = await res.text();
        console.error('LLM error:', res.status, model, body);
        const reason = errorReason(body);
        // 400/404 is a retired model name — the next one in the list may well work
        if (res.status === 400 || res.status === 404) {
          lastError = `Model "${model}" rejected it${reason ? ` — ${reason}` : ''}`;
          lastCode = undefined;
          break;
        }
        lastError = `Assistant unavailable (${res.status})`;
        lastCode = undefined;
        break;
      }

      const data = parseLooseJSON((await res.json()).choices?.[0]?.message?.content || '');
      if (!data) return { ok: false, error: 'Assistant returned something unreadable' };
      return { ok: true, data };
    }
  }

  return { ok: false, error: lastError, code: lastCode };
}
