import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import type { DamageMark } from '../../supabase/functions/_shared/carDiagram.ts';
import type { Lang } from '../i18n/translate';
import { shrinkImage } from '../lib/image';
import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * The documents of a job (T50): the intake sheet the shop writes and the client confirms, the
 * shop's quote numbering, and the PDFs (quote, final quote, intake sheet) made by the Edge
 * Function `job-document` for the booking's client or its shop. Intake photos live in the private
 * bucket `intake-photos` under the booking's folder.
 */

export type JobDocKind = 'quote' | 'final' | 'intake';

export interface VehicleIntake {
  booking_id: string;
  odometer: number | null;
  fuel: number | null;
  damages: DamageMark[];
  photos: string[];
  personal_items: string | null;
  notes: string | null;
  keep_parts: boolean | null;
  road_test: boolean | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
}

export interface IntakeInput {
  odometer: number | null;
  fuel: number | null;
  damages: DamageMark[];
  photos: string[];
  personal_items: string;
  notes: string;
  keep_parts: boolean | null;
  road_test: boolean | null;
}

export const INTAKE_PHOTO_LIMIT = 8;
export const INTAKE_BUCKET = 'intake-photos';

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

const COLUMNS = 'booking_id, odometer, fuel, damages, photos, personal_items, notes, keep_parts, road_test, created_at, updated_at, confirmed_at';

/** The booking's intake sheet, or null when the shop has not written one. */
export async function fetchIntake(bookingId: string): Promise<VehicleIntake | null> {
  const { data, error } = await db().from('vehicle_intakes').select(COLUMNS).eq('booking_id', bookingId).maybeSingle();
  if (error) throw failure(error);
  return (data as unknown as VehicleIntake | null) ?? null;
}

export async function saveIntake(bookingId: string, input: IntakeInput, requestId: string): Promise<VehicleIntake> {
  return (await call('save_vehicle_intake', {
    p_booking_id: bookingId,
    p_data: input as never,
    p_request_id: requestId,
  })) as unknown as VehicleIntake;
}

export async function confirmIntake(bookingId: string, requestId: string): Promise<VehicleIntake> {
  return (await call('confirm_vehicle_intake', { p_booking_id: bookingId, p_request_id: requestId })) as unknown as VehicleIntake;
}

/** The picture could not be decoded here (an unusual format): nothing was uploaded. */
export class IntakePhotoError extends Error {}

/** Shrinks the picture to a JPEG and stores it in the booking's folder; answers its path. */
export async function uploadIntakePhoto(bookingId: string, file: Blob): Promise<string> {
  let blob: Blob;
  try {
    blob = await shrinkImage(file, 1600, 0.82);
  } catch {
    throw new IntakePhotoError('unreadable');
  }
  const path = `${bookingId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await db().storage.from(INTAKE_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw failure(error);
  return path;
}

/** Best effort: a file left behind costs nothing visible. */
export async function removeIntakePhoto(path: string): Promise<void> {
  await db().storage.from(INTAKE_BUCKET).remove([path]).then(
    () => undefined,
    () => undefined,
  );
}

/** Short-lived addresses of the photos, for the shop and the booking's client. */
export async function intakePhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await db().storage.from(INTAKE_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw failure(error);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}

/** Where the owner's quote numbers stand: the next one, and the last one used. */
export async function fetchQuoteNumbering(): Promise<{ next: number; last: number | null }> {
  const data = (await call('my_quote_numbering', {} as never)) as unknown as { next: number; last: number | null };
  return { next: Number(data.next), last: data.last == null ? null : Number(data.last) };
}

export async function setQuoteNextNumber(next: number, requestId: string): Promise<void> {
  await call('set_quote_next_number', { p_next: next, p_request_id: requestId });
}

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
    return failure({ message: code });
  }
  return new RpcError('unknown');
}

/** One of the booking's documents as a PDF, in the reader's language. */
export async function downloadJobDocument(bookingId: string, kind: JobDocKind, lang: Lang): Promise<Blob> {
  const { data, error } = await db().functions.invoke<Blob>('job-document', {
    method: 'POST',
    body: { booking_id: bookingId, kind, lang },
  });
  if (error) throw await functionError(error);
  if (!(data instanceof Blob)) throw new RpcError('unknown');
  return data;
}
