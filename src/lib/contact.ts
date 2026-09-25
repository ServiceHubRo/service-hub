/** Service-Hub's own contact, as on the "în curând" page (docs/reference-landing.html). */
export const CONTACT = {
  email: 'contact@service-hub.ro',
  /** E.164, for tel: and WhatsApp links; shown as `0723 375 248`. */
  phone: '+40723375248',
} as const;

export function whatsappLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}
