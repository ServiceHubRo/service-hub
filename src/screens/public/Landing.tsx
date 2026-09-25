import {
  BadgeCheck,
  CalendarCheck,
  CarFront,
  Check,
  ClipboardCheck,
  FileCheck2,
  Gauge,
  Mail,
  MessageCircle,
  Search,
  Star,
  Tag,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { LangSwitch } from '../../app/LangSwitch';
import { LoadingScreen } from '../../app/LoadingScreen';
import { homeOf } from '../../app/roles';
import { useSession } from '../../app/sessionContext';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { Banner } from '../../components/Banner';
import { buttonClass } from '../../components/buttonClass';
import { LogoTile } from '../../components/LogoTile';
import { Wordmark } from '../../components/Wordmark';
import { fetchPublicPricing, type PublicPricing } from '../../data/pricing';
import { takeAuthLinkError } from '../../data/supabase';
import { useI18n } from '../../i18n/context';
import { formatRating } from '../../i18n/format';
import type { MessageKey } from '../../i18n/ro';
import { CONTACT, whatsappLink } from '../../lib/contact';
import { IS_TEST_BUILD } from '../../lib/env';
import { LEGAL_DOCS } from '../../lib/legal';
import { includedColleagues } from '../../lib/subscription';
import { formatPhone } from '../../lib/validators';
import { signUpPath } from '../auth/paths';
import styles from './Landing.module.css';

interface Feature {
  icon: LucideIcon;
  title: MessageKey;
  text: MessageKey;
}

const DRIVER_FEATURES: Feature[] = [
  { icon: Search, title: 'landing.driver1.title', text: 'landing.driver1.text' },
  { icon: ClipboardCheck, title: 'landing.driver2.title', text: 'landing.driver2.text' },
  { icon: CarFront, title: 'landing.driver3.title', text: 'landing.driver3.text' },
];

const SHOP_FEATURES: Feature[] = [
  { icon: CalendarCheck, title: 'landing.shop1.title', text: 'landing.shop1.text' },
  { icon: Gauge, title: 'landing.shop2.title', text: 'landing.shop2.text' },
  { icon: FileCheck2, title: 'landing.shop3.title', text: 'landing.shop3.text' },
];

const STEPS: { title: MessageKey; text: MessageKey }[] = [
  { title: 'landing.step1.title', text: 'landing.step1.text' },
  { title: 'landing.step2.title', text: 'landing.step2.text' },
  { title: 'landing.step3.title', text: 'landing.step3.text' },
  { title: 'landing.step4.title', text: 'landing.step4.text' },
];

type PricingState = { status: 'loading' } | { status: 'ready'; pricing: PublicPricing } | { status: 'error' };

/**
 * The public page at `/` for visitors (P18, T18): what Service-Hub is, for drivers and for shops,
 * with the texts and contact of the earlier "în curând" page. Signed-in users go to their home.
 * No invented figures, testimonials or logos.
 */
export function Landing() {
  const { t } = useI18n();
  const session = useSession();
  const location = useLocation();
  const state = location.state as { accountDeleted?: boolean; leaving?: boolean } | null;
  const accountDeleted = state?.accountDeleted;
  const [linkError] = useState(takeAuthLinkError);
  useDocumentTitle(t('landing.title'));

  if (session.status === 'loading') return <LoadingScreen />;
  // Just logged out (the session ends a moment after we arrive): stay here.
  if (session.status === 'signedIn' && session.role && !state?.leaving) {
    return <Navigate to={homeOf(session.role)} replace />;
  }
  // An expired or used email link lands here: explain it on the sign-in screen.
  if (linkError && session.status === 'signedOut' && !accountDeleted) {
    return <Navigate to="/intra" replace state={{ linkError: true }} />;
  }

  return (
    <div className={styles.page}>
      <div className="status-backdrop" aria-hidden="true" />
      <header className={styles.header}>
        <div className={`${styles.wrap} ${styles.headerRow}`}>
          <Link to="/" className={styles.brand} aria-label={t('app.title')}>
            <LogoTile size={34} />
            <Wordmark size={21} />
          </Link>
          <div className={styles.headerEnd}>
            <LangSwitch />
            <div className={styles.headerAuth}>
              <Link to="/intra" className={buttonClass('secondary', false, styles.headerButton)}>
                {t('landing.signIn')}
              </Link>
              <Link to={signUpPath()} className={buttonClass('primary', false, styles.headerButton)}>
                {t('landing.signUp')}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={`${styles.wrap} ${styles.heroGrid}`}>
            <div className={styles.heroText}>
              {accountDeleted && <Banner>{t('account.deleted')}</Banner>}
              <h1 id="landing-title" className={styles.heroTitle}>
                {t('landing.heroTitle')} <span className={styles.highlight}>{t('landing.heroHighlight')}</span>
              </h1>
              <p className={styles.lead}>{t('landing.heroText')}</p>
              <div className={styles.heroActions}>
                <Link to={signUpPath('client')} className={buttonClass('primary', false, styles.bigButton)}>
                  {t('landing.imClient')}
                </Link>
                <Link to={signUpPath('shop')} className={buttonClass('secondary', false, styles.bigButton)}>
                  {t('landing.imShop')}
                </Link>
              </div>
              <p className={styles.free}>
                <Check size={18} aria-hidden="true" className={styles.freeIcon} />
                <span>{t('landing.drivers')}</span>
              </p>
            </div>
            <PhoneMockup />
          </div>
        </section>

        <FeatureSection
          id="soferi"
          eyebrow={t('landing.forDrivers')}
          title={t('landing.driversTitle')}
          features={DRIVER_FEATURES}
        />

        <section className={`${styles.section} ${styles.dark}`} id="service" aria-labelledby="landing-shops">
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>{t('landing.forShops')}</p>
            <h2 id="landing-shops" className={styles.h2}>
              {t('landing.shopsTitle')}
            </h2>
            <p className={styles.sub}>{t('landing.shopsText')}</p>
            <FeatureCards features={SHOP_FEATURES} />
            <PriceBlock />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="landing-how">
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>{t('landing.howEyebrow')}</p>
            <h2 id="landing-how" className={styles.h2}>
              {t('landing.howTitle')}
            </h2>
            <ol className={styles.steps}>
              {STEPS.map((step, i) => (
                <li key={step.title} className={styles.step}>
                  <span className={styles.stepNum} aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3 className={styles.h3}>{t(step.title)}</h3>
                  <p className={styles.cardText}>{t(step.text)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="landing-trust">
          <div className={styles.wrap}>
            <div className={styles.trust}>
              <span className={styles.trustIcon} aria-hidden="true">
                <BadgeCheck size={30} />
              </span>
              <div>
                <h2 id="landing-trust" className={styles.trustTitle}>
                  {t('landing.trustTitle')}
                </h2>
                <p className={styles.trustText}>{t('landing.trustText')}</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.footerGrid}`}>
          <div className={styles.footerCol}>
            <h2 className={styles.footerTitle}>{t('landing.contact')}</h2>
            <a href={`mailto:${CONTACT.email}`} className={styles.footerLink} aria-label={t('landing.emailLabel', { email: CONTACT.email })}>
              <Mail size={16} aria-hidden="true" />
              {CONTACT.email}
            </a>
            <a
              href={whatsappLink(CONTACT.phone)}
              className={styles.footerLink}
              aria-label={t('landing.phoneLabel', { phone: formatPhone(CONTACT.phone) })}
            >
              <MessageCircle size={16} aria-hidden="true" />
              <span className="mono">{formatPhone(CONTACT.phone)}</span>
            </a>
          </div>
          <nav className={styles.footerCol} aria-labelledby="landing-legal">
            <h2 id="landing-legal" className={styles.footerTitle}>
              {t('account.legal')}
            </h2>
            {LEGAL_DOCS.map((doc) => (
              <Link key={doc.id} to={`/legal/${doc.id}`} className={styles.footerLink}>
                {t(doc.titleKey)}
              </Link>
            ))}
            <Link to="/verifica" className={styles.footerLink}>
              {t('landing.verifyReport')}
            </Link>
            {IS_TEST_BUILD && (
              <Link to="/dev/componente" className={styles.footerLink}>
                {t('landing.components')}
              </Link>
            )}
          </nav>
          <p className={styles.footerNote}>{t('landing.footerNote')}</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureSection({ id, eyebrow, title, features }: { id: string; eyebrow: string; title: string; features: Feature[] }) {
  return (
    <section className={styles.section} id={id} aria-labelledby={`${id}-title`}>
      <div className={styles.wrap}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2 id={`${id}-title`} className={styles.h2}>
          {title}
        </h2>
        <FeatureCards features={features} />
      </div>
    </section>
  );
}

function FeatureCards({ features }: { features: Feature[] }) {
  const { t } = useI18n();
  return (
    <ul className={styles.cards}>
      {features.map(({ icon: Icon, title, text }) => (
        <li key={title} className={styles.card}>
          <span className={styles.cardIcon} aria-hidden="true">
            <Icon size={22} />
          </span>
          <h3 className={styles.h3}>{t(title)}</h3>
          <p className={styles.cardText}>{t(text)}</p>
        </li>
      ))}
    </ul>
  );
}

/** The price as set now in Setări platformă; without it, the offer without figures. */
function PriceBlock() {
  const { t, money, plural, lang } = useI18n();
  const [state, setState] = useState<PricingState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    fetchPublicPricing().then(
      (pricing) => alive && setState({ status: 'ready', pricing }),
      () => alive && setState({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={styles.price}>
      <div className={styles.priceText} aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && (
          <>
            <span className="visually-hidden">{t('common.loading')}</span>
            <span className={styles.priceSkeleton} aria-hidden="true" />
          </>
        )}
        {state.status === 'ready' && (
          <>
            <p className={styles.priceMain}>
              <span className={styles.priceFigure}>
                {t('landing.priceMain', { price: money(state.pricing.launchRon ?? state.pricing.subscriptionRon) })}
              </span>
              <span aria-hidden="true"> · </span>
              <span>{t('landing.priceNoVat')}</span>
              {state.pricing.trialDays > 0 && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>{t('landing.priceTrial', { days: plural('unit.days', state.pricing.trialDays) })}</span>
                </>
              )}
              <span aria-hidden="true"> · </span>
              <span>{t('landing.priceNoContract')}</span>
            </p>
            {state.pricing.launchRon !== null && (
              <p className={styles.priceNote}>
                <Tag size={16} aria-hidden="true" />
                <span>
                  {t('landing.priceLaunch', {
                    shops: plural('unit.shops', state.pricing.launchShops),
                    price: money(state.pricing.subscriptionRon),
                  })}
                </span>
              </p>
            )}
            {state.pricing.seatRon > 0 && (
              <p className={styles.priceNote}>
                <Users size={16} aria-hidden="true" />
                <span>
                  {state.pricing.freeSeats > 0
                    ? t('landing.priceSeatIncluded', {
                        included: includedColleagues(lang, state.pricing.freeSeats),
                        price: money(state.pricing.seatRon),
                      })
                    : t('landing.priceSeat', { price: money(state.pricing.seatRon) })}
                </span>
              </p>
            )}
          </>
        )}
        {state.status === 'error' && <p className={styles.priceMain}>{t('landing.priceFallback')}</p>}
        <p className={styles.priceNote}>
          <Check size={16} aria-hidden="true" />
          <span>{t('landing.noCommission')}</span>
        </p>
      </div>
      <div className={styles.priceActions}>
        <Link to={signUpPath('shop')} className={buttonClass('primary', false, styles.bigButton)}>
          {t('landing.joinShop')}
        </Link>
        <a href={whatsappLink(CONTACT.phone)} className={buttonClass('secondary', false, styles.bigButton)}>
          <MessageCircle size={18} aria-hidden="true" />
          {t('landing.whatsapp')}
        </a>
      </div>
    </div>
  );
}

/** A simplified search screen: decoration only, hidden from screen readers (the text says it all). */
function PhoneMockup() {
  const { t, money, lang } = useI18n();
  return (
    <div className={styles.mockWrap} aria-hidden="true">
      <div className={styles.phone}>
        <div className={styles.phoneBar}>
          <LogoTile size={22} />
          <Wordmark size={14} />
        </div>
        <div className={styles.mockSearch}>
          <Search size={15} />
          <span>{t('landing.mock.search')}</span>
        </div>
        {[
          { name: t('landing.mock.shop1'), rating: formatRating(lang, 4.8) },
          { name: t('landing.mock.shop2'), rating: formatRating(lang, 4.6) },
        ].map((shop, i) => (
          <div key={shop.name} className={`${styles.mockCard} ${i === 0 ? styles.mockCardLit : ''}`}>
            <div className={styles.mockRow}>
              <span className={styles.mockName}>{shop.name}</span>
              <span className={styles.mockRating}>
                <Star size={12} fill="currentColor" />
                {shop.rating}
              </span>
            </div>
            <div className={styles.mockRow}>
              <span className={styles.mockMuted}>{t('landing.mock.slot')}</span>
              <span className={styles.mockBook}>{t('landing.mock.book')}</span>
            </div>
          </div>
        ))}
        <div className={`${styles.mockCard} ${styles.mockCardLit}`}>
          <span className={styles.mockPill}>{t('landing.mock.quote')}</span>
          <div className={styles.mockLine}>
            <span>{t('landing.mock.pads')}</span>
            <b>{money(280)}</b>
          </div>
          <div className={styles.mockLine}>
            <span>{t('landing.mock.labor')}</span>
            <b>{money(150)}</b>
          </div>
          <div className={styles.mockTotal}>
            <span>{t('landing.mock.total')}</span>
            <span>{money(430)}</span>
          </div>
          <span className={styles.mockAccept}>{t('landing.mock.accept')}</span>
        </div>
      </div>
    </div>
  );
}
