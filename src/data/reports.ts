import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import type { Lang } from '../i18n/translate';
import { subscribeRows } from './realtime';
import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * The paid vehicle history report (FR §3.6b, P16e; T15). The preview comes from the database
 * (`history_report_preview`: the client's own finished jobs on one car); paying opens Stripe
 * Checkout through the Edge Function `report-checkout`; only Stripe's webhook marks a report paid
 * and makes the PDF, which arrives here through Realtime on `history_reports`. The PDF is read
 * through `report-download` (the bucket is private), free, as often as the client likes.
 * `/verifica` asks `verify_report`, which answers anyone, signed out too.
 */

export interface ReportCar {
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string | null;
  vin: string | null;
}

export interface ReportJob {
  id: string;
  ref: string | null;
  date: string;
  shop_name: string | null;
  shop_city: string | null;
  service_id: string | null;
  service_ro: string | null;
  service_en: string | null;
  items: string[];
  work: string | null;
  odometer: number | null;
  cost: number | null;
}

export interface ReportFacts {
  job_count: number;
  total: number;
  period_from: string | null;
  period_to: string | null;
  latest_odometer: number | null;
  odometer_out_of_order: boolean;
}

export interface ReportPreview {
  car_id: string | null;
  car: ReportCar;
  jobs: ReportJob[];
  facts: ReportFacts;
  price: number;
}

/** The car a report is for: a garage car, or the car of one of the client's bookings. */
export type ReportTarget = { carId: string } | { bookingId: string };

export type ReportStatus = 'pending_payment' | 'paid' | 'generated' | 'void';

export interface MyReport {
  id: string;
  code: string;
  status: ReportStatus;
  car_id: string | null;
  car_snapshot: ReportCar;
  job_count: number;
  amount_paid: number;
  lang: Lang;
  paid_at: string | null;
  generated_at: string | null;
  created_at: string;
}

export interface VerifiedReport {
  found: true;
  code: string;
  make: string | null;
  model: string | null;
  plate: string | null;
  job_count: number;
  period_from: string | null;
  period_to: string | null;
  generated_at: string | null;
  void: boolean;
}

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

const n = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
};

function toCar(value: unknown): ReportCar {
  const c = (value ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof c[k] === 'string' && (c[k] as string).trim() ? (c[k] as string) : null);
  return { make: s('make'), model: s('model'), year: n(c.year), plate: s('plate'), vin: s('vin') };
}

/** What the report on this car would hold, before paying. */
export async function getReportPreview(target: ReportTarget): Promise<ReportPreview> {
  const data = (await call('history_report_preview', {
    p_car_id: 'carId' in target ? target.carId : undefined,
    p_booking_id: 'bookingId' in target ? target.bookingId : undefined,
  })) as unknown as Record<string, unknown>;
  const facts = (data.facts ?? {}) as Record<string, unknown>;
  const jobs = (Array.isArray(data.jobs) ? data.jobs : []) as Record<string, unknown>[];
  return {
    car_id: typeof data.car_id === 'string' ? data.car_id : null,
    car: toCar(data.car),
    jobs: jobs.map((j) => ({
      id: String(j.id),
      ref: typeof j.ref === 'string' ? j.ref : null,
      date: String(j.date),
      shop_name: typeof j.shop_name === 'string' ? j.shop_name : null,
      shop_city: typeof j.shop_city === 'string' ? j.shop_city : null,
      service_id: typeof j.service_id === 'string' ? j.service_id : null,
      service_ro: typeof j.service_ro === 'string' ? j.service_ro : null,
      service_en: typeof j.service_en === 'string' ? j.service_en : null,
      items: Array.isArray(j.items) ? j.items.filter((i): i is string => typeof i === 'string') : [],
      work: typeof j.work === 'string' ? j.work : null,
      odometer: n(j.odometer),
      cost: n(j.cost),
    })),
    facts: {
      job_count: n(facts.job_count) ?? 0,
      total: n(facts.total) ?? 0,
      period_from: typeof facts.period_from === 'string' ? facts.period_from : null,
      period_to: typeof facts.period_to === 'string' ? facts.period_to : null,
      latest_odometer: n(facts.latest_odometer),
      odometer_out_of_order: facts.odometer_out_of_order === true,
    },
    price: n(data.price) ?? 0,
  };
}

let pricePromise: Promise<number | null> | null = null;

/** The report's price (platform_settings.report_price_ron), read once; null when unknown. */
export function getReportPrice(): Promise<number | null> {
  pricePromise ??= (async () => {
    const { data, error } = await db().from('platform_settings').select('report_price_ron').eq('id', 1).maybeSingle();
    if (error) throw failure(error);
    return n(data?.report_price_ron);
  })().catch((e: unknown) => {
    pricePromise = null;
    throw e;
  });
  return pricePromise;
}

const REPORT_COLUMNS = 'id, code, status, car_id, car_snapshot, job_count, amount_paid, lang, paid_at, generated_at, created_at';

/** The client's bought reports, newest first (a checkout left unpaid is not one). */
export async function fetchMyReports(): Promise<MyReport[]> {
  const { data, error } = await db()
    .from('history_reports')
    .select(REPORT_COLUMNS)
    .neq('status', 'pending_payment')
    .order('created_at', { ascending: false });
  if (error) throw failure(error);
  return (data ?? []).map((r) => ({
    ...r,
    status: r.status as ReportStatus,
    car_snapshot: toCar(r.car_snapshot),
    amount_paid: Number(r.amount_paid),
    lang: r.lang === 'en' ? 'en' : 'ro',
  }));
}

/** Changes to the client's reports (paid, generated, void), for a quiet re-read. */
export function subscribeMyReports(userId: string, onChange: () => void): () => void {
  return subscribeRows({ channel: `reports:${userId}`, table: 'history_reports', filter: `client_id=eq.${userId}`, onChange, onResync: onChange });
}

// ------------------------------------------------------------------ Edge Functions

/** Refusals of the report functions besides the database's own codes (RpcError). */
export type ReportProblem = 'payments_unavailable' | 'not_ready' | 'not_paid' | 'waiver_required';

export class ReportError extends Error {
  constructor(readonly problem: ReportProblem) {
    super(problem);
    this.name = 'ReportError';
  }
}

const PROBLEMS: ReadonlySet<string> = new Set(['payments_unavailable', 'not_ready', 'not_paid', 'waiver_required']);

async function functionError(error: unknown): Promise<Error> {
  if (error instanceof FunctionsFetchError) return new RpcError('network');
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    if (res.status === 401) return failure({ code: 'PGRST301' });
    let code: unknown = null;
    try {
      code = ((await res.json()) as { error?: unknown }).error;
    } catch {
      // no body
    }
    if (typeof code === 'string' && PROBLEMS.has(code)) return new ReportError(code as ReportProblem);
    if (code === 'report_void' || code === 'not_found') return failure({ message: code });
    return failure({ message: code });
  }
  return new RpcError('unknown');
}

export type CheckoutAnswer = { url: string } | { reportId: string; status: ReportStatus };

/**
 * Stripe's page for one report on this car. `returnPath` is where Stripe's "back" leads (this
 * preview). The same request id opens the same page; a report already paid is answered as such.
 * `waiver`: the client ticked that the report is made at once and the 14-day right of withdrawal
 * ends with it (OUG 34/2014 art. 16 m); the function refuses without it.
 */
export async function startReportCheckout(
  target: ReportTarget,
  options: { lang: Lang; returnPath: string; requestId: string; waiver: boolean },
): Promise<CheckoutAnswer> {
  const { data, error } = await db().functions.invoke<{ url?: string; report_id?: string; status?: string }>('report-checkout', {
    method: 'POST',
    body: {
      car_id: 'carId' in target ? target.carId : undefined,
      booking_id: 'bookingId' in target ? target.bookingId : undefined,
      lang: options.lang,
      return_path: options.returnPath,
      request_id: options.requestId,
      withdrawal_waiver: options.waiver,
    },
  });
  if (error) throw await functionError(error);
  if (typeof data?.url === 'string') return { url: data.url };
  if (typeof data?.report_id === 'string') return { reportId: data.report_id, status: (data.status ?? 'paid') as ReportStatus };
  throw new RpcError('unknown');
}

/** The PDF of one of the client's reports. */
export async function downloadReport(reportId: string): Promise<Blob> {
  const { data, error } = await db().functions.invoke<Blob>('report-download', { method: 'POST', body: { report_id: reportId } });
  if (error) throw await functionError(error);
  if (!(data instanceof Blob)) throw new RpcError('unknown');
  return data;
}

/** Makes the PDF of a paid report again (when it did not arrive by itself). */
export async function retryReport(reportId: string): Promise<ReportStatus> {
  const { data, error } = await db().functions.invoke<{ status?: string }>('generate-report', {
    method: 'POST',
    body: { report_id: reportId },
  });
  if (error) throw await functionError(error);
  return (data?.status ?? 'paid') as ReportStatus;
}

/** `/verifica`: is this code a real report? Anyone may ask. */
export async function verifyReport(code: string): Promise<VerifiedReport | null> {
  const data = (await call('verify_report', { p_code: code })) as unknown as Record<string, unknown>;
  if (data?.found !== true) return null;
  return {
    found: true,
    code: String(data.code),
    make: typeof data.make === 'string' ? data.make : null,
    model: typeof data.model === 'string' ? data.model : null,
    plate: typeof data.plate === 'string' ? data.plate : null,
    job_count: n(data.job_count) ?? 0,
    period_from: typeof data.period_from === 'string' ? data.period_from : null,
    period_to: typeof data.period_to === 'string' ? data.period_to : null,
    generated_at: typeof data.generated_at === 'string' ? data.generated_at : null,
    void: data.void === true,
  };
}
