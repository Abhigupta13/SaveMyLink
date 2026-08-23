/**
 * The one place the chat provider is configured. Jarvis and MOM extraction both route through
 * here, so switching provider or model is a single edit rather than two files drifting apart.
 *
 * Chat runs on Gemini: Groq's free tier allows 8k tokens per MINUTE and 200k per day, and a
 * full-vault prompt is ~3-9k tokens, so a couple of dozen questions exhausted the day. Gemini's
 * free tier is 250k tokens/minute and 1500 requests/day — bounded by requests rather than
 * tokens, so a growing vault costs nothing extra.
 *
 * Audio stays on Groq Whisper. Gemini is not wired for it here, and Groq bills audio against a
 * separate quota that was never the thing running out.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
// An alias, deliberately, not a pinned version: Google ships Flash releases faster than this
// file gets edited (gemini-3-flash was already gone — 404 — by the time it was written), and
// the newest pinned model is usually the most capacity-constrained. Pin via env if you need
// reproducibility; ListModels shows what exists.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatResult = { ok: true; data: any } | { ok: false; error: string };

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

  const call = () => fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GEMINI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, response_format: { type: 'json_object' }, messages }),
  });

  try {
    let res = await call();
    // A per-minute burst clears in seconds and one short wait beats a dead turn. A daily limit
    // reports minutes — retrying into that spends another request to be refused identically.
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 3;
      if (wait <= 10) {
        await new Promise(r => setTimeout(r, wait * 1000));
        res = await call();
      }
    }
    // 503 is Gemini saying the model is busy, not that anything is wrong — the newer Flash
    // releases hit this regularly. It costs nothing against the quota, so just come back.
    if (res.status === 503) {
      await new Promise(r => setTimeout(r, 1500));
      res = await call();
    }

    if (!res.ok) {
      const body = await res.text();
      console.error('LLM error:', res.status, MODEL, body);
      const reason = (() => { try { return JSON.parse(body)?.error?.message; } catch { return null; } })();
      if (res.status === 429) return { ok: false, error: reason ? `Rate limited — ${reason}` : 'Rate limited. Give it a minute.' };
      // 400/404 here is almost always a model name Google has retired — say which one we tried
      if (res.status === 400 || res.status === 404) return { ok: false, error: `Model "${MODEL}" rejected it${reason ? ` — ${reason}` : ''}` };
      if (res.status === 503) return { ok: false, error: 'Gemini is busy right now. Try again in a moment.' };
      return { ok: false, error: `Assistant unavailable (${res.status})` };
    }

    const data = parseLooseJSON((await res.json()).choices?.[0]?.message?.content || '');
    if (!data) return { ok: false, error: 'Assistant returned something unreadable' };
    return { ok: true, data };
  } catch (error) {
    console.error('LLM call failed:', error);
    return { ok: false, error: 'Assistant unavailable' };
  }
}
