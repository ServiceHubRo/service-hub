import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/i18n/I18nProvider';

const mocks = vi.hoisted(() => ({
  requestLocation: vi.fn(() => Promise.resolve('granted')),
  enablePush: vi.fn(() => Promise.resolve('on')),
  dismissPushPrompt: vi.fn(() => Promise.resolve()),
  dismissLocationPrompt: vi.fn(() => Promise.resolve()),
  setProfile: vi.fn(),
  profile: { id: 'u1', location_prompt_dismissed_at: null, push_prompt_dismissed_at: null } as Record<string, unknown>,
}));

vi.mock('../../src/lib/location', () => ({
  useLocation: () => ({ status: 'prompt', coords: null }),
  requestLocation: mocks.requestLocation,
}));
vi.mock('../../src/data/push', () => ({
  usePushStatus: () => 'prompt',
  enablePush: mocks.enablePush,
  dismissPushPrompt: mocks.dismissPushPrompt,
}));
vi.mock('../../src/data/search', () => ({ dismissLocationPrompt: mocks.dismissLocationPrompt }));
vi.mock('../../src/app/sessionContext', () => ({
  useSession: () => ({ profile: mocks.profile, setProfile: mocks.setProfile }),
}));

import { PermissionsIntro } from '../../src/screens/onboarding/PermissionsIntro';

function show(role: 'client' | 'shop') {
  render(
    <I18nProvider>
      <PermissionsIntro role={role} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('sh_lang', 'ro');
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('first start of the app', () => {
  it('a client: location, then notifications, each asked only after "Permite"; then never again', async () => {
    show('client');
    expect(screen.getByRole('dialog', { name: 'Service-urile din jurul tău' })).toBeTruthy();
    expect(screen.getByText('Pasul 1 din 2')).toBeTruthy();
    expect(mocks.requestLocation).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Permite' })));
    expect(mocks.requestLocation).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('dialog', { name: 'Notificări' })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Permite' })));
    expect(mocks.enablePush).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('sh_onboarded:u1')).toBe('1');

    cleanup();
    show('client');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('"Nu acum" puts each one off on the profile, without the system prompt', async () => {
    show('client');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Nu acum' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Nu acum' })));
    expect(mocks.requestLocation).not.toHaveBeenCalled();
    expect(mocks.enablePush).not.toHaveBeenCalled();
    expect(mocks.dismissLocationPrompt).toHaveBeenCalledWith('u1');
    expect(mocks.dismissPushPrompt).toHaveBeenCalledWith('u1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a shop is asked only for notifications', () => {
    show('shop');
    expect(screen.getByRole('dialog', { name: 'Notificări' })).toBeTruthy();
    expect(screen.queryByText(/Pasul/)).toBeNull();
    expect(screen.getByText('Afli imediat când primești o cerere nouă sau un răspuns la deviz.')).toBeTruthy();
  });
});
