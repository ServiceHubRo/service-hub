import { createContext, useCallback, useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { VehicleFields } from '../../data/fleet';
import type { Booking } from '../../data/rpc';
import { memberCan, type FleetCapability, type FleetOverview, type FleetPlanSummary, type FleetSubscriptionView, type FleetVehicle } from '../../lib/fleet';

/**
 * What every fleet screen needs: the company read (already narrowed to the member's role), what the
 * member may do, and the way to another fleet page. The design preview fills it from sample data;
 * stage 3 fills it from `fleet_overview()` (docs/FLEET_PLAN.md).
 */
export type FleetSection = 'panou' | 'vehicule' | 'vehicul' | 'programari' | 'costuri' | 'cont' | 'rapoarte' | 'membri' | 'abonament';
export const FLEET_SECTIONS: readonly FleetSection[] = ['panou', 'vehicule', 'vehicul', 'programari', 'costuri', 'cont', 'rapoarte', 'membri', 'abonament'];

export interface FleetLink {
  section: FleetSection;
  vehicle?: string;
  /** A filter the target page opens with (the Vehicule status, the Rapoarte report). */
  filter?: string;
}

/** The writes of the live space (database functions); none in the preview. */
export interface FleetActions {
  saveVehicle: (vehicleId: string | null, fields: VehicleFields, requestId: string) => Promise<FleetVehicle>;
  archiveVehicle: (vehicleId: string, archived: boolean, requestId: string) => Promise<void>;
  assignDriver: (vehicleId: string, memberId: string | null, requestId: string) => Promise<void>;
  setUnavailable: (vehicleId: string, unavailable: boolean, requestId: string) => Promise<void>;
  /** The company's answer to a quote (T63d). */
  decideQuote: (bookingId: string, quoteId: string, approvedItemIds: string[], requestId: string) => Promise<Booking>;
  /** "Programează la service": the search, with this vehicle picked on the car step. */
  book: (vehicleId: string | null) => void;
}

export interface FleetContextValue {
  data: FleetOverview;
  go: (link: FleetLink) => void;
  /**
   * `preview`: sample data, nothing saved, the actions still to come shown disabled. `live`: the
   * company's real data; only what works is shown.
   */
  mode: 'preview' | 'live';
  /** Live only. */
  actions: FleetActions | null;
  /** Live only: the company's page in Cont (team, rules and budgets). */
  companyPage: string | null;
  /** Preview only: adds an expense typed in the form, kept in memory. */
  addExpense: ((e: FleetOverview['expenses'][number]) => void) | null;
  /** The company's plan (T64a); null in the preview when none is shown. */
  plan: FleetPlanSummary | null;
  /** Reads the Abonament page (live: `fleet_subscription`; preview: the sample). */
  loadSubscription: () => Promise<FleetSubscriptionView>;
}

export const FleetContext = createContext<FleetContextValue | null>(null);

export function useFleet(): FleetContextValue & { allowed: (c: FleetCapability) => boolean; vehicle: (id: string) => FleetVehicle | undefined } {
  const value = useContext(FleetContext);
  if (!value) throw new Error('useFleet outside FleetContext');
  return {
    ...value,
    allowed: (c) => memberCan(value.data.me.role, value.data.me.extra_caps, c),
    vehicle: (id) => value.data.vehicles.find((v) => v.id === id),
  };
}

/** `B 101 FLT · Dacia Logan`, or make + model for a car without a plate. */
export function vehicleLabel(v: FleetVehicle | undefined): string {
  if (!v) return '—';
  return v.plate ? `${v.plate} · ${v.make} ${v.model}` : `${v.make} ${v.model}`;
}

/**
 * Where the fleet space is: the page, the vehicle and the filter live in the address
 * (`?sectiune=vehicul&vehicul=<id>`), so Back goes back and a link opens one page.
 */
export function useFleetLocation() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('sectiune') as FleetSection | null;
  const section: FleetSection = raw && FLEET_SECTIONS.includes(raw) ? raw : 'panou';
  const vehicleId = params.get('vehicul');
  const filter = params.get('filtru') ?? undefined;

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams((p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      });
    },
    [setParams],
  );

  const go = useCallback(
    (link: FleetLink) => {
      update({ sectiune: link.section, vehicul: link.vehicle ?? null, filtru: link.filter ?? null });
      document.getElementById('fleet-main')?.scrollTo?.({ top: 0 });
    },
    [update],
  );

  return { section, vehicleId, filter, update, go, params };
}

