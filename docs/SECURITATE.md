# Auditul de securitate Service-Hub

**Data:** 23 octombrie 2026 · **Făcut de:** Claude (asistentul AI care a scris codul) · **Starea codului:** `main` după T40, plus reparațiile din T42.

> **Limită importantă.** Auditul l-a făcut chiar autorul codului. Prinde multe, dar nu înlocuiește o verificare făcută de un om din afară (un programator sau o firmă de securitate). Raportul de mai jos îi arată acelui om unde să se uite întâi.

## Pe scurt

- Nu am găsit nicio problemă gravă: nimeni nu poate citi sau schimba datele altcuiva, nu poate schimba prețuri sau statusuri și nu poate folosi plățile ori SMS-urile pe banii platformei.
- Am găsit trei puncte de importanță mică sau medie și le-am reparat în același PR (T42).
- Pe lângă ele, unele unelte de construire aveau vulnerabilități cunoscute. Le-am actualizat; nu ajung în aplicația folosită de oameni.
- Rămân câteva lucruri care țin de setări, nu de cod. Le faci la lansare și sunt deja în `docs/LANSARE.md`, partea 4.

## Ce am verificat și ce am găsit

| Zonă | Ce am verificat | Rezultat |
|---|---|---|
| Accesul la tabele (RLS) | Toate cele 50 de tabele: regulile de acces, ce poate citi și scrie un vizitator nelogat, un client, un service, un admin. | ✅ Toate au reguli de acces. Vizitatorul nelogat citește doar catalogul de servicii. Un utilizator logat poate scrie doar în câteva coloane, pe rândurile lui (profil, mașini, setările service-ului). Statusurile, prețurile, abonamentul, verificările și recenziile se schimbă doar prin funcțiile din baza de date. |
| Funcțiile din baza de date | Funcțiile care rulează cu drepturi mari (`security definer`): au `search_path` fix, verifică cine le cheamă, pe care le poate apela un vizitator. | ✅ Toate au `search_path` fix. Cele de admin cer adminul cu verificarea în doi pași (aal2). Funcțiile apelabile nelogat sunt doar verificări de coduri și previzualizări publice. ⚠️ Una arăta prea mult (punctul 1). |
| Fișiere (Storage) | Logo-uri, poze, rapoarte PDF. | ✅ Logo-urile și pozele sunt publice, dar acceptă doar PNG, JPEG și WebP (nu SVG) și doar în dosarul propriului service. Rapoartele PDF sunt private și se descarcă doar prin server, de către proprietar. |
| Funcțiile de pe server (Edge Functions) | Fiecare dintre cele 14: verifică logarea, adminul cu aal2, semnătura Stripe, limitele. | ✅ Mesajele de la Stripe sunt verificate cu semnătură și termen de 5 minute. Funcția de notificări cere o cheie aleatorie de 64 de caractere. SMS-urile pleacă doar spre numere din România, cel mult unul pe minut și 5 pe zi pe cont și pe număr, iar codul se blochează după 5 încercări greșite. Linkurile de după plată merg doar spre adresele Service-Hub. |
| Secrete | Codul de acum și tot istoricul Git: chei Stripe, Resend, Supabase, Google, chei private. | ✅ Nicio cheie secretă în cod sau în istoric. `.env` e ignorat de Git. Aplicația din browser primește doar valori publice. |
| Pachete (npm) | `npm audit`. | ✅ 0 vulnerabilități în pachetele aplicației. ⚠️ Uneltele de construire aveau câteva; le-am actualizat (punctul 4). |
| Aplicația din browser | Linkuri primite din afară, linkuri scrise de utilizatori (site, Facebook), HTML injectat, redirecționări. | ✅ Niciun HTML injectat în pagină. Linkul spre site-ul unui service e forțat pe `https://`. Redirecționările după logare nu se pot da prin link. Rapoartele de erori (Sentry) nu conțin nume, email sau telefon. |
| Antete de securitate | Content-Security-Policy, HSTS, frame-ancestors și altele (`docs/ARCHITECTURE.md` §14b). | ✅ Politică strictă: scripturi doar de pe site, imagini doar de pe site și din Storage, pagina nu poate fi pusă într-un iframe străin. Testate automat. |
| Conturi | Parole, confirmarea emailului, adminul, verificarea telefonului, ștergerea contului. | ✅ Email confirmat obligatoriu. Parolă de minimum 8 caractere, cu litere și cifre. Adminul cere codul din aplicația de autentificare (2FA). Telefonul schimbat își pierde verificarea, iar CUI-ul schimbat își pierde verificarea ANAF. |
| Aplicația Android | Setările din manifest. | ⚠️ Datele aplicației, inclusiv sesiunea de logare, intrau în copiile de rezervă ale telefonului (punctul 3). |

## Ce am reparat (PR T42)

1. **Numărul de înmatriculare din pagina publică `/verifica`** (importanță medie, date personale).
   - **Problema:** codurile rapoartelor sunt la rând (`SH-2026-000001`, `-000002` …), iar pagina răspunde oricui, fără logare. Încercând codurile pe rând, cineva putea aduna numerele de înmatriculare ale tuturor mașinilor cu raport.
   - **Reparația:** pagina arată acum doar literele județului și ultimele două caractere (`BV •• •BC`). Ajunge pentru a potrivi raportul cu mașina din fața ta, dar nu pentru a strânge numere. Migrarea `verify_report_masked_plate`, funcția `mask_plate`, cu teste SQL și în browser.
2. **Logo-uri și poze de pe alte servere** (importanță mică).
   - **Problema:** un cont de service putea pune, ocolind aplicația, adresa unei imagini de pe alt server. Pe site o blochează deja Content-Security-Policy. În aplicația de telefon însă imaginea s-ar fi încărcat, iar acel server ar fi văzut cine deschide pagina.
   - **Reparația:** aplicația afișează logo-ul și pozele doar dacă sunt fișiere din Storage-ul Service-Hub (`src/lib/ownImage.ts`, cu teste).
3. **Copiile de rezervă Android** (importanță mică).
   - **Problema:** sesiunea de logare intra în copia de rezervă a telefonului (în cloud sau pe un calculator).
   - **Reparația:** aplicația nu mai intră în copii de rezervă și nici în mutarea pe un telefon nou (`allowBackup="false"` și reguli pentru Android 12+). Pe un telefon nou, utilizatorul se loghează din nou.
4. **Unelte de construire** (importanță mică).
   - **Problema:** `npm audit` arăta vulnerabilități în uneltele care construiesc aplicația (Vite, Vitest, source-map), nu în aplicația folosită de oameni.
   - **Reparația:** le-am actualizat cu `npm audit fix`. Rămâne una moderată în `uuid`, adusă de unealta Capacitor pentru Android. Nu ne afectează (nu folosim funcția vulnerabilă) și se rezolvă când Capacitor își actualizează pachetul.

## Ce am lăsat așa, și de ce

- **Codurile rapoartelor rămân la rând.** După reparația 1, încercându-le pe rând afli doar marca, modelul și numărul de lucrări ale unor mașini anonime. Schimbarea formatului ar strica rapoartele deja tipărite.
- **Un utilizator logat poate citi toate coloanele unui service public.** Printre ele: id-ul contului proprietarului, ce notificări are pornite, dacă are prețul de lansare. Niciuna nu e secretă: datele fiscale, abonamentul și plățile sunt în tabele separate, închise.
- **Ștergerea contului cere doar sesiunea deschisă, nu și parola din nou.** Cine are telefonul deblocat al cuiva îi poate șterge contul. Majoritatea aplicațiilor fac la fel. Dacă vrei parola din nou înainte de ștergere, e o schimbare mică.
- **Funcțiile de pe server acceptă cereri de pe orice site (CORS `*`).** Nu e o problemă: fiecare cere tokenul de logare în antet, nu folosește cookie-uri.

## Ce rămâne de făcut la lansare (setări, nu cod)

Toate sunt descrise pas cu pas în `docs/LANSARE.md`:

- **Proiectul de test în Supabase** (partea 2), ca PR-urile să nu mai atingă baza reală.
- **Copiile de siguranță zilnice** ale bazei de date (partea 4.1).
- **CAPTCHA (Cloudflare Turnstile)** la înregistrare, logare și parola uitată (partea 4.3).
- **2FA pe toate conturile platformei:** GitHub, Supabase, Netlify, Stripe, Resend, Cloudflare, Google (partea 4.6c).
- **Setările de logare din Supabase:** *Secure password change*, *Secure email change*, refuzul parolelor apărute în scurgeri de date (partea 4.6c).
- **Protecția ramurii `main` în GitHub:** GitHub → repo → **Settings → Branches → Add branch ruleset** → `main` → *Require a pull request before merging*. Așa nimeni, nici AI-ul, nu poate scrie direct pe `main`.

## Pentru cine face verificarea externă

Unde merită să se uite întâi:

1. **Regulile de acces din baza de date:** `supabase/migrations/` (politicile RLS, `grant`/`revoke` pe coloane) și testele lor din `tests/sql/` (izolarea între doi clienți și între două service-uri, coloanele protejate).
2. **Funcțiile care schimbă statusul programărilor și devizelor:** `docs/ARCHITECTURE.md` §3 (mașina de stări), §4 (locurile libere) și §6 (limitele anti-abuz); implementarea e în migrații.
3. **Plățile:** `supabase/functions/stripe-webhook`, `stripe-checkout`, `report-checkout`.
4. **Ștergerea conturilor și datele personale:** `supabase/functions/delete-account`, `admin-delete-account`.
5. **Un test de penetrare pe site-ul publicat**, după lansare, cu un cont de client și unul de service.

---

## A6 — Securitatea și controlul echipei (12 noiembrie 2026)

**Pornire:** auditul A6 pe `main` la `d7cd6c0` (schema 118), verdict „READY WITH CONDITIONS”. Toate problemele confirmate sunt reparate în PR-ul A6 (migrarea `a6_security`, schema 119). Detaliile tehnice: `docs/ARCHITECTURE.md` (paragraful A6) și `docs/PERMISSIONS.md` (§4, §5b).

| Problemă | Ce s-a făcut |
|---|---|
| H1 — tokenul adminului mergea până la o oră după delogare | Orice funcție de admin (și regulile de acces, și fișierele din suport) verifică acum că sesiunea există, nu a expirat și are sub 8 ore. Testat pe toate funcțiile `admin_*`. |
| H2 — ce deschide adminul nu apărea în jurnal | Fișele (client, service, programare), listele cu date personale și căutările sunt în Jurnalul de audit, o dată la 10 minute pentru același lucru, fără cuvintele căutate. |
| M1 — conturile suspendate scriau direct în tabele | Toate regulile de scriere și cele din Storage cer un cont nesuspendat (și un service nesuspendat). Profilul: doar limba. |
| M2 — cheia de server putea modifica jurnalul | Jurnalul nu mai poate fi modificat, șters sau golit de nimeni prin API. Doar retenția și ștergerea GDPR, prin funcțiile lor, cu o „deblocare” pe care nimeni altcineva nu o poate scrie (nu o setare de sesiune). |
| M3 — refuzurile nu lăsau urme | Refuzurile importante ajung în jurnalul serverului (`sh_security`), care rămâne și când operația e anulată; evenimentele din operațiile reușite apar în Platformă → Securitate. Fiecare rând de audit are sesiunea. |
| M4 — fișierele din flote | Doar prin funcția `fleet-files`: tipul real, PDF-uri active refuzate, fotografii fără GPS, limite pe oră și pe firmă. |
| M5 — operațiuni sensibile fără motiv | Motiv obligatoriu în baza de date; exporturi de cel mult 100 de rânduri, 5 pe oră, fără telefoane și serii de șasiu; proprietarul e anunțat la schimbarea IBAN-ului sau a emailului de facturare. |
| M6 — adminii nu puteau fi opriți din aplicație | Platformă → Administratori: închiderea sesiunilor, suspendarea și reactivarea altui admin (niciodată pe sine, niciodată ultimul admin activ). |
| L1, L2, L3 | Admin șters refuzat; PDF-uri limitate pe oră; o curățare de sesiuni eșuată devine eveniment de securitate. |
| Găsit în timpul lucrului | Funcția fișierelor din suport verifica sesiunea doar pentru agenți, nu și pentru admini: reparat la fel ca H1. |

### Ce rămâne și de ce

- **Citirile directe ale adminului prin regulile de acces** nu sunt în jurnal: numărul de recenzii raportate, setările platformei, planurile și semnalele „s-a schimbat ceva” ale ecranelor live. Fișele și listele cu date personale trec toate prin funcțiile înregistrate.
- **Refuzurile din interiorul bazei de date** se văd în Supabase → **Logs** (Postgres), căutând `sh_security`, nu în aplicație: o tranzacție refuzată se anulează cu tot ce a scris. Aplicația arată evenimentele operațiilor reușite și refuzurile raportate de funcțiile de pe server.
- **Proprietarul bazei de date (SQL Editor)** poate face orice; nicio regulă dintr-un tabel nu-l oprește. Scriptul de resetare de la lansare deblochează jurnalul în scris, doar pentru tranzacția lui.
- **Limita de inactivitate de 30 de minute pentru echipă** nu se poate aplica sigur din baza de date (reîmprospătarea tokenului nu înseamnă activitate). Setarea din Supabase s-ar aplica tuturor utilizatorilor — e decizia ta (mai jos).

### Setările din Supabase Dashboard (L4) — de verificat de tine

Nu le pot vedea și nu le pot schimba de aici: proiectul real nu e accesibil din sesiunea de lucru. Valorile „din cod” sunt cele din `supabase/config.toml` (proiectul local); cele reale sunt în Dashboard.

| Setare | Unde (Supabase → proiectul real) | Din cod (local) | Recomandat | Stare |
|---|---|---|---|---|
| Durata maximă a sesiunii, echipa | — (în baza de date, A6) | 8 ore pentru admini și agenți | 8 ore | ✅ făcut în cod |
| Time-box user sessions (toți utilizatorii) | Authentication → Sessions | oprit | oprit (ar deconecta și clienții) | de verificat |
| Inactivity timeout (toți utilizatorii) | Authentication → Sessions | oprit | oprit sau peste 24 h; 30 min doar dacă accepți ca și clienții să se reconecteze | **decizia ta** |
| Secure password change | Authentication → Sign In / Providers → Email | oprit | **pornit** | de făcut (LANSARE 4.6c) |
| Secure email change | același loc | pornit | pornit | de verificat |
| CAPTCHA (Turnstile) | Authentication → Attack Protection | oprit | **pornit** la lansare | de făcut (LANSARE 4.3) |
| 2FA (TOTP) | Authentication → Multi-Factor | pornit | pornit (obligatoriu pentru admini și agenți, verificat în baza de date) | ✅ |
| Durata tokenului (JWT expiry) | Project Settings → JWT Keys | 3600 s | 3600 s | de verificat |
| Refresh token rotation | Authentication → Sessions | pornit | pornit | de verificat |
