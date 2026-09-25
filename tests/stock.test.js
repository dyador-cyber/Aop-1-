import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeTokens, productKey, productSituation, fits, toolKind, consumableKind, pantryStock } from '../js/stock.js';
import { sanitize } from '../js/sanitize.js';

const exp = (id, date, store, items, projectId = '') => ({ id, date, store, projectId, items });
const data = [
  exp('a', '2026-08-01', 'Dedeman', [{ name: 'SURUB AUTOFILETANT M5X40', qty: 100, unitPrice: 0.2, amount: 20 }, { name: 'SURUB AUTOFILETANT M6X40', qty: 50, unitPrice: 0.3, amount: 15 }], 'buc'),
  exp('b', '2026-09-10', 'Hornbach', [{ name: 'SURUB AUTOFILETANT M5X40', qty: 200, unitPrice: 0.18, amount: 36 }], 'var'),
  exp('c', '2026-09-12', 'Kaufland', [{ name: 'UNT PRESIDENT 200G', qty: 2, unitPrice: 12.99, amount: 25.98 }]),
  exp('d', '2026-09-20', 'Lidl', [{ name: 'UNT PRESIDENT 200G', qty: 1, unitPrice: 11.49, amount: 11.49 }]),
];

test('mărimi: M5 ≠ M6, disc 125, cablu 3x2,5', () => {
  assert.deepEqual(sizeTokens('SURUB AUTOFILETANT M5X40'), ['5x40', 'm5']);
  assert.deepEqual(sizeTokens('DISC TAIERE METAL 125 BOSCH'), ['125mm']);
  assert.deepEqual(sizeTokens('CABLU MYYM 3X2,5 MM'), ['3x2.5']);
  assert.notEqual(productKey('SURUB AUTOFILETANT M5X40'), productKey('SURUB AUTOFILETANT M6X40'));
});

test('situația unui produs: variante separate, cantitate, ultima cumpărare, preț mediu', () => {
  const s = productSituation('surub', data);
  assert.equal(s.length, 2);
  const m5 = s.find((g) => g.sizes.includes('m5'));
  assert.deepEqual([m5.qty, m5.purchases, m5.total, m5.minPrice, m5.maxPrice], [300, 2, 56, 0.18, 0.2]);
  assert.equal(m5.avgPrice, 0.19);
  assert.deepEqual([m5.last.date, m5.last.store], ['2026-09-10', 'Hornbach']);
  assert.deepEqual(m5.byProject, { buc: 20, var: 36 });
  assert.equal(productSituation('surub m6', data).length, 1, 'mărimea din căutare alege varianta');
  const unt = productSituation('unt', data)[0];
  assert.deepEqual([unt.qty, unt.purchases, unt.last.store], [3, 2, 'Lidl']);
});

test('consumabile potrivite: disc 125 → polizor 125, nu polizor 230; pânză → pendular', () => {
  assert.equal(toolKind('Polizor unghiular Bosch 125'), 'angle');
  assert.equal(consumableKind('DISC TAIERE METAL 125'), 'angle');
  assert.equal(fits('DISC TAIERE METAL 125', 'Polizor unghiular Bosch 125mm'), true);
  assert.equal(fits('DISC TAIERE METAL 125', 'Polizor unghiular 230'), false);
  assert.equal(fits('DISC TAIERE METAL 125', 'Polizor Makita'), true, 'fără diametru la sculă: se potrivește tipul');
  assert.equal(fits('PANZA LEMN T101B', 'Fierastrau pendular Bosch'), true);
  assert.equal(fits('SET BURGHIE BETON SDS', 'Rotopercutor Bosch'), true);
  assert.equal(fits('SET BURGHIE BETON', 'Polizor'), false);
});

test('cămara: cumpărat de la ultima „s-a terminat”, minus folosit', () => {
  const key = productKey('UNT PRESIDENT 200G');
  assert.deepEqual(pantryStock({ key, used: 1, resetAt: '' }, data), { bought: 3, left: 2, lastDate: '2026-09-20' });
  assert.deepEqual(pantryStock({ key, used: 0, resetAt: '2026-09-15' }, data).left, 1);
  assert.equal(pantryStock({ key, used: 5, resetAt: '' }, data).left, 0);
});

test('scule curățate: etichetă, serie, istoric împrumuturi', () => {
  const x = sanitize('inventory', { id: 'x', name: 'Bormasina', label: 'B1<script>', serial: 'SN 123', loans: [{ to: 'Ion', from: '2026-09-01', state: 'hack' }, 'x'] });
  assert.equal(x.label, '');
  assert.equal(x.serial, 'SN 123');
  assert.deepEqual(x.loans, [{ to: 'Ion', from: '2026-09-01', back: '', state: '', note: '' }]);
  assert.equal(sanitize('inventory', { id: 'x', name: 'B', label: 'SL12' }).label, 'SL12');
});

test('cămara curățată', async () => {
  const { sanitizePantry } = await import('../js/sanitize.js');
  assert.deepEqual(sanitizePantry({ 'unt president 200g': { name: 'Unt', used: 2, resetAt: '2026-09-01' }, '<x>': { name: 'x' }, 'lapte': { used: -1 } }),
    { 'unt president 200g': { key: 'unt president 200g', name: 'Unt', used: 2, resetAt: '2026-09-01' }, lapte: { key: 'lapte', name: 'lapte', used: 0, resetAt: '' } });
});
