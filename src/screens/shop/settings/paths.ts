/** Setări service lives inside Cont (CLAUDE.md §1). */
export const SETTINGS_PATH = '/s/cont/setari';

export const SETTINGS_LINKS = {
  profile: `${SETTINGS_PATH}/profil`,
  hours: `${SETTINGS_PATH}/program`,
  rules: `${SETTINGS_PATH}/reguli`,
  /** Straight to the "Mașini pe zi" stepper. */
  capacity: `${SETTINGS_PATH}/reguli#capacitate`,
  services: `${SETTINGS_PATH}/servicii`,
  showcase: `${SETTINGS_PATH}/vitrina`,
  billing: `${SETTINGS_PATH}/facturare`,
  /** Hourly rate, quote numbers and the shop's terms printed on quotes (T50). */
  quotes: `${SETTINGS_PATH}/devize`,
  staff: `${SETTINGS_PATH}/personal`,
  /** In Cont itself since Eduard's 26 Oct ask (every notification setting in one place). */
  notifications: '/s/cont/notificari',
} as const;
