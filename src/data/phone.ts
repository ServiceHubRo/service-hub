import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * Phone verification by SMS code (FR §2, T13): the Edge Function `phone-verify-start` sends a
 * code, the database function `check_phone_code` checks it. A verified phone ticks step 4 of
 * "Pune service-ul pe picioare" and lets the shop appear in search.
 */

export interface PhoneVerification {
  phone: string | null;
  verified: boolean;
  /** Set while a code is waiting to be typed. */
  expires_at: string | null;
  /** Seconds until another code may be asked for. */
  resend_in: number;
}

export async function myPhoneVerification(): Promise<PhoneVerification> {
  return (await call('my_phone_verification', {} as never)) as unknown as PhoneVerification;
}

/** Why a code could not be sent, besides the database's refusals (RpcError). */
export type SmsProblem = 'sms_failed' | 'sms_unavailable' | 'phone_invalid';

export class SmsError extends Error {
  constructor(readonly problem: SmsProblem) {
    super(problem);
    this.name = 'SmsError';
  }
}

export interface CodeSent {
  status: 'sent' | 'wait';
  expires_at: string | null;
  resend_in: number;
}

/** Asks for a code by SMS. A second ask within the minute answers `wait` and sends nothing. */
export async function sendPhoneCode(): Promise<CodeSent> {
  if (!supabase) throw new RpcError('network');
  const { data, error } = await supabase.functions.invoke('phone-verify-start', { method: 'POST' });
  if (!error) {
    const d = data as Partial<CodeSent>;
    return { status: d.status === 'wait' ? 'wait' : 'sent', expires_at: d.expires_at ?? null, resend_in: d.resend_in ?? 60 };
  }
  if (error instanceof FunctionsFetchError) throw new RpcError('network');
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    if (res.status === 401) throw failure({ code: 'PGRST301' });
    let code: unknown = null;
    try {
      code = ((await res.json()) as { error?: unknown }).error;
    } catch {
      // no body
    }
    if (code === 'sms_failed' || code === 'sms_unavailable' || code === 'phone_invalid') throw new SmsError(code);
    throw failure({ message: code });
  }
  throw new RpcError('unknown');
}

export type CodeCheck =
  | { status: 'verified' }
  | { status: 'wrong'; attempts_left: number }
  | { status: 'locked' }
  | { status: 'expired' };

export async function checkPhoneCode(code: string, requestId: string): Promise<CodeCheck> {
  return (await call('check_phone_code', { p_code: code, p_request_id: requestId })) as unknown as CodeCheck;
}
