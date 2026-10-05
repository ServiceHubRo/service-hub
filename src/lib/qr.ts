import qrcode from 'qrcode-generator';

/**
 * A QR code as one SVG path (T31b): `size` modules a side, a 4-module quiet zone included, so it
 * scales to any size and prints sharp. Error correction "M" (about 15 % may be damaged or dirty).
 */
export function qrPath(text: string): { size: number; path: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  let path = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  return { size: n + quiet * 2, path };
}

/** The same as a standalone .svg file (black on white), to download and print elsewhere. */
export function qrSvgFile(text: string): Blob {
  const { size, path } = qrPath(text);
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 10}" height="${size * 10}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>\n`;
  return new Blob([svg], { type: 'image/svg+xml' });
}
