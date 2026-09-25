import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRegistration, cleanVin, validVin, parseTyreSticker, parseVpic, standardReminders, nextTyreSeason, renewTyre, parseTimeline } from '../js/vehicle.js';

test('talon: câmpurile europene, fără datele proprietarului', () => {
  const text = `A B 123 ABC
B 12.05.2015
C.1.1 POPESCU ION
C.1.3 STR. EXEMPLU NR 1 BUCURESTI
D.1 DACIA
D.3 LOGAN
E UU1LSDAAH12345678
J M1
P.1 1461
P.2 66
P.3 MOTORINA`;
  const r = parseRegistration(text);
  assert.deepEqual(r, { plate: 'B 123 ABC', firstReg: '2015-05-12', make: 'DACIA', model: 'LOGAN', vin: 'UU1LSDAAH12345678', engineCc: 1461, powerKw: 66, fuelType: 'motorină', category: 'M1' });
  assert.ok(!JSON.stringify(r).includes('POPESCU'), 'numele proprietarului nu e citit');
});

test('CIV cu etichete și VIN citit cu O în loc de 0', () => {
  const r = parseRegistration(`Marca: VOLKSWAGEN\nDenumire comerciala: GOLF\nNr. de identificare: WVWZZZ1KZ8W1O7O05\nCilindree: 1968 cm3\nPutere: 103 kW\nCombustibil: Motorina\nCJ 07 XYZ`);
  assert.equal(r.make, 'VOLKSWAGEN');
  assert.equal(r.model, 'GOLF');
  assert.equal(r.vin, 'WVWZZZ1KZ8W107005');
  assert.deepEqual([r.engineCc, r.powerKw, r.fuelType, r.plate], [1968, 103, 'motorină', 'CJ 07 XYZ']);
});

test('VIN: 17 caractere, fără I/O/Q', () => {
  assert.equal(validVin('UU1LSDAAH12345678'), true);
  assert.equal(validVin('UU1LSDAAH1234567O'), false);
  assert.equal(cleanVin('uu1 lsdaah 1234567o'), 'UU1LSDAAH12345670');
  assert.equal(cleanVin('PREA SCURT'), '');
});

test('eticheta anvelopelor: mărime și presiuni în bar / kPa / psi', () => {
  assert.deepEqual(parseTyreSticker('205/55 R16 91V  2.2 bar 2.1 bar'), { tyreSize: '205/55 R16', pressureFront: 2.2, pressureRear: 2.1 });
  assert.deepEqual(parseTyreSticker('195/65R15 230 kPa 220 kPa'), { tyreSize: '195/65 R15', pressureFront: 2.3, pressureRear: 2.2 });
  assert.deepEqual(parseTyreSticker('32 psi 30 psi'), { pressureFront: 2.2, pressureRear: 2.1 });
});

test('decodare VIN (răspuns NHTSA)', () => {
  assert.deepEqual(parseVpic({ Results: [{ Make: 'TESLA', Model: 'Model 3', ModelYear: '2021', DisplacementCC: '', FuelTypePrimary: 'Electric' }] }), { make: 'TESLA', model: 'Model 3', year: 2021, fuelType: 'electric' });
  assert.equal(parseVpic({ Results: [{}] }), null);
  assert.equal(parseVpic('<html>'), null);
});

test('expirări standard după tipul vehiculului; revizie la km și dată', () => {
  let n = 0; const uid = () => 'r' + (++n);
  const today = new Date(2026, 8, 25);
  const car = standardReminders({ id: 'v', type: 'car' }, [{ vehicleId: 'v', type: 'RCA' }], { today, lastKm: 120000, uid });
  assert.deepEqual(car.map((r) => r.type), ['ITP', 'Rovinietă', 'Extinctor', 'Trusă prim ajutor', 'Revizie', 'Anvelope']);
  const rev = car.find((r) => r.type === 'Revizie');
  assert.deepEqual([rev.dueKm, rev.dueDate], [135000, '2027-09-25']);
  assert.deepEqual(car.find((r) => r.type === 'Anvelope').title, 'Anvelope de iarnă');
  const tractor = standardReminders({ id: 't', type: 'machine' }, [], { today, lastKm: 1200, uid });
  assert.deepEqual(tractor.map((r) => r.type), ['RCA', 'Extinctor', 'Revizie']);
  assert.equal(tractor.find((r) => r.type === 'Revizie').dueKm, 1450);
  assert.deepEqual(standardReminders({ id: 'm', type: 'moto' }, [], { today, uid }).map((r) => r.type), ['RCA', 'ITP', 'Revizie']);
});

test('anvelope: sezonul următor și reînnoirea alternează iarnă / vară', () => {
  assert.deepEqual(nextTyreSeason(new Date(2026, 1, 10)), { dueDate: '2026-04-01', title: 'Anvelope de vară' });
  assert.deepEqual(nextTyreSeason(new Date(2026, 11, 10)), { dueDate: '2027-04-01', title: 'Anvelope de vară' });
  assert.deepEqual(renewTyre({ dueDate: '2026-11-01', title: 'Anvelope de iarnă' }), { dueDate: '2027-04-01', title: 'Anvelope de vară' });
  assert.deepEqual(renewTyre({ dueDate: '2027-04-01', title: 'Anvelope de vară' }), { dueDate: '2027-11-01', title: 'Anvelope de iarnă' });
});

test('Google Timeline: doar km cu mașina pe zi (ambele formate)', () => {
  const takeout = { timelineObjects: [
    { activitySegment: { duration: { startTimestamp: '2026-09-01T08:00:00Z' }, distance: 12500, activityType: 'IN_PASSENGER_VEHICLE' } },
    { activitySegment: { duration: { startTimestamp: '2026-09-01T18:00:00Z' }, distance: 12000, activityType: 'IN_PASSENGER_VEHICLE' } },
    { activitySegment: { duration: { startTimestamp: '2026-09-01T12:00:00Z' }, distance: 900, activityType: 'WALKING' } },
    { placeVisit: { location: { address: 'Strada Secretă 1' } } },
  ] };
  assert.deepEqual(parseTimeline(takeout), { '2026-09-01': 24.5 });
  const phone = { semanticSegments: [
    { startTime: '2026-09-02T09:00:00.000+03:00', endTime: '2026-09-02T10:00:00.000+03:00', activity: { distanceMeters: 30400, topCandidate: { type: 'IN_PASSENGER_VEHICLE' } } },
    { startTime: '2026-09-02T11:00:00.000+03:00', timelinePath: [{ point: '44.4°, 26.1°' }] },
  ] };
  assert.deepEqual(parseTimeline(phone), { '2026-09-02': 30.4 });
  assert.deepEqual(parseTimeline([{ startTime: '2026-09-03T09:00:00+03:00', endTime: 'x', activity: { distanceMeters: '5000', topCandidate: { type: 'in passenger vehicle' } } }]), { '2026-09-03': 5 });
});

test('revizie la km: notificare cu 500 km înainte, o singură dată', async () => {
  await import('../js/reminder-core.js');
  const RC = globalThis.ReminderCore;
  const r = { id: 'r', type: 'Revizie', title: 'Revizie', dueDate: '2027-09-25', dueKm: 135000, vehicleId: 'v', notifyDays: [30], notified: [] };
  const today = new Date(2026, 8, 25);
  assert.deepEqual(RC.dueNotifications([r], today, { v: 134000 }), []);
  const n = RC.dueNotifications([r], today, { v: 134600 });
  assert.equal(n[0].key, '135000km');
  assert.match(n[0].body, /mai sunt 400/);
  assert.deepEqual(RC.dueNotifications([{ ...r, notified: ['135000km'] }], today, { v: 134600 }), []);
  assert.equal(RC.dueNotifications([r], today).length, 0, 'fără km: doar data contează');
});

test('vehicul, alimentare electrică și drumuri curățate', async () => {
  const { sanitize, sanitizeTrips } = await import('../js/sanitize.js');
  const v = sanitize('vehicles', { id: 'v', name: 'Tesla', type: 'rachetă', batteryKwh: 60, pressureFront: 2.9, docs: [{ kind: 'tyre', image: 'x' }] });
  assert.deepEqual([v.type, v.batteryKwh, v.pressureFront, v.docs.length], ['car', 60, 2.9, 0]);
  const e = sanitize('expenses', { id: 'e', date: '2026-09-25', total: 30, fuel: { kwh: 40, pricePerKwh: 0.75, place: 'acasa', trip: 'București – Brașov' } });
  assert.deepEqual([e.fuel.kwh, e.fuel.pricePerKwh, e.fuel.place, e.fuel.trip], [40, 0.75, '', 'București – Brașov']);
  assert.deepEqual(sanitizeTrips({ v: { '2026-09-01': 24.5, 'x': 3, '2026-09-02': 'abc' }, '<a>': {} }), { v: { '2026-09-01': 24.5 } });
});

test('VIN cu un caracter în plus citit de OCR și categoria „Ml”', () => {
  const r = parseRegistration('E UU1ILSDAAH52345678\nJ Ml');
  assert.equal(r.vin, 'UU1LSDAAH52345678');
  assert.equal(r.category, 'M1');
});
