// Funcții pure: interpretarea textului OCR de pe bonuri / kilometraj
// și interpretarea întrebărilor de tipul „cât m-a costat casa?”.

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ș|ş/g, 's')
    .replace(/ț|ţ/g, 't');
}

// „1.234,56” / „1234.56” / „123,45” / „1 234,56” -> număr
export function parseAmount(str) {
  if (str == null) return NaN;
  let s = String(str).trim().replace(/\s/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastComma !== -1) {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

const AMOUNT_RE = /(\d{1,3}(?:[ .]\d{3})+|\d+)[,.](\d{2})(?!\d)/g;

function amountsIn(line) {
  const out = [];
  for (const m of line.matchAll(AMOUNT_RE)) out.push(parseAmount(m[0]));
  return out.filter((n) => Number.isFinite(n));
}

const FUEL_WORDS = /\b(motorina|benzina|diesel|gpl|efix|maxx?motion|ultimate|euro ?diesel|euro ?super|premium ?95|standard ?95|carburant)\b/;

const STORE_HINTS = [
  { key: 'fuel', words: ['omv', 'petrom', 'rompetrol', 'mol ', 'lukoil', 'socar', 'gazprom', 'benzinaria'] },
  { key: 'house_materials', words: ['dedeman', 'leroy', 'hornbach', 'brico', 'arabesque', 'materiale de constructii', 'praktiker', 'mathaus', 'ciment', 'adeziv', 'bca', 'caramida'] },
  { key: 'car_service', words: ['autonet', 'auto total', 'norauto', 'vulcanizare', 'service auto', 'piese auto', 'ulei motor', 'anvelope'] },
  { key: 'health', words: ['farmacia', 'catena', 'help net', 'helpnet', 'dona', 'sensiblu', 'dr.max', 'dr max'] },
  { key: 'food', words: ['kaufland', 'lidl', 'mega image', 'carrefour', 'auchan', 'profi', 'penny', 'cora', 'selgros', 'metro', 'la doi pasi', 'annabella'] },
];

export function parseReceipt(text) {
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const norm = normalize(raw);
  const result = { store: '', date: '', total: null, cif: '', fuel: null, suggestedCategoryKey: null };

  // Magazin: prima linie cu litere suficiente
  const storeLine = lines.find((l) => (l.match(/[A-Za-zĂÂÎȘȚăâîșț]/g) || []).length >= 3);
  if (storeLine) result.store = storeLine.replace(/\s{2,}/g, ' ').slice(0, 60);

  // CIF
  const cif = raw.match(/C\.?\s*I\.?\s*F\.?\s*[:.]?\s*(RO\s*)?(\d{4,10})/i);
  if (cif) result.cif = (cif[1] ? 'RO' : '') + cif[2];

  // Data
  const d1 = raw.match(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/);
  const d2 = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (d1 && +d1[2] >= 1 && +d1[2] <= 12 && +d1[1] >= 1 && +d1[1] <= 31) {
    result.date = `${d1[3]}-${d1[2]}-${d1[1]}`;
  } else if (d2) {
    result.date = `${d2[1]}-${d2[2]}-${d2[3]}`;
  }

  // Total: linia cu „TOTAL” (nu SUBTOTAL / TOTAL TVA)
  let total = null;
  for (let i = 0; i < lines.length; i++) {
    const n = normalize(lines[i]);
    if (!/\btotal\b/.test(n) || /subtotal|total\s*tva|tva\s*total|total\s*taxe/.test(n)) continue;
    let nums = amountsIn(lines[i]);
    if (!nums.length && lines[i + 1]) nums = amountsIn(lines[i + 1]);
    if (nums.length) { total = nums[nums.length - 1]; break; }
  }
  if (total == null) {
    const all = lines.flatMap(amountsIn);
    if (all.length) total = Math.max(...all);
  }
  result.total = total;

  // Combustibil
  if (FUEL_WORDS.test(norm) || /\blitri\b/.test(norm)) {
    const fuel = { liters: null, pricePerLiter: null, fuelType: '' };
    if (/motorina|diesel/.test(norm)) fuel.fuelType = 'motorină';
    else if (/gpl/.test(norm)) fuel.fuelType = 'GPL';
    else if (/benzina|95|98|super/.test(norm)) fuel.fuelType = 'benzină';

    const qx = raw.match(/(\d+[.,]\d{1,3})\s*(?:L|l|LT|lt|LITRI|litri)?\s*[xX*]\s*(\d+[.,]\d{2,3})/);
    if (qx) {
      fuel.liters = parseAmount(qx[1]);
      fuel.pricePerLiter = parseAmount(qx[2]);
    } else {
      const lm = raw.match(/(\d+[.,]\d{1,3})\s*(?:L|LT|LITRI|litri)\b/);
      if (lm) fuel.liters = parseAmount(lm[1]);
    }
    if (fuel.liters && !fuel.pricePerLiter && total) fuel.pricePerLiter = +(total / fuel.liters).toFixed(2);
    result.fuel = fuel;
    result.suggestedCategoryKey = 'fuel';
  }

  if (!result.suggestedCategoryKey) {
    for (const h of STORE_HINTS) {
      if (h.words.some((w) => norm.includes(w))) { result.suggestedCategoryKey = h.key; break; }
    }
  }
  return result;
}

// Text OCR de pe bord -> kilometraj (cel mai lung număr de 3–7 cifre)
export function parseOdometer(text) {
  const nums = (String(text || '').replace(/[ .,'](?=\d{3}\b)/g, '').match(/\d{3,7}/g) || [])
    .map((s) => ({ s, n: parseInt(s, 10) }));
  if (!nums.length) return null;
  nums.sort((a, b) => b.s.length - a.s.length || b.n - a.n);
  return nums[0].n;
}

// ---------- Întrebări ----------

const SUFFIXES = ['urilor', 'ului', 'elor', 'ilor', 'iile', 'esc', 'ele', 'ile', 'uri', 'ul', 'ei', 'ii', 'le', 'a', 'e', 'i', 'u'];

export function stem(word) {
  const w = normalize(word).replace(/[^a-z0-9]/g, '');
  for (const s of SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, -s.length);
  }
  return w;
}

function stemsMatch(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(short);
}

const STOPWORDS = new Set(('cat cata cati cate cit m ma mi a am ai au costat costa costul costuri cheltuit cheltuieli ' +
  'dat platit pe in la de din pentru cu si sau total totalul ce care sa se ca un o al ale lui le ' +
  'toate tot toti arata spune vreau ma-a m-a construiesc construit fac facut cumparat bani lei ron suma').split(' '));

const FUEL_TERMS = new Set(['benzina', 'benzin', 'motorina', 'motorin', 'combustibil', 'carburant', 'alimentat', 'alimentari', 'alimentare', 'plin', 'plinul', 'litri', 'diesel', 'gpl']);
const KM_TERMS = new Set(['km', 'kilometri', 'kilometraj', 'kilometrajul', 'parcurs', 'consum', 'consumul']);

const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function parseDateRange(textNorm, today = new Date()) {
  const t = textNorm;
  const y = today.getFullYear();
  const m = today.getMonth();
  const used = [];
  const mark = (re) => { const x = t.match(re); if (x) used.push(...x[0].split(/\s+/)); return x; };
  let x;
  if (mark(/\b(azi|astazi)\b/)) return { from: iso(today), to: iso(today), label: 'azi', used };
  if (mark(/\bieri\b/)) { const d = new Date(y, m, today.getDate() - 1); return { from: iso(d), to: iso(d), label: 'ieri', used }; }
  if (mark(/\bsaptamana (asta|aceasta|curenta)\b/)) {
    const dow = (today.getDay() + 6) % 7;
    return { from: iso(new Date(y, m, today.getDate() - dow)), to: iso(today), label: 'săptămâna aceasta', used };
  }
  if ((x = mark(/\bultimele (\d+) (zile|luni)\b/))) {
    const n = +x[1];
    const from = x[2] === 'zile' ? new Date(y, m, today.getDate() - n + 1) : new Date(y, m - n + 1, 1);
    return { from: iso(from), to: iso(today), label: `ultimele ${n} ${x[2]}`, used };
  }
  if (mark(/\bluna (asta|aceasta|curenta)\b/)) return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)), label: 'luna aceasta', used };
  if (mark(/\bluna trecuta\b/)) return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)), label: 'luna trecută', used };
  if (mark(/\banul (asta|acesta|curent)\b/)) return { from: `${y}-01-01`, to: `${y}-12-31`, label: `anul ${y}`, used };
  if (mark(/\banul trecut\b/)) return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `anul ${y - 1}`, used };
  const monthRe = new RegExp(`\\b(${MONTHS.join('|')})(?:\\s+(\\d{4}))?\\b`);
  if ((x = mark(monthRe))) {
    const mi = MONTHS.indexOf(x[1]);
    const yy = x[2] ? +x[2] : (mi > m ? y - 1 : y);
    return { from: iso(new Date(yy, mi, 1)), to: iso(new Date(yy, mi + 1, 0)), label: `${x[1]} ${yy}`, used };
  }
  if ((x = mark(/\b(20\d{2})\b/))) return { from: `${x[1]}-01-01`, to: `${x[1]}-12-31`, label: `anul ${x[1]}`, used };
  return { from: null, to: null, label: 'toată perioada', used };
}

export function parseQuery(text, today = new Date()) {
  const t = normalize(text).replace(/[?!.,;:„”"()]/g, ' ').replace(/\s+/g, ' ').trim();
  const range = parseDateRange(t, today);
  const usedSet = new Set(range.used);
  const words = t.split(/[\s-]+/).filter(Boolean);
  let fuel = false;
  let km = false;
  const terms = [];
  for (const w of words) {
    if (usedSet.has(w)) continue;
    if (FUEL_TERMS.has(w)) { fuel = true; continue; }
    if (KM_TERMS.has(w)) { km = true; continue; }
    if (STOPWORDS.has(w) || w.length < 3 || /^\d+$/.test(w)) continue;
    terms.push({ word: w, stem: stem(w) });
  }
  return { range, fuel, km, terms };
}

function expenseStems(e, ctx) {
  const cat = ctx.categories.find((c) => c.id === e.categoryId);
  const proj = ctx.projects.find((p) => p.id === e.projectId);
  const veh = ctx.vehicles.find((v) => v.id === e.vehicleId);
  const text = [cat?.name, proj?.name, veh?.name, veh?.plate, e.store, e.notes].filter(Boolean).join(' ');
  return normalize(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3).map(stem);
}

export function isFuelExpense(e, ctx) {
  if (e.fuel && e.fuel.liters > 0) return true;
  const cat = ctx.categories.find((c) => c.id === e.categoryId);
  return !!cat?.isFuel;
}

// Rulează întrebarea peste date. ctx = { expenses, categories, projects, vehicles, odometer }
export function runQuery(text, ctx, today = new Date()) {
  const q = parseQuery(text, today);
  const { from, to } = q.range;
  let list = ctx.expenses.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
  if (q.fuel) list = list.filter((e) => isFuelExpense(e, ctx));

  const matchedTerms = [];
  const unmatched = [];
  for (const term of q.terms) {
    const anyHit = ctx.expenses.some((e) => expenseStems(e, ctx).some((s) => stemsMatch(s, term.stem)))
      || [...ctx.categories, ...ctx.projects, ...ctx.vehicles].some((o) =>
        normalize(`${o.name} ${o.plate || ''}`).split(/[^a-z0-9]+/).some((w) => w.length >= 3 && stemsMatch(stem(w), term.stem)));
    if (anyHit) matchedTerms.push(term); else unmatched.push(term.word);
  }
  for (const term of matchedTerms) {
    list = list.filter((e) => expenseStems(e, ctx).some((s) => stemsMatch(s, term.stem)));
  }

  const noMatch = q.terms.length > 0 && matchedTerms.length === 0 && !q.fuel && !q.km;
  if (noMatch) list = [];

  const total = list.reduce((s, e) => s + (+e.total || 0), 0);
  const liters = list.reduce((s, e) => s + (+e.fuel?.liters || 0), 0);
  const byCategory = {};
  for (const e of list) {
    const cat = ctx.categories.find((c) => c.id === e.categoryId);
    const key = cat?.name || 'Fără categorie';
    byCategory[key] = (byCategory[key] || 0) + (+e.total || 0);
  }
  const byProject = {};
  for (const e of list) {
    const p = ctx.projects.find((x) => x.id === e.projectId);
    if (p) byProject[p.name] = (byProject[p.name] || 0) + (+e.total || 0);
  }

  let kmInfo = null;
  if (q.km || q.fuel) {
    const readings = (ctx.odometer || []).filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
    const fuelKm = list.filter((e) => e.fuel?.km).map((e) => ({ date: e.date, km: +e.fuel.km, vehicleId: e.vehicleId }));
    const all = [...readings.map((r) => ({ date: r.date, km: +r.km, vehicleId: r.vehicleId })), ...fuelKm];
    if (all.length >= 2) {
      const kms = all.map((r) => r.km);
      const driven = Math.max(...kms) - Math.min(...kms);
      kmInfo = { driven, consumption: driven > 0 && liters > 0 ? +(liters / driven * 100).toFixed(2) : null };
    } else {
      kmInfo = { driven: null, consumption: null };
    }
  }

  return {
    query: q,
    label: q.range.label,
    expenses: list.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    total: +total.toFixed(2),
    liters: +liters.toFixed(2),
    byCategory,
    byProject,
    kmInfo,
    matchedTerms: matchedTerms.map((t) => t.word),
    unmatched,
    noMatch,
  };
}
