// Proiecte (case, atelier, fiecare vehicul), perioade și totaluri.
// Doar calcule, fără interfață, ca să poată fi testate.

export const PROJECT_KINDS = [
  { key: 'house', name: 'Casă', icon: '🏠' },
  { key: 'workshop', name: 'Atelier', icon: '🔧' },
  { key: 'vehicle', name: 'Vehicul', icon: '🚗' },
  { key: 'other', name: 'Altul', icon: '📁' },
];
export const PROJECT_ICONS = ['🏠', '🏡', '🏘️', '🏗️', '🔧', '🛠️', '🚗', '🚙', '🏍️', '🚜', '🚐', '🌳', '👶', '🐾', '💼', '📁', '🎓', '🏖️'];
export const PROJECT_COLORS = ['#2e7d32', '#1565c0', '#6d4c41', '#ef6c00', '#6a1b9a', '#00838f', '#c62828', '#455a64'];
export const kindOf = (k) => PROJECT_KINDS.find((x) => x.key === k) || PROJECT_KINDS[PROJECT_KINDS.length - 1];

// Proiectele propuse la prima pornire (numele stabilite împreună).
export const SUGGESTED_PROJECTS = [
  { name: 'Casa București', kind: 'house', icon: '🏠' },
  { name: 'Casa Varlam', kind: 'house', icon: '🏡' },
  { name: 'Atelier', kind: 'workshop', icon: '🔧' },
];

export const PERIODS = [
  { key: 'today', name: 'Azi' },
  { key: 'week', name: 'Săptămâna' },
  { key: 'month', name: 'Luna' },
  { key: 'year', name: 'Anul' },
  { key: 'all', name: 'Total' },
  { key: 'custom', name: 'Interval' },
];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const ro = (s) => (s ? s.split('-').reverse().join('.') : '');

// Intervalul de date pentru perioada aleasă: { from, to, label } (from/to goale = fără limită).
export function periodRange(period = {}, today = new Date()) {
  const t = iso(today);
  switch (period.key) {
    case 'today': return { from: t, to: t, label: 'azi' };
    case 'week': {
      const d = new Date(today);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // luni
      return { from: iso(d), to: t, label: 'săptămâna aceasta' };
    }
    case 'year': return { from: `${today.getFullYear()}-01-01`, to: t, label: `anul ${today.getFullYear()}` };
    case 'all': return { from: '', to: '', label: 'toată perioada' };
    case 'custom': {
      const from = /^\d{4}-\d{2}-\d{2}$/.test(period.from || '') ? period.from : '';
      const to = /^\d{4}-\d{2}-\d{2}$/.test(period.to || '') ? period.to : '';
      return { from, to, label: from || to ? `${ro(from) || '…'} – ${ro(to) || '…'}` : 'toată perioada' };
    }
    default: return { from: t.slice(0, 8) + '01', to: t, label: MONTHS[today.getMonth()] + ' ' + today.getFullYear() };
  }
}
export const inRange = (date, r) => (!r.from || date >= r.from) && (!r.to || date <= r.to);

// Cât din bon revine fiecărui proiect. Produsele mutate pe alt proiect („Împarte bonul”)
// trec acolo; restul bonului rămâne la proiectul bonului ('' = fără proiect).
export function expenseShares(e) {
  const out = new Map();
  const base = e.projectId || '';
  let moved = 0;
  for (const i of e.items || []) {
    if (!i.projectId || i.projectId === base || !(+i.amount)) continue;
    out.set(i.projectId, (out.get(i.projectId) || 0) + +i.amount);
    moved += +i.amount;
  }
  const rest = (+e.total || 0) - moved;
  if (Math.abs(rest) > 0.004 || !out.size) out.set(base, (out.get(base) || 0) + rest);
  return out;
}

// Totalul pe perioadă și pe proiecte.
export function projectTotals(expenses, range) {
  const byProject = {};
  let total = 0;
  for (const e of expenses) {
    if (!inRange(e.date || '', range)) continue;
    total += +e.total || 0;
    for (const [pid, amount] of expenseShares(e)) byProject[pid] = (byProject[pid] || 0) + amount;
  }
  return { total: +total.toFixed(2), byProject };
}

// Bonurile care ating un proiect, cu suma care îi revine.
export function projectExpenses(expenses, projectId, range) {
  const out = [];
  for (const e of expenses) {
    if (!inRange(e.date || '', range)) continue;
    const share = expenseShares(e).get(projectId || '');
    if (share !== undefined) out.push({ e, share: +share.toFixed(2) });
  }
  return out.sort((a, b) => (b.e.date || '').localeCompare(a.e.date || ''));
}

// Categoriile ca arbore: categorie → subcategorii (un singur nivel sub categorie).
export function categoryTree(categories) {
  const parents = categories.filter((c) => !c.parentId || !categories.some((p) => p.id === c.parentId));
  return parents.map((p) => ({ ...p, children: categories.filter((c) => c.parentId === p.id) }));
}

// Defalcare pe categorii (și subcategorii) pentru o listă { e, share }.
export function categoryBreakdown(rows, categories) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const top = new Map();
  for (const { e, share } of rows) {
    const c = byId.get(e.categoryId);
    const parent = c?.parentId && byId.has(c.parentId) ? byId.get(c.parentId) : c;
    const key = parent?.id || '';
    if (!top.has(key)) top.set(key, { cat: parent || null, total: 0, count: 0, children: new Map() });
    const node = top.get(key);
    node.total += share;
    node.count++;
    if (c && c !== parent) {
      if (!node.children.has(c.id)) node.children.set(c.id, { cat: c, total: 0, count: 0 });
      const ch = node.children.get(c.id);
      ch.total += share;
      ch.count++;
    }
  }
  return [...top.values()].map((n) => ({ ...n, total: +n.total.toFixed(2), children: [...n.children.values()].map((x) => ({ ...x, total: +x.total.toFixed(2) })).sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.total - a.total);
}

// ---------- migrare la versiunea cu proiecte ----------
// Categoriile implicite își pierd prefixul „Casă –” / „Mașină –” (proiectul spune deja al cui e bonul).
const RENAMES = {
  food: ['Alimente & cumpărături', 'Mâncare & cumpărături', '🛒'],
  house_materials: ['Casă – materiale construcții', 'Construcție – materiale', '🧱'],
  house_labor: ['Casă – manoperă', 'Construcție – manoperă', '👷'],
  house_utilities: ['Casă – utilități & mobilier', 'Mobilier & dotări', '🛋️'],
  fuel: ['Mașină – combustibil', 'Combustibil', '⛽'],
  car_service: ['Mașină – service & piese', 'Service & piese', '🔧'],
  car_fees: ['Mașină – asigurări & taxe', 'Asigurări & taxe', '📄'],
  health: ['Sănătate', 'Medicamente & sănătate', '💊'],
  other: ['Altele', 'Altele', '📦'],
};
export const NEW_CATEGORIES = [
  { key: 'utilities', name: 'Utilități', icon: '💡', color: '#f9a825' },
  { key: 'electrical', name: 'Electrice', icon: '🔌', color: '#fbc02d' },
  { key: 'kids', name: 'Copii', icon: '🧸', color: '#ec407a' },
  { key: 'kids_clothes', name: 'Haine', icon: '👕', color: '#f06292', parentKey: 'kids' },
  { key: 'kids_toys', name: 'Jucării', icon: '🧸', color: '#ba68c8', parentKey: 'kids' },
  { key: 'kids_school', name: 'Rechizite', icon: '✏️', color: '#7986cb', parentKey: 'kids' },
  { key: 'kids_meds', name: 'Medicamente', icon: '💊', color: '#e57373', parentKey: 'kids' },
];

// Ce trebuie schimbat la trecerea pe proiecte. Nu șterge nimic; întoarce doar obiectele de salvat.
export function planMigration({ categories, projects, vehicles, expenses }, uid) {
  const cats = [];
  const projs = [];
  const exps = [];
  let order = Math.max(0, ...categories.map((c) => c.order ?? 0)) + 1;
  for (const c of categories) {
    const r = RENAMES[c.key];
    if (!r) continue;
    const next = { ...c, icon: c.icon || r[2] };
    if (c.name === r[0]) next.name = r[1];
    if (next.name !== c.name || next.icon !== c.icon) cats.push(next);
  }
  const byKey = new Map(categories.map((c) => [c.key, c]));
  for (const n of NEW_CATEGORIES) {
    if (byKey.has(n.key)) continue;
    const parent = n.parentKey ? byKey.get(n.parentKey) : null;
    const c = { id: uid(), key: n.key, name: n.name, icon: n.icon, color: n.color, order: order++, parentId: parent?.id || '' };
    byKey.set(n.key, c);
    cats.push(c);
  }
  for (const p of projects) {
    if (p.kind) continue;
    const kind = /\b(cas|constr|renov|apart|vila)/i.test(p.name) ? 'house' : /atelier|garaj/i.test(p.name) ? 'workshop' : 'other';
    projs.push({ ...p, kind, icon: p.icon || kindOf(kind).icon });
  }
  const vehProject = new Map(projects.filter((p) => p.vehicleId).map((p) => [p.vehicleId, p.id]));
  for (const v of vehicles) {
    if (vehProject.has(v.id)) continue;
    const p = { id: uid(), name: v.name || v.plate || 'Mașina', kind: 'vehicle', icon: '🚗', vehicleId: v.id, notes: '' };
    vehProject.set(v.id, p.id);
    projs.push(p);
  }
  for (const e of expenses) {
    if (!e.projectId && e.vehicleId && vehProject.has(e.vehicleId)) exps.push({ ...e, projectId: vehProject.get(e.vehicleId) });
  }
  return { categories: cats, projects: projs, expenses: exps };
}
