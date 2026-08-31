import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LATEST, updateAvailable, installedCode, dismissKey } from '@/lib/appRelease';

/**
 * This drives a prompt that asks a person to re-download an APK and walk past Android's "this file
 * can harm your device" warning. So the property that matters is not "it offers updates" but "it
 * never offers one that isn't real": a banner that cries wolf teaches people to tap through a
 * security warning on reflex, which is worse than the stale build it was trying to fix.
 */

describe('LATEST agrees with the build it describes', () => {
  const gradle = readFileSync(join(process.cwd(), 'android', 'app', 'build.gradle'), 'utf8');

  /* The whole reason the version is declared in appRelease.ts rather than parsed from gradle: a
     release is one fact, and these assertions are what stop the halves drifting. A build bumped
     without its notes now fails here instead of shipping a prompt that lies about what is in it. */
  test('versionCode matches android/app/build.gradle', () => {
    const code = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
    expect(code).toBeGreaterThan(0);
    expect(LATEST.versionCode).toBe(code);
  });

  test('versionName matches android/app/build.gradle', () => {
    const name = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
    expect(name).toBeTruthy();
    expect(LATEST.versionName).toBe(name);
  });

  test('a release says what changed, in words a person would use', () => {
    expect(LATEST.notes.length).toBeGreaterThan(0);
    for (const n of LATEST.notes) {
      expect(n.trim()).not.toBe('');
      // Notes are read by someone deciding whether to spend data on this, not by a reviewer.
      expect(n).not.toMatch(/\b(refactor|commit|merge|PR|hotfix|bump)\b/i);
    }
  });
});

describe('updateAvailable', () => {
  const latest = { versionCode: 4, versionName: '1.3', notes: ['x'] };

  test('offers an update only when the phone is genuinely behind', () => {
    expect(updateAvailable(3, latest)).toBe(true);
    expect(updateAvailable(1, latest)).toBe(true);
  });

  test('says nothing when up to date', () => {
    expect(updateAvailable(4, latest)).toBe(false);
  });

  /* A tester running a build newer than what is published must not be told to downgrade — the
     APK on the download page would refuse to install over it anyway, so the prompt would be an
     instruction that cannot be followed. */
  test('never offers a downgrade to someone ahead of the release', () => {
    expect(updateAvailable(5, latest)).toBe(false);
    expect(updateAvailable(99, latest)).toBe(false);
  });

  /* Every unreadable input fails to SILENT, not to a banner. Capacitor answers `build` as a
     string, and a plugin that changes shape, a web browser with no plugin at all, or a corrupt
     value must not produce a permanent nag on a security-adjacent prompt. */
  test('anything unreadable stays quiet rather than crying wolf', () => {
    for (const junk of [undefined, null, '', 'abc', NaN, Infinity, -Infinity, 0, -3, {}, []]) {
      expect(updateAvailable(junk as unknown, latest)).toBe(false);
    }
  });

  test('a numeric string is a version, because that is what the plugin sends', () => {
    expect(updateAvailable('3', latest)).toBe(true);
    expect(updateAvailable('4', latest)).toBe(false);
  });

  test('defaults to the real LATEST when none is passed', () => {
    expect(updateAvailable(LATEST.versionCode)).toBe(false);
    expect(updateAvailable(LATEST.versionCode - 1)).toBe(true);
  });
});

describe('installedCode', () => {
  test('reads the build Capacitor reports, however it is typed', () => {
    expect(installedCode({ build: '4' })).toBe(4);
    expect(installedCode({ build: 4 })).toBe(4);
  });

  test('answers null rather than guessing', () => {
    for (const junk of [undefined, null, {}, { build: '' }, { build: 'x' }, { build: 0 }, { build: -1 }]) {
      expect(installedCode(junk as { build?: unknown })).toBeNull();
    }
  });
});

describe('dismissKey', () => {
  /* Scoped to the version dismissed, so "not now" silences THIS release and the next one still
     gets to ask. A single global flag would mean one dismissal turns the feature off forever. */
  test('a dismissal is remembered per version, not globally', () => {
    expect(dismissKey(4)).not.toBe(dismissKey(5));
    expect(dismissKey(4)).toContain('4');
  });
});
