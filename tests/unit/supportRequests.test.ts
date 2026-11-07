import { describe, expect, it } from 'vitest';
import { emailForEvent } from '../../supabase/functions/_shared/emails.ts';
import { renderNotification } from '../../supabase/functions/_shared/templates.ts';
import { isOpen, settableStatuses, type StaffRequestItem } from '../../src/data/supportRequests';
import { DEFAULT_FILTERS, filterRequests, filtersFrom, waitingHours } from '../../src/lib/supportRequests';

// A3a — support requests: the team's list filters, the states by category, the notifications, and
// that nothing outside the team's two database functions touches the internal notes.

const NOW = new Date('2026-11-08T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function item(over: Partial<StaffRequestItem>): StaffRequestItem {
  return {
    id: 'r',
    title: 'T',
    category: 'technical',
    status: 'new',
    created_at: hoursAgo(1),
    updated_at: hoursAgo(1),
    author: { id: 'u', display_id: 'C-00001', name: 'Ana', role: 'client' },
    shop_name: null,
    assigned: null,
    escalated: false,
    escalated_at: null,
    first_response_at: null,
    last_user_message_at: hoursAgo(1),
    last_staff_message_at: null,
    waiting_since: hoursAgo(1),
    ...over,
  };
}

const agent = { id: 'me', display_id: 'E-00001', name: 'Ioana', role: 'support' as const };
const other = { id: 'o', display_id: 'E-00002', name: 'Radu', role: 'support' as const };

const LIST: StaffRequestItem[] = [
  item({ id: 'a', assigned: agent, status: 'in_progress', waiting_since: hoursAgo(30) }),
  item({ id: 'b', assigned: other, status: 'waiting_user', waiting_since: null }),
  item({ id: 'c', status: 'new', waiting_since: hoursAgo(50), category: 'account' }),
  item({ id: 'd', escalated: true, escalated_at: hoursAgo(2), status: 'in_progress' }),
  item({ id: 'e', status: 'closed', waiting_since: null }),
  item({ id: 'f', status: 'planned', category: 'suggestions', waiting_since: hoursAgo(3) }),
];
const ids = (list: StaffRequestItem[]) => list.map((r) => r.id);

describe('the team’s request list (A3a)', () => {
  it('shows the open requests by default', () => {
    expect(ids(filterRequests(LIST, DEFAULT_FILTERS, 'me', NOW))).toEqual(['a', 'b', 'c', 'd', 'f']);
  });

  it('filters by who is responsible', () => {
    const f = (owner: string) => ids(filterRequests(LIST, { ...DEFAULT_FILTERS, owner, status: 'all' }, 'me', NOW));
    expect(f('mine')).toEqual(['a']);
    expect(f('none')).toEqual(['c', 'e', 'f']);
    expect(f('escalated')).toEqual(['d']);
    expect(f('o')).toEqual(['b']);
  });

  it('filters by state, category and how long the author waits', () => {
    expect(ids(filterRequests(LIST, { ...DEFAULT_FILTERS, status: 'closed' }, 'me', NOW))).toEqual(['e']);
    expect(ids(filterRequests(LIST, { ...DEFAULT_FILTERS, category: 'account' }, 'me', NOW))).toEqual(['c']);
    expect(ids(filterRequests(LIST, { ...DEFAULT_FILTERS, age: '24' }, 'me', NOW))).toEqual(['a', 'c']);
    expect(ids(filterRequests(LIST, { ...DEFAULT_FILTERS, age: '48' }, 'me', NOW))).toEqual(['c']);
    expect(waitingHours(item({ waiting_since: null }), NOW)).toBeNull();
    expect(Math.round(waitingHours(item({ waiting_since: hoursAgo(30) }), NOW)!)).toBe(30);
  });

  it('reads the filters from the address, unknown values falling back', () => {
    expect(filtersFrom(new URLSearchParams(''))).toEqual(DEFAULT_FILTERS);
    expect(filtersFrom(new URLSearchParams('responsabil=mine&stare=all&categorie=account&vechime=48'))).toEqual({
      owner: 'mine',
      status: 'all',
      category: 'account',
      age: '48',
    });
    expect(filtersFrom(new URLSearchParams('vechime=7')).age).toBe('all');
  });

  it('a suggestion keeps its own states; a request uses the new ones', () => {
    expect(settableStatuses('suggestions')).toEqual(['new', 'planned', 'done', 'declined', 'closed']);
    expect(settableStatuses('technical')).toEqual(['in_progress', 'waiting_user', 'resolved', 'closed']);
    expect(isOpen('waiting_user')).toBe(true);
    expect(isOpen('resolved')).toBe(false);
  });
});

describe('the author is told, without the team’s words', () => {
  const event = (event: string, role: 'client' | 'shop', lang: 'ro' | 'en') => ({
    event,
    role,
    lang,
    params: { request_id: 'q-1', title: 'Nu pot anula programarea' },
    booking_id: null,
  });

  it('a push to the request, in both languages', () => {
    expect(renderNotification(event('support_reply', 'client', 'ro'), {})).toMatchObject({
      title: 'Service-Hub',
      body: 'Echipa Service-Hub a răspuns la solicitarea „Nu pot anula programarea”.',
      url: '/c/cont/ajutor/solicitari/q-1',
      tag: 'support-q-1',
    });
    expect(renderNotification(event('support_resolved', 'shop', 'en'), {})).toMatchObject({
      body: 'Your request "Nu pot anula programarea" is resolved.',
      url: '/s/cont/ajutor/solicitari/q-1',
    });
  });

  it('an email that leads to the app; the escalation goes to the admin in Romanian', () => {
    const mail = emailForEvent({ ...event('support_reply', 'shop', 'ro') }, 'https://app.test');
    expect(mail?.subject).toBe('Răspuns la solicitarea ta');
    expect(mail?.text).toContain('https://app.test/s/cont/ajutor/solicitari/q-1');
    const resolved = emailForEvent({ ...event('support_resolved', 'client', 'en') }, 'https://app.test');
    expect(resolved?.text).toContain('within 14 days');
    const escalated = emailForEvent(
      { event: 'support_escalated', lang: 'ro', params: { request_id: 'q-1', title: 'Cont', agent: 'E-00001', reason: 'Posibil cont compromis' } },
      'https://app.test',
    );
    expect(escalated?.subject).toBe('Solicitare escaladată: Cont');
    expect(escalated?.text).toContain('Posibil cont compromis');
    expect(escalated?.text).toContain('https://app.test/admin/suport/solicitari/q-1');
  });
});

describe('the internal notes never leave the team’s functions', () => {
  it('no Edge Function and no screen reads the notes table', () => {
    const files = {
      ...import.meta.glob('../../supabase/functions/**/*.ts', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob('../../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
    } as Record<string, string>;
    const touching = Object.entries(files)
      .filter(([path, text]) => !path.endsWith('database.types.ts') && text.includes('suggestion_notes'))
      .map(([path]) => path);
    expect(touching).toEqual([]);
  });
});
