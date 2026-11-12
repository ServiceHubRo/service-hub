import type { HelpAudience } from '../../data/help';
import type { MessageKey } from '../../i18n/ro';
import type { HelpTextProblem } from '../../lib/helpCenter';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** A content problem as the editor shows it under the field (null when the text is fine). */
export function problemText(t: T, problem: HelpTextProblem | null, limits: readonly [number, number]): string | null {
  if (!problem) return null;
  return problem === 'length' ? t('admin.help.problem.length', { min: limits[0], max: limits[1] }) : t(`admin.help.problem.${problem}` as MessageKey);
}

/** Who an article or a category is for, as one line: „Șoferi, Firme” or „Toți”. */
export function audienceLabel(t: T, audience: readonly HelpAudience[]): string {
  return audience.length === 0 ? t('help.audience.all') : audience.map((a) => t(`help.audience.${a}` as MessageKey)).join(', ');
}
