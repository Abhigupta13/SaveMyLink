import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * goConnectDrive is three branches now, and the two new ones only ever run on a phone.
 *
 * It used to be one line — assign a URL. Since Google refuses OAuth in an embedded WebView it also
 * has to open a Chrome Custom Tab when it is running inside the app, and fall back to the old
 * behaviour when that fails. Drive is the only file storage in this app, so if this function picks
 * the wrong branch every upload in the product stops working, and it stops working only on Android
 * where nobody is watching a console.
 */

const assign = vi.fn();
const startNativeDriveConnect = vi.fn();

vi.mock('@/lib/nativeBridge', () => ({
  startNativeDriveConnect: (...args: unknown[]) => startNativeDriveConnect(...args),
}));

// A minimal window. driveConnect reads location.pathname/search for the default return path and
// calls location.assign; nothing else about the DOM matters here.
function stubWindow(pathname = '/d-locker', search = '') {
  vi.stubGlobal('window', { location: { pathname, search, assign } });
}

/** The module reads `window` at call time, so a fresh import per test is not required — but the
 *  mocks are call-counted, so they are. */
async function load() {
  vi.resetModules();
  return (await import('@/lib/driveConnect')).goConnectDrive;
}

beforeEach(() => {
  assign.mockReset();
  startNativeDriveConnect.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('goConnectDrive', () => {
  test('on the web, redirects to the consent route with the current path to return to', async () => {
    stubWindow('/d-locker', '?tab=docs');
    startNativeDriveConnect.mockResolvedValue(false);   // not the app

    const goConnectDrive = await load();
    goConnectDrive();
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());

    expect(assign).toHaveBeenCalledWith('/api/drive/connect?to=%2Fd-locker%3Ftab%3Ddocs');
  });

  test('an explicit returnTo wins over the current location', async () => {
    stubWindow('/d-locker');
    startNativeDriveConnect.mockResolvedValue(false);

    const goConnectDrive = await load();
    goConnectDrive('/notes');
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());

    expect(assign).toHaveBeenCalledWith('/api/drive/connect?to=%2Fnotes');
  });

  /**
   * The whole point of the native branch. Navigating the WebView to accounts.google.com gets
   * `disallowed_useragent` and takes every upload down with it.
   */
  test('inside the app, opens a Custom Tab and does NOT navigate the webview', async () => {
    stubWindow('/notes');
    startNativeDriveConnect.mockResolvedValue(true);

    const goConnectDrive = await load();
    goConnectDrive();
    await vi.waitFor(() => expect(startNativeDriveConnect).toHaveBeenCalled());

    expect(startNativeDriveConnect).toHaveBeenCalledWith('/notes');
    expect(assign).not.toHaveBeenCalled();
  });

  /**
   * If the tab cannot be opened, falling through shows Google's own refusal. That is a visible
   * failure, which beats a button that silently does nothing — the failure mode this whole round
   * of work exists to remove.
   */
  test('falls back to the redirect when the Custom Tab cannot be opened', async () => {
    stubWindow('/notes');
    startNativeDriveConnect.mockResolvedValue(false);

    const goConnectDrive = await load();
    goConnectDrive();
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());

    expect(assign).toHaveBeenCalledWith('/api/drive/connect?to=%2Fnotes');
  });

  test('does nothing at all on the server, where there is no window', async () => {
    vi.stubGlobal('window', undefined);
    const goConnectDrive = await load();
    expect(() => goConnectDrive()).not.toThrow();
    expect(assign).not.toHaveBeenCalled();
    expect(startNativeDriveConnect).not.toHaveBeenCalled();
  });
});
