import { Landmark, SearchX } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip, ChipRow } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SkeletonList } from '../../components/Skeleton';
import { fetchCompanyChecks, type CompanyCategory, type CompanyCheckRow } from '../../data/adminTools';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { verifyCompany } from '../../data/shop';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { plural } from '../../i18n/translate';
import {
  COMPANY_FILTERS,
  companyFilterCounts,
  filterCompanyChecks,
  isCompanyFilter,
  type CompanyFilter,
} from '../../lib/adminTools';
import { useLoad } from '../../lib/useLoad';
import { ExportButton } from './ExportButton';
import { Facts, Pill, ShopStatePill } from './parts';
import { ADMIN_ACCOUNT_PATH, adminShopPath } from './paths';
import { useUrlParams } from './useUrlParams';
import { dateTime } from './format';
import styles from './admin.module.css';

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

function CompanyCard({ r, onChecked }: { r: CompanyCheckRow; onChecked: (unavailable: boolean) => Promise<void> }) {
  const { t, lang } = useI18n();
  return (
    <Card className={styles.stack}>
      <div className={styles.cardHead}>
        <Link className={`${styles.rowTitle} ${styles.link}`} to={adminShopPath(r.shop_id)}>
          {r.shop_name}
        </Link>
        <Pill tone={TONE[r.category]}>{t(`anaf.category.${r.category}`)}</Pill>
      </div>
      <p className={styles.muted}>
        <span className="mono">{r.display_id}</span> · {r.city} · <ShopStatePill state={r.state} />
      </p>
      {r.vat_mismatch && (
        <p className={styles.muted} role="note">
          <Pill tone="amber">{t('anaf.vatMismatch')}</Pill> {t('anaf.vatMismatchBody')}
        </p>
      )}
      <Facts
        rows={[
          [t('anaf.cui'), r.vat_id ? <span key="cui" className="mono">{r.vat_id}</span> : null],
          [t('anaf.declaredName'), r.legal_name],
          [t('anaf.officialName'), r.anaf_name],
          [t('anaf.address'), r.anaf_address],
          [t('anaf.vatDeclared'), r.vat_id ? vatText(t, r.vat_payer) : null],
          [t('anaf.vatAnaf'), r.anaf_status ? vatText(t, r.anaf_vat_payer) : null],
          [t('anaf.checkedAt'), r.anaf_checked_at ? dateTime(lang, r.anaf_checked_at) : null],
        ]}
      />
      {r.vat_id && (
        <div className={styles.panelButtons}>
          <ActionButton
            variant="secondary"
            onAction={async () => {
              const result = await verifyCompany(r.shop_id);
              await onChecked('unavailable' in result);
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {t(r.anaf_checked_at ? 'company.recheck' : 'company.check')}
          </ActionButton>
        </div>
      )}
    </Card>
  );
}

/**
 * Raport ANAF (Eduard, 2 oct): every shop's company as ANAF answered it — code, CUI, the declared and
 * the official name, active / inactive / struck off / unknown, the VAT question, when it was checked —
 * in categories (problems first), with "Verifică din nou" on each and the list as an Excel file.
 * Nothing is blocked automatically: the admin opens the shop and decides.
 */
export function AnafScreen() {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(fetchCompanyChecks);
  const { params, setParam, text, setText } = useUrlParams();
  const filterParam = params.get('categorie');
  const filter: CompanyFilter = isCompanyFilter(filterParam) ? filterParam : 'all';
  const query = useDeferredValue(text);
  const all = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (all ? filterCompanyChecks(all, query, filter) : []), [all, query, filter]);
  const counts = useMemo(() => (all ? companyFilterCounts(all) : null), [all]);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_ACCOUNT_PATH} label={t('nav.account')} />
      <div>
        <h1>{t('anaf.title')}</h1>
        <p className={styles.sub}>{all ? plural(lang, 'unit.shops', shown.length) : t('anaf.sub')}</p>
      </div>
      <p className={styles.muted}>{t('anaf.intro')}</p>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {all && all.length === 0 && <EmptyState icon={Landmark} title={t('admin.shops.empty')} />}
      {all && all.length > 0 && counts && (
        <>
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
            <ChipRow label={t('anaf.categories')}>
              {COMPANY_FILTERS.map((f) => (
                <Chip key={f} selected={filter === f} onClick={() => setParam({ categorie: f === 'all' ? null : f })}>
                  {t(`anaf.filter.${f}` as MessageKey)} · {counts[f]}
                </Chip>
              ))}
            </ChipRow>
            <div>
              <ExportButton<CompanyCheckRow> kind="company_checks" narrow={(rows) => filterCompanyChecks(rows, query, filter)} />
            </div>
          </div>
          {notice && (
            <p className={styles.muted} role="status">
              {notice}
            </p>
          )}
          {shown.length === 0 ? (
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
          ) : (
            <ul className={styles.list}>
              {shown.map((r) => (
                <li key={r.shop_id}>
                  <CompanyCard
                    r={r}
                    onChecked={async (unavailable) => {
                      setNotice(unavailable ? t('company.unavailable') : t('anaf.checked', { shop: r.shop_name }));
                      setData(await fetchCompanyChecks());
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
