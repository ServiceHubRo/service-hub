import { expect, test } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  confirmEmail,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  openAccount,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  uniqueEmail,
  uniquePhone,
  userIdOf,
} from './support';

// Invite a friend (T35): the client finds the card in Cont with the link; the friend opens it and
// signs up with the code already filled in (a wrong one is refused); when a shop finishes the
// friend's first job, the client gets a free report, uses it on the report preview without paying,
// and the report is made and numbered like a paid one. Romanian and English.

const name = () => test.info().project.name;
const rid = () => crypto.randomUUID();

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

interface Day {
  date: string;
  bookable: boolean;
}
interface Slot {
  time: string;
  available: boolean;
}

async function freeSlot(email: string, shopId: string, skip = 0): Promise<{ date: string; slot: string }> {
  const av = await rpcAs<{ days: Day[] }>(email, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  const found: { date: string; slot: string }[] = [];
  for (const day of av.days.filter((d) => d.bookable)) {
    const s = await rpcAs<{ slots: Slot[] }>(email, 'get_availability', { p_shop_id: shopId, p_from: day.date, p_days: 1, p_slots_for: day.date });
    for (const slot of s.slots.filter((x) => x.available)) {
      found.push({ date: day.date, slot: slot.time });
      if (found.length > skip) return found[skip]!;
    }
  }
  throw new Error('no free slot');
}

/** Booked in the app, quoted, accepted and finished by the shop: a real first job. */
async function finishedJob(shop: string, client: string, shopId: string, plate: string, skip: number): Promise<string> {
  const at = await freeSlot(client, shopId, skip);
  const booking = await rpcAs<{ id: string }>(client, 'create_booking', {
    p_shop_id: shopId,
    p_service_id: 'ulei',
    p_date: at.date,
    p_slot: at.slot,
    p_request_id: rid(),
    p_car: { make: 'Dacia', model: 'Duster', year: 2019, plate },
  });
  await rpcAs(shop, 'confirm_booking', { p_booking_id: booking.id, p_request_id: rid() });
  await rpcAs(shop, 'start_inspection', { p_booking_id: booking.id, p_request_id: rid() });
  await rpcAs(shop, 'send_quote', { p_booking_id: booking.id, p_items: [{ name: 'Manoperă', price: 150 }], p_request_id: rid() });
  const [quote] = await serviceRest<{ id: string; quote_items: { id: string }[] }[]>(
    `quotes?booking_id=eq.${booking.id}&status=eq.sent&select=id,quote_items(id)`,
    'GET',
  );
  await rpcAs(client, 'decide_quote', {
    p_booking_id: booking.id,
    p_quote_id: quote!.id,
    p_approved_item_ids: quote!.quote_items.map((i) => i.id),
    p_request_id: rid(),
  });
  await rpcAs(shop, 'start_work', { p_booking_id: booking.id, p_request_id: rid() });
  await rpcAs(shop, 'complete_job', { p_booking_id: booking.id, p_odometer: 80000 + skip, p_work: 'Revizie', p_request_id: rid() });
  return booking.id;
}

function plate(): string {
  const l = () => 'ABCDEFGHJKLMNPRSTUVWXZ'[Math.floor(Math.random() * 22)];
  return `CJ ${10 + Math.floor(Math.random() * 89)} ${l()}${l()}${l()}`;
}

test.describe('invite a friend', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(150_000);

  test('the link brings a friend, the friend’s first job brings a free report, used without paying', async ({ page, browser }) => {
    const { email: shop, shopId } = await createBookableShop(`Atelier Invitație ${Date.now() % 100000}`, ['ulei']);
    const inviter = await createUser('client');
    const inviterId = await userIdOf(inviter);
    const ownJob = await finishedJob(shop, inviter, shopId, plate(), 0);

    // ------------------------------------------------------------ Cont → Invită un prieten
    await signIn(page, inviter, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await openAccount(page);
    const card = page.getByRole('region', { name: 'Invită un prieten' });
    await expect(card).toBeVisible();
    const code = (await card.locator('span.mono').filter({ hasText: /^C-\d{5,}$/ }).textContent())!.trim();
    await expect(card).toContainText('Până la 3 rapoarte gratuite pe an.');
    await expect(card).toContainText('Prieteni invitați: 0 · Rapoarte gratuite primite: 0');
    await expect(card.getByRole('link', { name: 'Trimite pe WhatsApp' })).toHaveAttribute(
      'href',
      new RegExp(`^https://wa\\.me/\\?text=.*cont-nou%3Frol%3Dclient%26cod%3D${code}`),
    );
    const link = await card.getByLabel('Linkul de înscriere').inputValue();
    expect(link).toContain(`/cont-nou?rol=client&cod=${code}`);
    await card.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 'invite-card', name());

    // ------------------------------------------------------------ the friend, from the link
    const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await other.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const friend = await other.newPage();
    await friend.goto(new URL(link).pathname + new URL(link).search);
    await expect(friend.getByRole('button', { name: 'Sunt client' })).toHaveAttribute('aria-pressed', 'true');
    const codeField = friend.getByLabel('Cod de invitare (opțional)');
    await expect(codeField).toHaveValue(code);
    const friendEmail = uniqueEmail('friend');
    await friend.getByLabel('Nume și prenume').fill('Radu Prieten');
    await friend.getByLabel('Telefon').fill(uniquePhone().national);
    await friend.getByLabel('Email').fill(friendEmail);
    await friend.getByLabel('Parolă', { exact: true }).fill(PASSWORD);
    await friend.getByLabel('Repetă parola').fill(PASSWORD);
    await friend.getByRole('checkbox').check();
    await codeField.fill('C-99999');
    await friend.getByRole('button', { name: 'Creează cont' }).click();
    await expect(friend.getByText('Nu am găsit acest cod. Verifică-l sau lasă câmpul gol.')).toBeVisible();
    await expect(codeField).toBeFocused();
    await expectNoHorizontalScroll(friend);
    await shot(friend, 'invite-signup', name());
    await codeField.fill(code.toLowerCase());
    await friend.getByRole('button', { name: 'Creează cont' }).click();
    await expect(friend).toHaveURL(/\/confirma-email$/);

    await other.close();

    // The same form in English.
    const english = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await english.addInitScript(() => localStorage.setItem('sh_lang', 'en'));
    const visitor = await english.newPage();
    await visitor.goto(new URL(link).pathname + new URL(link).search);
    await expect(visitor.getByLabel('Invitation code (optional)')).toHaveValue(code);
    await expect(visitor.getByText('Got a link or a code from a friend? Enter it here.')).toBeVisible();
    await shot(visitor, 'invite-signup-en', name());
    await english.close();

    // The invitation is recorded; nobody reads it from the browser.
    const [invited] = await serviceRest<{ client_id: string; status: string }[]>(
      `client_referrals?referrer_id=eq.${inviterId}&select=client_id,status`,
      'GET',
    );
    expect(invited!.status).toBe('signed_up');
    const refused = await fetch(`${process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/rest/v1/client_referrals?select=*`, {
      headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY ?? '' },
    });
    expect(refused.ok).toBe(false);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Invită un prieten' })).toContainText('Prieteni invitați: 1');

    // ------------------------------------------------------------ the friend's first job is finished
    await confirmEmail(invited!.client_id);
    await finishedJob(shop, friendEmail, shopId, plate(), 1);
    const events = await serviceRest<{ channels: string[] }[]>(
      `notification_events?user_id=eq.${inviterId}&event=eq.report_credit&select=channels`,
      'GET',
    );
    expect(events).toEqual([{ channels: ['push', 'email'] }]);
    await page.reload();
    const rewarded = page.getByRole('region', { name: 'Invită un prieten' });
    await expect(rewarded).toContainText('Rapoarte gratuite primite: 1');
    await expect(rewarded).toContainText('Ai 1 raport gratuit de folosit.');
    await rewarded.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 'invite-card-rewarded', name());

    // In English.
    await serviceRest(`profiles?id=eq.${inviterId}`, 'PATCH', { lang: 'en' });
    await page.evaluate(() => localStorage.setItem('sh_lang', 'en'));
    await page.reload();
    const cardEn = page.getByRole('region', { name: 'Invite a friend' });
    await expect(cardEn).toContainText('You have 1 free report to use.');
    await expect(cardEn).toContainText('Friends invited: 1 · Free reports received: 1');
    await cardEn.scrollIntoViewIfNeeded();
    await shot(page, 'invite-card-en', name());
    await serviceRest(`profiles?id=eq.${inviterId}`, 'PATCH', { lang: 'ro' });
    await page.evaluate(() => localStorage.setItem('sh_lang', 'ro'));
    await page.reload();

    // ------------------------------------------------------------ the free report
    await page.getByRole('link', { name: 'Alege mașina' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Rapoartele mele' })).toBeVisible();
    await expect(page.getByText('Ai 1 raport gratuit de la prietenii invitați. Alege mașina mai jos.')).toBeVisible();
    await page.goto(`/c/programari/${ownJob}/raport`);
    await expect(page.getByText('Raport gratuit', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Plătește 29 lei' })).toBeVisible();
    await page.getByRole('button', { name: 'Folosește raportul gratuit' }).scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 'invite-report-free', name());
    // No waiver needed: nothing is paid.
    await page.getByRole('button', { name: 'Folosește raportul gratuit' }).click();
    await expect(page).toHaveURL(/\/c\/cont\/rapoarte\?raport=/);
    const reportCard = page.locator('main li').first();
    await expect(reportCard).toContainText('Gata', { timeout: 30_000 });
    await expect(reportCard.locator('.mono').filter({ hasText: /^SH-\d{4}-\d{6}$/ })).toBeVisible();
    await expect(page.getByText(/de la prietenii invitați/)).toHaveCount(0);
    await shot(page, 'invite-report-done', name());

    const [credit] = await serviceRest<{ used_at: string | null; report_id: string | null }[]>(
      `report_credits?client_id=eq.${inviterId}&select=used_at,report_id`,
      'GET',
    );
    expect(credit!.used_at).not.toBeNull();
    const [report] = await serviceRest<{ amount_paid: number; status: string }[]>(
      `history_reports?id=eq.${credit!.report_id}&select=amount_paid,status`,
      'GET',
    );
    expect(report).toEqual({ amount_paid: 0, status: 'generated' });
  });
});
