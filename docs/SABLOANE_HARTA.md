# Harta ecranelor pe șabloane (etapa 2, 14 noiembrie 2026)

Propunere pentru acordul lui Eduard: fiecare ecran → șablonul lui → ce se mută în fila „Încheiate” (sau în
Istoric) → ce butoane devin secundare sau intră în „Mai multe”. Șabloanele: **A** listă + detaliu, **B** grilă de
carduri egale, **C** formular, **D** panou, **E** pagină de citit (ARCHITECTURE §17, „Page templates”). Peste tot:
un singur buton plin pe ecran, filele sub titlu, Active implicit. Listele mari din admin rămân pentru DataTable
(DESK-01) și nu sunt aici.

Etapa 3 aplică tabelul câte un PR pe șablon, în ordinea A, B, C, D, E.

## Client (șofer)

| Ecran | Adresă | Șablon | În „Încheiate” / Istoric | Secundare sau în „Mai multe” |
|---|---|---|---|---|
| **Programări** (pilot, făcut) | `/c/programari` | A | Finalizată, anulată, respinsă, expirată, deviz refuzat, neprezentat; filtre rapide; ultimele 20 + „Mai vechi” | Buton plin doar în detaliu (Accept deviz / Lasă o recenzie / Caută alt service). „Mai multe”: Mesaj, calendar, programează din nou, fișa de preluare, istoricul mașinii, Anulează |
| Caută | `/c/cauta` | B | — | „Filtre”, „Hartă”, „Cum este ordonată lista?” secundare; inima rămâne pe card |
| Pagina service-ului | `/c/service/:id` | E ¹ | — | „Programează-te” singurul plin, fix jos; Mesaj, Distribuie, Favorite secundare |
| Programare (4 pași) | `/c/service/:id/programare` | C ² | — | „Continuă” singurul plin; „Înapoi” secundar |
| Garaj | `/c/garaj` | B | — | „Adaugă mașină” în antet (secundar); pe card doar mașina, documentele și „Istoric” |
| Mașină nouă / editare | `/c/garaj/nou`, `/c/garaj/:id` | C | — | „Salvează” plin; „Șterge mașina” secundar roșu, la final |
| Istoricul mașinii | `/c/garaj/:id/istoric` | A | — (totul e deja încheiat) | „Raport oficial” în antet; în detaliu: PDF-uri, „Mai multe” |
| Raport oficial (comandă) | `/c/garaj/:id/raport` | C | — | „Plătește” plin |
| Rapoartele mele | `/c/cont/rapoarte` | A | — | „Descarcă” în detaliu |
| Fișa de preluare | `/c/programari/:id/preluare` | E | — | „Confirm fișa” plin, fix jos |
| Mesaje | `/c/mesaje` | A ³ | Conversațiile programărilor încheiate de peste 30 de zile, în „Încheiate” | — |
| Anunțurile echipei | `/c/mesaje/echipa` | E | — | — |
| Cont | `/c/cont` | D ⁴ | — | „Deconectare” și „Șterge contul” secundare, la final |
| Favorite | `/c/cont/favorite` | B | — | „Programează-te” intră în pagina service-ului |
| Notificări | `/c/cont/notificari` | C | — | — |
| Date pentru deviz | `/c/cont/firma` | C | — | — |
| Ajutor și contact | `/c/cont/ajutor` | E | — | Contactele (email, WhatsApp) secundare |
| Categorie / articol din ajutor | `/c/cont/ajutor/…` | E | — | — |
| Solicitările mele | `/c/cont/ajutor/solicitari` | A | Rezolvate și închise | „Solicitare nouă” în antet (secundar); în detaliu „Răspunde” plin |
| Solicitare nouă | `…/solicitari/noua` | C | — | „Trimite” plin |
| Sugestii | `/c/cont/sugestii` | A | Făcute și respinse | „Sugestie nouă” în antet; formularul ca panou în detaliu |
| Firmele mele | `/c/cont/firme` | B | — | „Firmă nouă” în antet |
| Detaliile firmei | `/c/cont/firme/:id` | C | — | „Salvează” plin; transfer, ieșire din firmă în „Mai multe” |
| Preia programarea | `/c/preia/:token` | E | — | „Preia programarea” plin |

## Firmă (flotă), în spațiul firmei

| Secțiune | Șablon | În „Încheiate” / Istoric | Secundare sau în „Mai multe” |
|---|---|---|---|
| Panou | D | — | Cifrele duc la liste; graficele rămân în secțiuni |
| Vehicule (+ fișa vehiculului) | A ⁵ | Vehicule arhivate în „Arhivate” | „Adaugă vehicul” în antet; în detaliu: kilometraj, mentenanță, incidente ca secțiuni, fiecare cu „Adaugă” secundar |
| Programări | A | Ca la client | „Aprobă deviz” plin în detaliu; „Mai multe”: Mesaj, Anulează |
| Costuri | A | Lunile trecute: filtrul de perioadă rămâne | „Adaugă cheltuială” în antet; editarea și ștergerea în „Mai multe” |
| Rapoarte | D | — | „Descarcă” secundar pe fiecare raport |
| Membri | A | Invitații expirate în „Încheiate” | „Invită” în antet; roluri și drepturi în detaliu; „Scoate din firmă” în „Mai multe” |
| Cont (firmă) | D ⁴ | — | — |
| Abonament | E | — | — |

## Service (proprietar și coleg)

| Ecran | Adresă | Șablon | În „Încheiate” / Istoric | Secundare sau în „Mai multe” |
|---|---|---|---|---|
| Panou | `/s/panou` | D | — | Primii pași și avertizările ca secțiuni; „Tipărește” secundar |
| Programări | `/s/programari` | A | Încheiatele sunt deja în Istoric; file „Cereri (N)” și „Programate” (înlocuiesc lista „Afișează”) | „Adaugă programare” în antet (secundar). În detaliu un singur plin, după stare: Confirmă / Începe constatarea / Trimite deviz / Începe lucrul / Finalizare. „Mai multe”: Mesaj, Reprogramează, Neprezentare, Refuz, Fișa de preluare, Fișa mașinii |
| Adaugă programare | `/s/programari/noua` | C | — | „Adaugă programarea” plin |
| Import | `/s/programari/import` | C ² | Importurile anterioare, ca secțiune sub formular | „Anulează importul” în „Mai multe” |
| Devizul | `/s/programari/deviz/:id` | C ⁶ | — | „Trimite deviz” plin, în bara de salvare |
| Fișa de preluare | `/s/programari/preluare/:id` | C | — | „Trimite clientului” plin |
| Fișa mașinii | `/s/…/fisa/:id` | E | — | „Tipărește” secundar |
| Istoric | `/s/istoric` | A | Este el însuși „încheiatele” | „Tipărește” secundar; căutarea rămâne sus |
| Mesaje | `/s/mesaje` | A ³ | Ca la client | — |
| Cont | `/s/cont` | D ⁴ | — | — |
| Recenzii | `/s/cont/recenzii` | A | Cu răspuns dat, în „Cu răspuns” (file: Fără răspuns · Toate) | „Răspunde” plin în detaliu; „Raportează” în „Mai multe” |
| Linkul service-ului | `/s/cont/link` | E | — | „Copiază linkul” plin; „Descarcă QR” secundar |
| Rapoarte | `/s/cont/rapoarte` | D | — | „Descarcă” secundar |
| Abonament | `/s/cont/abonament` | D | Plățile vechi: ultimele 5 + „Vezi toate” | „Plătește” / „Gestionează plata” singurul plin |
| Setări (index) | `/s/cont/setari` | B | — | — |
| Profil, Program, Reguli, Servicii, Vitrina, Devize, Facturare | `/s/cont/setari/*` | C | — | „Salvează” plin, în bara formularului |
| Personal (colegi) | `/s/cont/setari/personal` | A | Invitații expirate, colegi scoși | „Invită un coleg” în antet; „Scoate” în „Mai multe” |
| Notificări | `/s/cont/notificari` | C | — | — |
| Ajutor, solicitări, sugestii | `/s/cont/ajutor/…` | ca la client | ca la client | ca la client |

## Agent de suport

| Ecran | Adresă | Șablon | În „Încheiate” / Istoric | Secundare sau în „Mai multe” |
|---|---|---|---|---|
| Solicitări | `/suport/solicitari` | A | Rezolvate și închise | În detaliu „Răspunde” plin; „Preia”, „Notă internă”, „Escaladează” în „Mai multe” |
| Căutare cont | `/suport/cautare` | A | — | Fișa contului în detaliu, fără butoane de modificare |
| Centrul de ajutor | `/suport/ajutor/…` | E | — | — |
| Proceduri | `/suport/proceduri` | A ⁷ | Procedurile retrase, în „Retrase” | „Procedură nouă” în antet; „Confirm că am citit” plin în detaliu |
| Procedură nouă / editare | `/suport/proceduri/nou`, `…/editare` | C | — | „Publică” plin; „Salvează ciornă” secundar |
| Responsabili | `/suport/proceduri/responsabili` | A | — | — |
| Sugestii de verificat | `/suport/sugestii-de-verificat` | A | Verificate | „Aprobă” plin în detaliu; „Șterge” în „Mai multe” |
| Cont | `/suport/cont` | D ⁴ | — | — |

## Vizitator (nu intră în etape, rămân cum sunt)

Pagina principală, intrarea și contul nou, resetarea parolei și documentele legale au deja forma lor (o coloană
îngustă centrată, respectiv pagină de citit). Documentele legale sunt deja E; restul rămân în afara șabloanelor.

## Unde un ecran nu se potrivește exact

1. **Pagina service-ului** e o pagină de prezentare (galerie, servicii, recenzii, hartă), nu text de citit. Propun
   E (o coloană, 72 de caractere la text) cu galeria sus și „Programează-te” fix jos; serviciile și recenziile ca
   secțiuni, fiecare cu „Vezi toate”.
2. **Formularele în pași** (programarea, importul) sunt C, câte un pas pe ecran, cu bara de jos a formularului.
3. **Mesaje**: lista e A; detaliul e conversația (mesajele și câmpul de scris), nu ordinea fixă antet → stare →
   conținut → documente → acțiuni. Antetul rămâne (cu cine vorbești, programarea), restul e conversația.
4. **Cont** (la toate rolurile) nu are cifre: e D fără casetele de sus — profilul, apoi secțiuni de legături (plăci egale).
5. **Fișa vehiculului de flotă** are multe secțiuni (kilometraj, mentenanță, incidente, documente, costuri). În A,
   detaliul le arată ca secțiuni, fiecare cu cel mult 5 rânduri și „Vezi toate”.
6. **Devizul** are un tabel de poziții (manoperă, piese, variante); rămâne C, cu tabelul ca secțiune, pe lățimea
   formularului (720 px); pe calculator coloanele tabelului se țin într-un rând.
7. **Procedurile**: lista e A, iar detaliul e o pagină de citit (E) în panoul din dreapta.
