import { CalendarPlus, Navigation } from 'lucide-react';
import type { MessageKey } from '../i18n/ro';
import { googleCalendarUrl, icsFile, type CalendarEvent } from '../lib/calendar';
import { directionsUrl, type MapPlace } from '../lib/maps';
import { IS_NATIVE } from '../lib/native';
import type { MenuItem } from './MenuButton';

/** Saves the booking as an .ics file (the web; the phone app opens Google Calendar instead). */
export function saveIcs(event: CalendarEvent) {
  const url = URL.createObjectURL(new Blob([icsFile(event)], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `service-hub-${event.date}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The same two actions as entries of a "Mai multe" menu (a booking card). */
export function calendarMenuItems(event: CalendarEvent, place: MapPlace, t: (key: MessageKey) => string): MenuItem[] {
  const icon = <CalendarPlus size={18} aria-hidden="true" />;
  return [
    IS_NATIVE
      ? { key: 'calendar', label: t('calendar.add'), icon, href: googleCalendarUrl(event), external: true }
      : { key: 'calendar', label: t('calendar.add'), icon, onSelect: () => saveIcs(event) },
    { key: 'directions', label: t('shop.directions'), icon: <Navigation size={18} aria-hidden="true" />, href: directionsUrl(place), external: true },
  ];
}

