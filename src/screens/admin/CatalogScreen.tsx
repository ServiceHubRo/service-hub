import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ListTree, Plus, SearchX } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Checkbox } from '../../components/Checkbox';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { InlinePanel } from '../../components/InlinePanel';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SelectField } from '../../components/SelectField';
import { ServiceIcon } from '../../components/ServiceIcon';
import { SkeletonList } from '../../components/Skeleton';
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
import { useLoad } from '../../lib/useLoad';
import { Pill } from './parts';
import { ADMIN_ACCOUNT_PATH } from './paths';
import { useUrlParams } from './useUrlParams';
import styles from './admin.module.css';
import tools from './tools.module.css';

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
    <InlinePanel title={category ? t('admin.catalog.editCategory') : t('admin.catalog.newCategory')}>
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
          <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)}>
            {t('admin.catalog.categoryOn')}
          </Checkbox>
          {category.enabled && !enabled && <p className={styles.warning}>{t('admin.catalog.categoryOffWarning')}</p>}
        </>
      )}
      <div className={styles.panelButtons}>
        <ActionButton
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
    </InlinePanel>
  );
}

function ServicePanel({
  service,
  categoryKey,
  categories,
  onDone,
  onCancel,
}: {
  service?: CatalogService;
  categoryKey: string;
  categories: CatalogCategory[];
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
    <InlinePanel title={service ? t('admin.catalog.editService') : t('admin.catalog.newService')}>
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
      {service && (
        <>
          <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)}>
            {t('admin.catalog.serviceOn')}
          </Checkbox>
          {enabled && !categoryOn && <p className={styles.warning}>{t('admin.catalog.categoryIsOff')}</p>}
          {service.enabled && !enabled && <p className={styles.muted}>{t('admin.catalog.serviceOffNote')}</p>}
        </>
      )}
      <div className={styles.panelButtons}>
        <ActionButton
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
    </InlinePanel>
  );
}

function ServiceRow({
  s,
  first,
  last,
  canMove,
  onEdit,
  onMoved,
}: {
  s: CatalogService;
  first: boolean;
  last: boolean;
  canMove: boolean;
  onEdit: () => void;
  onMoved: () => void;
}) {
  const { t, lang } = useI18n();
  return (
    <div className={tools.serviceRow}>
      <ServiceIcon name={s.icon} size={20} className={tools.serviceIcon} />
      <span className={styles.rowMain}>
        <span className={styles.rowTop}>
          <span className={styles.rowTitle}>{lang === 'en' ? s.name_en : s.name_ro}</span>
          {!s.enabled && <Pill tone="grey">{t('admin.catalog.off')}</Pill>}
        </span>
        <span className={styles.muted}>{lang === 'en' ? s.name_ro : s.name_en}</span>
        <span className={styles.rowMeta}>
          <span className="mono">{s.id}</span>
          <span>{t('admin.catalog.usage', { shops: s.shops, bookings: s.bookings })}</span>
          {s.reminder_months !== null && <span>{t('admin.catalog.reminderShort', { months: s.reminder_months })}</span>}
        </span>
      </span>
      <span className={tools.rowTools}>
        {canMove && <MoveButtons kind="service" id={s.id} first={first} last={last} onMoved={onMoved} />}
        <Button variant="ghost" onClick={onEdit} aria-label={`${t('admin.catalog.edit')}: ${lang === 'en' ? s.name_en : s.name_ro}`}>
          {t('admin.catalog.edit')}
        </Button>
      </span>
    </div>
  );
}

/**
 * Catalog de servicii (FR §5.7, P21): categories and their services, managed from the database.
 * Add, rename, switch on or off, reorder (↑ ↓), move a service to another category. Ids never
 * change — bookings point at them; a switched-off service stays on old bookings but can no longer
 * be chosen by shops or clients. Switching a category off switches its services off.
 */
export function CatalogScreen() {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(fetchCatalog);
  const { params, setParam, text, setText } = useUrlParams();
  const query = useDeferredValue(text);
  const searching = query.trim() !== '';
  const all = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (all ? filterCatalog(all, query) : []), [all, query]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(params.get('cat') ? [params.get('cat')!] : []));
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void fetchCatalog().then(setData, () => {});
  }, [setData]);
  const done = (message: string) => {
    setPanel(null);
    setNotice(message);
    refresh();
  };
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_ACCOUNT_PATH} label={t('nav.account')} />
      <div>
        <h1>{t('admin.catalog.title')}</h1>
        <p className={styles.sub}>{t('admin.catalog.sub')}</p>
      </div>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {all && (
        <>
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
            {panel?.kind !== 'new-category' && (
              <Button onClick={() => setPanel({ kind: 'new-category' })}>
                <Plus size={18} aria-hidden="true" /> {t('admin.catalog.newCategory')}
              </Button>
            )}
          </div>
          {panel?.kind === 'new-category' && <CategoryPanel onDone={done} onCancel={() => setPanel(null)} />}
          {notice && (
            <p className={styles.muted} role="status">
              {notice}
            </p>
          )}
          {all.length === 0 ? (
            <EmptyState icon={ListTree} title={t('admin.catalog.empty')} />
          ) : shown.length === 0 ? (
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
          ) : (
            <ul className={styles.list}>
              {shown.map((c, ci) => {
                const expanded = searching || open.has(c.key);
                const listId = `cat-${c.key}`;
                return (
                  <li key={c.key}>
                    <Card className={styles.stack}>
                      <div className={tools.categoryHead}>
                        <button
                          type="button"
                          className={tools.expand}
                          aria-expanded={expanded}
                          aria-controls={listId}
                          onClick={() => toggle(c.key)}
                          disabled={searching}
                        >
                          {expanded ? <ChevronDown size={20} aria-hidden="true" /> : <ChevronRight size={20} aria-hidden="true" />}
                          <span className={styles.rowMain}>
                            <span className={styles.rowTop}>
                              <span className={styles.cardTitle}>{lang === 'en' ? c.name_en : c.name_ro}</span>
                              {!c.enabled && <Pill tone="grey">{t('admin.catalog.off')}</Pill>}
                            </span>
                            <span className={styles.rowMeta}>
                              <span>{lang === 'en' ? c.name_ro : c.name_en}</span>
                              <span className="mono">{c.key}</span>
                              <span>{t('admin.catalog.servicesCount', { n: c.services.length })}</span>
                            </span>
                          </span>
                        </button>
                        <span className={tools.rowTools}>
                          {!searching && <MoveButtons kind="category" id={c.key} first={ci === 0} last={ci === shown.length - 1} onMoved={refresh} />}
                          <Button
                            variant="ghost"
                            onClick={() => setPanel({ kind: 'category', key: c.key })}
                            aria-label={`${t('admin.catalog.edit')}: ${lang === 'en' ? c.name_en : c.name_ro}`}
                          >
                            {t('admin.catalog.edit')}
                          </Button>
                        </span>
                      </div>
                      {panel?.kind === 'category' && panel.key === c.key && (
                        <CategoryPanel category={c} onDone={done} onCancel={() => setPanel(null)} />
                      )}
                      {expanded && (
                        <div id={listId} className={styles.stack}>
                          <ul className={tools.services}>
                            {c.services.map((s, si) => (
                              <li key={s.id}>
                                <ServiceRow
                                  s={s}
                                  first={si === 0}
                                  last={si === c.services.length - 1}
                                  canMove={!searching}
                                  onEdit={() => setPanel({ kind: 'service', id: s.id })}
                                  onMoved={refresh}
                                />
                                {panel?.kind === 'service' && panel.id === s.id && (
                                  <ServicePanel service={s} categoryKey={c.key} categories={all} onDone={done} onCancel={() => setPanel(null)} />
                                )}
                              </li>
                            ))}
                          </ul>
                          {panel?.kind === 'new-service' && panel.category === c.key ? (
                            <ServicePanel categoryKey={c.key} categories={all} onDone={done} onCancel={() => setPanel(null)} />
                          ) : (
                            <Button onClick={() => setPanel({ kind: 'new-service', category: c.key })}>
                              <Plus size={18} aria-hidden="true" /> {t('admin.catalog.newServiceIn', { category: lang === 'en' ? c.name_en : c.name_ro })}
                            </Button>
                          )}
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
