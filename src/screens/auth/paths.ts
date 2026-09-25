/** `/cont-nou?rol=client` or `?rol=service`: sign-up with the role already chosen (still changeable). */
export const SIGNUP_ROLE_PARAM = 'rol';

export function signUpPath(role?: 'client' | 'shop'): string {
  if (!role) return '/cont-nou';
  return `/cont-nou?${SIGNUP_ROLE_PARAM}=${role === 'shop' ? 'service' : 'client'}`;
}
