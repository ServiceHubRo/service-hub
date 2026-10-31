import { Check, Lock, Minus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../../components/buttonClass';
import { Chip, ChipRow } from '../../components/Chip';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { useI18n } from '../../i18n/context';
import { formatMoney } from '../../i18n/format';
import { can, FLEET_CAPABILITIES, FLEET_ROLES, type FleetCapability, type FleetRole } from '../../lib/fleet';
import { rightsSummary } from '../client/companies/rights';
import { useFleet } from './fleetContext';
import pill from '../../components/StatusBadge.module.css';
import styles from './fleet.module.css';

const ROLE_TONE = { admin: 'amber', manager: 'blue', driver: 'muted', accountant: 'green' } as const;

/**
 * Membri (docs/FLEET_PLAN.md §6): who belongs to the company, with which role, and what each role
 * may do — the same table the database will enforce (`fleet_can`). Only the admin manages members.
 */
export function FleetMembers() {
  const { t, lang } = useI18n();
  const { data, allowed, companyPage } = useFleet();
  const [phoneRole, setPhoneRole] = useState<FleetRole>('manager');

  if (!allowed('members.manage')) {
    return <EmptyState icon={Lock} title={t('fleet.members.locked')} body={t('fleet.members.lockedBody')} />;
  }

  const limit = data.company.manager_approval_limit;
  return (
    <div className={styles.stack}>
      <Card className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{t('fleet.members.title')}</h2>
          {companyPage ? (
            <Link to={companyPage} className={buttonClass('primary')}>
              <UserPlus size={18} aria-hidden="true" /> {t('fleet.members.manage')}
            </Link>
          ) : (
            <Button variant="primary" disabled title={t('fleet.preview.notSaved')}>
              <UserPlus size={18} aria-hidden="true" /> {t('fleet.members.invite')}
            </Button>
          )}
        </div>
        <ul className={styles.plainList}>
          {data.members.map((m) => (
            <li key={m.id} className={styles.lineRow}>
              <span className={styles.lineText}>
                <span>{m.name || m.email}</span>
                <span className={styles.muted}>{m.accepted_at ? m.email : t('fleet.members.pending', { email: m.email })}</span>
                {m.role !== 'admin' && rightsSummary(lang, m.role, m.extra_caps, m.approval_limit) && (
                  <span className={styles.rightsLine}>{rightsSummary(lang, m.role, m.extra_caps, m.approval_limit)}</span>
                )}
              </span>
              <span className={`${pill.pill} ${pill[ROLE_TONE[m.role]]}`}>{t(`fleet.role.${m.role}`)}</span>
            </li>
          ))}
        </ul>
        <p className={styles.hintLine}>{limit === null ? t('fleet.members.noLimit') : t('fleet.members.limit', { amount: formatMoney(lang, limit) })}</p>
      </Card>

      <Card className={styles.card}>
        <h2 className={styles.cardTitle}>{t('fleet.members.rights')}</h2>
        <div className={styles.rightsPhone}>
          <ChipRow label={t('fleet.members.rights')}>
            {FLEET_ROLES.map((r) => (
              <Chip key={r} selected={phoneRole === r} onClick={() => setPhoneRole(r)}>
                {t(`fleet.role.${r}`)}
              </Chip>
            ))}
          </ChipRow>
          <ul className={styles.plainList}>
            {FLEET_CAPABILITIES.map((c) => {
              const yes = can(phoneRole, c);
              const note = limitNote(phoneRole, c);
              return (
                <li key={c} className={styles.lineRow}>
                  <span className={styles.lineText}>
                    <span className={yes ? undefined : styles.muted}>{t(`fleet.cap.${c}`)}</span>
                    {note && <span className={styles.muted}>{t(note)}</span>}
                  </span>
                  {yes ? <Check size={18} className={styles.green} aria-label={t('fleet.members.yes')} /> : <Minus size={18} className={styles.muted} aria-label={t('fleet.members.no')} />}
                </li>
              );
            })}
          </ul>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.matrix}>
            <caption className="visually-hidden">{t('fleet.members.rights')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('fleet.members.right')}</th>
                {FLEET_ROLES.map((r) => (
                  <th key={r} scope="col">
                    {t(`fleet.role.${r}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FLEET_CAPABILITIES.map((c) => (
                <tr key={c}>
                  <th scope="row">{t(`fleet.cap.${c}`)}</th>
                  {FLEET_ROLES.map((r) => {
                    const yes = can(r, c);
                    const note = limitNote(r, c);
                    return (
                      <td key={r}>
                        {yes ? <Check size={16} className={styles.green} aria-hidden="true" /> : <Minus size={16} className={styles.muted} aria-hidden="true" />}
                        <span className="visually-hidden">{yes ? t('fleet.members.yes') : t('fleet.members.no')}</span>
                        {note && <span className={styles.limited}>{t(note)}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/** The rights a role has only in part: a manager approves up to the limit, a driver sees own cars. */
function limitNote(role: FleetRole, c: FleetCapability): 'fleet.members.upToLimit' | 'fleet.members.ownCars' | null {
  if (role === 'manager' && c === 'quotes.approve') return 'fleet.members.upToLimit';
  if (role === 'driver' && c === 'documents.view') return 'fleet.members.ownCars';
  return null;
}
