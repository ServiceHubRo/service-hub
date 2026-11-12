/**
 * The support agent's routes (A2). Solicitări, Căutare and the Help Center (A4); Proceduri (A5)
 * joins when it exists. Cont is the agent's own account.
 */
export const SUPPORT_REQUESTS_PATH = '/suport/solicitari';
export const SUPPORT_SEARCH_PATH = '/suport/cautare';
/** Centrul de ajutor (A4): every published article, with the audience filter. */
export const SUPPORT_HELP_PATH = '/suport/ajutor';
/** Sugestii de verificat (A3c2b1), reached from Solicitări. */
export const SUPPORT_TEXT_REVIEWS_PATH = '/suport/sugestii-de-verificat';

/** One request (A3a). */
export const supportRequestPath = (id: string) => `${SUPPORT_REQUESTS_PATH}/${id}`;

/** One account's card, reached from a search or a request. */
export const supportAccountPath = (id: string) => `${SUPPORT_SEARCH_PATH}/${id}`;
