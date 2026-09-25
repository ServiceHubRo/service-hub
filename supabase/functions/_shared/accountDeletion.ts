// Removing an account after the database has prepared it (prepare_account_deletion, or
// admin_account_deletion for the admin): the shop owner's running Stripe subscription is stopped
// first, so the card is never charged again, then the login is deleted — or, for a shop whose
// records the law keeps, closed for good (banned, email and password replaced).
// Used by delete-account (the person themselves) and admin-delete-account. Safe to repeat.
import type { adminApi } from './admin.ts';
import { stripeConfigFromEnv } from './env.ts';
import { hasLiveSubscription, StripeError, stripeApi } from './stripe.ts';

type Api = ReturnType<typeof adminApi>;

/** Stops the Stripe subscription of the shop this person owns, if one runs. */
export async function cancelStripeSubscription(api: Api, userId: string): Promise<void> {
  const rows = await api.select(
    `subscriptions?select=stripe_subscription_id,stripe_status,shops!inner(owner_id)&shops.owner_id=eq.${userId}`,
  );
  const live = rows.filter((r) => typeof r.stripe_subscription_id === 'string' && hasLiveSubscription(r.stripe_status as string));
  if (live.length === 0) return;
  const stripe = stripeApi(stripeConfigFromEnv());
  for (const r of live) {
    try {
      await stripe.del(`subscriptions/${r.stripe_subscription_id}`);
    } catch (e) {
      // Already gone at Stripe: nothing left to stop.
      if (!(e instanceof StripeError && e.status === 404)) throw e;
    }
  }
}

/** Deletes the login ('delete') or closes it for good ('anonymize'). */
export async function removeLogin(api: Api, userId: string, mode: unknown): Promise<void> {
  if (mode === 'delete') {
    await api.deleteUser(userId);
    return;
  }
  await api.updateUser(userId, {
    email: `deleted-${userId}@deleted.invalid`,
    email_confirm: true,
    password: `${crypto.randomUUID()}${crypto.randomUUID()}`,
    user_metadata: {},
    ban_duration: '876000h', // 100 years
  });
}
