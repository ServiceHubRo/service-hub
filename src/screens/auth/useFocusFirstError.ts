import { useEffect, type RefObject } from 'react';

/** After a failed submit, moves focus to the first field marked invalid. */
export function useFocusFirstError(formRef: RefObject<HTMLElement | null>, errors: object, attempt: number): void {
  useEffect(() => {
    if (attempt === 0 || Object.keys(errors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [formRef, errors, attempt]);
}
