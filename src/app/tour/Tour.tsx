import { Sparkles } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/Button';
import { useI18n } from '../../i18n/context';
import { reducedMotion } from '../../lib/motion';
import { findSpot, placeCard, spotBox, TOUR_STEPS, type Box, type TourStep } from './tourSteps';
import styles from './Tour.module.css';

/**
 * The tour itself (T39): the screen dims, one spot stays lit with a card beside it ("2 din 5", a
 * title, a line, "Sari peste" and "Înainte"); the light glides to the next spot. A content spot has
 * an amber frame; a navigation item has none, its icon and label light up. The app behind is inert
 * and does not scroll while it runs; Escape skips it. A welcome card comes first, centered.
 */
export function Tour({ role, name, onDone }: { role: 'client' | 'shop'; name: string | null; onDone: () => void }) {
  const { t } = useI18n();
  // The spots on screen now, fixed for this run.
  const [steps] = useState<TourStep[]>(() => TOUR_STEPS[role].filter((s) => findSpot(s.target)));
  const [index, setIndex] = useState(-1);
  const [spot, setSpot] = useState<Box | null>(null);
  const [card, setCard] = useState({ width: 0, height: 0 });
  const [view, setView] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const step = index >= 0 ? steps[index] : undefined;
  const last = index === steps.length - 1;

  // Light the spot of this step (brought into view first), and follow it while the screen moves.
  const measure = useCallback(() => {
    setView({ width: window.innerWidth, height: window.innerHeight });
    const el = step ? findSpot(step.target) : null;
    setSpot(el ? spotBox(el.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }) : null);
  }, [step]);

  useEffect(() => {
    const el = step ? findSpot(step.target) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 64 || r.bottom > window.innerHeight - 80) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step, measure]);

  // The card's own size decides where it fits (it is a new card at each step).
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      setCard((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [index]);

  // The app behind cannot be reached, nor scrolled, while the tour runs: the lit spot stays put.
  const layerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.getElementById('root');
    const main = document.querySelector<HTMLElement>('main');
    const layer = layerRef.current;
    const block = (event: Event) => event.preventDefault();
    if (root) root.inert = true;
    if (main) main.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    layer?.addEventListener('wheel', block, { passive: false });
    layer?.addEventListener('touchmove', block, { passive: false });
    return () => {
      if (root) root.inert = false;
      if (main) main.style.overflow = '';
      document.documentElement.style.overflow = '';
      layer?.removeEventListener('wheel', block);
      layer?.removeEventListener('touchmove', block);
    };
  }, []);

  // A navigation item lights up itself (its icon and label), without a frame.
  useEffect(() => {
    const el = step?.nav ? findSpot(step.target) : null;
    el?.setAttribute('data-tour-lit', '');
    return () => el?.removeAttribute('data-tour-lit');
  }, [step]);

  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, [index]);

  const pos = placeCard(index < 0 ? null : spot, card, view);
  const next = () => (last ? onDone() : setIndex(index + 1));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDone();
      return;
    }
    // The focus stays on the card's buttons.
    if (event.key === 'Tab') {
      const buttons = [...(cardRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault();
      buttons[(at + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
    }
  }

  const glide = !reducedMotion();

  return createPortal(
    <div ref={layerRef} className={`${styles.layer} ${glide ? styles.glide : ''}`} onKeyDown={onKeyDown}>
      {index >= 0 && spot ? (
        <div
          className={`${styles.spot} ${step?.nav ? styles.spotNav : ''}`}
          data-tour-spot
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
        />
      ) : (
        <div className={styles.dim} />
      )}
      <div
        ref={cardRef}
        key={index}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        style={{ top: pos.top, left: pos.left }}
      >
        {step ? (
          <>
            <p className={styles.counter}>{t('tour.counter', { n: index + 1, total: steps.length })}</p>
            <h2 id={titleId} className={styles.title}>
              {t(step.titleKey)}
            </h2>
            <p id={bodyId} className={styles.body}>
              {t(step.bodyKey)}
            </p>
          </>
        ) : (
          <div className={styles.welcome}>
            <span className={styles.welcomeIcon} aria-hidden="true">
              <Sparkles size={22} />
            </span>
            <h2 id={titleId} className={styles.title}>
              {name ? t('tour.welcome.titleNamed', { name }) : t('tour.welcome.title')}
            </h2>
            <p id={bodyId} className={styles.body}>
              {t('tour.welcome.body')}
            </p>
          </div>
        )}
        {steps.length > 1 && (
          <div className={styles.dots} aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.target} className={i === index ? styles.dotOn : i < index ? styles.dotDone : styles.dot} />
            ))}
          </div>
        )}
        <div className={styles.buttons}>
          {!last && (
            <Button variant="ghost" onClick={onDone}>
              {t('tour.skip')}
            </Button>
          )}
          <Button ref={primaryRef} variant="primary" onClick={next}>
            {last ? t('tour.done') : index < 0 ? t('tour.start') : t('tour.next')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
