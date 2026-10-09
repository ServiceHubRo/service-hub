/** Minimum password length (FR §2, P4c). Supabase Auth enforces its own minimum too. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Why a new password is refused, or null. The same rule as Supabase Auth's "Letters and digits"
 * (docs/LANSARE.md 4.6c): at least one letter a–z / A–Z and one digit, so the form says so in plain
 * words before the server refuses.
 */
export function passwordProblem(password: string): 'short' | 'letters_digits' | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'short';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'letters_digits';
  return null;
}

export type PasswordStrength = 'short' | 'weak' | 'medium' | 'strong';

/** A visible hint while typing a new password; only `short` blocks saving. */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) return 'short';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes >= 3 && password.length >= 10) return 'strong';
  if (password.length >= 14 && classes >= 2) return 'strong';
  if (classes >= 2 || password.length >= 12) return 'medium';
  return 'weak';
}

/** A plausible email address (the auth server has the final word). */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}
