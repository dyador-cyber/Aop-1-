import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseAmount, parseReceipt, parseOdometer, parseQuery, runQuery, stem } from '../js/parsers.js';

const sandbox = {};
vm.runInNewContext(readFileSync(new URL('../js/reminder-core.js', import.meta.url), 'utf8'), { self: sandbox });
const RC = sandbox.ReminderCore;

test('parseAmount', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1234.56'), 1234.56);
  assert.equal(parseAmount('123,45'), 123.45);
  assert.equal(parseAmount('1 234,56'), 1234.56);
});

test('bon benzinărie', () => {
  const text = `OMV PETROM MARKETING SRL
C.I.F.: RO 11201891
STATIA 1234 BUCURESTI
MOTORINA EFIX
42,50 L x 7,29 LEI/L
                    309,83 B
TOTAL             309,83
CARD              309,83
TOTAL TVA          49,47
12.09.2026 18:21`;
  const r = parseReceipt(text);
  assert.equal(r.total, 309.83);
  assert.equal(r.date, '2026-09-12');
  assert.equal(r.cif, 'RO11201891');
  assert.equal(r.suggestedCategoryKey, 'fuel');
  assert.equal(r.fuel.liters, 42.5);
  assert.equal(r.fuel.pricePerLiter, 7.29);
  assert.equal(r.fuel.fuelType, 'motorină');
});

test('bon materiale construcții', () => {
  const text = `DEDEMAN SRL
CIF 2816464
CIMENT 40KG 10 x 32,50   325,00
ADEZIV GRESIE            89,90
SUBTOTAL                414,90
TOTAL LEI              1.414,90
DATA: 03/08/2026`;
  const r = parseReceipt(text);
  assert.equal(r.total, 1414.9);
  assert.equal(r.date, '2026-08-03');
  assert.equal(r.suggestedCategoryKey, 'house_materials');
  assert.equal(r.fuel, null);
  assert.equal(r.store, 'Dedeman');
});

test('kilometraj', () => {
  assert.equal(parseOdometer('ODO 123456 km\n12:30'), 123456);
  assert.equal(parseOdometer('87 654'), 87654);
  assert.equal(parseOdometer('nimic'), null);
});

test('stem', () => {
  assert.equal(stem('casa'), stem('casei'));
  assert.equal(stem('Mașina'), stem('mașinii'));
  assert.notEqual(stem('casa'), stem('casco'));
});

const today = new Date(2026, 8, 24);
const cats = [
  { id: 'c1', name: 'Casă – materiale construcții' },
  { id: 'c2', name: 'Mașină – combustibil', isFuel: true, isCar: true },
  { id: 'c3', name: 'Alimente & cumpărături' },
  { id: 'c4', name: 'Mașină – asigurări & taxe', isCar: true },
];
const ctx = {
  categories: cats,
  projects: [{ id: 'p1', name: 'Construcție casă' }],
  vehicles: [{ id: 'v1', name: 'Dacia Logan', plate: 'B 12 ABC' }],
  odometer: [{ id: 'o1', vehicleId: 'v1', date: '2026-09-01', km: 100000 }, { id: 'o2', vehicleId: 'v1', date: '2026-09-20', km: 100800 }],
  expenses: [
    { id: 1, date: '2026-09-02', total: 1000, categoryId: 'c1', projectId: 'p1', store: 'Dedeman' },
    { id: 2, date: '2025-05-02', total: 500, categoryId: 'c1', projectId: '', store: 'Hornbach' },
    { id: 3, date: '2026-09-10', total: 300, categoryId: 'c2', vehicleId: 'v1', store: 'OMV', fuel: { liters: 40 } },
    { id: 4, date: '2026-08-10', total: 250, categoryId: 'c2', vehicleId: 'v1', store: 'Petrom', fuel: { liters: 35 } },
    { id: 5, date: '2026-09-11', total: 200, categoryId: 'c3', store: 'Lidl' },
    { id: 6, date: '2026-09-12', total: 1200, categoryId: 'c4', vehicleId: 'v1', store: 'CASCO Allianz' },
  ],
};

test('cât m-a costat casa', () => {
  const r = runQuery('Cât m-a costat să construiesc casa?', ctx, today);
  assert.equal(r.total, 1500);
  assert.equal(r.expenses.length, 2);
  assert.equal(r.label, 'toată perioada');
});

test('benzină luna asta', () => {
  const r = runQuery('cât am dat pe benzină luna asta', ctx, today);
  assert.equal(r.total, 300);
  assert.equal(r.liters, 40);
  assert.equal(r.kmInfo.driven, 800);
  assert.equal(r.kmInfo.consumption, 5);
});

test('mașina anul acesta include asigurări și combustibil', () => {
  const r = runQuery('cheltuieli mașină anul acesta', ctx, today);
  assert.equal(r.total, 1750);
});

test('magazin + lună', () => {
  assert.equal(runQuery('Dedeman septembrie', ctx, today).total, 1000);
  assert.equal(runQuery('dacia', ctx, today).total, 1750);
});

test('termen necunoscut', () => {
  const r = runQuery('vacanta', ctx, today);
  assert.equal(r.noMatch, true);
  assert.equal(r.total, 0);
});

test('perioade', () => {
  assert.equal(parseQuery('luna trecuta', today).range.from, '2026-08-01');
  assert.equal(parseQuery('luna trecuta', today).range.to, '2026-08-31');
  assert.equal(parseQuery('in 2025', today).range.from, '2025-01-01');
  assert.equal(parseQuery('noiembrie', today).range.from, '2025-11-01');
});

test('notificări expirări', () => {
  const rems = [
    { id: 'a', type: 'RCA', dueDate: '2026-09-30', notifyDays: [30, 7, 1], notified: [] },
    { id: 'b', type: 'ITP', dueDate: '2026-12-30', notifyDays: [30, 7, 1], notified: [] },
    { id: 'c', type: 'Rovinietă', dueDate: '2026-09-20', notified: [] },
    { id: 'd', type: 'RCA', dueDate: '2026-09-30', notifyDays: [30, 7, 1], notified: ['2026-09-30:7'] },
  ];
  const due = RC.dueNotifications(rems, today);
  assert.deepEqual([...due.map((d) => d.key)], ['2026-09-30:7', '2026-09-20:expirat']);
  assert.match(due[0].body, /6 zile/);
});

// Text OCR real (bon Hornbach fotografiat în mașină, cu umbre), fără liniile cu date de card.
test('bon real Hornbach (OCR cu zgomot)', () => {
  const text = `BON NEF TSCAL
"Ny a
HORNBACH CENTRALA SRL
SOSLAUA ANDRONACHE , 24b “297
S{CINDR 2 BUCURE ST I
MUNICIPIUL BUCUREŞTI
cul: RO177 77320
M 23/9/2026 12:38 x 0121
i 9 tt ++
23.09. 20 12:38:40 i
VISA CONTACTLESS
ALE
TAL: RON 1696,12
--- PIN OK ---
E 73.09.2026 12:34 0024 242424 oon
BON NEF ISCA`;
  const r = parseReceipt(text);
  assert.equal(r.store, 'Hornbach');
  assert.equal(r.date, '2026-09-23');
  assert.equal(r.total, 1696.12);
  assert.equal(r.cif, 'RO17777320');
  assert.equal(r.suggestedCategoryKey, 'house_materials');
});

test('total cu spațiu după virgulă și fără a confunda data cu suma', () => {
  const r = parseReceipt('MAGAZIN X SRL\n23.09.2026 12:38:40\nTAL: RON 1636, 12');
  assert.equal(r.total, 1636.12);
  assert.equal(parseReceipt('MAGAZIN X SRL\n23.09.2026 12.38').total, null);
});

test('data: ignoră cifre greșite de OCR și date din viitor', () => {
  const today = new Date(2026, 8, 24);
  assert.equal(parseReceipt('X SRL\nWI 23/09/2026 12:38\n= 23.09.2020 12:38:40', today).date, '2026-09-23');
  assert.equal(parseReceipt('X SRL\n23.09.2026\n23.09.2020\n23.09.2020', today).date, '2020-09-23');
  assert.equal(parseReceipt('X SRL\n23.09.2029 12:00\n23.09.2026', today).date, '2026-09-23');
});

test('bon lung din mai multe poze: magazin sus, total jos', () => {
  const part1 = 'BON NEFISCAL\nHORNBACH CENTRALA SRL\nCUI: RO17777320\n23/9/2026 12:38\nCIMENT 40KG';
  const part2 = 'ADEZIV 89,90\nTAL: RON 1696,12\n23.09.2026 12:34';
  const r = parseReceipt(part1 + '\n--- continuare bon ---\n' + part2, new Date(2026, 8, 24));
  assert.equal(r.store, 'Hornbach');
  assert.equal(r.total, 1696.12);
  assert.equal(r.date, '2026-09-23');
});

const HORNBACH_RETUR = `A Ca 1
Bl HORNBACU CENTRAT |
y SERI ADA AnorARA ALA SRL
/ SECTUR 2 . BUCURES x FO
MUNICIPIUL BUCUREŞTI
CUL: RO17777320
i 23/9/2026 15:3i xo
x RETUR tt SR
E iun 5902801327056
1 BUC. X 129,00
GER) CLESTE PINT 129,00 A
TIV: RETUR
ITAL [1] RON -128,00
MN RON -129,00
i BRUT TVA NET
x 129,00 -22,33  -106,61
420 73.09.2026 15:23 0008 001004 000938
BON NEFISCAL
INCL. re DEEE. RETUR MARFA E
FL do ZILE GARANTIE PRET J`;

test('bon real de retur Hornbach (OCR cu erori)', () => {
  const r = parseReceipt(HORNBACH_RETUR, new Date(2026, 8, 24));
  assert.equal(r.store, 'Hornbach');
  assert.equal(r.isReturn, true);
  assert.equal(r.total, -129, 'cifra greșită 128 corectată după frecvență, semn negativ');
  assert.equal(r.date, '2026-09-23');
  assert.equal(r.cif, 'RO17777320');
  assert.equal(r.suggestedCategoryKey, 'house_materials');
});

test('„RETUR MARFĂ ÎN 90 ZILE” din subsol nu înseamnă retur', () => {
  const r = parseReceipt('HORNBACH CENTRALA SRL\nTOTAL: RON 1696,12\nRETUR MARFA\nIN 90 ZILE GARANTIE PRET', new Date(2026, 8, 24));
  assert.equal(r.isReturn, false);
  assert.equal(r.total, 1696.12);
});
