import { useEffect, useState } from 'react';
import { storage } from './storage';

/**
 * Client-side pacing for auth emails. The auth server has its own limits; these keep the UI
 * honest ("Retrimite" once per 60 s, at most 3 reset links per address per hour) and survive a
 * page reload. Stored per device as { [key]: timestamps[] }.
 */
const KEY = 'sh_email_log';

function read(): Record<string, number[]> {
  try {
    const parsed: unknown = JSON.parse(storage.get(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number[]>) : {};
  } catch {
    return {};
  }
}

function logKey(kind: string, email: string): string {
  return `${kind}:${email.trim().toLowerCase()}`;
}

export function recordEmailSent(kind: string, email: string, now: number = Date.now()): void {
  const log = read();
  const key = logKey(kind, email);
  const recent = (log[key] ?? []).filter((t) => now - t < 60 * 60 * 1000);
  log[key] = [...recent, now];
  storage.set(KEY, JSON.stringify(log));
}

/** How many emails of this kind went to this address in the last hour. */
export function emailsSentLastHour(kind: string, email: string, now: number = Date.now()): number {
  return (read()[logKey(kind, email)] ?? []).filter((t) => now - t < 60 * 60 * 1000).length;
}

/** Seconds left before another email of this kind may go to this address (0 = now). */
export function secondsUntilNext(kind: string, email: string, gapSeconds: number, now: number = Date.now()): number {
  const times = read()[logKey(kind, email)] ?? [];
  const last = times.length ? Math.max(...times) : 0;
  return Math.max(0, Math.ceil((last + gapSeconds * 1000 - now) / 1000));
}

/** A live countdown for a button ("Retrimite în 42 s"); the second value re-reads it now. */
export function useCountdown(kind: string, email: string, gapSeconds: number): [number, () => void] {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return [secondsUntilNext(kind, email, gapSeconds), () => setTick((n) => n + 1)];
}
