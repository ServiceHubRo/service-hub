import { Copy, Download, Printer, Share2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { LoadError } from '../../../components/LoadError';
import { LogoTile } from '../../../components/LogoTile';
import { SelectField } from '../../../components/SelectField';
import { SkeletonList } from '../../../components/Skeleton';
import { Wordmark } from '../../../components/Wordmark';
import { fetchOwnShop } from '../../../data/shop';
import { shopLinkUrl } from '../../../data/shopLink';
import { useI18n } from '../../../i18n/context';
import { translate, type Lang } from '../../../i18n/translate';
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
type PosterLang = 'ro' | 'en' | 'both';
type Paper = 'A4' | 'A5' | 'A6';
const PAPERS: readonly Paper[] = ['A4', 'A5', 'A6'];

export function ShopShareScreen() {
  const { t, lang } = useI18n();
  const load = useCallback(() => fetchOwnShop(), []);
  const { state, reload } = useLoad(load);
  const [copied, setCopied] = useState(false);
  // The poster's own language (a shop working in Romanian may want it in English, or both) and paper.
  const [posterLang, setPosterLang] = useState<PosterLang>(lang === 'en' ? 'en' : 'ro');
  const [paper, setPaper] = useState<Paper>('A4');

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
            </div>
          </Card>

          <Card className={`${styles.section} no-print`}>
            <p className={styles.label}>{t('slk.posterPreview')}</p>
            <div className={styles.choices}>
              <SelectField
                label={t('slk.posterLang')}
                value={posterLang}
                options={[
                  { value: 'ro', label: t('wi.lang.ro') },
                  { value: 'en', label: t('wi.lang.en') },
                  { value: 'both', label: t('slk.lang.both') },
                ]}
                onChange={(e) => setPosterLang(e.target.value as PosterLang)}
              />
              <SelectField
                label={t('slk.posterSize')}
                value={paper}
                options={PAPERS.map((p) => ({ value: p, label: t(`slk.paper.${p}`) }))}
                onChange={(e) => setPaper(e.target.value as Paper)}
              />
            </div>
            <div className={styles.previewFrame}>
              <Poster shopName={shop.name} url={url} qr={qr} lang={posterLang} />
            </div>
            <Button variant="primary" onClick={() => window.print()}>
              <Printer size={18} aria-hidden="true" />
              {t('slk.print')}
            </Button>
          </Card>

          {/* The poster as it prints: the whole page, in the platform's colors. The page rule lives
              only while this screen is open, so Istoric and the other prints keep their margins. */}
          <style>{`@page { size: ${paper} portrait; margin: 0; }`}</style>
          <div className={`${styles.printPage} print-only`}>
            <Poster shopName={shop.name} url={url} qr={qr} lang={posterLang} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The front-desk poster (T31b): the platform's dark background, the logo and wordmark, the title
 * in amber, the QR code dark on white (so every phone reads it) in an amber frame, the address.
 * Sized in container units, so the preview and the printed page (A4, A5 or A6) are the same design.
 * In Romanian, English or both, whatever the language of the app.
 */
function Poster({
  shopName,
  url,
  qr,
  lang,
}: {
  shopName: string;
  url: string;
  qr: { size: number; path: string };
  lang: PosterLang;
}) {
  const first: Lang = lang === 'en' ? 'en' : 'ro';
  const second: Lang | null = lang === 'both' ? 'en' : null;
  return (
    <div className={styles.poster} aria-hidden="true">
      <div className={styles.posterBrand}>
        <LogoTile size="10cqw" />
        <Wordmark size="7cqw" />
      </div>
      <p className={styles.posterTagline}>{translate(first, 'auth.tagline')}</p>
      <p className={styles.posterTitle}>{translate(first, 'slk.posterTitle')}</p>
      {second && <p className={styles.posterTitleSecond}>{translate(second, 'slk.posterTitle')}</p>}
      <p className={styles.posterShop}>{shopName}</p>
      <div className={styles.posterQrFrame}>
        <QrImage size={qr.size} path={qr.path} label="" className={styles.posterQr} />
      </div>
      <p className={styles.posterHow}>{translate(first, 'slk.posterHow')}</p>
      {second && <p className={styles.posterHowSecond}>{translate(second, 'slk.posterHow')}</p>}
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
