import { useEffect, useRef } from 'react';
import { Button } from '../../components/Button';
import { useI18n } from '../../i18n/context';
import { LEGAL_DOCS, type LegalDocId } from '../../lib/legal';
import { LegalDocument } from '../legal/LegalDocument';
import styles from './auth.module.css';

/**
 * A legal document opened from the sign-up form: a screen of its own, from the top, with nothing
 * of the form under it. The form stays mounted (hidden), so what was typed is kept; "Înapoi la
 * formular" returns to it.
 */
export function LegalDocScreen({ doc, onBack }: { doc: LegalDocId; onBack: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const title = LEGAL_DOCS.find((d) => d.id === doc)!.titleKey;

  // Start at the top of the document, whatever was scrolled on the form.
  useEffect(() => {
    for (let el = ref.current?.parentElement; el; el = el.parentElement) el.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [doc]);

  return (
    <div ref={ref} className={styles.stack}>
      <div className={styles.docTop}>
        <Button onClick={onBack}>{t('auth.backToForm')}</Button>
      </div>
      <LegalDocument id={doc} title={t(title)} />
      <Button variant="primary" block onClick={onBack}>
        {t('auth.backToForm')}
      </Button>
    </div>
  );
}
