# Politica de cookies — Service-Hub

**Ultima actualizare:** 25 septembrie 2026

Aici afli ce informații păstrează Service-Hub în browserul tău și de ce. Operatorul Platformei este {{company}} ({{email}}).

> **Pe scurt.** Service-Hub nu folosește cookie-uri de reclamă, de analiză sau de urmărire. Păstrăm în browser doar ce este strict necesar ca aplicația să funcționeze: sesiunea de autentificare și câteva alegeri ale tale. De aceea nu îți arătăm un banner de acord.

---

## 1. Ce sunt cookie-urile și tehnologiile asemănătoare

Cookie-urile sunt fișiere mici pe care un site le păstrează în browser. Service-Hub nu pune cookie-uri proprii; folosește tehnologii asemănătoare:

- **localStorage** — informații păstrate în browser și după ce îl închizi;
- **sessionStorage** — informații care dispar când închizi fila sau browserul;
- **service worker** — un mic program al aplicației care primește notificările push; se instalează doar dacă activezi notificările și nu păstrează pagini sau date.

Ele rămân pe dispozitivul tău și nu sunt trimise automat către noi.

---

## 2. Ce păstrăm în browser

| Nume | Pentru ce | Unde și cât timp |
|---|---|---|
| `sb-…-auth-token` | Sesiunea de autentificare: te ține conectat | Cu „Ține-mă minte”: localStorage, până te deconectezi sau 30 de zile fără folosire. Fără: sessionStorage, până închizi browserul |
| `sh_remember` | Alegerea „Ține-mă minte” pe acest dispozitiv | localStorage, până ștergi datele site-ului |
| `sh_last_seen` | Când ai folosit ultima dată aplicația pe acest dispozitiv, ca să te deconectăm după 30 de zile fără folosire | localStorage, până ștergi datele site-ului |
| `sh_lang` | Limba aleasă (română sau engleză) | localStorage, până ștergi datele site-ului |
| `sh_email_log` | Când ți-am trimis ultimul email de confirmare sau de resetare a parolei, ca „Retrimite” să aștepte 60 de secunde | localStorage, până ștergi datele site-ului |
| `sh_push_banner_hidden`, `sh_location_banner_hidden`, `sh_review_prompt_hidden` | Ai apăsat „Nu acum” la notificări, la locație sau la cererea de recenzie: mesajul nu mai apare în această sesiune | sessionStorage, până închizi fila |
| `sh_chunk_reload` | După o actualizare a aplicației, pagina se reîncarcă o singură dată, nu la nesfârșit | sessionStorage, până închizi fila |
| Abonarea la notificări push | Doar dacă activezi notificările: browserul păstrează abonarea și service worker-ul | În browser, până dezactivezi notificările sau ștergi datele site-ului |

Toate sunt **strict necesare**: fără ele nu te-ai putea autentifica sau aplicația nu ar ține minte alegerile pe care le-ai făcut chiar tu.

---

## 3. Servicii ale altor companii

- **Cloudflare Turnstile** — verificarea anti-robot din formularele de înscriere și autentificare. Se încarcă de la Cloudflare și poate păstra, pe domeniul Cloudflare, informații tehnice strict necesare acestei verificări. Este necesară pentru siguranța conturilor.
- **Stripe** — când plătești, ești pe pagina Stripe (checkout.stripe.com). Acolo Stripe folosește propriile cookie-uri, pentru plată și pentru prevenirea fraudei, după politica Stripe.
- **Sentry** — rapoartele de erori nu folosesc cookie-uri și nu păstrează nimic în browser.

Nu folosim Google Analytics, pixeli de Facebook, reclame sau alte instrumente de urmărire.

---

## 4. De ce nu îți cerem acordul

Legea (art. 4 alin. (5) din Legea nr. 506/2004, care transpune Directiva ePrivacy) cere acordul tău doar pentru informațiile păstrate în browser care nu sunt strict necesare unui serviciu cerut de tine. Tot ce folosim este strict necesar, deci nu îți arătăm un banner. Dacă vom adăuga vreodată ceva care nu este strict necesar (de exemplu, statistici de trafic), actualizăm această politică și îți cerem acordul înainte.

---

## 5. Cum controlezi ce se păstrează

- **Deconectarea** (Cont → Deconectare) șterge sesiunea de pe acest dispozitiv.
- **Notificările push** le oprești din Cont sau din setările browserului.
- **Locația** o permiți sau o blochezi din setările browserului; nu o păstrăm în browser și nu ne este trimisă.
- **Toate datele site-ului** le ștergi din setările browserului (de obicei la „Confidențialitate” → „Date site-uri”). După aceea va trebui să te autentifici din nou; contul tău nu este afectat.

Dacă blochezi complet păstrarea datelor pentru service-hub.ro, nu te vei putea autentifica.

---

## 6. Contact

Pentru întrebări despre această politică: {{email}}.
