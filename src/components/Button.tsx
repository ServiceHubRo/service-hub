import type { ComponentPropsWithRef } from 'react';
import { buttonClass, type ButtonVariant } from './buttonClass';
import { KeepHyphens } from './KeepHyphens';

// With `ref` (React 19 passes it as a prop): a screen can give the focus back to a button.
export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  block?: boolean;
}

export function Button({ variant = 'secondary', block = false, className, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, block, className)} {...rest}>
      {typeof children === 'string' ? <KeepHyphens>{children}</KeepHyphens> : children}
    </button>
  );
}
