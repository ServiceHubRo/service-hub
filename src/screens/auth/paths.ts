/** `/cont-nou?rol=client` or `?rol=service`: sign-up with the role already chosen (still changeable). */
export const SIGNUP_ROLE_PARAM = 'rol';

export function signUpPath(role?: 'client' | 'shop'): string {
  if (!role) return '/cont-nou';
  return `/cont-nou?${SIGNUP_ROLE_PARAM}=${role === 'shop' ? 'service' : 'client'}`;
}

/** `/cont-nou?rol=service&cod=S-00042`: a shop's referral link fills in the code (still editable). */
export const REFERRAL_CODE_PARAM = 'cod';

export function referralSignUpPath(code: string): string {
  return `${signUpPath('shop')}&${REFERRAL_CODE_PARAM}=${encodeURIComponent(code)}`;
}
