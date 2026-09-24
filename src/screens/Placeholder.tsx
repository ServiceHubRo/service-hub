import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/ro';

/** Empty screen with only its title, until the screen's own task builds it. */
export function Placeholder({ titleKey }: { titleKey: MessageKey }) {
  const { t } = useI18n();
  return <h1>{t(titleKey)}</h1>;
}
