import { X } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { EmbeddedProvider } from '../../../lib/embedded';
import { DetailFrame } from '../../../components/ListDetailLayout';
import { useI18n } from '../../../i18n/context';
import { RICH_PANEL_QUERY, useMediaQuery } from '../../../lib/useMediaQuery';
import { VehicleHistoryScreen } from '../history/VehicleHistoryScreen';
import { GARAGE_PATH } from '../paths';
import { ReportPreviewScreen } from '../report/ReportPreviewScreen';
import { CarFormScreen } from './CarFormScreen';
import { GarageScreen } from './GarageScreen';
import styles from './garage.module.css';

/**
 * Everything under /c/garaj: the cars, a car's form, its history and its report (Eduard, 21 Nov 2026).
 * On a phone each is a page of its own, as ever. From 1024 px the cars stay on the left, each card with
 * its history links and its four reminders, and what is opened from a card — „Editează”, the history, the
 * report, „Adaugă” — opens on the right, in the same address, so a link or Back finds it again.
 */
export function GarageSpace() {
  const { t } = useI18n();
  const wide = useMediaQuery(RICH_PANEL_QUERY);
  const { carId } = useParams();
  const { pathname, state } = useLocation();
  // Opened from Cont (the history of a car, a report) it stays a page of its own, with its way back.
  const from = (state as { from?: string } | null)?.from;
  const standalone = from === 'account' || from === 'reports';
  const sub = pathname.replace(/\/+$/, '').slice(GARAGE_PATH.length + 1);
  const screen =
    sub === '' ? null : sub.endsWith('/istoric') ? <VehicleHistoryScreen /> : sub.endsWith('/raport') ? <ReportPreviewScreen /> : <CarFormScreen />;

  if (!wide || standalone) return screen ?? <GarageScreen />;
  return (
    <GarageScreen
      wide
      selectedCarId={carId}
      detail={
        screen && (
          <DetailFrame>
            <div className={styles.paneBar}>
              <Link to={GARAGE_PATH} className={styles.paneClose} aria-label={t('common.close')}>
                <X size={18} aria-hidden="true" />
              </Link>
            </div>
            <EmbeddedProvider value>{screen}</EmbeddedProvider>
          </DetailFrame>
        )
      }
    />
  );
}
