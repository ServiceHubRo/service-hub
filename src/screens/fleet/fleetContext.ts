import { createContext, useContext } from 'react';
import { can, type FleetCapability, type FleetOverview, type FleetVehicle } from '../../lib/fleet';

/**
 * What every fleet screen needs: the company read (already narrowed to the member's role), what the
 * member may do, and the way to another fleet page. The design preview fills it from sample data;
 * stage 3 fills it from `fleet_overview()` (docs/FLEET_PLAN.md).
 */
export type FleetSection = 'panou' | 'vehicule' | 'vehicul' | 'costuri' | 'rapoarte' | 'membri';
export const FLEET_SECTIONS: readonly FleetSection[] = ['panou', 'vehicule', 'vehicul', 'costuri', 'rapoarte', 'membri'];

export interface FleetLink {
  section: FleetSection;
  vehicle?: string;
  /** A filter the target page opens with (the Vehicule status, the Rapoarte report). */
  filter?: string;
}

export interface FleetContextValue {
  data: FleetOverview;
  go: (link: FleetLink) => void;
  /** Adds an expense typed in the form (preview: kept in memory; later: `fleet_add_expense`). */
  addExpense: (e: FleetOverview['expenses'][number]) => void;
}

export const FleetContext = createContext<FleetContextValue | null>(null);

export function useFleet(): FleetContextValue & { allowed: (c: FleetCapability) => boolean; vehicle: (id: string) => FleetVehicle | undefined } {
  const value = useContext(FleetContext);
  if (!value) throw new Error('useFleet outside FleetContext');
  return {
    ...value,
    allowed: (c) => can(value.data.me.role, c),
    vehicle: (id) => value.data.vehicles.find((v) => v.id === id),
  };
}

/** `B 101 FLT · Dacia Logan`, or make + model for a car without a plate. */
export function vehicleLabel(v: FleetVehicle | undefined): string {
  if (!v) return '—';
  return v.plate ? `${v.plate} · ${v.make} ${v.model}` : `${v.make} ${v.model}`;
}
