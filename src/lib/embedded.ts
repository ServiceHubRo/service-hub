import { createContext, useContext } from 'react';

/**
 * A whole screen shown inside another one (the garage's right-hand panel on a laptop, C8): it has no
 * „‹ Înapoi” of its own and its title is a second-level heading, so the page keeps one title.
 */
const EmbeddedContext = createContext(false);
export const EmbeddedProvider = EmbeddedContext.Provider;
export function useEmbedded(): boolean {
  return useContext(EmbeddedContext);
}
