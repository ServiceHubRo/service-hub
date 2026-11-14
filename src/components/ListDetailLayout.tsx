import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { PillTone } from '../lib/statusTone';
import { BackLink } from './BackLink';
import styles from './ListDetailLayout.module.css';

/**
 * Page template A, list + detail (Eduard, 14 Nov 2026). From 1024 px the list stands on the left
 * (--list-w) and the chosen item's detail on the right, held at the top while the page scrolls.
 * Below, the list takes the screen and a row opens its detail in its place — the whole screen,
 * without the title and the tabs — with „‹ Înapoi” to the list (useListDetail keeps which item is
 * open in the address). `list` is the list, or its loading, empty or error state.
 */
export function ListDetailLayout({
  header,
  list,
  detail,
  wide,
  open,
  backTo,
  backLabel,
}: {
  /** The screen's PageHeader with its tabs: hidden while a detail takes a phone's screen. */
  header: ReactNode;
  list: ReactNode;
  /** The chosen item's DetailPane; null while nothing is chosen (or loading). */
  detail: ReactNode;
  wide: boolean;
  /** Below 1024 px: the detail is shown instead of the list. */
  open: boolean;
  /** The list's address (the screen without the chosen item). */
  backTo: string;
  backLabel: string;
}) {
  const detailRef = useFitToScreen(wide && !!detail);
  const single = !wide && open;
  // One tree on every width: the detail open stays the same element when the window crosses
  // 1024 px (its panel, a half-typed review), only the places change.
  return (
    <>
      {!single && header}
      <div className={wide && detail ? styles.split : styles.single}>
        {!single && <div className={styles.list}>{list}</div>}
        {(wide || single) && (
          <div ref={detailRef} className={wide ? styles.detail : styles.single}>
            {single && <BackLink to={backTo} label={backLabel} />}
            {detail}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Beside the list the detail always ends inside the screen, its actions in sight: before it sticks
 * at the top, it is as tall as the room under it; once it sticks, as tall as the screen.
 */
function useFitToScreen(on: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      const gap = parseFloat(getComputedStyle(el).top) || 0;
      const top = Math.max(el.getBoundingClientRect().top, gap);
      el.style.setProperty('--detail-max', `${Math.max(window.innerHeight - top - gap, 0)}px`);
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };
    fit();
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', later);
      window.removeEventListener('resize', later);
    };
  }, [on]);
  return ref;
}

export interface DetailMessage {
  tone: PillTone;
  text: ReactNode;
}

/**
 * The detail of one item, always in the same order: its head (title, one line, status), what the
 * status means now, the content, the documents, the actions — the actions always last, in the same
 * place (held at the foot of the panel beside a list; on a phone above the tab bar).
 */
export function DetailPane({
  id,
  icon,
  title,
  detail,
  status,
  message,
  documents,
  actions,
  panel,
  children,
}: {
  /** The item's id: a new item is read from the top. */
  id: string;
  icon?: ReactNode;
  title: string;
  detail?: ReactNode;
  status?: ReactNode;
  message?: DetailMessage;
  documents?: ReactNode;
  actions?: ReactNode;
  /** An action being confirmed (cancel, a review, a refusal): in the actions' place, in the page. */
  panel?: ReactNode;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollTo?.(0, 0);
  }, [id]);
  return (
    <article ref={ref} className={styles.pane} aria-labelledby={`detail-${id}`}>
      <header className={styles.head}>
        {icon && (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        )}
        <div className={styles.headText}>
          <h2 id={`detail-${id}`} className={styles.title}>
            {title}
          </h2>
          {detail && <p className={styles.headDetail}>{detail}</p>}
        </div>
        {status && <div className={styles.status}>{status}</div>}
      </header>
      {message && (
        <p className={`${styles.message} ${styles[message.tone]}`} role="status">
          {message.text}
        </p>
      )}
      {children && <div className={styles.content}>{children}</div>}
      {documents && <div className={styles.documents}>{documents}</div>}
      {/* One place for both: when a confirmation closes, its opener is found again in it (InlinePanel). */}
      {(panel || actions) && (
        <div className={panel ? styles.panel : styles.actions} data-fixed-bottom={panel ? undefined : true}>
          {panel || actions}
        </div>
      )}
    </article>
  );
}

/** A part of a detail under a small heading (the quote, the car, the job). */
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

/** Label – value pairs of a detail, one per line, the values on one edge. */
export function DetailFacts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className={styles.facts}>
      {items.map((i) => (
        <div key={i.label} className={styles.fact}>
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
