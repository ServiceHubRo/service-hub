# Lansarea — pașii tăi

Ghidul pentru T19, în ordinea în care se fac. Fiecare parte are la final „Verifici”: cum știi că a mers.
Nu lipești nicio cheie în chat — doar în locurile scrise aici.

| Parte | Ce | Când |
|---|---|---|
| 1 | Sentry: afli singur când se strică ceva | T19a |
| 2 | Proiectul de test: linkurile de test nu mai ating datele reale | T19a |
| 3 | Documentele legale | T19b |
| 4 | Domeniul service-hub.ro, plățile reale, contul de admin, copiile de siguranță | T19c |

---

## Partea 1 — Sentry (erorile ajung la tine)

Sentry primește un raport de fiecare dată când aplicația sau o funcție de pe server dă o eroare neprevăzută: ce s-a întâmplat, pe ce ecran, pe ce telefon, în ce versiune. Primești un email la fiecare problemă nouă. Nu primește nume, emailuri, telefoane sau ce scriu oamenii — doar un cod al contului (de ex. `3f2a…`) și rolul (client / service / admin).

Gratuit până la 5.000 de erori pe lună (de ajuns pentru început).

1. Intră pe **sentry.io** → **Get started** și fă contul (cu Google sau email).
2. La crearea organizației, la **Data Storage Location** alege **European Union (Frankfurt)**. Nu se mai poate schimba după (datele stau în UE, ca Supabase).
3. Când îți cere primul proiect: platforma **Browser JavaScript** (fără framework), numele `service-hub`, **Create Project**. Sari peste instrucțiunile de instalare — codul e deja în aplicație.
4. Copiază **DSN**-ul: **Settings → Projects → service-hub → Client Keys (DSN)**. Arată ca `https://abc123@o456.ingest.de.sentry.io/789`. E o adresă publică (ca cheia anon de la Supabase), nu o parolă.
5. **Netlify** → site-ul `service-hub-app` → **Site configuration → Environment variables → Add a variable**:
   - Key: `VITE_SENTRY_DSN`, Value: DSN-ul, **Same value for all deploy contexts** → **Create variable**.
6. **GitHub** → repo-ul `service-hub` → **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `SENTRY_DSN`, Secret: același DSN → **Add secret**. (Pentru funcțiile de pe server; „Deploy Supabase” îl pune singur în Supabase.)
7. În Sentry, pentru confidențialitate: **Settings → Projects → service-hub → Security & Privacy**:
   - bifează **Prevent Storing of IP Addresses**;
   - lasă bifate **Data Scrubber** și **Use Default Scrubbers**.
8. Ca să intre în vigoare: pe un pull request deschis, în GitHub → **Actions → Deploy Supabase → Re-run all jobs**; în Netlify → **Deploys → Trigger deploy → Deploy site** (sau așteaptă următorul pull request).

**Verifici:** pe linkul de test deschide `/dev/componente` (de ex. `https://deploy-preview-25--service-hub-app.netlify.app/dev/componente`). La „Raportarea erorilor (Sentry)” scrie **Pornită**. Apasă **Trimite o eroare de test**: în Sentry → **Issues** apare „Service-Hub test error …” în câteva secunde. Apasă și **Strică ecranul (test)**: vezi mesajul „Ceva n-a mers pe această pagină” (nu o pagină albă), iar în Sentry apare a doua eroare. Pagina asta nu există pe site-ul publicat.

**Emailurile de la Sentry:** vin implicit la fiecare problemă nouă. Dacă vrei și un rezumat săptămânal: **User Settings → Notifications → Weekly Reports**.

---

## Partea 2 — Proiectul de test

**Acum:** linkurile de test din pull request-uri și site-ul publicat folosesc aceeași bază de date. **După:** pull request-urile merg pe un proiect Supabase separat, „de test”; proiectul de acum rămâne cel real și primește modificările doar când dai **Merge**. Așa, după lansare, nimic din ce testezi nu atinge clienții reali.

Durează cam 30–40 de minute. Fă pașii în ordine; până la pasul 4, totul merge ca înainte.

### 1. Proiectul nou în Supabase

1. supabase.com → **New project**. Name: `service-hub-test`. **Database password**: Generate, salvează-o în managerul de parole. **Region: Central EU (Frankfurt)**. **Create new project**.
2. Notează din **Project Settings → API Keys** (sau **API**): **Project URL** (`https://xyzxyz.supabase.co`; partea `xyzxyz` e **Project ref**) și cheia **anon / publishable**.

Planul gratuit permite 2 proiecte. Un proiect gratuit fără activitate 7 zile e pus pe pauză: dacă linkul de test nu mai merge după o pauză lungă, în Supabase apeși **Restore project** pe proiectul de test.

### 2. Emailurile proiectului de test (Resend)

Fără asta, proiectul de test nu trimite emailuri de confirmare decât către tine.

1. În proiectul **service-hub-test**: **Authentication → Emails → SMTP Settings** → **Enable Custom SMTP**, exact ca la proiectul real (pașii din T13): Sender email `notificari@service-hub.ro`, Sender name `Service-Hub`, Host `smtp.resend.com`, Port `465`, Username `resend`, Password: cheia Resend (poți folosi aceeași cheie sau una nouă din resend.com → API Keys). **Save**.

Adresele permise pentru linkurile din email le pune „Deploy Supabase” singur (toate linkurile de test Netlify).

### 3. Cheile funcțiilor de pe server (proiectul de test)

În **service-hub-test** → **Edge Functions → Secrets** (sau **Project Settings → Edge Functions**) → **Add new secret**, câte unul:

| Nume | Valoare |
|---|---|
| `RESEND_API_KEY` | cheia Resend (aceeași ca la SMTP) |
| `ADMIN_EMAIL` | adresa ta de administrare (aceeași ca la proiectul real) |
| `STRIPE_SECRET_KEY` | cheia Stripe **de test** (`sk_test_…`) — aceeași ca la proiectul real acum |
| `STRIPE_PRICE_ID` | același `price_…` de test ca la proiectul real |
| `STRIPE_SEAT_PRICE_ID` | același `price_…` de test pentru colegi |
| `STRIPE_WEBHOOK_SECRET` | de la webhook-ul nou, mai jos |

Webhook-ul Stripe pentru proiectul de test: Stripe → **Developers → Webhooks** (în **Test mode**) → **Add endpoint** → URL `https://xyzxyz.supabase.co/functions/v1/stripe-webhook` (cu ref-ul proiectului de test) → aceleași evenimente ca la cel existent (`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`) → **Add endpoint** → **Signing secret → Reveal** → îl pui ca `STRIPE_WEBHOOK_SECRET` în proiectul de test.

SMS-ul (`SMSO_API_KEY`) îl poți lăsa deoparte pe proiectul de test: aplicația merge și fără, doar că nu trimite SMS-uri (verificarea telefonului o faci din admin). Dacă vrei să testezi și SMS-urile, pune aceeași cheie ca la proiectul real.

### 4. GitHub: unde merg pull request-urile

GitHub → repo-ul → **Settings → Secrets and variables → Actions → New repository secret**:

- `SUPABASE_TEST_PROJECT_REF` — ref-ul proiectului de test (`xyzxyz`)
- `SUPABASE_TEST_DB_PASSWORD` — parola bazei de date a proiectului de test

Secretele de acum (`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`) rămân cum sunt: sunt ale proiectului real.

### 5. Netlify: linkurile de test citesc proiectul de test

Netlify → `service-hub-app` → **Site configuration → Environment variables**:

1. Deschide `VITE_SUPABASE_URL` → **Options → Edit** → **Different value for each deploy context**:
   - **Production**: adresa proiectului real (cea de acum);
   - **Deploy Previews**: `https://xyzxyz.supabase.co` (proiectul de test);
   - **Branch deploys**: tot proiectul de test;
   - **Local development**: lasă cum e.
   **Save variable**.
2. La fel pentru `VITE_SUPABASE_ANON_KEY`: Production = cheia anon a proiectului real, Deploy Previews și Branch deploys = cheia anon a proiectului de test.

### 6. Prima publicare pe proiectul de test

Pe orice pull request deschis: GitHub → **Actions → Deploy Supabase → Re-run all jobs** (sau spune-i lui Claude să împingă un commit). Prima dată durează mai mult: pune toate tabelele în proiectul de test. În rezumatul rulării scrie **„Deploy Supabase → proiectul de test”**.

Apoi, în Netlify → **Deploys**, pe ultimul Deploy Preview → **Retry deploy** (ca linkul să citească noile variabile).

### 7. Contul de admin pe proiectul de test

Proiectul de test pornește gol. Pe linkul de test fă-ți un cont nou (de client), confirmă emailul, apoi în **service-hub-test → SQL Editor** rulează:

```sql
select public.promote_to_admin('adresa-ta@exemplu.ro');
```

**Verifici:** pe linkul de test nu apare bara roșie „Baza de date nu e la zi”. Un cont nou făcut pe linkul de test apare în **service-hub-test → Authentication → Users**, nu în proiectul real. Site-ul publicat (`service-hub-app.netlify.app`) arată în continuare datele reale.

**Ce se schimbă la testare:** conturile de pe linkurile de test sunt separate de cele reale; îți faci conturi de test (client, service) o dată, pe proiectul de test, și le folosești la toate pull request-urile.

---

## Partea 3 — Documentele legale

Termenii, Confidențialitatea și Cookies sunt rescrise după cum funcționează aplicația acum și au și versiunea în engleză (se vede după limba aleasă). Sunt o **ciornă bună**, nu un aviz juridic: forma finală o dai cu avocatul.

### 1. Datele firmei

În documente, datele firmei apar acum ca **[de completat: …]**, cu un chenar portocaliu, ca să nu scape nimic. Trimite-i lui Claude, în chat (nu sunt secrete):

- denumirea firmei (de exemplu „Service Hub SRL”);
- adresa sediului social;
- numărul de la Registrul Comerțului (J…);
- CUI-ul.

Claude le pune în `docs/legal/company.json` (un singur loc) și apar singure în toate cele șase documente. Emailul (`contact@service-hub.ro`) și telefonul sunt deja cele de pe pagina „în curând”.

### 2. Ce să verifici cu avocatul

Dă-i avocatului cele șase fișiere (`docs/legal/*.md` și `docs/legal/en/*.md`) sau linkurile de pe site: `/legal/termeni`, `/legal/confidentialitate`, `/legal/cookies` (butonul „English” sus arată traducerea). Întrebări de pus:

1. **Raportul de 29 lei:** bifa „Vreau raportul imediat după plată și înțeleg că pierd dreptul de retragere de 14 zile” e suficientă? Ce facem dacă cineva cere banii înapoi?
2. **Promisiunile pentru service-uri:** anunț cu 30 de zile înainte de o schimbare de preț sau de închiderea unui cont; răspuns la reclamații în 15 zile lucrătoare; răspundere limitată la abonamentul din ultimele 12 luni. Le poți ține?
3. **Transferurile în afara UE** (Netlify, Resend, Cloudflare, Stripe — SUA): avocatul confirmă că formularea e bună și că ai acceptat contractele de prelucrare (DPA) ale fiecărui furnizor. Le găsești în contul fiecăruia (de obicei **Settings → Legal** sau **Privacy**); Supabase, Stripe, Resend, Netlify și Sentry le au gata de semnat online.
4. **Păstrarea datelor:** conturile nefolosite nu se șterg singure. Vrei o regulă (de exemplu, ștergere după 3 ani fără activitate)?
5. **Litigii:** platforma europeană SOL (ODR) s-a închis în iulie 2025, așa că documentele trimit la ANPC și la SAL. Avocatul confirmă.
6. **TVA:** Termenii spun că factura se emite „conform legii”; după ce decizi cu contabilul (T14b), avocatul poate adăuga dacă prețurile includ TVA.

### 3. În Sentry

Confidențialitatea spune că rapoartele de erori se păstrează „cel mult 90 de zile”. În Sentry, la **Settings → Subscription** (sau pagina planului) vezi cât păstrează planul tău erorile („data retention”). Dacă scrie mai mult de 90 de zile, spune-i lui Claude, ca să schimbe textul.

**Verifici:** pe linkul de test deschide `/legal/termeni`: vezi datele firmei (fără chenare portocalii), apoi apasă **English** și vezi „Terms and Conditions”.

**După forma finală:** spune-i lui Claude ce a schimbat avocatul. Claude actualizează fișierele și versiunea termenilor (`TERMS_VERSION`), ca să știi ce versiune a acceptat fiecare cont.
