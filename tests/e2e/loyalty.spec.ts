import { expect, test } from "@playwright/test";
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  openAccount,
  serviceRest,
  shot,
  signIn,
  userIdOf,
} from "./support";

// T28c — loyal clients: the owner chooses a discount per level; a client with finished jobs on
// Service-Hub sees their level in Cont → Fidelitate, the discount on the search card, on the shop
// page and before booking; the booking keeps it, and the shop is reminded of it on the card.

const name = () => test.info().project.name;
const tag = () => `${Date.now() % 100000}${Math.floor(Math.random() * 100)}`;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("sh_test_init")) {
      sessionStorage.setItem("sh_test_init", "1");
      localStorage.setItem("sh_lang", "ro");
    }
  });
});

test.describe("loyal clients", () => {
  test.skip(!BACKEND, "needs the local Supabase stack");
  test.setTimeout(150_000);

  test("the owner sets the levels; a loyal client sees and keeps the discount", async ({
    page,
    browser,
  }) => {
    const shopName = `Atelier Fidel ${tag()}`;
    const { email: owner, shopId } = await createBookableShop(shopName, [
      "ulei",
    ]);

    // The owner: Reguli de programare → Reduceri pentru clienți fideli.
    await signIn(page, owner, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou/);
    await page.goto("/s/cont/setari/reguli");
    const l1 = page.getByRole("group", { name: "Nivelul 1 (de la 2 lucrări)" });
    const l2 = page.getByRole("group", { name: "Nivelul 2 (de la 5 lucrări)" });
    await expect(
      l1.getByRole("button", { name: "Fără reducere", pressed: true }),
    ).toBeVisible();
    await l1.getByRole("button", { name: "-5%" }).click();
    // Level 2 can never give less than level 1.
    await expect(
      l2.getByRole("button", { name: "-5%", exact: true }),
    ).toHaveCount(0);
    await expect(
      l2.getByRole("button", { name: "Ca la Nivelul 1 (-5%)", pressed: true }),
    ).toBeVisible();
    await l2.getByRole("button", { name: "-7%" }).click();
    await page.getByRole("button", { name: "Salvează regulile" }).click();
    await expect(page.getByRole("button", { name: "✓ Salvat" })).toBeVisible();
    await l2.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, "t28c-rules-loyalty", name());
    const [saved] = await serviceRest<
      { loyalty_l1: number; loyalty_l2: number }[]
    >(`shops?id=eq.${shopId}&select=loyalty_l1,loyalty_l2`, "GET");
    expect(saved).toEqual({ loyalty_l1: 5, loyalty_l2: 7 });

    // A client without finished jobs: no level yet, the shop's discounts explained.
    const client = await createUser("client");
    const clientId = await userIdOf(client);
    const context = await browser.newContext({
      viewport: page.viewportSize() ?? undefined,
    });
    await context.addInitScript(() => localStorage.setItem("sh_lang", "ro"));
    const c = await context.newPage();
    await signIn(c, client, PASSWORD);
    await expect(c).toHaveURL(/\/c\/cauta/);
    await openAccount(c);
    await c.getByRole("link", { name: /Fidelitate/ }).click();
    await expect(
      c.getByRole("heading", { level: 1, name: "Fidelitate" }),
    ).toBeVisible();
    await expect(c.getByText("Încă fără nivel")).toBeVisible();
    await expect(c.getByText("Încă 2 lucrări până la Nivelul 1")).toBeVisible();
    await c.goto(`/c/cauta?q=${encodeURIComponent(shopName)}`);
    const card = c.locator("main li").filter({ hasText: shopName });
    await expect(card).toContainText("Reduceri pentru clienți fideli");
    await card.getByRole("link").first().click();
    await expect(
      c.getByText(
        "-5% la manoperă de la 2 lucrări pe Service-Hub, -7% de la 5 lucrări.",
      ),
    ).toBeVisible();

    // Two finished jobs (anywhere on Service-Hub): Level 1.
    for (const daysAgo of [40, 90]) {
      const day = new Date(Date.now() - daysAgo * 86_400_000);
      await serviceRest("bookings", "POST", {
        shop_id: shopId,
        client_id: clientId,
        service_id: "ulei",
        client_name: "Ioana Pop",
        car_snapshot: {},
        date: day.toISOString().slice(0, 10),
        slot: "10:00",
        status: "done",
        done_at: day.toISOString(),
      });
    }
    await c.goto("/c/cont/fidelitate");
    await expect(c.getByText("Nivelul 1", { exact: true })).toBeVisible();
    await expect(
      c.getByText("Lucrări terminate în ultimii 2 ani: 2"),
    ).toBeVisible();
    await expect(c.getByText("Încă 3 lucrări până la Nivelul 2")).toBeVisible();
    await expect(
      c.getByRole("progressbar", { name: "Drumul până la Nivelul 2" }),
    ).toHaveAttribute("aria-valuenow", "2");
    await expectNoHorizontalScroll(c);
    await shot(c, "t28c-loyalty-screen", name());

    // Search card, shop page, step 4: the client's own discount.
    await c.goto(`/c/cauta?q=${encodeURIComponent(shopName)}`);
    await expect(card).toContainText("-5% la manoperă, client fidel");
    await shot(c, "t28c-search-card", name());
    await card.getByRole("link").first().click();
    await expect(
      c.getByText("ai -5% la manoperă aici.", { exact: false }),
    ).toBeVisible();
    await expectNoHorizontalScroll(c);
    await shot(c, "t28c-shop-page", name());
    await c.getByRole("link", { name: "Programează-te" }).click();
    await c.getByRole("button", { name: "Schimb ulei + filtru ulei" }).click();
    await c.getByRole("button", { name: /^Continuă/ }).click();
    await c
      .getByRole("button", { name: /: \d+ loc(uri)?$/ })
      .first()
      .click();
    await c
      .getByRole("button", { name: /^\d{2}:\d{2}$/, disabled: false })
      .first()
      .click();
    await c.getByLabel("Marcă").fill("Ford");
    await c.getByLabel("Model").fill("Focus");
    await expect(
      c.getByText(
        "Ca client fidel, ai -5% la manoperă la această programare.",
        { exact: false },
      ),
    ).toBeVisible();
    await expectNoHorizontalScroll(c);
    await shot(c, "t28c-step4", name());
    await c.getByRole("button", { name: "Trimite cererea" }).click();
    await expect(
      c.getByRole("heading", { level: 1, name: "Cerere trimisă" }),
    ).toBeVisible();
    await expect(c.getByText("Reducere de fidelitate")).toBeVisible();

    const [booking] = await serviceRest<
      { loyalty_percent: number; loyalty_level: number }[]
    >(
      `bookings?shop_id=eq.${shopId}&status=eq.pending&select=loyalty_percent,loyalty_level`,
      "GET",
    );
    expect(booking).toEqual({ loyalty_percent: 5, loyalty_level: 1 });

    await c.getByRole("link", { name: "Vezi programările" }).click();
    await expect(
      c.locator("li").filter({ hasText: "Ford Focus" }),
    ).toContainText("Client fidel: -5% la manoperă");

    // In English too.
    await c.goto("/c/cont/fidelitate");
    await c
      .getByRole("button", { name: "English" })
      .filter({ visible: true })
      .first()
      .click();
    await expect(
      c.getByRole("heading", { level: 1, name: "Loyalty" }),
    ).toBeVisible();
    await expect(c.getByText("Level 2 is 3 jobs away")).toBeVisible();
    await shot(c, "t28c-loyalty-screen-en", name());
    await context.close();

    // The shop sees the promise on the card.
    await page.goto("/s/programari");
    const shopCard = page.locator("li").filter({ hasText: "Ford Focus" });
    await expect(shopCard).toContainText(
      "Client fidel (Nivelul 1): i-ai promis -5% la manoperă",
    );
    await expectNoHorizontalScroll(page);
    await shot(page, "t28c-shop-booking", name());
  });
});
