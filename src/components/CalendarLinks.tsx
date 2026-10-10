import { CalendarPlus } from 'lucide-react';
import { buttonClass } from './buttonClass';
import { useI18n } from '../i18n/context';
import { googleCalendarUrl, type CalendarEvent } from '../lib/calendar';
import { saveIcs } from './calendarMenu';
import { IS_NATIVE } from '../lib/native';

/** Only "Adaugă în calendar", full width (the screen after a confirmed booking). */
export function AddToCalendar({ event }: { event: CalendarEvent }) {
  const { t } = useI18n();
  return IS_NATIVE ? (
    <a className={buttonClass('secondary', true)} href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
      <CalendarPlus size={16} aria-hidden="true" />
      {t('calendar.add')}
    </a>
  ) : (
    <button type="button" className={buttonClass('secondary', true)} onClick={() => saveIcs(event)}>
      <CalendarPlus size={16} aria-hidden="true" />
      {t('calendar.add')}
    </button>
  );
}
