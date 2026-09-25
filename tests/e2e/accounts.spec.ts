import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_PASSWORD,
  createUser,
  expectNoHorizontalScroll,
  isDesktop,
  latestEmail,
  openAccount,
  revokeSessions,
  shot,
  signIn,
  uniqueEmail,
} from './support';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const name = () => test.info().project.name;

// ------------------------------------------------------------------------------------ no backend needed

test('sign-in and sign-up screens, RO and EN', async ({ page }) => {
  await page.goto('/intra');
  await expect(page.getByText('Programări auto, fără telefoane')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Autentificare' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('checkbox', { name: 'Ține-mă minte' })).toBeChecked();
  await expect(page.getByRole('link', { name: 'Ai uitat parola?' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'auth-signin-ro', name());

  await page.getByRole('tab', { name: 'Cont nou' }).click();
  await expect(page).toHaveURL(/\/cont-nou$/);
  await expect(page.getByRole('button', { name: 'Sunt client' })).toBeVisible();
  await expect(page.getByLabel('Numele service-ului')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sunt service' }).click();
  await expect(page.getByRole('button', { name: 'Sunt service' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Numele service-ului')).toBeVisible();
  await expect(page.getByLabel('Oraș')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'auth-signup-shop-ro', name());

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByText('Car service booking, no phone calls')).toBeVisible();
  await expect(page.getByRole('button', { name: "I'm a shop" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  await shot(page, 'auth-signup-shop-en', name());
  await page.getByRole('tab', { name: 'Sign in' }).click();
  await expect(page.getByRole('checkbox', { name: 'Keep me signed in' })).toBeChecked();
  await shot(page, 'auth-signin-en', name());
});

test('sign-up refuses missing data with a specific message per field', async ({ page }) => {
  await page.goto('/cont-nou');
  await page.getByRole('button', { name: 'Creează cont' }).click();
  await expect(page.getByText('Alege dacă ești client sau service.')).toBeVisible();
  await expect(page.getByText('Scrie numele.')).toBeVisible();
  await expect(page.getByText('Număr de telefon invalid. Exemplu: 0723 375 248.')).toBeVisible();
  await expect(page.getByText('Adresa de email nu pare corectă.')).toBeVisible();
  await expect(page.getByText('Parola trebuie să aibă cel puțin 8 caractere.')).toBeVisible();
  await expect(page.getByText('Ca să creezi contul, trebuie să accepți Termenii și Politica de confidențialitate.')).toBeVisible();
  await shot(page, 'auth-signup-errors', name());

  // A shop without a city.
  await page.getByRole('button', { name: 'Sunt service' }).click();
  await page.getByLabel('Nume și prenume').fill('Ion Popescu');
  await page.getByLabel('Numele service-ului').fill('Atelier Nou');
  await page.getByLabel('Telefon').fill('0723 375 248');
  await page.getByLabel('Email').fill('ion@example.com');
  await page.getByLabel('Parolă', { exact: true }).fill('parolalunga1');
  await expect(page.getByText('Parolă medie')).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Creează cont' }).click();
  await expect(page.getByText('Scrie orașul service-ului.')).toBeVisible();
  await expect(page.getByLabel('Oraș')).toBeFocused();
  await expect(page.getByText('Scrie numele.')).toHaveCount(0);
});

test('the terms open as a screen of their own and the form keeps what was typed', async ({ page }) => {
  await page.goto('/cont-nou');
  await page.getByLabel('Nume și prenume').fill('Maria Pop');
  await page.getByRole('button', { name: 'Termenii și condițiile' }).click();
  await expect(page).toHaveURL(/\/cont-nou\?document=termeni$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Termeni și condiții' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1. Ce este Service-Hub' })).toBeVisible();
  // Nothing of the form under the document, even at the very end of it.
  await expect(page.getByLabel('Nume și prenume')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Creează cont' })).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Cont nou' })).toBeHidden();
  await expectNoHorizontalScroll(page);
  await shot(page, 'auth-terms-screen', name());
  await page.getByRole('button', { name: 'Înapoi la formular' }).last().click();
  await expect(page).toHaveURL(/\/cont-nou$/);
  await expect(page.getByLabel('Nume și prenume')).toHaveValue('Maria Pop');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('checkbox')).toBeFocused();

  // The phone's Back gesture closes the document too, and the form is still filled in.
  await page.getByRole('button', { name: 'Politica de confidențialitate' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Politica de confidențialitate' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/cont-nou$/);
  await expect(page.getByLabel('Nume și prenume')).toHaveValue('Maria Pop');
});

test('legal documents are public, with tables and headings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Politica de confidențialitate' }).click();
  await expect(page).toHaveURL(/\/legal\/confidentialitate$/);
  await expect(page.getByRole('table').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'legal-privacy', name());
  // The operator's data: the contact from the landing page, a visible mark for what is not filled in yet.
  await expect(page.getByText('contact@service-hub.ro').first()).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '7. Your rights' })).toBeVisible();
  await expect(page.getByText('Your position is used only on your device')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'legal-privacy-en', name());
  await page.goto('/legal/cookies');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/cookie/i);
  await expect(page.getByRole('cell', { name: 'sh_lang' })).toBeVisible();
  await page.getByRole('button', { name: 'Română' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '2. Ce păstrăm în browser' })).toBeVisible();
  await page.goto('/legal/termeni');
  await expect(page.getByRole('heading', { level: 2, name: '3. Pentru Clienți' })).toBeVisible();
  await shot(page, 'legal-terms', name());
});

test('forgot password checks the address before sending', async ({ page }) => {
  await page.goto('/intra');
  await page.getByLabel('Email').fill('nu-e-email');
  await page.getByRole('link', { name: 'Ai uitat parola?' }).click();
  await expect(page).toHaveURL(/\/parola-uitata$/);
  await expect(page.getByLabel('Email')).toHaveValue('nu-e-email');
  await page.getByRole('button', { name: 'Trimite linkul' }).click();
  await expect(page.getByText('Adresa de email nu pare corectă.')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'auth-forgot', name());
});

test('a reset link that is missing or expired says so', async ({ page }) => {
  await page.goto('/parola-noua');
  await expect(page.getByText('Linkul de resetare a expirat sau a fost deja folosit. Cere unul nou.')).toBeVisible();
  await page.getByRole('link', { name: 'Cere alt link' }).click();
  await expect(page).toHaveURL(/\/parola-uitata$/);
});

// ------------------------------------------------------------------------------------ with the local Supabase stack

test.describe('with accounts', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  async function confirmFromEmail(page: Page, email: string) {
    const { link } = await latestEmail(email, /confirm/i);
    expect(link).toContain('/auth/v1/verify');
    await page.goto(link);
  }

  test('client: sign up, confirm the email, land on Caută, see the account ID', async ({ page }) => {
    const email = uniqueEmail('client-ui');
    await page.goto('/cont-nou');
    await page.getByRole('button', { name: 'Sunt client' }).click();
    await page.getByLabel('Nume și prenume').fill('Andreea Ionescu');
    await page.getByLabel('Telefon').fill('0723 375 248');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Parolă', { exact: true }).fill(PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Creează cont' }).click();

    await expect(page).toHaveURL(/\/confirma-email$/);
    await expect(page.getByText(`Ți-am trimis un link de confirmare la ${email}.`, { exact: false })).toBeVisible();
    await shot(page, 'auth-check-email', name());
    // "Retrimite" waits 60 s after the first email.
    await expect(page.getByRole('button', { name: /Retrimite emailul în \d+ s/ })).toBeDisabled();

    // Before confirming, signing in explains what is missing.
    await signIn(page, email, PASSWORD);
    await expect(page.getByText(`Adresa ${email} nu e confirmată încă.`, { exact: false })).toBeVisible();
    await page.evaluate(() => localStorage.removeItem('sh_email_log')); // skip the 60 s wait
    await page.waitForTimeout(1100); // the local Auth server allows one email per second
    await page.getByRole('button', { name: 'Retrimite emailul' }).click();
    await expect(page.getByText(`Ți-am trimis un link nou la ${email}.`)).toBeVisible();
    await expect(page.getByRole('button', { name: /Retrimite emailul în \d+ s/ })).toBeDisabled();
    await shot(page, 'auth-unconfirmed', name());

    await confirmFromEmail(page, email);
    await expect(page).toHaveURL(/\/c\/cauta$/);
    await openAccount(page);
    await expect(page.getByText('Cont de client')).toBeVisible();
    await expect(page.getByText('Andreea Ionescu')).toBeVisible();
    await expect(page.getByText('0723 375 248')).toBeVisible();
    await expect(page.getByText(/^C-\d{5}$/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 'account-client', name());
  });

  test('shop: sign up with shop name and city, land on Panou', async ({ page }) => {
    const email = uniqueEmail('shop-ui');
    await page.goto('/cont-nou');
    await page.getByRole('button', { name: 'Sunt service' }).click();
    await page.getByLabel('Nume și prenume').fill('Ion Popescu');
    await page.getByLabel('Numele service-ului').fill('Atelier Nou');
    await page.getByLabel('Oraș').fill('Codlea');
    await page.getByLabel('Telefon').fill('0268 312 445');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Parolă', { exact: true }).fill(PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Creează cont' }).click();
    await expect(page).toHaveURL(/\/confirma-email$/);
    await confirmFromEmail(page, email);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await openAccount(page);
    await expect(page.getByText('Cont de service')).toBeVisible();
    await expect(page.getByText('Atelier Nou · Codlea')).toBeVisible();
    await expect(page.getByText(/^S-\d{5}$/)).toBeVisible();
    await shot(page, 'account-shop', name());
  });

  test('an address that already has an account is refused clearly', async ({ page }) => {
    await page.goto('/cont-nou');
    await page.getByRole('button', { name: 'Sunt client' }).click();
    await page.getByLabel('Nume și prenume').fill('Andrei Marin');
    await page.getByLabel('Telefon').fill('0723 375 248');
    await page.getByLabel('Email').fill(SEED.client);
    await page.getByLabel('Parolă', { exact: true }).fill(PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Creează cont' }).click();
    await expect(page.getByText('Există deja un cont cu acest email. Intră în cont sau resetează parola.')).toBeVisible();
  });

  test('wrong password: specific message, no pointless "Încearcă din nou"', async ({ page }) => {
    await signIn(page, SEED.client, 'parola-gresita');
    await expect(page.getByText('Email sau parolă greșită.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Încearcă din nou' })).toHaveCount(0);
    await shot(page, 'auth-wrong-password', name());
  });

  test('"Ține-mă minte" ticked keeps the session after the browser closes; unticked does not', async ({ page, browser }) => {
    const reopen = async (from: Page) => {
      // A browser restart keeps localStorage and cookies, never sessionStorage.
      const state = await from.context().storageState();
      const context = await browser.newContext({ storageState: state, baseURL: test.info().project.use.baseURL });
      const reopened = await context.newPage();
      await reopened.goto('/c/cauta');
      return { context, reopened };
    };

    const kept = await createUser('client');
    await signIn(page, kept, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta$/);
    const a = await reopen(page);
    await expect(a.reopened).toHaveURL(/\/c\/cauta$/);
    await a.context.close();

    await page.context().clearCookies();
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('sb-')) localStorage.removeItem(key);
    });
    const once = await createUser('client');
    await signIn(page, once, PASSWORD, { remember: false });
    await expect(page).toHaveURL(/\/c\/cauta$/);
    await page.reload(); // same tab: still signed in
    await expect(page).toHaveURL(/\/c\/cauta$/);
    const b = await reopen(page);
    await expect(b.reopened).toHaveURL(/\/intra$/);
    await b.context.close();
  });

  test('password reset: neutral answer, link, new password, signed in', async ({ page }) => {
    const email = await createUser('shop');
    await page.goto('/parola-uitata');
    await page.getByLabel('Email').fill(uniqueEmail('nimeni'));
    await page.getByRole('button', { name: 'Trimite linkul' }).click();
    const neutral = page.getByText('Dacă adresa există, ți-am trimis un link de resetare.');
    await expect(neutral).toBeVisible();

    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Trimite linkul' }).click();
    await expect(neutral).toBeVisible();
    await shot(page, 'auth-forgot-sent', name());

    const { link } = await latestEmail(email, /reset/i);
    await page.goto(link);
    await expect(page).toHaveURL(/\/parola-noua/);
    await page.getByLabel('Parola nouă', { exact: true }).fill('scurta');
    await page.getByRole('button', { name: 'Salvează parola' }).click();
    await expect(page.getByText('Parola trebuie să aibă cel puțin 8 caractere.')).toBeVisible();
    await page.getByLabel('Parola nouă', { exact: true }).fill('Alta-Parola-2026!');
    await page.getByLabel('Repetă parola nouă').fill('Alta-Parola-2026?');
    await page.getByRole('button', { name: 'Salvează parola' }).click();
    await expect(page.getByText('Parolele nu sunt la fel.')).toBeVisible();
    await page.getByLabel('Repetă parola nouă').fill('Alta-Parola-2026!');
    await shot(page, 'auth-new-password', name());
    await page.getByRole('button', { name: 'Salvează parola' }).click();
    await expect(page).toHaveURL(/\/s\/panou$/);

    // The new password works.
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(() => localStorage.setItem('sh_lang', 'ro'));
    await signIn(page, email, 'Alta-Parola-2026!');
    await expect(page).toHaveURL(/\/s\/panou$/);
  });

  test('Cont: name and phone, language saved on the profile, legal documents, data export', async ({ page, browser }) => {
    const email = await createUser('client');
    await signIn(page, email, PASSWORD);
    await openAccount(page);

    await page.getByRole('button', { name: 'Editează numele și telefonul' }).click();
    await page.getByLabel('Nume și prenume').fill('Maria Pop-Ionescu');
    await page.getByLabel('Telefon').fill('123');
    await page.getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(page.getByText('Număr de telefon invalid. Exemplu: 0723 375 248.')).toBeVisible();
    await page.getByLabel('Telefon').fill('0744 123 456');
    await page.getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(page.getByText('Maria Pop-Ionescu')).toBeVisible();
    await expect(page.getByText('0744 123 456')).toBeVisible();

    // Legal document inside Cont, with a way back.
    await page.getByRole('link', { name: 'Politica de cookies' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Politica de cookies' })).toBeVisible();
    await shot(page, 'account-legal', name());
    await page.getByRole('link', { name: 'Cont', exact: true }).filter({ visible: true }).first().click();

    // Export.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descarcă datele mele' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^service-hub-C-\d{5}-\d{4}-\d{2}-\d{2}\.json$/);
    const body = JSON.parse(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()));
    expect(body.account.name).toBe('Maria Pop-Ionescu');
    expect(body.account.email).toBe(email);

    // Language: saved on the profile, so it follows the account to another browser.
    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
    await shot(page, 'account-client-en', name());
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: page.viewportSize() });
    await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const other = await context.newPage();
    await signIn(other, email, PASSWORD);
    await expect(other.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
    await context.close();
  });

  test('Cont: change password (wrong current refused), change email and cancel it', async ({ page }) => {
    const email = await createUser('shop');
    await signIn(page, email, PASSWORD);
    await openAccount(page);

    await page.getByRole('button', { name: 'Schimbă parola' }).click();
    await page.getByLabel('Parola actuală').fill('nu-e-asta');
    await page.getByLabel('Parola nouă', { exact: true }).fill('Parola-Buna-2027');
    await page.getByLabel('Repetă parola nouă').fill('Parola-Buna-2027');
    await page.getByRole('button', { name: 'Salvează parola nouă' }).click();
    await expect(page.getByText('Parola actuală nu e corectă.')).toBeVisible();
    await shot(page, 'account-password-wrong', name());
    await page.getByLabel('Parola actuală').fill(PASSWORD);
    await page.getByRole('button', { name: 'Salvează parola nouă' }).click();
    await expect(page.getByText('Parola a fost schimbată.')).toBeVisible();

    const next = uniqueEmail('nou');
    await page.getByRole('button', { name: 'Schimbă emailul' }).click();
    await page.getByLabel('Emailul nou').fill(email);
    await page.getByRole('button', { name: 'Trimite verificarea' }).click();
    await expect(page.getByText('Aceasta e adresa pe care o folosești deja.')).toBeVisible();
    await page.getByLabel('Emailul nou').fill(next);
    await page.getByRole('button', { name: 'Trimite verificarea' }).click();
    await expect(page.getByText(`Verificare trimisă la ${next}.`, { exact: false })).toBeVisible();
    await shot(page, 'account-email-pending', name());
    await latestEmail(next, /email/i);
    await page.getByRole('button', { name: 'Anulează schimbarea' }).click();
    await expect(page.getByRole('button', { name: 'Schimbă emailul' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  test('delete account: refused with active bookings; otherwise gone for good', async ({ page }) => {
    // The seed client has active bookings.
    await signIn(page, SEED.client, SEED_PASSWORD);
    await openAccount(page);
    await page.getByRole('button', { name: 'Șterge contul' }).click();
    const confirm = page.getByRole('button', { name: 'Șterge definitiv' });
    await expect(confirm).toBeDisabled();
    await page.getByText('Înțeleg că ștergerea e definitivă').click();
    await shot(page, 'account-delete-confirm', name());
    await confirm.click();
    await expect(page.getByText('Ai programări active.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Renunță' }).click();
    await expect(page.getByRole('button', { name: 'Șterge definitiv' })).toHaveCount(0);

    // A fresh client with nothing active.
    const email = await createUser('client');
    await page.context().clearCookies();
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('sb-')) localStorage.removeItem(key);
    });
    await signIn(page, email, PASSWORD);
    await openAccount(page);
    await page.getByRole('button', { name: 'Șterge contul' }).click();
    await page.getByText('Înțeleg că ștergerea e definitivă').click();
    await page.getByRole('button', { name: 'Șterge definitiv' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Contul tău a fost șters.')).toBeVisible();
    await signIn(page, email, PASSWORD);
    await expect(page.getByText('Email sau parolă greșită.')).toBeVisible();
  });

  test('admin: Cont without account deletion', async ({ page }) => {
    await signIn(page, SEED.admin, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\/prezentare$/);
    await openAccount(page);
    await expect(page.getByText('Cont de administrator')).toBeVisible();
    await expect(page.getByText(/^A-\d{5}$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Șterge contul' })).toHaveCount(0);
    await shot(page, 'account-admin', name());
  });

  test('session ended mid-edit: sign in again without losing what was typed', async ({ page }) => {
    const email = await createUser('client');
    await signIn(page, email, PASSWORD);
    await openAccount(page);
    await page.getByRole('button', { name: 'Editează numele și telefonul' }).click();
    await page.getByLabel('Nume și prenume').fill('Nume scris înainte');

    // The session is revoked elsewhere and the access token runs out.
    const key = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token')));
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k!)!), key);
    await revokeSessions(stored.access_token);
    await page.evaluate(
      ([k, value]) => localStorage.setItem(k!, value!),
      [key, JSON.stringify({ ...stored, expires_at: Math.floor(Date.now() / 1000) - 10 })],
    );
    // What the browser does when the tab comes back to the front.
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

    const panel = page.getByRole('dialog', { name: 'Sesiunea a expirat' });
    await expect(panel).toBeVisible({ timeout: 40_000 });
    await expect(panel.getByLabel('Email')).toHaveValue(email);
    await shot(page, 'session-expired', name());
    await panel.getByLabel('Parolă', { exact: true }).fill(PASSWORD);
    await panel.getByRole('button', { name: 'Intră în cont' }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByLabel('Nume și prenume')).toHaveValue('Nume scris înainte');
    if (!isDesktop(page)) await expect(page.getByRole('navigation', { name: 'Navigare principală' })).toBeVisible();
  });
});
