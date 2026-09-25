import { CircleCheck, CircleX, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LangSwitch } from '../../app/LangSwitch';
import { ActionButton } from '../../components/ActionButton';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { LogoTile } from '../../components/LogoTile';
import { Wordmark } from '../../components/Wordmark';
import { verifyReport, type VerifiedReport } from '../../data/reports';
import { useI18n } from '../../i18n/context';
import { formatDayMonth } from '../../i18n/format';
import { formatPeriod, normalizeReportCode } from '../../lib/report';
import legal from '../legal/LegalPages.module.css';
import styles from './VerifyScreen.module.css';

type Result = { code: string; report: VerifiedReport | null };

/**
 * /verifica (FR §3.6b, P16e, ARCHITECTURE §13): anyone, without an account, checks that a history
 * report is genuine. The answer names only the car, the number of jobs, the period and the date —
 * never shops, amounts, work or people. `?cod=SH-…` fills the code and checks it at once.
 */
export function VerifyScreen() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(params.get('cod') ?? '');
  const [invalid, setInvalid] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const check = async (value: string) => {
    const normalized = normalizeReportCode(value);
    setInvalid(!normalized);
    if (!normalized) {
      setResult(null);
      return;
    }
    const report = await verifyReport(normalized);
    setResult({ code: normalized, report });
    setParams({ cod: normalized }, { replace: true });
  };

  // A link with ?cod= (typed from the PDF, or shared) is checked straight away.
  const [initial] = useState(() => normalizeReportCode(params.get('cod') ?? ''));
  useEffect(() => {
    if (!initial) return;
    let cancelled = false;
    verifyReport(initial).then(
      (report) => {
        if (!cancelled) setResult({ code: initial, report });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const r = result?.report;
  return (
    <div className={legal.page}>
      <header className={legal.header}>
        <Link to="/" className={legal.brand} aria-label={t('app.title')}>
          <LogoTile size={28} />
          <Wordmark size={19} />
        </Link>
        <LangSwitch />
      </header>
      <main className={`${legal.content} ${styles.main}`}>
        <h1>{t('verify.title')}</h1>
        <p className={styles.muted}>{t('verify.intro')}</p>

        <form className={styles.form} onSubmit={(e) => e.preventDefault()} noValidate>
          <Field
            label={t('verify.code')}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setInvalid(false);
            }}
            mono
            upper
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="SH-2026-000147"
            error={invalid ? t('verify.invalid') : null}
          />
          <ActionButton submit onAction={() => check(code)} errorMessage={() => t('verify.error')}>
            {t('verify.submit')}
          </ActionButton>
        </form>

        {result &&
          (r ? (
            <Card className={`${styles.result} ${r.void ? styles.bad : styles.good}`}>
              <p className={styles.verdict} role="status">
                {r.void ? <CircleX size={22} aria-hidden="true" /> : <CircleCheck size={22} aria-hidden="true" />}
                {r.void ? t('verify.void') : t('verify.found')}
              </p>
              <p className={styles.muted}>{r.void ? t('verify.voidBody') : t('verify.foundBody')}</p>
              <p className={`mono ${styles.code}`}>{r.code}</p>
              <dl className={styles.facts}>
                <div>
                  <dt>{t('verify.car')}</dt>
                  <dd>{[r.make, r.model].filter(Boolean).join(' ') || '—'}</dd>
                </div>
                <div>
                  <dt>{t('verify.plate')}</dt>
                  <dd className="mono">{r.plate ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('verify.jobs')}</dt>
                  <dd>{r.job_count}</dd>
                </div>
                <div>
                  <dt>{t('verify.period')}</dt>
                  <dd>{formatPeriod(lang, r.period_from, r.period_to) || '—'}</dd>
                </div>
                <div>
                  <dt>{t('verify.generated')}</dt>
                  {/* Always with the year: a buyer may check a report long after it was made. */}
                  <dd>{r.generated_at ? formatDayMonth(lang, new Date(r.generated_at), new Date(0)) : '—'}</dd>
                </div>
              </dl>
              <p className={styles.muted}>{t('verify.privacy')}</p>
            </Card>
          ) : (
            <Card className={`${styles.result} ${styles.bad}`}>
              <p className={styles.verdict} role="status">
                <SearchX size={22} aria-hidden="true" />
                {t('verify.notFound')}
              </p>
              <p className={`mono ${styles.code}`}>{result.code}</p>
            </Card>
          ))}
      </main>
    </div>
  );
}
