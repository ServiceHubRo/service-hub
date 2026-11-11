import { ChevronLeft } from 'lucide-react';
import { useLayoutEffect, useRef, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/context';
import { goUp } from '../lib/navHistory';
import styles from './BackLink.module.css';

/**
 * "‹ Înapoi" at the top of a screen; inside the app it stays in reach while the screen scrolls.
 * It goes back to its parent page without adding a history entry (src/lib/navHistory.ts): the
 * browser's Back and this one never loop. A real link still: opening it in a new tab works.
 */
export function BackLink({ to, label }: { to: string; label?: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  // Held under the header inside the app: its height joins the header's for what is scrolled into
  // view (global.css scroll-padding-top) and for the field typed in with the keyboard open (11 Nov 2026).
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el || getComputedStyle(el).position !== 'sticky') return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--back-bar', `${el.offsetHeight}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--back-bar');
    };
  }, []);
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    goUp(navigate as (to: string | number, options?: { replace?: boolean }) => void, to);
  }
  return (
    <div ref={barRef} className={styles.bar} data-back-bar>
      <Link to={to} className={styles.back} onClick={onClick}>
        <ChevronLeft size={18} aria-hidden="true" />
        {label ?? t('common.back')}
      </Link>
    </div>
  );
}
