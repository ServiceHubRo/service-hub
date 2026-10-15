import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchemaBar } from '../../src/app/SchemaBar';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { EXPECTED_SCHEMA_VERSION } from '../../src/lib/schema';

const mocks = vi.hoisted(() => ({ fetchSchemaVersion: vi.fn() }));
vi.mock('../../src/data/schema', () => ({ fetchSchemaVersion: mocks.fetchSchemaVersion }));
vi.mock('../../src/lib/env', async (original) => ({ ...(await original<object>()), IS_TEST_BUILD: true }));

function show() {
  return render(
    <I18nProvider>
      <SchemaBar />
    </I18nProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  mocks.fetchSchemaVersion.mockReset();
});

describe('SchemaBar', () => {
  it('asks again when the database did not answer at first (the app opened from a notification)', async () => {
    vi.useFakeTimers();
    mocks.fetchSchemaVersion
      .mockResolvedValueOnce({ kind: 'error', detail: 'Failed to fetch' })
      .mockResolvedValue({ kind: 'ok', version: EXPECTED_SCHEMA_VERSION });
    show();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mocks.fetchSchemaVersion).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the bar when the database stays unreachable', async () => {
    vi.useFakeTimers();
    mocks.fetchSchemaVersion.mockResolvedValue({ kind: 'error', detail: 'Failed to fetch' });
    show();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(mocks.fetchSchemaVersion).toHaveBeenCalledTimes(4);
    expect(screen.getByRole('alert').textContent).toContain('Failed to fetch');
  });
});
