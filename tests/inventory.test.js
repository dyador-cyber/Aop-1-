import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncFromExpense, undoExpense, similarity, findSimilar, addMonths } from '../js/inventory.js';

let n = 0;
const uid = () => 'inv' + (++n);
const apply = (inv, out) => {
  const map = new Map(inv.map((x) => [x.id, x]));
  for (const id of out.dels) map.delete(id);
  for (const x of out.puts) map.set(x.id, x);
  return [...map.values()];
};

const purchase = {
  id: 'p1', date: '2026-09-23', store: 'Hornbach', total: 300, items: [
    { id: 'i1', name: 'HOGERT CLESTE PINI', qty: 1, unitPrice: 129, amount: 129, sub: 'tools' },
    { id: 'i2', name: 'BURGHIE BETON SET', qty: 2, unitPrice: 50, amount: 100, sub: 'tools' },
    { id: 'i3', name: 'CIMENT 40KG', qty: 1, unitPrice: 71, amount: 71, sub: 'materials' },
  ],
};

test('similaritate tolerantă la OCR', () => {
  assert.ok(similarity('HGERT CLESTE PINI', 'HOGERT CLEȘTE PINI') >= 0.6);
  assert.ok(similarity('WGERY CLESTE PINI', 'HOGERT CLESTE PINI') >= 0.6);
  assert.ok(similarity('BORMASINA BOSCH', 'CLESTE PATENT') < 0.6);
  assert.equal(addMonths('2026-09-23', 24), '2028-09-23');
});

test('cumpărare: sculele intră în inventar, materialele nu', () => {
  const out = syncFromExpense(purchase, [], { uid, now: 1 });
  assert.deepEqual(out.added.map((x) => [x.name, x.qty, x.price, x.warrantyUntil, x.status]), [
    ['HOGERT CLESTE PINI', 1, 129, '2028-09-23', 'avail'],
    ['BURGHIE BETON SET', 2, 50, '2028-09-23', 'avail'],
  ]);
  // resalvarea bonului nu dublează
  const inv = apply([], out);
  const again = syncFromExpense(purchase, inv, { uid });
  assert.equal(again.added.length, 0);
  assert.equal(apply(inv, again).length, 2);
});

test('retur: scula se găsește după nume chiar citit greșit și e marcată returnată', () => {
  let inv = apply([], syncFromExpense(purchase, [], { uid }));
  const ret = { id: 'r1', date: '2026-09-23', store: 'Hornbach', isReturn: true, returnOf: 'p1', total: -129,
    items: [{ id: 'j1', name: 'HGERT CLESTE PINI', qty: 1, amount: -129, sub: 'tools' }] };
  const out = syncFromExpense(ret, inv, { uid });
  assert.equal(out.returned.length, 1);
  inv = apply(inv, out);
  const cleste = inv.find((x) => x.itemId === 'i1');
  assert.equal(cleste.status, 'returned');
  // același retur salvat din nou nu mai scade nimic
  assert.equal(syncFromExpense(ret, inv, { uid }).returned.length, 0);
  // ștergerea returului readuce scula
  inv = apply(inv, undoExpense(ret, inv));
  assert.equal(inv.find((x) => x.itemId === 'i1').status, 'avail');
});

test('retur parțial scade cantitatea; retur fără cumpărare înregistrată e raportat', () => {
  let inv = apply([], syncFromExpense(purchase, [], { uid }));
  const out = syncFromExpense({ id: 'r2', date: '2026-09-24', store: 'Hornbach', isReturn: true,
    items: [{ id: 'k1', name: 'BURGHIE BETON SET', qty: -1, amount: -50, sub: 'tools' }, { id: 'k2', name: 'FIERASTRAU PENDULAR', qty: -1, amount: -300, sub: 'tools' }] }, inv, { uid });
  inv = apply(inv, out);
  const b = inv.find((x) => x.itemId === 'i2');
  assert.equal(b.qty, 1);
  assert.equal(b.status, 'avail');
  assert.deepEqual(out.unmatched, ['FIERASTRAU PENDULAR']);
});

test('produs scos de pe bon dispare din inventar, dar nu dacă l-ai editat', () => {
  let inv = apply([], syncFromExpense(purchase, [], { uid }));
  inv = inv.map((x) => (x.itemId === 'i2' ? { ...x, edited: true, location: 'Garaj' } : x));
  const out = syncFromExpense({ ...purchase, items: [] }, inv, { uid });
  inv = apply(inv, out);
  assert.deepEqual(inv.map((x) => x.itemId), ['i2']);
  assert.deepEqual(undoExpense(purchase, inv).dels, [], 'scula editată de tine rămâne și dacă ștergi bonul');
});

test('„ai deja” găsește scule asemănătoare deținute', () => {
  const inv = [
    { id: 'a', name: 'CLESTE PATENT KNIPEX', status: 'avail' },
    { id: 'b', name: 'CLESTE PATENT VECHI', status: 'returned' },
    { id: 'c', name: 'BORMASINA', status: 'lent' },
  ];
  assert.deepEqual(findSimilar('Cleste patent 180mm', inv).map((x) => x.id), ['a']);
  assert.deepEqual(findSimilar('bormasina bosch', inv).map((x) => x.id), ['c']);
});

test('„ai deja”: aceeași unealtă, altă marcă', () => {
  const inv = [{ id: 'a', name: 'Bormasina Bosch GSB', status: 'lent' }, { id: 'b', name: 'Surubelnita PH2', status: 'avail' }];
  assert.deepEqual(findSimilar('bormasina makita', inv).map((x) => x.id), ['a']);
  assert.deepEqual(findSimilar('fierastrau pendular', inv), []);
});
