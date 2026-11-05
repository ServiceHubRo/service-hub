import { normalizePlate } from './history';

/**
 * One logical vehicle per owner (T66): the same rule as the database (`car_match`). The VIN when there
 * is one; else the plate, unless both cars carry two different VINs (a plate moved to another car).
 * Make, model or year never make two cars the same.
 */
export interface IdentityFields {
  id: string;
  plate?: string | null;
  vin?: string | null;
}

const vinOf = (c: IdentityFields) => (c.vin ? c.vin.toUpperCase().replace(/[^A-Z0-9]/g, '') : null);

export function sameIdentity(a: IdentityFields, b: IdentityFields): boolean {
  const va = vinOf(a);
  const vb = vinOf(b);
  if (va && vb) return va === vb;
  const pa = normalizePlate(a.plate);
  return pa !== '' && pa === normalizePlate(b.plate);
}

/** Cars that are copies of one another, in groups of two or more (the garage's "Unește"). */
export function duplicateGroups<T extends IdentityFields>(cars: readonly T[]): T[][] {
  const groups: T[][] = [];
  const seen = new Set<string>();
  for (const car of cars) {
    if (seen.has(car.id)) continue;
    const group = cars.filter((other) => other.id === car.id || (!seen.has(other.id) && sameIdentity(car, other)));
    if (group.length > 1) {
      group.forEach((c) => seen.add(c.id));
      groups.push(group);
    }
  }
  return groups;
}
