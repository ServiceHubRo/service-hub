import { useEffect, useState } from 'react';
import { fetchSchemaVersion, type SchemaVersionCheck } from '../data/schema';
import { useI18n } from '../i18n/context';
import { IS_TEST_BUILD } from '../lib/env';
import { captureMessage, monitoringEnabled } from '../lib/monitoring';
import { EXPECTED_SCHEMA_VERSION } from '../lib/schema';
import styles from './SchemaBar.module.css';

/** Waits before asking again when the database did not answer (ms). */
const RETRY_MS = [1500, 4000, 10000];

/**
 * Test builds: red bar when the database is not at the version this build expects (ARCHITECTURE §18),
 * or when the build cannot read it at all — then it says why (missing or wrong Netlify variables,
 * or the error the database gave), so the fix is obvious. The published site shows nothing and
 * reports a database that is not at the expected version to Sentry instead (T19).
 */
export function SchemaBar() {
  const { t } = useI18n();
  const [check, setCheck] = useState<SchemaVersionCheck | null>(null);

  useEffect(() => {
    if (EXPECTED_SCHEMA_VERSION === 0 || (!IS_TEST_BUILD && !monitoringEnabled())) return;
    let cancelled = false;
    let attempt = 0;
    let unreachable = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      void fetchSchemaVersion().then((result) => {
        if (cancelled) return;
        // No answer at all (the phone's network still waking up, e.g. the app opened from a
        // notification): asked again a few times before the bar says so.
        if (result.kind === 'error' && attempt < RETRY_MS.length) {
          timer = setTimeout(run, RETRY_MS[attempt++]);
          return;
        }
        if (!IS_TEST_BUILD) {
          if (result.kind === 'ok' && result.version !== EXPECTED_SCHEMA_VERSION) {
            captureMessage(`Database schema version ${result.version}, the app expects ${EXPECTED_SCHEMA_VERSION}`, {
              fingerprint: ['schema-version'],
            });
          }
          return;
        }
        if (result.kind !== 'ok') console.warn('schema version check:', result.detail);
        unreachable = result.kind === 'error';
        setCheck(result);
      });
    };
    run();
    // Back in the app or online again: a bar about an unreachable database is checked once more.
    const again = () => {
      if (!unreachable || document.visibilityState !== 'visible') return;
      attempt = RETRY_MS.length;
      run();
    };
    document.addEventListener('visibilitychange', again);
    window.addEventListener('online', again);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('online', again);
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
