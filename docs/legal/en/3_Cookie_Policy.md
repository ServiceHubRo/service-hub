# Cookie Policy — Service-Hub

**Last updated:** September 25, 2026

This policy explains what Service-Hub keeps in your browser and why. The Platform is operated by {{company}} ({{email}}).

> **In short.** Service-Hub uses no advertising, analytics or tracking cookies. We keep in your browser only what is strictly necessary for the app to work: your sign-in session and a few choices you made. That is why we do not show a consent banner.

---

## 1. What cookies and similar technologies are

Cookies are small files a website keeps in your browser. Service-Hub sets no cookies of its own; it uses similar technologies:

- **localStorage** — information kept in the browser even after you close it;
- **sessionStorage** — information that disappears when you close the tab or browser;
- **service worker** — a small part of the app that receives push notifications; it is installed only if you turn notifications on, and it does not store pages or data.

They stay on your device and are not sent to us automatically.

---

## 2. What we keep in your browser

| Name | Purpose | Where and for how long |
|---|---|---|
| `sb-…-auth-token` | Your sign-in session: keeps you signed in | With “Keep me signed in”: localStorage, until you sign out or after 30 days without use. Without it: sessionStorage, until you close the browser |
| `sh_remember` | Your “Keep me signed in” choice on this device | localStorage, until you clear the site’s data |
| `sh_last_seen` | When you last used the app on this device, so we can sign you out after 30 days without use | localStorage, until you clear the site’s data |
| `sh_lang` | The language you chose (Romanian or English) | localStorage, until you clear the site’s data |
| `sh_email_log` | When we last sent you a confirmation or password reset email, so “Resend” waits 60 seconds | localStorage, until you clear the site’s data |
| `sh_push_banner_hidden`, `sh_location_banner_hidden`, `sh_review_prompt_hidden` | You tapped “Not now” on notifications, location or the review request: the message does not show again in this session | sessionStorage, until you close the tab |
| `sh_chunk_reload` | After an app update, the page reloads only once, not endlessly | sessionStorage, until you close the tab |
| Push notification subscription | Only if you turn notifications on: the browser keeps the subscription and the service worker | In the browser, until you turn notifications off or clear the site’s data |

All of them are **strictly necessary**: without them you could not sign in, or the app would not remember choices you made yourself.

---

## 3. Services from other companies

- **Cloudflare Turnstile** — the bot check on the sign-up and sign-in forms. It loads from Cloudflare and may keep, on Cloudflare’s domain, technical information strictly necessary for that check. It is needed to keep accounts safe.
- **Stripe** — when you pay, you are on Stripe’s page (checkout.stripe.com). There, Stripe uses its own cookies, for the payment and for fraud prevention, under Stripe’s policy.
- **Sentry** — error reports use no cookies and keep nothing in your browser.

We do not use Google Analytics, Facebook pixels, ads or any other tracking tools.

---

## 4. Why we do not ask for consent

The law (art. 4(5) of Romanian Law 506/2004, which implements the ePrivacy Directive) requires your consent only for information kept in your browser that is not strictly necessary for a service you asked for. Everything we use is strictly necessary, so we do not show a banner. If we ever add something that is not strictly necessary (for example, traffic statistics), we will update this policy and ask for your consent first.

---

## 5. How to control what is kept

- **Logging out** (Account → Log out) removes the session from this device.
- **Push notifications** can be turned off in Account or in your browser settings.
- **Location** is allowed or blocked in your browser settings; we do not keep it in the browser and it is not sent to us.
- **All site data** can be cleared in your browser settings (usually under “Privacy” → “Site data”). You will then need to sign in again; your account is not affected.

If you completely block storage for service-hub.ro, you will not be able to sign in.

---

## 6. Contact

For questions about this policy: {{email}}.

The Romanian version of this policy is the one that applies. This English version is a translation, provided to make it easier to understand.
