import { expect, test } from '@playwright/test';
import { emailsTo, stripeEndSubscription, stripeFailPayment, stripeSubscriptionOf, type SentEmail } from './providers';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  expectNoHorizontalScroll,
  openAccount,
  createUser,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  userIdOf,
} from './support';

// T14 — the subscription. The local stack's Stripe functions talk to a Stripe stand-in
// (providers.ts): Checkout and the portal are small test pages, and every change comes back
// through a signed webhook to stripe-webhook, as with the real Stripe. So the whole path is real:
// Activează → pay → the webhook → the screen updates live → Gestionează → cancel.

/** The email with this subject to an address, waiting for it (other emails may come first). */
async function emailWith(to: string, subject: string): Promise<SentEmail> {
  await expect.poll(async () => (await emailsTo(to)).some((m) => m.subject === subject), { timeout: 20_000 }).toBe(true);
  return (await emailsTo(to)).find((m) => m.subject === subject)!;
}

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

const BILLING = {
  legal_name: 'AUTO TEST SRL',
  vat_id: 'RO14872301',
  reg_com: 'J08/1245/2009',
  legal_address: 'Str. Lungă 10, Brașov',
  billing_email: 'facturi@service-hub.test',
};

async function shopWith(options: { billing?: boolean; lang?: string } = {}) {
  const shop = await createBookableShop(`Atelier Abonament ${Date.now()}`, ['ulei'], {}, options.lang ? { lang: options.lang } : {});
  if (options.billing !== false) await serviceRest(`shop_billing?shop_id=eq.${shop.shopId}`, 'PATCH', BILLING);
  // A shop that signed up at 100 lei and 20 lei per colleague, the prices of the Stripe test
  // products (the launch price, 149 and 19 lei are checked on the landing page and in SQL).
  await serviceRest(`subscriptions?shop_id=eq.${shop.shopId}`, 'PATCH', { price_ron: 100, seat_price_ron: 20, launch_offer: false });
  return shop;
}

async function subscriptionOf(shopId: string) {
  const [row] = await serviceRest<{ status: string; stripe_customer_id: string | null; stripe_status: string | null }[]>(
    `subscriptions?shop_id=eq.${shopId}&select=status,stripe_customer_id,stripe_status`,
    'GET',
  );
  return row!;
}

test.describe('subscription', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  // The dispatcher records its address on its first call (the deploy Action does this for real),
  // so the database can wake it for the payment emails.
  test.beforeAll(async () => {
    await fetch(`${API}/functions/v1/dispatch-notifications`);
  });

  test('in the free period: billing data first, then the card is saved and nothing is charged', async ({ page }) => {
    const { email, shopId } = await shopWith({ billing: false });
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await openAccount(page);
    await expect(page.getByRole('link', { name: /Abonament\s*Perioadă gratuită · 90 de zile/ })).toBeVisible();
    await shot(page, 't14-account-tile', name());
    await page.getByRole('link', { name: /^Abonament/ }).click();

    await expect(page.getByText('Perioadă gratuită', { exact: true })).toBeVisible();
    await expect(page.getByText('Mai ai 90 de zile gratuite din 90.')).toBeVisible();
    await expect(page.getByRole('meter')).toHaveAttribute('aria-valuenow', '90');
    await expect(page.getByText('100 lei', { exact: true })).toBeVisible();
    await expect(page.getByText('Fără contract, anulezi oricând')).toBeVisible();
    await expect(page.getByText('Nicio plată încă.')).toBeVisible();
    // No invoice without the company's details: the button is a link to them.
    await expect(page.getByText('Completează datele de facturare înainte de plată: factura se emite pe firma ta.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activează abonamentul' })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, 't14-subscription-trial', name());
    await page.getByRole('link', { name: 'Completează datele de facturare' }).click();
    await expect(page).toHaveURL(/\/s\/cont\/setari\/facturare$/);

    await serviceRest(`shop_billing?shop_id=eq.${shopId}`, 'PATCH', BILLING);
    await page.goto('/s/cont/abonament');
    await expect(page.getByText('Salvezi cardul acum; prima plată se face la sfârșitul perioadei gratuite.')).toBeVisible();
    await page.getByRole('button', { name: 'Activează abonamentul' }).click();

    // Stripe's page (the stand-in), then back.
    await expect(page.getByRole('heading', { name: 'Stripe test checkout' })).toBeVisible();
    await expect(page.getByText('Abonament: 100 lei / lună')).toBeVisible();
    await page.getByRole('button', { name: 'Plătește' }).click();
    await expect(page).toHaveURL(/\/s\/cont\/abonament\?plata=ok$/);
    await expect(page.getByText('Mulțumim. Cardul e salvat, prima plată se face la sfârșitul perioadei gratuite.')).toBeVisible();
    await expect(page.getByText(/^Cardul e salvat\. Prima plată, 100 lei, pe \d{1,2} [a-z]+\.$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activează abonamentul' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Gestionează abonamentul' })).toBeVisible();
    await expect(page.getByText('Nicio plată încă.')).toBeVisible();
    await shot(page, 't14-subscription-card-saved', name());

    const sub = await subscriptionOf(shopId);
    expect(sub).toMatchObject({ status: 'trial', stripe_status: 'trialing' });
    expect(sub.stripe_customer_id).toMatch(/^cus_/);
  });

  test('paying for 12 months at once: the period and its discount, in Checkout, in Stripe and on the screen', async ({ page }) => {
    const { email, shopId } = await shopWith();
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.goto('/s/cont/abonament');

    // Four periods; a month is chosen first. 100 lei a month: 285 / 540 / 1.020 lei.
    const periods = page.getByRole('group', { name: 'Cum plătești' });
    await expect(periods.getByRole('radio')).toHaveCount(4);
    await expect(periods.getByRole('radio', { name: /^Lunar/ })).toBeChecked();
    await expect(periods.getByText('5% reducere', { exact: true })).toBeVisible();
    await expect(periods.getByText('540 lei')).toBeVisible();
    await expect(periods.getByText('cam 85 lei pe lună')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 'periods-choice', name());

    const twelve = periods.getByRole('radio', { name: /^12 luni/ });
    await twelve.scrollIntoViewIfNeeded();
    const top = await page.evaluate(() => document.querySelector('main')?.scrollTop ?? 0);
    await twelve.check();
    await expect(twelve).toBeChecked();
    // Choosing never moves the page.
    expect(await page.evaluate(() => document.querySelector('main')?.scrollTop ?? 0)).toBe(top);

    await page.getByRole('button', { name: 'Activează abonamentul' }).click();
    await expect(page.getByText('Abonament: 1020 lei / 12 luni')).toBeVisible();
    await page.getByRole('button', { name: 'Plătește' }).click();
    await expect(page).toHaveURL(/\/s\/cont\/abonament\?plata=ok$/);
    await expect(page.getByText(/^Cardul e salvat\. Prima plată, 1\.020 lei, pe \d{1,2} [a-z]+\.$/)).toBeVisible();
    await expect(page.getByText('Plătești la 12 luni: 1.020 lei, cu 15% reducere.')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Cum plătești' })).toHaveCount(0);
    await shot(page, 'periods-card-saved', name());

    const [row] = await serviceRest<{ billing_months: number; period_discount: number; stripe_customer_id: string }[]>(
      `subscriptions?shop_id=eq.${shopId}&select=billing_months,period_discount,stripe_customer_id`,
      'GET',
    );
    expect(row).toMatchObject({ billing_months: 12, period_discount: 15 });
    const inStripe = (await stripeSubscriptionOf(row!.stripe_customer_id)) as unknown as {
      items: { data: { price: { unit_amount: number; recurring: { interval_count: number } } }[] };
    };
    expect(inStripe.items.data[0]!.price).toMatchObject({ unit_amount: 102000, recurring: { interval_count: 12 } });
  });

  test('inactive after the free period: pay, back in search, a receipt, then cancel at the end of the month', async ({ page }) => {
    const { email, shopId } = await shopWith();
    await serviceRest(`subscriptions?shop_id=eq.${shopId}`, 'PATCH', { trial_ends_at: new Date(Date.now() - 3600_000).toISOString() });
    await serviceRest('rpc/end_expired_trials', 'POST', {});
    expect((await subscriptionOf(shopId)).status).toBe('inactive');
    const [{ name: shopName }] = await serviceRest<{ name: string }[]>(`shops?id=eq.${shopId}&select=name`, 'GET');
    expect((await emailWith(email, `${shopName} nu mai apare în căutări`)).text).toContain('Perioada gratuită s-a încheiat.');

    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.getByRole('link', { name: 'Abonamentul a expirat. Plătește-l ca să revii în căutări.' }).click();
    await expect(page).toHaveURL(/\/s\/cont\/abonament$/);
    await expect(page.getByText('Inactiv', { exact: true })).toBeVisible();
    await expect(page.getByText('Abonamentul a expirat. Service-ul tău nu mai apare în căutări.')).toBeVisible();
    await expect(page.getByText('Prima plată se face acum, apoi o dată pe lună.')).toBeVisible();
    await shot(page, 't14-subscription-inactive', name());

    await page.getByRole('button', { name: 'Plătește abonamentul' }).click();
    await page.getByRole('button', { name: 'Plătește' }).click();
    await expect(page).toHaveURL(/\/s\/cont\/abonament\?plata=ok$/);
    await expect(page.getByText('Mulțumim. Abonamentul e activ.')).toBeVisible();
    await expect(page.getByText('Activ', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Următoarea plată: 100 lei, pe /)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Chitanța plății din / })).toBeVisible();
    await expect(page.getByText('Factura vine separat.')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't14-subscription-active', name());

    // Back in search at once, and the payment email.
    const setup = await rpcAs<{ public: boolean; reasons: string[] }>(email, 'get_shop_setup', {});
    expect(setup).toMatchObject({ public: true, reasons: [] });
    const mail = await emailWith(email, 'Plată primită: 100 lei');
    expect(mail.text).toContain('Vezi chitanța: http://127.0.0.1:54398/stripe/receipt/');

    // Gestionează → Stripe's portal → cancel → back: active until the end of the month.
    await page.getByRole('button', { name: 'Gestionează abonamentul' }).click();
    await expect(page.getByRole('heading', { name: 'Stripe test portal' })).toBeVisible();
    await page.getByRole('button', { name: 'Anulează abonamentul' }).click();
    await expect(page).toHaveURL(/\/s\/cont\/abonament$/);
    await expect(page.getByText('Se oprește', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Abonamentul se oprește pe .+\. Până atunci service-ul apare în căutări\.$/)).toBeVisible();

    // The month ends: the screen follows live.
    await stripeEndSubscription((await subscriptionOf(shopId)).stripe_customer_id!);
    await expect(page.getByText('Anulat', { exact: true })).toBeVisible();
    await expect(page.getByText('Abonamentul s-a încheiat. Service-ul tău nu mai apare în căutări.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Plătește abonamentul' })).toBeVisible();
    expect((await rpcAs<{ public: boolean }>(email, 'get_shop_setup', {})).public).toBe(false);
  });

  test('a failed payment: warned on Panou while Stripe retries, inactive after the last try', async ({ page }) => {
    const { email, shopId } = await shopWith();
    // A day left in the free period: the checkout charges at once.
    await serviceRest(`subscriptions?shop_id=eq.${shopId}`, 'PATCH', { trial_ends_at: new Date(Date.now() + 86_400_000).toISOString() });
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await expect(page.getByText('Perioada gratuită se termină în 1 zi. Activează abonamentul ca service-ul să rămână în căutări.')).toBeVisible();
    await shot(page, 't14-panou-trial-ending', name());
    await page.getByRole('link', { name: 'Activează', exact: true }).click();
    await expect(page.getByText('Prima plată se face acum, apoi o dată pe lună.')).toBeVisible();
    await page.getByRole('button', { name: 'Activează abonamentul' }).click();
    await page.getByRole('button', { name: 'Plătește' }).click();
    await expect(page.getByText('Activ', { exact: true })).toBeVisible();

    const customer = (await subscriptionOf(shopId)).stripe_customer_id!;
    await stripeFailPayment(customer);
    await expect(page.getByText('Plată restantă', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Plata nu a trecut\. Reîncercăm pe .+\. Verifică sau schimbă cardul din Gestionează\.$/)).toBeVisible();
    // The thank-you from the checkout does not stay over a later failed payment.
    await expect(page.getByText('Mulțumim. Abonamentul e activ.')).toHaveCount(0);
    await shot(page, 't14-subscription-past-due', name());
    const failedMail = await emailWith(email, 'Plata abonamentului nu a trecut');
    expect(failedMail.text).toMatch(/Reîncercăm pe \d{1,2} [a-z]+\./);

    await page.goto('/s/panou');
    await expect(page.getByText('Plata abonamentului nu a trecut. Verifică cardul ca service-ul să rămână în căutări.')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't14-panou-past-due', name());
    expect((await rpcAs<{ public: boolean }>(email, 'get_shop_setup', {})).public).toBe(true);

    await stripeFailPayment(customer, true);
    await page.goto('/s/cont/abonament');
    await expect(page.getByText('Inactiv', { exact: true })).toBeVisible();
    await expect(page.getByText('Plata abonamentului nu a trecut. Service-ul tău nu mai apare în căutări.')).toBeVisible();
    expect(await subscriptionOf(shopId)).toMatchObject({ status: 'inactive', stripe_status: 'unpaid' });
  });

  test('in English', async ({ page }) => {
    const { email } = await shopWith({ lang: 'en' });
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.goto('/s/cont/abonament');
    await expect(page.getByRole('heading', { level: 1, name: 'Subscription' })).toBeVisible();
    await expect(page.getByText('Free period', { exact: true })).toBeVisible();
    await expect(page.getByText('90 free days left out of 90.')).toBeVisible();
    await expect(page.getByText('100 RON', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activate subscription' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't14-subscription-en', name());
  });

  test('colleagues: the first included, the shop’s 20 lei for each one after it, in Checkout and in Stripe', async ({ page }) => {
    const { email, shopId } = await shopWith();
    // Two colleagues whose accounts joined the shop (the invitation flow has its own test).
    const names = ['Coleg Inclus', 'Coleg Plătit'];
    for (const colleagueName of names) {
      const colleague = await createUser('client', { name: colleagueName });
      const colleagueId = await userIdOf(colleague);
      await serviceRest(`profiles?id=eq.${colleagueId}`, 'PATCH', { role: 'shop' });
      await serviceRest('shop_staff', 'POST', {
        shop_id: shopId,
        user_id: colleagueId,
        invited_email: colleague,
        role: 'staff',
        accepted_at: new Date().toISOString(),
      });
    }

    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.goto('/s/cont/abonament');
    // The plan's price (the monthly choice below shows the same figure).
    await expect(page.getByText('120 lei', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText('100 lei + 1 coleg × 20 lei · Primul coleg cu cont în service e inclus în abonament.'),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 'seats-subscription', name());

    // Stripe's page charges the plan and the one paid colleague; the subscription has both items.
    await page.getByRole('button', { name: 'Activează abonamentul' }).click();
    await expect(page.getByText('Abonament: 120 lei / lună')).toBeVisible();
    await page.getByRole('button', { name: 'Plătește' }).click();
    await expect(page).toHaveURL(/\/s\/cont\/abonament\?plata=ok$/);
    const customer = (await subscriptionOf(shopId)).stripe_customer_id!;
    const seatsInStripe = async () =>
      (await stripeSubscriptionOf(customer))?.items.data.find((i) => i.price.id === 'price_local_seat')?.quantity ?? 0;
    expect(await seatsInStripe()).toBe(1);

    // Personal: what a colleague costs; removing one leaves only the included one, off the Stripe bill.
    await page.goto('/s/cont/setari/personal');
    await expect(page.getByText(/^Primul coleg cu cont în service e inclus în abonament\. Fiecare coleg în plus/)).toBeVisible();
    await expect(page.getByText('Acum abonamentul tău este 120 lei pe lună, cu 1 coleg în plus.', { exact: false })).toBeVisible();
    await shot(page, 'seats-staff', name());
    const card = page.locator('div').filter({ hasText: 'Coleg Plătit' }).filter({ has: page.getByRole('button', { name: 'Elimină' }) }).last();
    await card.getByRole('button', { name: 'Elimină' }).click();
    await page.getByRole('button', { name: 'Da, elimină' }).click();
    await expect.poll(seatsInStripe, { timeout: 30_000 }).toBe(0);
    await expect
      .poll(async () => (await serviceRest<{ billed_seats: number | null }[]>(`subscriptions?shop_id=eq.${shopId}&select=billed_seats`, 'GET'))[0]!.billed_seats)
      .toBe(0);
    await page.goto('/s/cont/abonament');
    await expect(page.getByText('100 lei', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Primul coleg cu cont în service e inclus în abonament. Fiecare coleg în plus adaugă 20 lei pe lună.'),
    ).toBeVisible();
  });
});
