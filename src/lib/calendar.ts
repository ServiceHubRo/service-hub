/**
 * "Adaugă în calendar" (T28a): a confirmed booking as a calendar event — an .ics file on the web
 * (Apple Calendar, Outlook, Google on Android all open it) and Google Calendar's own link inside
 * the phone app, where a downloaded file has nowhere to go. A booking's date and slot are local
 * time in Europe/Bucharest (ARCHITECTURE §1); the event is written in UTC, so every calendar shows
 * it at the right hour wherever the phone is.
 */

export interface CalendarEvent {
  /** Stable id (the booking's), so adding it twice updates the same event. */
  uid: string;
  title: string;
  /** `YYYY-MM-DD` and `HH:MM`, Europe/Bucharest. */
  date: string;
  slot: string;
  minutes: number;
  location: string;
  description: string;
}

const BUCHAREST = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Bucharest',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The wall-clock time in Bucharest of an instant, as minutes since the epoch (for the offset). */
function bucharestWall(ms: number): number {
  const p = Object.fromEntries(BUCHAREST.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
}

/** The instant a Bucharest date and time stands for (summer and winter time alike). */
export function bucharestToUtc(date: string, slot: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = slot.slice(0, 5).split(':').map(Number);
  const wall = Date.UTC(y!, m! - 1, d!, h!, mi!);
  let guess = wall - 3 * 3_600_000;
  for (let i = 0; i < 2; i++) guess += wall - bucharestWall(guess);
  return new Date(guess);
}

/** `20261014T070000Z` */
function stamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Text in an .ics line: backslash, semicolon, comma and line breaks escaped. */
function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 octets are folded, as the format asks. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 75;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function icsFile(e: CalendarEvent, now: Date = new Date()): string {
  const start = bucharestToUtc(e.date, e.slot);
  const end = new Date(start.getTime() + Math.max(e.minutes, 15) * 60_000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Service-Hub//RO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}@service-hub.ro`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${icsText(e.title)}`,
    `LOCATION:${icsText(e.location)}`,
    `DESCRIPTION:${icsText(e.description)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(e.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(fold)
    .join('\r\n');
}

/** Google Calendar's "add event" page, filled in. */
export function googleCalendarUrl(e: CalendarEvent): string {
  const start = bucharestToUtc(e.date, e.slot);
  const end = new Date(start.getTime() + Math.max(e.minutes, 15) * 60_000);
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${stamp(start)}/${stamp(end)}`,
    location: e.location,
    details: e.description,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
