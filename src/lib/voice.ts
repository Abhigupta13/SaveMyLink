/**
 * Which voice Jarvis speaks in.
 *
 * The rule (decided 26 Aug 2026): a MALE voice whenever the speech comes from the non-Sarvam path
 * — the browser's own synthesiser, or Gemini TTS — and a FEMALE voice whenever Sarvam speaks
 * (Hindi and Hinglish). Two paths, two voices, so which engine you are hearing is audible.
 *
 * Sarvam does not speak yet — lib/sarvam is transcription only — so today every call passes
 * 'male'. The gender is a parameter rather than a hardcoded list precisely so that when a Sarvam
 * voice does arrive, the change is one argument and not a rewrite of this file.
 *
 * The Web Speech API does not report gender. There is no flag to read, only names, and the names
 * differ per platform. So: a list, matched case-insensitively, with an honest fallback when
 * nothing matches rather than a guess dressed up as a choice.
 *
 * Pure and import-free so scripts/self-check.mjs can run it under plain node.
 */

export type VoiceGender = 'male' | 'female';

/** Only the fields we actually read — so a test can pass plain objects, and so can a browser. */
export interface VoiceLike { name: string; lang: string; default?: boolean; localService?: boolean }

// Windows/Edge (Microsoft …), Chrome (Google …), macOS/iOS, and the common Android en-IN voices.
const MALE = /\b(male|david|mark|guy|george|ryan|prabhat|madhur|daniel|alex|fred|rishi|oliver|james|thomas|arthur|liam|christopher|eric|roger|steffan|brandon|adam)\b/i;
const FEMALE = /\b(female|zira|aria|jenny|heera|swara|neerja|samantha|victoria|karen|moira|tessa|fiona|susan|catherine|emily|ava|allison|michelle|ana|sonia|libby|natasha|clara|amber|ashley|elizabeth|jane|nancy|sara)\b/i;

const langOf = (v: VoiceLike) => String(v?.lang || '').toLowerCase().replace('_', '-');
const base = (l: string) => l.split('-')[0];

/**
 * The best available voice for this language and gender.
 *
 * Language first, always: an English-sounding male voice reading Devanagari is worse than a Hindi
 * voice of the wrong gender. Within a language the requested gender wins, then anything else in
 * that language, then the browser's default. Returns null when there is nothing to choose from,
 * and the caller simply leaves `utterance.voice` unset — which is what the widget did before this
 * existed, so nothing regresses on a device with no voices installed.
 */
export function pickVoice(voices: VoiceLike[] | null | undefined, lang: string, gender: VoiceGender): VoiceLike | null {
  const all = (voices || []).filter(v => v && v.name);
  if (!all.length) return null;
  const want = String(lang || '').toLowerCase();

  const exact = all.filter(v => langOf(v) === want);
  const sameLanguage = all.filter(v => base(langOf(v)) === base(want));
  const wanted = gender === 'male' ? MALE : FEMALE;
  const other = gender === 'male' ? FEMALE : MALE;

  // A voice that names the gender we want beats one that merely does not contradict it.
  const named = (list: VoiceLike[]) => list.find(v => wanted.test(v.name));
  const notWrong = (list: VoiceLike[]) => list.find(v => !other.test(v.name));

  return named(exact) || named(sameLanguage)
    || notWrong(exact) || notWrong(sameLanguage)
    || exact[0] || sameLanguage[0]
    || all.find(v => v.default) || null;
}
