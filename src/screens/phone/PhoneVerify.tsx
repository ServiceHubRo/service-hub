import { MessageSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Field } from '../../components/Field';
import { SkeletonBar } from '../../components/Skeleton';
import {
  checkPhoneCode,
  myPhoneVerification,
  sendPhoneCode,
  SmsError,
  type CodeSent,
} from '../../data/phone';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatPhone } from '../../lib/validators';
import styles from './phone.module.css';

type Stage = 'loading' | 'ask' | 'code';

/** Seconds left until `until` (ms), ticking every second; a new code may be asked for after 60 s. */
function useCountdown(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= 0) return undefined;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [until]);
  return Math.min(60, Math.max(0, Math.ceil((until - now) / 1000)));
}

/**
 * "Confirmă numărul de telefon" (FR §2, P5d step 4): a code by SMS, typed here. Used on Panou
 * (the first-run checklist) and in Cont. After a reload it picks up a code that is still waiting.
 */
export function PhoneVerify({ phone, onVerified }: { phone: string; onVerified: () => void | Promise<void> }) {
  const { t, lang } = useI18n();
  const [stage, setStage] = useState<Stage>('loading');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const wait = useCountdown(resendAt);
  const codeRef = useRef<HTMLInputElement>(null);
  const shown = formatPhone(phone);

  useEffect(() => {
    let cancelled = false;
    myPhoneVerification()
      .then((v) => {
        if (cancelled) return;
        if (v.verified) {
          void onVerified();
          return;
        }
        if (v.expires_at) {
          setResendAt(Date.now() + v.resend_in * 1000);
          setStage('code');
        } else setStage('ask');
      })
      .catch(() => {
        if (!cancelled) setStage('ask');
      });
    return () => {
      cancelled = true;
    };
    // Only when the number changes; onVerified may be a new function on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  useEffect(() => {
    if (stage === 'code') codeRef.current?.focus();
  }, [stage]);

  function sent(r: CodeSent) {
    setResendAt(Date.now() + r.resend_in * 1000);
    setNotice(null);
    setFieldError(null);
    setCode('');
    setStage('code');
  }

  const sendError = (e: unknown) =>
    e instanceof SmsError ? t(`phone.error.${e.problem}`) : rpcErrorMessage(lang, e);
  const canResend = (e: unknown) => !(e instanceof SmsError) || e.problem === 'sms_failed';

  if (stage === 'loading') return <SkeletonBar />;

  if (stage === 'ask') {
    return (
      <div className={styles.box}>
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        <p className={styles.text}>{t('phone.intro', { phone: shown })}</p>
        <ActionButton onAction={async () => sent(await sendPhoneCode())} errorMessage={sendError} canRetry={canResend}>
          <MessageSquare size={18} aria-hidden="true" /> {t('phone.send')}
        </ActionButton>
      </div>
    );
  }

  return (
    <form className={styles.box} noValidate onSubmit={(e) => e.preventDefault()}>
      <Field
        ref={codeRef}
        label={t('phone.code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        mono
        className={styles.code}
        value={code}
        onChange={(e) => {
          setCode(e.target.value.replace(/[^\d ]/g, ''));
          setFieldError(null);
        }}
        hint={t('phone.codeHint', { phone: shown })}
        error={fieldError}
      />
      <ActionButton
        submit
        errorMessage={(e) => rpcErrorMessage(lang, e)}
        onAction={async (requestId) => {
          const typed = code.replace(/\s/g, '');
          if (!/^\d{6}$/.test(typed)) {
            setFieldError(t('phone.error.format'));
            return;
          }
          const r = await checkPhoneCode(typed, requestId);
          if (r.status === 'verified') {
            await onVerified();
          } else if (r.status === 'wrong') {
            setFieldError(
              r.attempts_left === 1 ? t('phone.error.wrongLast') : t('phone.error.wrong', { n: r.attempts_left }),
            );
            // Straight back to the field, ready to type the code again.
            codeRef.current?.focus();
            codeRef.current?.select();
          } else {
            setNotice(t(r.status === 'locked' ? 'phone.error.locked' : 'phone.error.expired'));
            setResendAt(0);
            setStage('ask');
          }
        }}
      >
        {t('phone.confirm')}
      </ActionButton>
      <ActionButton
        variant="ghost"
        disabled={wait > 0}
        onAction={async () => sent(await sendPhoneCode())}
        errorMessage={sendError}
        canRetry={canResend}
      >
        {wait > 0 ? t('phone.resendIn', { s: wait }) : t('phone.resend')}
      </ActionButton>
    </form>
  );
}
