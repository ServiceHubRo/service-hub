/** After the document: back at the terms checkbox, where the reader left the form. */
export function returnToTerms() {
  window.requestAnimationFrame(() => {
    const terms = document.getElementById('signup-terms');
    terms?.scrollIntoView({ block: 'center' });
    terms?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({ preventScroll: true });
  });
}
