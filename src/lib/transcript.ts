/**
 * Joining what a speech session has finalised to what earlier sessions in the same turn banked.
 *
 * Web Speech sessions are short-lived, so JarvisWidget restarts them and banks each session's
 * final text to carry it across. That is only correct if a restarted session starts with an empty
 * `e.results` list — which Chrome does, and Android's WebView does not. Where the list survives the
 * restart, this session's finals ALREADY contain everything banked, and adding the bank on top
 * duplicates it. Once per restart, compounding:
 *
 *   "add"  ->  "add add task"  ->  "add add task add task to"  ->  "add add task add task to fish"
 *
 * which is what someone dictating one short sentence actually saw. Not a transcription fault, and
 * not something a better microphone or a different engine would have helped: the words were
 * recognised correctly every time and then written down more than once.
 *
 * So instead of assuming which engine we are on, merge idempotently. Called on every result event,
 * so it has to be safe to apply repeatedly to its own output — mergeFinals(x, mergeFinals(x, y))
 * must equal mergeFinals(x, y).
 */
export function mergeFinals(banked: string, finals: string): string {
  if (!banked) return finals;
  if (!finals) return banked;
  // The engine kept the results list across the restart: `finals` is already the whole thing.
  if (finals.startsWith(banked)) return finals;
  return banked + finals;
}
