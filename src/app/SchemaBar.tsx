import { useEffect, useState } from 'react';
import { fetchSchemaVersion } from '../data/schema';
import { useI18n } from '../i18n/context';
import { IS_TEST_BUILD } from '../lib/env';
import { EXPECTED_SCHEMA_VERSION } from '../lib/schema';
import styles from './SchemaBar.module.css';

type Check = { state: 'ok' } | { state: 'behind'; actual: number | null };

/**
 * Test builds: red bar when the database is not at the version this build expects (ARCHITECTURE §18).
 * Skipped while there are no migrations. Production reports to Sentry instead (T19).
 */
export function SchemaBar() {
  const { t } = useI18n();
  const [check, setCheck] = useState<Check>({ state: 'ok' });

  useEffect(() => {
    if (!IS_TEST_BUILD || EXPECTED_SCHEMA_VERSION === 0) return;
    let cancelled = false;
    void fetchSchemaVersion().then((actual) => {
      if (cancelled) return;
      setCheck(actual === EXPECTED_SCHEMA_VERSION ? { state: 'ok' } : { state: 'behind', actual });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (check.state === 'ok') return null;
  return (
    <div className={styles.bar} role="alert">
      {t('schema.behind', {
        actual: check.actual ?? t('schema.unknown'),
        expected: EXPECTED_SCHEMA_VERSION,
      })}
    </div>
  );
}
