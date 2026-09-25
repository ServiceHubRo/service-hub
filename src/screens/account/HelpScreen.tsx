import { LifeBuoy, Mail, MessageCircle } from 'lucide-react';
import { NAV } from '../../app/roles';
import { useSession } from '../../app/sessionContext';
import { BackLink } from '../../components/BackLink';
import { Card } from '../../components/Card';
import { Tile } from '../../components/Tile';
import { useI18n } from '../../i18n/context';
import { CONTACT, whatsappLink } from '../../lib/contact';
import { formatPhone } from '../../lib/validators';
import styles from './account.module.css';

/**
 * How to reach the Service-Hub team (clients and shops): email and WhatsApp, each opening with the
 * account's ID already written, so the team finds the account at once.
 */
export function HelpScreen({ role }: { role: 'client' | 'shop' }) {
  const { t } = useI18n();
  const { profile } = useSession();
  const id = profile?.display_id ?? '';
  const subject = t('help.emailSubject', { id });
  const message = t('help.whatsappText', { id });

  return (
    <div className={styles.page}>
      <BackLink to={NAV[role].account.path} label={t('nav.account')} />
      <h1>{t('help.title')}</h1>
      <p className={styles.sub}>{t('help.intro')}</p>

      <div className={styles.tiles}>
        <Tile
          href={`mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}`}
          icon={Mail}
          label={t('help.email')}
          hint={CONTACT.email}
        />
        <Tile
          href={`${whatsappLink(CONTACT.phone)}?text=${encodeURIComponent(message)}`}
          icon={MessageCircle}
          label={t('help.whatsapp')}
          hint={formatPhone(CONTACT.phone)}
        />
      </div>

      <Card>
        <p className={styles.helpId}>
          <LifeBuoy size={18} aria-hidden="true" />
          <span>
            {t('help.idLabel')}: <span className="mono">{id}</span>
          </span>
        </p>
        <p className={styles.helpNote}>{t('help.idNote')}</p>
      </Card>

      <p className={styles.helpNote}>{t(role === 'client' ? 'help.clientNote' : 'help.shopNote')}</p>
    </div>
  );
}
