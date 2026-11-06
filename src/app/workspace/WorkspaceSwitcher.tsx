import { Building2, Check, ChevronDown, Settings2, User } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/context';
import { horizontalPlacement, opensUp, visibleArea } from '../../lib/menuPlacement';
import { COMPANIES_PATH } from '../../screens/client/companies/paths';
import { useOptionalWorkspace, type ActiveWorkspace } from './workspaceContext';
import styles from './WorkspaceSwitcher.module.css';

/**
 * The one workspace switch of the client app (T65): "Personal ▾" or the company's name, in the
 * shell's header on a phone and at the top of the sidebar on a laptop — placed once, by AppShell.
 * Shown only to someone who belongs to a company. The menu lists Personal and every company the
 * caller still belongs to, the active one ticked; arrow keys move, Escape or a tap outside closes it.
 */
export function WorkspaceSwitcher({ placement }: { placement: 'header' | 'sidebar' }) {
  const ws = useOptionalWorkspace();
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!open || !menu || !button) return;
    const { top, bottom } = visibleArea();
    menu.classList.toggle(styles.up ?? '', opensUp(button.getBoundingClientRect(), menu.offsetHeight, bottom, top));
    // In the header the switch sits at the right edge: the menu grows leftwards, whole on screen.
    const wrap = wrapRef.current;
    if (placement === 'header' && wrap) {
      menu.style.left = '';
      menu.style.maxWidth = '';
      const { left, maxWidth } = horizontalPlacement(button.getBoundingClientRect(), menu.offsetWidth, document.documentElement.clientWidth, {
        preferRight: true,
        margin: 12,
      });
      menu.style.maxWidth = `${maxWidth}px`;
      menu.style.left = `${left - wrap.getBoundingClientRect().left}px`;
    }
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const entries = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? []);
    (menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? entries()[0])?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const list = entries();
      const at = list.indexOf(document.activeElement as HTMLElement);
      list[e.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length]?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  if (!ws || !ws.ready) return null;
  const { companies, active, switchTo } = ws;
  // No company: the personal experience as it always was, no switch at all.
  if (companies.length === 0 && active.kind === 'personal') return null;

  const current = active.kind === 'company' ? companies.find((c) => c.id === active.id) : null;
  const label = active.kind === 'personal' ? t('ws.personal') : (current?.name ?? t('ws.company'));
  const Icon = active.kind === 'personal' ? User : Building2;
  const isActive = (target: ActiveWorkspace) =>
    target.kind === active.kind && (target.kind === 'personal' || (active.kind === 'company' && target.id === active.id));

  function pick(target: ActiveWorkspace) {
    setOpen(false);
    switchTo(target);
  }

  return (
    <div className={`${styles.wrap} ${styles[placement]}`} ref={wrapRef} data-ws="">
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={t('ws.label', { space: label })}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.icon} aria-hidden="true">
          <Icon size={16} />
        </span>
        <span className={styles.name}>{label}</span>
        <ChevronDown size={16} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div ref={menuRef} id={`${id}-menu`} role="menu" aria-label={t('ws.menu')} className={styles.menu}>
          <p className={styles.group}>{t('ws.spaces')}</p>
          {option({ kind: 'personal' }, User, t('ws.personal'), t('ws.personalHint'))}
          {companies.map((c) => option({ kind: 'company', id: c.id }, Building2, c.name, t(`fleet.role.${c.role}`)))}
          <div className={styles.divider} />
          <Link role="menuitem" className={styles.manage} to={COMPANIES_PATH} onClick={() => setOpen(false)}>
            <Settings2 size={16} aria-hidden="true" />
            {t('ws.manage')}
          </Link>
        </div>
      )}
    </div>
  );

  function option(target: ActiveWorkspace, ItemIcon: typeof User, name: string, hint: string) {
    const on = isActive(target);
    return (
      <button
        key={target.kind === 'company' ? target.id : 'personal'}
        type="button"
        role="menuitemradio"
        aria-checked={on}
        className={`${styles.item} ${on ? styles.itemOn : ''}`}
        onClick={() => pick(target)}
      >
        <span className={styles.itemIcon} aria-hidden="true">
          <ItemIcon size={16} />
        </span>
        <span className={styles.itemText}>
          <span className={styles.itemName}>{name}</span>
          <span className={styles.itemHint}>{hint}</span>
        </span>
        {on && <Check size={16} className={styles.check} aria-hidden="true" />}
      </button>
    );
  }
}
