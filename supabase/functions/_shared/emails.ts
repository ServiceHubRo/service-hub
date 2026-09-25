// App emails (ARCHITECTURE §9): the Service-Hub look, in the recipient's language (RO, US
// English), each with a plain-text part. The Auth emails (confirmation, password reset, email
// change) are the Go templates in supabase/templates, drawn the same way.
//
// Built with tables and inline styles, which is what email programs understand.
import { formatDate, formatDayMonth, formatMoney, formatTime, type Lang } from './format.ts';
import { REPORTS_PATH, SUBSCRIPTION_PATH } from './templates.ts';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const C = {
  bg: '#14161A',
  surface: '#1D2026',
  border: '#2C313A',
  text: '#EAE8E2',
  muted: '#8A909B',
  amber: '#F5A524',
  ink: '#151515',
};
// One typeface, as in the app (Inter where installed; email programs cannot load web fonts, so
// the system font otherwise). Capitals only in the wordmark.
const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A paragraph: plain text, or label + value rows (both escaped here). */
export type Block = { p: string } | { rows: [string, string][] } | { quote: string };

export interface Layout {
  lang: Lang;
  /** The line email programs show next to the subject. */
  preheader: string;
  title: string;
  blocks: Block[];
  button?: { label: string; url: string };
  /** Small print under the card. */
  footer: string;
}

const FOOTER_BRAND: Record<Lang, string> = {
  ro: 'Service-Hub · programări la service auto',
  en: 'Service-Hub · car repair bookings',
};
const LINK_HINT: Record<Lang, string> = {
  ro: 'Dacă butonul nu merge, copiază linkul în browser:',
  en: "If the button doesn't work, paste this link into your browser:",
};

export function wordmarkHtml(): string {
  return (
    `<span style="font-family:${FONT};font-weight:800;font-size:20px;letter-spacing:-.01em;white-space:nowrap;">` +
    `<span style="color:${C.text};">SERVICE-</span><span style="color:${C.amber};">HUB</span></span>`
  );
}

function blockHtml(b: Block): string {
  const p = `margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.text};`;
  if ('p' in b) return `<p style="${p}">${escapeHtml(b.p)}</p>`;
  if ('quote' in b) {
    return (
      `<p style="${p}padding:10px 14px;border-left:3px solid ${C.amber};background:#242830;white-space:pre-wrap;">` +
      `${escapeHtml(b.quote)}</p>`
    );
  }
  const rows = b.rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 12px 3px 0;font-family:${FONT};font-size:14px;color:${C.muted};vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td>` +
        `<td style="padding:3px 0;font-family:${FONT};font-size:14px;color:${C.text};vertical-align:top;">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">${rows}</table>`;
}

export function renderLayout(l: Layout): string {
  const button = l.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;"><tr>` +
      `<td bgcolor="${C.amber}" style="background:${C.amber};border-radius:10px;">` +
      `<a href="${escapeHtml(l.button.url)}" style="display:inline-block;padding:13px 22px;font-family:${FONT};font-size:15px;font-weight:bold;color:${C.ink};text-decoration:none;border-radius:10px;">${escapeHtml(l.button.label)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted};">${escapeHtml(LINK_HINT[l.lang])}<br>` +
      `<a href="${escapeHtml(l.button.url)}" style="color:${C.amber};word-break:break-all;">${escapeHtml(l.button.url)}</a></p>`
    : '';
  return `<!doctype html>
<html lang="${l.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(l.title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr><td style="padding:0 4px 16px;">${wordmarkHtml()}</td></tr>
<tr><td bgcolor="${C.surface}" style="background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:24px 22px;">
<h1 style="margin:0 0 14px;font-family:${FONT};font-size:22px;line-height:1.25;font-weight:bold;letter-spacing:-.01em;color:${C.text};">${escapeHtml(l.title)}</h1>
${l.blocks.map(blockHtml).join('\n')}
${button}
</td></tr>
<tr><td style="padding:16px 4px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted};">${escapeHtml(l.footer)}<br>${escapeHtml(FOOTER_BRAND[l.lang])}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderText(l: Layout): string {
  const lines: string[] = [l.title, ''];
  for (const b of l.blocks) {
    if ('p' in b) lines.push(b.p, '');
    else if ('quote' in b) lines.push(b.quote.split('\n').map((s) => `> ${s}`).join('\n'), '');
    else lines.push(b.rows.map(([k, v]) => `${k}: ${v}`).join('\n'), '');
  }
  if (l.button) lines.push(`${l.button.label}: ${l.button.url}`, '');
  lines.push('--', l.footer, FOOTER_BRAND[l.lang]);
  return lines.join('\n');
}

function email(subject: string, l: Layout): EmailContent {
  return { subject, html: renderLayout(l), text: renderText(l) };
}

// ------------------------------------------------------------------------------------ staff invitation

export interface InviteData {
  shop: string;
  city: string;
  inviter: string;
  email: string;
  url: string;
}

export function staffInviteEmail(lang: Lang, d: InviteData): EmailContent {
  const who = d.inviter.trim() || d.shop;
  const place = d.city.trim() ? `${d.shop} (${d.city})` : d.shop;
  if (lang === 'en') {
    return email(`${who} invited you to ${d.shop} on Service-Hub`, {
      lang,
      preheader: `Join ${d.shop} on Service-Hub.`,
      title: 'You are invited',
      blocks: [
        { p: `${who} invited you to work in the ${place} account on Service-Hub: bookings, quotes and messages from clients.` },
        { p: `The invitation is for ${d.email} and is valid for 14 days. Create your account from the button below.` },
      ],
      button: { label: 'Accept the invitation', url: d.url },
      footer: "If you weren't expecting this email, you can ignore it.",
    });
  }
  return email(`${who} te invită în ${d.shop} pe Service-Hub`, {
    lang,
    preheader: `Intră în echipa ${d.shop} pe Service-Hub.`,
    title: 'Ai primit o invitație',
    blocks: [
      { p: `${who} te-a invitat să lucrezi în contul ${place} pe Service-Hub: programări, devize și mesaje de la clienți.` },
      { p: `Invitația e pentru ${d.email} și e valabilă 14 zile. Îți faci contul din butonul de mai jos.` },
    ],
    button: { label: 'Acceptă invitația', url: d.url },
    footer: 'Dacă nu te așteptai la acest email, îl poți ignora.',
  });
}

// ------------------------------------------------------------------------------------ outbox events

/** What the dispatcher knows about an outbox event with the email channel. */
export interface EmailEvent {
  event: string;
  lang: string;
  params: Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

const REASONS: Record<string, string> = {
  fake: 'Recenzie falsă',
  abusive: 'Limbaj abuziv',
  wrong_shop: 'E despre alt service',
  personal_data: 'Conține date personale',
};

function when(lang: Lang, iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${formatDate(lang, d)}, ${formatTime(lang, d)}`;
}

/** Events sent by email only (no push text). */
export const EMAIL_EVENTS: readonly string[] = ['account_suspended', 'review_reported', 'invoice_paid'];

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The subscription emails (T14): payment received, free period ending, payment failed, shop inactive. */
function subscriptionEmail(e: EmailEvent, lang: Lang, app: string): EmailContent | null {
  const p = e.params ?? {};
  const shop = str(p.shop_name) || 'Service-Hub';
  const amount = num(p.total);
  const total = amount === null ? '' : formatMoney(lang, amount);
  // A calendar day (YYYY-MM-DD) or an instant (ISO timestamp), as "14 oct" / "Oct 14".
  const day = (v: unknown) => {
    const s = str(v);
    if (!s) return '';
    const value = s.length > 10 ? new Date(s) : s;
    return typeof value === 'string' || !Number.isNaN(value.getTime()) ? formatDayMonth(lang, value) : '';
  };
  const open = { label: lang === 'en' ? 'Open Subscription' : 'Deschide Abonament', url: `${app}${SUBSCRIPTION_PATH}` };
  const footer =
    lang === 'en'
      ? `You are receiving this email as the owner of ${shop} on Service-Hub.`
      : `Primești acest email ca proprietar al ${shop} pe Service-Hub.`;
  const en = lang === 'en';

  switch (e.event) {
    case 'invoice_paid': {
      const rows: [string, string][] = [
        [en ? 'Shop' : 'Service', shop],
        [en ? 'Amount' : 'Suma', total],
      ];
      if (str(p.paid_at)) rows.push([en ? 'Paid on' : 'Plătit pe', day(p.paid_at)]);
      if (str(p.period_end)) rows.push([en ? 'Active until' : 'Activ până pe', day(p.period_end)]);
      if (str(p.number)) rows.push([en ? 'Payment no.' : 'Nr. plată', str(p.number)]);
      const receipt = str(p.receipt_url);
      return email(en ? `Payment received: ${total}` : `Plată primită: ${total}`, {
        lang,
        preheader: en ? 'Your Service-Hub subscription is active.' : 'Abonamentul Service-Hub e activ.',
        title: en ? 'Payment received' : 'Plată primită',
        blocks: [
          { p: en ? `Thank you. The subscription for ${shop} is active.` : `Mulțumim. Abonamentul pentru ${shop} e activ.` },
          { rows },
          {
            p: en
              ? 'The invoice follows separately. The receipt is on the payment page.'
              : 'Factura vine separat. Chitanța e pe pagina plății.',
          },
        ],
        button: receipt ? { label: en ? 'See the receipt' : 'Vezi chitanța', url: receipt } : open,
        footer,
      });
    }
    case 'trial_ending': {
      const days = num(p.days) ?? 0;
      const price = num(p.price);
      const when = days <= 0 ? (en ? 'today' : 'azi') : day(p.expiry);
      const lead =
        days <= 0
          ? en
            ? 'Your free period on Service-Hub ends today.'
            : 'Perioada gratuită pe Service-Hub se termină azi.'
          : en
            ? `Your free period on Service-Hub ends on ${when}.`
            : `Perioada gratuită pe Service-Hub se termină pe ${when}.`;
      return email(en ? `Your free period ends ${days <= 0 ? 'today' : `on ${when}`}` : `Perioada gratuită se termină ${days <= 0 ? 'azi' : `pe ${when}`}`, {
        lang,
        preheader: en ? 'Activate the subscription to stay in search results.' : 'Activează abonamentul ca să rămâi în căutări.',
        title: en ? 'Your free period is ending' : 'Perioada gratuită se termină',
        blocks: [
          { p: lead },
          {
            p: en
              ? `To keep ${shop} in search results and receive bookings, activate the subscription${price ? ` (${formatMoney(lang, price)} a month)` : ''}. No contract, cancel anytime.`
              : `Ca ${shop} să rămână în căutări și să primească programări, activează abonamentul${price ? ` (${formatMoney(lang, price)} pe lună)` : ''}. Fără contract, anulezi oricând.`,
          },
        ],
        button: { label: en ? 'Activate the subscription' : 'Activează abonamentul', url: open.url },
        footer,
      });
    }
    case 'payment_failed': {
      const next = day(p.expiry);
      const final = p.final === true || !next;
      return email(en ? 'Your subscription payment failed' : 'Plata abonamentului nu a trecut', {
        lang,
        preheader: en ? 'Check or change your card.' : 'Verifică sau schimbă cardul.',
        title: en ? 'Payment failed' : 'Plata nu a trecut',
        blocks: [
          {
            p: en
              ? `We couldn't charge the ${total} subscription for ${shop}.`
              : `Nu am putut încasa abonamentul de ${total} pentru ${shop}.`,
          },
          {
            p: final
              ? en
                ? 'That was the last try. Pay under Subscription so the shop stays in search results.'
                : 'A fost ultima încercare. Plătește din Abonament ca service-ul să rămână în căutări.'
              : en
                ? `We'll try again on ${next}. Check or change the card under Subscription → Manage.`
                : `Reîncercăm pe ${next}. Verifică sau schimbă cardul din Abonament → Gestionează.`,
          },
        ],
        button: open,
        footer,
      });
    }
    case 'shop_inactive': {
      const reason = str(p.reason);
      const why =
        reason === 'payment_failed'
          ? en
            ? "The subscription payment didn't go through."
            : 'Plata abonamentului nu a trecut.'
          : reason === 'cancelled'
            ? en
              ? 'Your subscription has ended.'
              : 'Abonamentul s-a încheiat.'
            : en
              ? 'Your free period has ended.'
              : 'Perioada gratuită s-a încheiat.';
      return email(en ? `${shop} is no longer in search results` : `${shop} nu mai apare în căutări`, {
        lang,
        preheader: en ? 'Pay to receive bookings again.' : 'Plătește ca să primești din nou programări.',
        title: en ? 'Shop not in search' : 'Service-ul nu mai apare în căutări',
        blocks: [
          { p: why },
          {
            p: en
              ? `${shop} no longer appears in search and cannot receive new bookings. Bookings already made continue, and all your data is kept. Paying reactivates it at once.`
              : `${shop} nu mai apare în căutări și nu mai poate primi programări noi. Programările deja făcute continuă, iar toate datele rămân. Plata îl reactivează imediat.`,
          },
        ],
        button: { label: en ? 'Pay the subscription' : 'Plătește abonamentul', url: open.url },
        footer,
      });
    }
    default:
      return null;
  }
}

/** The email for an outbox event, or null when the event has none. */
export function emailForEvent(e: EmailEvent, app: string): EmailContent | null {
  const lang: Lang = e.lang === 'en' ? 'en' : 'ro';
  const p = e.params ?? {};
  switch (e.event) {
    case 'review_reported': {
      // To the platform's admin address: always Romanian.
      const shop = str(p.shop_name) || 'Service';
      const rating = str(p.rating);
      const rows: [string, string][] = [
        ['Service', [shop, str(p.shop_city), str(p.shop_display_id)].filter(Boolean).join(' · ')],
        ['Motiv', REASONS[str(p.reason)] ?? str(p.reason)],
        ['Nota', rating ? `${rating} din 5` : '—'],
        ['Client', str(p.client_name) || 'cont șters'],
      ];
      if (str(p.ref)) rows.push(['Programarea', str(p.ref)]);
      if (str(p.review_at)) rows.push(['Scrisă', when('ro', str(p.review_at))]);
      if (str(p.reported_at)) rows.push(['Raportată', when('ro', str(p.reported_at))]);
      return email(`Recenzie raportată: ${shop}${rating ? ` (${rating}★)` : ''}`, {
        lang: 'ro',
        preheader: `${shop} a raportat o recenzie.`,
        title: 'Recenzie raportată',
        blocks: [
          { p: `${shop} a raportat o recenzie. Recenzia rămâne publică până decizi.` },
          { rows },
          ...(str(p.text) ? [{ quote: str(p.text) }] : [{ p: 'Recenzia nu are text.' }]),
          { p: 'Service-ului i-am promis un răspuns în maximum 5 zile lucrătoare.' },
        ],
        button: { label: 'Deschide Service-Hub', url: `${app}/intra` },
        footer: 'Primești acest email ca administrator Service-Hub (ADMIN_EMAIL).',
      });
    }
    case 'account_suspended': {
      const shop = str(p.shop_name);
      const isShop = str(p.kind) === 'shop';
      if (lang === 'en') {
        return email(isShop ? `Your shop ${shop} is suspended` : 'Your Service-Hub account is suspended', {
          lang,
          preheader: 'Reply to this email for details.',
          title: isShop ? 'Shop suspended' : 'Account suspended',
          blocks: [
            {
              p: isShop
                ? `The Service-Hub team suspended ${shop}. It no longer appears in search and cannot receive bookings.`
                : 'The Service-Hub team suspended your account. You cannot make or change bookings for now.',
            },
            { p: 'Reply to this email if you want to know why or think it is a mistake.' },
          ],
          footer: 'You are receiving this email because you have a Service-Hub account.',
        });
      }
      return email(isShop ? `Service-ul ${shop} e suspendat` : 'Contul tău Service-Hub e suspendat', {
        lang,
        preheader: 'Răspunde la acest email pentru detalii.',
        title: isShop ? 'Service suspendat' : 'Cont suspendat',
        blocks: [
          {
            p: isShop
              ? `Echipa Service-Hub a suspendat ${shop}. Nu mai apare în căutări și nu mai poate primi programări.`
              : 'Echipa Service-Hub ți-a suspendat contul. Deocamdată nu poți face sau schimba programări.',
          },
          { p: 'Răspunde la acest email dacă vrei să afli de ce sau crezi că e o greșeală.' },
        ],
        footer: 'Primești acest email pentru că ai un cont Service-Hub.',
      });
    }
    case 'report_ready': {
      // To the client who bought a history report (T15).
      const en = lang === 'en';
      const car = [str(p.make), str(p.model)].filter(Boolean).join(' ') || (en ? 'your car' : 'mașina ta');
      const plate = str(p.plate);
      const code = str(p.code);
      const rows: [string, string][] = [[en ? 'Car' : 'Mașina', plate ? `${car} · ${plate}` : car]];
      if (code) rows.push([en ? 'Report code' : 'Codul raportului', code]);
      return email(en ? `Your history report is ready: ${code}` : `Raportul de istoric e gata: ${code}`, {
        lang,
        preheader: en ? 'Download it anytime from My reports, free.' : 'Îl descarci oricând din Rapoartele mele, gratuit.',
        title: en ? 'Your report is ready' : 'Raportul e gata',
        blocks: [
          { p: en ? `Thank you. The history report for ${car} is ready.` : `Mulțumim. Raportul de istoric pentru ${car} e gata.` },
          { rows },
          {
            p: en
              ? 'Download it from Account → My reports, as often as you like. A buyer can check the code on the verification page, without an account.'
              : 'Îl descarci din Cont → Rapoartele mele, de câte ori vrei. Cumpărătorul poate verifica codul pe pagina de verificare, fără cont.',
          },
        ],
        button: { label: en ? 'Open My reports' : 'Deschide Rapoartele mele', url: `${app}${REPORTS_PATH}` },
        footer: en
          ? 'You are receiving this email because you bought a report on Service-Hub.'
          : 'Primești acest email pentru că ai cumpărat un raport pe Service-Hub.',
      });
    }
    default:
      return subscriptionEmail(e, lang, app);
  }
}
