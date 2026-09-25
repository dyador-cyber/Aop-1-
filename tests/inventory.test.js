import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncFromExpense, undoExpense, similarity, findSimilar, addMonths, nextLabel, splitUnits, lendTool, returnTool } from '../js/inventory.js';

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
    { id: 'i2', name: 'BORMASINA BOSCH GSB', qty: 2, unitPrice: 50, amount: 100, sub: 'tools' },
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
  // fiecare bucată e separată, cu eticheta ei (două bormașini = B1 și B2)
  assert.deepEqual(out.added.map((x) => [x.name, x.qty, x.price, x.warrantyUntil, x.status, x.label]), [
    ['HOGERT CLESTE PINI', 1, 129, '2028-09-23', 'avail', 'H1'],
    ['BORMASINA BOSCH GSB', 1, 50, '2028-09-23', 'avail', 'B1'],
    ['BORMASINA BOSCH GSB', 1, 50, '2028-09-23', 'avail', 'B2'],
  ]);
  // resalvarea bonului nu dublează
  const inv = apply([], out);
  const again = syncFromExpense(purchase, inv, { uid });
  assert.equal(again.added.length, 0);
  assert.equal(apply(inv, again).length, 3);
  // cantitatea micșorată pe bon: bucata în plus dispare
  const less = syncFromExpense({ ...purchase, items: purchase.items.map((i) => (i.id === 'i2' ? { ...i, qty: 1, amount: 50 } : i)) }, inv, { uid });
  assert.deepEqual(apply(inv, less).map((x) => x.label).sort(), ['B1', 'H1']);
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

test('retur parțial: o bucată returnată, cealaltă rămâne; retur fără cumpărare înregistrată e raportat', () => {
  let inv = apply([], syncFromExpense(purchase, [], { uid }));
  const out = syncFromExpense({ id: 'r2', date: '2026-09-24', store: 'Hornbach', isReturn: true,
    items: [{ id: 'k1', name: 'BORMASINA BOSCH GSB', qty: -1, amount: -50, sub: 'tools' }, { id: 'k2', name: 'FIERASTRAU PENDULAR', qty: -1, amount: -300, sub: 'tools' }] }, inv, { uid });
  inv = apply(inv, out);
  const b = inv.filter((x) => x.itemId === 'i2');
  assert.deepEqual(b.map((x) => x.status).sort(), ['avail', 'returned']);
  assert.deepEqual(out.unmatched, ['FIERASTRAU PENDULAR']);
});

test('produs scos de pe bon dispare din inventar, dar nu dacă l-ai editat', () => {
  let inv = apply([], syncFromExpense(purchase, [], { uid }));
  inv = inv.map((x) => (x.itemId === 'i2' ? { ...x, edited: true, location: 'Garaj' } : x));
  const out = syncFromExpense({ ...purchase, items: [] }, inv, { uid });
  inv = apply(inv, out);
  assert.deepEqual(inv.map((x) => x.itemId), ['i2', 'i2']);
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

test('retur cu nume citit foarte diferit: prețul identic și bonul original decid', () => {
  let inv = apply([], syncFromExpense({ id: 'p9', date: '2026-09-23', store: 'Hornbach', items: [
    { id: 'a', name: 'JGERT CLEŞTEPINI', qty: 1, unitPrice: 129, amount: 129, sub: 'tools' },
    { id: 'b', name: 'PROIECTOR 30W', qty: 2, unitPrice: 94.9, amount: 189.8, sub: 'tools' }] }, [], { uid }));
  const out = syncFromExpense({ id: 'r9', date: '2026-09-23', store: 'Hornbach', isReturn: true, returnOf: 'p9',
    items: [{ id: 'k', name: 'HGERT CLESTE PINI', qty: 1, unitPrice: 129, amount: -129, sub: 'tools' }] }, inv, { uid });
  assert.deepEqual(out.returned.map((x) => x.itemId), ['a']);
  assert.deepEqual(out.unmatched, []);
});

test('etichete: litera după tipul sculei, numărul următor liber', () => {
  const inv = [{ label: 'B1' }, { label: 'B3' }, { label: 'P1' }];
  assert.equal(nextLabel('Bormașină Makita', inv), 'B4');
  assert.equal(nextLabel('Polizor unghiular 125', inv), 'P2');
  assert.equal(nextLabel('Proiector LED 50W', inv), 'L1');
  assert.equal(nextLabel('Șurubelniță electrică', inv), 'S1');
  assert.equal(nextLabel('Hogert clește', inv), 'H1');
});

test('scule vechi cu „Bucăți: 3” devin 3 bucăți separate', () => {
  const inv = [{ id: 'a', name: 'Bormasina Bosch', qty: 3, status: 'avail', returns: [] }, { id: 'b', name: 'Polizor', qty: 1, label: 'P1', status: 'avail' }];
  const puts = splitUnits(inv, uid);
  assert.deepEqual(puts.map((x) => [x.qty, x.label, x.unit]), [[1, 'B1', 0], [1, 'B2', 1], [1, 'B3', 2]]);
  assert.equal(puts[0].id, 'a');
});

test('retur de 2 bucăți: două bormașini marcate returnate, a treia rămâne', () => {
  const buy = { id: 'p9', date: '2026-09-01', store: 'Dedeman', items: [{ id: 'k', name: 'BORMASINA BOSCH GSB', qty: 3, unitPrice: 300, amount: 900, sub: 'tools' }] };
  let inv = apply([], syncFromExpense(buy, [], { uid }));
  const ret = { id: 'r9', date: '2026-09-05', store: 'Dedeman', isReturn: true, returnOf: 'p9', items: [{ id: 'q', name: 'BORMASINA BOSCH GSB', qty: -2, unitPrice: 300, amount: -600, sub: 'tools' }] };
  inv = apply(inv, syncFromExpense(ret, inv, { uid }));
  assert.equal(inv.filter((x) => x.status === 'returned').length, 2);
  assert.equal(inv.filter((x) => x.status === 'avail').length, 1);
  inv = apply(inv, undoExpense(ret, inv));
  assert.equal(inv.filter((x) => x.status === 'avail').length, 3, 'returul șters le readuce');
});

test('împrumut: cui, când și în ce stare s-a întors', () => {
  let x = { id: 't', name: 'Bormasina', label: 'B2', status: 'avail', loans: [] };
  x = lendTool(x, 'Ion', '2026-09-01');
  assert.deepEqual([x.status, x.lentTo, x.loans.length], ['lent', 'Ion', 1]);
  x = returnTool(x, '2026-09-10', 'broken', 'nu mai pornește');
  assert.deepEqual([x.status, x.lentTo], ['broken', '']);
  assert.deepEqual(x.loans[0], { to: 'Ion', from: '2026-09-01', back: '2026-09-10', state: 'broken', note: 'nu mai pornește' });
  x = returnTool(lendTool({ ...x, status: 'avail' }, 'Vasile', '2026-09-12'), '2026-09-13', 'ok');
  assert.deepEqual([x.status, x.loans.length, x.loans[1].to], ['avail', 2, 'Vasile']);
});
