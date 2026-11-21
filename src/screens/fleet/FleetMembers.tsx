import { Check, Lock, Minus, ShieldCheck, User, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../../components/buttonClass';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Disclosure, DisclosureGroup } from '../../components/Disclosure';
import { EmptyState } from '../../components/EmptyState';
import { DetailFacts, DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows } from '../../components/ListRow';
import { SelectField } from '../../components/SelectField';
import { useI18n } from '../../i18n/context';
import { formatMoney } from '../../i18n/format';
import { can, FLEET_CAPABILITY_GROUPS, FLEET_ROLES, hasFeature, type FleetCapability, type FleetRole } from '../../lib/fleet';
import { rightsSummary } from '../client/companies/rights';
import { useFleet } from './fleetContext';
import styles from './fleet.module.css';
import { StatusPill } from '../../components/StatusPill';
import { toneOf } from '../../lib/statusTone';
import { LIST_DETAIL_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { HeaderAction } from '../../components/HeaderSlot';

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
  const wide = useMediaQuery(LIST_DETAIL_QUERY);
  // Beside the list (a laptop, C9): a member or a role is chosen, the first member until another is.
  const [chosen, setChosen] = useState<string | null>(null);

  if (!allowed('members.manage')) {
    return <EmptyState icon={Lock} title={t('fleet.members.locked')} body={t('fleet.members.lockedBody')} />;
  }

  // The add, top right of the page (docs/MODEL_DE_FOLOSIRE.md P12).
  const manage = (
    <HeaderAction>
      {companyPage ? (
        <Link to={companyPage} className={buttonClass('primary')}>
          <UserPlus size={18} aria-hidden="true" /> {t('fleet.members.manage')}
        </Link>
      ) : (
        <Button variant="primary" disabled title={t('fleet.preview.notSaved')}>
          <UserPlus size={18} aria-hidden="true" /> {t('fleet.members.invite')}
        </Button>
      )}
    </HeaderAction>
  );
  const limit = data.company.manager_approval_limit;

  // Beside the members (a laptop, C9): the members and the roles as rows, what is chosen on the right — a
  // member's role and rights, or one role's rights.
  if (wide) {
    const key = chosen ?? (data.members[0] ? `member:${data.members[0].id}` : `role:${FLEET_ROLES[0]}`);
    const member = key.startsWith('member:') ? data.members.find((m) => m.id === key.slice(7)) : undefined;
    const pickedRole: FleetRole = member ? member.role : ((key.slice(5) as FleetRole) || FLEET_ROLES[0]);
    const allCaps = FLEET_CAPABILITY_GROUPS.flatMap((g) => g.caps);
    const rightsCount = (r: FleetRole) => t('fleet.members.allowedOf', { n: allCaps.filter((c) => can(r, c)).length, total: allCaps.length });
    const summary = member && member.role !== 'admin' && rightsOn ? rightsSummary(lang, member.role, member.extra_caps, ownLimit ? member.approval_limit : null) : null;
    return (
      <>
      {manage}
      <ListDetailLayout
        wide
        open={false}
        backTo="."
        backLabel={t('fleet.members.title')}
        header={null}
        list={
          <>
            <ListRows label={t('fleet.members.title')}>
              {data.members.map((m) => (
                <ListRow
                  key={m.id}
                  icon={<User size={18} />}
                  title={m.name || m.email}
                  detail={m.accepted_at ? m.email : t('fleet.members.pending', { email: m.email })}
                  status={<StatusPill tone={toneOf(ROLE_TONE[m.role])}>{t(`fleet.role.${m.role}`)}</StatusPill>}
                  selected={key === `member:${m.id}`}
                  onSelect={() => setChosen(`member:${m.id}`)}
                />
              ))}
            </ListRows>
            <ListRows label={t('fleet.members.rights')}>
              {FLEET_ROLES.map((r) => (
                <ListRow
                  key={r}
                  icon={<ShieldCheck size={18} />}
                  title={t(`fleet.role.${r}`)}
                  detail={rightsCount(r)}
                  selected={key === `role:${r}`}
                  onSelect={() => setChosen(`role:${r}`)}
                />
              ))}
            </ListRows>
          </>
        }
        detail={
          <DetailPane
            key={key}
            id={key}
            icon={member ? <User size={18} /> : <ShieldCheck size={18} />}
            title={member ? member.name || member.email : t(`fleet.role.${pickedRole}`)}
            detail={member ? (member.accepted_at ? member.email : t('fleet.members.pending', { email: member.email })) : undefined}
            status={member ? <StatusPill tone={toneOf(ROLE_TONE[member.role])}>{t(`fleet.role.${member.role}`)}</StatusPill> : undefined}
          >
            {member && (
              <DetailFacts
                items={[
                  { label: t('fleet.members.selectRole'), value: t(`fleet.role.${member.role}`) },
                  ...(summary ? [{ label: t('fleet.members.rights'), value: summary }] : []),
                ]}
              />
            )}
            {pickedRole === 'manager' && (
              <p className={styles.hintLine}>{limit === null ? t('fleet.members.noLimit') : t('fleet.members.limit', { amount: formatMoney(lang, limit) })}</p>
            )}
            <RightsGroups role={pickedRole} />
          </DetailPane>
        }
      />
      </>
    );
  }

  return (
    <div className={styles.stack}>
      <Card className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{t('fleet.members.title')}</h2>
        </div>
        {/* The add, top right of the page (docs/MODEL_DE_FOLOSIRE.md P12). */}
        {manage}
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
              <StatusPill tone={toneOf(ROLE_TONE[m.role])}>{t(`fleet.role.${m.role}`)}</StatusPill>
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
        <RightsGroups role={role} />
      </Card>
    </div>
  );
}

/** One role's rights, grouped in sections that open on a tap. */
function RightsGroups({ role }: { role: FleetRole }) {
  const { t } = useI18n();
  return (
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
  );
}

/** The rights a role has only in part: a manager approves up to the limit, a driver sees own cars. */
function limitNote(role: FleetRole, c: FleetCapability): 'fleet.members.upToLimit' | 'fleet.members.ownCars' | null {
  if (role === 'manager' && c === 'quotes.approve') return 'fleet.members.upToLimit';
  if (role === 'driver' && c === 'documents.view') return 'fleet.members.ownCars';
  return null;
}
