// Settings of the email and SMS senders from the Edge Function secrets (Deno only; the shared
// modules they configure stay free of Deno so the unit tests can load them).
import { appUrl } from './app.ts';
import type { EmailConfig } from './resend.ts';
import type { SmsConfig } from './smso.ts';
import type { StripeConfig } from './stripe.ts';

const secret = (name: string): string | undefined => Deno.env.get(name)?.trim() || undefined;

export function emailConfigFromEnv(): EmailConfig {
  return { apiKey: secret('RESEND_API_KEY'), from: secret('EMAIL_FROM'), url: secret('RESEND_API_URL') };
}

export function smsConfigFromEnv(): SmsConfig {
  return { apiKey: secret('SMSO_API_KEY'), sender: secret('SMSO_SENDER'), url: secret('SMSO_API_URL') };
}

/** Where email links point (APP_URL, else the published app). */
export function appUrlFromEnv(): string {
  return appUrl(secret('APP_URL'));
}

/** The platform's admin address (reported reviews; replies to app emails). */
export function adminEmailFromEnv(): string | null {
  return secret('ADMIN_EMAIL') ?? null;
}

/** Stripe (T14): the secret key, the webhook's signing secret, the monthly price. */
export function stripeConfigFromEnv(): StripeConfig {
  return {
    secretKey: secret('STRIPE_SECRET_KEY'),
    webhookSecret: secret('STRIPE_WEBHOOK_SECRET'),
    priceId: secret('STRIPE_PRICE_ID'),
    url: secret('STRIPE_API_URL'),
  };
}
