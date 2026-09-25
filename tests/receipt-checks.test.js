import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItems, classifyItem, validEan } from '../js/items.js';
import { parseReceipt } from '../js/parsers.js';
import { expenseFlags, isUnknownItem } from '../js/checks.js';
import { sanitize, sanitizeItemNames } from '../js/sanitize.js';

// Text citit (OCR, cu greșelile lui) de pe un bon Lisse: „cantitate BUCATA X preț = sumă” și litera TVA lipită de sumă.
const LISSE = `RELUARE PRINTARE
FE LISSE MARKET SRL
MUN. BUCURESTI SECTOR 2
4 CIF: RO29226198 Lo
NN DATE FIRMA : LISSE MARKET SRL UL
| FRANZELA LIDER PAN 300G 2 BUCATA x 250 5.008 |
ME FRANZELA PUNGA PAINE 2 BUCATA X 0. 10- 0.206 §
"qf COCR COLA D.SIL NRG C 1 BUCATA X 7 00- 2004 gi
fl CARANTIE SCR STICLA 1 BUCATA X 0.50= 0.50 ¢ Ll
| FUSULL025G 1 BUCATA X 7.20 7p
E CARANTIE SGR DOZA | BUCATA X 0.50= 0.505 f°
PUN Liss 1 BUCATA X 1.00= 1.008 ¢
WI 11ARLBORD GOLD ORIG. 1003 Lo
! BUCATA X 32.50= 32.504 |...
N PON ORDINE : 1231546
TRL LE) SEI
CARD 53.90 Bf
REST 0.00 §
TOTAL TVA A - 214 8.20
DATA: 25-09-2026 ORA: 09:14`;

test('bon Lisse: produse, garanții SGR, tutun și totalul luat de la plată', () => {
  const r = parseReceipt(LISSE, new Date('2026-09-25'));
  assert.equal(r.store, 'Lisse Market');
  assert.equal(r.total, 53.9);
  assert.equal(r.paid, 53.9);
  assert.equal(r.totalSource, 'plata');
  const items = parseItems(LISSE);
  assert.deepEqual(items.map((i) => i.amount), [5, 0.2, 7, 0.5, 7.2, 0.5, 1, 32.5]);
  assert.deepEqual(items.map((i) => i.qty), [2, 2, 1, 1, 1, 1, 1, 1]);
  assert.equal(items[0].unitPrice, 2.5);
  assert.equal(+items.reduce((a, i) => a + i.amount, 0).toFixed(2), 53.9);
  assert.equal(classifyItem(items[3].name), 'sgr'); // „CARANTIE SCR” = garanție SGR
  assert.equal(classifyItem(items[5].name), 'sgr');
  assert.equal(classifyItem(items[7].name), 'tobacco'); // „11ARLBORD” = Marlboro
  assert.equal(classifyItem('TIGARI KENT NANOTEK'), 'tobacco');
  assert.equal(items[7].name.includes('GOLD'), true); // numele vine de pe rândul de deasupra
});

test('coduri de bare: validare și legarea de produs', () => {
  assert.equal(validEan('5902801327056'), true);
  assert.equal(validEan('5902801327057'), false);
  assert.equal(validEan('96385074'), true);
  const after = `1 BUC x 15,00 LEI
MYYM 3X2,5 MM MOSOR 15,00 A
CM: ART/EAN 4022873020585
1 BUC. x 73,40 LEI
SCAME INTRERUPATOR 73.40 A
CM: ART/EAN 8001636210070
TOTAL 88,40`;
  const a = parseItems(after);
  assert.deepEqual(a.map((i) => i.ean), ['4022873020585', '8001636210070']);
  // retur cu un singur produs: codul vine înaintea produsului
  const before = `RETUR
ART/EAN 5902801327056
1 BUC. X 129,00
AJGERT CLESTE PINI -129,00 A
TOTAL [1] RON -129,00`;
  const b = parseItems(before, { isReturn: true });
  assert.equal(b.length, 1);
  assert.equal(b[0].ean, '5902801327056');
  assert.equal(b[0].amount, -129);
  assert.equal(parseReceipt(before).total, -129);
});

test('De verificat: produse neidentificate, total diferit de plată sau de produse', () => {
  const base = { date: '2026-09-25', createdAt: Date.parse('2026-09-25'), categoryId: 'c1', total: 10, items: [] };
  assert.deepEqual(expenseFlags(base), []);
  const unknown = { ...base, items: [{ name: 'FUSULL025G', ocrName: 'FUSULL025G', sub: 'other', amount: 10 }] };
  assert.deepEqual(expenseFlags(unknown).map((f) => f.key), ['items-unknown']);
  assert.equal(isUnknownItem({ name: 'Red Bull', ocrName: 'FUSULL025G', sub: 'other' }), false); // corectat de utilizator
  assert.deepEqual(expenseFlags({ ...base, paid: 12 }).map((f) => f.key), ['paid']);
  assert.deepEqual(expenseFlags({ ...base, items: [{ name: 'x', sub: 'dairy', amount: 7 }] }).map((f) => f.key), ['items-sum']);
  assert.deepEqual(expenseFlags({ ...base, date: '2020-01-01', categoryId: '', cif: 'RO123', cifValid: false }).map((f) => f.key), ['cif', 'date-old', 'no-cat']);
  assert.deepEqual(expenseFlags({ ...base, paid: 12, reviewed: true }), []);
});

test('date noi salvate curat: cod de bare, nume învățate', () => {
  const e = sanitize('expenses', { id: 'e1', date: '2026-09-25', total: 1, paid: 1, totalSource: 'hack', reviewed: 'da',
    items: [{ id: 'i1', name: 'Unt', amount: 1, ean: '12<script>', ocrName: 'UNT' }] });
  assert.equal(e.totalSource, '');
  assert.equal(e.reviewed, false);
  assert.equal(e.items[0].ean, '');
  assert.equal(e.items[0].ocrName, 'UNT');
  const n = sanitizeItemNames({ 'ean 5902801327056': 'Clește', '<img>': 'x', 'unt president': 'Unt 200 g', 'x': 5 });
  assert.deepEqual(n, { 'ean 5902801327056': 'Clește', 'unt president': 'Unt 200 g' });
});

test('CUI ilizibil al unui magazin cunoscut și „TOTAL” citit greșit', () => {
  const r = parseReceipt(`HORNBACH CENTRALA SRL
| cul: RO 7777320 ,
LOIAL: RON 1696, 12
VISA DEBIT`, new Date('2026-09-25'));
  assert.equal(r.store, 'Hornbach');
  assert.equal(r.cif, 'RO17777320');
  assert.equal(r.cifRepaired, true);
  assert.equal(r.total, 1696.12);
  assert.equal(r.totalSource, 'total');
});

test('bon Lisse decolorat: „BUCATA” și „SGR” citite greșit', () => {
  const text = `TE FIRMA : LISSE MARKET SRI
» » NTE SOR STICLA 1 BUCATA x 0.50: 5
~ Pp FONT IE SCR DOZA | BUCAIA x 0.50- 7 [ie
: dB “NG LISSE 1 BUCRTA x 1.00= 1 in.
“3RLBORD GOLD ORIG. 1005
J 1 BUCATA x 32.50= 2.50 -
FRANZELA 2 BUCHTH x 2.50= 5.00 B`;
  assert.equal(parseReceipt(text).store, 'Lisse Market');
  const items = parseItems(text);
  assert.deepEqual(items.map((i) => i.amount), [0.5, 0.5, 1, 32.5, 5]);
  assert.equal(classifyItem(items[0].name), 'sgr');
  assert.equal(classifyItem(items[1].name), 'sgr');
  assert.equal(items[3].name.includes('GOLD'), true);
});
