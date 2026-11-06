/**
 * The Service-Hub editorial standard (Eduard, 6 Nov 2026), in code: one term per concept and one
 * label per action, in Romanian and US English, for the app, notifications, emails, SMS and PDFs.
 * `docs/EDITORIAL.md` explains it; `tests/unit/editorial.test.ts` checks every text source against
 * it, so a new text that breaks it fails the build.
 *
 * The app reuses the shared keys in `ro.ts` (`common.save`, `common.cancel`, …) for these actions;
 * a screen-specific label ("Salvează programul") starts with the same verb.
 */

export interface GlossaryTerm {
  /** The concept, in English, for developers. */
  concept: string;
  ro: string;
  en: string;
  /** When to use it, if the word alone is not enough. */
  note?: string;
}

/** Actions: the verb a button or menu entry starts with. */
export const ACTIONS: readonly GlossaryTerm[] = [
  { concept: 'save', ro: 'Salvează', en: 'Save' },
  { concept: 'dismiss a panel or form, nothing changes', ro: 'Renunță', en: 'Cancel' },
  { concept: 'cancel something that exists (a booking, an import, a change)', ro: 'Anulează', en: 'Cancel' },
  { concept: 'delete data for good', ro: 'Șterge', en: 'Delete' },
  { concept: 'remove from a list or a group; the thing itself stays', ro: 'Elimină', en: 'Remove' },
  { concept: 'add', ro: 'Adaugă', en: 'Add' },
  { concept: 'edit', ro: 'Editează', en: 'Edit' },
  { concept: 'send', ro: 'Trimite', en: 'Send' },
  { concept: 'confirm', ro: 'Confirmă', en: 'Confirm' },
  { concept: 'retry after an error', ro: 'Încearcă din nou', en: 'Try again' },
  { concept: 'close a panel, a menu or a gallery', ro: 'Închide', en: 'Close' },
  { concept: 'apply chosen filters', ro: 'Aplică', en: 'Apply' },
  { concept: 'go back', ro: 'Înapoi', en: 'Back' },
  { concept: 'open a detail page', ro: 'Vezi', en: 'View' , note: 'Vezi programarea, Vezi abonamentul' },
  { concept: 'open a space, a file or a link', ro: 'Deschide', en: 'Open' },
  { concept: 'download a file', ro: 'Descarcă', en: 'Download' },
  { concept: 'print', ro: 'Tipărește', en: 'Print' },
  { concept: 'copy', ro: 'Copiază', en: 'Copy' },
  { concept: 'more actions (menu)', ro: 'Mai multe', en: 'More' },
  { concept: 'show more items of a list', ro: 'Arată mai multe', en: 'Show more' },
  { concept: 'contact the Service-Hub support', ro: 'Contactează suportul', en: 'Contact support' },
];

/** Terms: one word per concept across every screen and message. */
export const TERMS: readonly GlossaryTerm[] = [
  { concept: 'a booking', ro: 'programare', en: 'booking', note: 'Admin navigation keeps „Rezervări” (CLAUDE.md §1).' },
  { concept: 'a repair shop', ro: 'service', en: 'shop', note: 'Never „atelier” / "workshop", "garage".' },
  { concept: 'an item of the catalog', ro: 'serviciu', en: 'service', note: 'Never „intervenție”.' },
  { concept: 'the quote', ro: 'deviz', en: 'quote' },
  { concept: 'a job done by a shop', ro: 'lucrare', en: 'job' },
  { concept: "a client's car", ro: 'mașină', en: 'car', note: 'Client screens and the Garage.' },
  { concept: "a company's vehicle", ro: 'vehicul', en: 'vehicle', note: 'Fleet screens.' },
  { concept: 'the license plate', ro: 'număr de înmatriculare', en: 'license plate', note: 'Short label: „Nr. înmatriculare”.' },
  { concept: 'a picture', ro: 'fotografie', en: 'photo', note: 'Never „poză”.' },
  { concept: 'electronic mail', ro: 'email', en: 'email' },
  { concept: 'a text message', ro: 'SMS', en: 'text message' },
  { concept: 'the subscription', ro: 'abonament', en: 'subscription' },
  { concept: 'the plan of a company', ro: 'plan', en: 'plan', note: '„Inclus în planul Fleet Pro”, „plan superior”.' },
  { concept: 'the earlier period in a comparison', ro: 'perioada precedentă', en: 'previous period' },
  { concept: 'the period chosen in a filter', ro: 'perioada selectată', en: 'selected period' },
  { concept: 'the filters chosen', ro: 'filtrele selectate', en: 'selected filters' },
  { concept: 'total spending', ro: 'Total cheltuieli', en: 'Total expenses' },
  { concept: 'number of records', ro: 'Număr de înregistrări', en: 'Number of entries' },
  { concept: 'average cost per vehicle', ro: 'Cost mediu per vehicul', en: 'Average cost per vehicle' },
  { concept: 'spending by month', ro: 'Evoluție lunară', en: 'Monthly trend' },
  { concept: 'budget spent', ro: 'Buget utilizat', en: 'Budget used' },
  { concept: 'budget left', ro: 'Buget disponibil', en: 'Budget available' },
];

/** Message patterns: the same situation is always worded the same way. */
export const PATTERNS: readonly GlossaryTerm[] = [
  { concept: 'empty list', ro: 'Nu există {obiecte}.', en: 'No {items}.' },
  { concept: 'empty list after filtering', ro: 'Nu există {obiecte} pentru filtrele selectate.', en: 'No {items} match the selected filters.' },
  { concept: 'load error', ro: '{Obiectul} nu s-a încărcat.', en: '{The thing} could not be loaded.' },
  { concept: 'connection hint after an error', ro: 'Verifică conexiunea.', en: 'Check your connection.' },
  { concept: 'a feature of a higher plan', ro: 'Inclus în planul {plan}', en: 'Included in the {plan} plan' },
  { concept: 'a delete confirmation', ro: 'Ștergi {obiectul}?', en: 'Delete {the thing}?' },
  { concept: 'a done action, stated', ro: '{Obiectul} a fost {salvat}.', en: '{The thing} was {saved}.' },
  { concept: 'the next retry of a payment', ro: 'Următoarea încercare: {data}.', en: 'Next attempt: {date}.' },
];

export interface ForbiddenRule {
  pattern: RegExp;
  why: string;
  instead: string;
}

/**
 * What a text never says. The system speaks impersonally (never „eu” / „noi”: „Ți-am trimis”,
 * „Nu am putut”); an action of people is the Service-Hub team's („Echipa Service-Hub a …”).
 */
export const FORBIDDEN_RO: readonly ForbiddenRule[] = [
  { pattern: /^(Nicio|Niciun|Niciuna)\b/, why: 'empty state worded as „Nicio …”', instead: 'Nu există …' },
  { pattern: /\b(Nicio|Niciun)\b[^.]*\bîncă\b/, why: '„… încă” in an empty state', instead: 'Nu există …' },
  { pattern: /\b(Ți-am|ți-am|Ți-l-am|L-am trimis|Îți trimitem|îți trimitem|Nu am putut|nu am putut|Nu am găsit|nu am găsit|Am găsit|Am verificat|Am șters|Am trimis|Reîncercăm|reîncercăm|Te anunțăm|te anunțăm|Îți amintim|îți amintim|Ne-ai|Pregătim|Le arătăm|Caut |Nu pot |Nu putem|nu putem|Scrie-ne|scrie-ne|Trimite-ne|Spune-ne|Contactează-ne|ne contactezi|cu noi|nostru|noastră|noștri|noastre)\b/, why: 'first person (the system says „eu” / „noi”)', instead: 'an impersonal sentence: „Linkul a fost trimis”, „Nu s-a încărcat”' },
  { pattern: /!/, why: 'exclamation mark', instead: 'a full stop' },
  { pattern: /[✅✓✔\u{1F300}-\u{1FAFF}]/u, why: 'emoji or check mark inside a text', instead: 'an icon next to the text' },
  { pattern: /\b(Gata)\b(?! de ridicare)|\b(Hai|Super|Ups|Oops|Felicitări|Bravo|Uite)\b/, why: 'colloquial word', instead: 'a precise label: „Aplică”, „Generat”, „Încheie turul”' },
  { pattern: /\bpoz(a|ă|e|ele|ei|elor)\b/i, why: '„poză”', instead: 'fotografie' },
  { pattern: /\batelier/i, why: '„atelier”', instead: 'service' },
  { pattern: /\binterven(ț|t)i/i, why: '„intervenție”', instead: 'serviciu' },
  { pattern: /\b(Scoate|scoate|Scoți|scoți)\b/, why: '„scoate”', instead: 'Elimină' },
  { pattern: /perioada dinainte|Disponibil în (Fleet|planul)|plan mai mare/, why: 'old plan / period wording', instead: 'perioada precedentă, Inclus în planul …, plan superior' },
];

export const FORBIDDEN_EN: readonly ForbiddenRule[] = [
  { pattern: /^No [^.]*\byet\b/, why: '"No … yet" in an empty state', instead: 'No …' },
  { pattern: /\b(We|we|We'll|we'll|We've|we've|We're|we're|us|Us|our|Our)\b/, why: 'first person plural (the system says "we")', instead: 'an impersonal sentence: "A link was sent", "could not be loaded"' },
  { pattern: /\b(couldn't|didn't load|didn’t load|Couldn't)\b/, why: 'contracted error', instead: 'could not, could not be loaded' },
  { pattern: /!/, why: 'exclamation mark', instead: 'a period' },
  { pattern: /[✅✓✔\u{1F300}-\u{1FAFF}]/u, why: 'emoji or check mark inside a text', instead: 'an icon next to the text' },
  { pattern: /\b(Oops|Sorry|Awesome|Great|Hey|Yay|just|simply|Finding you)\b/, why: 'colloquial word', instead: 'a precise wording' },
  { pattern: /\b(workshop|picture|pic)\b/i, why: 'term outside the glossary', instead: 'shop, photo' },
  { pattern: /\bcancelled\b/, why: 'British spelling', instead: 'canceled' },
  { pattern: /period before|Available in (Fleet|the)|bigger plan|larger plan/, why: 'old plan / period wording', instead: 'previous period, Included in the … plan, higher plan' },
];
