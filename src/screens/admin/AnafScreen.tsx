import { Landmark, SearchX } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ChoiceFilters } from '../../components/Filters';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { buttonClass } from '../../components/buttonClass';
import { DetailFacts, DetailPane, ListDetailLayout, type DetailMessage } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { StatusPill } from '../../components/StatusPill';
import { fetchCompanyChecks, type CompanyCategory, type CompanyCheckRow } from '../../data/adminTools';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { verifyCompany } from '../../data/shop';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { formatDayMonth } from '../../i18n/format';
import { plural } from '../../i18n/translate';
import {
  COMPANY_FILTERS,
  companyFilterCounts,
  filterCompanyChecks,
  isCompanyFilter,
  isCompanyProblem,
  type CompanyFilter,
} from '../../lib/adminTools';
import { useListDetail } from '../../lib/useListDetail';
import { useLoad } from '../../lib/useLoad';
import { toneOf } from '../../lib/statusTone';
import { ExportButton } from './ExportButton';
import { Pill, ShopStatePill } from './parts';
import { ADMIN_ANAF_PATH, adminShopPath } from './paths';
import { useUrlParams } from './useUrlParams';
import { dateTime } from './format';
import styles from './admin.module.css';
import { PageHeader } from '../../components/PageHeader';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_ANAF_PATH);

const TONE: Record<CompanyCategory, 'green' | 'amber' | 'red' | 'grey' | 'blue'> = {
  ok: 'green',
  name_mismatch: 'amber',
  inactive: 'red',
  deregistered: 'red',
  not_found: 'red',
  unchecked: 'grey',
  no_cui: 'grey',
};

/** Yes / No / — for a VAT answer. */
function vatText(t: (k: MessageKey) => string, v: boolean | null): string {
  return v === null ? '—' : t(v ? 'admin.yes' : 'admin.no');
}

function CompanyDetail({ r, notice, onChecked }: { r: CompanyCheckRow; notice: string | null; onChecked: (unavailable: boolean) => Promise<void> }) {
  const { t, lang } = useI18n();
  // What waits or went wrong is said first, under the title.
  const message: DetailMessage | undefined = r.hidden_at
    ? { tone: 'problem', text: `${t('anaf.hidden')}: ${t('anaf.hiddenSince', { date: dateTime(lang, r.hidden_at) })}` }
    : r.deadline
      ? { tone: 'action', text: `${t('anaf.waiting')}: ${t('anaf.deadline', { date: formatDayMonth(lang, r.deadline) })}` }
      : r.vat_mismatch
        ? { tone: 'action', text: `${t('anaf.vatMismatch')}: ${t('anaf.vatMismatchBody')}` }
        : undefined;
  return (
    <DetailPane
      id={r.shop_id}
      icon={<Landmark size={20} />}
      title={r.shop_name}
      detail={[r.display_id, r.city].filter(Boolean).join(' · ')}
      status={<Pill tone={TONE[r.category]}>{t(`anaf.category.${r.category}`)}</Pill>}
      message={message}
      actions={
        <>
          {r.vat_id && (
            <ActionButton
              variant="secondary"
              block={false}
              onAction={async () => {
                const result = await verifyCompany(r.shop_id);
                await onChecked('unavailable' in result);
              }}
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              canRetry={canRetryRpc}
            >
              {t(r.anaf_checked_at ? 'company.recheck' : 'company.check')}
            </ActionButton>
          )}
          <Link className={buttonClass('secondary')} to={adminShopPath(r.shop_id)}>
            {t('anaf.openShop')}
          </Link>
        </>
      }
    >
      {notice && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}
      <DetailFacts
        items={[
          { label: t('anaf.state'), value: <ShopStatePill state={r.state} /> },
          { label: t('anaf.cui'), value: r.vat_id ? <span className="mono">{r.vat_id}</span> : '—' },
          { label: t('anaf.declaredName'), value: r.legal_name || '—' },
          { label: t('anaf.officialName'), value: r.anaf_name || '—' },
          { label: t('anaf.address'), value: r.anaf_address || '—' },
          { label: t('anaf.vatDeclared'), value: r.vat_id ? vatText(t, r.vat_payer) : '—' },
          { label: t('anaf.vatAnaf'), value: r.anaf_status ? vatText(t, r.anaf_vat_payer) : '—' },
          { label: t('anaf.checkedAt'), value: r.anaf_checked_at ? dateTime(lang, r.anaf_checked_at) : '—' },
        ]}
      />
    </DetailPane>
  );
}

/**
 * Raport ANAF (Eduard, 2 oct): every shop's company as ANAF answered it — code, CUI, the declared and
 * the official name, active / inactive / struck off / unknown, the VAT question, when it was checked —
 * in categories (problems first), with "Verifică din nou" on each and the list as an Excel file.
 * The consequences are automatic (company_enforcement): the owner is told, gets a deadline, and the
 * shop leaves the search after it until ANAF confirms the company; each card shows the deadline or since when.
 */
export function AnafScreen() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const { state, reload, setData } = useLoad(fetchCompanyChecks);
  const { params, setParam, text, setText } = useUrlParams();
  const filterParam = params.get('categorie');
  const filter: CompanyFilter = isCompanyFilter(filterParam) ? filterParam : 'all';
  const query = useDeferredValue(text);
  const all = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (all ? filterCompanyChecks(all, query, filter) : []), [all, query, filter]);
  const counts = useMemo(() => (all ? companyFilterCounts(all) : null), [all]);
  // The answer of a check, shown in the detail of the shop it was made for.
  const [notice, setNotice] = useState<{ shopId: string; text: string } | null>(null);

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per shop, the chosen one beside the list
  // from 1024 px (in its place below).
  const { wide, selectedId, open, select } = useListDetail(
    shown.map((r) => r.shop_id),
    'firma',
  );
  const chosen = shown.find((r) => r.shop_id === selectedId) ?? null;

  const header = (
    <>
      <PageHeader back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }} title={t('anaf.title')} subtitle={all ? plural(lang, 'unit.shops', shown.length) : null} />
      <p className={styles.muted}>{t('anaf.intro')}</p>
      {all && all.length > 0 && counts && (
        <div className={styles.controls}>
          <SearchField
            id="admin-anaf-q"
            label={t('anaf.search')}
            placeholder={t('anaf.search')}
            value={text}
            onChange={setText}
            onClear={() => {
              setText('');
              setParam({ q: null });
            }}
            clearLabel={t('admin.search.clear')}
          />
          <ChoiceFilters
            groups={[
              {
                key: 'categorie',
                title: t('anaf.categories'),
                options: COMPANY_FILTERS.map((f) => ({
                  value: f,
                  label: `${t(`anaf.filter.${f}` as MessageKey)} · ${counts[f]}`,
                })),
                value: filter,
                defaultValue: 'all',
                onChange: (v) => setParam({ categorie: v === 'all' ? null : v }),
              },
            ]}
            onClearAll={() => setParam({ categorie: null })}
            end={<ExportButton<CompanyCheckRow> kind="company_checks" narrow={(rows) => filterCompanyChecks(rows, query, filter)} ids={shown.map((r) => r.shop_id)} />}
          />
        </div>
      )}
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.loadError')} onRetry={reload} />;
  else if (all && all.length === 0) list = <EmptyState icon={Landmark} title={t('admin.shops.empty')} />;
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
              setParam({ q: null, categorie: null });
            }}
          >
            {t('admin.clearFilters')}
          </Button>
        }
      />
    );
  else
    list = (
      <ListRows label={t('anaf.title')}>
        {shown.map((r) => (
          <ListRow
            key={r.shop_id}
            icon={<Landmark size={20} />}
            title={r.shop_name}
            detail={[r.display_id, r.city, r.vat_id].filter(Boolean).join(' · ')}
            status={<StatusPill tone={toneOf(TONE[r.category])}>{t(`anaf.category.${r.category}`)}</StatusPill>}
            attention={isCompanyProblem(r)}
            selected={wide && r.shop_id === selectedId}
            onSelect={() => select(r.shop_id)}
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
        backLabel={t('anaf.title')}
        header={header}
        list={list}
        detail={
          chosen && (
            <CompanyDetail
              key={chosen.shop_id}
              r={chosen}
              notice={notice?.shopId === chosen.shop_id ? notice.text : null}
              onChecked={async (unavailable) => {
                setNotice({ shopId: chosen.shop_id, text: unavailable ? t('company.unavailable') : t('anaf.checked', { shop: chosen.shop_name }) });
                setData(await fetchCompanyChecks());
              }}
            />
          )
        }
      />
    </div>
  );
}
