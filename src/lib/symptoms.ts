/**
 * Constatare tehnică (Eduard, 8 Oct): the catalog service `constatare` for a client who cannot tell
 * what is wrong — the shop inspects the car and sends the quote, as for any booking. On step 1 the client may tick what they notice
 * (`?simptome=noise,warning_light`); on step 4 they describe it. The ticks go into the booking's
 * note as one line in the client's words, so the shop reads them on the request like any note.
 */
export const UNSURE_SERVICE_ID = 'constatare';

export const SYMPTOMS = ['noise', 'warning_light', 'start', 'vibration', 'brakes', 'power', 'smoke', 'leak', 'ac'] as const;
export type Symptom = (typeof SYMPTOMS)[number];

const isSymptom = (v: string): v is Symptom => (SYMPTOMS as readonly string[]).includes(v);

/** `?simptome=noise,leak` → the known ones, once each, in the list's order. */
export function parseSymptoms(value: string | null | undefined): Symptom[] {
  const picked = new Set((value ?? '').split(',').map((s) => s.trim()).filter(isSymptom));
  return SYMPTOMS.filter((s) => picked.has(s));
}

export function toggleSymptom(list: readonly Symptom[], s: Symptom): Symptom[] {
  return list.includes(s) ? list.filter((x) => x !== s) : SYMPTOMS.filter((x) => x === s || list.includes(x));
}

/** Enough said for the shop to know what to look at: a tick, or a few words. */
export function unsureDescribed(symptoms: readonly Symptom[], note: string): boolean {
  return symptoms.length > 0 || note.trim().length >= 3;
}

/** The note sent: the ticked line ("Simptome semnalate: …"), then what was typed; never longer than `max`. */
export function composeUnsureNote(line: string | null, note: string, max: number): string {
  return [line, note.trim()].filter(Boolean).join('\n').slice(0, max);
}
