// App emails (ARCHITECTURE §9): the Service-Hub look, in the recipient's language (RO, US
// English), each with a plain-text part. The Auth emails (confirmation, password reset, email
// change) are the Go templates in supabase/templates, drawn the same way.
//
// Built with tables and inline styles, which is what email programs understand.
import { formatDate, formatTime, type Lang } from './format.ts';

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
const HEAD_FONT = "'Arial Narrow','Helvetica Neue',Arial,sans-serif";
const BODY_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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
    `<span style="font-family:${HEAD_FONT};font-weight:bold;font-size:20px;letter-spacing:.04em;white-space:nowrap;">` +
    `<span style="color:${C.text};">SERVICE-</span><span style="color:${C.amber};">HUB</span></span>`
  );
}

function blockHtml(b: Block): string {
  const p = `margin:0 0 14px;font-family:${BODY_FONT};font-size:15px;line-height:1.55;color:${C.text};`;
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
        `<tr><td style="padding:3px 12px 3px 0;font-family:${BODY_FONT};font-size:14px;color:${C.muted};vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td>` +
        `<td style="padding:3px 0;font-family:${BODY_FONT};font-size:14px;color:${C.text};vertical-align:top;">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">${rows}</table>`;
}

export function renderLayout(l: Layout): string {
  const button = l.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;"><tr>` +
      `<td bgcolor="${C.amber}" style="background:${C.amber};border-radius:10px;">` +
      `<a href="${escapeHtml(l.button.url)}" style="display:inline-block;padding:13px 22px;font-family:${BODY_FONT};font-size:15px;font-weight:bold;color:${C.ink};text-decoration:none;border-radius:10px;">${escapeHtml(l.button.label)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:0;font-family:${BODY_FONT};font-size:12px;line-height:1.5;color:${C.muted};">${escapeHtml(LINK_HINT[l.lang])}<br>` +
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
<h1 style="margin:0 0 14px;font-family:${HEAD_FONT};font-size:22px;line-height:1.25;font-weight:bold;text-transform:uppercase;letter-spacing:.02em;color:${C.text};">${escapeHtml(l.title)}</h1>
${l.blocks.map(blockHtml).join('\n')}
${button}
</td></tr>
<tr><td style="padding:16px 4px 0;font-family:${BODY_FONT};font-size:12px;line-height:1.5;color:${C.muted};">${escapeHtml(l.footer)}<br>${escapeHtml(FOOTER_BRAND[l.lang])}</td></tr>
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

/** Events sent by email only (no push text): the ones emailForEvent writes. */
export const EMAIL_EVENTS: readonly string[] = ['account_suspended', 'review_reported'];

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
    default:
      return null;
  }
}
