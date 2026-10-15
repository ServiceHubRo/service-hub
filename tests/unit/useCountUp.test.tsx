import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CountUp } from '../../src/components/CountUp';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('CountUp', () => {
  it('counts up to the exact value', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    render(<CountUp value={1250.5} format={(n) => `${n} lei`} />);
    expect(screen.getByText('0 lei')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('1250.5 lei')).toBeTruthy();
  });

  it('shows the value at once when the phone asks for less motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }) as MediaQueryList);
    render(<CountUp value={7} />);
    expect(screen.getByText('7')).toBeTruthy();
  });
});
