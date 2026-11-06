import { expect, test } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  uniquePlate,
  userIdOf,
} from './support';

// T66 — one logical vehicle per owner: the garage refuses the same car twice (the plate written
// otherwise) and offers the car already there; a booking with the car typed in uses the garage car.
// The database rules, the merge and the admin's list are covered by tests/sql/141_vehicle_identity.sql.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const name = () => test.info().project.name;

test.describe('vehicle identity', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(90_000);

  test('Garaj: the same plate written otherwise is refused, with a way to the car already there', async ({ page }) => {
    const client = await createUser('client');
    const owner = await userIdOf(client);
    const plate = uniquePlate();
    const [car] = await serviceRest<{ id: string }[]>('cars', 'POST', { owner_id: owner, make: 'Dacia', model: 'Logan', year: 2019, plate });
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto('/c/garaj/nou');
    await page.getByLabel('Marcă').fill('Dacia');
    await page.getByLabel('Model', { exact: true }).fill('Logan');
    await page.getByLabel('Nr. înmatriculare').fill(plate.replace(/ /g, '-').toLowerCase());
    await page.getByRole('button', { name: 'Salvează' }).click();
    await expect(page.getByText('Mașina este deja în garaj.')).toBeVisible();
    const open = page.getByRole('link', { name: 'Deschide mașina din garaj' });
    await expect(open).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't66-car-duplicate', name());
    await open.click();
    await expect(page).toHaveURL(new RegExp(`/c/garaj/${car!.id}$`));
    await expect(page.getByLabel('Nr. înmatriculare')).toHaveValue(plate);

    const cars = await serviceRest<unknown[]>(`cars?owner_id=eq.${owner}&select=id`, 'GET');
    expect(cars).toHaveLength(1);
  });

  test('a booking with the car typed in and saved uses the garage car; the garage keeps one card', async ({ page }) => {
    const { shopId } = await createBookableShop(`Atelier T66 ${Date.now()}`, ['frane']);
    const client = await createUser('client');
    const owner = await userIdOf(client);
    const plate = uniquePlate();
    const [car] = await serviceRest<{ id: string }[]>('cars', 'POST', { owner_id: owner, make: 'Dacia', model: 'Logan', year: 2019, plate });
    const av = await rpcAs<{ days: { date: string; bookable: boolean }[] }>(client, 'get_availability', { p_shop_id: shopId, p_days: 30 });
    const day = av.days.find((d) => d.bookable)!.date;
    const slots = await rpcAs<{ slots: { time: string; available: boolean }[] }>(client, 'get_availability', {
      p_shop_id: shopId,
      p_from: day,
      p_days: 1,
      p_slots_for: day,
    });
    const booking = await rpcAs<{ id: string }>(client, 'create_booking', {
      p_shop_id: shopId,
      p_service_id: 'frane',
      p_date: day,
      p_slot: slots.slots.find((s) => s.available)!.time,
      p_request_id: crypto.randomUUID(),
      p_car: { make: 'Dacia', model: 'Logan', plate: plate.replace(/ /g, '') },
      p_save_car: true,
    });
    const [row] = await serviceRest<{ car_id: string }[]>(`bookings?id=eq.${booking.id}&select=car_id`, 'GET');
    expect(row!.car_id).toBe(car!.id);

    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto('/c/garaj');
    await expect(page.getByRole('link', { name: 'Editează Dacia Logan' })).toHaveCount(1);
    await expect(page.getByText('Aceeași mașină apare de două ori')).toHaveCount(0);
  });
});
