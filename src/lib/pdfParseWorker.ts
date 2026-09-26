import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let environmentReady: Promise<void> | null = null;

/**
 * pdf.js on Node uses a fake worker. Next/webpack requires ESM `import()` for pdfjs-dist —
 * not `require.resolve('pdfjs-dist/...')`. Preload WorkerMessageHandler on globalThis and set a
 * file:// worker URL for pdf-parse (Windows-safe).
 */
export function ensurePdfParseEnvironment(): Promise<void> {
  if (!environmentReady) {
    environmentReady = (async () => {
      const g = globalThis as typeof globalThis & {
        pdfjsWorker?: { WorkerMessageHandler?: unknown };
      };

      if (!g.pdfjsWorker?.WorkerMessageHandler) {
        g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      }

      const { PDFParse } = await import('pdf-parse');

      const workerPath = path.join(
        process.cwd(),
        'node_modules',
        'pdfjs-dist',
        'legacy',
        'build',
        'pdf.worker.mjs',
      );
      if (fs.existsSync(workerPath)) {
        PDFParse.setWorker(pathToFileURL(workerPath).href);
      }
    })().catch((err) => {
      environmentReady = null;
      console.error('PDF parse environment setup failed:', err);
      throw err;
    });
  }
  return environmentReady;
}
