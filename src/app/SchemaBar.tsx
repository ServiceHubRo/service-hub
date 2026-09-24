import { useEffect, useState } from 'react';
import { fetchSchemaVersion, type SchemaVersionCheck } from '../data/schema';
import { useI18n } from '../i18n/context';
import { IS_TEST_BUILD } from '../lib/env';
import { EXPECTED_SCHEMA_VERSION } from '../lib/schema';
import styles from './SchemaBar.module.css';

/**
 * Test builds: red bar when the database is not at the version this build expects (ARCHITECTURE §18),
 * or when the build cannot read it at all — then it says why (missing or wrong Netlify variables,
 * or the error the database gave), so the fix is obvious. Production reports to Sentry instead (T19).
 */
export function SchemaBar() {
  const { t } = useI18n();
  const [check, setCheck] = useState<SchemaVersionCheck | null>(null);

  useEffect(() => {
    if (!IS_TEST_BUILD || EXPECTED_SCHEMA_VERSION === 0) return;
    let cancelled = false;
    void fetchSchemaVersion().then((result) => {
      if (cancelled) return;
      if (result.kind !== 'ok') console.warn('schema version check:', result.detail);
      setCheck(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!check || (check.kind === 'ok' && check.version === EXPECTED_SCHEMA_VERSION)) return null;
  let text: string;
  switch (check.kind) {
    case 'ok':
      text = t('schema.behind', { actual: check.version, expected: EXPECTED_SCHEMA_VERSION });
      break;
    case 'no_config':
      text = t('schema.noConfig', { detail: check.detail });
      break;
    case 'error':
      text = t('schema.unreachable', { detail: check.detail, expected: EXPECTED_SCHEMA_VERSION });
      break;
  }
  return (
    <div className={styles.bar} role="alert">
      {text}
    </div>
  );
}
