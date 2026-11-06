# Service-Hub — editorial standard

Set by Eduard on 6 Nov 2026. It applies to every text a person reads in Service-Hub: the app (all three
roles, all fleet plans), notifications, emails, SMS, automatic thread messages, forms and validations,
reports, exports, PDFs and the admin interface. Every text added later follows it.

The machine-readable version is `src/i18n/glossary.ts`. `tests/unit/editorial.test.ts` checks every
text source against it, so a text that breaks the standard fails the build, naming the key (or file)
and what to write instead.

## 1. Voice

- **Professional, precise, short.** One idea per sentence. A hint exists only when it prevents a
  mistake (CLAUDE.md §10).
- **The user is „tu” / "you".** Romanian uses correct diacritics; English is US English.
- **The system speaks impersonally.** Never „eu” / „noi”, never "I" / "we":
  - „Linkul a fost trimis la {email}.” — not „Ți-am trimis un link…”
  - „Conversațiile nu s-au încărcat.” — not „Nu am putut încărca…”
  - „Următoarea încercare: {data}.” — not „Reîncercăm pe…”
  - "A link was sent to {email}." — not "We sent…"
- **People's actions are attributed to the Service-Hub team**: „Echipa Service-Hub a suspendat contul.”
- **No exclamation marks, emoji, rhetorical questions, apologies or colloquial words** („Gata”,
  „Super”, „Ups”, "just", "Oops"). A check mark is an icon next to the text, never a character in it.
- **Questions only in confirmations** („Ștergi mașina din garaj?”) and in form labels that ask for a choice.
- **Never invent a success.** A confirmation appears only after the server confirmed the action; an
  error says what failed and, when the user can do something, what to do.
- **Never hide what matters:** money, deadlines, consequences and what the user must do stay in the text.

## 2. Actions — one verb per action

| Action | RO | EN |
|---|---|---|
| Save | Salvează | Save |
| Close a panel or form, nothing changes | Renunță | Cancel |
| Cancel something that exists (a booking, an import) | Anulează … | Cancel |
| Delete data for good | Șterge | Delete |
| Remove from a list or group (the thing stays) | Elimină | Remove |
| Add · Edit · Send · Confirm | Adaugă · Editează · Trimite · Confirmă | Add · Edit · Send · Confirm |
| Retry after an error | Încearcă din nou | Try again |
| Close a menu, gallery or panel | Închide | Close |
| Apply filters | Aplică | Apply |
| Back | Înapoi | Back |
| Open a detail page | Vezi … | View … |
| Open a space, a file or a link | Deschide … | Open … |
| Download · Print · Copy | Descarcă · Tipărește · Copiază | Download · Print · Copy |
| More actions (menu) | Mai multe | More |
| More items of a list | Arată mai multe | Show more |
| Contact Service-Hub | Contactează suportul | Contact support |

A screen-specific label starts with the same verb: „Salvează programul”, „Trimite devizul”.

## 3. Terms — one word per concept

| Concept | RO | EN | Note |
|---|---|---|---|
| Booking | programare | booking | Admin navigation keeps „Rezervări” (CLAUDE.md §1) |
| Repair shop | service | shop | never „atelier”, "workshop", "garage" |
| Catalog item | serviciu | service | never „intervenție” |
| Quote | deviz | quote | |
| Work done | lucrare | job | |
| A client's car | mașină | car | client screens, Garage |
| A company's vehicle | vehicul | vehicle | fleet screens |
| License plate | număr de înmatriculare (label: Nr. înmatriculare) | license plate | |
| Picture | fotografie | photo | never „poză” |
| Email | email | email | |
| Text message | SMS | text message | |
| Plan feature | Inclus în planul {plan} | Included in the {plan} plan | „plan superior” / "higher plan" |
| Comparison period | perioada precedentă | previous period | never „perioada dinainte” |
| Filter period | perioada selectată | selected period | |
| Financial labels | Total cheltuieli · Număr de înregistrări · Cost mediu per vehicul · Evoluție lunară · Buget utilizat · Buget disponibil | Total expenses · Number of entries · Average cost per vehicle · Monthly trend · Budget used · Budget available | |

## 4. Message patterns

| Situation | RO | EN |
|---|---|---|
| Empty list | Nu există {obiecte}. | No {items}. |
| Empty after filtering | Nu există {obiecte} pentru filtrele selectate. | No {items} match the selected filters. |
| Load error | {Obiectul} nu s-a încărcat. | {The thing} could not be loaded. |
| Connection hint | Verifică conexiunea. | Check your connection. |
| Delete confirmation | Ștergi {obiectul}? | Delete {the thing}? |
| Done action | {Obiectul} a fost salvat. | {The thing} was saved. |
| Payment retry | Următoarea încercare: {data}. | Next attempt: {date}. |
| Feature of a higher plan | Inclus în planul {plan} | Included in the {plan} plan |

Comparisons with a previous period appear only when that period has data. No data is never shown as
zero or as a rise or fall; green means a real improvement only, never "nothing happened".

## 5. Where the texts live

| Source | File |
|---|---|
| App (all roles), automatic thread messages, validations, admin | `src/i18n/ro.ts`, `src/i18n/en.ts` (the database sends codes only) |
| Notifications (push, in-app) | `supabase/functions/_shared/templates.ts` |
| Emails | `supabase/functions/_shared/emails.ts`, `authEmails.ts`, `emailButtonLabels.ts` |
| SMS | `supabase/functions/_shared/sms.ts` |
| PDFs (history report, job documents) | `supabase/functions/_shared/report.ts`, `jobDoc.ts` |

Texts the admin overrides in Admin → Texte (notification texts) are not checked by the test: the admin
follows this standard when writing them.

## 6. Inventory (6 Nov 2026)

Scanned: 3,852 keys in each language, and the prose literals of the notification, email, SMS and PDF
sources. Changed in this pass: 189 app keys (158 Romanian values, 135 English values) and 26 lines of
server texts in 3 files (`templates.ts`, `emails.ts`, `report.ts`). Counts by problem (a key can be in
more than one row):

| Problem | Keys changed | Now |
|---|---|---|
| System in the first person („Ți-am trimis”, „Nu am putut”, „Reîncercăm”, „cu noi”, "We …") | 66 | impersonal |
| Contracted or colloquial English ("couldn't", "didn't load", "just", "Finding you…") | 47 | full forms, precise wording |
| Load errors in four different shapes | 42 | „… nu s-a încărcat.” / "… could not be loaded." |
| Empty states as „Nicio …” / "No … yet" | 39 | „Nu există …” / "No …" |
| „poză”, „atelier”, „intervenție”, „scoate” | 38 | fotografie, service, serviciu, elimină |
| „Gata” as a button or status | 5 | Aplică, Încheie turul, Generat |
| Check marks inside texts („✓ Salvat”) | 2 | an icon next to the text |

Server texts: payment failures, review decisions, the ANAF notice and the "area available" email
no longer speak in the first person; the history report's disclaimer says „la alte service-uri”.
The fleet wording (plans, previous period, financial labels; 82 keys) was aligned the same day in T66b.

Kept on purpose: the user's own voice where the user speaks („Sunt client”, „Am citit și accept”,
the text of a referral message), the developer-only build diagnostics, and „Gata de ridicare” (the
standard phrase for a car ready to collect).
