// Situația produselor: cât ai cumpărat, când, cu cât; consumabilele potrivite cu sculele;
// cămara (produse cu ⭐ și cât a mai rămas). Doar calcule, fără interfață.
import { normalize } from './parsers.js';

const words = (s) => normalize(s).replace(/[^a-z0-9.,x ]+/g, ' ').split(/\s+/).filter(Boolean);

// Mărimile care fac dintr-un produs altă variantă: M5 ≠ M6, disc 125 ≠ 230, 3x1,5 ≠ 3x2,5, 1L ≠ 2L
export function sizeTokens(name) {
  const n = ' ' + normalize(name).replace(/(\d),(\d)/g, '$1.$2') + ' ';
  const out = new Set();
  for (const m of n.matchAll(/(?<![a-z0-9])m(\d{1,2})(?![0-9])/g)) out.add('m' + m[1]);
  for (const m of n.matchAll(/(?<![0-9.])(\d+(?:\.\d+)?)\s?x\s?(\d+(?:\.\d+)?)(?:\s?x\s?(\d+(?:\.\d+)?))?/g)) out.add([m[1], m[2], m[3]].filter(Boolean).join('x'));
  for (const m of n.matchAll(/(?<![0-9.x])(\d+(?:\.\d+)?)\s?(mm|cm|kg|g|l|ml|w|v|ah|mah|m)(?![a-z0-9])/g)) out.add(m[1] + m[2]);
  for (const m of n.matchAll(/(?<![a-z0-9])(sds(?:\s?(?:plus|max))?|ph\d|pz\d|t\d{2})(?![0-9])/g)) out.add(m[1].replace(/\s/g, ''));
  // diametru de disc / polizor scris fără „mm” („DISC 125”, „POLIZOR 230”)
  if (/\b(disc|polizor|flex)/.test(n)) for (const m of n.matchAll(/\b(1[0-9]{2}|2[0-9]{2}|3[0-5][0-9])\b(?!\s?(?:mm|x))/g)) out.add(m[1] + 'mm');
  return [...out].sort();
}

// Cheia unui produs: primele cuvinte + mărimile („surub autofiletant m5”, „disc taiere 125mm”)
export function productKey(name) {
  const w = words(name).filter((x) => /^[a-z]{3,}$/.test(x)).slice(0, 3);
  return [...w, ...sizeTokens(name)].join(' ').slice(0, 60);
}

const unitPriceOf = (i) => (i.unitPrice > 0 ? i.unitPrice : i.qty ? Math.abs(i.amount / i.qty) : Math.abs(i.amount));

// Situația pentru o căutare („unt”, „surub m6”, „disc 125”): o carte pe fiecare variantă.
export function productSituation(query, expenses) {
  const q = words(query).filter((w) => w.length >= 2);
  const qSizes = sizeTokens(query);
  if (!q.length) return [];
  const groups = new Map();
  for (const e of expenses) {
    for (const i of e.items || []) {
      const nw = words(i.name);
      const hit = q.every((t) => nw.some((w) => w.startsWith(t) || (t.length >= 4 && w.startsWith(t.slice(0, 4)))) || sizeTokens(i.name).includes(t));
      if (!hit) continue;
      if (qSizes.length && !qSizes.every((sz) => sizeTokens(i.name).includes(sz))) continue;
      const key = productKey(i.name);
      if (!groups.has(key)) groups.set(key, { key, names: new Map(), sizes: sizeTokens(i.name), qty: 0, total: 0, count: 0, prices: [], last: null, first: null, byProject: {} });
      const g = groups.get(key);
      g.names.set(i.name, (g.names.get(i.name) || 0) + 1);
      const qty = i.qty != null ? i.qty : Math.sign(i.amount || 1);
      g.qty += qty;
      g.total += +i.amount || 0;
      if (i.amount > 0) { g.count++; g.prices.push(unitPriceOf(i)); }
      const pid = i.projectId || e.projectId || '';
      g.byProject[pid] = (g.byProject[pid] || 0) + (+i.amount || 0);
      if (i.amount > 0 && (!g.last || e.date > g.last.date)) g.last = { date: e.date, store: e.store, unitPrice: unitPriceOf(i), qty, expenseId: e.id };
      if (!g.first || e.date < g.first) g.first = e.date;
    }
  }
  return [...groups.values()].map((g) => ({
    key: g.key,
    name: [...g.names].sort((a, b) => b[1] - a[1])[0][0],
    sizes: g.sizes,
    qty: +g.qty.toFixed(3),
    total: +g.total.toFixed(2),
    purchases: g.count,
    avgPrice: g.qty > 0 ? +(g.total / g.qty).toFixed(2) : null,
    minPrice: g.prices.length ? Math.min(...g.prices) : null,
    maxPrice: g.prices.length ? Math.max(...g.prices) : null,
    last: g.last, first: g.first, byProject: g.byProject,
  })).sort((a, b) => (b.last?.date || '').localeCompare(a.last?.date || '') || b.total - a.total);
}

// ---------- consumabile ↔ scule ----------
const TOOL_KINDS = [
  ['angle', ['polizor', 'flex']],
  ['drill', ['bormasin', 'rotopercutor', 'masina de gaurit']],
  ['driver', ['surubelnit', 'autofiletant', 'insurubat']],
  ['jigsaw', ['pendular']],
  ['circular', ['circular']],
  ['welder', ['sudura', 'invertor']],
  ['chainsaw', ['drujba', 'motofierastrau']],
  ['trimmer', ['motocoasa', 'trimmer']],
  ['sander', ['slefuit', 'slefuitor', 'orbital']],
];
const CONS_KINDS = [
  ['angle', ['disc']],
  ['drill', ['burghiu', 'burghie', 'carota']],
  ['driver', ['bit', 'biti']],
  ['welder', ['electrod', 'sarma sudura']],
  ['chainsaw', ['lant']],
  ['trimmer', ['fir motocoasa', 'fir']],
  ['sander', ['hartie abraziva', 'smirghel', 'disc slefuire']],
];
const has = (n, w) => (' ' + n + ' ').includes(' ' + w);
export function toolKind(name) {
  const n = normalize(name).replace(/[^a-z0-9 ]+/g, ' ');
  return TOOL_KINDS.find(([, ws]) => ws.some((w) => has(n, w)))?.[0] || '';
}
export function consumableKind(name) {
  const n = normalize(name).replace(/[^a-z0-9 ]+/g, ' ');
  // pânza: pentru pendular sau circular, după ce scrie pe ea
  if (has(n, 'panz')) return has(n, 'circular') ? 'circular' : 'jigsaw';
  return CONS_KINDS.find(([, ws]) => ws.some((w) => has(n, w)))?.[0] || '';
}
const diameter = (name) => sizeTokens(name).find((t) => /^\d{3}mm$/.test(t)) || '';

// Se potrivește consumabilul cu scula? Același tip, iar dacă amândouă au diametru, același diametru.
export function fits(consumableName, toolName) {
  const k = consumableKind(consumableName);
  if (!k || k !== toolKind(toolName)) return false;
  const a = diameter(consumableName); const b = diameter(toolName);
  return !a || !b || a === b;
}

// ---------- cămara ----------
// Pentru produsele cu ⭐: câte ai cumpărat de la ultima „s-a terminat”, minus câte ai folosit (−1).
export function pantryStock(entry, expenses) {
  let bought = 0;
  let lastDate = '';
  for (const e of expenses) {
    if ((e.date || '') < (entry.resetAt || '')) continue;
    for (const i of e.items || []) {
      if (productKey(i.name) !== entry.key) continue;
      bought += i.qty != null ? i.qty : 1;
      if (e.date > lastDate) lastDate = e.date;
    }
  }
  return { bought: +bought.toFixed(3), left: +Math.max(0, bought - (entry.used || 0)).toFixed(3), lastDate };
}
