import { CalendarPlus, Navigation } from 'lucide-react';
import { buttonClass } from './buttonClass';
import { useI18n } from '../i18n/context';
import { googleCalendarUrl, icsFile, type CalendarEvent } from '../lib/calendar';
import { directionsUrl, type MapPlace } from '../lib/maps';
import { IS_NATIVE } from '../lib/native';

/**
 * "Adaugă în calendar" and "Indicații" for a confirmed booking (T28a). On the web the calendar
 * button saves an .ics file; inside the phone app, where a file has nowhere to go, it opens
 * Google Calendar's page with the event filled in.
 */
export function CalendarLinks({ event, place }: { event: CalendarEvent; place: MapPlace }) {
  const { t } = useI18n();

  function download() {
    const url = URL.createObjectURL(new Blob([icsFile(event)], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `service-hub-${event.date}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <>
      {IS_NATIVE ? (
        <a className={buttonClass('secondary')} href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
          <CalendarPlus size={16} aria-hidden="true" />
          {t('calendar.add')}
        </a>
      ) : (
        <button type="button" className={buttonClass('secondary')} onClick={download}>
          <CalendarPlus size={16} aria-hidden="true" />
          {t('calendar.add')}
        </button>
      )}
      <a className={buttonClass('secondary')} href={directionsUrl(place)} target="_blank" rel="noopener noreferrer">
        <Navigation size={16} aria-hidden="true" />
        {t('shop.directions')}
      </a>
    </>
  );
}
