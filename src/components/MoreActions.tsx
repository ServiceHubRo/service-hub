import { MoreHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/context';
import { Button } from './Button';
import { buttonClass } from './buttonClass';
import { MenuButton, type MenuItem } from './MenuButton';
import styles from './MoreActions.module.css';

/**
 * The less used actions of a card behind one "Mai multe" (Eduard, 10 Oct: tidy like an iPhone,
 * one main action in sight). At the end of the actions row; a single action shows as itself.
 */
export function MoreActions({ items }: { items: MenuItem[] }) {
  const { t } = useI18n();
  const only = items.length === 1 ? items[0] : undefined;
  if (items.length === 0) return null;
  if (only) {
    return (
      <div className={styles.end}>
        {'to' in only ? (
          <Link to={only.to} state={only.state} className={buttonClass('secondary', false)}>
            {only.icon}
            {only.label}
          </Link>
        ) : 'href' in only ? (
          <a href={only.href} className={buttonClass('secondary', false)} {...(only.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {only.icon}
            {only.label}
          </a>
        ) : (
          <Button variant={only.danger ? 'danger' : 'secondary'} onClick={only.onSelect}>
            {only.icon}
            {only.label}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className={styles.end}>
      <MenuButton
        narrow
        block={false}
        variant="secondary"
        items={items}
        label={
          <>
            <MoreHorizontal size={18} aria-hidden="true" />
            {t('common.more')}
          </>
        }
      />
    </div>
  );
}
