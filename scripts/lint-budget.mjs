// A ratchet for lint debt. Run: npm run lint:budget   (--update to re-baseline)
//
// The problem this solves: there are ~329 outstanding ESLint problems, 272 of them errors. A CI job
// running `eslint` and failing on a non-zero exit would be red on its first run and every run after,
// for reasons that have nothing to do with the change under test. A gate that is always red is not a
// gate — it trains everyone to ignore it, and then it catches nothing when it finally matters.
//
// Deleting the debt first is not an option either: 221 of those are `no-explicit-any`, and typing
// this codebase properly is its own project.
//
// So the gate is not "zero problems", it is "no MORE problems than last time". Existing debt is
// grandfathered; new debt fails the build. The number only ever goes down, and every time it does,
// `--update` writes the lower number back so it can never drift up again silently.
//
// Deliberately counts warnings as well as errors. A warning nobody is required to fix is just an
// error with better manners, and `no-img-element` warnings are the ones that cost real bandwidth on
// the Android shell.

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';

const BUDGET_FILE = new URL('../.lintbudget.json', import.meta.url);
const update = process.argv.includes('--update');

const run = promisify(execFile);

/** ESLint exits 1 when it finds errors, which is not a failure of the run. Only a crash is. */
async function lint() {
  try {
    const { stdout } = await run('npx', ['eslint', '.', '-f', 'json'], {
      shell: process.platform === 'win32',
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    if (err.stdout) return err.stdout;
    throw err;
  }
}

const results = JSON.parse(await lint());
const messages = results.flatMap(r => (r.messages || []).map(m => ({ ...m, filePath: r.filePath })));

const errors = messages.filter(m => m.severity === 2).length;
const warnings = messages.filter(m => m.severity === 1).length;
const total = messages.length;

if (update) {
  writeFileSync(BUDGET_FILE, `${JSON.stringify({ errors, warnings, total }, null, 2)}\n`);
  console.log(`lint-budget: baseline written — ${errors} errors, ${warnings} warnings (${total} total)`);
  process.exit(0);
}

let budget;
try {
  budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
} catch {
  console.error('lint-budget: no .lintbudget.json — run `npm run lint:budget -- --update` once to set it.');
  process.exit(1);
}

const delta = total - budget.total;

if (delta > 0) {
  // Name what grew. A bare "you added 3 problems" sends someone diffing the whole change set.
  const byRule = new Map();
  for (const m of messages) byRule.set(m.ruleId || '(parse)', (byRule.get(m.ruleId || '(parse)') || 0) + 1);
  const worst = [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  console.error(`lint-budget: FAIL — ${total} problems, budget is ${budget.total} (+${delta})`);
  console.error(`             errors ${errors} (was ${budget.errors}), warnings ${warnings} (was ${budget.warnings})`);
  console.error('\nMost common rules right now:');
  for (const [rule, n] of worst) console.error(`  ${String(n).padStart(4)}  ${rule}`);
  console.error('\nFix the new problems, or if the increase is deliberate and justified:');
  console.error('  npm run lint:budget -- --update');
  process.exit(1);
}

if (delta < 0) {
  console.log(`lint-budget: PASS — ${total} problems, ${-delta} under budget of ${budget.total}. Nice.`);
  console.log('             Lock it in:  npm run lint:budget -- --update');
} else {
  console.log(`lint-budget: PASS — ${total} problems, exactly at budget.`);
}
process.exit(0);
