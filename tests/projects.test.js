import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, expenseShares, projectTotals, projectExpenses, categoryBreakdown, categoryTree, planMigration } from '../js/projects.js';
import { sanitize } from '../js/sanitize.js';

const today = new Date(2026, 8, 25); // joi, 25.09.2026

test('perioade: azi, săptămâna (de luni), luna, anul, total, interval', () => {
  assert.deepEqual(periodRange({ key: 'today' }, today), { from: '2026-09-25', to: '2026-09-25', label: 'azi' });
  assert.equal(periodRange({ key: 'week' }, today).from, '2026-09-21');
  assert.equal(periodRange({ key: 'week' }, new Date(2026, 8, 27)).from, '2026-09-21'); // duminică
  assert.equal(periodRange({ key: 'month' }, today).from, '2026-09-01');
  assert.equal(periodRange({ key: 'year' }, today).from, '2026-01-01');
  assert.deepEqual(periodRange({ key: 'all' }, today), { from: '', to: '', label: 'toată perioada' });
  const c = periodRange({ key: 'custom', from: '2026-03-01', to: '2026-03-31' }, today);
  assert.equal(c.label, '01.03.2026 – 31.03.2026');
  assert.equal(periodRange({ key: 'custom', from: '<x>' }, today).from, '');
});

test('bon împărțit pe proiecte: produsele mutate trec la celălalt proiect', () => {
  const e = { total: 100, projectId: 'buc', date: '2026-09-10', items: [
    { amount: 30, projectId: 'varlam' }, { amount: 50 }, { amount: 20, projectId: 'buc' }] };
  assert.deepEqual([...expenseShares(e)], [['varlam', 30], ['buc', 70]]);
  assert.deepEqual([...expenseShares({ total: 10, items: [] })], [['', 10]]);
  // tot bonul mutat: proiectul bonului nu mai primește nimic
  assert.deepEqual([...expenseShares({ total: 10, projectId: 'a', items: [{ amount: 10, projectId: 'b' }] })], [['b', 10]]);
  const list = [e, { total: 5, date: '2026-09-11' }, { total: 1000, projectId: 'buc', date: '2025-01-01' }];
  const r = projectTotals(list, periodRange({ key: 'month' }, today));
  assert.equal(r.total, 105);
  assert.deepEqual(r.byProject, { varlam: 30, buc: 70, '': 5 });
  assert.deepEqual(projectExpenses(list, 'varlam', { from: '', to: '' }).map((x) => x.share), [30]);
});

test('categorii cu subcategorii: Copii → Haine / Jucării', () => {
  const cats = [{ id: 'k', name: 'Copii' }, { id: 'h', name: 'Haine', parentId: 'k' }, { id: 'j', name: 'Jucării', parentId: 'k' }, { id: 'f', name: 'Mâncare' }];
  assert.deepEqual(categoryTree(cats).map((c) => [c.name, c.children.map((x) => x.name)]), [['Copii', ['Haine', 'Jucării']], ['Mâncare', []]]);
  const rows = [{ e: { categoryId: 'h' }, share: 50 }, { e: { categoryId: 'j' }, share: 20 }, { e: { categoryId: 'k' }, share: 5 }, { e: { categoryId: 'f' }, share: 40 }, { e: {}, share: 1 }];
  const b = categoryBreakdown(rows, cats);
  assert.deepEqual(b.map((n) => [n.cat?.name || '-', n.total]), [['Copii', 75], ['Mâncare', 40], ['-', 1]]);
  assert.deepEqual(b[0].children.map((c) => [c.cat.name, c.total]), [['Haine', 50], ['Jucării', 20]]);
});

test('migrare: categorii redenumite doar dacă au numele implicit, categorii noi, proiect pentru fiecare mașină', () => {
  let n = 0;
  const uid = () => 'n' + (++n);
  const data = {
    categories: [
      { id: 'c1', key: 'food', name: 'Alimente & cumpărături' },
      { id: 'c2', key: 'house_materials', name: 'Materialele mele' }, // redenumită de utilizator: rămâne
      { id: 'c3', key: 'fuel', name: 'Mașină – combustibil', isFuel: true },
    ],
    projects: [{ id: 'p1', name: 'Construcție casă' }],
    vehicles: [{ id: 'v1', name: 'Dacia', plate: 'B 01 ABC' }],
    expenses: [{ id: 'e1', vehicleId: 'v1', total: 100 }, { id: 'e2', vehicleId: 'v1', projectId: 'p1' }, { id: 'e3' }],
  };
  const m = planMigration(data, uid);
  const byId = Object.fromEntries(m.categories.map((c) => [c.id, c]));
  assert.equal(byId.c1.name, 'Mâncare & cumpărături');
  assert.equal(byId.c2.name, 'Materialele mele');
  assert.equal(byId.c3.name, 'Combustibil');
  const kids = m.categories.find((c) => c.key === 'kids');
  assert.deepEqual(m.categories.filter((c) => c.parentId === kids.id).map((c) => c.name), ['Haine', 'Jucării', 'Rechizite', 'Medicamente']);
  assert.equal(m.projects.find((p) => p.id === 'p1').kind, 'house');
  const vp = m.projects.find((p) => p.vehicleId === 'v1');
  assert.equal(vp.kind, 'vehicle');
  assert.deepEqual(m.expenses.map((e) => [e.id, e.projectId]), [['e1', vp.id]]);
  // a doua rulare nu mai schimbă nimic
  const again = planMigration({ categories: [...data.categories.map((c) => byId[c.id] || c), ...m.categories.filter((c) => !data.categories.some((x) => x.id === c.id))],
    projects: [...m.projects], vehicles: data.vehicles, expenses: data.expenses.map((e) => m.expenses.find((x) => x.id === e.id) || e) }, uid);
  assert.deepEqual([again.categories.length, again.projects.length, again.expenses.length], [0, 0, 0]);
});

test('proiecte și categorii curățate: iconiță doar emoji, tip cunoscut', () => {
  const p = sanitize('projects', { id: 'p', name: 'Casa', icon: '<img src=x>', kind: 'palat', color: 'red' });
  assert.deepEqual([p.icon, p.kind, p.color], ['', '', '']);
  assert.equal(sanitize('projects', { id: 'p', name: 'Casa', icon: '🏡' }).icon, '🏡');
  assert.equal(sanitize('categories', { id: 'c', name: 'X', parentId: 'c' }).parentId, '');
  const e = sanitize('expenses', { id: 'e', date: '2026-09-25', total: 1, items: [{ id: 'i', name: 'a', amount: 1, projectId: 'p<1>' }] });
  assert.equal(e.items[0].projectId, '');
});
