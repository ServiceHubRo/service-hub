import { TIME_ZONE, formatWeekday } from '../i18n/format';
import { ro, type MessageKey } from '../i18n/ro';
import { translate, type Lang } from '../i18n/translate';
import { systemMessageText, type JsonParams } from './messages';
import type { XlsxSheet } from './xlsx';

/**
 * "Descarcă datele mele" (GDPR access and portability) as a spreadsheet anyone can open: one
 * sheet per kind of data, headers and values in the reader's language, dates in Romanian time.
 * Built from what `export_my_data()` returns; a part the account does not have is left out.
 */

type Obj = Record<string, unknown>;

/** Service names by id, for the bookings (the export holds ids). */
export type ServiceNames = ReadonlyMap<string, { name_ro: string; name_en: string }>;

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

const locales: Record<Lang, string> = { ro: 'ro-RO', en: 'en-US' };

/** `10.10.2026, 09:06` (an instant) or `10.10.2026` (a calendar day); empty when missing. */
export function when(lang: Lang, value: unknown): string {
  const v = text(value);
  if (!v) return '';
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const date = new Date(dayOnly ? `${v}T12:00:00Z` : v);
  if (Number.isNaN(date.getTime())) return v;
  return new Intl.DateTimeFormat(locales[lang], {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(dayOnly ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }),
  }).format(date);
}

/** Labels that exist only for some values (a status from a newer version shows as it is). */
function labelOr(lang: Lang, key: string, fallback: string): string {
  return key in ro ? translate(lang, key as MessageKey) : fallback;
}

function yesNo(lang: Lang, v: unknown): string {
  if (v === true) return translate(lang, 'common.yes');
  if (v === false) return translate(lang, 'common.no');
  return '';
}

function car(v: unknown): { name: string; plate: string } {
  const c = obj(v);
  return { name: [text(c.make), text(c.model), text(c.year)].filter(Boolean).join(' '), plate: text(c.plate) };
}

export function myDataSheets(data: unknown, lang: Lang, services: ServiceNames = new Map()): XlsxSheet[] {
  const t = (key: MessageKey, params?: Record<string, string | number>) => translate(lang, key, params);
  const d = obj(data);
  const account = obj(d.account);
  const role = text(account.role);
  const sheets: XlsxSheet[] = [];
  const add = (key: MessageKey, header: MessageKey[], rows: string[][]) => {
    if (rows.length > 0) sheets.push({ name: t(key), rows: [header.map((h) => t(h)), ...rows] });
  };

  // ---------------------------------------------------------------- the account
  const credits = list(d.report_credits);
  const waitlist = obj(d.area_waitlist);
  const facts: [MessageKey, string][] = [
    ['mydata.f.accountId', text(account.account_id)],
    ['mydata.f.role', labelOr(lang, `mydata.role.${role}`, role)],
    ['mydata.f.name', text(account.name)],
    ['mydata.f.phone', text(account.phone)],
    ['mydata.f.email', text(account.email)],
    ['mydata.f.language', labelOr(lang, `mydata.lang.${text(account.language)}`, text(account.language))],
    ['mydata.f.emailVerified', when(lang, account.email_verified_at)],
    ['mydata.f.phoneVerified', when(lang, account.phone_verified_at)],
    ['mydata.f.terms', [text(account.terms_version), when(lang, account.terms_accepted_at)].filter(Boolean).join(', ')],
    ['mydata.f.created', when(lang, account.created_at)],
    ['mydata.f.invitedWith', text(d.invited_with_code)],
    ['mydata.f.friendsInvited', role === 'client' ? text(d.friends_invited) : ''],
    ['mydata.f.freeReports', credits.length > 0 ? String(credits.length) : ''],
    ['mydata.f.freeReportsUsed', credits.length > 0 ? String(credits.filter((c) => c.used_at).length) : ''],
    ['mydata.f.waitlist', [text(waitlist.area), text(waitlist.locality)].filter(Boolean).join(', ')],
    ['mydata.f.exported', when(lang, d.exported_at)],
  ];
  sheets.push({
    name: t('mydata.sheet.account'),
    rows: [[t('mydata.col.field'), t('mydata.col.value')], ...facts.filter(([, v]) => v !== '').map(([k, v]) => [t(k), v])],
  });

  // ---------------------------------------------------------------- the client's side
  add(
    'mydata.sheet.cars',
    ['mydata.c.make', 'mydata.c.model', 'mydata.c.year', 'mydata.c.plate', 'mydata.c.vin', 'mydata.c.itp', 'mydata.c.rca', 'mydata.c.vignette', 'mydata.c.added'],
    list(d.cars).map((c) => [
      text(c.make),
      text(c.model),
      text(c.year),
      text(c.plate),
      text(c.vin),
      when(lang, c.itp_expiry),
      when(lang, c.rca_expiry),
      when(lang, c.vignette_expiry),
      when(lang, c.created_at),
    ]),
  );

  const serviceName = (id: string) => {
    const s = services.get(id);
    return s ? (lang === 'ro' ? s.name_ro : s.name_en) : id;
  };
  const bookings = list(d.bookings);
  add(
    'mydata.sheet.bookings',
    ['mydata.b.ref', 'mydata.b.shop', 'mydata.b.service', 'mydata.b.date', 'mydata.b.time', 'mydata.b.status', 'mydata.b.car', 'mydata.b.plate', 'mydata.b.odometer', 'mydata.b.work', 'mydata.b.cost', 'mydata.b.note', 'mydata.b.reason', 'mydata.b.created'],
    bookings.map((b) => {
      const c = car(b.car_snapshot);
      const extra = Array.isArray(b.extra_service_ids) ? b.extra_service_ids.map(text) : [];
      return [
        text(b.ref),
        text(b.shop),
        [text(b.service_id), ...extra].filter(Boolean).map(serviceName).join(', '),
        when(lang, b.date),
        text(b.slot).slice(0, 5),
        labelOr(lang, `status.${text(b.status)}`, text(b.status)),
        c.name,
        c.plate,
        text(b.odometer),
        text(b.work),
        text(b.cost),
        text(b.note),
        text(b.cancel_reason) || text(b.decline_reason),
        when(lang, b.created_at),
      ];
    }),
  );

  add(
    'mydata.sheet.quotes',
    ['mydata.b.ref', 'mydata.q.version', 'mydata.q.status', 'mydata.q.item', 'mydata.q.price', 'mydata.q.approved', 'mydata.q.sent', 'mydata.q.decided'],
    bookings.flatMap((b) =>
      list(b.quotes).flatMap((q) => {
        const base = [text(b.ref), text(q.version), labelOr(lang, `admin.quoteStatus.${text(q.status)}`, text(q.status))];
        const dates = [when(lang, q.sent_at), when(lang, q.decided_at)];
        const items = list(q.items).map((i) => [...base, text(i.name), text(i.price), yesNo(lang, i.approved), ...dates]);
        const fee = Number(q.inspection_fee);
        if (Number.isFinite(fee) && fee > 0) items.push([...base, t('mydata.q.inspectionFee'), String(fee), '', ...dates]);
        return items;
      }),
    ),
  );

  add(
    'mydata.sheet.reviews',
    ['mydata.b.shop', 'mydata.r.rating', 'mydata.r.text', 'mydata.r.reply', 'mydata.r.date', 'mydata.r.removed'],
    list(d.reviews).map((r) => [text(r.shop), text(r.rating), text(r.text), text(r.shop_reply), when(lang, r.created_at), when(lang, r.removed_at)]),
  );

  const side = role === 'client' ? 'client' : 'shop';
  add(
    'mydata.sheet.messages',
    ['mydata.m.date', 'mydata.m.with', 'mydata.m.from', 'mydata.m.text'],
    list(d.messages).map((m) => {
      const from = text(m.from);
      const system = from === 'system';
      return [
        when(lang, m.sent_at),
        text(m.conversation_with),
        labelOr(lang, `mydata.from.${from}`, from),
        system ? systemMessageText(lang, side, text(m.event) || null, m.params ? (obj(m.params) as JsonParams) : null) : text(m.text),
      ];
    }),
  );

  add(
    'mydata.sheet.favorites',
    ['mydata.b.shop', 'mydata.fav.city', 'mydata.fav.added'],
    list(d.favorites).map((f) => [text(f.shop), text(f.city), when(lang, f.added_at)]),
  );

  add(
    'mydata.sheet.reports',
    ['mydata.rep.code', 'mydata.b.car', 'mydata.b.plate', 'mydata.rep.status', 'mydata.rep.paid', 'mydata.rep.date'],
    list(d.history_reports).map((h) => {
      const c = car(h.car);
      return [text(h.code), c.name, c.plate, labelOr(lang, `reports.state.${text(h.status)}`, text(h.status)), text(h.amount_paid), when(lang, h.created_at)];
    }),
  );

  // ---------------------------------------------------------------- the shop's side
  if (d.shop && typeof d.shop === 'object') {
    const s = obj(d.shop);
    const billing = obj(s.billing);
    const sub = obj(s.subscription);
    const subStatus = text(sub.status);
    const offered = Array.isArray(s.services) ? s.services.map(text).map(serviceName).join(', ') : '';
    const shopFacts: [MessageKey, string][] = [
      ['mydata.s.name', text(s.name)],
      ['mydata.s.myRole', labelOr(lang, `mydata.shopRole.${text(s.my_role)}`, text(s.my_role))],
      ['mydata.s.city', text(s.city)],
      ['mydata.s.county', text(s.county)],
      ['mydata.s.street', text(s.street)],
      ['mydata.s.postalCode', text(s.postal_code)],
      ['mydata.s.phone', text(s.phone)],
      ['mydata.s.phone2', text(s.phone2)],
      ['mydata.s.website', text(s.website)],
      ['mydata.s.facebook', text(s.facebook)],
      ['mydata.s.description', text(s.description)],
      ['mydata.s.yearEstablished', text(s.year_established)],
      ['mydata.s.dailyCapacity', text(s.daily_capacity)],
      ['mydata.s.carsPerSlot', text(s.cars_per_slot)],
      ['mydata.s.slotMinutes', text(s.slot_minutes)],
      ['mydata.s.inspectionFee', text(s.inspection_fee)],
      ['mydata.s.services', offered],
      ['mydata.s.created', when(lang, s.created_at)],
      ['mydata.s.legalName', text(billing.legal_name)],
      ['mydata.s.vatId', text(billing.vat_id)],
      ['mydata.s.regCom', text(billing.reg_com)],
      ['mydata.s.legalAddress', text(billing.legal_address)],
      ['mydata.s.legalRep', text(billing.legal_rep)],
      ['mydata.s.iban', text(billing.iban)],
      ['mydata.s.bank', text(billing.bank_name)],
      ['mydata.s.billingEmail', text(billing.billing_email)],
      ['mydata.s.vatPayer', yesNo(lang, billing.vat_payer)],
      ['mydata.s.subStatus', subStatus ? labelOr(lang, `admin.subStatus.${subStatus}`, subStatus) : ''],
      ['mydata.s.trialEnds', when(lang, sub.trial_ends_at)],
      ['mydata.s.paidUntil', when(lang, sub.current_period_end)],
      ['mydata.s.price', text(sub.price_ron)],
    ];
    sheets.push({
      name: t('mydata.sheet.shop'),
      rows: [[t('mydata.col.field'), t('mydata.col.value')], ...shopFacts.filter(([, v]) => v !== '').map(([k, v]) => [t(k), v])],
    });

    add(
      'mydata.sheet.hours',
      ['mydata.h.day', 'mydata.h.hours'],
      list(s.hours).map((h) => [
        formatWeekday(lang, Number(h.weekday)),
        h.closed ? t('mydata.h.closed') : `${text(h.open).slice(0, 5)}–${text(h.close).slice(0, 5)}`,
      ]),
    );
    add(
      'mydata.sheet.closures',
      ['mydata.cl.from', 'mydata.cl.to', 'mydata.cl.label'],
      list(s.closures).map((c) => [when(lang, c.from), when(lang, c.to), text(c.label)]),
    );
    add(
      'mydata.sheet.invoices',
      ['mydata.i.number', 'mydata.i.amount', 'mydata.i.vat', 'mydata.i.currency', 'mydata.i.issued', 'mydata.i.status'],
      list(s.invoices).map((i) => [
        `${text(i.series)} ${text(i.number)}`.trim(),
        text(i.amount),
        text(i.vat_amount),
        text(i.currency),
        when(lang, i.issued_at),
        labelOr(lang, `mydata.i.status.${text(i.status)}`, text(i.status)),
      ]),
    );
  }

  return sheets;
}
