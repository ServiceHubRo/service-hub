// Every button text of the emails (app emails in emails.ts, Auth emails in authEmails.ts). Each
// one is drawn as an image by scripts/gen-email-buttons.mjs: the Gmail app on iPhone repaints the
// colors of an HTML button in dark mode (amber turns brown, the dark text light), never those of
// an image. A text missing here still works: it falls back to the HTML button. After adding one,
// run `node scripts/gen-email-buttons.mjs` (a unit test checks the list is complete).
export const EMAIL_BUTTON_LABELS = [
  // Auth emails
  'Confirmă adresa',
  'Confirm my email',
  'Alege parola nouă',
  'Choose a new password',
  'Confirmă schimbarea',
  'Confirm the change',
  // Staff invitation
  'Acceptă invitația',
  'Accept the invitation',
  // Subscription
  'Deschide Abonament',
  'Open Subscription',
  'Vezi chitanța',
  'See the receipt',
  'Activează abonamentul',
  'Activate the subscription',
  'Plătește abonamentul',
  'Pay the subscription',
  // A booking the shop added (T29)
  'Vezi programarea',
  'See the booking',
  // Reported review (to the admin); account reactivated
  'Deschide Service-Hub',
  'Open Service-Hub',
  // Monthly report to the owner (T24)
  'Deschide Rapoarte',
  'Open Reports',
  // History report
  'Deschide Rapoartele mele',
  'Open My reports',
  // The company at ANAF (Raport ANAF, automated)
  'Deschide Date de facturare',
  'Open Billing details',
  // A request that closed unanswered (to the client, to the shop's owner)
  'Caută alt service',
  'Find another shop',
  'Deschide Programări',
  'Open Bookings',
  // Service-Hub started in the client's zone
  'Caută un service',
  'Find a shop',
] as const;

/** The address-safe name of a button image: „Plătește abonamentul” → `plateste-abonamentul`. */
export function buttonSlug(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
