# 🧾 Bonuri & Mașină

Aplicație pentru telefon (PWA – se instalează din browser, merge și offline) în care:

- **fotografiezi bonurile** → aplicația citește automat (OCR) magazinul, data, totalul, CIF-ul și, la benzinărie, **litrii și prețul pe litru**;
- **atribui fiecare bon** unei **categorii** (Alimente, Casă – materiale, Casă – manoperă, Mașină – combustibil, Mașină – service, Mașină – asigurări…) și, opțional, unui **proiect** (ex.: „Construcție casă”) și unei **mașini**;
- **întrebi** în limbaj natural: *„Cât m-a costat casa?”*, *„Cât am dat pe benzină anul acesta?”*, *„Cheltuieli mașină luna trecută”*, *„Dedeman martie”* → primești totalul, defalcarea pe categorii/proiecte și lista bonurilor;
- introduci **kilometrajul** cu poză la bord (OCR pe cifre) sau manual → consum L/100 km, km parcurși;
- primești **notificări** înainte să expire **RCA, ITP, CASCO, rovinieta** etc. (implicit cu 30, 7 și 1 zi înainte) și le poți exporta în **calendarul telefonului** (.ics, cu alarme);
- ții **liste de cumpărături / materiale / activități** pe zile („ce am de cumpărat azi”), bifezi ce ai luat;
- **exporți** totul în **CSV** (Excel, programe de contabilitate/facturare) sau **backup JSON** complet (inclusiv poze), pe care îl poți restaura.

Datele sunt salvate **doar pe telefon** (IndexedDB). Nu există server și niciun cont. Detalii despre protecții: [SECURITY.md](SECURITY.md).

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
Recunoașterea textului rulează direct pe telefon cu [Tesseract.js](https://github.com/naptha/tesseract.js) (română + engleză), inclus în aplicație (`vendor/tesseract`). La prima folosire se descarcă ~10 MB de date de limbă, păstrate apoi în cache. Pentru rezultate bune: bonul întins, lumină bună, poza cât mai dreaptă. Verifică valorile înainte de salvare. Tot ce completezi tu nu este suprascris de OCR.

## Integrare cu alte programe
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
js/sanitize.js        validarea datelor, protecții CSV/ICS
js/crypto.js          criptarea backup-urilor
vendor/tesseract/     motorul OCR inclus local
js/ocr.js             OCR (Tesseract.js) și micșorarea pozelor
sw.js                 offline + verificare expirări în fundal
tests/                teste (node --test)
```
