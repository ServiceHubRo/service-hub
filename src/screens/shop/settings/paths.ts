/** Setări service lives inside Cont (CLAUDE.md §1). */
export const SETTINGS_PATH = '/s/cont/setari';

export const SETTINGS_LINKS = {
  profile: `${SETTINGS_PATH}/profil`,
  hours: `${SETTINGS_PATH}/program`,
  rules: `${SETTINGS_PATH}/reguli`,
  /** Straight to the "Comenzi pe zi" stepper. */
  capacity: `${SETTINGS_PATH}/reguli#capacitate`,
  services: `${SETTINGS_PATH}/servicii`,
  billing: `${SETTINGS_PATH}/facturare`,
  staff: `${SETTINGS_PATH}/personal`,
  notifications: `${SETTINGS_PATH}/notificari`,
} as const;
