import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isLegalDocId, type LegalDocId } from '../../lib/legal';
import { returnToTerms } from './legalDoc';

/**
 * The legal document open over the sign-up form, kept in the address (`?document=termeni`) as a
 * step of its own in the history: the phone's Back gesture returns to the form (which stays
 * mounted, so nothing typed is lost) instead of leaving the page.
 */
export function useLegalDoc(): { doc: LegalDocId | null; open: (doc: LegalDocId) => void; close: () => void } {
  const location = useLocation();
  const navigate = useNavigate();
  const pushed = useRef(false);
  const param = new URLSearchParams(location.search).get('document') ?? undefined;
  const doc = isLegalDocId(param) ? param : null;

  const open = useCallback(
    (next: LegalDocId) => {
      const params = new URLSearchParams(location.search);
      params.set('document', next);
      pushed.current = true;
      navigate({ search: `?${params.toString()}` }, { state: location.state });
    },
    [location.search, location.state, navigate],
  );

  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      navigate(-1);
    } else {
      // Opened straight from a link or a reload: there is no form step behind it.
      const params = new URLSearchParams(location.search);
      params.delete('document');
      const search = params.toString();
      navigate({ search: search ? `?${search}` : '' }, { replace: true, state: location.state });
    }
    returnToTerms();
  }, [location.search, location.state, navigate]);

  return { doc, open, close };
}
