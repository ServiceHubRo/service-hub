import { useEffect, useState } from 'react';
import { useSession } from '../../app/sessionContext';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { fetchMyShop, updateProfile, type ShopSummary } from '../../data/profile';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatPhone, normalizePhone } from '../../lib/validators';
import styles from './account.module.css';

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** Avatar, name, phone, shop name + city (shops), account ID; name and phone editable inline. */
export function IdentityCard() {
  const { t, lang } = useI18n();
  const session = useSession();
  const profile = session.profile!;
  const [shop, setShop] = useState<ShopSummary | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.name ?? '');
  const [phone, setPhone] = useState(profile.phone ? formatPhone(profile.phone) : '');
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});

  useEffect(() => {
    if (profile.role !== 'shop') return;
    let cancelled = false;
    fetchMyShop(profile.id)
      .then((s) => {
        if (!cancelled) setShop(s);
      })
      .catch(() => undefined); // the card still shows the person; the shop line is extra
    return () => {
      cancelled = true;
    };
  }, [profile.id, profile.role]);

  function startEdit() {
    setName(profile.name ?? '');
    setPhone(profile.phone ? formatPhone(profile.phone) : '');
    setErrors({});
    setEditing(true);
  }

  async function save() {
    const next: { name?: string; phone?: string } = {};
    if (name.trim() === '') next.name = t('auth.error.nameRequired');
    const normalized = normalizePhone(phone);
    if (!normalized) next.phone = t('auth.error.phoneInvalid');
    setErrors(next);
    if (next.name || next.phone || !normalized) return;
    const saved = await updateProfile(profile.id, { name: name.trim(), phone: normalized });
    session.setProfile(saved);
    setEditing(false);
  }

  return (
    <Card>
      <div className={styles.identity}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(profile.name)}
        </span>
        <div className={styles.who}>
          <span className={styles.name}>{profile.name || t('account.noName')}</span>
          {profile.phone && <span className={`mono ${styles.muted}`}>{formatPhone(profile.phone)}</span>}
          {shop && (
            <span className={styles.muted}>
              {shop.name}
              {shop.city ? ` · ${shop.city}` : ''}
            </span>
          )}
          <span className={styles.small}>
            {t('account.id')}: <span className="mono">{profile.display_id}</span>
          </span>
        </div>
      </div>
      {!editing && (
        <div className={styles.panel}>
          <Button block onClick={startEdit}>
            {t('account.edit')}
          </Button>
        </div>
      )}
      {editing && (
        <form className={styles.panel} noValidate onSubmit={(e) => e.preventDefault()}>
          <Field
            label={t('auth.name')}
            autoComplete="name"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
          />
          <Field
            label={t('auth.phone')}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            mono
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={errors.phone}
            hint={profile.role === 'shop' ? t('account.phoneReverify') : undefined}
          />
          <div className={styles.buttons}>
            <ActionButton submit onAction={save} errorMessage={(e) => rpcErrorMessage(lang, e)}>
              {t('common.save')}
            </ActionButton>
            <Button block onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
