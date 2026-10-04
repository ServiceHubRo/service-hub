/**
 * A photo from the phone, made light before it leaves (T28b): at most `maxSide` pixels on its
 * longest side, as JPEG. A 12-megapixel picture of the workshop becomes a few hundred kilobytes, so
 * it uploads quickly on mobile data and the shop page stays fast. Orientation from the camera is
 * applied by the browser when it decodes the image.
 */
export async function shrinkImage(file: Blob, maxSide = 1600, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('encode');
  return blob;
}
