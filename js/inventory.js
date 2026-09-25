// Inventarul sculelor (și al altor produse alese): se completează din bonuri,
// iar retururile scot automat scula din inventar. Funcții pure, fără acces la baza de date.
import { normalize, stem } from './parsers.js';

export const INV_STATUSES = [
  { key: 'avail', name: 'Disponibilă', cls: 'ok' },
  { key: 'lent', name: 'Împrumutată', cls: 'warn' },
  { key: 'repair', name: 'În reparație', cls: 'warn' },
  { key: 'broken', name: 'Defectă', cls: 'bad' },
  { key: 'lost', name: 'Pierdută', cls: 'bad' },
  { key: 'returned', name: 'Returnată la magazin', cls: '' },
  { key: 'gone', name: 'Vândută / dată', cls: '' },
];
export const INV_STATUS_KEYS = new Set(INV_STATUSES.map((s) => s.key));
// Scule pe care le ai efectiv (inclusiv împrumutate sau în reparație)
export const OWNED = new Set(['avail', 'lent', 'repair', 'broken']);
export const statusByKey = (k) => INV_STATUSES.find((s) => s.key === k) || INV_STATUSES[0];

export const WARRANTY_MONTHS = 24; // garanția legală în România

const nameStems = (s) => new Set(normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && /[a-z]/.test(w)).map(stem));

// Cât de asemănătoare sunt două denumiri (0..1). Tolerant la litere greșite de OCR
// („HGERT CLESTE PINI” ≈ „HOGERT CLEȘTE PINI”): contează cuvintele comune.
export function similarity(a, b) {
  const A = nameStems(a);
  const B = nameStems(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) {
    if (B.has(w) || [...B].some((x) => (x.length >= 5 && w.length >= 5) && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5))))) inter++;
  }
  return inter / Math.min(A.size, B.size);
}

export function addMonths(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1 + n, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Sculele din inventar care seamănă cu o denumire (pentru avertismentul „ai deja”).
// Mai larg decât la retururi: „bormașină Makita” te avertizează că ai deja „Bormașină Bosch”.
export function findSimilar(name, inventory, { excludeIds = [] } = {}) {
  return inventory
    .filter((x) => OWNED.has(x.status) && !excludeIds.includes(x.id))
    .map((x) => ({ x, s: similarity(name, x.name) }))
    .filter((r) => r.s >= 0.5)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.x);
}

// Eticheta scurtă scrisă pe sculă (B1, B2 pentru bormașini, P1 pentru polizor…),
// ca să știi exact care dintre două scule la fel s-a întors stricată.
const LABEL_PREFIX = [
  ['B', ['bormasin', 'masina de gaurit', 'rotopercutor']],
  ['F', ['flex']],
  ['P', ['polizor']],
  ['S', ['surubelnit', 'autofiletant', 'masina de insurubat']],
  ['L', ['proiector', 'reflector', 'lampa', 'lanterna']],
  ['C', ['circular']],
  ['T', ['pendular']],
  ['D', ['drujba', 'motofierastrau']],
  ['G', ['generator']],
  ['K', ['compresor']],
  ['U', ['sudura', 'invertor']],
  ['SL', ['slefuit', 'slefuitor']],
  ['A', ['aspirator']],
  ['N', ['nivela', 'telemetru']],
];
export function labelPrefix(name) {
  const n = ' ' + normalize(name).replace(/[^a-z0-9 ]+/g, ' ') + ' ';
  for (const [p, words] of LABEL_PREFIX) if (words.some((w) => n.includes(' ' + w))) return p;
  const w = normalize(name).match(/[a-z]{3,}/);
  return w ? w[0][0].toUpperCase() : 'X';
}
export function nextLabel(name, inventory) {
  const p = labelPrefix(name);
  const re = new RegExp(`^${p}(\\d+)$`);
  const max = inventory.reduce((m, x) => { const r = re.exec(x.label || ''); return r ? Math.max(m, +r[1]) : m; }, 0);
  return p + (max + 1);
}

// Sculele vechi ținute cu „Bucăți: 2” devin bucăți separate, fiecare cu eticheta ei.
export function splitUnits(inventory, uid) {
  const puts = [];
  const all = inventory.map((x) => ({ ...x }));
  for (const x of all) {
    const n = Math.max(1, Math.round(x.qty || 1));
    const changed = n > 1 || !x.label;
    if (!changed) continue;
    const first = { ...x, qty: 1, unit: x.unit ?? 0, label: x.label || nextLabel(x.name, [...all, ...puts]) };
    Object.assign(x, first);
    puts.push(first);
    for (let k = 1; k < n; k++) {
      const copy = { ...first, id: uid(), unit: (first.unit || 0) + k, returns: [], loans: [], label: '' };
      copy.label = nextLabel(copy.name, [...all, ...puts]);
      puts.push(copy);
    }
  }
  return puts;
}

// Ce trebuie schimbat în inventar după salvarea unui bon.
// Fiecare bucată cumpărată e o intrare separată (2 bormașini = B1 și B2).
// Returnează { puts: [intrări de salvat], dels: [id-uri de șters], added: [], returned: [], unmatched: [] }.
export function syncFromExpense(e, inventory, { subs = ['tools'], uid, now = Date.now() } = {}) {
  const out = { puts: [], dels: [], added: [], returned: [], unmatched: [] };
  const wantedSub = (i) => subs.includes(i.sub);
  if (e.isReturn) return applyReturn(e, inventory, { subs, out });

  const wanted = (e.items || []).filter((i) => wantedSub(i) && i.amount > 0);
  const linked = inventory.filter((x) => x.expenseId === e.id && x.itemId);
  for (const i of wanted) {
    const qty = Math.min(50, Math.max(1, Math.round(i.qty > 0 ? i.qty : 1)));
    const price = i.unitPrice > 0 ? i.unitPrice : +(i.amount / qty).toFixed(2);
    const units = linked.filter((x) => x.itemId === i.id);
    for (let k = 0; k < qty; k++) {
      const ex = units.find((x) => (x.unit ?? 0) === k);
      if (!ex) {
        const entry = {
          id: uid(), name: i.name, qty: 1, unit: k, label: nextLabel(i.name, [...inventory, ...out.puts]), serial: '', price, purchaseDate: e.date,
          store: e.store || '', expenseId: e.id, itemId: i.id, sub: i.sub, location: '', status: 'avail', lentTo: '', lentDate: '', loans: [],
          warrantyUntil: addMonths(e.date, WARRANTY_MONTHS), notes: '', auto: true, edited: false, returns: [], createdAt: now,
        };
        out.puts.push(entry);
        out.added.push(entry);
      } else if (!ex.edited) {
        out.puts.push({ ...ex, name: i.name, price, purchaseDate: e.date, store: e.store || '', sub: i.sub, warrantyUntil: addMonths(e.date, WARRANTY_MONTHS) });
      }
    }
    // cantitate micșorată pe bon: bucățile în plus, neatinse, dispar
    for (const x of units) if ((x.unit ?? 0) >= qty && !x.edited && !(x.returns || []).length && x.status === 'avail') out.dels.push(x.id);
  }
  // produse scoase de pe bon sau mutate în altă subcategorie
  for (const x of linked) {
    if (!wanted.some((i) => i.id === x.itemId) && !x.edited && !(x.returns || []).length) out.dels.push(x.id);
  }
  return out;
}

// Un bon de retur: găsește bucățile cumpărate și le marchează „Returnată”.
function applyReturn(e, inventory, { subs, out }) {
  const done = new Set(inventory.flatMap((x) => (x.returns || []).map((r) => `${r.expenseId}:${r.itemId}`)));
  const inv = inventory.map((x) => ({ ...x, returns: [...(x.returns || [])] }));
  const changed = new Map();
  const storeN = normalize(e.store);
  for (const i of (e.items || []).filter((it) => subs.includes(it.sub))) {
    if (done.has(`${e.id}:${i.id}`)) continue;
    let n = Math.max(1, Math.round(Math.abs(i.qty || 1)));
    // prețul returnat pe bucată: dovadă puternică, alături de legătura cu bonul original
    const unit = Math.abs(i.unitPrice || (i.amount / (Math.abs(i.qty || 1) || 1)));
    const cands = inv
      .filter((x) => OWNED.has(x.status) && x.qty > 0)
      .map((x) => ({ x, s: similarity(x.name, i.name), samePrice: x.price > 0 && Math.abs(x.price - unit) < 0.011 }))
      .filter((c) => c.s >= 0.6 || (c.samePrice && (c.s >= 0.3 || (e.returnOf && c.x.expenseId === e.returnOf))))
      .map((c) => ({ ...c, score: c.s + (e.returnOf && c.x.expenseId === e.returnOf ? 2 : 0) + (storeN && normalize(c.x.store) === storeN ? 1 : 0) + (c.x.status === 'avail' ? 0.5 : 0) }))
      .sort((a, b) => b.score - a.score || (b.x.purchaseDate || '').localeCompare(a.x.purchaseDate || '') || (b.x.unit ?? 0) - (a.x.unit ?? 0));
    if (!cands.length) { out.unmatched.push(i.name); continue; }
    for (const { x } of cands) {
      if (n <= 0) break;
      const take = Math.min(n, x.qty || 1); // o intrare veche cu mai multe bucăți
      x.returns.push({ expenseId: e.id, itemId: i.id, qty: take });
      if ((x.qty || 1) > take) x.qty -= take; else x.status = 'returned';
      n -= take;
      changed.set(x.id, x);
      out.returned.push(x);
    }
    if (n > 0) out.unmatched.push(i.name);
  }
  out.puts.push(...changed.values());
  return out;
}

// Împrumut: cui și când; la întoarcere, în ce stare a venit scula.
export const RETURN_STATES = [
  { key: 'ok', name: 'În regulă', status: 'avail' },
  { key: 'broken', name: 'Stricată', status: 'broken' },
  { key: 'repair', name: 'De dus la reparat', status: 'repair' },
  { key: 'missing', name: 'Lipsesc accesorii', status: 'avail' },
];
export function lendTool(x, to, date) {
  return { ...x, status: 'lent', lentTo: to, lentDate: date, loans: [...(x.loans || []), { to, from: date, back: '', state: '', note: '' }] };
}
export function returnTool(x, date, state = 'ok', note = '') {
  const loans = (x.loans || []).map((l) => ({ ...l }));
  const open = [...loans].reverse().find((l) => !l.back);
  if (open) Object.assign(open, { back: date, state, note });
  else loans.push({ to: x.lentTo || '?', from: x.lentDate || date, back: date, state, note });
  const st = RETURN_STATES.find((r) => r.key === state) || RETURN_STATES[0];
  return { ...x, status: st.status, lentTo: '', lentDate: '', loans };
}

// La ștergerea unui bon: sculele adăugate automat dispar, iar un retur șters le readuce.
export function undoExpense(e, inventory) {
  const out = { puts: [], dels: [] };
  for (const x of inventory) {
    if (x.expenseId === e.id && !x.edited && !(x.returns || []).length) { out.dels.push(x.id); continue; }
    const mine = (x.returns || []).filter((r) => r.expenseId === e.id);
    if (!mine.length) continue;
    const n = mine.reduce((a, r) => a + (r.qty || 1), 0);
    const restored = { ...x, returns: x.returns.filter((r) => r.expenseId !== e.id) };
    if (x.status === 'returned') { restored.status = 'avail'; restored.qty = Math.max(x.qty, n); } else restored.qty = x.qty + n;
    out.puts.push(restored);
  }
  return out;
}
