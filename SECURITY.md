# Securitate

## Model
- **Fără server, fără cont, fără AI.** Datele stau doar pe telefon (IndexedDB), în zona izolată a browserului pentru această adresă. Singura excepție: **codul fiscal (CUI) al firmei de pe bon** și data sunt trimise la serviciul public ANAF (`webservicesp.anaf.ro`) ca să aflăm denumirea oficială și adresa firmei – o singură dată pe CUI, fără cookie-uri și fără referrer. Produsele, sumele și pozele nu pleacă niciodată din telefon.
- **„Prompt injection” nu se aplică:** aplicația nu folosește niciun model AI. Întrebările („cât m-a costat casa?”) sunt interpretate de cod fix (`js/parsers.js`), care doar caută cuvinte în datele tale; textul nu este executat și nu poate da „comenzi”. Dacă în viitor se adaugă un asistent AI, textul de pe bonuri trebuie tratat ca date, niciodată ca instrucțiuni.
- **Conexiune:** doar HTTPS (GitHub Pages). Singura descărcare externă sunt datele de limbă pentru OCR (fișiere de date, nu cod) de pe cdn.jsdelivr.net, o singură dată.

## Protecții
| Risc | Protecție |
|---|---|
| Cod injectat (XSS) din backup-uri modificate, text OCR, nume | Tot textul este escapat la afișare; toate datele sunt validate strict la salvare, import și încărcare (`js/sanitize.js`): tipuri, formate (dată, ID, culoare), lungimi maxime |
| Cod de pe servere străine | Content-Security-Policy strict: se execută **doar** scripturi din aplicație. Motorul OCR (Tesseract.js 5.1.1) este inclus în `vendor/`, cu sume SHA-256 verificate la publicare |
| Poze capcană (SVG cu script) | Se acceptă doar poze raster; fiecare poză este redesenată ca JPEG (se elimină și metadatele, inclusiv **locația GPS**) |
| Backup furat / trimis greșit | Backup criptat opțional cu parolă: AES-256-GCM, cheie derivată cu PBKDF2-SHA256 (600.000 iterații). Fișierul modificat este detectat și respins |
| Formule periculoase în Excel (CSV injection) | Celulele care încep cu `= + - @` sunt neutralizate |
| Câmpuri injectate în calendar (.ics) | Textul este escapat conform RFC 5545 |
| Încadrarea aplicației în alt site (clickjacking) | Aplicația refuză să ruleze într-un cadru |
| Scurgere de adrese | `referrer: no-referrer`; link-urile noi se deschid cu `noopener` |

## Ce rămâne în grija ta
- **Blocarea telefonului** (PIN, amprentă). Cine are telefonul deblocat poate deschide aplicația.
- **Parola backup-ului:** dacă o uiți, backup-ul criptat nu mai poate fi deschis.
- Instalează aplicația doar de la adresa ta oficială (GitHub Pages din acest repository).

## Verificare
```bash
npm test                                          # include tests/security.test.js
cd vendor/tesseract && sha256sum -c SHA256SUMS    # integritatea motorului OCR
```
