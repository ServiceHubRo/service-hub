import { CalendarDays, FileText, Heart, MessageSquare, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { buttonClass } from '../../components/buttonClass';
import { CardGrid, CardGridSkeleton, GridCard } from '../../components/CardGrid';
import { Checkbox } from '../../components/Checkbox';
import { Chip, ChipRow } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { FieldPair, FormLayout, FormSection, FormSkeleton } from '../../components/FormLayout';
import { DetailFacts, DetailPane, DetailSection, ListDetailLayout, type DetailMessage } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { LoadError } from '../../components/LoadError';
import { MoreActions } from '../../components/MoreActions';
import { PageHeader } from '../../components/PageHeader';
import { ReadingPage, ReadingSkeleton } from '../../components/ReadingPage';
import { SelectField } from '../../components/SelectField';
import { ServiceIcon } from '../../components/ServiceIcon';
import { Stars } from '../../components/Stars';
import { PanelSection, PanelSections, StatGrid, StatGridSkeleton, StatTile } from '../../components/StatTile';
import { BookingStatusPill } from '../../components/StatusPill';
import { Tabs, TabPanel } from '../../components/Tabs';
import { useI18n } from '../../i18n/context';
import { formatDate, formatMoney, formatRating } from '../../i18n/format';
import { isActiveStatus } from '../../lib/status';
import { needsAction } from '../../lib/statusTone';
import { useListDetail } from '../../lib/useListDetail';
import { sampleBookings, sampleShops, SAMPLE_ARTICLE, type SampleBooking } from './templateSamples';
import { TEMPLATE_SLUGS, TEMPLATES_PATH, type TemplateSlug as Slug } from './paths';
import styles from './TemplateDemos.module.css';


type DemoState = 'date' | 'incarcare' | 'gol' | 'eroare';
const STATES: DemoState[] = ['date', 'incarcare', 'gol', 'eroare'];
const STATE_LABEL = {
  date: 'demo.state.data',
  incarcare: 'demo.state.loading',
  gol: 'demo.state.empty',
  eroare: 'demo.state.error',
} as const;

/** The state the demo shows (`?stare=`): with data, loading, empty or failed. */
function useDemoState(): [DemoState, (s: DemoState) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('stare');
  const state = STATES.includes(raw as DemoState) ? (raw as DemoState) : 'date';
  return [
    state,
    (s) => {
      const next = new URLSearchParams(params);
      if (s === 'date') next.delete('stare');
      else next.set('stare', s);
      next.delete('id');
      setParams(next, { replace: true });
    },
  ];
}

/** Above every demo: the five templates and the four states, to switch between them. */
function DemoBar({ slug }: { slug: Slug }) {
  const { t } = useI18n();
  const [state, setState] = useDemoState();
  const names: Record<Slug, Parameters<typeof t>[0]> = {
    lista: 'demo.tpl.list',
    grila: 'demo.tpl.grid',
    formular: 'demo.tpl.form',
    panou: 'demo.tpl.panel',
    citit: 'demo.tpl.reading',
  };
  return (
    <div className={styles.bar}>
      <nav className={styles.templates} aria-label={t('demo.templates')}>
        {TEMPLATE_SLUGS.map((s) => (
          <Link key={s} to={`${TEMPLATES_PATH}/${s}`} className={s === slug ? styles.on : undefined} aria-current={s === slug ? 'page' : undefined}>
            {t(names[s])}
          </Link>
        ))}
      </nav>
      <ChipRow label={t('demo.state')}>
        {STATES.map((s) => (
          <Chip key={s} selected={s === state} onClick={() => setState(s)}>
            {t(STATE_LABEL[s])}
          </Chip>
        ))}
      </ChipRow>
    </div>
  );
}

export function TemplateDemo() {
  const { sablon } = useParams();
  const slug: Slug = TEMPLATE_SLUGS.includes(sablon as Slug) ? (sablon as Slug) : 'lista';
  return (
    <div className={styles.page}>
      <DemoBar slug={slug} />
      {slug === 'lista' && <ListDemo />}
      {slug === 'grila' && <GridDemo />}
      {slug === 'formular' && <FormDemo />}
      {slug === 'panou' && <PanelDemo />}
      {slug === 'citit' && <ReadingDemo />}
    </div>
  );
}

// ------------------------------------------------------------------------------- A. list + detail

type BookingTab = 'active' | 'incheiate';

function ListDemo() {
  const { t, lang } = useI18n();
  const [state] = useDemoState();
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const tab: BookingTab = params.get('fila') === 'incheiate' ? 'incheiate' : 'active';
  const all = useMemo(() => (state === 'gol' ? [] : sampleBookings()), [state]);
  const active = useMemo(
    () =>
      all
        .filter((b) => isActiveStatus(b.status))
        // What waits for the client first, then the soonest.
        .sort((a, b) => Number(needsAction(b.status, 'client')) - Number(needsAction(a.status, 'client')) || `${a.date}${a.slot}`.localeCompare(`${b.date}${b.slot}`)),
    [all],
  );
  const past = useMemo(() => all.filter((b) => !isActiveStatus(b.status)).sort((a, b) => `${b.date}${b.slot}`.localeCompare(`${a.date}${a.slot}`)), [all]);
  const shown = tab === 'active' ? active : past;
  const { wide, selectedId, open, select } = useListDetail(shown.map((b) => b.id));
  const chosen = shown.find((b) => b.id === selectedId) ?? null;

  const setTab = (next: BookingTab) => {
    const p = new URLSearchParams(params);
    if (next === 'active') p.delete('fila');
    else p.set('fila', next);
    p.delete('id');
    setParams(p, { replace: true });
  };
  const backParams = new URLSearchParams(params);
  backParams.delete('id');
  const backTo = `${pathname}${backParams.size ? `?${backParams.toString()}` : ''}`;

  let list;
  if (state === 'incarcare') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state === 'eroare') list = <LoadError message={t('bookings.loadError')} onRetry={() => undefined} />;
  else if (shown.length === 0)
    list = (
      <EmptyState
        icon={CalendarDays}
        title={t(tab === 'active' ? 'bookings.emptyActive' : 'bookings.emptyPast')}
        body={tab === 'active' ? t('bookings.emptyBody') : undefined}
      />
    );
  else
    list = (
      <ListRows label={t('bookings.list')}>
        {shown.map((b) => (
          <ListRow
            key={b.id}
            icon={<ServiceIcon name={b.icon} size={20} />}
            title={b.service[lang]}
            detail={`${formatDate(lang, b.date)}, ${b.slot} · ${b.shop} · ${b.car}`}
            status={<BookingStatusPill status={b.status} viewer="client" />}
            attention={needsAction(b.status, 'client')}
            selected={wide && b.id === selectedId}
            onSelect={() => select(b.id)}
          />
        ))}
      </ListRows>
    );

  return (
    <ListDetailLayout
      wide={wide}
      open={open}
      backTo={backTo}
      backLabel={t('nav.bookings')}
      header={
        <PageHeader
          title={t('nav.bookings')}
          actions={
            <Link to={`${TEMPLATES_PATH}/grila`} className={buttonClass('secondary')}>
              <Search size={18} aria-hidden="true" />
              {t('bookings.findShop')}
            </Link>
          }
          tabs={
            <Tabs
              id="bookings"
              label={t('bookings.tabs')}
              value={tab}
              onChange={setTab}
              items={[
                { key: 'active', label: t('bookings.active'), count: state === 'date' || state === 'gol' ? active.length : undefined },
                { key: 'incheiate', label: t('bookings.past') },
              ]}
            />
          }
        />
      }
      list={
        <TabPanel id="bookings" value={tab}>
          {list}
        </TabPanel>
      }
      detail={state === 'date' && chosen ? <BookingDetail booking={chosen} /> : null}
    />
  );
}

/** The detail of a sample booking, in the template's order. */
function BookingDetail({ booking: b }: { booking: SampleBooking }) {
  const { t, lang } = useI18n();
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const total = (b.lines ?? []).reduce((sum, l) => sum + (ticked[l.name.ro] === false ? 0 : l.price), 0);
  const message: DetailMessage | undefined = {
    pending: { tone: 'neutral', text: t('cb.pending') },
    confirmed: undefined,
    in_inspection: { tone: 'neutral', text: `${t('cb.inspection')}. ${t('cb.inspectionBody')}` },
    quote_sent: { tone: 'action', text: t('cb.quote.ask') },
    approved: { tone: 'success', text: t('cb.approved', { amount: formatMoney(lang, b.amount ?? 0) }) },
    in_progress: { tone: 'neutral', text: t('cb.inProgress') },
    done: { tone: 'closed', text: t('cb.doneOld') },
    declined: { tone: 'closed', text: t('cb.declined') },
    cancelled: { tone: 'closed', text: t('cb.cancelledClient') },
    quote_refused: { tone: 'closed', text: t('cb.quoteRefused', { fee: formatMoney(lang, 80) }) },
    expired: { tone: 'closed', text: t('cb.expired') },
    no_show: { tone: 'closed', text: t('cb.noShow') },
  }[b.status] as DetailMessage | undefined;
  const more = [
    { key: 'message', label: t('msg.button'), icon: <MessageSquare size={18} aria-hidden="true" />, onSelect: () => undefined },
    ...(isActiveStatus(b.status) && b.status !== 'in_progress' ? [{ key: 'cancel', label: t('cb.cancel'), onSelect: () => undefined, danger: true }] : []),
  ];

  return (
    <DetailPane
      id={b.id}
      icon={<ServiceIcon name={b.icon} size={20} />}
      title={b.service[lang]}
      detail={`${b.shop} · ${b.city}`}
      status={<BookingStatusPill status={b.status} viewer="client" />}
      message={message}
      documents={
        b.lines || b.status === 'done' ? (
          <>
            {b.status === 'done' && (
              <Button>
                <FileText size={18} aria-hidden="true" />
                {t('doc.final')}
              </Button>
            )}
            <Button>
              <FileText size={18} aria-hidden="true" />
              {t('doc.quote')}
            </Button>
          </>
        ) : undefined
      }
      actions={
        b.status === 'quote_sent' ? (
          <>
            <Button variant="primary">{t('cb.quote.accept')}</Button>
            <Button>{t('cb.quote.refuse')}</Button>
            <MoreActions items={more} />
          </>
        ) : b.status === 'done' ? (
          <>
            <Button variant="primary">{t('cb.review.leave')}</Button>
            <MoreActions items={more} />
          </>
        ) : (
          <MoreActions items={more} />
        )
      }
    >
      <DetailSection title={t('bd.section.booking')}>
        <DetailFacts
          items={[
            { label: t('bd.fact.when'), value: <span className="mono">{`${formatDate(lang, b.date)}, ${b.slot}`}</span> },
            { label: t('bd.fact.car'), value: `${b.car} · ${b.plate}` },
            { label: t('bd.fact.ref'), value: <span className="mono">{b.ref}</span> },
          ]}
        />
      </DetailSection>
      {b.lines && b.status === 'quote_sent' && (
        <DetailSection title={t('bd.section.quote')}>
          <p className={styles.hint}>{t('cb.quote.hint')}</p>
          <div className={styles.lines}>
            {b.lines.map((l) => (
              <Checkbox
                key={l.name.ro}
                checked={ticked[l.name.ro] !== false}
                onChange={(e) => setTicked((s) => ({ ...s, [l.name.ro]: e.target.checked }))}
              >
                <span className={styles.line}>
                  <span>{l.name[lang]}</span>
                  <span className="mono">{formatMoney(lang, l.price)}</span>
                </span>
              </Checkbox>
            ))}
          </div>
          <DetailFacts items={[{ label: t('cb.quote.total'), value: <strong className="mono">{formatMoney(lang, total)}</strong> }]} />
        </DetailSection>
      )}
      {b.status === 'done' && b.work && (
        <DetailSection title={t('bd.section.job')}>
          <DetailFacts
            items={[
              { label: t('cb.done.work'), value: b.work[lang] },
              { label: t('cb.done.cost'), value: <span className="mono">{formatMoney(lang, b.amount ?? 0)}</span> },
            ]}
          />
        </DetailSection>
      )}
    </DetailPane>
  );
}

// ------------------------------------------------------------------------------- B. card grid

function GridDemo() {
  const { t, lang, plural } = useI18n();
  const [state] = useDemoState();
  const shops = state === 'gol' ? [] : sampleShops();
  let body;
  if (state === 'incarcare') body = <CardGridSkeleton label={t('common.loading')} />;
  else if (state === 'eroare') body = <LoadError message={t('demo.shopsError')} onRetry={() => undefined} />;
  else if (shops.length === 0) body = <EmptyState icon={Search} title={t('demo.shopsEmpty')} />;
  else
    body = (
      <CardGrid label={t('nav.client.search')}>
        {shops.map((s) => (
          <GridCard
            key={s.id}
            to={`${TEMPLATES_PATH}/grila`}
            media={s.name
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join('')}
            title={s.name}
            detail={`${s.city} · ${plural('unit.services', s.services)}`}
            meta={
              s.rating === null ? (
                <span>{t('rating.none')}</span>
              ) : (
                <>
                  <Stars value={s.rating} />
                  <span className="mono">{formatRating(lang, s.rating)}</span>
                  <span>· {plural('unit.reviews', s.reviews)}</span>
                </>
              )
            }
            foot={<span className={styles.free}>{t('free.date', { date: formatDate(lang, s.free.date), time: s.free.time })}</span>}
            aside={
              <button type="button" className={styles.heart} aria-label={t('favorite.add', { name: s.name })}>
                <Heart size={20} aria-hidden="true" />
              </button>
            }
          />
        ))}
      </CardGrid>
    );
  return (
    <>
      <PageHeader title={t('nav.client.search')} subtitle={shops.length > 0 && state === 'date' ? plural('unit.shops', shops.length) : undefined} />
      {body}
    </>
  );
}

// ------------------------------------------------------------------------------- C. form

function FormDemo() {
  const { t, plural } = useI18n();
  const [state] = useDemoState();
  const [car, setCar] = useState({ make: '', model: '', year: '', plate: '', vin: '' });
  const set = (key: keyof typeof car) => (e: { target: { value: string } }) => setCar((c) => ({ ...c, [key]: e.target.value }));
  const header = <PageHeader back={{ to: `${TEMPLATES_PATH}/grila`, label: t('nav.client.garage') }} title={t('garage.newTitle')} />;
  if (state === 'incarcare')
    return (
      <div className={styles.formState}>
        {header}
        <FormSkeleton label={t('common.loading')} />
      </div>
    );
  if (state === 'eroare' || state === 'gol')
    return (
      <div className={styles.formState}>
        {header}
        <LoadError message={t('demo.formError')} onRetry={() => undefined} />
      </div>
    );
  return (
    <FormLayout
      header={header}
      save={
        <ActionButton submit onAction={() => new Promise((r) => setTimeout(r, 900))}>
          {t('common.save')}
        </ActionButton>
      }
      aside={
        <Button variant="ghost">
          <X size={18} aria-hidden="true" />
          {t('common.cancel')}
        </Button>
      }
    >
      <FormSection title={t('bd.fact.car')}>
        <FieldPair>
          <Field label={t('car.make')} placeholder={t('car.makePlaceholder')} value={car.make} onChange={set('make')} autoComplete="off" />
          <Field label={t('car.model')} placeholder={t('car.modelPlaceholder')} value={car.model} onChange={set('model')} autoComplete="off" />
        </FieldPair>
        <FieldPair>
          <Field label={t('car.year')} inputMode="numeric" mono value={car.year} onChange={set('year')} autoComplete="off" />
          <Field label={t('car.plate')} placeholder={t('car.platePlaceholder')} mono upper value={car.plate} onChange={set('plate')} autoComplete="off" />
        </FieldPair>
        <Field label={t('car.vin')} hint={t('car.vinHint')} mono upper value={car.vin} onChange={set('vin')} autoComplete="off" />
      </FormSection>
      <FormSection title={t('garage.docsTitle')} description={t('garage.docsHint')}>
        <Field type="date" label={t('doc.long.itp')} />
        <Field type="date" label={t('doc.long.rca')} />
        <Field type="date" label={t('doc.long.vignette')} />
      </FormSection>
      <FormSection title={t('garage.oilTitle')} description={t('garage.oilHint')}>
        <SelectField
          label={t('garage.oilEvery')}
          defaultValue="12"
          options={[6, 12, 24].map((n) => ({ value: String(n), label: plural('unit.months', n) }))}
        />
        <Field type="date" label={t('garage.oilLast')} />
      </FormSection>
    </FormLayout>
  );
}

// ------------------------------------------------------------------------------- D. dashboard

function PanelDemo() {
  const { t, lang } = useI18n();
  const [state] = useDemoState();
  const bookings = state === 'gol' ? [] : sampleBookings();
  const today = bookings.filter((b) => isActiveStatus(b.status)).slice(0, 3);
  const requests = bookings.slice(0, 7);
  const count = (s: SampleBooking['status']) => bookings.filter((b) => b.status === s).length;
  const header = <PageHeader title={t('nav.shop.dashboard')} />;
  if (state === 'incarcare')
    return (
      <>
        {header}
        <div className={styles.panel}>
          <StatGridSkeleton count={6} label={t('common.loading')} />
          <ListRowsSkeleton count={3} label={t('common.loading')} />
        </div>
      </>
    );
  if (state === 'eroare')
    return (
      <>
        {header}
        <LoadError message={t('demo.panelError')} onRetry={() => undefined} />
      </>
    );
  const row = (b: SampleBooking) => (
    <ListRow
      key={b.id}
      to={`${TEMPLATES_PATH}/lista?id=${b.id}`}
      icon={<ServiceIcon name={b.icon} size={20} />}
      title={b.service[lang]}
      detail={`${b.slot} · ${b.car} · ${b.plate}`}
      status={<BookingStatusPill status={b.status} viewer="shop" />}
      attention={needsAction(b.status, 'shop')}
    />
  );
  return (
    <>
      {header}
      <div className={styles.panel}>
        <StatGrid label={t('nav.shop.dashboard')}>
          <StatTile value={count('pending')} label={t('dash.card.requests')} attention to={`${TEMPLATES_PATH}/lista`} />
          <StatTile value={today.length} label={t('dash.card.today')} to={`${TEMPLATES_PATH}/lista`} />
          <StatTile value={bookings.filter((b) => isActiveStatus(b.status)).length} label={t('dash.card.week')} to={`${TEMPLATES_PATH}/lista`} />
          <StatTile value={count('in_inspection')} label={t('dash.card.inspection')} attention to={`${TEMPLATES_PATH}/lista`} />
          <StatTile value={count('quote_sent')} label={t('dash.card.quote')} to={`${TEMPLATES_PATH}/lista`} />
          <StatTile value={count('in_progress')} label={t('dash.card.work')} to={`${TEMPLATES_PATH}/lista`} />
        </StatGrid>
        <PanelSections>
          <PanelSection title={t('dash.today.title')} items={today.map(row)} seeAllTo={`${TEMPLATES_PATH}/lista`} empty={t('dash.today.empty')} />
          <PanelSection title={t('dash.card.requests')} items={requests.map(row)} seeAllTo={`${TEMPLATES_PATH}/lista`} empty={t('dash.requests.empty')} />
        </PanelSections>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------- E. reading

function ReadingDemo() {
  const { t, lang } = useI18n();
  const [state] = useDemoState();
  const a = SAMPLE_ARTICLE;
  const header = <PageHeader back={{ to: `${TEMPLATES_PATH}/panou`, label: t('help.title') }} title={a.title[lang]} subtitle={a.lead[lang]} />;
  return (
    <ReadingPage header={header}>
      {state === 'incarcare' ? (
        <ReadingSkeleton label={t('common.loading')} />
      ) : state === 'eroare' || state === 'gol' ? (
        <LoadError message={t('demo.articleError')} onRetry={() => undefined} />
      ) : (
        a.blocks.map((block, i) =>
          block.h ? (
            <h2 key={i}>{block.h[lang]}</h2>
          ) : block.p ? (
            <p key={i}>{block.p[lang]}</p>
          ) : (
            <ul key={i}>
              {block.list?.map((item) => (
                <li key={item.ro}>{item[lang]}</li>
              ))}
            </ul>
          ),
        )
      )}
    </ReadingPage>
  );
}
