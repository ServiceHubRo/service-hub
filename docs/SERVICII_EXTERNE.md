# Service-Hub — Servicii externe necesare

**Ce trebuie contractat, configurat sau construit în afara aplicației**
Versiunea 1.0 · [ZZ.LL.AAAA]

> Aplicația în sine se construiește pe Supabase. Documentul ăsta acoperă tot ce e **în afara** ei: trimiterea de emailuri, notificări, plăți, facturare. Fiecare are un cost, un timp de configurare și un moment în care devine blocant.

---

## 1. Rezumat — ce lipsește, pe scurt

| # | Serviciu | Pentru ce | Blocant pentru | Prioritate |
|---|---|---|---|---|
| 1 | **Email tranzacțional** | Confirmarea contului, resetare parolă | **Înregistrarea nu funcționează fără el** | Imediat |
| 2 | **Notificări push web** | Deviz trimis, mașina e gata | Valoarea produsului | Imediat |
| 3 | **SMS** | Cerere nouă către service | Viteza de răspuns a atelierului | Pilot |
| 4 | **Procesator de plăți** | Abonamentul de 100 lei | Încasarea banilor | Înainte de facturare |
| 5 | **Facturare + e-Factura** | Obligație fiscală | Emiterea legală de facturi | Odată cu plățile |
| 6 | **Găzduire frontend** | Publicarea aplicației | Accesul public | Imediat |
| 7 | **Domeniu** | service-hub.ro | Tot | Imediat |
| 8 | **Canal pentru recenzii raportate** | Promisiunea de 5 zile lucrătoare | Obligație asumată public | Pilot |
| 9 | **Monitorizare erori** | Să afli când se strică ceva | Nimic, dar economisește timp | Recomandat |

**Nu sunt necesare:** hărți interactive, verificare VIN, brokeri de asigurări, integrare cu case de marcat. (Geocodarea adreselor — adresă → coordonate, pentru „Aproape de tine” — e necesară; gratuită cu Nominatim.)

---

## 2. Email tranzacțional — cel mai urgent

### De ce e blocant

Specificația cere confirmarea adresei de email la înregistrare (FR-4). Până nu confirmă, **un service nu apare în căutări și un client nu poate trimite cereri**. Dacă emailurile nu ajung, nimeni nu poate folosi aplicația.

Supabase are un serviciu de email încorporat, dar e **limitat sever și destinat doar testării** — nu se folosește în producție.

### Opțiuni

| Furnizor | Cost orientativ | Observații |
|---|---|---|
| **Resend** | Gratuit până la ~3.000 emailuri/lună | Cel mai simplu de integrat cu Supabase |
| **Amazon SES** | Foarte ieftin la volum | Ai deja cont AWS; configurare mai tehnică |
| **Postmark** | Plătit de la început | Cea mai bună livrabilitate, folosit de firme mari |
| **SendGrid** | Nivel gratuit limitat | Popular, dar livrabilitatea a scăzut |

**Recomandare:** Resend pentru început, Amazon SES dacă preferi să folosești contul pe care îl ai deja.

### Ce trebuie configurat obligatoriu

Nu e suficient să te înregistrezi. Pe domeniul `service-hub.ro` trebuie setate trei înregistrări DNS:

- **SPF** — spune ce servere au voie să trimită în numele domeniului
- **DKIM** — semnătură care dovedește că emailul chiar vine de la tine
- **DMARC** — ce să facă serverul destinatarului dacă ceva nu se potrivește

Fără ele, emailurile ajung în Spam sau sunt respinse, mai ales de Gmail și Yahoo, care au înăsprit regulile. **Vei pierde înregistrări fără să știi de ce.**

### Emailuri pe care le trimite aplicația

1. Confirmarea adresei la înregistrare
2. Retrimiterea confirmării
3. Resetarea parolei
4. Confirmarea noii adrese, la schimbarea emailului
5. *(mai târziu)* Chitanțe și facturi de abonament

---

## 3. Notificări push

### De ce contează

Fluxul de deviz nu funcționează fără ele. Service-ul trimite devizul, iar clientul trebuie să afle **acum**, nu când deschide întâmplător aplicația. La fel, mesajul că mașina e gata.

Fără push, timpul de răspuns la un deviz crește de la minute la ore, iar mașina stă în atelier ocupând un loc.

### Ce e nevoie

**Web Push** e un standard al browserului, nu un serviciu plătit. Nu contractezi nimic — ai nevoie doar de:

- o **pereche de chei VAPID** (se generează gratuit, cu o comandă)
- un **service worker** în aplicație (cod, nu serviciu)
- o funcție pe server care trimite notificarea

**Cost: zero.** E doar muncă de implementare.

### Limitarea de care trebuie să știi

**Pe iPhone, notificările push funcționează doar dacă utilizatorul adaugă aplicația pe ecranul de start** (iOS 16.4 sau mai nou). Nu merge dintr-o filă de Safari.

Consecința practică: un patron de service cu iPhone care folosește aplicația din browser **nu va primi notificări**. De aceea SMS-ul de la punctul următor nu e opțional pentru partea de service.

Aplicația trebuie să detecteze situația și să afișeze instrucțiunea „Adaugă pe ecranul de start ca să primești notificări".

---

## 4. SMS

### Când e necesar

Pentru **service-uri, la cerere nouă**. Un patron nu stă cu aplicația deschisă; e sub o mașină. Dacă află de o cerere abia seara, valoarea produsului dispare — exact viteza de răspuns o vindem.

Pentru clienți, push-ul e suficient.

### Opțiuni în România

| Furnizor | Cost orientativ per SMS | Observații |
|---|---|---|
| **SMSO** | ~0,05–0,08 lei | Românesc, integrare simplă, facturare în lei |
| **Twilio** | ~0,25–0,35 lei | Internațional, mai scump pentru România |
| **Vonage** | Similar Twilio | — |

**Recomandare:** SMSO. La 10 ateliere cu câte 5 cereri pe zi, costul lunar e sub 100 de lei.

### Reguli de respectat

- SMS-urile trebuie să fie **strict tranzacționale** — despre o programare concretă. Un SMS promoțional fără acord explicit încalcă legislația privind comunicările comerciale.
- Trebuie să existe o modalitate de dezabonare.
- Numărul expeditorului trebuie să fie identificabil.

---

## 5. Procesator de plăți

### Ce trebuie să facă

Abonament recurent de 100 lei/lună, cu 90 de zile gratuite, plus posibilitatea de anulare oricând.

| Opțiune | Comision orientativ | Avantaje | Dezavantaje |
|---|---|---|---|
| **Stripe** | ~1,4% + 1 leu (carduri UE) | Gestionează singur abonamentele recurente, reîncercările la card refuzat, portalul clientului, proraționarea | Comision mai mare; facturile lui nu satisfac singure obligațiile din România |
| **Netopia / mobilPay** | Negociabil, mai mic | Românesc, familiar patronilor | Logica de abonament recurent trebuie construită manual |
| **EuPlătesc** | Similar | Idem | Idem |
| **PayU** | Similar | Idem | Idem |

**Recomandare:** Stripe. Diferența de comision la 10-50 de ateliere e de ordinul zecilor de lei pe lună, iar logica de abonamente construită manual înseamnă săptămâni de muncă și un risc real de erori la încasare.

### Ce trebuie configurat

- Cont Stripe cu firma înregistrată (CUI obligatoriu)
- Un produs „Abonament Service-Hub" cu preț recurent lunar
- **Webhook semnat** către aplicație, care e singurul lucru care schimbă starea abonamentului
- Portalul clientului activat, pentru schimbarea cardului și anulare

---

## 6. Facturare și e-Factura

### Obligația

Orice factură emisă către o firmă din România trebuie raportată prin sistemul **e-Factura** al ANAF. **Facturile generate de Stripe nu acoperă singure această obligație.**

### Opțiuni

| Soluție | Cum funcționează | Observații |
|---|---|---|
| **SmartBill** | Are API; emiți factura și o trimite automat în e-Factura | Cel mai folosit în România |
| **Oblio** | Similar, cu API | Mai ieftin |
| **FGO** | Similar | — |
| **Integrare directă ANAF SPV** | Fără intermediar | Necesită certificat digital și mult mai multă muncă |

**Recomandare:** SmartBill sau Oblio. Costul e de ordinul zecilor de lei pe lună și îți scutește integrarea directă cu ANAF.

### Ce trebuie stabilit înainte

- **Firma e plătitoare de TVA sau nu?** Sistemul trebuie să suporte ambele, pentru că statutul se schimbă când treci pragul. Cota nu se scrie fix în cod.
- Seria și numerotarea facturilor
- Ce se întâmplă la anulare: se emite storno?

**De discutat cu contabilul înainte de implementare**, nu după.

---

## 7. Găzduire și domeniu

| Element | Opțiune | Cost orientativ |
|---|---|---|
| **Frontend** | Netlify | Gratuit la scara ta |
| **Backend** | Supabase | Gratuit la început, ~25 $/lună la creștere |
| **Domeniu** | service-hub.ro | ~50–80 lei/an |
| **DNS** | Netlify DNS (deja configurat) | Gratuit |

**De reținut:** proiectul Supabase trebuie creat în regiunea **Frankfurt (eu-central-1)**. E cerința de rezidență a datelor din specificație, pentru GDPR, și nu se poate schimba după creare fără migrare.

---

## 8. Canalul pentru recenzii raportate

Nu e un serviciu extern, dar e o obligație asumată public: aplicația îi spune service-ului că o recenzie raportată e verificată **în maximum 5 zile lucrătoare**.

**Minimul necesar:** o funcție care, la fiecare raportare, trimite un email către o adresă de administrare, cu recenzia, motivul, service-ul și data. Nu e suficient ca datele să stea într-un tabel pe care cineva îl verifică dacă își amintește.

Se rezolvă cu același furnizor de email de la punctul 2. Cost suplimentar: zero.

---

## 9. Monitorizare erori — recomandat

Fără ea, afli că aplicația s-a stricat de la un patron nervos la telefon.

| Serviciu | Cost |
|---|---|
| **Sentry** | Gratuit până la un volum rezonabil |

Prinde erorile din browser și din funcțiile de server, cu detalii despre ce s-a întâmplat exact. La un produs cu plăți și programări, merită din prima zi.

---

## 10. Ordinea în care le contractezi

**Acum, ca aplicația să funcționeze:**
1. Domeniu `service-hub.ro`
2. Proiect Supabase în Frankfurt
3. Furnizor de email + configurarea SPF, DKIM, DMARC
4. Chei VAPID pentru push (gratuit)
5. Cont Netlify (deja există)

**Înainte de pilot:**
6. SMSO pentru SMS-uri către service-uri
7. Canalul de email pentru recenzii raportate
8. Sentry

**Înainte să încasezi primul abonament:**
9. Stripe, cu firma înregistrată
10. SmartBill sau Oblio, cu e-Factura activă

---

## 11. Costul lunar estimat, la 10 ateliere

| Serviciu | Cost |
|---|---|
| Domeniu | ~6 lei (anualizat) |
| Supabase | 0 lei (nivel gratuit) |
| Netlify | 0 lei |
| Email (Resend) | 0 lei |
| Push | 0 lei |
| SMS (SMSO) | ~50–100 lei |
| Sentry | 0 lei |
| Stripe | ~2% din 1.000 lei = ~20 lei |
| Facturare | ~30–50 lei |
| **Total** | **~110–180 lei/lună** |

La 10 ateliere plătitoare, venitul e 1.000 lei/lună. Costurile de infrastructură sunt sub 20% și scad procentual pe măsură ce crești.

---

## 12. Decizii de luat

1. **Furnizor de email:** Resend sau Amazon SES (ai deja cont AWS)?
2. **SMS:** confirmi SMSO, sau vrei să testezi întâi fără SMS în pilot?
3. **Procesator de plăți:** Stripe sau un procesator românesc?
4. **Facturare:** SmartBill, Oblio sau altceva ce folosește deja contabilul tău?
5. **TVA:** firma va fi plătitoare de TVA de la început?
6. **Adresa de administrare** pentru recenzii raportate: care e?
