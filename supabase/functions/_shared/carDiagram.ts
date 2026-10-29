// The car seen from above, on which the intake sheet marks damage (T50). The app draws it as SVG
// and the PDF with the same paths, so a mark sits on the same spot in both. Marks are stored as
// x, y from 0 to 1 of this box (vehicle_intakes.damages).

/** The drawing's box: front at the top, rear at the bottom. */
export const CAR_VIEW = { width: 220, height: 440 } as const;

/** Body, glass and details as SVG paths on CAR_VIEW (stroked, not filled). */
export const CAR_PATHS = {
  wheels: [
    'M14 84h16v56h-16z',
    'M190 84h16v56h-16z',
    'M14 302h16v56h-16z',
    'M190 302h16v56h-16z',
  ],
  body: 'M62 18Q110 6 158 18Q186 28 188 72L190 372Q188 412 158 420Q110 432 62 420Q32 412 30 372L32 72Q34 28 62 18Z',
  details: [
    // Windshield
    'M48 124Q110 104 172 124L162 172Q110 160 58 172Z',
    // Roof
    'M60 184Q110 176 160 184L160 290Q110 298 60 290Z',
    // Rear window
    'M58 302Q110 314 162 302L170 344Q110 360 50 344Z',
    // Hood and trunk lines
    'M52 40Q110 30 168 40',
    'M54 400Q110 410 166 400',
    // Doors
    'M32 236L58 236',
    'M162 236L188 236',
    // Mirrors
    'M33 152L17 145L17 163L33 166',
    'M187 152L203 145L203 163L187 166',
  ],
} as const;

export const DAMAGE_KINDS = ['scratch', 'dent', 'crack', 'broken', 'missing', 'other'] as const;
export type DamageKind = (typeof DAMAGE_KINDS)[number];

export interface DamageMark {
  /** 0–1 across the drawing, from the left. */
  x: number;
  /** 0–1 down the drawing, from the front. */
  y: number;
  kind: DamageKind;
  note?: string | null;
}

/** Quarters of the tank as the sheet stores them (0 = reserve, 4 = full). */
export const FUEL_LEVELS = [0, 1, 2, 3, 4] as const;
