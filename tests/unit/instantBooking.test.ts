import { describe, expect, it } from 'vitest';
import { bucharestToUtc, googleCalendarUrl, icsFile, type CalendarEvent } from '../../src/lib/calendar';
import { relativeDay, resolveDay } from '../../src/lib/freePlace';
import { directionsUrl } from '../../src/lib/maps';

// 2026-10-13 09:00 in Bucharest (summer time, UTC+3).
const NOW = new Date('2026-10-13T06:00:00Z');

const event: CalendarEvent = {
  uid: 'b-1',
  title: 'Schimb ulei · Atelier Unu',
  date: '2026-10-14',
  slot: '10:00',
  minutes: 60,
  location: 'Atelier Unu, Str. Lungă 1, Brașov',
  description: 'Programarea P-000123 pe Service-Hub.',
};

describe('free places (T28a)', () => {
  it('reads the day filter in Bucharest', () => {
    expect(resolveDay('azi', NOW)).toBe('2026-10-13');
    expect(resolveDay('maine', NOW)).toBe('2026-10-14');
    expect(resolveDay('2026-10-20', NOW)).toBe('2026-10-20');
    expect(resolveDay('2026-10-12', NOW)).toBeNull();
    expect(resolveDay('2026-13-45', NOW)).toBeNull();
    expect(resolveDay('oricand', NOW)).toBeNull();
    expect(resolveDay(null, NOW)).toBeNull();
    // 23:30 on the 13th in Bucharest is already the 13th's evening, not the 14th in UTC terms.
    expect(resolveDay('azi', new Date('2026-10-13T20:30:00Z'))).toBe('2026-10-13');
    expect(resolveDay('azi', new Date('2026-10-13T21:30:00Z'))).toBe('2026-10-14');
  });

  it('says today, tomorrow or the date', () => {
    expect(relativeDay('2026-10-13', NOW)).toBe('today');
    expect(relativeDay('2026-10-14', NOW)).toBe('tomorrow');
    expect(relativeDay('2026-10-16', NOW)).toBe('date');
  });
});

describe('add to calendar (T28a)', () => {
  it('turns a Bucharest time into the right instant, summer and winter', () => {
    expect(bucharestToUtc('2026-10-14', '10:00').toISOString()).toBe('2026-10-14T07:00:00.000Z');
    expect(bucharestToUtc('2026-12-01', '10:00').toISOString()).toBe('2026-12-01T08:00:00.000Z');
    // The day the clocks go back (25 Oct 2026): 10:00 is already winter time.
    expect(bucharestToUtc('2026-10-25', '10:00').toISOString()).toBe('2026-10-25T08:00:00.000Z');
    expect(bucharestToUtc('2027-03-28', '10:00').toISOString()).toBe('2027-03-28T07:00:00.000Z');
  });

  it('writes an .ics event in UTC, with a reminder and escaped text', () => {
    const ics = icsFile(event, NOW);
    expect(ics).toContain('DTSTART:20261014T070000Z');
    expect(ics).toContain('DTEND:20261014T080000Z');
    expect(ics).toContain('UID:b-1@service-hub.ro');
    expect(ics).toContain('LOCATION:Atelier Unu\\, Str. Lungă 1\\, Brașov');
    expect(ics).toContain('TRIGGER:-PT2H');
    expect(ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });

  it('fills in Google Calendar for the phone app', () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.hostname).toBe('calendar.google.com');
    expect(url.searchParams.get('dates')).toBe('20261014T070000Z/20261014T080000Z');
    expect(url.searchParams.get('text')).toBe('Schimb ulei · Atelier Unu');
  });
});

describe('directions (T28a)', () => {
  it('uses the coordinates when known, else the address', () => {
    expect(directionsUrl({ street: 'Str. Lungă 1', city: 'Brașov', latitude: 45.65, longitude: 25.6 })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=45.65%2C25.6',
    );
    expect(directionsUrl({ street: 'Str. Lungă 1', city: 'Brașov', latitude: null, longitude: null })).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('Str. Lungă 1, Brașov')}`,
    );
  });
});
