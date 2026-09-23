# Politica de Confidențialitate — Service-Hub

**Ultima actualizare:** [ZZ.LL.AAAA]

Această politică explică ce date personale colectăm prin platforma Service-Hub, de ce le colectăm, cât timp le păstrăm și ce drepturi ai, în conformitate cu Regulamentul (UE) 2016/679 („GDPR") și legislația română aplicabilă.

**Operator de date:** **[Denumire firmă / SRL]**, CUI **[...]**, sediu **[adresă]**, contact pentru protecția datelor: **[email]**.

---

## 1. Ce date colectăm

### 1.1 Date de cont (toți utilizatorii)
Nume, email, telefon, rolul contului (client sau atelier), limba preferată (RO/EN).

### 1.2 Dacă ești Client
- **Date despre mașinile tale:** marcă, model, an, număr de înmatriculare, VIN (opțional), datele de expirare ITP, RCA și rovinietă.
- **Date de programare:** istoricul programărilor, atelierele alese, notele adăugate la o programare.
- **Devize și costuri:** sumele acceptate/refuzate pentru lucrări.
- **Recenzii** lăsate atelierelor.
- **Mesaje** trimise în conversațiile cu atelierele.
- **Documente** încărcate sau primite de la ateliere (deviz, factură, raport, poze) — dacă un Atelier îți atașează un document, acesta devine vizibil în contul tău.
- **Favorite** — atelierele salvate ca preferate.

### 1.3 Dacă ai cont de Atelier
- **Date publice de profil:** numele atelierului, adresa, telefonul, programul de lucru, serviciile oferite și prețurile — vizibile public în Platformă, pentru orice utilizator.
- **Date despre clienți:** numele, telefonul și istoricul de programări al clienților care te contactează prin Platformă, precum și **notițele interne** pe care le adaugi în fișa unui client.
- **Documentele** pe care le încarci pentru clienții tăi.
- **Date de abonament:** planul ales și starea perioadei de probă.

### 1.4 Date tehnice
- **Abonare la notificări push:** dacă activezi notificările, stocăm un identificator tehnic al dispozitivului (endpoint de tip Web Push) necesar exclusiv pentru livrarea notificărilor — nu conține conținutul mesajelor.
- **Preferința de limbă**, stocată local în dispozitiv (localStorage) și în contul tău.

> **Notă privind notele interne CRM:** notițele pe care un Atelier le scrie despre un Client în fișa acestuia sunt vizibile **exclusiv Atelierului respectiv**. Service-Hub nu le arată niciodată Clientului și nu le folosește în alte scopuri.

---

## 2. De ce colectăm aceste date (scopul și temeiul legal)

| Scop | Temei legal |
|---|---|
| Crearea și administrarea contului | Executarea contractului (art. 6(1)(b) GDPR) |
| Procesarea programărilor și devizelor | Executarea contractului |
| Afișarea profilului public al Atelierului către alți utilizatori | Executarea contractului / interes legitim în funcționarea marketplace-ului |
| Trimiterea de notificări push și SMS legate de o programare (confirmare, mutare, reminder) | Executarea contractului |
| Remindere pentru expirarea ITP/RCA/rovinietă | Consimțământ implicit prin introducerea datelor + interes legitim de a oferi o funcție utilă |
| Prevenirea abuzurilor (ex. neprezentări repetate) | Interes legitim |
| Conformarea cu obligații legale (facturare, evidențe contabile ale abonamentelor) | Obligație legală |

Nu folosim datele tale pentru marketing către terți și nu vindem date personale.

---

## 3. Cui transmitem datele

- **Atelierului pe care îl alegi** — numele, telefonul, mașina și istoricul relevant pentru programarea respectivă. Un Atelier nu are acces la datele tale asociate altor ateliere.
- **Furnizori tehnici (persoane împuternicite):**
  - **Supabase** — găzduirea bazei de date și a fișierelor, în regiunea **UE (Frankfurt)**; datele nu părăsesc Uniunea Europeană prin acest furnizor.
  - **Furnizorul de notificări push** (Web Push standard) — primește doar identificatorul tehnic al dispozitivului.
  - **SMSO** — furnizor de SMS din România, folosit doar pentru notificări legate de programări, dacă atelierul/clientul are activat acest canal.
- **Autorități publice**, dacă legea o cere.

Nu transmitem datele tale către terți în scopuri de marketing.

---

## 4. Cât timp păstrăm datele

- Datele de cont și istoricul de programări se păstrează **cât timp contul este activ**.
- La ștergerea contului, datele personale sunt șterse sau anonimizate în termen de **30 de zile**, cu excepția informațiilor pe care legea ne obligă să le păstrăm mai mult (ex. evidențe fiscale legate de abonamente, dacă există, conform termenelor legale de arhivare contabilă din România).
- Documentele încărcate (deviz/factură/raport/poze) rămân stocate cât timp există fie contul Clientului, fie al Atelierului asociat; oricare parte poate solicita ștergerea celor pe care le-a încărcat chiar el.

---

## 5. Securitatea datelor

- Accesul la date este restricționat tehnic prin reguli la nivel de bază de date (Row Level Security): un Atelier vede strict datele propriilor clienți, iar un Client vede strict datele proprii.
- Documentele sunt păstrate într-un spațiu de stocare **privat**, nu public; accesul se face prin linkuri temporare, valabile o oră.
- Parolele sunt gestionate prin sistemul de autentificare Supabase Auth și nu sunt niciodată vizibile în text simplu pentru noi.

---

## 6. Drepturile tale

Conform GDPR, ai dreptul să:

- **Accesezi** datele pe care le deținem despre tine;
- **Rectifici** date incorecte direct din aplicație (profil, mașini) sau printr-o cerere către noi;
- **Ștergi** contul și datele asociate (cu excepțiile legale menționate la punctul 4);
- **Restricționezi** sau **te opui** prelucrării în anumite situații;
- **Primești o copie** a datelor tale într-un format structurat (portabilitate);
- **Depui plângere** la **ANSPDCP** (Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal) — [dataprotection.ro](https://www.dataprotection.ro) — dacă consideri că drepturile tale au fost încălcate.

Pentru exercitarea acestor drepturi, contactează-ne la **[email de contact]**. Vom răspunde în termen de cel mult 30 de zile.

---

## 7. Minori

Platforma nu este destinată persoanelor sub 16 ani. Nu colectăm cu bună știință date despre minori; dacă identificăm un astfel de cont, îl vom dezactiva.

---

## 8. Modificări ale acestei politici

Putem actualiza această politică periodic. Vom marca data ultimei actualizări la începutul documentului. În cazul unor modificări semnificative, te vom notifica prin aplicație sau email.

---

## 9. Contact

Pentru orice întrebare legată de datele tale personale: **[email de contact]**, **[adresă sediu]**.
