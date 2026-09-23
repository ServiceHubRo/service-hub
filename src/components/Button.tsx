import type { ButtonHTMLAttributes } from 'react';
import { buttonClass, type ButtonVariant } from './buttonClass';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
}

export function Button({ variant = 'secondary', block = false, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, block, className)} {...rest} />;
}
