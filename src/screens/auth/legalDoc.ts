/**
 * After the document: back at the terms checkbox, where the reader left the form. Closing the
 * document goes back in the history, which shows the form again a moment later; so wait (a few
 * frames at most) until the checkbox is on screen before scrolling to it and focusing it.
 */
export function returnToTerms(framesLeft = 30) {
  window.requestAnimationFrame(() => {
    const terms = document.getElementById('signup-terms');
    const box = terms?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!terms || !box || terms.getClientRects().length === 0) {
      if (framesLeft > 0) returnToTerms(framesLeft - 1);
      return;
    }
    terms.scrollIntoView({ block: 'center' });
    box.focus({ preventScroll: true });
  });
}
