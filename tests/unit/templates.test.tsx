import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailPane, ListDetailLayout } from '../../src/components/ListDetailLayout';
import { ListRow, ListRows } from '../../src/components/ListRow';
import { PanelSection } from '../../src/components/StatTile';
import { Tabs, TabPanel } from '../../src/components/Tabs';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { BOOKING_STATUSES } from '../../src/lib/status';
import { bookingTone, needsAction } from '../../src/lib/statusTone';
import { useListDetail } from '../../src/lib/useListDetail';

afterEach(cleanup);

describe('status colors (page templates, 14 Nov 2026)', () => {
  it('every ended status is grey, for the client and for the shop', () => {
    for (const s of ['done', 'declined', 'cancelled', 'quote_refused', 'expired', 'no_show'] as const) {
      expect(bookingTone(s, 'client')).toBe('closed');
      expect(bookingTone(s, 'shop')).toBe('closed');
    }
  });

  it('amber only where the reader has to act', () => {
    expect(BOOKING_STATUSES.filter((s) => needsAction(s, 'client'))).toEqual(['quote_sent']);
    expect(BOOKING_STATUSES.filter((s) => needsAction(s, 'shop'))).toEqual(['pending', 'in_inspection']);
  });
});

function TabsHost() {
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
  return (
    <>
      <Tabs
        id="t"
        label="Liste"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'a', label: 'Active', count: 3 },
          { key: 'b', label: 'Încheiate' },
          { key: 'c', label: 'Toate' },
        ]}
      />
      <TabPanel id="t" value={tab}>
        {tab}
      </TabPanel>
    </>
  );
}

describe('Tabs', () => {
  it('is a tab list: one tab in the Tab order, the arrows, Home and End choose', () => {
    render(<TabsHost />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getByRole('tab', { name: 'Active 3' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(screen.getByRole('tabpanel').textContent).toBe('b');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Încheiate' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('tabpanel').textContent).toBe('c');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('tabpanel').textContent).toBe('a');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0]!.id);
  });
});

/** matchMedia that answers one width. */
function setWidth(px: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: px >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.search}</p>;
}

function ListDetailHost() {
  const ids = ['x', 'y'];
  const { wide, selectedId, open, select } = useListDetail(ids);
  return (
    <>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo="/lista"
        backLabel="Programări"
        header={<h1>Programări</h1>}
        list={
          <ListRows label="Lista">
            {ids.map((id) => (
              <ListRow key={id} icon={null} title={`Rând ${id}`} detail="detalii" selected={wide && id === selectedId} onSelect={() => select(id)} />
            ))}
          </ListRows>
        }
        detail={selectedId && <DetailPane id={selectedId} title={`Detaliu ${selectedId}`} actions={<button type="button">Mesaj</button>} />}
      />
      <Where />
    </>
  );
}

function renderListDetail(at: string) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/lista" element={<ListDetailHost />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('ListDetailLayout (template A)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('from 1024 px: the list beside the first item, a row replaces the item in the address', () => {
    setWidth(1440);
    vi.stubGlobal('scrollTo', () => undefined);
    renderListDetail('/lista');
    expect(screen.getByRole('heading', { name: 'Programări' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Detaliu x' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Rând x/ }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Rând y/ }));
    expect(screen.getByRole('heading', { name: 'Detaliu y' })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('?id=y');
  });

  it('below 1024 px: the list alone; a row opens its detail on the whole screen, without the title', () => {
    setWidth(390);
    const scrolled = vi.fn();
    vi.stubGlobal('scrollTo', scrolled);
    renderListDetail('/lista');
    expect(screen.queryByRole('heading', { name: /Detaliu/ })).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Rând y/ }));
    });
    expect(screen.getByRole('heading', { name: 'Detaliu y' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Programări' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Lista' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Programări' })).toBeTruthy();
    expect(scrolled).toHaveBeenCalledWith(0, 0);
  });

  it('a link to one item opens it on a phone too', () => {
    setWidth(390);
    vi.stubGlobal('scrollTo', () => undefined);
    renderListDetail('/lista?id=x');
    expect(screen.getByRole('heading', { name: 'Detaliu x' })).toBeTruthy();
  });
});

describe('PanelSection (template D)', () => {
  it('shows at most five items and „Vezi toate”', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <PanelSection
            title="Cereri noi"
            seeAllTo="/toate"
            empty="Nu există cereri noi."
            items={Array.from({ length: 7 }, (_, i) => (
              <ListRow key={i} icon={null} title={`Cerere ${i}`} detail="" to={`/c/${i}`} />
            ))}
          />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('link', { name: /^(Vezi toate|View all)$/ }).getAttribute('href')).toBe('/toate');
  });
});
