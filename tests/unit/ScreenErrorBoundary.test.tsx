import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenErrorBoundary } from '../../src/app/ScreenErrorBoundary';
import { I18nProvider } from '../../src/i18n/I18nProvider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Screen({ broken }: { broken: boolean }) {
  if (broken) throw new Error('broken screen');
  return <p>Programări</p>;
}

function Shell({ path, broken }: { path: string; broken: boolean }) {
  return (
    <I18nProvider>
      <nav>Meniu</nav>
      <ScreenErrorBoundary resetKey={path}>
        <Screen broken={broken} />
      </ScreenErrorBoundary>
    </I18nProvider>
  );
}

describe('ScreenErrorBoundary', () => {
  it('shows the message inside the shell, keeps the menu, and another screen works again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    localStorage.setItem('sh_lang', 'ro');
    const { rerender } = render(<Shell path="/c/programari" broken />);
    expect(screen.getByText('A apărut o eroare pe acest ecran. Reîncarcă pagina sau alege alt ecran din meniu.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reîncarcă pagina' })).toBeTruthy();
    expect(screen.getByText('Meniu')).toBeTruthy();

    // Same address: the message stays.
    rerender(<Shell path="/c/programari" broken={false} />);
    expect(screen.queryByText('Programări')).toBeNull();

    // Another screen from the menu: drawn normally.
    rerender(<Shell path="/c/garaj" broken={false} />);
    expect(screen.getByText('Programări')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reîncarcă pagina' })).toBeNull();
  });
});
