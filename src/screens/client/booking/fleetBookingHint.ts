/**
 * "Programează la service" from a company vehicle (T63d): the vehicle to pick on the car step,
 * kept for this tab while the member searches for a shop. A convenience only: the car step shows
 * every company vehicle the member may book anyway, and the database checks the right again.
 */
const KEY = 'sh.fleetBookVehicle';

export function setFleetBookingHint(vehicleId: string): void {
  try {
    sessionStorage.setItem(KEY, vehicleId);
  } catch {
    // Storage blocked: the member picks the vehicle on the car step.
  }
}

export function fleetBookingHint(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearFleetBookingHint(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
