/**
 * Phone cameras produce 3-8MB files and Vercel rejects a request body over ~4.5MB, so a photo
 * taken in the app would fail to upload untouched. Downscaling here also means a note full of
 * receipts costs kilobytes of S3 rather than megabytes.
 *
 * imageOrientation honours the EXIF rotation phones write rather than baking in a sideways
 * photo, which is what you get from a naive canvas redraw.
 *
 * Browser-only — it needs canvas, so call it from a client component before uploading.
 */
const MAX_EDGE = 1920;

export async function shrinkImage(file: File): Promise<File> {
  // GIFs would lose their animation, and non-images are left entirely alone
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1_500_000) { bmp.close(); return file; }   // already small
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;   // re-encoding made it worse — keep the original
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;   // unsupported codec or no canvas — let the server's size guard decide
  }
}
