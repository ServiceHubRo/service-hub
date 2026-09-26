import { expect, test, type Page } from '@playwright/test';
import { nextEmail, nextSms, smsTo } from './providers';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  latestEmail,
  openAccount,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  uniqueEmail,
} from './support';

// T13 — email and SMS. The Edge Functions of the local stack send to stand-ins for Resend and
// SMSO (providers.ts), so every message can be read back: the SMS code a shop confirms its
// phone with, the SMS a shop gets for a new request, the staff invitation email, and the Auth
// emails in the account's language (the local mail catcher).

const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

/** A Romanian mobile number no other test uses (the per-number daily limit is shared). */
function uniquePhone(): { e164: string; shown: string } {
  const rest = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  const national = `07${rest}`;
  return { e164: `+407${rest}`, shown: `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}` };
}

const codeIn = (sms: { body: string }) => /\b(\d{6})\b/.exec(sms.body)![1]!;

async function codeField(page: Page) {
  return page.getByLabel('Codul din SMS');
}

test.describe('email and SMS', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(90_000);

  test('a new shop confirms its phone on Panou with the code from the SMS', async ({ page }) => {
    const phone = uniquePhone();
    const email = await createUser('shop', { phone: phone.e164 });
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await expect(page.getByText(`Îți trimitem un cod de 6 cifre prin SMS la ${phone.shown}.`)).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Trimite codul' }).click();
    const sms = await nextSms(phone.e164);
    expect(sms.body).toMatch(/^Codul tau Service-Hub: \d{6}\. Expira in 10 minute\. Nu il da nimanui\.$/);
    const field = await codeField(page);
    await expect(field).toBeFocused();
    await expect(page.getByText(`L-am trimis la ${phone.shown}. Este valabil 10 minute.`)).toBeVisible();
    await expect(page.getByRole('button', { name: /Poți cere alt cod în \d+ s/ })).toBeDisabled();
    await shot(page, 't13-phone-code', name());

    // A reload finds the code still waiting.
    await page.reload();
    await expect(await codeField(page)).toBeVisible();

    // A typo, then a wrong code, then the right one.
    await (await codeField(page)).fill('123');
    await page.getByRole('button', { name: 'Confirmă numărul' }).click();
    await expect(page.getByText('Codul are 6 cifre.')).toBeVisible();
    const right = codeIn(sms);
    const wrong = right === '000000' ? '111111' : '000000';
    await (await codeField(page)).fill(wrong);
    await page.getByRole('button', { name: 'Confirmă numărul' }).click();
    await expect(page.getByText('Cod greșit. Mai ai 4 încercări.')).toBeVisible();
    await expect(await codeField(page)).toBeFocused();
    await shot(page, 't13-phone-wrong', name());
    await (await codeField(page)).fill(right);
    await page.getByRole('button', { name: 'Confirmă numărul' }).click();

    await expect(page.getByText('1 din 4', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trimite codul' })).toHaveCount(0);
    await expect(page.getByText('Confirmă numărul de telefon', { exact: true })).toBeVisible();
    await expect(page.getByText('Confirmă numărul de telefon.', { exact: true })).toHaveCount(0);
    await shot(page, 't13-phone-done', name());
    // Only one SMS left for all of this.
    expect(await smsTo(phone.e164)).toHaveLength(1);

    await openAccount(page);
    await expect(page.getByText('Număr confirmat')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Confirmă numărul de telefon' })).toHaveCount(0);
  });

  test('Cont, in English: an unconfirmed number and the code panel', async ({ page }) => {
    const phone = uniquePhone();
    const email = await createUser('shop', { phone: phone.e164, lang: 'en' });
    await signIn(page, email, PASSWORD);
    await page.getByRole('link', { name: 'Account', exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByText('Number not confirmed')).toBeVisible();
    const card = page.getByRole('region', { name: 'Confirm your phone number' });
    await expect(card).toContainText('The shop appears in search only once its number is confirmed.');
    await card.getByRole('button', { name: 'Send the code' }).click();
    const sms = await nextSms(phone.e164);
    expect(sms.body).toMatch(/^Your Service-Hub code: \d{6}\./);
    await expect(card.getByLabel('Code from the text message')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't13-phone-account-en', name());
    await card.getByLabel('Code from the text message').fill(codeIn(sms));
    await card.getByRole('button', { name: 'Confirm number' }).click();
    await expect(page.getByText('Number confirmed')).toBeVisible();
    await expect(card).toHaveCount(0);
  });

  test('a shop with SMS on gets a text for a new request', async () => {
    // The database wakes the dispatcher only once it knows its address (first GET).
    await fetch(`${API}/functions/v1/dispatch-notifications`);
    const phone = uniquePhone();
    const { shopId } = await createBookableShop('Atelier SMS', ['ulei'], {}, { phone: phone.e164 });
    await serviceRest(`shops?id=eq.${shopId}`, 'PATCH', { sms_on_new_booking: true });
    const client = await createUser('client', { name: 'Radu Sms' });
    const av = await rpcAs<{ days: { date: string; bookable: boolean }[] }>(client, 'get_availability', { p_shop_id: shopId, p_days: 30 });
    const day = av.days.find((d) => d.bookable)!.date;
    const slots = await rpcAs<{ slots: { time: string; available: boolean }[] }>(client, 'get_availability', {
      p_shop_id: shopId,
      p_from: day,
      p_days: 1,
      p_slots_for: day,
    });
    const slot = slots.slots.find((s) => s.available)!.time;
    await rpcAs(client, 'create_booking', {
      p_shop_id: shopId,
      p_service_id: 'ulei',
      p_date: day,
      p_slot: slot,
      p_car: { make: 'Dacia', model: 'Logan', plate: 'BV 12 SMS' },
      p_request_id: crypto.randomUUID(),
    });
    const sms = await nextSms(phone.e164);
    expect(sms.body).toMatch(
      new RegExp(`^Service-Hub: cerere noua de la Radu Sms, .+, ${slot.slice(0, 5)}: Schimb ulei.*\\. Raspunde in aplicatie\\. Oprire SMS: Setari > Notificari$`),
    );
    expect(sms.body.length).toBeLessThanOrEqual(160);
  });

  test('the staff invitation arrives by email with a link to this app', async ({ page, browser }) => {
    const owner = await createUser('shop', { name: 'Ion Popescu', shop_name: 'Atelier Email' });
    await signIn(page, owner, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.goto('/s/cont/setari/personal');
    const colleague = uniqueEmail('invitat');
    await page.getByLabel('Emailul colegului').fill(colleague);
    await page.getByRole('button', { name: 'Trimite invitația' }).click();
    await expect(page.getByText(`Am trimis invitația pe email la ${colleague}.`, { exact: false })).toBeVisible();
    await expect(page.getByLabel('Linkul de invitație')).toHaveValue(/\/invitatie\/[0-9a-f]{64}$/);
    await expectNoHorizontalScroll(page);
    await shot(page, 't13-invite-sent', name());

    const mail = await nextEmail(colleague);
    expect(mail.subject).toBe('Ion Popescu te invită în Atelier Email pe Service-Hub');
    expect(mail.reply_to).toBe(owner);
    const link = /https?:\/\/\S+\/invitatie\/[0-9a-f]{64}/.exec(mail.text)![0];
    expect(new URL(link).origin).toBe(new URL(page.url()).origin);
    expect(link).toBe(await page.getByLabel('Linkul de invitație').inputValue());

    const guest = await (await browser.newContext({ viewport: page.viewportSize()!, locale: 'ro-RO' })).newPage();
    await guest.goto(link);
    await expect(guest.getByText(/Atelier Email din Brașov te-a invitat/)).toBeVisible();

    // "Retrimite invitația" sends a new email with a new link.
    await page.getByRole('button', { name: 'Retrimite invitația' }).click();
    const again = await nextEmail(colleague, 1);
    expect(again.text).not.toContain(link);
  });

  test('Auth emails come in the account language', async () => {
    test.skip(name() !== 'desktop-1440', 'one sign-up is enough');
    const email = uniqueEmail('en-signup');
    const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';
    const res = await fetch(`${API}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        data: { role: 'client', name: 'Emma Stone', phone: '+40723000111', lang: 'en', terms_version: '2026-09' },
      }),
    });
    expect(res.ok).toBe(true);
    const { id } = (await res.json()) as { id: string };
    const mail = await latestEmail(email, /^Confirm your email address$/);
    expect(mail.text).toContain('Welcome to Service-Hub');
    expect(mail.link).toMatch(/\/auth\/v1\/verify\?/);

    // The account switches to Romanian: the next email (password reset) is Romanian.
    await serviceRest(`profiles?id=eq.${id}`, 'PATCH', { lang: 'ro' });
    await fetch(`${API}/auth/v1/recover`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const reset = await latestEmail(email, /^Resetează parola Service-Hub$/);
    expect(reset.text).toContain('Ai cerut resetarea parolei');
  });
});
