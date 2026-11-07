// A company for the fleet browser tests (T72–T77, P1): admin, manager, accountant, a driver of one vehicle.
import { expect, type Browser, type Page } from '@playwright/test';
import { PASSWORD, createFleetUser, rpcAs, serviceRest, signIn, uniquePlate, userIdOf } from './support';

export interface Fleet {
  admin: string;
  manager: string;
  driver: string;
  accountant: string;
  company: string;
  vehicle: string;
  plate: string;
}

const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

/** A company on Fleet Business: admin, manager, accountant, a driver assigned to one vehicle. */
export async function fleetSetup(): Promise<Fleet> {
  const [admin, manager, driver, accountant] = await Promise.all([createFleetUser(), createFleetUser(), createFleetUser(), createFleetUser()]);
  const company = await rpcAs<{ id: string }>(admin, 'create_company', {
    p_name: `Etape ${Date.now()}`,
    p_vat_id: null,
    p_reg_com: null,
    p_address: null,
    p_request_id: crypto.randomUUID(),
  });
  for (const [email, role] of [
    [manager, 'manager'],
    [driver, 'driver'],
    [accountant, 'accountant'],
  ] as const) {
    const tk = token();
    await rpcAs(admin, 'invite_company_member', { p_company: company.id, p_email: email, p_role: role, p_token: tk, p_request_id: crypto.randomUUID() });
    await rpcAs(email, 'accept_company_invite', { p_token: tk, p_request_id: crypto.randomUUID() });
  }
  const plate = uniquePlate('B');
  const vehicle = await rpcAs<{ id: string }>(admin, 'fleet_save_vehicle', {
    p_company: company.id,
    p_vehicle: null,
    p_fields: { make: 'Dacia', model: 'Logan', plate },
    p_request_id: crypto.randomUUID(),
  });
  const members = await serviceRest<{ id: string }[]>(`company_members?company_id=eq.${company.id}&role=eq.driver&select=id`, 'GET');
  await rpcAs(admin, 'fleet_assign_driver', { p_vehicle: vehicle.id, p_member: members[0]!.id, p_request_id: crypto.randomUUID() });
  await serviceRest(`company_subscriptions?company_id=eq.${company.id}`, 'PATCH', { plan_key: 'fleet_business' });
  return { admin, manager, driver, accountant, company: company.id, vehicle: vehicle.id, plate };
}

/** Signed in (the sign-in page in Romanian); the profile's language then applies, as on any device. */
export async function openAs(browser: Browser, email: string, lang: 'ro' | 'en', path: string): Promise<Page> {
  await serviceRest(`profiles?id=eq.${await userIdOf(email)}`, 'PATCH', { lang });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await page.goto(path);
  return page;
}
