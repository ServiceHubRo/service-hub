import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  createUser,
  expectNoHorizontalScroll,
  latestEmail,
  openAccount,
  scrollTopOf,
  shot,
  signIn,
  uniqueEmail,
  verifyPhoneByAdmin,
} from './support';

// T05 — shop settings, the first-run checklist on Panou, staff invitations.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const name = () => test.info().project.name;

/** YYYY-MM-DD, n days from today (Bucharest). */
function inDays(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(d);
}

async function openSettings(page: Page, tile: string) {
  await openAccount(page);
  await page.getByRole('link', { name: /Setări service/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Setări service' })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(tile) }).click();
}

/** Clicks something that is already on screen and checks the page did not jump. */
async function clickInPlace(page: Page, target: ReturnType<Page['getByRole']>) {
  await target.scrollIntoViewIfNeeded();
  const before = await scrollTopOf(page);
  await target.click();
  expect(await scrollTopOf(page)).toBe(before);
}

test.describe('shop settings', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('new shop: the four steps, services, hours, days off, capacity and fee; the page never jumps', async ({ page }) => {
    const email = await createUser('shop');
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);

    // Panou: checklist 0 of 4 and why the shop is not in search.
    await expect(page.getByRole('heading', { name: 'Pune service-ul pe picioare' })).toBeVisible();
    await expect(page.getByText('0 din 4', { exact: true })).toBeVisible();
    await expect(page.getByText('Service-ul tău nu apare încă în căutări.')).toBeVisible();
    await expect(page.getByText('Alege cel puțin un serviciu.')).toBeVisible();
    await expect(page.getByText(/^Îți trimitem un cod de 6 cifre prin SMS la 07\d{2} \d{3} \d{3}\.$/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't05-panou-new', name());

    // 1. Services: search without diacritics, tick, page stays put, save.
    await page.getByRole('link', { name: /Alege serviciile pe care le faci/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Servicii oferite' })).toBeVisible();
    await expect(page.getByText('Selectate: 0 din 150')).toBeVisible();
    await clickInPlace(page, page.getByRole('checkbox', { name: 'Lamele ștergătoare' }));
    await clickInPlace(page, page.getByRole('checkbox', { name: 'Schimb ulei + filtru ulei' }));
    await expect(page.getByText('Selectate: 2 din 150')).toBeVisible();
    await page.getByLabel('Caută un serviciu').fill('frane');
    await expect(page.getByRole('checkbox', { name: 'Plăcuțe de frână' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Schimb ulei + filtru ulei' })).toHaveCount(0);
    await page.getByLabel('Caută un serviciu').fill('xyz nimic');
    await expect(page.getByText('Niciun serviciu nu se potrivește cu „xyz nimic”.')).toBeVisible();
    await page.getByRole('button', { name: 'Șterge căutarea' }).click();
    await page.getByLabel('Caută un serviciu').fill('frâne');
    const brakes = await page.getByRole('checkbox').count();
    await page.getByRole('button', { name: 'Alege tot' }).click();
    await expect(page.getByText(`Selectate: ${brakes + 2} din 150`)).toBeVisible();
    await page.getByRole('button', { name: 'Scoate tot' }).click();
    await expect(page.getByText('Selectate: 2 din 150')).toBeVisible();
    await clickInPlace(page, page.getByRole('checkbox', { name: 'Plăcuțe de frână' }));
    await expect(page.getByText('Ai modificări nesalvate.')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't05-services', name());
    await page.getByRole('button', { name: 'Salvează serviciile' }).click();
    await expect(page.getByRole('button', { name: '✓ Salvat' })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Selectate: 3 din 150')).toBeVisible();

    // 2. Hours: short Saturday, 09:00–13:00.
    await page.getByRole('link', { name: 'Setări service' }).click();
    await page.getByRole('link', { name: /Program și zile libere/ }).click();
    const saturday = page.getByRole('group', { name: 'Sâmbătă' });
    await clickInPlace(page, saturday.getByRole('checkbox', { name: 'Închis' }));
    await expect(saturday.getByText('08:00')).toBeVisible();
    for (let i = 0; i < 2; i++) await clickInPlace(page, saturday.getByRole('button', { name: 'Sâmbătă · Crește: Deschide' }));
    for (let i = 0; i < 8; i++) await clickInPlace(page, saturday.getByRole('button', { name: 'Sâmbătă · Scade: Închide' }));
    await expect(saturday.getByText('09:00')).toBeVisible();
    await expect(saturday.getByText('13:00')).toBeVisible();
    await page.getByRole('button', { name: 'Salvează programul' }).click();
    await expect(page.getByRole('button', { name: '✓ Salvat' })).toBeVisible();

    // Days off: 3 days, then edit the label, then it stays after a reload.
    await page.getByRole('button', { name: 'Adaugă zile libere' }).click();
    await page.getByLabel('De la').fill(inDays(10));
    await page.getByLabel('Până la (inclusiv)').fill(inDays(12));
    await page.getByLabel('Motiv (opțional)').fill('Concediu');
    await page.getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(page.getByText('3 zile · Concediu')).toBeVisible();
    await page.getByRole('button', { name: 'Adaugă zile libere' }).click();
    await page.getByLabel('De la').fill(inDays(20));
    await page.getByLabel('Până la (inclusiv)').fill(inDays(19));
    await page.getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(page.getByText('Data de sfârșit este înaintea celei de început.')).toBeVisible();
    await page.getByRole('button', { name: 'Renunță' }).click();
    await expectNoHorizontalScroll(page);
    await shot(page, 't05-hours', name());
    await page.reload();
    await expect(page.getByRole('group', { name: 'Sâmbătă' }).getByText('13:00')).toBeVisible();
    await expect(page.getByText('3 zile · Concediu')).toBeVisible();

    // 3. Rules: 6 cars a day, inspection fee 80 lei.
    await page.getByRole('link', { name: 'Setări service' }).click();
    await page.getByRole('link', { name: /Reguli de programare/ }).click();
    await clickInPlace(page, page.getByRole('button', { name: 'Crește: Comenzi pe zi' }));
    await expect(page.locator('#capacitate output')).toHaveText('6');
    await page.getByLabel('Suma (lei)').fill('8o');
    await page.getByRole('button', { name: 'Salvează regulile' }).click();
    await expect(page.getByText('Scrie o sumă între 0 și 10.000 lei.')).toBeVisible();
    await page.getByLabel('Suma (lei)').fill('80');
    await page.getByRole('button', { name: 'Salvează regulile' }).click();
    await expect(page.getByRole('button', { name: '✓ Salvat' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't05-rules', name());

    // Panou: 3 of 4, phone not confirmed. After the manual phone check (SMS: email-sms.spec): checklist gone, shop visible.
    await page.getByRole('link', { name: 'Panou' }).filter({ visible: true }).first().click();
    await expect(page.getByText('3 din 4', { exact: true })).toBeVisible();
    await expect(page.getByText('Service-ul tău nu apare încă în căutări.')).toBeVisible();
    await expect(page.getByText('Mașini pe zi: 6')).toBeVisible();
    await verifyPhoneByAdmin(email);
    await page.reload();
    await expect(page.getByText('Mașini pe zi: 6')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pune service-ul pe picioare' })).toHaveCount(0);
    await expect(page.getByText('Service-ul tău nu apare încă în căutări.')).toHaveCount(0);
    await shot(page, 't05-panou-done', name());

    // "Mașini pe zi" goes straight to the capacity stepper.
    await page.getByRole('link', { name: /Mașini pe zi: 6/ }).click();
    await expect(page).toHaveURL(/\/s\/cont\/setari\/reguli#capacitate$/);
    await expect(page.locator('#capacitate')).toBeInViewport();
  });

  test('public profile and billing: validation, "Copiază adresa atelierului", saved values', async ({ page }) => {
    const email = await createUser('shop');
    await signIn(page, email, PASSWORD);
    await openSettings(page, 'Profil public');
    await expect(page.getByRole('heading', { level: 1, name: 'Profil public' })).toBeVisible();
    await page.getByLabel('Stradă și număr').fill('Str. Lungă 42');
    await page.getByLabel('Județ').fill('Brașov');
    await page.getByLabel('Cod poștal').fill('50005');
    await page.getByLabel('Site (opțional)').fill('atelier');
    await page.getByRole('button', { name: 'Salvează profilul' }).click();
    await expect(page.getByText('Codul poștal are exact 6 cifre.')).toBeVisible();
    await expect(page.getByText('Adresa nu pare corectă. Exemplu: www.atelier.ro')).toBeVisible();
    await page.getByLabel('Cod poștal').fill('500059');
    await page.getByLabel('Site (opțional)').fill('www.atelier-test.ro');
    await page.getByLabel('Descriere scurtă').fill('Service auto multimarcă.');
    await page.getByRole('button', { name: 'Salvează profilul' }).click();
    await expect(page.getByRole('button', { name: '✓ Salvat' })).toBeVisible();
    // The map lookup answers one way or another (the test stack may have no internet).
    await expect(page.getByText(/Am găsit|Nu am găsit|Harta nu răspunde/)).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalScroll(page);
    await shot(page, 't05-profile', name());
    await page.reload();
    await expect(page.getByLabel('Site (opțional)')).toHaveValue('https://www.atelier-test.ro');

    await page.getByRole('link', { name: 'Setări service' }).click();
    await page.getByRole('link', { name: /Date de facturare/ }).click();
    await expect(page.getByText('Nu este obligatoriu acum.', { exact: false })).toBeVisible();
    await page.getByLabel('Denumire legală').fill('AUTO TEST S.R.L.');
    await page.getByLabel('CUI / Cod fiscal').fill('14872302');
    await page.getByLabel('Nr. Registrul Comerțului').fill('J08/1234/2015');
    await page.getByLabel('IBAN').fill('RO49AAAA1B31007593840001');
    await page.getByRole('button', { name: 'Salvează datele de facturare' }).click();
    await expect(page.getByText('CUI invalid. Verifică cifrele (ex. RO14872301).')).toBeVisible();
    await expect(page.getByText('IBAN invalid.', { exact: false })).toBeVisible();
    await expect(page.getByLabel('CUI / Cod fiscal')).toBeFocused();
    await page.getByLabel('CUI / Cod fiscal').fill('RO14872301');
    await page.getByLabel('IBAN').fill('RO49 AAAA 1B31 0075 9384 0000');
    await page.getByRole('button', { name: 'Copiază adresa atelierului' }).click();
    await expect(page.getByLabel('Sediul social')).toHaveValue('Str. Lungă 42, Brașov, Brașov');
    await page.getByRole('button', { name: 'Da', exact: true }).click();
    await page.getByRole('button', { name: 'Salvează datele de facturare' }).click();
    await expect(page.getByRole('button', { name: '✓ Salvat' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't05-billing', name());
    await page.reload();
    await expect(page.getByLabel('IBAN')).toHaveValue('RO49AAAA1B31007593840000');
    await expect(page.getByLabel('CUI / Cod fiscal')).toHaveValue('RO14872301');
    await expect(page.getByRole('button', { name: 'Da', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('staff: invitation link, sign-up through it, same shop without billing; removal', async ({ page, browser }) => {
    const owner = await createUser('shop');
    await signIn(page, owner, PASSWORD);
    await openSettings(page, 'Personal');
    await expect(page.getByText('Proprietar')).toBeVisible();

    const colleague = uniqueEmail('coleg');
    await page.getByLabel('Emailul colegului').fill('nu-e-email');
    await page.getByRole('button', { name: 'Trimite invitația' }).click();
    await expect(page.getByText('Adresa de email nu pare corectă.')).toBeVisible();
    await page.getByLabel('Emailul colegului').fill(colleague);
    await page.getByRole('button', { name: 'Trimite invitația' }).click();
    const linkField = page.getByLabel('Linkul de invitație');
    await expect(linkField).toHaveValue(/\/invitatie\/[0-9a-f]{64}$/);
    await expect(page.getByText(/Invitat .*, încă fără cont/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't05-staff-invited', name());
    const link = new URL(await linkField.inputValue()).pathname;

    // The colleague opens the link signed out and creates the account.
    const other = await browser.newContext({ viewport: page.viewportSize()!, locale: 'ro-RO' });
    const guest = await other.newPage();
    await guest.goto(link);
    await expect(guest.getByRole('heading', { name: 'Invitație în echipă' })).toBeVisible();
    await expect(guest.getByText(/Atelier Test din Brașov te-a invitat/)).toBeVisible();
    await expect(guest.getByLabel('Email')).toHaveValue(colleague);
    await expect(guest.getByLabel('Numele service-ului')).toHaveCount(0);
    await expectNoHorizontalScroll(guest);
    await shot(guest, 't05-invite', name());
    await guest.getByLabel('Nume și prenume').fill('Mihai Coleg');
    await guest.getByLabel('Telefon').fill('0723 111 222');
    await guest.getByLabel('Parolă', { exact: true }).fill(PASSWORD);
    await guest.getByLabel('Repetă parola').fill(PASSWORD);
    await guest.getByRole('checkbox').check();
    await guest.getByRole('button', { name: 'Creează cont' }).click();
    await expect(guest).toHaveURL(/\/confirma-email$/);
    const { link: confirm } = await latestEmail(colleague, /confirm/i);
    await guest.goto(confirm);
    await expect(guest).toHaveURL(/\/s\/panou$/);
    await openAccount(guest);
    await expect(guest.getByText('Atelier Test · Brașov')).toBeVisible();
    // A colleague works with bookings, quotes, messages and the history; the settings are the owner's.
    await guest.getByRole('link', { name: /Setări service/ }).click();
    await expect(guest.getByText(/^Programul, serviciile, regulile, taxa de constatare și profilul public le schimbă proprietarul/)).toBeVisible();
    await expect(guest.getByRole('link', { name: /Notificări/ })).toBeVisible();
    for (const section of [/Program și zile libere/, /Servicii oferite/, /Date de facturare/, /Personal/]) {
      await expect(guest.getByRole('link', { name: section })).toHaveCount(0);
    }
    await expectNoHorizontalScroll(guest);
    await shot(guest, 'staff-settings', name());
    for (const path of ['facturare', 'program', 'servicii', 'reguli', 'profil']) {
      await guest.goto(`/s/cont/setari/${path}`);
      await expect(guest.getByText('Doar proprietarul service-ului vede această secțiune.')).toBeVisible();
    }
    await guest.goto('/s/cont/setari/notificari');
    await expect(guest.getByText('SMS-ul la cerere nouă și rezumatul zilnic le alege proprietarul service-ului.')).toBeVisible();
    await expect(guest.getByRole('checkbox')).toHaveCount(0);
    // Istoric: the jobs, no total of the takings, no CSV; Recenzii: read, no reply.
    await guest.goto('/s/istoric');
    await expect(guest.getByRole('heading', { level: 1, name: 'Istoric reparații' })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Descarcă istoricul' })).toHaveCount(0);
    await expect(guest.getByText(/încasat/)).toHaveCount(0);
    await guest.goto('/s/cont/recenzii');
    await expect(guest.getByText('Răspunsurile la recenzii și raportările le face proprietarul service-ului.')).toBeVisible();
    await expect(guest.getByRole('button', { name: /Răspunde|Raportează/ })).toHaveCount(0);

    // A used link says so.
    const third = await (await browser.newContext({ locale: 'ro-RO' })).newPage();
    await third.goto(link);
    await expect(third.getByText(/Linkul nu mai este valabil/)).toBeVisible();

    // The owner sees the colleague and removes them.
    await page.reload();
    await expect(page.getByText('Mihai Coleg')).toBeVisible();
    await page.getByRole('button', { name: 'Elimină' }).click();
    await expect(page.getByText('Elimini pe Mihai Coleg din echipă?', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Da, elimină' }).click();
    await expect(page.getByText('Mihai Coleg')).toHaveCount(0);
    await guest.goto('/s/panou');
    await expect(guest.getByText('Contul tău nu mai este legat de niciun service.', { exact: false })).toBeVisible();
    await other.close();
  });

  test('English: Panou and settings', async ({ page }) => {
    const email = await createUser('shop', { lang: 'en' });
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await expect(page.getByRole('heading', { name: 'Get your shop up and running' })).toBeVisible();
    await expect(page.getByText('0 of 4', { exact: true })).toBeVisible();
    await expect(page.getByText("Your shop doesn't appear in search yet.")).toBeVisible();
    await shot(page, 't05-panou-en', name());
    await page.getByRole('link', { name: /Check your opening hours/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Hours and days off' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Monday' }).getByText('08:00')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't05-hours-en', name());
    await page.getByRole('link', { name: 'Shop settings' }).click();
    await page.getByRole('link', { name: /Booking rules/ }).click();
    await expect(page.getByText('Cars per day', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Minimum notice')).toHaveValue('2');
    await expect(page.getByLabel('Minimum notice').locator('option:checked')).toHaveText('2 hours');
    await shot(page, 't05-rules-en', name());
  });
});

test('an unknown invitation link says it is not valid', async ({ page }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  await page.goto(`/invitatie/${'0'.repeat(64)}`);
  await expect(page.getByText(/Linkul nu mai este valabil/)).toBeVisible();
});
