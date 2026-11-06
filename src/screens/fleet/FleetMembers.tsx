import { Check, Lock, Minus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../../components/buttonClass';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Disclosure, DisclosureGroup } from '../../components/Disclosure';
import { EmptyState } from '../../components/EmptyState';
import { SelectField } from '../../components/SelectField';
import { useI18n } from '../../i18n/context';
import { formatMoney } from '../../i18n/format';
import { can, FLEET_CAPABILITY_GROUPS, FLEET_ROLES, hasFeature, type FleetCapability, type FleetRole } from '../../lib/fleet';
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
  const { data, allowed, companyPage, plan } = useFleet();
  // The rights given show only while the plan applies them (T65).
  const rightsOn = hasFeature(plan, 'member_rights');
  const ownLimit = hasFeature(plan, 'approval_custom');
  const [role, setRole] = useState<FleetRole>('manager');

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
                {m.role !== 'admin' && rightsOn && rightsSummary(lang, m.role, m.extra_caps, ownLimit ? m.approval_limit : null) && (
                  <span className={styles.rightsLine}>{rightsSummary(lang, m.role, m.extra_caps, ownLimit ? m.approval_limit : null)}</span>
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
        {/* One role at a time (Eduard, 6 Nov): a dropdown, then its rights grouped in sections. */}
        <SelectField
          className={styles.roleSelect}
          label={t('fleet.members.selectRole')}
          value={role}
          onChange={(e) => setRole(e.target.value as FleetRole)}
          options={FLEET_ROLES.map((r) => ({ value: r, label: t(`fleet.role.${r}`) }))}
        />
        <DisclosureGroup label={t('fleet.members.rightsOf', { role: t(`fleet.role.${role}`) })}>
          {FLEET_CAPABILITY_GROUPS.map((g) => {
            const allowedHere = g.caps.filter((c) => can(role, c)).length;
            return (
              <Disclosure
                key={g.key}
                title={t(`fleet.capGroup.${g.key}` as 'fleet.capGroup.company')}
                summary={t('fleet.members.allowedOf', { n: allowedHere, total: g.caps.length })}
              >
                <ul className={styles.rightsList}>
                  {g.caps.map((c) => {
                    const yes = can(role, c);
                    const note = limitNote(role, c);
                    return (
                      <li key={c} className={styles.rightRow}>
                        <span className={styles.lineText}>
                          <span className={yes ? undefined : styles.muted}>{t(`fleet.cap.${c}`)}</span>
                          {note && <span className={styles.muted}>{t(note)}</span>}
                        </span>
                        <span className={`${styles.rightState} ${yes ? styles.rightYes : styles.rightNo}`}>
                          {yes ? <Check size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
                          {yes ? t('fleet.members.allowed') : t('fleet.members.denied')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Disclosure>
            );
          })}
        </DisclosureGroup>
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
