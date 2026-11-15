import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A page whose header is drawn once above its sections (the company's space): each section puts
 * its add in the header's top right (docs/MODEL_DE_FOLOSIRE.md P12) through this slot.
 */
const SlotContext = createContext<{ el: HTMLElement | null; set: (el: HTMLElement | null) => void } | null>(null);

export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [el, set] = useState<HTMLElement | null>(null);
  return <SlotContext.Provider value={{ el, set }}>{children}</SlotContext.Provider>;
}

/** Where the actions appear: inside the PageHeader's `actions`. */
export function HeaderSlotTarget() {
  const slot = useContext(SlotContext);
  return <span ref={slot?.set} style={{ display: 'contents' }} />;
}

/** A section's add, shown in the header's slot (in place when there is no slot). */
export function HeaderAction({ children }: { children: ReactNode }) {
  const slot = useContext(SlotContext);
  if (!slot) return <>{children}</>;
  return slot.el ? createPortal(children, slot.el) : null;
}
