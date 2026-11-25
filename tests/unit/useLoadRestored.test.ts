import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { reportSessionRestored } from '../../src/data/sessionEvents';
import { useLoad } from '../../src/lib/useLoad';

describe('useLoad when the session is back', () => {
  it('loads again a screen that failed while the session was gone', async () => {
    let calls = 0;
    const load = () => (++calls === 1 ? Promise.reject(new Error('not_signed_in')) : Promise.resolve('data'));
    const { result } = renderHook(() => useLoad(load));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    act(() => reportSessionRestored());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: 'data' }));
    expect(calls).toBe(2);
  });

  it('leaves a screen that loaded fine alone', async () => {
    let calls = 0;
    const load = () => Promise.resolve(++calls);
    const { result } = renderHook(() => useLoad(load));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    act(() => reportSessionRestored());
    expect(calls).toBe(1);
    expect(result.current.state).toEqual({ status: 'ready', data: 1 });
  });
});
