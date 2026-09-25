# 🧾 Fiscan · bonuri, scule, mașini

Aplicație pentru telefon (PWA – se instalează din browser, merge și offline) în care:

- **fotografiezi bonurile** → aplicația citește automat (OCR) magazinul, data, totalul, CIF-ul și, la benzinărie, **litrii și prețul pe litru**;
- **atribui fiecare bon** unei **categorii** (Alimente, Casă – materiale, Casă – manoperă, Mașină – combustibil, Mașină – service, Mașină – asigurări…) și, opțional, unui **proiect** (ex.: „Construcție casă”) și unei **mașini**;
- **produsele de pe bon** sunt extrase automat și încadrate pe grupe și subcategorii: **🏠 Materiale casă** (construcții, electrice – prize, cabluri, doze –, instalații sanitare, vopsele), **🔧 Scule**, și grădină, curățenie – mături, detergenți –, igienă, lactate – unt, ouă –, carne, panificație, fructe și legume, băuturi, dulciuri, alimente de bază, auto, animale). Corectezi o subcategorie o dată, iar aplicația ține minte. În **Bonuri → 📊 Produse** vezi totalul pe subcategorii și cauți orice produs (ex. „unt”: total, cantitate, preț mediu);
- **inventarul sculelor** (🧰 Inventar): fiecare sculă e o bucată separată cu **etichetă** (B1, B2 pentru bormașini, P1 pentru polizor…) pe care o scrii pe sculă, cu serie, poză și loc. **Împrumuți** cu un buton (cui, când) și la întoarcere alegi starea (în regulă / stricată / de reparat) – rămâne istoricul. La garanție: „📤 Copie bon pentru garanție”. Consumabilele (discuri, burghie, pânze) nu intră în inventar, dar apar la scula potrivită (disc 125 → polizor 125); dacă nu e clar ce e, aplicația te întreabă la „De verificat”;
- **situația oricărui produs** (Bonuri → 📊 Produse): scrii „șurub M6”, „disc 125”, „unt” → cât ai cumpărat, de câte ori, ultima dată (unde, cu cât), preț mediu / minim / maxim, pe ce proiect; mărimile diferite (M5 / M6) sunt separate. Cu ⭐ produsul intră în **cămară**: vezi cât a mai rămas, apeși „−1” când folosești, „S-a terminat” și 🛒 îl pune pe lista de cumpărături;
- **proiecte**: fiecare casă (ex. Casa București, Casa Varlam), atelierul și fiecare vehicul au o iconiță pe ecranul principal, cu totalul pe perioada aleasă (azi, săptămâna, luna, anul, total sau un interval). Apeși pe iconiță → vezi cheltuielile pe categorii și subcategorii (ex. Copii → Haine, Jucării, Rechizite, Medicamente) și încarci bonul direct în proiect. Un bon se poate **împărți** pe mai multe proiecte (produs cu produs), iar fiecare magazin își ține minte proiectul obișnuit;
- **meniul de jos**: Acasă · Bonuri · Inventar · Mașină · Mai mult (se apasă sau se trage în sus pentru Liste, Produse, Setări, Export…);
- **citirea bonului** e verificată: poza e rotită automat, firma e găsită după forma juridică (SRL, SA…) și CUI (cu cifra de control, confirmat automat la ANAF), totalul e comparat cu suma plătită (card / numerar) și cu suma produselor; garanțiile **SGR** apar separat ca bani recuperabili, iar produsele neidentificate le numești o dată și aplicația le recunoaște data viitoare (după codul de bare);
- **⚠️ De verificat**: bonurile cu ceva nesigur (produs neidentificat, total diferit, CUI îndoielnic, dată veche, fără categorie) apar pe ecranul principal și se pot filtra;
- **📤 Copie bon**: trimiți pozele originale sau faci PDF / tipărești unul sau mai multe bonuri (de ex. pentru garanție); pozele bonurilor cu scule se păstrează la calitate mare;
- **retururile** sunt recunoscute automat (total negativ, „*** RETUR ***”), se scad din cheltuieli și se leagă de bonul original;
- **întrebi** în limbaj natural: *„Cât m-a costat casa?”*, *„Cât am dat pe benzină anul acesta?”*, *„Cheltuieli mașină luna trecută”*, *„Dedeman martie”*, *„Băuturi luna asta”*, *„Unt”*, *„Scule”* → primești totalul, defalcarea pe categorii/proiecte și lista bonurilor;
- **vehicule** de orice fel: mașini pe benzină / motorină / GPL, **electrice** (încărcări în kWh, acasă sau la stații, kWh/100 km, cost/100 km), hibride plug-in, motociclete, **utilaje și tractoare** (cu ore de funcționare). Datele mașinii se citesc din **poza talonului / CIV** (număr, marcă, model, VIN, motor – fără numele sau adresa proprietarului, iar poza nu se păstrează) și, opțional, după VIN dintr-o bază de date gratuită. **Fișa tehnică** (anvelope, presiuni, ulei, interval de revizie, poze cu etichetele) și **istoricul pentru vânzare** (kilometraj în timp, revizii și reparații, cu sau fără sume și poze, fără date personale) se fac PDF când ai nevoie;
- introduci **kilometrajul** (sau orele motor) cu poză la bord sau manual; la alimentare poți nota drumul; opțional imporți din **Google Timeline** doar km parcurși pe zi (fișierul e citit doar pe telefon);
- primești **notificări** înainte să expire **RCA, ITP, CASCO, rovinieta, extinctorul, trusa medicală**, la **revizie** (la dată sau la kilometraj, ce vine primul) și la **schimbul anvelopelor** iarnă / vară etc. (implicit cu 30, 7 și 1 zi înainte) și le poți exporta în **calendarul telefonului** (.ics, cu alarme);
- ții **liste de cumpărături / materiale / activități** pe zile („ce am de cumpărat azi”), bifezi ce ai luat;
- **exporți** totul în **CSV** (Excel, programe de contabilitate/facturare) sau **backup JSON** complet (inclusiv poze), pe care îl poți restaura.

Datele sunt salvate **doar pe telefon** (IndexedDB). Nu există server și niciun cont. Singurul lucru trimis în afară este CUI-ul firmei de pe bon, către ANAF, ca să afli denumirea oficială și adresa firmei. Detalii despre protecții: [SECURITY.md](SECURITY.md).

## Cum o folosești

### Varianta 1 – GitHub Pages (recomandat)
1. Unește ramura în `main`.
2. În GitHub: **Settings → Pages → Source: GitHub Actions**.
3. Workflow-ul `Publicare pe GitHub Pages` publică aplicația la `https://<utilizator>.github.io/<repo>/`.
4. Deschide adresa pe telefon → meniul browserului → **„Adaugă pe ecranul principal” / „Instalează aplicația”**.

> Camera și notificările cer HTTPS, pe care GitHub Pages îl oferă automat.

### Varianta 2 – local
```bash
npm start        # pornește un server pe http://localhost:8080
npm test         # testele pentru citirea bonurilor, întrebări și notificări
```

## Notificări
- La fiecare deschidere a aplicației se verifică expirările și se trimite notificarea potrivită (o singură dată pe prag).
- Pe Android, cu aplicația instalată, se verifică și **în fundal** (Periodic Background Sync, aproximativ de 2 ori pe zi).
- Pe iPhone notificările web funcționează doar cu aplicația adăugată pe ecranul principal (iOS 16.4+). Pentru siguranță, apasă **„📆 Adaugă toate în calendarul telefonului”**: evenimentele au alarme proprii și sună chiar dacă aplicația nu e deschisă.

## OCR
**Bonuri lungi:** fotografiază partea de sus, apoi apasă **„➕ Continuare bon”** pentru fiecare bucată următoare (puțin suprapuse, de sus în jos, maxim 10 poze). Aplicația citește fiecare poză, lipește textele în ordine și ia magazinul, data și CUI-ul de sus și totalul de jos. Toate pozele rămân la același bon.

Recunoașterea textului rulează direct pe telefon cu [Tesseract.js](https://github.com/naptha/tesseract.js) (română + engleză), inclus în aplicație (`vendor/tesseract`). La prima folosire se descarcă ~10 MB de date de limbă, păstrate apoi în cache. Pentru rezultate bune: bonul întins, lumină bună, poza cât mai dreaptă. Verifică valorile înainte de salvare. Tot ce completezi tu nu este suprascris de OCR.

## Integrare cu alte programe
- **CSV produse**: `Data;Magazin;Produs;Subcategorie;Cantitate;Pret unitar;Suma;Categorie bon;Proiect;Retur`.
- **CSV** (separator `;`, zecimale cu virgulă, UTF-8 cu BOM, se deschide corect în Excel): `Data;Magazin;CIF;Categorie;Proiect;Masina;Total;Litri;Pret/L;Km;Carburant;Note`.
- **JSON** (backup): `{ app: "bonuri-masina", version: 1, expenses[], odometer[], vehicles[], reminders[], tasks[], categories[], projects[] }`. Pozele sunt incluse ca `data:` URL.
- Pentru legături directe viitoare (SmartBill, Oblio, SAGA, e-Factura/ANAF, Google Sheets), modelul de date este deja separat în `js/db.js`, iar exportul în `js/app.js` (`exportCSV` / `exportJSON`). Un conector nou se adaugă ca funcție de export/sincronizare.

## Structura
```
index.html            interfața
css/styles.css        stil (mod luminos/întunecat)
js/app.js             ecrane, formulare, export, notificări
js/parsers.js         citirea bonurilor / kilometrajului, interpretarea întrebărilor
js/reminder-core.js   calculul notificărilor (folosit și de service worker)
js/db.js              baza de date locală (IndexedDB)
js/inventory.js       inventarul (sincronizare cu bonurile, retururi)
js/items.js           produsele de pe bon, subcategorii
js/preprocess.js      decuparea bonului și eliminarea umbrelor înainte de OCR
js/sanitize.js        validarea datelor, protecții CSV/ICS
js/crypto.js          criptarea backup-urilor
vendor/tesseract/     motorul OCR inclus local
js/ocr.js             OCR (Tesseract.js) și micșorarea pozelor
sw.js                 offline + verificare expirări în fundal
tests/                teste (node --test)
```
