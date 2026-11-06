import { describe, expect, it } from 'vitest';
import { renderNotification, type NotificationEvent } from '../../supabase/functions/_shared/templates';

// M6: the fleet members' notifications. The database puts amounts only in the parameters of members
// with costs.view; the texts follow the parameters, so a driver's text never names an amount.
const CO = '11111111-1111-4111-8111-111111111111';
const ev = (event: string, params: Record<string, unknown>, lang = 'ro'): NotificationEvent => ({
  event,
  role: 'client',
  lang,
  params: { company_id: CO, company_name: 'Flota SRL', plate: 'B 401 FLT', ref: 'P-000123', shop_name: 'Atelier Unu', ...params },
  booking_id: 'b1',
});

describe('fleet notifications (M6)', () => {
  it('a quote waiting: the amount only when the parameters carry it', () => {
    const withMoney = renderNotification(ev('fleet_quote_waiting', { total: 680 }))!;
    const without = renderNotification(ev('fleet_quote_waiting', {}))!;
    expect(withMoney.body).toContain('680');
    expect(without.body).not.toMatch(/\d+\s?lei|RON/);
    expect(without.title).toBe('Flota SRL');
    expect(without.url).toBe(`/c/firme/${CO}?sectiune=programari`);
  });

  it('a decision: approved, partly approved, declined (never an amount when declined)', () => {
    expect(renderNotification(ev('fleet_quote_decided', { decision: 'accepted', total: 400 }))!.body).toContain('aprobat: 400');
    expect(renderNotification(ev('fleet_quote_decided', { decision: 'partially_accepted' }))!.body).toContain('aprobat parțial.');
    expect(renderNotification(ev('fleet_quote_decided', { decision: 'refused', total: 0 }, 'en'))!.body).toBe('The quote for B 401 FLT (P-000123) was declined.');
  });

  it('a booking changed: the status says what happened; a date change says moved', () => {
    expect(renderNotification(ev('fleet_booking_changed', { status: 'done', from_status: 'in_progress' }))!.body).toBe('B 401 FLT este gata de ridicare de la Atelier Unu.');
    expect(renderNotification(ev('fleet_booking_changed', { status: 'confirmed', from_status: 'confirmed', date: '2026-11-20', slot: '10:00' }, 'en'))!.body).toMatch(
      /^Booking P-000123 for B 401 FLT was moved: /,
    );
  });

  it('cancel with the reason; documents and maintenance open the vehicle', () => {
    expect(renderNotification(ev('fleet_booking_cancelled', { reason: 'Vehicul indisponibil' }))!.body).toContain('Motiv: Vehicul indisponibil');
    const doc = renderNotification(ev('fleet_doc_expiring', { doc: 'itp', expiry: '2026-11-13', days: 7, vehicle_id: 'v1' }))!;
    expect(doc.body).toMatch(/^ITP-ul pentru B 401 FLT expiră pe /);
    expect(doc.url).toBe(`/c/firme/${CO}?sectiune=vehicul&vehicul=v1`);
    expect(renderNotification(ev('fleet_maintenance_due', { kind: 'oil', status: 'overdue', vehicle_id: 'v1' }, 'en'))!.body).toBe('Oil change for B 401 FLT: overdue.');
    expect(renderNotification(ev('fleet_maintenance_due', { kind: 'custom', label: 'Curea distribuție', status: 'soon' }))!.body).toBe(
      'Curea distribuție pentru B 401 FLT: termen apropiat.',
    );
  });

  it('every fleet event has a Romanian and an English text', () => {
    for (const event of ['fleet_quote_changes', 'fleet_issue_reported', 'fleet_expense_to_check']) {
      for (const lang of ['ro', 'en']) expect(renderNotification(ev(event, { title: 'Bec ars', reason: 'x' }, lang)), `${event} ${lang}`).not.toBeNull();
    }
  });
});
