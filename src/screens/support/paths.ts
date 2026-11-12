/**
 * The support agent's routes (A2). Solicitări and Căutare now; Help Center (A4) and Proceduri (A5)
 * join when they exist. Cont is the agent's own account.
 */
export const SUPPORT_REQUESTS_PATH = '/suport/solicitari';
export const SUPPORT_SEARCH_PATH = '/suport/cautare';
/** Sugestii de verificat (A3c2b1), reached from Solicitări. */
export const SUPPORT_TEXT_REVIEWS_PATH = '/suport/sugestii-de-verificat';

/** One request (A3a). */
export const supportRequestPath = (id: string) => `${SUPPORT_REQUESTS_PATH}/${id}`;

/** One account's card, reached from a search or a request. */
export const supportAccountPath = (id: string) => `${SUPPORT_SEARCH_PATH}/${id}`;
