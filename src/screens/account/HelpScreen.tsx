import { Compass, Inbox, LifeBuoy, Mail, MessageCircle } from 'lucide-react';
import { homeOf, NAV } from '../../app/roles';
import { requestTour } from '../../app/tour/tourStore';
import { useSession } from '../../app/sessionContext';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/Card';
import { Tile } from '../../components/Tile';
import { useI18n } from '../../i18n/context';
import { CONTACT, whatsappLink } from '../../lib/contact';
import { formatPhone } from '../../lib/validators';
import { HelpCenterHome } from '../help/HelpCenterHome';
import { requestsPath } from './paths';
import styles from './account.module.css';

/**
 * Ajutor și contact (clients and shops): the Help Center first (A4: search, categories, recommended
 * articles, frequent questions), then the way to the Service-Hub team — the support requests (A3),
 * email and WhatsApp, each opening with the account's ID already written. Below, the app tour (T39).
 */
export function HelpScreen({ role }: { role: 'client' | 'shop' }) {
  const { t } = useI18n();
  const { profile } = useSession();
  const id = profile?.display_id ?? '';
  const subject = t('help.emailSubject', { id });
  const message = t('help.whatsappText', { id });

  return (
    <div className={styles.page}>
      <PageHeader back={{ to: NAV[role].account.path, label: t('nav.account') }} title={t('help.title')} subtitle={t('help.subtitle')} />

      <HelpCenterHome role={role} />

      <h2 className={styles.section}>{t('help.contact.title')}</h2>
      {/* A3a: requests written in the app, answered by the Service-Hub team. */}
      <div className={styles.tiles} data-layout="tiles">
        <Tile to={requestsPath(role)} icon={Inbox} label={t('support.my.title')} hint={t('support.my.hint')} />
      </div>

      <div className={styles.tiles} data-layout="tiles">
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

      <div className={styles.tiles} data-layout="tiles">
        <Tile to={homeOf(role)} icon={Compass} label={t('tour.again')} hint={t('tour.againHint')} onClick={requestTour} />
      </div>
    </div>
  );
}
