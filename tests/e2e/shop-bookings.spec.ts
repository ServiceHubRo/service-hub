import { expect, test, type Page } from '@playwright/test';
import { formatDate } from '../../src/i18n/format';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  rpcAs,
  scrollTopOf,
  serviceRest,
  shot,
  signIn,
} from './support';

// T08 — the shop's Panou and Programări: counters that open filtered lists, today's schedule and
// its print view, every card state, and the actions from a new request to a sent quote, live.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const name = () => test.info().project.name;
const navLink = (page: Page, label: string | RegExp) =>
  page.getByRole('link', { name: label, exact: typeof label === 'string' }).filter({ visible: true }).first();
/** The booking cards on screen (not the quote lines inside them). */
const cards = (page: Page) => page.locator('main ul[aria-label] > li');
const card = (page: Page, text: string) => cards(page).filter({ hasText: text });

interface Day {
  date: string;
  bookable: boolean;
}
interface Slot {
  time: string;
  available: boolean;
}

/** Bookable days of a shop as a client sees them, and the free times of one day. */
async function freeDays(email: string, shopId: string): Promise<string[]> {
  const av = await rpcAs<{ days: Day[] }>(email, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  return av.days.filter((d) => d.bookable).map((d) => d.date);
}
async function freeTimes(email: string, shopId: string, date: string): Promise<string[]> {
  const av = await rpcAs<{ slots: Slot[] }>(email, 'get_availability', { p_shop_id: shopId, p_from: date, p_days: 1, p_slots_for: date });
  return av.slots.filter((s) => s.available).map((s) => s.time);
}

async function book(clientEmail: string, shopId: string, date: string, slot: string, plate: string, note?: string) {
  return rpcAs<{ id: string; ref: string }>(clientEmail, 'create_booking', {
    p_shop_id: shopId,
    p_service_id: 'ulei',
    p_date: date,
    p_slot: slot,
    p_request_id: crypto.randomUUID(),
    p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate },
    p_save_car: false,
    p_note: note,
  });
}

test.describe('demo shop', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('Panou counters open filtered lists; today prints; every card state (nothing is changed)', async ({ page }) => {
    await signIn(page, SEED.shop, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);

    // Six counters: a non-zero one is a link, and the badge on Programări counts the requests.
    const requests = page.getByRole('link', { name: /^\d+ Cereri noi$/ });
    await expect(requests).toContainText('1');
    await expect(page.getByRole('link', { name: /^\d+ În lucru$/ })).toBeVisible();
    await expect(navLink(page, /^Programări/)).toHaveAccessibleName(/1 cerere nouă/);
    await expect(page.getByText(/Mașini pe zi: \d+ · Azi: \d+/)).toBeVisible();
    await expect(page.getByText(/Clientul are de răspuns la un deviz/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Programul de azi' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't08-panou', name());

    // Print: only today's table, dark on white.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('link', { name: /^\d+ Cereri noi$/ })).toBeHidden();
    await shot(page, 't08-panou-print', name());
    await page.emulateMedia({ media: 'screen' });

    // A row of today's schedule opens that booking alone, with a chip that clears the filter.
    await page.getByRole('link', { name: /08:00/ }).click();
    await expect(page).toHaveURL(/\/s\/programari\?tab=programate&p=/);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toContainText('B 123 IRD');
    await expect(cards(page)).toContainText('În lucru din');
    await page.getByRole('button', { name: /Programarea P-\d+/ }).click();
    await expect.poll(() => cards(page).count()).toBeGreaterThan(1);

    // Back to Panou: the "În lucru" card opens the filtered list.
    await navLink(page, 'Panou').click();
    await page.getByRole('link', { name: /^\d+ În lucru$/ }).click();
    await expect(page).toHaveURL(/filtru=lucru/);
    await expect(page.getByRole('button', { name: /În lucru/, pressed: true })).toBeVisible();
    await expect(cards(page)).toHaveCount(1);
    await page.getByRole('button', { name: /În lucru/, pressed: true }).click();
    await expect(page).not.toHaveURL(/filtru=/);

    // Cereri: the request with the note, the car and the client's account id.
    await page.getByRole('tab', { name: /Cereri/ }).click();
    const request = card(page, 'Aș vrea și verificarea lichidelor.');
    await expect(request).toContainText('Andrei Marin');
    await expect(request).toContainText('BV 12 ABC');
    await expect(request).toContainText(/ID cont C-\d+/);
    await expect(request.getByRole('link', { name: /Sună pe Andrei Marin/ })).toHaveAttribute('href', 'tel:+40723375248');
    await expect(request.getByRole('button', { name: 'Confirmă' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't08-cereri', name());

    // Reprogramează: the shop's calendar inline; "Renunță" closes it with nothing changed.
    await request.getByRole('button', { name: 'Reprogramează' }).click();
    await expect(request.getByRole('heading', { name: 'Reprogramează' })).toBeFocused();
    await request.getByRole('button', { name: /: \d+ (loc|locuri)$/ }).first().click();
    await expect(request.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't08-reschedule', name());
    await request.getByRole('button', { name: 'Renunță' }).click();
    await expect(request.getByRole('button', { name: 'Confirmă' })).toBeVisible();

    // Programate: every state; the no-show mark; "Neprezentat" only after the booking's time.
    await page.getByRole('tab', { name: /Programate/ }).click();
    const george = card(page, 'George Toma');
    await expect(george).toContainText('Client cu 3 neprezentări');
    await expect(george).toContainText('Ora programării a trecut');
    await expect(card(page, 'Cristina Dobre').getByRole('button', { name: 'Neprezentat' })).toHaveCount(0);
    await george.getByRole('button', { name: 'Neprezentat' }).click();
    await expect(george.getByText('Clientul nu a venit?')).toBeVisible();
    await george.getByRole('button', { name: 'Renunță' }).click();
    await expect(card(page, 'Mihai Petrescu')).toContainText('Clientul a acceptat 2 din 3 poziții');
    await expect(card(page, 'Scârțâie la frânare dimineața.')).toContainText('se așteaptă răspunsul clientului');
    await expect(card(page, 'Martorul de motor aprins.').getByRole('button', { name: 'Trimite deviz' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't08-programate', name());

    // "Editează devizul" starts from the sent lines.
    const quoted = card(page, 'Scârțâie la frânare dimineața.');
    await quoted.getByRole('button', { name: 'Editează devizul' }).click();
    await expect(quoted.getByLabel('Poziția 2', { exact: true })).toHaveValue('Discuri frână față');
    await expect(quoted.getByText('850 lei')).toHaveCount(2); // the sent quote and the composer's total
    await shot(page, 't08-quote-edit', name());
    await quoted.getByRole('button', { name: 'Renunță' }).click();
  });
});

test.describe('shop flow', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('a request arrives live, one confirmation for three taps, inspection, a quote of 3 lines the client sees', async ({ page, browser }) => {
    const shopName = `Atelier T08 ${Date.now() % 100000}${Math.floor(Math.random() * 100)}`;
    const { email: shopEmail, shopId } = await createBookableShop(shopName, ['ulei'], { inspection_fee: 80 });
    const clientEmail = await createUser('client');

    await signIn(page, shopEmail, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await expect(page.getByText('Nicio programare azi.')).toBeVisible();
    // A counter at zero is not a link.
    await expect(page.getByRole('link', { name: /^\d+ Cereri noi$/ })).toHaveCount(0);
    await expect(page.getByText('Cereri noi')).toBeVisible();

    // The client books: Panou and the tab badge change without a reload.
    const [day] = await freeDays(clientEmail, shopId);
    const [time] = await freeTimes(clientEmail, shopId, day!);
    const booking = await book(clientEmail, shopId, day!, time!, 'BV 99 TST', 'Zgomot la roata din față.');
    await expect(page.getByRole('link', { name: /^\d+ Cereri noi$/ })).toContainText('1');
    await expect(navLink(page, /^Programări/)).toHaveAccessibleName(/1 cerere nouă/);
    await shot(page, 't08-live-request', name());

    await page.getByRole('link', { name: /^\d+ Cereri noi$/ }).click();
    const c = card(page, 'Zgomot la roata din față.');
    await expect(c).toContainText('Maria Pop');
    await expect(c).toContainText('0723 375 248');
    await expect(c).toContainText('BV 99 TST');
    await expect(c).toContainText(booking.ref);

    // Three quick taps: one confirmation (the button locks on the first).
    const confirm = c.getByRole('button', { name: 'Confirmă' });
    await confirm.evaluate((el: HTMLButtonElement) => {
      el.click();
      el.click();
      el.click();
    });
    await expect(page.getByText(`Programarea ${booking.ref} este confirmată`)).toBeVisible();
    const events = await serviceRest<unknown[]>(`notification_events?booking_id=eq.${booking.id}&event=eq.booking_confirmed&select=id`, 'GET');
    expect(events).toHaveLength(1);
    await expect(navLink(page, /^Programări/)).not.toHaveAccessibleName(/cerere/);

    // The confirmed booking left Cereri; the notice leads to it.
    await page.getByRole('button', { name: 'Vezi programarea' }).click();
    await expect(page).toHaveURL(/tab=programate&p=/);
    await page.getByRole('button', { name: 'În constatare' }).click();
    await expect(cards(page)).toContainText('Mașina este în constatare din');

    // The client's Programări (another browser) follows live.
    const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await other.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const clientPage = await other.newPage();
    await signIn(clientPage, clientEmail, PASSWORD);
    await expect(clientPage).toHaveURL(/\/c\/cauta$/);
    await clientPage.goto('/c/programari');
    const clientCard = clientPage.locator('main li').filter({ hasText: shopName });
    await expect(clientCard).toContainText('În constatare');

    // The quote: three lines, the total live, a row with a missing price refused in place.
    await page.getByRole('button', { name: 'Trimite deviz' }).click();
    await page.getByLabel('Poziția 1', { exact: true }).fill('Plăcuțe frână');
    await page.getByLabel('Preț, lei').first().fill('280');
    await page.getByRole('button', { name: 'Adaugă poziție' }).click();
    await expect(page.getByLabel('Poziția 2', { exact: true })).toBeFocused();
    await page.getByLabel('Poziția 2', { exact: true }).fill('Discuri frână');
    await page.getByLabel('Preț, lei').nth(1).fill('420,50');
    await page.getByRole('button', { name: 'Adaugă poziție' }).click();
    await page.getByLabel('Poziția 3', { exact: true }).fill('Manoperă');
    const top = await scrollTopOf(page);
    await page.getByLabel('Preț, lei').nth(2).fill('150');
    expect(Math.abs((await scrollTopOf(page)) - top)).toBeLessThan(5); // typing never jumps the page
    await expect(page.getByLabel('Preț, lei').nth(2)).toBeFocused();
    await expect(page.getByText('850,50 lei')).toBeVisible();
    await page.getByRole('button', { name: 'Adaugă poziție' }).click();
    await page.getByLabel('Poziția 4', { exact: true }).fill('Lichid frână');
    await page.getByRole('button', { name: 'Trimite devizul' }).click();
    await expect(page.getByText('Scrie prețul.')).toBeVisible();
    await expect(page.getByLabel('Preț, lei').nth(3)).toBeFocused();
    await expect(page.getByText('Taxa de constatare de 80 lei se plătește doar dacă clientul refuză tot devizul.')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't08-quote-composer', name());
    await page.getByRole('button', { name: 'Șterge poziția 4' }).click();
    await page.getByRole('button', { name: 'Trimite devizul' }).click();
    await expect(page.getByText(`Devizul pentru ${booking.ref} a fost trimis clientului.`)).toBeVisible();
    const sent = card(page, booking.ref);
    await expect(sent).toContainText('Deviz trimis — se așteaptă răspunsul clientului.');
    await expect(sent).toContainText('Discuri frână');
    await expect(clientCard).toContainText('Deviz trimis');
    await shot(page, 't08-quote-sent', name());
    await shot(clientPage, 't08-client-quote-sent', name());

    // Edit: a new version replaces it; withdraw: back to inspection; send again.
    await page.getByRole('button', { name: 'Editează devizul' }).click();
    await page.getByLabel('Preț, lei').nth(2).fill('200');
    await page.getByRole('button', { name: 'Trimite devizul nou' }).click();
    await expect(page.getByText(`Devizul nou pentru ${booking.ref} a fost trimis clientului.`)).toBeVisible();
    await expect(sent).toContainText('900,50 lei');
    await page.getByRole('button', { name: 'Retrage devizul' }).click();
    await page.getByRole('button', { name: 'Retrage devizul' }).click();
    await expect(page.getByText(`Devizul pentru ${booking.ref} a fost retras.`)).toBeVisible();
    await expect(sent).toContainText('Mașina este în constatare din');
    await expect(clientCard).toContainText('În constatare');
    await page.getByRole('button', { name: 'Trimite deviz' }).click();
    await page.getByLabel('Poziția 1', { exact: true }).fill('Plăcuțe frână');
    await page.getByLabel('Preț, lei').first().fill('280');
    await page.getByRole('button', { name: 'Trimite devizul' }).click();
    await expect(sent).toContainText('Deviz trimis — se așteaptă răspunsul clientului.');
    await expect(clientCard).toContainText('Deviz trimis');
    const quotes = await serviceRest<{ status: string }[]>(`quotes?booking_id=eq.${booking.id}&select=status&order=version`, 'GET');
    expect(quotes.map((q) => q.status)).toEqual(['superseded', 'withdrawn', 'sent']);
    await other.close();
  });

  test('in English: reschedule onto a day that fills up is refused and nothing moves; then move, cancel, decline', async ({ page }) => {
    const shopName = `Shop T08 ${Date.now() % 100000}${Math.floor(Math.random() * 100)}`;
    const { email: shopEmail, shopId } = await createBookableShop(shopName, ['ulei'], { daily_capacity: 1 }, { lang: 'en' });
    const clients = await Promise.all([1, 2, 3, 4].map(() => createUser('client')));
    const days = await freeDays(clients[0]!, shopId);
    const [dayA, dayB, dayC, dayD] = days;
    expect(dayD).toBeTruthy();
    const slotOf = async (d: string) => (await freeTimes(clients[0]!, shopId, d))[0]!;
    const x = await book(clients[0]!, shopId, dayA!, await slotOf(dayA!), 'BV 01 XXX', 'Booking X');
    const y = await book(clients[1]!, shopId, dayB!, await slotOf(dayB!), 'BV 02 YYY', 'Booking Y');
    await rpcAs(shopEmail, 'confirm_booking', { p_booking_id: y.id, p_request_id: crypto.randomUUID() });

    await signIn(page, shopEmail, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText(/Cars per day: 1 · Today: \d/)).toBeVisible();
    await shot(page, 't08-panou-en', name());
    await navLink(page, /^Bookings/).click();
    const cx = card(page, 'Booking X');
    await cx.getByRole('button', { name: 'Reschedule' }).click();
    await expect(cx.getByRole('button', { name: /: full$/ }).first()).toBeDisabled(); // day B, confirmed Y
    const tile = (d: string) => cx.getByRole('button', { name: `${formatDate('en', d)}: 1 spot` });
    await tile(dayC!).click();
    await cx.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();

    // Meanwhile another client takes the last place of that day.
    await book(clients[2]!, shopId, dayC!, await slotOf(dayC!), 'BV 03 ZZZ');
    await cx.getByRole('button', { name: 'Move and confirm' }).click();
    await expect(cx.getByText('That day just filled up. Pick another day.')).toBeVisible();
    const [unchanged] = await serviceRest<{ date: string; status: string }[]>(`bookings?id=eq.${x.id}&select=date,status`, 'GET');
    expect(unchanged).toEqual({ date: dayA, status: 'pending' });
    await expectNoHorizontalScroll(page);
    await shot(page, 't08-reschedule-refused-en', name());

    // A free day now: moved and confirmed; it leaves Requests.
    await expect(cx.getByRole('button', { name: `${formatDate('en', dayC!)}: full` })).toBeDisabled();
    await tile(dayD!).click();
    await cx.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
    await cx.getByRole('button', { name: 'Move and confirm' }).click();
    await expect(page.getByText(new RegExp(`Booking ${x.ref} moved to .* and confirmed\\.`))).toBeVisible();
    await expect(card(page, 'Booking X')).toHaveCount(0);

    // Cancel needs a reason, which the client gets.
    await page.getByRole('tab', { name: /Scheduled/ }).click();
    const cy = card(page, 'Booking Y');
    await cy.getByRole('button', { name: 'Cancel', exact: true }).click();
    await cy.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(cy.getByText('Write the reason so the client knows why.')).toBeVisible();
    await shot(page, 't08-cancel-en', name());
    await cy.getByLabel('Reason').fill('The lift is broken this week.');
    await cy.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page.getByText(`Booking ${y.ref} was canceled. The client got your reason.`)).toBeVisible();
    const [canceled] = await serviceRest<{ status: string; cancel_reason: string }[]>(`bookings?id=eq.${y.id}&select=status,cancel_reason`, 'GET');
    expect(canceled).toEqual({ status: 'cancelled', cancel_reason: 'The lift is broken this week.' });

    // Decline: the reason is optional.
    const freeNow = await freeDays(clients[3]!, shopId);
    const z = await book(clients[3]!, shopId, freeNow[0]!, await slotOf(freeNow[0]!), 'BV 04 WWW', 'Booking Z');
    await page.getByRole('tab', { name: /Requests/ }).click();
    const cz = card(page, 'Booking Z');
    await cz.getByRole('button', { name: 'Decline' }).click();
    await cz.getByRole('button', { name: 'Decline request' }).click();
    await expect(page.getByText(`Request ${z.ref} was declined. The client has been told.`)).toBeVisible();
    await expect(card(page, 'Booking Z')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});
