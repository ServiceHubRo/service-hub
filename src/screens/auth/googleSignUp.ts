/**
 * What a visitor chose on Cont nou before leaving for Google (T48): the role and a referral or
 * invitation code, kept for "Finalizează contul" in this tab only.
 */
export type SignUpRole = 'client' | 'shop';

const KEY = 'sh_google_signup';

export interface GoogleSignUpChoice {
  role?: SignUpRole;
  referral?: string;
}

export function rememberGoogleSignUp(choice: GoogleSignUpChoice): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    // Private mode: the form simply starts empty.
  }
}

export function recallGoogleSignUp(): GoogleSignUpChoice {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as { role?: unknown; referral?: unknown };
    return {
      role: value.role === 'client' || value.role === 'shop' ? value.role : undefined,
      referral: typeof value.referral === 'string' ? value.referral.slice(0, 16) : undefined,
    };
  } catch {
    return {};
  }
}

export function forgetGoogleSignUp(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}
