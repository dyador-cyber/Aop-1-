import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItems, classifyItem, itemKey } from '../js/items.js';
import { parseReceipt } from '../js/parsers.js';

test('produse: formate uzuale de bon', () => {
  const text = `KAUFLAND ROMANIA SCS
CIF RO15991149
LAPTE ZUZU 1.5% 1L
2,000 BUC x 7,49        14,98 B
PAINE ALBA 400G          3,50 B
UNT PRESIDENT 200G      12,99 B
3.000 x 2.50
APA BORSEC 2L            7,50 B
DETERGENT ARIEL 2KG     54,90 A
MATURA PLASTIC          19,90 A
REDUCERE               -5,00
SUBTOTAL               108,77
TOTAL                  108,77
CARD                   108,77
23.09.2026 18:20`;
  const items = parseItems(text);
  assert.deepEqual(items.map((i) => [i.name, i.amount, i.qty]), [
    ['LAPTE ZUZU 1.5% 1L', 14.98, 2],
    ['PAINE ALBA 400G', 3.5, null],
    ['UNT PRESIDENT 200G', 12.99, null],
    ['APA BORSEC 2L', 7.5, 3],
    ['DETERGENT ARIEL 2KG', 54.9, null],
    ['MATURA PLASTIC', 19.9, null],
    ['REDUCERE', -5, null],
  ]);
  assert.deepEqual(items.map((i) => classifyItem(i.name)), ['dairy', 'bakery', 'dairy', 'drinks', 'cleaning', 'cleaning', 'other']);
  assert.equal(+items.reduce((s, i) => s + i.amount, 0).toFixed(2), 108.77);
});

test('produse pe un singur rând cu cantitate', () => {
  const items = parseItems('DEDEMAN SRL\nCIMENT 40KG 10 x 32,50   325,00\nADEZIV GRESIE            89,90\nTOTAL 414,90');
  assert.deepEqual(items.map((i) => [i.name, i.qty, i.unitPrice, i.amount]), [['CIMENT 40KG', 10, 32.5, 325], ['ADEZIV GRESIE', null, null, 89.9]]);
  assert.deepEqual(items.map((i) => classifyItem(i.name)), ['materials', 'materials']);
});

test('clasificare: cuvântul cel mai specific câștigă; corecturile învățate au prioritate', () => {
  assert.equal(classifyItem('NISIP PISICI 5KG'), 'pets');
  assert.equal(classifyItem('NISIP 25KG'), 'materials');
  assert.equal(classifyItem('ULEI MOTOR 5W30'), 'auto');
  assert.equal(classifyItem('ULEI FLOARE SOARELUI'), 'staples');
  assert.equal(classifyItem('SURUBELNITA PH2'), 'tools');
  assert.equal(classifyItem('BERE URSUS 0.5L'), 'drinks');
  assert.equal(classifyItem('PRODUS NECUNOSCUT'), 'other');
  assert.equal(classifyItem('PRODUS NECUNOSCUT XL', { [itemKey('produs necunoscut xl')]: 'garden' }), 'garden');
  assert.equal(itemKey('Hogert CLEȘTE pini 180mm'), 'hogert cleste pini');
});

test('retur: produsele devin negative', () => {
  const text = `HORNBACH CENTRALA SRL
*** RETUR ***
ART/EAN 5902801327056
-1 BUC. X 129,00
HOGERT CLESTE PINI      -129,00 A
MOTIV: RETUR
TOTAL [1] RON -129,00`;
  const r = parseReceipt(text, new Date(2026, 8, 24));
  assert.equal(r.isReturn, true);
  assert.equal(r.total, -129);
  const items = parseItems(text, { isReturn: r.isReturn });
  assert.deepEqual(items.map((i) => [i.name, i.amount]), [['HOGERT CLESTE PINI', -129]]);
  assert.equal(classifyItem(items[0].name), 'tools');
});

test('întrebări pe produse: unt, băuturi, mături, scule', async () => {
  const { runQuery, stem } = await import('../js/parsers.js');
  const { SUBCATS } = await import('../js/items.js');
  assert.equal(stem('mături'), stem('MĂTURĂ'));
  assert.equal(stem('băuturi'), 'baut');
  const today = new Date(2026, 8, 24);
  const ctx = {
    subcats: SUBCATS, projects: [], vehicles: [], odometer: [],
    categories: [{ id: 'c1', name: 'Alimente & cumpărături' }, { id: 'c2', name: 'Casă – materiale construcții' }],
    expenses: [
      { id: 'a', date: '2026-09-10', total: 60, categoryId: 'c1', store: 'Kaufland', items: [
        { id: '1', name: 'UNT PRESIDENT', amount: 12.99, sub: 'dairy' },
        { id: '2', name: 'BERE URSUS', amount: 20, sub: 'drinks' },
        { id: '3', name: 'MATURA PLASTIC', amount: 19.9, sub: 'cleaning' }] },
      { id: 'b', date: '2026-08-10', total: 25, categoryId: 'c1', store: 'Lidl', items: [
        { id: '4', name: 'UNT 82%', amount: 10, sub: 'dairy' }, { id: '5', name: 'APA DORNA', amount: 15, sub: 'drinks' }] },
      { id: 'c', date: '2026-09-12', total: 200, categoryId: 'c2', store: 'Hornbach', items: [{ id: '6', name: 'HOGERT CLESTE', amount: 129, sub: 'tools' }, { id: '7', name: 'CIMENT', amount: 71, sub: 'materials' }] },
      { id: 'd', date: '2026-09-23', total: -129, isReturn: true, categoryId: 'c2', store: 'Hornbach', items: [{ id: '8', name: 'HOGERT CLESTE', amount: -129, sub: 'tools' }] },
    ],
  };
  const unt = runQuery('cât am dat pe unt', ctx, today);
  assert.equal(unt.total, 22.99);
  assert.equal(unt.items.length, 2);
  assert.equal(runQuery('băuturi luna asta', ctx, today).total, 20);
  assert.equal(runQuery('băuturi', ctx, today).total, 35);
  assert.equal(runQuery('mături', ctx, today).total, 19.9);
  assert.equal(runQuery('scule', ctx, today).total, 0, 'cleștele returnat se anulează');
  assert.equal(runQuery('Cât m-a costat casa?', ctx, today).total, 71, 'returul se scade din casă');
});

test('retur real (text OCR din browser, cu erori)', () => {
  const text = `Bl HORNBACH CENTRAY |
i SGS ARE An GENTRALA SRL
MUNICIPIUL BUCURLSY |
Mi 23/9/2026 15:31 0154
: +x RETUR fat SR
A 411 /CAN 5902801327056
A Bic. x 129,00
WGERY CLESTE PINI -12,00 A
#3TIV: RETUR
[TAL [1] RON -129,00
EY RON -129,00`;
  const r = parseReceipt(text, new Date(2026, 8, 24));
  assert.equal(r.isReturn, true);
  assert.equal(r.total, -129);
  const items = parseItems(text, { isReturn: true });
  assert.deepEqual(items.map((i) => [i.name, i.amount]), [['WGERY CLESTE PINI', -129]]);
  assert.equal(classifyItem(items[0].name), 'tools');
});

test('rândul de total citit greșit („MAL: RON”) nu devine produs', () => {
  assert.deepEqual(parseItems('HORNBACH CENTRALA SRL\nVISA DEBIT\nMAL: RON 1696,12\nPIN OK'), []);
});

test('scule electrice și de lucru ajung la „Scule & unelte”', () => {
  for (const n of ['PROIECTOR LED 50W', 'Proiector cu senzor', 'COMPRESOR AER 50L', 'APARAT SUDURA INVERTOR', 'NIVELA LASER BOSCH', 'POLIZOR UNGHIULAR 125MM', 'MALAXOR 1600W'])
    assert.equal(classifyItem(n), 'tools', n);
  assert.equal(classifyItem('BEC LED E27'), 'electrical');
});

test('bon fiscal real Hornbach fotografiat în 3 părți suprapuse (text OCR cu zgomot)', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('./fixtures/hornbach-bon-fiscal-3-poze.txt', import.meta.url), 'utf8');
  const r = parseReceipt(text, new Date(2026, 8, 24));
  assert.equal(r.store, 'Hornbach');
  assert.equal(r.total, 1696.12);
  assert.equal(r.isReturn, false);
  const items = parseItems(text);
  assert.equal(items.length, 18, 'POZIȚII: 18 – fără dubluri din zonele suprapuse');
  assert.equal(+items.reduce((a, i) => a + i.amount, 0).toFixed(2), 1696.12, 'suma produselor = totalul bonului');
  const tools = items.filter((i) => classifyItem(i.name) === 'tools').map((i) => [i.amount, i.qty]);
  assert.deepEqual(tools, [[189.8, 2], [129, 1], [655, 1]], 'cele două proiectoare și cleștele');
  assert.ok(items.filter((i) => classifyItem(i.name) === 'electrical').length >= 12);
});

test('dimensiunile din nume nu sunt cantități', () => {
  const items = parseItems('1 BUC. x 17,90 LEI\nSCAME DOZĂ 95X95MM 17,90 A\nCM: ART/EAN 8001636210193\n1 BUC. x 655,00 LEI\nLP PROIE. STV. 2X50W 655,00 A\nSUBTOTAL LEI 672,90');
  assert.deepEqual(items.map((i) => [i.name, i.qty, i.amount]), [['SCAME DOZĂ 95X95MM', 1, 17.9], ['LP PROIE. STV. 2X50W', 1, 655]]);
  assert.equal(classifyItem('LP PROIE. STV. 2X50W'), 'tools');
  assert.equal(classifyItem('NYM-J 3X1,5 MM INEL'), 'electrical');
});

test('aceeași poziție citită diferit în două poze (189,80 / 183,80) nu se dublează', () => {
  const p1 = '2 BUC. x 94,90 LEI\nFS oD PROIECTOR 30M 189,80 A\nCM: ART/EAN 4306517910495\n2 BUC. x 15,70 LEI\nCOLIERE400X4,8MM ALB 31,40 A';
  const p2 = '- BUC. x 94,90 LEI\nPROIECTOR 30W 183,80 A\nCM: ART/EAN 4306517910495\n2 BUC. x 15,70 LEI\nCOLIERE400X4,8MM ALB 31,40 A\nWAGO COMPACT CLEMA 35,50 A';
  const items = parseItems(p1 + '\n--- continuare bon ---\n' + p2);
  assert.deepEqual(items.map((i) => [i.name, i.amount, i.qty]), [['PROIECTOR 30W', 189.8, 2], ['COLIERE400X4,8MM ALB', 31.4, 2], ['WAGO COMPACT CLEMA', 35.5, null]]);
});

test('priza și cablul sunt „Materiale casă”, proiectorul e la „Scule”', async () => {
  const { groupOf, SUBCATS, GROUPS } = await import('../js/items.js');
  const { runQuery } = await import('../js/parsers.js');
  assert.equal(classifyItem('PRIZĂ SCAME APL.IP66'), 'electrical');
  assert.equal(groupOf('electrical').key, 'house');
  assert.equal(groupOf('materials').key, 'house');
  assert.equal(groupOf(classifyItem('LP PROIE. STV. 2X50W')).key, 'tools');
  const ctx = { subcats: SUBCATS, groups: GROUPS, categories: [], projects: [], vehicles: [], odometer: [], expenses: [
    { id: 'x', date: '2026-09-23', total: 889.9, store: 'Hornbach', items: [
      { id: '1', name: 'PRIZĂ SCAME APL.IP66', amount: 99.9, sub: 'electrical' },
      { id: '2', name: 'CIMENT 40KG', amount: 35, sub: 'materials' },
      { id: '3', name: 'LP PROIE. STV. 2X50W', amount: 655, sub: 'tools' },
      { id: '4', name: 'UNT', amount: 100, sub: 'dairy' }] }] };
  const today = new Date(2026, 8, 24);
  assert.equal(runQuery('materiale', ctx, today).total, 134.9);
  assert.equal(runQuery('electrice', ctx, today).total, 99.9);
  assert.equal(runQuery('mâncare', ctx, today).total, 100);
  assert.equal(runQuery('scule', ctx, today).total, 655);
});

test('„materiale” = doar materialele de pe bon; „casa” = bonurile întregi', async () => {
  const { SUBCATS, GROUPS } = await import('../js/items.js');
  const { runQuery } = await import('../js/parsers.js');
  const ctx = { subcats: SUBCATS, groups: GROUPS, projects: [], vehicles: [], odometer: [],
    categories: [{ id: 'c', name: 'Casă – materiale construcții' }, { id: 'm', name: 'Mașină – combustibil', isFuel: true }],
    expenses: [
      { id: 'x', date: '2026-09-23', total: 754.9, categoryId: 'c', store: 'Hornbach', items: [
        { id: '1', name: 'PRIZĂ SCAME', amount: 99.9, sub: 'electrical' }, { id: '2', name: 'PROIECTOR', amount: 655, sub: 'tools' }] },
      { id: 'y', date: '2026-09-20', total: 300, categoryId: 'm', store: 'OMV', fuel: { liters: 40 } }] };
  const today = new Date(2026, 8, 24);
  assert.equal(runQuery('materiale', ctx, today).total, 99.9);
  assert.equal(runQuery('Cât m-a costat casa?', ctx, today).total, 754.9);
  assert.equal(runQuery('cheltuieli mașină', ctx, today).total, 300);
});

test('rotirea imaginii: 90° + 270° = identic, dimensiuni inversate', async () => {
  const { rotate } = await import('../js/preprocess.js');
  const w = 3; const h = 2;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px[i * 4] = i * 10;
  const r90 = rotate(px, w, h, 90);
  assert.deepEqual([r90.width, r90.height], [2, 3]);
  // pixelul din stânga-sus ajunge în dreapta-sus
  assert.equal(r90.data[(0 * 2 + 1) * 4], 0);
  const back = rotate(r90.data, r90.width, r90.height, 270);
  assert.deepEqual([...back.data].filter((_, i) => i % 4 === 0), [...px].filter((_, i) => i % 4 === 0));
  const r180 = rotate(px, w, h, 180);
  assert.equal(r180.data[0], 50);
});
