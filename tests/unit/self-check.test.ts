import { test, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The legacy suite, kept alive under the new runner.
 *
 * `scripts/self-check.mjs` holds ~611 assertions built up over the life of the project. They are
 * worth keeping and not worth re-typing, so this runs the whole script as one case rather than
 * porting it. The file is FROZEN — fixes to existing assertions only, new coverage goes in a real
 * test file beside this one.
 *
 * A CHILD PROCESS, not an import, for two concrete reasons:
 *
 *  1. The script mutates shared process state. It writes and deletes `process.env.ADMIN_EMAILS` and
 *     `process.env.SARVAM_ENABLED_EMAILS` in place to exercise fail-closed paths. Imported into a
 *     Vitest worker, those leak into every other test sharing that worker.
 *  2. It asserts at the top level, so the first failure throws during module evaluation. That would
 *     take down the whole file rather than failing one case.
 *
 * `--experimental-strip-types` is mandatory: the script imports .ts sources directly under bare
 * Node. Without it you get ERR_UNKNOWN_FILE_EXTENSION before a single assertion runs. Baking the
 * flag in here is the point — nobody has to remember it any more.
 *
 * Fail-fast is inherited: the script stops at its first bad assertion, so a red run names one
 * problem, not all of them. That is a reason to write NEW checks in Vitest, not a reason to
 * distrust this one.
 */
test('scripts/self-check.mjs: all assertions pass', async () => {
  const { stdout } = await run(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', 'scripts/self-check.mjs'],
    { cwd: process.cwd(), timeout: 110_000 },
  );

  // The script's own success line. Asserting on it rather than just on exit code 0 means a future
  // edit that returns early — or swallows the run — cannot pass silently.
  expect(stdout).toContain('self-check: all assertions passed');
});
