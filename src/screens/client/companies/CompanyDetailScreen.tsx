import { Building2, Copy, KeyRound, Repeat, ShieldCheck, Truck, UserMinus, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { buttonClass } from '../../../components/buttonClass';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Checkbox } from '../../../components/Checkbox';
import { EmptyState } from '../../../components/EmptyState';
import { Field } from '../../../components/Field';
import { LoadError } from '../../../components/LoadError';
import { MoreActions } from '../../../components/MoreActions';
import { PageHeader } from '../../../components/PageHeader';
import { SelectField } from '../../../components/SelectField';
import { SkeletonList } from '../../../components/Skeleton';
import {
  companyInviteLink,
  fetchCompany,
  fetchMyCompanies,
  inviteCompanyMember,
  listCompanyMembers,
  newInviteToken,
  removeCompanyMember,
  setCompanyMemberRights,
  setCompanyMemberRole,
  setCompanyRules,
  transferCompanyAdmin,
  updateCompany,
  type Company,
  type CompanyMember,
} from '../../../data/companies';
import { rpcErrorMessage } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { formatDate, formatMoney } from '../../../i18n/format';
import { can, FLEET_ROLES, memberCan, type FleetRole } from '../../../lib/fleet';
import { importAmount } from '../../../lib/importRows';
import { looksLikeEmail } from '../../../lib/password';
import { useLoad } from '../../../lib/useLoad';
import { isValidCui, isValidRegCom, normalizeCode } from '../../../lib/validators';
import { COMPANIES_PATH, fleetSpacePath } from './paths';
import { RolePill } from './RolePill';
import { rightsSummary, ticksFor } from './rights';
import styles from './companies.module.css';

interface Loaded {
  company: Company;
  role: FleetRole;
  members: CompanyMember[];
}

/** A retry of the same request must send the same token (the server answers it with the first result). */
function useTokenPerRequest() {
  const ref = useRef<{ requestId: string; token: string } | null>(null);
  return (requestId: string) => {
    if (ref.current?.requestId !== requestId) ref.current = { requestId, token: newInviteToken() };
    return ref.current.token;
  };
}

/**
 * One company (T63b): its details and rules (the admin edits them), the team with roles, invitations
 * by link, the hand-over of the administration and leaving. Every action is a database function that
 * checks the role again and logs the change; the buttons only follow the role.
 */
export function CompanyDetailScreen() {
  const { t } = useI18n();
  const { companyId = '' } = useParams();
  const load = useCallback(async (): Promise<Loaded | null> => {
    const [company, mine] = await Promise.all([fetchCompany(companyId), fetchMyCompanies()]);
    const role = mine.find((c) => c.id === companyId)?.role;
    if (!company || !role) return null;
    return { company, role, members: await listCompanyMembers(companyId) };
  }, [companyId]);
  const { state, reload, setData } = useLoad(load);

  let body;
  if (state.status === 'loading') body = <SkeletonList />;
  else if (state.status === 'error') body = <LoadError message={t('cos.loadError')} onRetry={reload} />;
  else if (!state.data) body = <EmptyState icon={Building2} title={t('rpcError.company_not_found')} />;
  else
    body = (
      <Company
        data={state.data}
        onChange={(next) => setData(next)}
        refresh={async () => {
          const next = await load();
          setData(next);
        }}
      />
    );

  return (
    <div className={styles.page}>
      <PageHeader
        back={{ to: COMPANIES_PATH, label: t('cos.title') }}
        title={state.status === 'ready' && state.data ? state.data.company.name : t('cos.company')}
        subtitle={state.status === 'ready' && state.data ? <RolePill role={state.data.role} /> : undefined}
        actions={
          state.status === 'ready' && state.data ? (
            <Link to={fleetSpacePath(companyId)} className={buttonClass('primary')}>
              <Truck size={18} aria-hidden="true" /> {t('cos.openFleet')}
            </Link>
          ) : undefined
        }
      />
      {body}
    </div>
  );
}

function Company({ data, onChange, refresh }: { data: Loaded; onChange: (next: Loaded) => void; refresh: () => Promise<void> }) {
  const { company, role, members } = data;
  const refreshMembers = async () => onChange({ ...data, members: await listCompanyMembers(company.id) });
  const me = members.find((m) => m.is_me);
  // The admin's part stays the admin's (Eduard, 31 Oct: "la fel ca la service"); a member may invite
  // or manage the budget only when the admin gave them that right (T63i).
  const isAdmin = role === 'admin';
  const canInvite = memberCan(role, me?.extra_caps, 'members.manage');

  return (
    <div className={styles.columns}>
      <div className={styles.stack}>
        <DetailsCard company={company} canEdit={can(role, 'company.manage')} onSaved={(c) => onChange({ ...data, company: c })} />
        {memberCan(role, me?.extra_caps, 'budget.manage') && (
          <RulesCard company={company} limitEditable={isAdmin} onSaved={(c) => onChange({ ...data, company: c })} />
        )}
      </div>
      <div className={styles.stack}>
        {canInvite && <InviteCard companyId={company.id} adminInvite={isAdmin} onInvited={refreshMembers} />}
        <MembersCard members={members} isAdmin={isAdmin} canInvite={canInvite} onChanged={refreshMembers} onRoleChanged={refresh} />
        {me && <LeaveCard me={me} members={members} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ details

type DetailField = 'name' | 'vat' | 'regCom';

function DetailsCard({ company, canEdit, onSaved }: { company: Company; canEdit: boolean; onSaved: (c: Company) => void }) {
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(company.name);
  const [vat, setVat] = useState(company.vat_id ?? '');
  const [regCom, setRegCom] = useState(company.reg_com ?? '');
  const [address, setAddress] = useState(company.address ?? '');
  const [errors, setErrors] = useState<Partial<Record<DetailField, string>>>({});
  const nameRef = useRef<HTMLInputElement>(null);

  return (
    <Card className={styles.stack}>
      <h2 className={styles.cardTitle}>{t('cos.details')}</h2>
      {!editing ? (
        <>
          <dl className={styles.facts}>
            <Fact label={t('cos.field.name')} value={company.name} />
            <Fact label={t('cos.field.vat')} value={company.vat_id} mono />
            <Fact label={t('cos.field.regCom')} value={company.reg_com} mono />
            <Fact label={t('cos.field.address')} value={company.address} />
          </dl>
          {canEdit && (
            <div>
              <Button onClick={() => setEditing(true)}>{t('cos.edit')}</Button>
            </div>
          )}
        </>
      ) : (
        <form className={styles.stack} noValidate onSubmit={(e) => e.preventDefault()}>
          <Field ref={nameRef} label={t('cos.field.name')} value={name} maxLength={120} error={errors.name} onChange={(e) => setName(e.target.value)} />
          <div className={styles.twoCols}>
            <Field label={t('cos.field.vat')} hint={t('cos.optional')} value={vat} maxLength={14} mono upper error={errors.vat} onChange={(e) => setVat(e.target.value.toUpperCase())} />
            <Field label={t('cos.field.regCom')} hint={t('cos.optional')} value={regCom} maxLength={20} mono upper error={errors.regCom} onChange={(e) => setRegCom(e.target.value.toUpperCase())} />
          </div>
          <Field label={t('cos.field.address')} hint={t('cos.optional')} value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
          <div className={styles.buttons}>
            <ActionButton
              submit
              variant="primary"
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              onAction={async (requestId) => {
                const next: Partial<Record<DetailField, string>> = {};
                if (name.trim().length < 2) next.name = t('rpcError.company_name_invalid');
                if (vat.trim() && !isValidCui(vat.trim())) next.vat = t('rpcError.company_vat_invalid');
                if (regCom.trim() && !isValidRegCom(regCom.trim())) next.regCom = t('rpcError.company_regcom_invalid');
                setErrors(next);
                if (Object.keys(next).length > 0) {
                  nameRef.current?.focus();
                  return;
                }
                const saved = await updateCompany(
                  company.id,
                  {
                    name: name.trim(),
                    vatId: vat.trim() ? normalizeCode(vat.trim()) : null,
                    regCom: regCom.trim() ? normalizeCode(regCom.trim()) : null,
                    address: address.trim() || null,
                  },
                  requestId,
                );
                onSaved(saved);
                setEditing(false);
              }}
            >
              {t('common.save')}
            </ActionButton>
            <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd className={mono && value ? 'mono' : undefined}>{value ?? <span className={styles.muted}>—</span>}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ rules

function RulesCard({ company, limitEditable, onSaved }: { company: Company; limitEditable: boolean; onSaved: (c: Company) => void }) {
  const { t, lang } = useI18n();
  const text = (n: number | null) => (n === null ? '' : String(n).replace('.', lang === 'ro' ? ',' : '.'));
  const [limit, setLimit] = useState(text(company.manager_approval_limit));
  const [monthly, setMonthly] = useState(text(company.budget_monthly));
  const [yearly, setYearly] = useState(text(company.budget_yearly));
  const [error, setError] = useState<string | null>(null);

  const amountField = (label: string, hint: string, value: string, set: (v: string) => void) => (
    <Field
      label={label}
      hint={hint}
      value={value}
      inputMode="decimal"
      mono
      end={<span className={styles.fieldEnd}>{t('fleet.form.currency')}</span>}
      onChange={(e) => {
        set(e.target.value);
        setError(null);
      }}
    />
  );

  return (
    <Card className={styles.stack}>
      <h2 className={styles.cardTitle}>{t('cos.rules')}</h2>
      <p className={styles.note}>{t('cos.rules.note')}</p>
      <form className={styles.stack} noValidate onSubmit={(e) => e.preventDefault()}>
        {limitEditable && amountField(t('cos.rules.limit'), t('cos.rules.limitHint'), limit, setLimit)}
        <div className={styles.twoCols}>
          {amountField(t('fleet.budget.month'), t('cos.rules.emptyNone'), monthly, setMonthly)}
          {amountField(t('fleet.budget.year'), t('cos.rules.emptyNone'), yearly, setYearly)}
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div>
          <ActionButton
            submit
            variant="primary"
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            onAction={async (requestId) => {
              const parse = (v: string) => (v.trim() ? importAmount(v) : null);
              const values = [parse(limit), parse(monthly), parse(yearly)];
              const bad = [limit, monthly, yearly].some((v, i) => v.trim() && (values[i] === null || (i > 0 && values[i] === 0)));
              if (bad) {
                setError(t('rpcError.company_rules_invalid'));
                return;
              }
              // Only the admin changes the approval limit: the others send it back as it is.
              const approvalLimit = limitEditable ? (values[0] ?? null) : company.manager_approval_limit;
              onSaved(await setCompanyRules(company.id, { approvalLimit, budgetMonthly: values[1] ?? null, budgetYearly: values[2] ?? null }, requestId));
            }}
          >
            {t('common.save')}
          </ActionButton>
        </div>
      </form>
      {company.manager_approval_limit !== null && (
        <p className={styles.note}>{t('fleet.members.limit', { amount: formatMoney(lang, company.manager_approval_limit) })}</p>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ team

function InviteCard({ companyId, adminInvite, onInvited }: { companyId: string; adminInvite: boolean; onInvited: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<FleetRole>('driver');
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const tokenFor = useTokenPerRequest();

  return (
    <Card className={styles.stack}>
      <h2 className={styles.cardTitle}>{t('cos.invite')}</h2>
      <form className={styles.stack} noValidate onSubmit={(e) => e.preventDefault()}>
        <div className={styles.twoCols}>
          <Field
            label={t('cos.invite.email')}
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={254}
            value={email}
            error={error}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
          <SelectField
            label={t('cos.invite.role')}
            value={role}
            onChange={(e) => setRole(e.target.value as FleetRole)}
            options={FLEET_ROLES.filter((r) => adminInvite || r !== 'admin').map((r) => ({ value: r, label: t(`fleet.role.${r}`) }))}
          />
        </div>
        <p className={styles.note}>{t('cos.invite.billed')}</p>
        <div>
          <ActionButton
            submit
            variant="primary"
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            onAction={async (requestId) => {
              if (!looksLikeEmail(email)) {
                setError(t('auth.error.emailFormat'));
                return;
              }
              const token = tokenFor(requestId);
              await inviteCompanyMember(companyId, email.trim(), role, token, requestId);
              setLink({ email: email.trim().toLowerCase(), url: companyInviteLink(token) });
              setEmail('');
              await onInvited().catch(() => undefined);
            }}
          >
            <UserPlus size={18} aria-hidden="true" /> {t('cos.invite.send')}
          </ActionButton>
        </div>
      </form>
      {link && <LinkPanel email={link.email} url={link.url} />}
    </Card>
  );
}

function LinkPanel({ email, url }: { email: string; url: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      inputRef.current?.select();
    }
  }

  return (
    <Card inset className={styles.stack}>
      <p role="status">{t('cos.invite.link', { email })}</p>
      <label htmlFor="company-invite-link" className="visually-hidden">
        {t('staff.link')}
      </label>
      <input id="company-invite-link" ref={inputRef} readOnly className={`mono ${styles.linkInput}`} value={url} onFocus={(e) => e.target.select()} />
      <Button variant="primary" block onClick={() => void copy()}>
        <Copy size={18} aria-hidden="true" />
        {copied ? t('staff.copied') : t('staff.copy')}
      </Button>
    </Card>
  );
}

function MembersCard({
  members,
  isAdmin,
  canInvite,
  onChanged,
  onRoleChanged,
}: {
  members: CompanyMember[];
  isAdmin: boolean;
  canInvite: boolean;
  onChanged: () => Promise<void>;
  onRoleChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <Card className={styles.stack}>
      <h2 className={styles.cardTitle}>{t('cos.team')}</h2>
      <ul className={styles.members}>
        {members.map((m) => (
          <MemberRow key={m.id} member={m} isAdmin={isAdmin} canInvite={canInvite} onChanged={onChanged} onRoleChanged={onRoleChanged} />
        ))}
      </ul>
    </Card>
  );
}

/**
 * One member: name, address, role and the rights the admin gave. The actions sit behind "Mai multe"
 * (Eduard, 31 Oct: not a pile of buttons): Drepturi, the role, the administration and removing —
 * the admin's; someone the admin let invite removes members who are not admins.
 */
function MemberRow({
  member,
  isAdmin,
  canInvite,
  onChanged,
  onRoleChanged,
}: {
  member: CompanyMember;
  isAdmin: boolean;
  canInvite: boolean;
  onChanged: () => Promise<void>;
  onRoleChanged: () => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<'view' | 'rights' | 'role' | 'remove' | 'transfer'>('view');
  const [role, setRole] = useState<FleetRole>(member.role);
  const pending = member.accepted_at === null;
  const who = member.name || member.email;
  const rights = member.role === 'admin' ? '' : rightsSummary(lang, member.role, member.extra_caps, member.approval_limit);
  const canRemove = isAdmin || (canInvite && member.role !== 'admin');

  const items =
    member.is_me || mode !== 'view'
      ? []
      : [
          ...(isAdmin && member.role !== 'admin'
            ? [{ key: 'rights', label: t('cos.member.rights'), icon: <KeyRound size={18} aria-hidden="true" />, onSelect: () => setMode('rights') }]
            : []),
          ...(isAdmin && !pending
            ? [{ key: 'role', label: t('cos.member.changeRole'), icon: <Repeat size={18} aria-hidden="true" />, onSelect: () => setMode('role') }]
            : []),
          ...(isAdmin && !pending && member.role !== 'admin'
            ? [{ key: 'transfer', label: t('cos.member.makeAdmin'), icon: <ShieldCheck size={18} aria-hidden="true" />, onSelect: () => setMode('transfer') }]
            : []),
          ...(canRemove
            ? [
                {
                  key: 'remove',
                  label: t(pending ? 'staff.cancelInvite' : 'staff.remove'),
                  icon: <UserMinus size={18} aria-hidden="true" />,
                  onSelect: () => setMode('remove'),
                  danger: true,
                },
              ]
            : []),
        ];

  return (
    <li className={styles.member}>
      <div className={styles.memberHead}>
        <div className={styles.memberText}>
          <span className={styles.memberName}>
            {who}
            {member.is_me && <span className={styles.muted}> ({t('staff.you')})</span>}
          </span>
          {member.name && <span className={styles.muted}>{member.email}</span>}
          {pending && (
            <span className={member.expired ? styles.warn : styles.muted}>
              {member.expired ? t('staff.expired') : t('staff.pending', { date: formatDate(lang, new Date(member.invited_at)) })}
            </span>
          )}
          {rights && <span className={styles.rightsLine}>{rights}</span>}
        </div>
        <div className={styles.memberEnd}>
          <RolePill role={member.role} />
          {items.length > 0 && <MoreActions items={items} />}
        </div>
      </div>

      {mode === 'rights' && <RightsPanel member={member} onDone={async () => {
        await onChanged();
        setMode('view');
      }} onCancel={() => setMode('view')} />}

      {mode === 'role' && (
        <div className={styles.confirm}>
          <SelectField label={t('cos.invite.role')} value={role} onChange={(e) => setRole(e.target.value as FleetRole)} options={FLEET_ROLES.map((r) => ({ value: r, label: t(`fleet.role.${r}`) }))} />
          <div className={styles.buttons}>
            <ActionButton
              variant="primary"
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              onAction={async (requestId) => {
                await setCompanyMemberRole(member.id, role, requestId);
                await onChanged();
                setMode('view');
              }}
            >
              {t('common.save')}
            </ActionButton>
            <Button onClick={() => setMode('view')}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}

      {mode === 'transfer' && (
        <div className={styles.confirm}>
          <p>{t('cos.member.makeAdminConfirm', { name: who })}</p>
          <div className={styles.buttons}>
            <ActionButton
              variant="primary"
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              onAction={async (requestId) => {
                await transferCompanyAdmin(member.id, requestId);
                // The caller is now a fleet manager: the role, the team and the actions are read again.
                await onRoleChanged();
              }}
            >
              {t('cos.member.makeAdminYes')}
            </ActionButton>
            <Button onClick={() => setMode('view')}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}

      {mode === 'remove' && (
        <div className={styles.confirm}>
          <p>{pending ? t('staff.cancelInviteConfirm', { email: member.email }) : t('cos.member.removeConfirm', { name: who })}</p>
          <div className={styles.buttons}>
            <ActionButton
              variant="danger"
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              onAction={async (requestId) => {
                await removeCompanyMember(member.id, requestId);
                await onChanged();
              }}
            >
              {t(pending ? 'staff.cancelYes' : 'staff.removeYes')}
            </ActionButton>
            <Button onClick={() => setMode('view')}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Drepturi (T63i): what the admin lets this member do beyond the role — one tick each, only the
 * ticks the role does not have already — and, for someone who approves, their own limit (empty =
 * the company's). Inviting members says that each colleague after the included ones is billed.
 */
function RightsPanel({ member, onDone, onCancel }: { member: CompanyMember; onDone: () => Promise<void>; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const ticks = ticksFor(member.role);
  const [caps, setCaps] = useState<ReadonlySet<string>>(() => new Set(member.extra_caps ?? []));
  const text = (n: number | null) => (n === null ? '' : String(n).replace('.', lang === 'ro' ? ',' : '.'));
  const [limit, setLimit] = useState(text(member.approval_limit ?? null));
  const [error, setError] = useState<string | null>(null);
  const approves = memberCan(member.role, [...caps], 'quotes.approve');

  function toggle(tick: (typeof ticks)[number], on: boolean) {
    setCaps((prev) => {
      const next = new Set(prev);
      for (const c of tick.caps) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return next;
    });
  }

  return (
    <div className={styles.confirm}>
      <p className={styles.panelTitle}>{t('cos.rights.title', { name: member.name || member.email })}</p>
      <div className={styles.rightsList}>
        {ticks.map((tick) => (
          <div key={tick.key}>
            <Checkbox checked={tick.caps.every((c) => caps.has(c))} onChange={(e) => toggle(tick, e.target.checked)}>
              {t(`cos.right.${tick.key}` as 'cos.right.approve')}
            </Checkbox>
            {tick.key === 'members' && tick.caps.every((c) => caps.has(c)) && <p className={styles.note}>{t('cos.rights.membersBilled')}</p>}
          </div>
        ))}
      </div>
      {approves && (
        <Field
          label={t('cos.rights.limit')}
          hint={t('cos.rights.limitHint')}
          value={limit}
          inputMode="decimal"
          mono
          error={error}
          end={<span className={styles.fieldEnd}>{t('fleet.form.currency')}</span>}
          onChange={(e) => {
            setLimit(e.target.value);
            setError(null);
          }}
        />
      )}
      <div className={styles.buttons}>
        <ActionButton
          variant="primary"
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          onAction={async (requestId) => {
            const value = approves && limit.trim() ? importAmount(limit) : null;
            if (approves && limit.trim() && value === null) {
              setError(t('rpcError.company_rights_invalid'));
              return;
            }
            await setCompanyMemberRights(member.id, [...caps], value, requestId);
            await onDone();
          }}
        >
          {t('common.save')}
        </ActionButton>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}

function LeaveCard({ me, members }: { me: CompanyMember; members: CompanyMember[] }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const lastAdmin = me.role === 'admin' && members.filter((m) => m.role === 'admin' && m.accepted_at).length <= 1;

  return (
    <Card className={styles.stack}>
      <h2 className={styles.cardTitle}>{t('cos.leave')}</h2>
      {lastAdmin ? (
        <p className={styles.note}>{t('rpcError.last_admin')}</p>
      ) : !confirming ? (
        <div>
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            {t('cos.leave')}
          </Button>
        </div>
      ) : (
        <div className={styles.confirm}>
          <p>{t('cos.leave.confirm')}</p>
          <div className={styles.buttons}>
            <ActionButton
              variant="danger"
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              onAction={async (requestId) => {
                await removeCompanyMember(me.id, requestId);
                navigate(COMPANIES_PATH, { replace: true });
              }}
            >
              {t('cos.leave.yes')}
            </ActionButton>
            <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
