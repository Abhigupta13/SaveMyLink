#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = process.cwd();
const nextDir = path.join(projectRoot, '.next');
const MAX_RETRIES = 8;
const RETRY_DELAY_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeNextDirWithRetry() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      fs.rmSync(nextDir, { recursive: true, force: true });
      return true;
    } catch (error) {
      const code = error && error.code;
      if ((code === 'EPERM' || code === 'EBUSY') && attempt < MAX_RETRIES) {
        console.warn(
          `[dev-safe] .next cleanup attempt ${attempt}/${MAX_RETRIES} failed with ${code}. Retrying...`
        );
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      console.warn(`[dev-safe] Could not fully clean .next (${code || 'unknown error'}). Continuing...`);
      return false;
    }
  }
  return false;
}

async function run() {
  const showHelp = process.argv.includes('--help') || process.argv.includes('-h');
  if (showHelp) {
    console.log('Usage: npm run dev');
    console.log('Cleans .next with retries, then runs: next dev --webpack -H 0.0.0.0');
    process.exit(0);
  }

  await removeNextDirWithRetry();

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(npxCmd, ['next', 'dev', '--webpack', '-H', '0.0.0.0'], {
    stdio: 'inherit',
    cwd: projectRoot,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

run().catch((error) => {
  console.error('[dev-safe] Failed to start dev server:', error);
  process.exit(1);
});

