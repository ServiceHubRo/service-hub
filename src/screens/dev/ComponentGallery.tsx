import { CalendarDays } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { LangSwitch } from '../../app/LangSwitch';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Checkbox } from '../../components/Checkbox';
import { Chip, ChipRow } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { SkeletonList } from '../../components/Skeleton';
import { StatusBadge } from '../../components/StatusBadge';
import { BOOKING_STATUSES } from '../../lib/status';
import { Stepper } from '../../components/Stepper';
import { Tabs } from '../../components/Tabs';
import { useI18n } from '../../i18n/context';
import styles from './ComponentGallery.module.css';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.h2}>{title}</h2>
      {children}
    </section>
  );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Test builds only: every shared component on one page, to check look and behavior. */
export function ComponentGallery() {
  const i18n = useI18n();
  const { t } = i18n;
  const [chip, setChip] = useState<'all' | 'bv' | 'cd'>('all');
  const [capacity, setCapacity] = useState(5);
  const [tab, setTab] = useState<'req' | 'sched'>('req');
  const [plate, setPlate] = useState('');
  const [saveCar, setSaveCar] = useState(true);
  const [sent, setSent] = useState(0);

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <BackLink to="/" />
          <LangSwitch />
        </div>
        <h1>{t('demo.title')}</h1>
        <p className={styles.sub}>{t('demo.subtitle')}</p>

        <Section title={t('demo.buttons')}>
          <div className={styles.stack}>
            <Button variant="primary" block>
              {t('demo.primary')}
            </Button>
            <div className={styles.row}>
              <Button variant="secondary">{t('demo.secondary')}</Button>
              <Button variant="success">{t('demo.success')}</Button>
              <Button variant="danger">{t('demo.danger')}</Button>
            </div>
            <ActionButton
              onAction={async () => {
                await wait(1200);
                setSent((n) => n + 1);
              }}
            >
              {t('demo.actionOk')}
            </ActionButton>
            <p className={styles.muted} aria-live="polite">
              {t('demo.actionDone', { n: sent })}
            </p>
            <ActionButton
              variant="secondary"
              onAction={async () => {
                await wait(800);
                throw new Error('demo');
              }}
            >
              {t('demo.actionFail')}
            </ActionButton>
          </div>
        </Section>

        <Section title={t('demo.statuses')}>
          <div className={styles.wrap}>
            {BOOKING_STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </Section>

        <Section title={t('demo.chips')}>
          <ChipRow label={t('demo.chips')}>
            <Chip selected={chip === 'all'} onClick={() => setChip('all')}>
              {t('demo.chipAll')}
            </Chip>
            <Chip selected={chip === 'bv'} onClick={() => setChip('bv')}>
              {t('demo.chipBrasov')}
            </Chip>
            <Chip selected={chip === 'cd'} onClick={() => setChip('cd')}>
              {t('demo.chipCodlea')}
            </Chip>
          </ChipRow>
        </Section>

        <Section title={t('demo.stepper')}>
          <Card>
            <Stepper
              label={t('demo.stepper')}
              value={capacity}
              min={1}
              max={100}
              onChange={setCapacity}
              decreaseLabel={t('demo.stepperMinus')}
              increaseLabel={t('demo.stepperPlus')}
            />
          </Card>
        </Section>

        <Section title={t('demo.tabs')}>
          <Tabs
            label={t('demo.tabs')}
            value={tab}
            onChange={setTab}
            items={[
              { key: 'req', label: t('demo.tabRequests'), count: 2 },
              { key: 'sched', label: t('demo.tabScheduled'), count: 5 },
            ]}
          />
        </Section>

        <Section title={t('demo.fields')}>
          <div className={styles.stack}>
            <Field label={t('demo.name')} autoComplete="name" />
            <Field
              label={t('demo.plate')}
              hint={t('demo.plateHint')}
              mono
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              error={plate.trim() === '' ? t('demo.plateError') : null}
            />
            <Checkbox checked={saveCar} onChange={(e) => setSaveCar(e.target.checked)}>
              {t('demo.checkbox')}
            </Checkbox>
          </div>
        </Section>

        <Section title={t('demo.cards')}>
          <div className={styles.stack}>
            <Card>
              <div className={styles.cardRow}>
                <strong>{t('demo.cardTitle')}</strong>
                <StatusBadge status="quote_sent" />
              </div>
              <p className={styles.muted}>{t('demo.cardBody')}</p>
              <Card inset>
                <div className={styles.cardRow}>
                  <span>{t('demo.cardBody')}</span>
                  <span className="mono">{i18n.money(850)}</span>
                </div>
              </Card>
            </Card>
            <Card highlight>
              <div className={styles.cardRow}>
                <strong>{t('demo.cardTitle')}</strong>
                <StatusBadge status="pending" />
              </div>
            </Card>
          </div>
        </Section>

        <Section title={t('demo.banners')}>
          <div className={styles.stack}>
            <Banner tone="info">{t('demo.bannerInfo')}</Banner>
            <Banner tone="warning">{t('demo.bannerWarn')}</Banner>
            <Banner tone="error">{t('demo.bannerError')}</Banner>
          </div>
        </Section>

        <Section title={t('demo.loading')}>
          <SkeletonList />
        </Section>

        <Section title={t('demo.empty')}>
          <EmptyState
            icon={CalendarDays}
            title={t('demo.emptyTitle')}
            body={t('demo.emptyBody')}
            action={<Button variant="secondary">{t('demo.emptyAction')}</Button>}
          />
        </Section>

        <Section title={t('demo.formats')}>
          <Card>
            <ul className={styles.formats}>
              <li className="mono">{i18n.money(1250)}</li>
              <li className="mono">{i18n.km(105400)}</li>
              <li>{i18n.date('2026-10-14')}</li>
              <li className="mono">{i18n.time(new Date('2026-10-14T06:00:00Z'))}</li>
              <li>{i18n.relDays('2026-10-26', new Date('2026-10-14T09:00:00Z'))}</li>
            </ul>
          </Card>
        </Section>
      </div>
    </div>
  );
}
