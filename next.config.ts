import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * What the APK is called when it lands on someone's device.
 *
 * The `download` attribute on the link only renames it for a BROWSER. An Android WebView hands
 * downloads to its DownloadListener, which never sees the attribute and falls back to the last
 * segment of the URL — so anyone downloading from inside the app got "app-debug.apk" regardless.
 * Saying it in the response header instead means every client agrees: Chrome, the WebView's
 * DownloadManager, and curl.
 *
 * `attachment` rather than `inline` for the same reason: it is a file to keep, not to render.
 */
function apkFileName(): string {
  try {
    const gradle = readFileSync(join(process.cwd(), "android", "app", "build.gradle"), "utf8");
    const version = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
    return version ? `ALLyouneed-${version}.apk` : "ALLyouneed.apk";
  } catch {
    return "ALLyouneed.apk";
  }
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/app-debug.apk",
        headers: [
          { key: "Content-Disposition", value: `attachment; filename="${apkFileName()}"` },
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
        ],
      },
    ];
  },
  // `next build` and `next dev` share .next, so building while the dev server is running
  // corrupts it — pages come back unstyled and never hydrate, which looks exactly like the
  // app being broken. Set NEXT_DIST_DIR to build somewhere else instead of stopping dev.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  devIndicators: false, // dev badge overlapped the rail's profile avatar
  // Allow connections from Docker, WSL, or local network IPs
  allowedDevOrigins: ['euvya-2409-40f2-4f-cf41-57c1-4c18-7f54-183d.free.pinggy.net', 'ytbgb-2405-201-d044-7016-187d-d66-aabf-54cb.run.pinggy-free.link', '172.19.128.1', '192.168.137.1', '192.168.145.1', '10.65.163.48', 'fcero-157-50-184-107.run.pinggy-free.link'],
  experimental: {
    // MOM audio uploads (~14MB/hr opus) + d-locker files; default is 1MB
    serverActions: { bodySizeLimit: '30mb' },
  },
} as any;

export default nextConfig;
