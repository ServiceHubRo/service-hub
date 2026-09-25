# Cum pornești proiectul

Pașii 1–4 îi faci o singură dată, înainte de prima sesiune (cam 30 de minute). Pasul 5 vine după primul pull request. Pasul 6 îl faci înainte de a doua sarcină (T02). Apoi rămâne doar bucla zilnică.

---

## 1. GitHub — repo-ul

1. Intră pe github.com → **New repository**.
2. Nume: `service-hub`. Bifează **Private**. Nu adăuga README, .gitignore sau licență: repo-ul trebuie să fie gol.
3. **Create repository**.
4. Pe pagina care apare, apasă linkul **uploading an existing file**.
5. Dezarhivează `service-hub-start.zip` pe calculator. Deschide folderul `service-hub` și trage **tot ce e înăuntru** (`CLAUDE.md`, `README.md`, `PORNIRE.md` și folderul `docs`) în pagina GitHub.
6. Jos, **Commit changes**.

Verifică: în repo vezi `CLAUDE.md` și folderul `docs` direct pe prima pagină, nu într-un folder `service-hub`.

---

## 2. Supabase — baza de date

1. supabase.com → **New project**.
2. Name: `service-hub`. **Database password**: apasă Generate și salveaz-o în managerul de parole (îți trebuie la pasul 6). **Region: Central EU (Frankfurt)** — nu se mai poate schimba după.
3. **Create new project** și aștepți 1–2 minute.
4. Notează două valori din **Project Settings → API** (sau **API Keys**):
   - **Project URL** — arată ca `https://abcdefgh.supabase.co`. Partea `abcdefgh` e **Project ref**.
   - cheia **anon** / **publishable**. E publică, poate sta în aplicație.

Cheia **service_role** / **secret** nu o copiezi nicăieri acum.

---

## 3. Claude Code — conectarea

1. Intră pe claude.ai/code.
2. Conectează GitHub când ți se cere. La instalarea aplicației Claude pe GitHub, alege **Only select repositories** → `service-hub`.
3. Deschide setările mediului (environment): iconița de nor / setări de lângă numele mediului **Default**.
4. La **Network access** alege **Custom**. Bifează **Also include default list of common package managers**. În **Allowed domains** pune, câte unul pe rând:
   ```
   *.supabase.co
   *.netlify.app
   cdn.playwright.dev
   playwright.download.prss.microsoft.com
   ```
5. La **Environment variables** pune (cu valorile tale de la pasul 2):
   ```
   VITE_SUPABASE_URL=https://abcdefgh.supabase.co
   VITE_SUPABASE_ANON_KEY=cheia-anon-publică
   ```
6. Salvează.

Dacă pe parcurs Claude îți spune că i-a fost blocat un domeniu, îl adaugi tot aici, la **Allowed domains**.

---

## 4. Prima sesiune

Pornești o sesiune nouă pe repo-ul `service-hub` și scrii:

> Citește CLAUDE.md, docs/ARCHITECTURE.md și docs/TASKS.md. Fă T01.

Claude lucrează singur (de obicei între 20 de minute și o oră), apoi deschide un **pull request** și îți scrie ce ai de testat.

---

## 5. Netlify — linkurile de test (după ce se deschide primul pull request)

1. app.netlify.com → **Add new site** (sau **Add new project**) → **Import an existing project** → **GitHub** → alegi `service-hub`.
2. Setările de build le lași cum le propune (le citește din fișierul făcut de Claude).
3. La **Environment variables** adaugi aceleași două valori ca la pasul 3.5: `VITE_SUPABASE_URL` și `VITE_SUPABASE_ANON_KEY`.
4. **Deploy**.
5. **Site configuration → Change site name** → `service-hub-app`. Aplicația va fi la `service-hub-app.netlify.app`.

Pagina „în curând” de pe service-hub.ro rămâne neatinsă până la lansare (T19).

De acum, pe fiecare pull request din GitHub apare un link **Deploy Preview**: acolo testezi. Pentru primul pull request, dacă linkul nu apare, spune-i lui Claude în sesiune: „Conectasem Netlify după ce ai deschis PR-ul, împinge un commit ca să apară preview-ul.”

---

## 6. Secretele pentru baza de date (înainte de T02)

La fiecare pull request și la fiecare Merge, GitHub trimite singur modificările bazei de date în Supabase, ca linkul de test să meargă. Pentru asta are nevoie de trei secrete, pe care le pui doar în GitHub:

1. În Supabase: iconița contului (dreapta sus) → **Account preferences → Access Tokens** (adresa directă: supabase.com/dashboard/account/tokens) → **Generate new token**, nume `github-deploy`. Copiază-l.
2. În GitHub, repo-ul `service-hub` → **Settings → Secrets and variables → Actions → New repository secret**. Creezi trei:
   - `SUPABASE_ACCESS_TOKEN` — tokenul de la punctul 1
   - `SUPABASE_PROJECT_REF` — partea `abcdefgh` din Project URL
   - `SUPABASE_DB_PASSWORD` — parola bazei de date de la pasul 2

Nu le lipi în chat, nici în altă parte.

---

## 7. Bucla zilnică

1. Sesiune nouă: **„Fă următoarea sarcină.”** (sau „Fă T07.”)
2. Aștepți mesajul lui Claude cu linkul pull request-ului.
3. Faci **„Pașii tăi”** din pull request, dacă sunt. Dacă pull request-ul schimbă baza de date, verificarea **„Deploy Supabase”** de pe el trebuie să fie verde.
4. Deschizi **Deploy Preview** și urmezi **„Cum testezi”** — pe telefon și pe laptop.
5. Dacă ceva nu merge: scrii în aceeași sesiune ce ai apăsat și ce s-a întâmplat, cu o captură. Claude repară în același pull request.
6. Când totul merge: **Merge pull request** în GitHub.

**Reguli de siguranță**
- Nu da Merge dacă pull request-ul are un X roșu la verificări.
- Nu lipi niciodată în chat parole, tokenuri sau chei secrete. Claude îți spune doar numele și locul unde le pui.
- O sarcină pe sesiune. Sesiunile lungi, cu multe sarcini, fac mai multe greșeli.
- Proiectul din Lovable nu mai e necesar.

**Lansarea (T19):** pașii pentru Sentry, proiectul de test, domeniu și restul sunt în `docs/LANSARE.md`.

**Cost:** GitHub, Supabase și Netlify sunt gratuite la volumul ăsta. Sesiunile din Code consumă din limitele abonamentului tău Claude; la limită, aștepți resetarea sau continui a doua zi.
