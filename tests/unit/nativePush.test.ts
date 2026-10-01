import { beforeEach, describe, expect, it, vi } from 'vitest';

// A Firebase plugin that hands out a token, and an RPC layer that records what the app saves.
const plugin = vi.hoisted(() => {
  type Listener = (value: unknown) => void;
  const listeners = new Map<string, Listener[]>();
  const state = { receive: 'prompt' as string, answer: 'granted' as string, token: 'tok-1' };
  return {
    state,
    listeners,
    emit(event: string, value: unknown) {
      (listeners.get(event) ?? []).forEach((l) => l(value));
    },
    PushNotifications: {
      checkPermissions: vi.fn(async () => ({ receive: state.receive })),
      requestPermissions: vi.fn(async () => {
        state.receive = state.answer;
        return { receive: state.answer };
      }),
      createChannel: vi.fn(async () => undefined),
      register: vi.fn(async () => {
        queueMicrotask(() => (listeners.get('registration') ?? []).forEach((l) => l({ value: state.token })));
      }),
      addListener: vi.fn(async (event: string, fn: Listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), fn]);
        return {
          remove: async () => listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== fn)),
        };
      }),
    },
  };
});
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin.PushNotifications }));

const db = vi.hoisted(() => ({
  calls: [] as { fn: string; args: unknown }[],
  deleted: [] as string[],
}));
vi.mock('../../src/data/rpc', async (orig) => ({
  ...(await orig<typeof import('../../src/data/rpc')>()),
  call: vi.fn(async (fn: string, args: unknown) => {
    db.calls.push({ fn, args });
    return null;
  }),
}));
vi.mock('../../src/data/supabase', () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        eq: async (_col: string, value: string) => {
          db.deleted.push(value);
          return { error: null };
        },
      }),
    }),
  },
}));

const native = await import('../../src/data/nativePush');

beforeEach(() => {
  localStorage.clear();
  db.calls.length = 0;
  db.deleted.length = 0;
  plugin.listeners.clear();
  Object.assign(plugin.state, { receive: 'prompt', answer: 'granted', token: 'tok-1' });
});

describe('notifications in the phone app', () => {
  it('asks Android, makes the channel, saves the token for the signed-in person', async () => {
    expect(await native.nativeStatus()).toBe('prompt');
    expect(await native.nativeEnable()).toBe('on');
    expect(plugin.PushNotifications.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'service-hub', importance: 4 }));
    expect(db.calls).toEqual([
      { fn: 'save_native_push_token', args: { p_token: 'tok-1', p_platform: 'android', p_user_agent: 'Service-Hub Android' } },
    ]);
    expect(await native.nativeStatus()).toBe('on');
  });

  it('a refusal is remembered as blocked; nothing is saved', async () => {
    plugin.state.answer = 'denied';
    expect(await native.nativeEnable()).toBe('denied');
    expect(db.calls).toHaveLength(0);
    expect(await native.nativeStatus()).toBe('denied');
  });

  it('turned off here: the phone is no longer saved and stays off at the next start', async () => {
    await native.nativeEnable();
    await native.nativeDisable();
    expect(db.deleted).toEqual(['fcm:tok-1']);
    expect(await native.nativeStatus()).toBe('off');
    db.calls.length = 0;
    await native.nativeSync();
    expect(db.calls).toHaveLength(0);
  });

  it('at start, a new token replaces the old one', async () => {
    await native.nativeEnable();
    plugin.state.token = 'tok-2';
    await native.nativeSync();
    expect(db.calls.at(-1)).toEqual({ fn: 'save_native_push_token', args: expect.objectContaining({ p_token: 'tok-2' }) });
    expect(db.deleted).toEqual(['fcm:tok-1']);
  });

  it('signing out forgets the phone; a tap hands over the screen to open', async () => {
    await native.nativeEnable();
    await native.nativeForget();
    expect(db.deleted).toEqual(['fcm:tok-1']);
    const opened: unknown[] = [];
    native.onNotificationTap((url) => opened.push(url));
    await Promise.resolve();
    plugin.emit('pushNotificationActionPerformed', { actionId: 'tap', notification: { data: { url: '/s/programari?p=b-1' } } });
    expect(opened).toEqual(['/s/programari?p=b-1']);
  });
});
