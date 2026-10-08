import { describe, expect, it } from 'vitest';
import { qrPath, qrSvgFile } from '../../src/lib/qr';

// T31b: the shop's QR code.
describe('the QR code of the shop link', () => {
  it('is a square path with a quiet zone, the same every time', () => {
    const a = qrPath('https://service-hub.ro/atelier/6819cffc-f803-4634-b3cd-fd51f579b342');
    const b = qrPath('https://service-hub.ro/atelier/6819cffc-f803-4634-b3cd-fd51f579b342');
    expect(a).toEqual(b);
    // A version-5 code (37 modules) holds this address at level M, plus 4 modules each side.
    expect(a.size).toBe(45);
    expect(a.path.startsWith('M4 4h1v1h-1z')).toBe(true); // the top-left finder starts at the quiet zone
    expect(qrPath('https://service-hub.ro/atelier/x').path).not.toBe(a.path);
  });

  it('downloads as a black-on-white SVG file', async () => {
    const svg = await qrSvgFile('https://service-hub.ro/atelier/x').text();
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
  });
});
