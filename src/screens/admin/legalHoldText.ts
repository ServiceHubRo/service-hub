import type { LegalHoldBasis } from '../../data/legalHolds';
import { rpcErrorMessage, toRpcError } from '../../data/rpc';
import type { MessageKey } from '../../i18n/ro';
import type { Lang } from '../../i18n/translate';
import { translate } from '../../i18n/translate';

// Texts of the legal hold screens (A3c2a), shared by Păstrare legală and the admin's request page.

export type HoldField = 'account' | 'basis' | 'reason' | 'reference' | 'note';

/** Which field a refusal of the hold functions is about, and its words for this screen. */
export function holdError(lang: Lang, error: unknown): { field: HoldField | null; message: string } {
  const { code, params } = toRpcError(error);
  const field = typeof params.field === 'string' ? params.field : null;
  if (code === 'secret_in_text') {
    return { field: (field as HoldField) ?? null, message: translate(lang, 'rpcError.secret_in_text') };
  }
  if (code === 'field_invalid') {
    if (field === 'reason') return { field: 'reason', message: translate(lang, 'admin.holds.err.reasonShort') };
    if (field === 'note') return { field: 'note', message: translate(lang, 'admin.holds.err.noteShort') };
    if (field === 'reference') return { field: 'reference', message: translate(lang, 'admin.holds.err.referenceShort') };
    if (field === 'basis') return { field: 'basis', message: translate(lang, 'admin.holds.err.basisRequired') };
  }
  if (code === 'account_not_found') return { field: 'account', message: translate(lang, 'rpcError.account_not_found') };
  return { field: null, message: rpcErrorMessage(lang, error) };
}

export function basisLabel(t: (key: MessageKey) => string, basis: LegalHoldBasis): string {
  return t(`admin.holds.basis.${basis}` as MessageKey);
}

