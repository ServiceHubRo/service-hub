import { Copy, Download, Printer, Share2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { LoadError } from '../../../components/LoadError';
import { LogoTile } from '../../../components/LogoTile';
import { SkeletonList } from '../../../components/Skeleton';
import { Wordmark } from '../../../components/Wordmark';
import { fetchOwnShop } from '../../../data/shop';
import { shopLinkUrl } from '../../../data/shopLink';
import { useI18n } from '../../../i18n/context';
import { qrPath, qrSvgFile } from '../../../lib/qr';
import { saveFile } from '../../../lib/saveFile';
import { useLoad } from '../../../lib/useLoad';
import { ACCOUNT_PATH } from '../paths';
import styles from './shopShare.module.css';

/**
 * Linkul service-ului (T31b, Cont → `/s/cont/link`): the address that opens the shop's page,
 * to send from the shop's own phone or WhatsApp; its QR code to download; and a poster for the
 * front desk, printed from here. Service-Hub sends nothing to anyone: the shop shares it itself.
 */
export function ShopShareScreen() {
  const { t } = useI18n();
  const load = useCallback(() => fetchOwnShop(), []);
  const { state, reload } = useLoad(load);
  const [copied, setCopied] = useState(false);

  const shop = state.status === 'ready' ? state.data : null;
  const url = shop ? shopLinkUrl(shop.id) : '';
  const qr = useMemo(() => (url ? qrPath(url) : null), [url]);
  const message = shop ? t('slk.message', { shop: shop.name, url }) : '';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className="no-print">
        <BackLink to={ACCOUNT_PATH} label={t('nav.account')} />
      </div>
      <h1 className="no-print">{t('slk.title')}</h1>
      <p className={`${styles.muted} no-print`}>{t('slk.intro')}</p>

      {state.status === 'loading' && <SkeletonList count={2} />}
      {state.status === 'error' && <LoadError message={t('slk.loadError')} onRetry={reload} />}

      {shop && qr && (
        <>
          <Card className={`${styles.section} no-print`}>
            <p className={styles.label} id="slk-url">
              {t('slk.link')}
            </p>
            <p className={`mono ${styles.url}`} aria-labelledby="slk-url">
              {url}
            </p>
            <div className={styles.buttons}>
              <Button variant="primary" onClick={() => void copy()}>
                <Copy size={18} aria-hidden="true" />
                {copied ? t('slk.copied') : t('slk.copy')}
              </Button>
              {canShare && (
                <Button
                  variant="secondary"
                  onClick={() => void navigator.share({ title: shop.name, text: message, url }).catch(() => {})}
                >
                  <Share2 size={18} aria-hidden="true" />
                  {t('slk.share')}
                </Button>
              )}
            </div>
            <p className={styles.muted} role="status">
              {copied ? t('slk.copiedNote') : t('slk.how')}
            </p>
          </Card>

          <Card className={`${styles.section} no-print`}>
            <p className={styles.label}>{t('slk.qr')}</p>
            <QrImage size={qr.size} path={qr.path} label={t('slk.qrLabel', { shop: shop.name })} className={styles.qr} />
            <div className={styles.buttons}>
              <Button variant="secondary" onClick={() => void saveFile(qrSvgFile(url), 'service-hub-qr.svg')}>
                <Download size={18} aria-hidden="true" />
                {t('slk.download')}
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer size={18} aria-hidden="true" />
                {t('slk.print')}
              </Button>
            </div>
          </Card>

          <Card className={`${styles.section} no-print`}>
            <p className={styles.label}>{t('slk.posterPreview')}</p>
            <div className={styles.previewFrame}>
              <Poster shopName={shop.name} url={url} qr={qr} />
            </div>
          </Card>

          {/* The poster as it prints: the whole page, in the platform's colors. The page rule lives
              only while this screen is open, so Istoric and the other prints keep their margins. */}
          <style>{'@page { size: A4 portrait; margin: 0; }'}</style>
          <div className={`${styles.printPage} print-only`}>
            <Poster shopName={shop.name} url={url} qr={qr} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The front-desk poster (T31b): the platform's dark background, the logo and wordmark, the title
 * in amber, the QR code dark on white (so every phone reads it) in an amber frame, the address.
 * Sized in container units, so the preview and the printed A4 page are the same design.
 */
function Poster({ shopName, url, qr }: { shopName: string; url: string; qr: { size: number; path: string } }) {
  const { t } = useI18n();
  return (
    <div className={styles.poster} aria-hidden="true">
      <div className={styles.posterBrand}>
        <LogoTile size="10cqw" />
        <Wordmark size="7cqw" />
      </div>
      <p className={styles.posterTagline}>{t('auth.tagline')}</p>
      <p className={styles.posterTitle}>{t('slk.posterTitle')}</p>
      <p className={styles.posterShop}>{shopName}</p>
      <div className={styles.posterQrFrame}>
        <QrImage size={qr.size} path={qr.path} label="" className={styles.posterQr} />
      </div>
      <p className={styles.posterHow}>{t('slk.posterHow')}</p>
      <p className={`mono ${styles.posterUrl}`}>{url}</p>
    </div>
  );
}

function QrImage({ size, path, label, className }: { size: number; path: string; label: string; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      shapeRendering="crispEdges"
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
