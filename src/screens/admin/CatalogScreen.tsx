import { ArrowDown, ArrowUp, ListTree, Plus, SearchX } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { InlinePanel } from '../../components/InlinePanel';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SelectField } from '../../components/SelectField';
import { ServiceIcon } from '../../components/ServiceIcon';
import { DetailPane, DetailSection, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import {
  createCategory,
  createService,
  fetchCatalog,
  moveCatalogItem,
  setServiceReminder,
  updateCategory,
  updateService,
  type CatalogCategory,
  type CatalogService,
} from '../../data/adminTools';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import {
  CATEGORY_KEY_PATTERN,
  filterCatalog,
  parseReminderMonths,
  SERVICE_ID_PATTERN,
  suggestCategoryKey,
  suggestServiceId,
} from '../../lib/adminTools';
import { newRequestId } from '../../lib/requestId';
import { SERVICE_ICON_NAMES } from '../../lib/serviceIcons';
import { useListDetail } from '../../lib/useListDetail';
import { useLoad } from '../../lib/useLoad';
import { Pill } from './parts';
import { ADMIN_CATALOG_PATH } from './paths';
import { useUrlParams } from './useUrlParams';
import styles from './admin.module.css';
import tools from './tools.module.css';
import { PageHeader } from '../../components/PageHeader';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_CATALOG_PATH);

type Panel =
  | { kind: 'new-category' }
  | { kind: 'category'; key: string }
  | { kind: 'new-service'; category: string }
  | { kind: 'service'; id: string };

/** ↑ / ↓: one place up or down; the whole button is the write (locked while it runs). */
function MoveButtons({ kind, id, first, last, onMoved }: { kind: 'category' | 'service'; id: string; first: boolean; last: boolean; onMoved: () => void }) {
  const { t, lang } = useI18n();
  return (
    <span className={tools.moves}>
      {([-1, 1] as const).map((direction) => (
        <ActionButton
          key={direction}
          variant="ghost"
          block={false}
          disabled={direction === -1 ? first : last}
          onAction={async (requestId) => {
            await moveCatalogItem(kind, id, direction, requestId);
            onMoved();
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {direction === -1 ? <ArrowUp size={18} aria-hidden="true" /> : <ArrowDown size={18} aria-hidden="true" />}
          <span className="visually-hidden">{t(direction === -1 ? 'admin.catalog.moveUp' : 'admin.catalog.moveDown')}</span>
        </ActionButton>
      ))}
    </span>
  );
}

/** Names RO + EN, shared by the category and service forms. */
function NameFields({ ro, en, onRo, onEn }: { ro: string; en: string; onRo: (v: string) => void; onEn: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t('admin.catalog.nameRo')} value={ro} maxLength={80} onChange={(e) => onRo(e.target.value)} />
      <Field label={t('admin.catalog.nameEn')} value={en} maxLength={80} onChange={(e) => onEn(e.target.value)} />
    </>
  );
}

function CategoryPanel({ category, onDone, onCancel }: { category?: CatalogCategory; onDone: (message: string) => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const [ro, setRo] = useState(category?.name_ro ?? '');
  const [en, setEn] = useState(category?.name_en ?? '');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [enabled, setEnabled] = useState(category?.enabled ?? true);
  const shownKey = keyTouched ? key : suggestCategoryKey(ro);
  const keyOk = CATEGORY_KEY_PATTERN.test(shownKey);
  return (
    <InlinePanel title={category ? t('admin.catalog.editCategory') : t('admin.catalog.newCategory')} onClose={onCancel}>
      <form className="form-contents" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className={styles.fields}>
          <NameFields ro={ro} en={en} onRo={setRo} onEn={setEn} />
          {!category && (
            <Field
              className={styles.full}
              label={t('admin.catalog.categoryKey')}
              hint={t('admin.catalog.keyHint')}
              error={shownKey && !keyOk ? t('admin.catalog.categoryKeyInvalid') : null}
              value={shownKey}
              mono
              maxLength={34}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(e.target.value.toLowerCase());
              }}
            />
          )}
        </div>
        {category && (
          <>
            <Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)}>
              {t('admin.catalog.categoryOn')}
            </Switch>
            {category.enabled && !enabled && <p className={styles.warning}>{t('admin.catalog.categoryOffWarning')}</p>}
          </>
        )}
        <div className={styles.panelButtons}>
          <ActionButton
            submit
            disabled={!ro.trim() || !en.trim() || (!category && !keyOk)}
            onAction={async (requestId) => {
              if (category) {
                await updateCategory(category.key, ro, en, enabled, requestId);
                onDone(t('admin.catalog.saved'));
              } else {
                await createCategory(shownKey, ro, en, requestId);
                onDone(t('admin.catalog.categoryAdded'));
              }
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {category ? t('admin.save') : t('admin.catalog.addCategory')}
          </ActionButton>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
        </div>
      </form>
    </InlinePanel>
  );
}

function ServicePanel({
  service,
  categoryKey,
  categories,
  move,
  onDone,
  onCancel,
}: {
  service?: CatalogService;
  categoryKey: string;
  categories: CatalogCategory[];
  /** Where the service stands in its category: ↑ ↓ change its place. */
  move?: { first: boolean; last: boolean; onMoved: () => void };
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  const [ro, setRo] = useState(service?.name_ro ?? '');
  const [en, setEn] = useState(service?.name_en ?? '');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [icon, setIcon] = useState(service?.icon ?? 'Wrench');
  const [category, setCategory] = useState(categoryKey);
  const [enabled, setEnabled] = useState(service?.enabled ?? true);
  const [reminder, setReminder] = useState(service?.reminder_months ? String(service.reminder_months) : '');
  const reminderMonths = parseReminderMonths(reminder);
  // The interval is saved by its own call, with its own request id (kept for a retry).
  const reminderRequest = useRef(newRequestId());
  const shownId = idTouched ? id : suggestServiceId(ro);
  const idOk = SERVICE_ID_PATTERN.test(shownId);
  const categoryOn = categories.find((c) => c.key === category)?.enabled ?? true;
  const iconOptions: { value: string; label: string }[] = [...SERVICE_ICON_NAMES].sort().map((n) => ({ value: n, label: n }));
  if (service?.icon && !(SERVICE_ICON_NAMES as readonly string[]).includes(service.icon)) {
    iconOptions.unshift({ value: service.icon, label: service.icon });
  }
  return (
    <InlinePanel title={service ? t('admin.catalog.editService') : t('admin.catalog.newService')} onClose={onCancel}>
      <form className="form-contents" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className={styles.fields}>
          <NameFields ro={ro} en={en} onRo={setRo} onEn={setEn} />
          {service ? (
            <p className={`${styles.muted} ${styles.full}`}>
              {t('admin.catalog.serviceId')}: <span className="mono">{service.id}</span> · {t('admin.catalog.idFixed')}
            </p>
          ) : (
            <Field
              className={styles.full}
              label={t('admin.catalog.serviceId')}
              hint={t('admin.catalog.idHint')}
              error={shownId && !idOk ? t('admin.catalog.serviceIdInvalid') : null}
              value={shownId}
              mono
              maxLength={40}
              onChange={(e) => {
                setIdTouched(true);
                setId(e.target.value.toLowerCase());
              }}
            />
          )}
          <div className={tools.iconField}>
            <SelectField label={t('admin.catalog.icon')} value={icon} options={iconOptions} onChange={(e) => setIcon(e.target.value)} />
            <span className={tools.iconPreview} aria-hidden="true">
              <ServiceIcon name={icon} size={22} />
            </span>
          </div>
          {service && (
            <SelectField
              label={t('admin.catalog.category')}
              value={category}
              options={categories.map((c) => ({
                value: c.key,
                label: c.enabled ? (lang === 'en' ? c.name_en : c.name_ro) : `${lang === 'en' ? c.name_en : c.name_ro} (${t('admin.catalog.off')})`,
              }))}
              onChange={(e) => setCategory(e.target.value)}
            />
          )}
          <Field
            className={styles.full}
            label={t('admin.catalog.reminder')}
            hint={t('admin.catalog.reminderHint')}
            error={reminderMonths === 'invalid' ? t('admin.catalog.reminderInvalid') : null}
            value={reminder}
            inputMode="numeric"
            maxLength={3}
            onChange={(e) => setReminder(e.target.value)}
          />
        </div>
        {service && move && (
          <div className={tools.orderRow}>
            <span>{t('admin.catalog.order')}</span>
            <MoveButtons kind="service" id={service.id} first={move.first} last={move.last} onMoved={move.onMoved} />
          </div>
        )}
        {service && (
          <>
            <Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)}>
              {t('admin.catalog.serviceOn')}
            </Switch>
            {enabled && !categoryOn && <p className={styles.warning}>{t('admin.catalog.categoryIsOff')}</p>}
            {service.enabled && !enabled && <p className={styles.muted}>{t('admin.catalog.serviceOffNote')}</p>}
          </>
        )}
        <div className={styles.panelButtons}>
          <ActionButton
            submit
            disabled={
              !ro.trim() ||
              !en.trim() ||
              (!service && !idOk) ||
              (Boolean(service) && enabled && !categoryOn) ||
              reminderMonths === 'invalid'
            }
            onAction={async (requestId) => {
              const months = reminderMonths === 'invalid' ? null : reminderMonths;
              if (service) {
                await updateService(service.id, { category_key: category, icon, name_ro: ro, name_en: en, enabled }, requestId);
                if (months !== service.reminder_months) await setServiceReminder(service.id, months, reminderRequest.current);
                onDone(t('admin.catalog.saved'));
              } else {
                await createService(shownId, { category_key: categoryKey, icon, name_ro: ro, name_en: en }, requestId);
                if (months !== null) await setServiceReminder(shownId, months, reminderRequest.current);
                onDone(t('admin.catalog.serviceAdded'));
              }
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {service ? t('admin.save') : t('admin.catalog.addService')}
          </ActionButton>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
        </div>
      </form>
    </InlinePanel>
  );
}

/** What a category holds, in one line: how many services and how many are off. */
const servicesLine = (t: ReturnType<typeof useI18n>['t'], c: CatalogCategory) =>
  [t('admin.catalog.servicesCount', { n: c.services.length }), c.enabled ? null : t('admin.catalog.off')].filter(Boolean).join(' · ');

function CategoryDetail({
  c,
  index,
  total,
  all,
  searching,
  panel,
  setPanel,
  notice,
  onDone,
  onMoved,
}: {
  c: CatalogCategory;
  index: number;
  total: number;
  all: CatalogCategory[];
  searching: boolean;
  panel: Panel | null;
  setPanel: (p: Panel | null) => void;
  notice: string | null;
  onDone: (message: string) => void;
  onMoved: () => void;
}) {
  const { t, lang } = useI18n();
  const name = lang === 'en' ? c.name_en : c.name_ro;
  const editingIndex = panel?.kind === 'service' ? c.services.findIndex((s) => s.id === panel.id) : -1;
  const editing = editingIndex >= 0 ? c.services[editingIndex]! : null;
  return (
    <DetailPane
      id={c.key}
      icon={<ListTree size={20} />}
      title={name}
      detail={t('admin.catalog.servicesCount', { n: c.services.length })}
      status={c.enabled ? undefined : <Pill tone="grey">{t('admin.catalog.off')}</Pill>}
      message={notice ? { tone: 'success', text: notice } : undefined}
      actions={
        <>
          <Button variant="secondary" onClick={() => setPanel({ kind: 'category', key: c.key })} aria-label={`${t('admin.catalog.edit')}: ${name}`}>
            {t('admin.catalog.edit')}
          </Button>
          {!searching && <MoveButtons kind="category" id={c.key} first={index === 0} last={index === total - 1} onMoved={onMoved} />}
        </>
      }
    >
      {panel?.kind === 'category' && panel.key === c.key && <CategoryPanel category={c} onDone={onDone} onCancel={() => setPanel(null)} />}
      <DetailSection
        title={t('admin.catalog.services')}
        action={
          panel?.kind === 'new-service' && panel.category === c.key ? undefined : (
            <Button variant="primary" onClick={() => setPanel({ kind: 'new-service', category: c.key })}>
              <Plus size={18} aria-hidden="true" /> {t('admin.catalog.newService')}
            </Button>
          )
        }
      >
        {panel?.kind === 'new-service' && panel.category === c.key && (
          <ServicePanel categoryKey={c.key} categories={all} onDone={onDone} onCancel={() => setPanel(null)} />
        )}
        {editing && (
          <ServicePanel
            key={editing.id}
            service={editing}
            categoryKey={c.key}
            categories={all}
            move={searching ? undefined : { first: editingIndex === 0, last: editingIndex === c.services.length - 1, onMoved }}
            onDone={onDone}
            onCancel={() => setPanel(null)}
          />
        )}
        {c.services.length === 0 ? (
          <p className={styles.muted}>{t('admin.catalog.noServices')}</p>
        ) : (
          <ListRows label={t('admin.catalog.services')}>
            {c.services.map((s) => (
              <ListRow
                key={s.id}
                icon={<ServiceIcon name={s.icon} size={20} />}
                title={lang === 'en' ? s.name_en : s.name_ro}
                detail={[t('admin.catalog.usage', { shops: s.shops, bookings: s.bookings }), s.reminder_months !== null ? t('admin.catalog.reminderShort', { months: s.reminder_months }) : null]
                  .filter(Boolean)
                  .join(' · ')}
                status={s.enabled ? undefined : <Pill tone="grey">{t('admin.catalog.off')}</Pill>}
                selected={editing?.id === s.id}
                onSelect={() => setPanel({ kind: 'service', id: s.id })}
              />
            ))}
          </ListRows>
        )}
      </DetailSection>
    </DetailPane>
  );
}

/**
 * Catalog de servicii (FR §5.7, P21): categories and their services, managed from the database.
 * Add, rename, switch on or off, reorder (↑ ↓), move a service to another category. Ids never
 * change — bookings point at them; a switched-off service stays on old bookings but can no longer
 * be chosen by shops or clients. Switching a category off switches its services off.
 * Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per category, the chosen one beside the
 * list from 1024 px with its services as rows; „Serviciu nou” top right of that part (P12).
 */
export function CatalogScreen() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const { state, reload, setData } = useLoad(fetchCatalog);
  const { setParam, text, setText } = useUrlParams();
  const query = useDeferredValue(text);
  const searching = query.trim() !== '';
  const all = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (all ? filterCatalog(all, query) : []), [all, query]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { wide, selectedId, open, select } = useListDetail(
    shown.map((c) => c.key),
    'cat',
  );
  const chosenIndex = shown.findIndex((c) => c.key === selectedId);
  const chosen = chosenIndex >= 0 ? shown[chosenIndex]! : null;

  const refresh = useCallback(() => {
    void fetchCatalog().then(setData, () => {});
  }, [setData]);
  const done = (message: string) => {
    setPanel(null);
    setNotice(message);
    refresh();
  };

  const header = (
    <>
      <PageHeader
        back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }}
        title={t('admin.catalog.title')}
        subtitle={t('admin.catalog.sub')}
        actions={
          // The add, top right (docs/MODEL_DE_FOLOSIRE.md P12).
          all && panel?.kind !== 'new-category' ? (
            <Button variant="primary" onClick={() => setPanel({ kind: 'new-category' })}>
              <Plus size={18} aria-hidden="true" /> {t('admin.catalog.newCategory')}
            </Button>
          ) : undefined
        }
      />
      {all && (
        <div className={styles.controls}>
          <SearchField
            id="admin-catalog-q"
            label={t('admin.catalog.search')}
            placeholder={t('admin.catalog.search')}
            value={text}
            onChange={setText}
            onClear={() => {
              setText('');
              setParam({ q: null });
            }}
            clearLabel={t('admin.search.clear')}
          />
        </div>
      )}
      {panel?.kind === 'new-category' && <CategoryPanel onDone={done} onCancel={() => setPanel(null)} />}
      {/* On a phone with a category open the header is hidden: the answer is told in the detail. */}
      {notice && !open && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.loadError')} onRetry={reload} />;
  else if (all && all.length === 0) list = <EmptyState icon={ListTree} title={t('admin.catalog.empty')} />;
  else if (shown.length === 0)
    list = (
      <EmptyState
        icon={SearchX}
        title={t('admin.noResults')}
        action={
          <Button
            variant="primary"
            onClick={() => {
              setText('');
              setParam({ q: null });
            }}
          >
            {t('admin.clearFilters')}
          </Button>
        }
      />
    );
  else
    list = (
      <ListRows label={t('admin.catalog.title')}>
        {shown.map((c) => (
          <ListRow
            key={c.key}
            icon={<ListTree size={20} />}
            title={lang === 'en' ? c.name_en : c.name_ro}
            detail={servicesLine(t, c)}
            status={c.enabled ? undefined : <Pill tone="grey">{t('admin.catalog.off')}</Pill>}
            selected={wide && c.key === selectedId}
            onSelect={() => {
              setPanel(null);
              select(c.key);
            }}
          />
        ))}
      </ListRows>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('admin.catalog.title')}
        header={header}
        list={list}
        detail={
          chosen &&
          all && (
            <CategoryDetail
              key={chosen.key}
              c={chosen}
              index={chosenIndex}
              total={shown.length}
              all={all}
              searching={searching}
              panel={panel}
              setPanel={setPanel}
              notice={open ? notice : null}
              onDone={done}
              onMoved={refresh}
            />
          )
        }
      />
    </div>
  );
}
