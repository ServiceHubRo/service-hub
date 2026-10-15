import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBumps } from '../../src/lib/useBumps';

describe('useBumps (the jump of a count on the tab bar)', () => {
  it('counts only increases, not the first value nor a decrease', () => {
    const { result, rerender } = renderHook(({ value }) => useBumps(value), { initialProps: { value: 2 } });
    expect(result.current).toBe(0);
    rerender({ value: 3 });
    expect(result.current).toBe(1);
    rerender({ value: 1 });
    expect(result.current).toBe(1);
    rerender({ value: 4 });
    expect(result.current).toBe(2);
    rerender({ value: 4 });
    expect(result.current).toBe(2);
  });
});
