import { useRef, type ChangeEvent, type PointerEvent } from 'react';

/**
 * A native select chosen with a finger lets go of the focus right after the choice. On the iPhone
 * a select that keeps the focus ignores the next tap for a second or two, until the system lets
 * go of it by itself; tapping it again at once must open the list again. With a mouse or the
 * keyboard the focus stays (the arrow keys change the value step by step).
 */
export function useTouchSelect(onChange?: (e: ChangeEvent<HTMLSelectElement>) => void) {
  const byTouch = useRef(false);
  return {
    onPointerDown: (e: PointerEvent<HTMLSelectElement>) => {
      byTouch.current = e.pointerType === 'touch' || e.pointerType === 'pen';
    },
    onChange: (e: ChangeEvent<HTMLSelectElement>) => {
      onChange?.(e);
      if (byTouch.current) {
        byTouch.current = false;
        e.currentTarget.blur();
      }
    },
  };
}
