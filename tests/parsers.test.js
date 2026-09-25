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

test('„RETUR MARFĂ ÎN 90 ZILE” din subsol nu înseamnă retur', () => {
  const r = parseReceipt('HORNBACH CENTRALA SRL\nTOTAL: RON 1696,12\nRETUR MARFA\nIN 90 ZILE GARANTIE PRET', new Date(2026, 8, 24));
  assert.equal(r.isReturn, false);
  assert.equal(r.total, 1696.12);
});

test('magazin ilizibil: nume cu litere greșite, CUI cunoscut, regulă învățată', async () => {
  const { findBrand, brandFromCif } = await import('../js/parsers.js');
  assert.equal(parseReceipt('BON NEFISCAL\n/ ORBACH CENTRALA SRL\nSECTOR 2').store, 'Hornbach');
  assert.equal(parseReceipt('H0RNBACH CENTRALA SRL').store, 'Hornbach');
  assert.equal(parseReceipt('zz ilizibil SRL\nCUI: ROV7777320').store, 'Hornbach');
  assert.equal(parseReceipt('zz ilizibil SRL\nCUL: RO1777 7320').store, 'Hornbach');
  assert.equal(parseReceipt('DEDEMA SRL\nx').store, 'Dedeman');
  assert.equal(parseReceipt('ANTET ILIZIBIL SRL\nCUI RO1234567', new Date(), { storeRules: { RO1234567: 'Ferma Popescu' } }).store, 'Ferma Popescu');
  assert.equal(parseReceipt('MEGA TEST SRL\nCUI RO1234567').store, 'Mega Test');
  // fără potriviri false
  assert.equal(findBrand('CORBACI LTD'), '');
  assert.equal(findBrand('PROFIL ALUMINIU'), '');
  assert.equal(brandFromCif('TOTAL 1696,12 CASA 24 ACCUM 0036007'), '');
});

test('CUI pe un rând, data pe rândul următor: nu se lipesc', () => {
  assert.equal(parseReceipt('ANTET ILIZIBIL\nCUI: RO1234567\n24.09.2026 11:00\nTOTAL 89,00', new Date(2026, 8, 24), { storeRules: { RO1234567: 'Ferma Popescu' } }).store, 'Ferma Popescu');
});

test('retur recunoscut și din citiri proaste; bonurile normale nu devin retur', () => {
  const today = new Date(2026, 8, 24);
  // „RETUR” citit greșit, fără minus la total, dar cu „-1 BUC” și semnătura delegatului
  const bad = 'ilizibil SRL\n*** RATUR ***\n-1 BUC. X 129,00\nCLESTE PINI 129,00 A\nTOTAL [1] RON 129,00\nNUME SI SEMNATURA ANGAJAT/DELEGAT';
  let r = parseReceipt(bad, today);
  assert.equal(r.isReturn, true);
  assert.equal(r.total, -129);
  // „MOTIV: RETUR” citit „MOTIV: RETOR”
  assert.equal(parseReceipt('X SRL\nMOTIV: RETOR\nTOTAL 50,00', today).isReturn, true);
  // bon normal cu „RETUR MARFĂ ÎN 90 ZILE” și o reducere negativă: nu e retur
  r = parseReceipt('HORNBACH SRL\n1 BUC x 20,00 LEI\nPRODUS 20,00 A\nREDUCERE -2,00\nTOTAL 18,00\nRETUR MARFA\nIN 90 ZILE', today);
  assert.equal(r.isReturn, false);
  assert.equal(r.total, 18);
  // rețea electrică / „reteta” nu declanșează
  assert.equal(parseReceipt('X SRL\nCABLU RETEA 20,00\nRETETA 10,00\nTOTAL 30,00', today).isReturn, false);
});

test('firmă și CUI: rânduri tehnice ignorate, DATE FIRMA, formă juridică, cifra de control', async () => {
  const { validCui, repairCui, shortCompanyName } = await import('../js/parsers.js');
  for (const c of ['RO29226198', '17777320', '2816464', '15991149', '22891860']) assert.ok(validCui(c), c);
  assert.equal(validCui('RO29226197'), false);
  assert.equal(repairCui('29226198'), '29226198');
  assert.equal(shortCompanyName('HORNBACH CENTRALA SRL'), 'Hornbach Centrala');
  assert.equal(shortCompanyName('S.C. ALFA-BETA IMPEX S.R.L.'), 'Alfa-Beta');
  const today = new Date(2026, 8, 25);
  let r = parseReceipt('* RELUARE PRINTARE *\nLISSE MARKET SRL\nMUN.BUCURESTI SECTOR 2\nCIF: RO29226198\nDATE FIRMA : LISSE MARKET SRL\nTOTAL LEI 53.90', today);
  assert.equal(r.store, 'Lisse Market');
  assert.equal(r.storeOfficial, 'LISSE MARKET SRL');
  assert.equal(r.cif, 'RO29226198');
  assert.equal(r.cifValid, true);
  // text OCR real al bonului Lisse (poză culcată, rotită automat)
  r = parseReceipt('AN\n4 come PRINTARE + d\nFE LISSE MARKET SRL\noN MUN. BUCURESTI SECTOR 2\n4 CIF: RO29226198 Lo\nNN DATE FIRMA : LISSE MARKET SRL UL\nCARD 53.90 Bf\n2:2002 BF :0092', today);
  assert.equal(r.store, 'Lisse Market');
  assert.equal(r.storeOfficial, 'LISSE MARKET SRL');
  // fără DATE FIRMA: primul rând cu formă juridică, nu „RELUARE PRINTARE”
  r = parseReceipt('* REIMPRIMARE *\nBON FISCAL\nALFA DISTRIBUTIE S.R.L.\nCUI 1234565', today);
  assert.equal(r.store, 'Alfa Distributie');
  assert.equal(r.cifValid, true);
});

test('retur: total citit cu o cifră greșită, corectat după sumele care se repetă (text inventat)', () => {
  const r = parseReceipt(`MAGAZIN TEST SRL\n*** RETUR ***\n1 BUC. X 129,00\nCLESTE PATENT -129,00 A\nTOTAL RON -128,00\nCARD RON -129,00`, new Date(2026, 8, 24));
  assert.equal(r.isReturn, true);
  assert.equal(r.total, -129);
});
