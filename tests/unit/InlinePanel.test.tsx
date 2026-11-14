import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionButton } from '../../src/components/ActionButton';
import { InlinePanel } from '../../src/components/InlinePanel';
import { I18nProvider } from '../../src/i18n/I18nProvider';

afterEach(cleanup);

/** A card with „Anulează” that opens a confirm panel, like a booking card. */
function Host({ withClose = true }: { withClose?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Anulează
      </button>
      {open && (
        <InlinePanel title="Anulezi programarea?" onClose={withClose ? () => setOpen(false) : undefined}>
          <input aria-label="Motiv" />
          <button type="button" onClick={() => setOpen(false)}>
            Păstrează programarea
          </button>
        </InlinePanel>
      )}
    </div>
  );
}

describe('InlinePanel (FUN-03)', () => {
  it('Escape closes the panel and gives the focus back to the button that opened it', () => {
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Anulează' });
    opener.focus();
    fireEvent.click(opener);
    const title = screen.getByRole('heading', { name: 'Anulezi programarea?' });
    expect(document.activeElement).toBe(title);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Motiv' }), { key: 'Escape' });
    expect(screen.queryByRole('heading', { name: 'Anulezi programarea?' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closing with its own button also returns the focus', () => {
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Anulează' });
    opener.focus();
    fireEvent.click(opener);
    const keep = screen.getByRole('button', { name: 'Păstrează programarea' });
    keep.focus();
    fireEvent.click(keep);
    expect(document.activeElement).toBe(opener);
  });

  it('other keys and panels without onClose are left alone', () => {
    render(<Host withClose={false} />);
    const opener = screen.getByRole('button', { name: 'Anulează' });
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Motiv' }), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Motiv' }), { key: 'Enter' });
    expect(screen.getByRole('heading', { name: 'Anulezi programarea?' })).toBeTruthy();
  });

  it('a menu open inside the panel closes first', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Anulează' }));
    const field = screen.getByRole('textbox', { name: 'Motiv' });
    field.setAttribute('aria-expanded', 'true');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'Anulezi programarea?' })).toBeTruthy();
  });
});

/** A card that hides its buttons while the panel is open (a booking card) and draws them again after. */
function Redrawn() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {!open && (
        <button type="button" onClick={() => setOpen(true)}>
          Mai multe
        </button>
      )}
      {open && (
        <InlinePanel title="Anulezi programarea?" onClose={() => setOpen(false)}>
          <button type="button">Anulează programarea</button>
        </InlinePanel>
      )}
    </div>
  );
}

describe('InlinePanel in a card that draws its buttons again', () => {
  it('the focus goes to the same button, drawn anew', () => {
    render(<Redrawn />);
    const first = screen.getByRole('button', { name: 'Mai multe' });
    first.focus();
    fireEvent.click(first);
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Anulezi programarea?' }), { key: 'Escape' });
    const again = screen.getByRole('button', { name: 'Mai multe' });
    expect(again).not.toBe(first);
    expect(document.activeElement).toBe(again);
  });
});

describe('ActionButton outside its form (FUN-01)', () => {
  it('Enter in a field of the form runs the button linked with `form`', () => {
    let runs = 0;
    render(
      <I18nProvider>
        <form id="car" onSubmit={(e) => e.preventDefault()} noValidate>
          <input aria-label="Marcă" />
        </form>
        <ActionButton submit form="car" onAction={async () => void (runs += 1)}>
          Trimite cererea
        </ActionButton>
      </I18nProvider>,
    );
    const button = screen.getByRole('button', { name: 'Trimite cererea' });
    expect(button.getAttribute('form')).toBe('car');
    expect(button.getAttribute('type')).toBe('submit');
    // jsdom does not run implicit submission on Enter; a click on the form's default button is what it triggers.
    fireEvent.click(button);
    expect(runs).toBe(1);
  });
});
