import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionButton } from '../../src/components/ActionButton';
import { I18nProvider } from '../../src/i18n/I18nProvider';

afterEach(cleanup);

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ActionButton', () => {
  it('submits once no matter how many taps', async () => {
    const d = deferred();
    const onAction = vi.fn(() => d.promise);
    render(
      <I18nProvider>
        <ActionButton onAction={onAction}>Confirmă</ActionButton>
      </I18nProvider>,
    );
    const button = screen.getByRole('button', { name: /Confirmă/ });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => d.resolve());
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an inline error and retries with the same request id', async () => {
    const first = deferred();
    const second = deferred();
    const onAction = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(
      <I18nProvider>
        <ActionButton onAction={onAction}>Trimite</ActionButton>
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Trimite/ }));
    await act(async () => first.reject(new Error('network')));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/.+/);
    fireEvent.click(screen.getAllByRole('button')[1]!);
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls[1]![0]).toBe(onAction.mock.calls[0]![0]);
    await act(async () => second.resolve());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
