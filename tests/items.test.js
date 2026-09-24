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
