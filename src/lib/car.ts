/** Car details typed by a client (garage form and booking step 4). Same limits as the database. */
export const CAR_YEAR_MIN = 1900;

/** Next year's models are on sale already. */
export function carYearMax(now: Date = new Date()): number {
  return now.getFullYear() + 1;
}

/** An empty year is fine (it is optional); otherwise 4 digits between 1900 and next year. */
export function isValidCarYear(value: string, now: Date = new Date()): boolean {
  const v = value.trim();
  if (v === '') return true;
  if (!/^\d{4}$/.test(v)) return false;
  const year = Number(v);
  return year >= CAR_YEAR_MIN && year <= carYearMax(now);
}
