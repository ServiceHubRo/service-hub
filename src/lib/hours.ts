/** One weekday of a shop's week, as get_shop_page returns it (0 = Sunday). */
export interface DayHours {
  weekday: number;
  is_closed: boolean;
  open_time: string | null; // HH:MM
  close_time: string | null; // HH:MM
}

/** Consecutive days (Monday first) with the same hours, e.g. Mon–Fri 08:00–18:00. */
export interface HoursRow {
  /** Weekdays in the group, in Monday-first order. */
  days: number[];
  closed: boolean;
  open: string | null;
  close: string | null;
}

/** Monday → Sunday, the order people read a week in Romania. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * Groups the week for the shop page: consecutive days with identical hours share one row
 * ("Luni – Vineri 08:00 – 18:00", "Sâmbătă 09:00 – 14:00", "Duminică Închis").
 */
export function groupHours(hours: DayHours[]): HoursRow[] {
  const byDay = new Map(hours.map((h) => [h.weekday, h]));
  const rows: HoursRow[] = [];
  let previousIndex = -2;
  WEEK_ORDER.forEach((weekday, index) => {
    const h = byDay.get(weekday);
    if (!h) return;
    const closed = h.is_closed || !h.open_time || !h.close_time;
    const open = closed ? null : h.open_time;
    const close = closed ? null : h.close_time;
    const last = rows.at(-1);
    if (last && previousIndex === index - 1 && last.closed === closed && last.open === open && last.close === close) {
      last.days.push(weekday);
    } else {
      rows.push({ days: [weekday], closed, open, close });
    }
    previousIndex = index;
  });
  return rows;
}
