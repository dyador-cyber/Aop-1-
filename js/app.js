import * as db from './db.js';
import { parseReceipt, parseOdometer, runQuery, isFuelExpense, normalize, shortCompanyName, findBrand } from './parsers.js';
import { lookupCui } from './anaf.js';
import { expenseFlags, isUnknownItem } from './checks.js';
import { productKey, productSituation, fits, pantryStock, sizeTokens } from './stock.js';
import { VEHICLE_TYPES, typeOf, meterUnit, parseRegistration, parseTyreSticker, decodeVin, validVin, cleanVin, standardReminders, renewTyre, addYears, SERVICE_DEFAULTS, parseTimeline } from './vehicle.js';
import { shareReceiptPhotos, printReceipts, printPage } from './copy.js';
import { recognize, compressImage as compressRaw } from './ocr.js';
import { sanitize, sanitizeRules, sanitizeInvSubs, sanitizeStoreRules, sanitizeCuiCache, sanitizeItemNames, sanitizeStoreProjects, sanitizePantry, sanitizeTrips, safeImageDataURL, csvCell, icsText } from './sanitize.js';
import { SUBCATS, GROUPS, groupOf, subcatByKey, classifyItem, parseItems, itemKey, toolDoubt } from './items.js';
import { INV_STATUSES, OWNED, statusByKey, syncFromExpense, undoExpense, findSimilar, addMonths, WARRANTY_MONTHS, splitUnits, nextLabel, lendTool, returnTool, RETURN_STATES } from './inventory.js';
import { encryptText, decryptText } from './crypto.js';
import { PROJECT_KINDS, PROJECT_ICONS, PROJECT_COLORS, SUGGESTED_PROJECTS, PERIODS, kindOf, periodRange, inRange, expenseShares, projectTotals, projectExpenses, categoryTree, categoryBreakdown, planMigration } from './projects.js';

const RC = globalThis.ReminderCore;

const DEFAULT_CATEGORIES = [
  { key: 'food', name: 'Alimente & cumpărături', color: '#2e7d32' },
  { key: 'house_materials', name: 'Casă – materiale construcții', color: '#8d6e63' },
  { key: 'house_labor', name: 'Casă – manoperă', color: '#a1887f' },
  { key: 'house_utilities', name: 'Casă – utilități & mobilier', color: '#6d4c41' },
  { key: 'fuel', name: 'Mașină – combustibil', color: '#1565c0', isFuel: true, isCar: true },
  { key: 'car_service', name: 'Mașină – service & piese', color: '#1e88e5', isCar: true },
  { key: 'car_fees', name: 'Mașină – asigurări & taxe', color: '#5c6bc0', isCar: true },
  { key: 'health', name: 'Sănătate', color: '#c62828' },
  { key: 'other', name: 'Altele', color: '#757575' },
];
// Afișată în Setări: arată dacă telefonul a luat ultima actualizare.
const APP_VERSION = '2026.09.25-8';
const DATA_STORES = ['expenses', 'odometer', 'vehicles', 'reminders', 'tasks', 'categories', 'projects', 'inventory'];
const REMINDER_TYPES = ['RCA', 'ITP', 'CASCO', 'Rovinietă', 'Revizie', 'Anvelope', 'Extinctor', 'Trusă prim ajutor', 'Permis / buletin', 'Altul'];

const state = {
  view: 'home',
  expenses: [], odometer: [], vehicles: [], reminders: [], tasks: [], categories: [], projects: [],
  filter: { q: '', cat: '', proj: '', month: '', check: false },
  listLimit: 100,
  vehicleId: '',
  ask: '', askResult: null,
  itemRules: {},
  receiptsMode: 'bills',
  prodFilter: { q: '', month: '', sub: '' },
  inventory: [],
  invSubs: ['tools'],
  storeRules: {},
  cuiCache: {},
  itemNames: {},
  storeProjects: {},
  pantry: {},
  trips: {},
  anafStatus: null,
  period: { key: 'month', from: '', to: '' },
  projectId: null, projCat: '',
  projectsSetup: true,
  invFilter: { q: '', status: 'owned', loc: '' },
};

// ---------- utilitare ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'RON' }).format(+n || 0);
const num = (n, d = 2) => new Intl.NumberFormat('ro-RO', { maximumFractionDigits: d }).format(+n || 0);
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const bonuri = (n) => `${n} ${n === 1 ? 'bon' : 'bonuri'}`;
const fmtDate = (s) => (s ? esc(String(s).split('-').reverse().join('.')) : '—');
const catById = (id) => state.categories.find((c) => c.id === id);
// „Copii › Haine” pentru subcategorii
const catLabel = (c) => { const p = c?.parentId && catById(c.parentId); return c ? `${p ? p.name + ' › ' : ''}${c.name}` : ''; };
const catOptions = (selected, empty = '— alege —') => `<option value="">${esc(empty)}</option>` + categoryTree(state.categories).map((c) =>
  `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon ? c.icon + ' ' : '')}${esc(c.name)}</option>` +
  c.children.map((x) => `<option value="${esc(x.id)}" ${x.id === selected ? 'selected' : ''}>\u00a0\u00a0\u00a0↳ ${esc(x.name)}</option>`).join('')).join('');
const projIcon = (p) => (p ? p.icon || kindOf(p.kind).icon : '📥');
const projOptions = (selected, empty = '— fără proiect —') => `<option value="">${esc(empty)}</option>` + state.projects.map((p) =>
  `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(projIcon(p))} ${esc(p.name)}</option>`).join('');
const vehicleProject = (vid) => state.projects.find((p) => p.vehicleId && p.vehicleId === vid);
const storeKey = (s) => normalize(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const projById = (id) => state.projects.find((p) => p.id === id);
const vehById = (id) => state.vehicles.find((v) => v.id === id);
const toNum = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

const blobURLs = new WeakMap();
function blobURL(blob) {
  if (!(blob instanceof Blob)) return '';
  if (!blobURLs.has(blob)) blobURLs.set(blob, URL.createObjectURL(blob));
  return blobURLs.get(blob);
}
const imgURL = (obj) => blobURL(obj?.image);
const photosOf = (exp) => [exp.image, ...(exp.extraImages || [])].filter(Boolean);
const MAX_PHOTOS = 10;
const PART_SEP = '\n--- continuare bon ---\n';

async function compressImage(file, maxSide) {
  try { return await compressRaw(file, maxSide); } catch (e) { toast(e.message); return null; }
}

function pickFile({ capture = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.capture = 'environment';
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

// ---------- date ----------
async function loadAll() {
  for (const s of DATA_STORES) {
    state[s] = (await db.getAll(s)).map((o) => sanitize(s, o)).filter(Boolean);
  }
  sortState();
  if (!state.vehicleId || !vehById(state.vehicleId)) state.vehicleId = state.vehicles[0]?.id || '';
  state.itemRules = sanitizeRules((await db.get('meta', 'itemRules'))?.rules);
  state.invSubs = sanitizeInvSubs((await db.get('meta', 'inventorySettings'))?.subs);
  state.storeRules = sanitizeStoreRules((await db.get('meta', 'storeRules'))?.rules);
  state.cuiCache = sanitizeCuiCache((await db.get('meta', 'cuiCache'))?.data);
  state.itemNames = sanitizeItemNames((await db.get('meta', 'itemNames'))?.data);
  state.storeProjects = sanitizeStoreProjects((await db.get('meta', 'storeProjects'))?.data);
  state.pantry = sanitizePantry((await db.get('meta', 'pantry'))?.data);
  state.trips = sanitizeTrips((await db.get('meta', 'trips'))?.data);
  state.projectsSetup = !!(await db.get('meta', 'projectsSetup'))?.done;
  const st = await db.get('meta', 'anafStatus');
  state.anafStatus = st && typeof st.at === 'number' ? { ok: st.ok === true, at: st.at } : null;
}
function sortState() {
  state.categories.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  state.projects.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
  state.inventory.sort((a, b) => a.name.localeCompare(b.name) || (a.label || '').localeCompare(b.label || '', 'ro', { numeric: true }));
}

async function seed() {
  const cats = await db.getAll('categories');
  if (cats.length) return;
  let i = 0;
  for (const c of DEFAULT_CATEGORIES) await db.put('categories', { id: db.uid(), order: i++, ...c });
}

// Trecerea la proiecte (Etapa 2): se păstrează întâi o copie a legăturilor bon → categorie / proiect,
// apoi categoriile implicite primesc nume fără „Casă –”/„Mașină –”, apar categoriile noi
// (Utilități, Electrice, Copii cu subcategorii) și fiecare mașină devine proiect. Nu se șterge nimic.
async function migrate() {
  const v = (await db.get('meta', 'schema'))?.v || 0;
  if (v < 3) await migrateProjects();
  if (v < 4) await migrateTools();
}

// Etapa 3: fiecare sculă devine o bucată cu etichetă (B1, B2…), iar produsele care sunt de fapt
// consumabile (discuri, burghie, pânze) trec la „Consumabile scule” și ies din inventarul de scule.
async function migrateTools() {
  for (const e of state.expenses) {
    const items = (e.items || []).map((i) => (i.sub === 'tools' && classifyItem(i.name, state.itemRules, i.ean) === 'consumables' ? { ...i, sub: 'consumables' } : i));
    if (!items.some((i, k) => i !== e.items[k])) continue;
    const raw = await db.get('expenses', e.id);
    if (!raw) continue;
    const next = { ...raw, items: (raw.items || []).map((i) => items.find((x) => x.id === i.id) || i) };
    await db.put('expenses', next);
    const out = syncFromExpense({ ...e, items }, state.inventory, { subs: state.invSubs, uid: db.uid });
    for (const id of out.dels) await db.del('inventory', id);
  }
  state.inventory = (await db.getAll('inventory')).map((o) => sanitize('inventory', o)).filter(Boolean);
  for (const x of splitUnits(state.inventory, db.uid)) {
    const raw = x.id && (await db.get('inventory', x.id));
    const c = sanitize('inventory', { ...(raw || {}), ...x, image: raw?.image || x.image || null });
    if (c) await db.put('inventory', c);
  }
  await db.put('meta', { id: 'schema', v: 4 });
  await loadAll();
}

async function migrateProjects() {
  await db.put('meta', {
    id: 'backupBeforeV3', at: Date.now(), categories: state.categories, projects: state.projects,
    expenses: state.expenses.map((e) => ({ id: e.id, categoryId: e.categoryId, projectId: e.projectId, vehicleId: e.vehicleId })),
  });
  const m = planMigration(state, db.uid);
  for (const [store, list] of [['categories', m.categories], ['projects', m.projects]]) {
    for (const o of list) { const c = sanitize(store, o); if (c) await db.put(store, c); }
  }
  for (const e of m.expenses) {
    const raw = await db.get('expenses', e.id); // cu pozele, exact cum e salvat
    if (raw) await db.put('expenses', { ...raw, projectId: e.projectId });
  }
  await db.put('meta', { id: 'schema', v: 3 });
  await loadAll();
}

async function save(store, obj) {
  const clean = sanitize(store, obj);
  if (!clean) { toast('Date invalide – verifică câmpurile'); return false; }
  await db.put(store, clean);
  // bonurile și inventarul se actualizează pe loc (rapid și cu mii de bonuri); restul se recitesc
  if (store === 'expenses' || store === 'inventory') {
    const list = state[store];
    const i = list.findIndex((o) => o.id === clean.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
    sortState();
  } else await loadAll();
  render();
  return true;
}
async function remove(store, id, what = 'elementul') {
  if (!confirm(`Ștergi ${what}?`)) return false;
  await db.del(store, id);
  await loadAll();
  render();
  return true;
}

// ---------- modal ----------
function openModal(title, html, onMount) {
  const dlg = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  if (!dlg.open) dlg.showModal();
  onMount?.($('#modal-body'));
}
function closeModal() { const d = $('#modal'); if (d.open) d.close(); }

function options(list, selected, empty = '— nimic —') {
  return `<option value="">${esc(empty)}</option>` + list.map((o) =>
    `<option value="${esc(o.id)}" ${o.id === selected ? 'selected' : ''}>${esc(o.name)}${o.plate ? ' (' + esc(o.plate) + ')' : ''}</option>`).join('');
}

// ---------- randare ----------
const VIEWS = { home: renderHome, project: renderProject, receipts: renderReceipts, inventory: () => renderInventory(), car: renderCar, lists: renderLists, settings: renderSettings };

function render() {
  const tab = state.view === 'project' ? 'home' : state.view;
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === tab || (b.dataset.more !== undefined && ['lists', 'settings'].includes(tab))));
  const v = $('#view');
  const changed = v.dataset.view !== state.view;
  v.innerHTML = (VIEWS[state.view] || renderHome)();
  v.dataset.view = state.view;
  // animație scurtă doar la schimbarea ecranului (nu la fiecare redesenare)
  if (changed) { v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); }
}

// opts.share = cât din bon revine proiectului afișat (când bonul e împărțit).
// (folosită și direct în .map(), care trimite indexul ca al doilea argument – de aceea obiect)
function expenseRow(e, opts) {
  const share = opts && typeof opts === 'object' ? opts.share : null;
  const cat = catById(e.categoryId);
  const proj = projById(e.projectId);
  const img = blobURL(e.thumb || e.image);
  const fuel = e.fuel?.liters ? ` · ${num(e.fuel.liters)} L` : e.fuel?.kwh ? ` · ${num(e.fuel.kwh)} kWh` : '';
  const flags = expenseFlags(e);
  return `<li class="row" data-action="edit-expense" data-id="${esc(e.id)}">
    ${img ? `<img class="thumb" src="${img}" alt="" loading="lazy" decoding="async">` : '<div class="thumb ph">🧾</div>'}
    <div class="grow">
      <div class="title">${e.isReturn ? '↩️ ' : ''}${esc(e.store || (e.fuel?.kwh ? `🔌 Încărcare${e.fuel.place === 'home' ? ' acasă' : ''}` : e.fuel?.liters ? '⛽ Alimentare' : 'Fără nume'))}${e.extraImages?.length ? ` <span class="muted small">📄×${e.extraImages.length + 1}</span>` : ''}</div>
      <div class="sub">${fmtDate(e.date)} · <span class="dot" style="background:${esc(cat?.color || '#999')}"></span>${esc(catLabel(cat) || 'Fără categorie')}${proj ? ` · ${esc(projIcon(proj))} ${esc(proj.name)}` : ''}${fuel}${(e.items || []).some((i) => i.projectId && i.projectId !== e.projectId) ? ' · ✂️ împărțit' : ''}</div>
      ${e.fuel?.trip ? `<div class="sub">🛣️ ${esc(e.fuel.trip)}</div>` : ''}
      ${e.items?.length ? `<div class="sub items-peek">🧾 ${esc(e.items.slice(0, 4).map((i) => i.name).join(', '))}${e.items.length > 4 ? ` +${e.items.length - 4}` : ''}</div>` : ''}
      ${flags.length ? `<div class="sub warn-text">${flags[0].text.startsWith('❓') ? '' : '⚠️ '}${esc(flags[0].text.replace(/ – .*/, ''))}${flags.length > 1 ? ` (+${flags.length - 1})` : ''}</div>` : ''}
    </div>
    <div class="amount">${share != null && Math.abs(share - (+e.total || 0)) > 0.004 ? `${money(share)}<div class="muted small">din ${money(e.total)}</div>` : money(e.total)}</div>
  </li>`;
}

function reminderRow(r) {
  const days = RC.daysUntil(r.dueDate, new Date());
  const cls = days < 0 ? 'bad' : days <= 7 ? 'bad' : days <= 30 ? 'warn' : 'ok';
  const txt = days < 0 ? `expirat de ${-days} zile` : days === 0 ? 'expiră azi' : `în ${days} zile`;
  const v = vehById(r.vehicleId);
  const km = r.dueKm && v ? vehicleStats(v.id).lastKm : null;
  const u = meterUnit(v) === 'h' ? 'ore' : 'km';
  const kmTxt = r.dueKm ? ` · la ${num(r.dueKm, 0)} ${u}${km != null ? ` (${r.dueKm - km >= 0 ? `mai sunt ${num(r.dueKm - km, 0)}` : `depășit cu ${num(km - r.dueKm, 0)}`})` : ''}` : '';
  const kmBad = r.dueKm && km != null && km >= r.dueKm - (u === 'ore' ? 25 : 500);
  return `<li class="row" data-action="edit-reminder" data-id="${esc(r.id)}">
    <div class="grow"><div class="title">${esc(r.title || r.type)}</div>
    <div class="sub">${v ? esc(typeOf(v.type).icon) + ' ' + esc(v.name) + ' · ' : ''}${fmtDate(r.dueDate)}${kmTxt}</div></div>
    <span class="badge ${kmBad ? 'bad' : cls}">${kmBad ? 'revizia e aproape' : txt}</span></li>`;
}

function breakdown(obj, total) {
  const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '';
  return `<table class="breakdown"><tbody>${rows.map(([k, v]) => {
    const c = state.categories.find((x) => x.name === k) || SUBCATS.find((x) => x.name === k);
    return `<tr><td><span class="dot" style="background:${esc(c?.color || '#999')}"></span>${esc(k)}</td>
      <td class="num">${money(v)}</td><td class="num muted">${total ? Math.round(v / total * 100) : 0}%</td></tr>`;
  }).join('')}</tbody></table>`;
}

function renderAskResult() {
  const r = state.askResult;
  if (!r) return '';
  if (r.noMatch) {
    return `<div class="card result"><p>Nu am găsit nimic pentru „${esc(r.unmatched.join(', '))}”.
      Încearcă numele unei categorii, al unui proiect, al mașinii sau al magazinului.</p></div>`;
  }
  const fuelLine = r.query.fuel ? `<div class="kpis">
      <div><b>${num(r.liters)} L</b><span>carburant</span></div>
      <div><b>${r.liters ? money(r.total / r.liters) : '—'}</b><span>preț mediu / L</span></div>
      ${r.kmInfo?.driven ? `<div><b>${num(r.kmInfo.driven, 0)} km</b><span>parcurși</span></div>` : ''}
      ${r.kmInfo?.consumption ? `<div><b>${num(r.kmInfo.consumption)}</b><span>L / 100 km</span></div>` : ''}
    </div>` : r.query.km && r.kmInfo ? `<div class="kpis"><div><b>${r.kmInfo.driven != null ? num(r.kmInfo.driven, 0) + ' km' : '—'}</b><span>parcurși</span></div></div>` : '';
  return `<div class="card result">
    <div class="big">${money(r.total)}</div>
    <div class="muted">${r.items ? `${r.items.length} ${r.items.length === 1 ? 'produs' : 'produse'} din ` : ''}${bonuri(r.expenses.length)} · ${esc(r.label)}${r.matchedTerms.length ? ' · „' + esc(r.matchedTerms.join(' ')) + '”' : ''}</div>
    ${r.unmatched.length ? `<div class="muted small">Ignorat: ${esc(r.unmatched.join(', '))}</div>` : ''}
    ${fuelLine}
    ${breakdown(r.byCategory, r.total)}
    ${Object.keys(r.byProject).length ? `<h4>Pe proiecte</h4>${breakdown(r.byProject, r.total)}` : ''}
    ${r.items ? `<details open><summary>Vezi produsele (${r.items.length})</summary><ul class="list">${r.items.slice(0, 200).map(itemRow).join('')}</ul></details>`
    : `<details><summary>Vezi bonurile (${r.expenses.length})</summary><ul class="list">${r.expenses.slice(0, 200).map(expenseRow).join('')}</ul></details>`}
  </div>`;
}

// Alegerea perioadei (azi, săptămâna, luna, anul, total, interval) – aceeași pe toate ecranele.
function periodChips() {
  const p = state.period;
  return `<div class="period-chips" role="tablist">${PERIODS.map((x) => `<button class="pchip ${x.key === p.key ? 'on' : ''}" data-action="period" data-key="${x.key}">${esc(x.name)}</button>`).join('')}</div>
    ${p.key === 'custom' ? `<div class="grid2 period-range"><label>De la<input type="date" id="p-from" value="${esc(p.from)}"></label><label>Până la<input type="date" id="p-to" value="${esc(p.to)}"></label></div>` : ''}`;
}

// Iconița unui proiect, ca pe ecranul telefonului
function projectTile(p, amount) {
  const color = p?.color || (p ? PROJECT_COLORS[Math.abs([...p.id].reduce((a, c) => a + c.charCodeAt(0), 0)) % PROJECT_COLORS.length] : '#78909c');
  return `<button class="tile" data-action="open-project" data-id="${esc(p?.id || '')}">
    <span class="tile-icon" style="background:${esc(color)}">${esc(projIcon(p))}</span>
    <span class="tile-name">${esc(p ? p.name : 'Fără proiect')}</span>
    <span class="tile-sum">${amount ? money(amount) : '—'}</span></button>`;
}

function renderSetupCard() {
  if (state.projectsSetup) return '';
  const have = new Set(state.projects.map((p) => normalize(p.name)));
  const sugg = SUGGESTED_PROJECTS.filter((x) => !have.has(normalize(x.name)));
  return `<section class="card setup-card"><h3>📁 Proiectele tale</h3>
    <p class="small">Fiecare casă, atelierul și fiecare mașină au propriul proiect, cu totalul lor. Bonurile le încarci direct în proiect, apăsând pe iconiță.</p>
    ${sugg.map((x, i) => `<label class="check"><input type="checkbox" class="setup-pick" data-i="${i}" checked> ${esc(x.icon)} ${esc(x.name)}</label>`).join('')}
    ${state.projects.length ? `<p class="small muted">Există deja: ${state.projects.map((p) => esc(projIcon(p) + ' ' + p.name)).join(', ')}. Le poți redenumi sau șterge din proiect → ✏️.</p>` : ''}
    <div class="row-flex wrap"><button class="primary" data-action="setup-projects">Creează proiectele</button><button data-action="skip-setup">Nu acum</button></div>
  </section>`;
}

function renderHome() {
  const now = todayISO();
  const range = periodRange(state.period);
  const { total, byProject } = projectTotals(state.expenses, range);
  const upcoming = state.reminders.filter((r) => !r.done && RC.daysUntil(r.dueDate, new Date()) <= 45)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const todayLists = state.tasks.filter((t) => t.date && t.date <= now && t.items.some((i) => !i.done));
  const toCheck = state.expenses.filter((e) => expenseFlags(e).length).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const none = byProject[''] || 0;

  return `
  <section class="card period-card">
    ${periodChips()}
    <div class="big-total">${money(total)}</div>
    <div class="muted small">cheltuieli · ${esc(range.label)}</div>
  </section>
  <section class="proj-grid">
    ${state.projects.map((p) => projectTile(p, byProject[p.id] || 0)).join('')}
    ${none ? projectTile(null, none) : ''}
    <button class="tile add" data-action="new-project"><span class="tile-icon">＋</span><span class="tile-name">Proiect nou</span><span class="tile-sum"></span></button>
  </section>
  ${renderSetupCard()}
  <section class="quick">
    <button class="big-btn" data-action="photo-receipt">📷<span>Fotografiază bon</span></button>
    <button class="big-btn" data-action="photo-odometer">🚗<span>Poză kilometraj</span></button>
    <button class="big-btn" data-action="new-list">📝<span>Listă nouă</span></button>
  </section>
  ${toCheck.length ? `<section class="card check-card"><h3>⚠️ De verificat (${toCheck.length})</h3>
    <ul class="list">${toCheck.slice(0, 4).map(expenseRow).join('')}</ul>
    ${toCheck.length > 4 ? '<button class="link" data-action="show-to-check">Vezi toate →</button>' : ''}</section>` : ''}
  ${upcoming.length ? `<section class="card"><h3>⏰ Expirări apropiate</h3><ul class="list">${upcoming.map(reminderRow).join('')}</ul></section>` : ''}
  ${todayLists.length ? `<section class="card"><h3>🛒 De făcut azi</h3>${todayLists.map(listCard).join('')}</section>` : ''}
  <section class="card ask">
    <form id="ask-form">
      <input name="q" type="search" placeholder="Întreabă: cât m-a costat casa?" value="${esc(state.ask)}" autocomplete="off">
      <button class="primary">Caută</button>
    </form>
    <div class="chips">
      ${['Cât m-a costat casa?', 'Cât am dat pe benzină anul acesta?', 'Băuturi luna asta', 'Scule', 'Unt', 'Cheltuieli mașină luna asta', 'Consum luna trecută']
        .map((c) => `<button class="chip" data-action="ask" data-q="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
  </section>
  ${renderAskResult()}`;
}

// Bare pe categorii (cu subcategorii) pentru ecranul proiectului
function catBars(nodes, total, drill) {
  if (!nodes.length) return '<p class="muted">Niciun bon în perioada aleasă.</p>';
  return `<ul class="cat-bars">${nodes.map((n) => {
    const c = n.cat;
    const pct = total ? Math.max(2, Math.round(Math.abs(n.total) / Math.abs(total) * 100)) : 0;
    return `<li ${drill && c ? `class="click" data-action="proj-cat" data-id="${esc(c.id)}"` : ''}>
      <div class="cb-head"><span>${esc(c?.icon || '•')} ${esc(c?.name || 'Fără categorie')}${n.children?.length ? ` <span class="muted small">(${n.children.length === 1 ? '1 subcategorie' : `${n.children.length} subcategorii`})</span>` : ''}</span><b>${money(n.total)}</b></div>
      <div class="cb-bar"><span style="width:${pct}%;background:${esc(c?.color || '#9e9e9e')}"></span></div>
      <div class="muted small">${bonuri(n.count)}${drill && c ? ' · detalii ›' : ''}</div></li>`;
  }).join('')}</ul>`;
}

function renderProject() {
  const pid = state.projectId || '';
  const p = pid ? projById(pid) : null;
  if (pid && !p) { state.view = 'home'; return renderHome(); }
  const range = periodRange(state.period);
  let rows = projectExpenses(state.expenses, pid, range);
  const total = rows.reduce((a, r) => a + r.share, 0);
  const tree = categoryBreakdown(rows, state.categories);
  const sel = state.projCat ? catById(state.projCat) : null;
  let body;
  if (sel) {
    const node = tree.find((n) => n.cat?.id === sel.id);
    rows = rows.filter(({ e }) => e.categoryId === sel.id || catById(e.categoryId)?.parentId === sel.id);
    body = `<section class="card"><button class="link" data-action="proj-cat" data-id="">‹ Toate categoriile</button>
      <h3>${esc(sel.icon || '')} ${esc(sel.name)} · ${money(node?.total || 0)}</h3>
      ${node?.children.length ? catBars(node.children, node.total, false) : ''}</section>`;
  } else {
    body = `<section class="card"><h3>Pe categorii</h3>${catBars(tree, total, true)}</section>`;
  }
  const allTime = p?.budget ? projectExpenses(state.expenses, pid, { from: '', to: '' }).reduce((a, r) => a + r.share, 0) : 0;
  const shown = rows.slice(0, state.listLimit);
  return `
  <section class="card proj-head">
    <div class="row-flex">
      <button class="icon-btn" data-action="go-home" aria-label="Înapoi">‹</button>
      <span class="tile-icon sm">${esc(projIcon(p))}</span>
      <h2 class="grow">${esc(p ? p.name : 'Fără proiect')}</h2>
      ${p ? `<button class="icon-btn" data-action="edit-project" data-id="${esc(p.id)}" aria-label="Editează proiectul">✏️</button>` : ''}
    </div>
    ${periodChips()}
    <div class="big-total">${money(total)}</div>
    <div class="muted small">${esc(range.label)} · ${bonuri(rows.length)}</div>
    ${p?.budget ? `<div class="budget"><div class="cb-bar"><span style="width:${Math.min(100, Math.round(allTime / p.budget * 100))}%;background:${allTime > p.budget ? '#c62828' : '#2e7d32'}"></span></div>
      <div class="small muted">Buget: ${money(allTime)} din ${money(p.budget)} (total, toată perioada)</div></div>` : ''}
  </section>
  <section class="quick">
    <button class="big-btn" data-action="photo-receipt" data-project="${esc(pid)}">📷<span>Bon aici</span></button>
    <button class="big-btn" data-action="gallery-receipt" data-project="${esc(pid)}">🖼️<span>Din galerie</span></button>
    <button class="big-btn" data-action="new-expense" data-project="${esc(pid)}">✍️<span>Manual</span></button>
  </section>
  ${p?.vehicleId ? `<button class="card wide-link" data-action="open-car" data-id="${esc(p.vehicleId)}">🚗 Consum, kilometri și expirări →</button>` : ''}
  ${body}
  <section class="card"><h3>Bonuri</h3>
    <ul class="list">${shown.map(({ e, share }) => expenseRow(e, { share })).join('') || '<li class="muted pad">Niciun bon în perioada aleasă.</li>'}</ul>
    ${rows.length > state.listLimit ? `<button class="link center-btn" data-action="more-receipts">Arată încă ${Math.min(100, rows.length - state.listLimit)}</button>` : ''}
  </section>`;
}

function filteredExpenses() {
  const f = state.filter;
  const q = f.q.toLowerCase();
  return state.expenses.filter((e) =>
    (!f.cat || e.categoryId === f.cat || catById(e.categoryId)?.parentId === f.cat) &&
    (!f.proj || expenseShares(e).has(f.proj)) &&
    (!f.month || (e.date || '').startsWith(f.month)) &&
    (!f.check || expenseFlags(e).length > 0) &&
    (!q || `${e.store} ${e.notes} ${e.ocrText}`.toLowerCase().includes(q)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
}

function modeSwitch() {
  const m = state.receiptsMode;
  return `<div class="seg" role="tablist">
    <button data-action="rmode" data-mode="bills" class="${m === 'bills' ? 'on' : ''}">🧾 Bonuri</button>
    <button data-action="rmode" data-mode="products" class="${m === 'products' ? 'on' : ''}">📊 Produse</button></div>`;
}

// Toate produsele de pe bonuri, cu bonul din care provin.
function allItems(month = '') {
  return state.expenses.filter((e) => !month || (e.date || '').startsWith(month))
    .flatMap((e) => (e.items || []).map((i) => ({ ...i, e })));
}

function itemRow(i) {
  const sc = subcatByKey(i.sub);
  return `<li class="row" data-action="edit-expense" data-id="${esc(i.e.id)}">
    <div class="grow"><div class="title">${i.amount < 0 ? '↩️ ' : ''}${esc(i.name)}</div>
    <div class="sub">${fmtDate(i.e.date)} · ${esc(i.e.store || '?')} · <span class="dot" style="background:${esc(sc.color)}"></span>${esc(sc.name)}${i.qty != null ? ` · ${num(i.qty, 3)} × ${money(i.unitPrice)}` : ''}</div></div>
    <div class="amount">${money(i.amount)}</div></li>`;
}

// Cartea unui produs: cât ai cumpărat, de câte ori, cu cât, unde, pe ce proiect
function situationCard(g) {
  const starred = !!state.pantry[g.key];
  const tools = toolsFor(g.name);
  const rows = allItems().filter((i) => productKey(i.name) === g.key).sort((a, b) => b.e.date.localeCompare(a.e.date));
  const projs = Object.entries(g.byProject).filter(([, a]) => a).sort((a, b) => b[1] - a[1]);
  return `<article class="sit-card">
    <div class="sit-head"><div class="grow"><b>${esc(g.name)}</b> ${g.sizes.map((z) => `<span class="chip-s">${esc(z.toUpperCase())}</span>`).join('')}</div>
      <button class="star ${starred ? 'on' : ''}" data-action="pantry-star" data-key="${esc(g.key)}" data-name="${esc(g.name)}" aria-label="${starred ? 'Scoate din cămară' : 'Pune în cămară'}">${starred ? '⭐' : '☆'}</button></div>
    <div class="sit-big">${num(g.qty, 3)} <small>buc. cumpărate${g.first ? ` din ${fmtDate(g.first)}` : ''}</small></div>
    <div class="stat-row mini">
      <div class="stat"><b>${g.purchases}</b><span>cumpărări</span></div>
      <div class="stat"><b>${money(g.total)}</b><span>total</span></div>
      <div class="stat"><b>${g.avgPrice != null ? money(g.avgPrice) : '—'}</b><span>preț mediu</span></div>
      <div class="stat"><b>${g.minPrice != null ? (g.minPrice === g.maxPrice ? money(g.minPrice) : `${num(g.minPrice)}–${num(g.maxPrice)}`) : '—'}</b><span>min – max</span></div>
    </div>
    ${g.last ? `<p class="small">🕒 Ultima dată: <b>${fmtDate(g.last.date)}</b> · ${esc(g.last.store || '?')} · ${num(g.last.qty, 3)} × ${money(g.last.unitPrice)}</p>` : ''}
    ${projs.length ? `<div class="chip-wrap">${projs.map(([pid, a]) => `<span class="chip-s">${esc(projIcon(projById(pid)))} ${esc(projById(pid)?.name || 'fără proiect')} · ${money(a)}</span>`).join('')}</div>` : ''}
    ${tools.length ? `<p class="small">🔧 Pentru: ${tools.map((t) => `<b>${esc(t.label || '')}</b> ${esc(t.name)}`).join(', ')}</p>` : ''}
    <details><summary class="small">Toate cumpărările (${rows.length})</summary><ul class="list">${rows.slice(0, 100).map(itemRow).join('')}</ul></details>
  </article>`;
}

function pantryCard() {
  const entries = Object.values(state.pantry);
  if (!entries.length) return '';
  const rows = entries.map((p) => ({ p, s: pantryStock(p, state.expenses) })).sort((a, b) => a.s.left - b.s.left || a.p.name.localeCompare(b.p.name));
  return `<section class="card"><h3>🥫 Cămara</h3>
    <ul class="pantry">${rows.map(({ p, s: st }) => `<li class="${st.left <= 0 ? 'empty' : st.left <= 1 ? 'low' : ''}">
      <div class="grow"><b>${esc(p.name)}</b><div class="small muted">${st.left <= 0 ? 'S-a terminat' : `~${num(st.left, 2)} rămase`}${st.lastDate ? ` · cumpărat ${fmtDate(st.lastDate)}` : ''}</div></div>
      <button data-action="pantry-use" data-key="${esc(p.key)}" aria-label="Am folosit una">−1</button>
      <button data-action="pantry-done" data-key="${esc(p.key)}">S-a terminat</button>
      <button data-action="pantry-list" data-key="${esc(p.key)}" aria-label="Pune pe lista de cumpărături">🛒</button>
    </li>`).join('')}</ul>
    <p class="muted small">Stocul crește singur când cumperi produsul (de pe bon); „−1” când folosești unul. ⭐ pe orice produs îl pune aici.</p>
  </section>`;
}

function renderProducts() {
  const f = state.prodFilter;
  const items = allItems(f.month);
  const bySub = {};
  const countSub = {};
  for (const i of items) {
    bySub[i.sub] = (bySub[i.sub] || 0) + (+i.amount || 0);
    countSub[i.sub] = (countSub[i.sub] || 0) + 1;
  }
  const total = items.reduce((a, i) => a + (+i.amount || 0), 0);
  const q = f.q.trim();
  const sit = q ? productSituation(q, f.month ? state.expenses.filter((e) => (e.date || '').startsWith(f.month)) : state.expenses) : [];
  const subSel = f.sub ? items.filter((i) => i.sub === f.sub).sort((a, b) => b.e.date.localeCompare(a.e.date)) : [];
  const noItems = state.expenses.filter((e) => (!f.month || (e.date || '').startsWith(f.month)) && !(e.items || []).length).length;
  const byGroup = {};
  for (const i of items) { const g = groupOf(i.sub).key; byGroup[g] = (byGroup[g] || 0) + (+i.amount || 0); }
  const groups = GROUPS.filter((g) => byGroup[g.key] !== undefined).sort((a, b) => byGroup[b.key] - byGroup[a.key]);
  const pct = (v) => (total ? Math.max(2, Math.round(Math.abs(v) / Math.abs(total) * 100)) : 0);
  return `${modeSwitch()}
  <section class="card filters">
    <input id="p-q" type="search" placeholder="Situația unui produs: unt, șurub M6, disc 125…" value="${esc(f.q)}">
    <div class="grid2">
      <select id="p-sub"><option value="">Toate subcategoriile</option>${SUBCATS.map((c) => `<option value="${c.key}" ${c.key === f.sub ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <input id="p-month" type="month" value="${esc(f.month)}">
    </div>
  </section>
  ${q ? (sit.length ? `<p class="muted small pad-x">${sit.length === 1 ? 'O variantă' : `${sit.length} variante`} pentru „${esc(q)}”${sit.length > 1 ? ' (mărimi diferite, ex. M5 / M6, sunt separate)' : ''}</p>${sit.slice(0, 20).map(situationCard).join('')}`
    : `<section class="card"><p class="muted">Nimic găsit pentru „${esc(q)}”.</p></section>`) : ''}
  ${f.sub ? `<section class="card result">
    <div class="big">${money(subSel.reduce((a, i) => a + (+i.amount || 0), 0))}</div>
    <div class="muted">${subSel.length} produse · ${esc(subcatByKey(f.sub).name)}${f.month ? ` · ${esc(f.month)}` : ''} <button class="link" data-action="prod-sub" data-sub="${esc(f.sub)}">✕</button></div>
    <ul class="list">${subSel.slice(0, 300).map(itemRow).join('')}</ul>
  </section>` : ''}
  ${!q ? pantryCard() : ''}
  ${!q && !f.sub ? `<section class="card"><h3>Pe grupe · ${money(total)}</h3>
    ${groups.length ? `<div class="group-cards">${groups.map((g) => {
      const subs = SUBCATS.filter((c) => c.group === g.key && bySub[c.key] !== undefined).sort((a, b) => bySub[b.key] - bySub[a.key]);
      return `<article class="group-card">
        <div class="cb-head"><b>${esc(g.name)}</b><b>${money(byGroup[g.key])}</b></div>
        <div class="cb-bar"><span style="width:${pct(byGroup[g.key])}%;background:${esc(subs[0]?.color || '#9e9e9e')}"></span></div>
        <div class="chip-wrap">${subs.map((c) => `<button class="chip-s click" data-action="prod-sub" data-sub="${c.key}"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name.replace(/^Materiale – (.)/, (m, ch) => ch.toUpperCase()))} · ${money(bySub[c.key])} <span class="muted">(${countSub[c.key]})</span></button>`).join('')}</div>
      </article>`;
    }).join('')}</div>`
      : '<p class="muted">Niciun produs încă. Produsele se citesc automat de pe bonurile noi fotografiate.</p>'}
    ${noItems ? `<p class="muted small">${bonuri(noItems)} fără produse citite (de ex. bonuri de card sau introduse manual).</p>` : ''}
  </section>` : ''}`;
}

function renderReceipts() {
  if (state.receiptsMode === 'products') return renderProducts();
  const list = filteredExpenses();
  const total = list.reduce((s, e) => s + (+e.total || 0), 0);
  const f = state.filter;
  return `${modeSwitch()}
  <section class="quick two">
    <button class="big-btn" data-action="photo-receipt">📷<span>Fotografiază bon</span></button>
    <button class="big-btn" data-action="gallery-receipt">🖼️<span>Din galerie</span></button>
    <button class="big-btn" data-action="new-expense">✍️<span>Manual</span></button>
  </section>
  <section class="card filters">
    <input id="f-q" type="search" placeholder="Caută magazin, notă, text bon…" value="${esc(f.q)}">
    <div class="grid3">
      <select id="f-cat">${catOptions(f.cat, 'Toate categoriile')}</select>
      <select id="f-proj">${projOptions(f.proj, 'Toate proiectele')}</select>
      <input id="f-month" type="month" value="${esc(f.month)}">
    </div>
    <div class="total-line">${bonuri(list.length)} · <b>${money(total)}</b></div>
    <div class="row-btns">
      <label class="check small"><input type="checkbox" id="f-check" ${f.check ? 'checked' : ''}> ⚠️ Doar cele de verificat</label>
      ${list.length ? `<button class="link" data-action="print-receipts">📤 Copie bonuri (${list.length})</button>` : ''}
    </div>
  </section>
  <ul class="list card">${list.slice(0, state.listLimit).map(expenseRow).join('') || '<li class="muted pad">Niciun bon.</li>'}</ul>
  ${list.length > state.listLimit ? `<button class="link center-btn" data-action="more-receipts">Arată încă ${Math.min(100, list.length - state.listLimit)} (din ${list.length - state.listLimit} rămase)</button>` : ''}`;
}

// Cheltuielile unui vehicul: bonurile cu mașina aleasă sau din proiectul vehiculului
const vehicleExpenses = (vid) => { const pid = vehicleProject(vid)?.id; return state.expenses.filter((e) => e.vehicleId === vid || (pid && e.projectId === pid)); };

function vehicleStats(vid) {
  const all = vehicleExpenses(vid);
  const fuel = all.filter((e) => isFuelExpense(e, state)).sort((a, b) => a.date.localeCompare(b.date));
  const readings = [
    ...state.odometer.filter((o) => o.vehicleId === vid).map((o) => ({ date: o.date, km: +o.km })),
    ...fuel.filter((e) => e.fuel?.km).map((e) => ({ date: e.date, km: +e.fuel.km })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
  const lastKm = readings.length ? Math.max(...readings.map((r) => r.km)) : null;
  const year = todayISO().slice(0, 4);
  const yearFuel = fuel.filter((e) => e.date.startsWith(year));
  // consum: între prima și ultima alimentare cu km, fără prima cantitate (plinul de dinainte)
  const per100 = (key) => {
    const withKm = fuel.filter((e) => e.fuel?.km && e.fuel?.[key]).sort((a, b) => a.fuel.km - b.fuel.km);
    if (withKm.length < 2) return null;
    const dist = withKm[withKm.length - 1].fuel.km - withKm[0].fuel.km;
    const q = withKm.slice(1).reduce((a, e) => a + +e.fuel[key], 0);
    return dist > 0 ? q / dist * 100 : null;
  };
  const yr = readings.filter((r) => r.date.startsWith(year));
  const kmYear = yr.length >= 2 ? Math.max(...yr.map((r) => r.km)) - Math.min(...yr.map((r) => r.km)) : 0;
  const carCost = all.filter((e) => e.date.startsWith(year)).reduce((a, e) => a + (+e.total || 0), 0);
  const energyCost = yearFuel.reduce((a, e) => a + (+e.total || 0), 0);
  const kwhYear = yearFuel.reduce((a, e) => a + (+e.fuel?.kwh || 0), 0);
  const homeKwh = yearFuel.filter((e) => e.fuel?.place === 'home').reduce((a, e) => a + (+e.fuel?.kwh || 0), 0);
  return {
    fuel, readings, lastKm, carCost, kmYear,
    consumption: per100('liters'), kwh100: per100('kwh'),
    yearLiters: yearFuel.reduce((a, e) => a + (+e.fuel?.liters || 0), 0), kwhYear,
    yearFuelCost: energyCost,
    cost100: kmYear >= 100 ? carCost / kmYear * 100 : null,
    energy100: kmYear >= 100 ? energyCost / kmYear * 100 : null,
    homeShare: kwhYear ? Math.round(homeKwh / kwhYear * 100) : null,
  };
}

function renderCar() {
  if (!state.vehicles.length) {
    return `<section class="card center"><p>Adaugă vehiculul (mașină, electrică, motocicletă sau utilaj) ca să urmărești consumul, kilometrii și expirările.</p>
      <button class="primary" data-action="new-vehicle">+ Adaugă vehicul</button></section>
      ${renderRemindersCard(state.reminders)}`;
  }
  const vid = state.vehicleId;
  const v = vehById(vid);
  const t = typeOf(v?.type);
  const unit = t.meter === 'h' ? 'ore' : 'km';
  const s = vehicleStats(vid);
  const rems = state.reminders.filter((r) => r.vehicleId === vid || !r.vehicleId);
  const odo = state.odometer.filter((o) => o.vehicleId === vid).sort((a, b) => b.date.localeCompare(a.date) || b.km - a.km);
  const year = todayISO().slice(0, 4);
  const desc = [v?.make, v?.model, v?.year || (v?.firstReg || '').slice(0, 4)].filter(Boolean).join(' ');
  return `
  <section class="card veh-head">
    <div class="row-flex">
      <select id="veh-select">${state.vehicles.map((x) => `<option value="${esc(x.id)}" ${x.id === vid ? 'selected' : ''}>${esc(typeOf(x.type).icon)} ${esc(x.name)} ${x.plate ? '(' + esc(x.plate) + ')' : ''}</option>`).join('')}</select>
      <button class="icon-btn" data-action="edit-vehicle" data-id="${esc(vid)}" aria-label="Editează">✏️</button>
      <button class="icon-btn" data-action="new-vehicle" aria-label="Vehicul nou">＋</button>
    </div>
    <div class="veh-id"><span class="tile-icon sm">${esc(t.icon)}</span><div><b>${esc(desc || v?.name || '')}</b><div class="muted small">${esc(t.name)}${v?.plate ? ' · ' + esc(v.plate) : ''}</div></div></div>
  </section>
  <section class="stat-row">
    <div class="stat"><b>${s.lastKm != null ? num(s.lastKm, 0) : '—'}</b><span>${t.meter === 'h' ? 'ore motor' : 'km la bord'}</span></div>
    ${t.energy !== 'electric' && t.meter !== 'h' ? `<div class="stat"><b>${s.consumption ? num(s.consumption) : '—'}</b><span>L / 100 km</span></div>` : ''}
    ${t.energy !== 'fuel' ? `<div class="stat"><b>${s.kwh100 ? num(s.kwh100) : '—'}</b><span>kWh / 100 km</span></div>` : ''}
    ${t.meter !== 'h' ? `<div class="stat"><b>${s.cost100 != null ? money(s.cost100) : '—'}</b><span>cost total / 100 km</span></div>` : `<div class="stat"><b>${num(s.yearLiters)} L</b><span>carburant ${year}</span></div>`}
    <div class="stat"><b>${money(s.carCost)}</b><span>total ${year}</span></div>
    ${t.energy !== 'fuel' && s.homeShare != null ? `<div class="stat"><b>${s.homeShare}%</b><span>încărcat acasă</span></div>` : ''}
  </section>
  <section class="quick">
    ${t.energy !== 'electric' ? '<button class="big-btn" data-action="new-fuel">⛽<span>Alimentare</span></button>' : ''}
    ${t.energy !== 'fuel' ? '<button class="big-btn" data-action="new-charge">🔌<span>Încărcare</span></button>' : ''}
    <button class="big-btn" data-action="photo-odometer">📷<span>Poză bord</span></button>
    <button class="big-btn" data-action="new-odometer">🔢<span>${t.meter === 'h' ? 'Ore manual' : 'Km manual'}</span></button>
  </section>
  <section class="card doc-btns">
    <button data-action="veh-sheet">📄 Fișă tehnică</button>
    <button data-action="veh-history">📜 Istoric pentru vânzare</button>
    ${t.meter === 'km' ? '<button data-action="veh-timeline">🗺️ Drumuri din Google Timeline</button>' : ''}
  </section>
  ${renderRemindersCard(rems, vid)}
  ${renderTripsCard(vid)}
  <section class="card"><h3>${t.energy === 'electric' ? '🔌 Încărcări' : '⛽ Alimentări'} ${esc(v?.name || '')}</h3>
    <ul class="list">${s.fuel.slice().reverse().slice(0, 50).map((e) => expenseRow(e)).join('') || '<li class="muted pad">Nimic încă.</li>'}</ul></section>
  <section class="card"><h3>🔢 ${t.meter === 'h' ? 'Ore de funcționare' : 'Kilometraj'}</h3>
    <ul class="list">${odo.slice(0, 50).map((o) => `<li class="row" data-action="edit-odometer" data-id="${esc(o.id)}">
      ${o.image ? `<img class="thumb" src="${imgURL(o)}" alt="">` : '<div class="thumb ph">🔢</div>'}
      <div class="grow"><div class="title">${num(o.km, 0)} ${unit}</div><div class="sub">${fmtDate(o.date)}${o.notes ? ' · ' + esc(o.notes) : ''}</div></div></li>`).join('') || '<li class="muted pad">Nicio citire.</li>'}</ul></section>`;
}

// Kilometrii din Google Timeline: doar totaluri pe zi, fără locuri
function renderTripsCard(vid) {
  const days = state.trips[vid];
  if (!days || !Object.keys(days).length) return '';
  const t = todayISO();
  const sum = (pred) => Object.entries(days).filter(([d]) => pred(d)).reduce((a, [, km]) => a + km, 0);
  const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const per = months.map((m) => ({ m, km: sum((d) => d.startsWith(m)) }));
  const max = Math.max(1, ...per.map((x) => x.km));
  return `<section class="card"><h3>🗺️ Drumuri (Google Timeline)</h3>
    <div class="stat-row mini"><div class="stat"><b>${num(sum((d) => d >= d30), 0)} km</b><span>ultimele 30 de zile</span></div><div class="stat"><b>${num(sum((d) => d.startsWith(t.slice(0, 4))), 0)} km</b><span>anul acesta</span></div></div>
    <div class="month-bars">${per.map((x) => `<div><span style="height:${Math.round(x.km / max * 100)}%"></span><small>${esc(x.m.slice(5))}</small><small>${num(x.km, 0)}</small></div>`).join('')}</div>
    <p class="muted small">Se păstrează doar km pe zi, fără locuri sau trasee.</p></section>`;
}

function renderRemindersCard(rems, vid = '') {
  const sorted = rems.slice().sort((a, b) => (a.done - b.done) || a.dueDate.localeCompare(b.dueDate));
  return `<section class="card"><div class="row-flex"><h3 class="grow">📅 Asigurări, ITP, expirări</h3>
    <button data-action="new-reminder" data-vehicle="${esc(vid)}">+ Adaugă</button></div>
    <ul class="list">${sorted.map(reminderRow).join('') || '<li class="muted pad">Adaugă data de expirare RCA, ITP, rovinietă… și primești notificare înainte.</li>'}</ul>
    ${vid ? '<button class="link" data-action="std-reminders">➕ Adaugă expirările obișnuite (extinctor, trusă, revizie, anvelope…)</button>' : ''}
    ${sorted.length ? '<button class="link" data-action="ics-all">📆 Adaugă toate în calendarul telefonului (.ics)</button>' : ''}
  </section>`;
}

function listCard(t) {
  const done = t.items.filter((i) => i.done).length;
  const proj = projById(t.projectId);
  return `<div class="task" data-id="${esc(t.id)}">
    <div class="row-flex"><div class="grow"><b>${esc(t.title)}</b>
      <div class="sub">${t.date ? fmtDate(t.date) : 'fără dată'}${proj ? ' · 📁 ' + esc(proj.name) : ''} · ${done}/${t.items.length}</div></div>
      <button data-action="edit-list" data-id="${esc(t.id)}">✏️</button></div>
    <ul class="checks">${t.items.map((i) => `<li><label><input type="checkbox" data-action="toggle-item" data-list="${esc(t.id)}" data-item="${esc(i.id)}" ${i.done ? 'checked' : ''}>
      <span class="${i.done ? 'done' : ''}">${esc(i.text)}</span></label></li>`).join('')}</ul>
    <form class="add-item" data-list="${esc(t.id)}"><input name="text" placeholder="+ adaugă" autocomplete="off"></form>
  </div>`;
}

function renderLists() {
  const now = todayISO();
  const isDone = (t) => t.items.length && t.items.every((i) => i.done);
  const active = state.tasks.filter((t) => !isDone(t));
  const groups = [
    ['Azi & restante', active.filter((t) => t.date && t.date <= now)],
    ['Următoarele zile', active.filter((t) => t.date && t.date > now)],
    ['Fără dată', active.filter((t) => !t.date)],
    ['Finalizate', state.tasks.filter(isDone)],
  ];
  return `<section class="quick one"><button class="big-btn" data-action="new-list">📝<span>Listă nouă (cumpărături / materiale / activități)</span></button></section>
  ${groups.filter(([, l]) => l.length).map(([name, l]) => `<section class="card"><h3>${name}</h3>
    ${l.sort((a, b) => (a.date || '9').localeCompare(b.date || '9')).map(listCard).join('')}</section>`).join('') || '<p class="muted center">Nicio listă încă.</p>'}`;
}

function renderSettings() {
  const perm = 'Notification' in window ? Notification.permission : 'indisponibil';
  return `
  <section class="card" id="set-categories"><div class="row-flex"><h3 class="grow">Categorii</h3><button data-action="new-category">+ Adaugă</button></div>
    <ul class="list">${categoryTree(state.categories).flatMap((p) => [p, ...p.children]).map((c) => `<li class="row ${c.parentId ? 'sub-row' : ''}" data-action="edit-category" data-id="${esc(c.id)}">
      <span class="dot big" style="background:${esc(c.color)}"></span><div class="grow">${c.parentId ? '↳ ' : ''}${esc(c.icon ? c.icon + ' ' : '')}${esc(c.name)}</div>
      <span class="muted small">${c.isFuel ? 'combustibil' : c.isCar ? 'mașină' : ''}</span></li>`).join('')}</ul></section>
  <section class="card"><div class="row-flex"><h3 class="grow">Proiecte</h3><button data-action="new-project">+ Adaugă</button></div>
    <p class="muted small">Fiecare casă, atelierul și fiecare vehicul au proiectul lor, cu iconiță pe ecranul principal.</p>
    <ul class="list">${state.projects.map((p) => `<li class="row" data-action="edit-project" data-id="${esc(p.id)}"><div class="grow">${esc(projIcon(p))} ${esc(p.name)} <span class="muted small">${esc(kindOf(p.kind).name)}</span></div></li>`).join('')}</ul></section>
  <section class="card"><div class="row-flex"><h3 class="grow">Mașini</h3><button data-action="new-vehicle">+ Adaugă</button></div>
    <ul class="list">${state.vehicles.map((v) => `<li class="row" data-action="edit-vehicle" data-id="${esc(v.id)}"><div class="grow">🚗 ${esc(v.name)} <span class="muted">${esc(v.plate || '')}</span></div></li>`).join('')}</ul></section>
  <section class="card"><h3>🧰 Inventar</h3>
    <p class="small muted">Produsele din aceste subcategorii intră automat în inventar când salvezi bonul:</p>
    <div class="checks-grid">${SUBCATS.filter((c) => c.key !== 'other').map((c) => `<label class="check"><input type="checkbox" data-action="inv-sub" data-sub="${c.key}" ${state.invSubs.includes(c.key) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div>
    <button data-action="export-inv-csv">⬇️ CSV inventar</button>
  </section>
  <section class="card"><h3>🏢 Verificare firme (ANAF)</h3>
    <p class="small">La fiecare bon cu CUI valid, aplicația ia automat de la ANAF denumirea oficială și adresa firmei (se trimite doar CUI-ul). Fiecare CUI e verificat o singură dată.</p>
    <p class="small">Stare: ${state.anafStatus ? (state.anafStatus.ok ? `<span class="ok-text">✓ funcționează</span> (ultima verificare ${esc(new Date(state.anafStatus.at).toLocaleString('ro-RO'))})` : `<span class="warn-text">⚠️ ANAF nu a răspuns</span> la ultima încercare (${esc(new Date(state.anafStatus.at).toLocaleString('ro-RO'))}); se folosesc datele de pe bon`) : 'încă nicio verificare'} · ${Object.keys(state.cuiCache).length} firme memorate</p>
  </section>
  <section class="card"><h3>Notificări</h3>
    <p class="small">Stare: <b>${esc(perm)}</b>. Aplicația verifică expirările la fiecare deschidere
    (și în fundal, pe Android, dacă este instalată pe ecranul principal). Pentru siguranță maximă, adaugă expirările și în calendarul telefonului (.ics).</p>
    <div class="row-flex wrap"><button class="primary" data-action="enable-notif">Activează notificările</button>
    <button data-action="test-notif">Test</button><button data-action="ics-all">📆 Export calendar (.ics)</button></div></section>
  <section class="card" id="set-export"><h3>Export / integrare</h3>
    <p class="small muted">CSV-ul se deschide în Excel și poate fi importat în programe de facturare / contabilitate. Backup-ul JSON conține tot, inclusiv pozele.</p>
    <div class="row-flex wrap">
      <button data-action="export-csv">⬇️ CSV cheltuieli</button>
      <button data-action="export-items-csv">⬇️ CSV produse</button>
      <button data-action="export-json">⬇️ Backup complet (JSON)</button>
      <button data-action="import-json">⬆️ Restaurare backup</button>
    </div></section>
  <section class="card"><h3>Zonă periculoasă</h3><button class="danger" data-action="wipe">Șterge toate datele</button></section>
  <p class="muted small center">Fiscan · versiunea ${APP_VERSION} · datele sunt salvate doar pe acest dispozitiv.</p>`;
}

// ---------- formular bon ----------
function openExpense(exp, { runOcr = false, ocrSource = null } = {}) {
  const isNew = !state.expenses.some((e) => e.id === exp.id);
  const cat = catById(exp.categoryId);
  const html = `
  <form id="exp-form" class="form">
    <div id="exp-photos"></div>
    <div id="ocr-status" class="ocr ${runOcr ? '' : 'hidden'}">🔍 Citesc bonul… <progress max="1" value="0"></progress></div>
    <div id="checks" class="checks hidden"></div>
    <div class="grid2">
      <label>Data<input name="date" type="date" value="${esc(exp.date)}" required></label>
      <label>Total (lei)<input name="total" inputmode="decimal" value="${esc(exp.total ?? '')}" required></label>
    </div>
    <label class="check"><input type="checkbox" name="isReturn" ${exp.isReturn ? 'checked' : ''}> ↩️ Retur (suma se scade din cheltuieli)</label>
    <div id="return-box" class="${exp.isReturn ? '' : 'hidden'}">
      <label>Bonul original (opțional)<select name="returnOf"></select></label>
    </div>
    <label>Magazin / furnizor<input name="store" value="${esc(exp.store)}"></label>
    <div id="supplier-line" class="supplier small"></div>
    <label>Proiect<select name="projectId">${projOptions(exp.projectId)}</select></label>
    <label>Categorie<select name="categoryId">${catOptions(exp.categoryId)}</select></label>
    <div id="car-block" class="${cat?.isCar || exp.vehicleId ? '' : 'hidden'}">
      <label>Mașina<select name="vehicleId">${options(state.vehicles, exp.vehicleId)}</select></label>
    </div>
    <fieldset id="fuel-block" class="${cat?.isFuel || exp.fuel?.liters || exp.fuel?.kwh ? '' : 'hidden'}"><legend id="fuel-legend">⛽ Alimentare</legend>
      <div class="seg small-seg" id="energy-seg">
        <button type="button" data-energy="fuel">⛽ Carburant</button><button type="button" data-energy="electric">🔌 Curent</button>
      </div>
      <div class="grid3 e-fuel">
        <label>Litri<input name="liters" inputmode="decimal" value="${esc(exp.fuel?.liters ?? '')}"></label>
        <label>Preț / L<input name="ppl" inputmode="decimal" value="${esc(exp.fuel?.pricePerLiter ?? '')}"></label>
        <label><span class="meter-label">Km la bord</span><input name="km" inputmode="numeric" value="${esc(exp.fuel?.km ?? '')}"></label>
      </div>
      <div class="grid3 e-elec">
        <label>kWh<input name="kwh" inputmode="decimal" value="${esc(exp.fuel?.kwh ?? '')}"></label>
        <label>Preț / kWh<input name="ppk" inputmode="decimal" value="${esc(exp.fuel?.pricePerKwh ?? '')}"></label>
        <label>Unde<select name="place"><option value="public" ${exp.fuel?.place === 'public' ? 'selected' : ''}>Stație publică</option><option value="home" ${exp.fuel?.place === 'home' ? 'selected' : ''}>Acasă</option></select></label>
      </div>
      <label class="e-fuel">Tip carburant<input name="fuelType" list="fuel-types" value="${esc(exp.fuel?.fuelType || '')}"></label>
      <datalist id="fuel-types"><option>benzină</option><option>motorină</option><option>GPL</option></datalist>
      <label>Notă drum (opțional)<input name="trip" maxlength="200" value="${esc(exp.fuel?.trip || '')}" placeholder="ex.: București – Brașov, cu remorca"></label>
    </fieldset>
    <details id="items-box" ${exp.items?.length || (!isNew && exp.image) ? 'open' : ''}><summary>🧾 Produse (<span id="items-count">0</span>) <span id="items-sum" class="muted small"></span></summary>
      <div id="items-list"></div>
      <div id="split-sum" class="small"></div>
      <div class="row-btns"><button type="button" id="item-add" class="link">+ Adaugă produs</button>
      ${state.projects.length > 1 ? '<button type="button" id="item-split" class="link">✂️ Împarte bonul pe proiecte</button>' : ''}</div>
    </details>
    <label>Notițe<textarea name="notes" rows="2">${esc(exp.notes)}</textarea></label>
    <details><summary>Text citit de pe bon</summary><textarea name="ocrText" rows="6">${esc(exp.ocrText)}</textarea></details>
    ${exp.image ? `<label class="check small"><input type="checkbox" name="hq" ${exp.hq ? 'checked' : ''}> 📸 Păstrează poza la calitate mare (pentru garanție) – automat la scule</label>
    <details class="copy-box"><summary>📤 Copie bon</summary>
      <div class="row-btns">
        <button type="button" data-copy="share">🖼️ Trimite pozele</button>
        <button type="button" data-copy="print">🖨️ PDF / tipărire</button>
      </div>
      <p class="muted small">„PDF / tipărire” deschide fereastra de tipărire; alege „Salvează ca PDF” ca să ai fișierul.</p>
    </details>` : ''}
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="danger" id="exp-del">Șterge</button>'}
      ${exp.image ? '<button type="button" id="exp-ocr">🔍 Recitește</button><button type="button" id="exp-more">➕ Continuare bon</button>' : '<button type="button" id="exp-photo">📷 Adaugă poză</button>'}
      <button class="primary">Salvează</button>
    </div>
  </form>`;

  openModal(isNew ? 'Bon nou' : 'Editează bon', html, (root) => {
    const form = $('#exp-form', root);
    const touched = new Set();
    form.addEventListener('input', (ev) => { touched.add(ev.target.name); ev.target.classList.remove('check'); });
    const syncBlocks = () => {
      const c = catById(form.categoryId.value);
      $('#car-block', root).classList.toggle('hidden', !(c?.isCar || form.vehicleId.value));
      $('#fuel-block', root).classList.toggle('hidden', !(c?.isFuel || form.liters.value || form.kwh.value));
      syncEnergy();
      if (c?.isCar && !form.vehicleId.value && state.vehicles.length) form.vehicleId.value = state.vehicleId || state.vehicles[0].id;
      if (c?.isCar && !form.projectId.value && !touched.has('projectId')) form.projectId.value = vehicleProject(form.vehicleId.value)?.id || '';
    };
    // carburant sau curent (electric / hibrid); la utilaje „ore motor” în loc de km
    let energy = exp.energyMode || (exp.fuel?.kwh ? 'electric' : exp.fuel?.liters ? 'fuel' : '');
    const syncEnergy = () => {
      const v = vehById(form.vehicleId.value);
      const t = typeOf(v?.type);
      const mode = energy || (t.energy === 'electric' ? 'electric' : 'fuel');
      root.querySelectorAll('.e-fuel').forEach((el) => el.classList.toggle('hidden', mode !== 'fuel'));
      root.querySelectorAll('.e-elec').forEach((el) => el.classList.toggle('hidden', mode !== 'electric'));
      $('#energy-seg', root).classList.toggle('hidden', !(t.energy === 'both' || !v));
      root.querySelectorAll('#energy-seg button').forEach((b) => b.classList.toggle('on', b.dataset.energy === mode));
      $('#fuel-legend', root).textContent = mode === 'electric' ? '🔌 Încărcare' : '⛽ Alimentare';
      $('.meter-label', root).textContent = t.meter === 'h' ? 'Ore motor' : 'Km la bord';
      // kilometrii se scriu și la încărcare: îi mutăm în grila vizibilă
      const kmLabel = form.km.closest('label');
      (mode === 'electric' ? root.querySelector('.e-elec') : root.querySelector('.e-fuel')).appendChild(kmLabel);
    };
    $('#energy-seg', root).addEventListener('click', (ev) => { const b = ev.target.closest('[data-energy]'); if (b) { energy = b.dataset.energy; syncEnergy(); } });
    syncEnergy();
    form.categoryId.addEventListener('change', syncBlocks);
    // mașina și proiectul ei merg împreună
    form.vehicleId.addEventListener('change', () => {
      const vp = vehicleProject(form.vehicleId.value);
      const cur = projById(form.projectId.value);
      if (vp && (!cur || cur.kind === 'vehicle')) form.projectId.value = vp.id;
      syncEnergy();
    });
    form.projectId.addEventListener('change', () => {
      touched.add('projectId');
      const p = projById(form.projectId.value);
      if (p?.vehicleId) { form.vehicleId.value = p.vehicleId; $('#car-block', root).classList.remove('hidden'); }
      updateItemsSum();
    });
    const recalc = () => {
      const l = toNum(form.liters.value); const p = toNum(form.ppl.value); const t = toNum(form.total.value);
      if (l && t && !touched.has('ppl')) form.ppl.value = (t / l).toFixed(2);
      else if (l && p && !t) form.total.value = (l * p).toFixed(2);
    };
    form.liters.addEventListener('change', recalc);
    const recalcKwh = () => {
      const k = toNum(form.kwh.value); const p = toNum(form.ppk.value); const t = toNum(form.total.value);
      if (k && t && !touched.has('ppk')) form.ppk.value = (t / k).toFixed(2);
      else if (k && p && !t) form.total.value = (k * p).toFixed(2);
    };
    form.kwh.addEventListener('change', recalcKwh);
    form.ppk.addEventListener('change', recalcKwh);
    form.total.addEventListener('change', recalc);

    // ---- firma: denumire oficială, CUI, adresă (verificate automat la ANAF)
    const renderSupplier = () => {
      const box = $('#supplier-line', root);
      if (!box) return;
      const parts = [];
      if (exp.supplierName) parts.push(`🏢 ${esc(exp.supplierName)}`);
      if (exp.cif) parts.push(`CUI ${esc(exp.cif)}${exp.cifValid ? '' : ' <span class="warn-text">⚠️ posibil citit greșit</span>'}`);
      if (exp.supplierAddress) parts.push(esc(exp.supplierAddress));
      if (exp.supplierSource === 'anaf') parts.push('<span class="ok-text">✓ ANAF</span>');
      box.innerHTML = parts.join(' · ');
    };
    const applySupplier = (info) => {
      if (!form.isConnected || !info?.name) return;
      exp.supplierName = info.name;
      exp.supplierAddress = info.address || '';
      exp.supplierSource = 'anaf';
      exp.cifValid = true;
      if (!touched.has('store')) form.store.value = findBrand(info.name) || shortCompanyName(info.name) || form.store.value;
      renderSupplier();
    };
    const verifySupplier = async (cif) => {
      const key = String(cif).toUpperCase().replace(/\s/g, '');
      const cached = state.cuiCache[key];
      if (cached?.ok && cached.name) return applySupplier(cached);
      // un răspuns negativ recent nu se mai încearcă 7 zile
      if (cached && Date.now() - cached.checkedAt < 7 * 864e5) return;
      // după o eroare de rețea nu mai încercăm 10 minute (bonuri adăugate unul după altul)
      if (state.anafStatus && !state.anafStatus.ok && Date.now() - state.anafStatus.at < 10 * 60e3) return;
      try {
        const info = await lookupCui(key);
        state.cuiCache = sanitizeCuiCache({ ...state.cuiCache, [key]: { ...info, checkedAt: Date.now() } });
        await db.put('meta', { id: 'cuiCache', data: state.cuiCache });
        await setAnafStatus(true);
        if (info.name) applySupplier(info);
      } catch {
        await setAnafStatus(false); // ANAF indisponibil: rămân datele de pe bon, fără să deranjăm
      }
    };
    renderSupplier();

    // ---- produse
    exp.items = (exp.items || []).map((i) => ({ ...i }));
    let itemsTouched = exp.items.length > 0;
    const subOptions = (sel) => SUBCATS.map((c) => `<option value="${c.key}" ${c.key === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const updateItemsSum = () => {
      const sum = exp.items.reduce((a, i) => a + (+i.amount || 0), 0);
      const t = toNum(form.total.value);
      $('#items-count', root).textContent = exp.items.length;
      const sgr = exp.items.filter((i) => i.sub === 'sgr').reduce((a, i) => a + (+i.amount || 0), 0);
      $('#items-sum', root).textContent = exp.items.length
        ? `· suma ${num(sum)}${t != null ? (Math.abs(Math.abs(sum) - Math.abs(t)) < 0.05 ? ' ✓ = total' : ` ≠ total ${num(t)}`) : ''}${sgr ? ` · ♻️ SGR ${num(sgr)}` : ''}` : '';
      const sp = $('#split-sum', root);
      if (sp) {
        const shares = expenseShares({ total: t || 0, projectId: form.projectId.value, items: exp.items });
        sp.innerHTML = shares.size > 1 ? '✂️ Împărțit: ' + [...shares].map(([pid, a]) => `${esc(projIcon(projById(pid)))} ${esc(projById(pid)?.name || 'fără proiect')} <b>${esc(money(a))}</b>`).join(' · ') : '';
      }
      renderChecks();
    };
    // ---- „De verificat”: ce ar putea fi citit greșit, arătat direct în formular
    const renderChecks = () => {
      const box = $('#checks', root);
      if (!box) return;
      const flags = expenseFlags({ ...readExpenseForm(form, exp), reviewed: false, createdAt: exp.createdAt });
      box.classList.toggle('hidden', !flags.length);
      const sum = exp.items.reduce((acc, i) => acc + (+i.amount || 0), 0);
      // lângă fiecare problemă: butonul care o rezolvă sau duce direct la câmpul de corectat
      const fixes = {
        'items-sum': `<button type="button" class="fix" data-fix="use-sum">✔ Folosește suma produselor (${Math.abs(sum).toFixed(2).replace('.', ',')})</button> <button type="button" class="fix" data-fix="total">✏️ Scriu eu totalul</button>`,
        paid: `<button type="button" class="fix" data-fix="use-paid">✔ Folosește suma plătită (${(+exp.paid || 0).toFixed(2).replace('.', ',')})</button> <button type="button" class="fix" data-fix="total">✏️ Scriu eu totalul</button>`,
        'total-est': '<button type="button" class="fix" data-fix="total">✏️ Verifică totalul</button>',
        'total-missing': '<button type="button" class="fix" data-fix="total">✏️ Scrie totalul</button>',
        'items-unknown': '<button type="button" class="fix" data-fix="items">🧾 Arată produsele</button>',
        'tool-doubt': '<button type="button" class="fix" data-fix="doubt">🔧 Arată produsul</button>',
        cif: '<button type="button" class="fix" data-fix="store">🏢 Verifică firma</button>',
        'cif-fixed': '<button type="button" class="fix" data-fix="store">🏢 Verifică firma</button>',
        'date-old': '<button type="button" class="fix" data-fix="date">📅 Corectează data</button>',
        'no-cat': '<button type="button" class="fix" data-fix="categoryId">📂 Alege categoria</button>',
      };
      box.innerHTML = flags.length ? `<strong>⚠️ De verificat</strong><ul>${flags.map((f) => `<li>${esc(f.text)}<div class="fixes">${fixes[f.key] || ''}</div></li>`).join('')}</ul>
        <label class="check"><input type="checkbox" id="exp-reviewed" ${exp.reviewed ? 'checked' : ''}> Am verificat, e în regulă</label>` : '';
    };
    $('#checks', root).addEventListener('change', (ev) => { if (ev.target.id === 'exp-reviewed') exp.reviewed = ev.target.checked; });
    const goTo = (el) => {
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1600);
      el.focus?.({ preventScroll: true });
    };
    const setTotal = (v) => {
      form.total.value = (exp.isReturn || form.isReturn.checked ? -Math.abs(v) : Math.abs(v)).toFixed(2);
      touched.add('total');
      exp.totalSource = '';
      exp.paid = null;
      form.total.classList.remove('check');
      updateItemsSum();
      goTo(form.total);
      toast('Total actualizat – apasă Salvează');
    };
    $('#checks', root).addEventListener('click', (ev) => {
      const fix = ev.target.closest('[data-fix]')?.dataset.fix;
      if (!fix) return;
      if (fix === 'use-sum') setTotal(exp.items.reduce((acc, i) => acc + (+i.amount || 0), 0));
      else if (fix === 'use-paid') setTotal(exp.paid);
      else if (fix === 'items') {
        $('#items-box', root).open = true;
        const row = [...root.querySelectorAll('.item-row')].find((r) => isUnknownItem(itemOf(r.firstElementChild) || {})) || $('#items-box', root);
        goTo(row.querySelector?.('.it-name') || row);
      } else if (fix === 'doubt') {
        $('#items-box', root).open = true;
        const row = [...root.querySelectorAll('.item-row')].find((r) => { const it = itemOf(r.firstElementChild); return it && ['tools', 'consumables'].includes(it.sub) && !it.confirmed && toolDoubt(it.name); });
        goTo(row?.querySelector('.it-sub') || $('#items-box', root));
      } else if (fix === 'store') goTo(form.store);
      else goTo(form[fix]);
    });
    // „Împarte bonul”: fiecare produs poate merge la alt proiect (ex. o parte pentru Casa Varlam)
    let split = exp.items.some((i) => i.projectId && i.projectId !== exp.projectId);
    const projSelect = (i) => (split ? `<select class="it-proj" aria-label="Proiectul produsului">${projOptions(i.projectId || '', '↳ ca bonul')}</select>` : '');
    $('#item-split', root)?.addEventListener('click', () => { split = !split; if (!split) exp.items.forEach((i) => { i.projectId = ''; }); renderItems(); });
    const renderItems = () => {
      $('#items-list', root).innerHTML = exp.items.map((i) => `<div class="item-row" data-id="${esc(i.id)}">
        ${projSelect(i)}
        <input class="it-name" value="${esc(i.name)}" aria-label="Produs">
        <input class="it-amount" inputmode="decimal" value="${esc(i.amount ?? '')}" aria-label="Sumă">
        <select class="it-sub" aria-label="Subcategorie">${subOptions(i.sub)}</select>
        <button type="button" class="it-del" aria-label="Șterge produsul">✕</button>
        ${itemMeta(i)}</div>`).join('')
        || (exp.image
          ? '<p class="small warn-box">Niciun produs citit. <button type="button" class="link" data-reread>🔍 Recitește bonul</button> – un bon salvat înainte de actualizare se citește din nou și apar produsele. Le poți adăuga și manual.</p>'
          : '<p class="muted small">Niciun produs citit. Le poți adăuga manual.</p>');
      updateItemsSum();
    };
    // „2 × 2,50 lei · ❓ neidentificat”: detaliile de sub fiecare produs
    const itemMeta = (i) => {
      const bits = [];
      if (i.qty != null && i.unitPrice != null && !(Math.abs(i.qty) === 1 && Math.abs(i.amount) === i.unitPrice)) bits.push(`${num(Math.abs(i.qty))} × ${num(i.unitPrice)} lei`);
      if (i.sub === 'sgr') bits.push('♻️ recuperabil la returnarea ambalajului');
      else if (['tools', 'consumables'].includes(i.sub) && !i.confirmed && toolDoubt(i.name)) bits.push('<span class="warn-text">🔧 sculă sau consumabil? alege subcategoria</span>');
      else if (isUnknownItem(i)) bits.push('<span class="warn-text">❓ neidentificat – corectează numele</span>');
      return bits.length ? `<span class="it-meta small muted">${bits.join(' · ')}</span>` : '';
    };
    const refreshMeta = (row, it) => {
      row.querySelector('.it-meta')?.remove();
      row.insertAdjacentHTML('beforeend', itemMeta(it));
    };
    const itemOf = (el) => exp.items.find((i) => i.id === el.closest('.item-row')?.dataset.id);
    $('#items-list', root).addEventListener('input', (ev) => {
      ev.stopPropagation();
      const it = itemOf(ev.target);
      if (!it) return;
      itemsTouched = true;
      if (ev.target.classList.contains('it-name')) it.name = ev.target.value;
      if (ev.target.classList.contains('it-amount')) { it.amount = toNum(ev.target.value); updateItemsSum(); }
    });
    $('#items-list', root).addEventListener('change', (ev) => {
      ev.stopPropagation();
      const it = itemOf(ev.target);
      if (!it) return;
      if (ev.target.classList.contains('it-sub')) { it.sub = ev.target.value; it.manualSub = true; it.confirmed = true; }
      if (ev.target.classList.contains('it-proj')) { it.projectId = ev.target.value; itemsTouched = true; updateItemsSum(); }
      if (ev.target.classList.contains('it-name') && !it.manualSub) {
        it.sub = classifyItem(it.name, state.itemRules);
        ev.target.closest('.item-row').querySelector('.it-sub').value = it.sub;
      }
      refreshMeta(ev.target.closest('.item-row'), it);
      renderChecks();
    });
    $('#items-list', root).addEventListener('click', (ev) => {
      if (!ev.target.classList.contains('it-del')) return;
      const it = itemOf(ev.target);
      exp.items = exp.items.filter((x) => x !== it);
      itemsTouched = true;
      renderItems();
    });
    $('#item-add', root).addEventListener('click', () => {
      exp.items.push({ id: db.uid(), name: '', qty: null, unitPrice: null, amount: null, sub: 'other' });
      itemsTouched = true;
      $('#items-box', root).open = true;
      renderItems();
      $('#items-list .item-row:last-child .it-name', root)?.focus();
    });
    form.total.addEventListener('input', () => { exp.totalSource = ''; updateItemsSum(); });
    form.addEventListener('change', renderChecks);

    // ---- retur
    const fillReturnOf = () => {
      const store = normalize(form.store.value);
      const cands = state.expenses.filter((e) => e.id !== exp.id && !e.isReturn)
        .sort((a, b) => (normalize(b.store) === store) - (normalize(a.store) === store) || b.date.localeCompare(a.date)).slice(0, 60);
      const cur = form.returnOf.value || exp.returnOf || '';
      form.returnOf.innerHTML = '<option value="">— nelegat —</option>' + cands.map((e) =>
        `<option value="${esc(e.id)}" ${e.id === cur ? 'selected' : ''}>${fmtDate(e.date)} · ${esc(e.store || '?')} · ${esc(money(e.total))}</option>`).join('');
    };
    const syncReturn = (autoLink = false) => {
      const on = form.isReturn.checked;
      $('#return-box', root).classList.toggle('hidden', !on);
      const t = toNum(form.total.value);
      if (t != null) form.total.value = (on ? -Math.abs(t) : Math.abs(t)).toFixed(2);
      exp.items.forEach((i) => { if (i.amount != null && on) i.amount = -Math.abs(i.amount); });
      if (on) {
        fillReturnOf();
        if (autoLink && !form.returnOf.value) {
          // cel mai recent bon de la același magazin, dinainte de retur
          const store = normalize(form.store.value);
          const orig = state.expenses.filter((e) => !e.isReturn && e.id !== exp.id && store && normalize(e.store) === store && e.date <= (form.date.value || '9'))
            .sort((a, b) => b.date.localeCompare(a.date))[0];
          if (orig) form.returnOf.value = orig.id;
        }
      }
      renderItems();
    };
    form.isReturn.addEventListener('change', () => syncReturn(true));
    // bon salvat fără produse, dar cu text citit: încercăm produsele din text (fără OCR din nou)
    if (!isNew && !exp.items.length && exp.ocrText) {
      exp.items = itemsFromText(exp.ocrText, exp.isReturn);
      itemsTouched = false;
    }
    renderItems();
    $('#items-list', root).addEventListener('click', (ev) => { if (ev.target.closest('[data-reread]')) doOcr(); });
    if (exp.isReturn) fillReturnOf();

    // Bonurile lungi: fiecare poză e citită separat, textele se lipesc în ordine
    // (magazin/dată/CUI din prima parte, totalul de obicei din ultima).
    exp.extraImages = exp.extraImages || [];
    // pozele originale (necomprimate) din această sesiune: folosite doar dacă bonul se păstrează la calitate mare
    const originals = [];
    if (ocrSource) originals[photosOf(exp).length - 1] = ocrSource;
    const partTexts = exp.ocrText ? exp.ocrText.split(PART_SEP) : [];
    const st = $('#ocr-status', root);
    let pending = 0;

    const renderPhotos = () => {
      const photos = photosOf(exp);
      const box = $('#exp-photos', root);
      if (!photos.length) { box.innerHTML = ''; return; }
      if (photos.length === 1) {
        box.innerHTML = `<a href="${blobURL(photos[0])}" target="_blank" rel="noopener noreferrer"><img class="preview" src="${blobURL(photos[0])}" alt="bon"></a>`;
      } else {
        box.innerHTML = `<div class="parts">${photos.map((b, i) => `<div class="part">
          <a href="${blobURL(b)}" target="_blank" rel="noopener noreferrer"><img src="${blobURL(b)}" alt="partea ${i + 1}"></a>
          <span>${i + 1}/${photos.length}</span>
          ${i > 0 ? `<button type="button" class="part-del" data-part="${i}" aria-label="Șterge partea ${i + 1}">✕</button>` : ''}
        </div>`).join('')}</div>`;
      }
      const more = $('#exp-more', root);
      if (more) more.disabled = photos.length >= MAX_PHOTOS;
    };

    const applyParse = () => {
      const text = partTexts.filter(Boolean).join(PART_SEP);
      form.ocrText.value = text;
      const r = parseReceipt(text, new Date(), { storeRules: state.storeRules });
      const set = (name, val) => { if (val != null && val !== '' && !touched.has(name)) form[name].value = val; };
      set('date', r.date);
      set('store', r.store);
      // proiectul obișnuit al magazinului (dacă bonul nu a fost pornit dintr-un proiect)
      if (!exp.fromProject && !touched.has('projectId')) {
        const pid = state.storeProjects[storeKey(form.store.value)];
        if (pid && projById(pid)) form.projectId.value = pid;
      }
      exp.cif = r.cif || exp.cif || '';
      exp.cifValid = !!r.cifValid;
      exp.cifRepaired = !!r.cifRepaired;
      exp.paid = r.paid ?? null;
      if (!touched.has('total')) exp.totalSource = r.totalSource || '';
      if (exp.supplierSource !== 'anaf') { exp.supplierName = r.storeOfficial || ''; exp.supplierSource = r.storeOfficial ? 'bon' : ''; }
      renderSupplier();
      if (r.cifValid) verifySupplier(r.cif);
      set('total', r.total != null ? r.total.toFixed(2) : '');
      if (!touched.has('isReturn') && r.isReturn !== form.isReturn.checked) { form.isReturn.checked = r.isReturn; }
      if (!itemsTouched) {
        exp.items = itemsFromText(text, r.isReturn);
        if (exp.items.length) $('#items-box', root).open = true;
      }
      // linia TOTAL ilizibilă: suma produselor e o estimare mai bună decât cea mai mare sumă de pe bon
      if (r.totalSource === 'estimat' && exp.items.length >= 2 && !touched.has('total')) {
        const sum = exp.items.reduce((acc, i) => acc + (+i.amount || 0), 0);
        if (sum) { form.total.value = sum.toFixed(2); r.total = sum; }
      }
      syncReturn(true);
      if (r.suggestedCategoryKey && !touched.has('categoryId')) {
        const c = state.categories.find((x) => x.key === r.suggestedCategoryKey);
        if (c) form.categoryId.value = c.id;
      }
      if (r.fuel) {
        set('liters', r.fuel.liters);
        set('ppl', r.fuel.pricePerLiter);
        set('fuelType', r.fuel.fuelType);
      }
      syncBlocks();
      // OCR-ul poate greși anul (ex. 2026 citit 2020): semnalăm datele vechi ca să fie verificate
      const old = form.date.value && (Date.now() - Date.parse(form.date.value)) / 864e5 > 60;
      form.date.classList.toggle('check', !!old);
      r.dateWarning = old ? ` ⚠️ Verifică data (${fmtDate(form.date.value)}) – pare veche.` : '';
      return r;
    };

    const ocrPart = async (index, source) => {
      const total = photosOf(exp).length;
      pending++;
      st.classList.remove('hidden');
      st.innerHTML = `🔍 Citesc ${total > 1 ? `partea ${index + 1} din ${total}` : 'bonul'}… <progress max="1" value="0"></progress>`;
      try {
        const text = await recognize(source, {
          onProgress: (status, p) => { const pr = $('progress', st); if (pr && status.includes('recogn')) pr.value = p; },
        });
        if (!form.isConnected) return;
        partTexts[index] = text;
        const r = applyParse();
        if (--pending === 0) {
          st.textContent = r.total != null
            ? `✅ Bon citit${total > 1 ? ` (${total} poze)` : ''}. Verifică valorile și salvează.${r.dateWarning}${total === 1 ? ' Bon lung? Apasă „➕ Continuare bon”.' : ''}${exp.items.length ? '' : ' ℹ️ Nu am găsit produse pe bon (poate e chitanța de la card). Dacă vrei produsele în analize și în inventar, adaugă-le în „🧾 Produse” sau fotografiază bonul fiscal.'}`
            : '⚠️ Nu am găsit totalul. Dacă bonul e lung, apasă „➕ Continuare bon” și fotografiază partea de jos. Sfat: bonul întins, fără umbre, cât mai aproape.';
        }
      } catch (err) {
        pending--;
        st.textContent = '⚠️ ' + (err.message || 'Eroare OCR') + ' Completează manual.';
      }
    };

    const doOcr = async () => {
      partTexts.length = 0;
      const photos = photosOf(exp);
      for (let i = 0; i < photos.length; i++) await ocrPart(i, i === 0 && ocrSource ? ocrSource : photos[i]);
    };

    renderPhotos();
    if (runOcr) {
      if (partTexts.length && exp.image) ocrPart(photosOf(exp).length - 1, ocrSource || exp.image);
      else doOcr();
    }
    $('#exp-ocr', root)?.addEventListener('click', doOcr);
    $('#exp-more', root)?.addEventListener('click', async () => {
      if (photosOf(exp).length >= MAX_PHOTOS) return toast(`Maxim ${MAX_PHOTOS} poze pe bon`);
      toast('Fotografiază următoarea parte, puțin suprapusă cu cea de dinainte');
      const f = await pickFile();
      if (!f) return;
      const img = await compressImage(f);
      if (!img) return;
      exp.extraImages.push(img);
      originals[photosOf(exp).length - 1] = f;
      renderPhotos();
      ocrPart(photosOf(exp).length - 1, f);
    });
    $('#exp-photos', root).addEventListener('click', (ev) => {
      const btn = ev.target.closest('.part-del');
      if (!btn) return;
      ev.preventDefault();
      const i = +btn.dataset.part;
      if (!confirm(`Ștergi partea ${i + 1}?`)) return;
      exp.extraImages.splice(i - 1, 1);
      partTexts.splice(i, 1);
      originals.splice(i, 1);
      renderPhotos();
      applyParse();
    });
    $('#exp-photo', root)?.addEventListener('click', async () => {
      const f = await pickFile();
      if (!f) return;
      const img = await compressImage(f);
      if (!img) return;
      exp.image = img;
      Object.assign(exp, readExpenseForm(form, exp));
      openExpense(exp, { runOcr: true, ocrSource: f });
    });
    $('.copy-box', root)?.addEventListener('click', async (ev) => {
      const kind = ev.target.closest('[data-copy]')?.dataset.copy;
      if (!kind) return;
      const cur = { ...readExpenseForm(form, exp), supplierName: exp.supplierName, supplierAddress: exp.supplierAddress };
      if (kind === 'share') {
        const r = await shareReceiptPhotos(cur, download);
        if (r === 'downloaded') toast('Pozele au fost descărcate');
      } else printReceipts([cur], { title: `Bon ${cur.store || ''}`.trim(), urlOf: blobURL });
    });
    $('#exp-del', root)?.addEventListener('click', async () => {
      const old = state.expenses.find((e) => e.id === exp.id);
      if (!(await remove('expenses', exp.id, 'bonul'))) return;
      if (old) await applyInventory(undoExpense(old, state.inventory));
      closeModal();
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const data = readExpenseForm(form, exp);
      if (data.total == null) { toast('Completează totalul'); return; }
      await learnSubcats(exp.items.filter((i) => i.manualSub));
      await learnNames(data.items);
      if (touched.has('store')) await learnStore(data);
      await learnStoreProject(data);
      await finishPhotos(data, originals, !!form.hq?.checked);
      if (!(await save('expenses', data))) return;
      closeModal();
      const saved = state.expenses.find((e) => e.id === data.id);
      const inv = saved ? await syncInventory(saved) : null;
      toast('Bon salvat ✔' + (inv || ''));
    });
  });
}

function readExpenseForm(form, exp) {
  const elec = !form.kwh.closest('.e-elec').classList.contains('hidden');
  const liters = elec ? null : toNum(form.liters.value);
  const kwh = elec ? toNum(form.kwh.value) : null;
  const km = toNum(form.km.value);
  const cat = catById(form.categoryId.value);
  const hasFuel = liters || kwh || cat?.isFuel;
  let total = toNum(form.total.value);
  const isReturn = form.isReturn.checked || (total != null && total < 0);
  if (total != null) total = isReturn ? -Math.abs(total) : Math.abs(total);
  const items = (exp.items || []).filter((i) => i.name.trim() && i.amount != null)
    .map(({ manualSub, ...i }) => ({ ...i, name: i.name.trim(), amount: isReturn ? -Math.abs(i.amount) : i.amount }));
  return {
    ...exp,
    date: form.date.value || todayISO(),
    total,
    isReturn,
    returnOf: isReturn ? form.returnOf.value : '',
    items,
    store: form.store.value.trim(),
    categoryId: form.categoryId.value,
    projectId: form.projectId.value,
    vehicleId: form.vehicleId.value,
    fuel: hasFuel ? {
      liters, pricePerLiter: elec ? null : toNum(form.ppl.value), km, fuelType: elec ? 'electric' : form.fuelType.value.trim(),
      kwh, pricePerKwh: elec ? toNum(form.ppk.value) : null, place: elec ? form.place.value : '', trip: form.trip.value.trim(),
    } : null,
    notes: form.notes.value.trim(),
    ocrText: form.ocrText.value,
    createdAt: exp.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

// ---------- inventar ----------
async function applyInventory(out) {
  if (!out.puts.length && !out.dels.length) return;
  for (const id of out.dels) await db.del('inventory', id);
  for (const x of out.puts) { const c = sanitize('inventory', x); if (c) await db.put('inventory', c); }
  state.inventory = (await db.getAll('inventory')).map((o) => sanitize('inventory', o)).filter(Boolean);
  sortState();
  render();
}

// După salvarea unui bon: sculele noi intră în inventar, retururile le scot. Returnează textul pentru mesaj.
async function syncInventory(e) {
  const out = syncFromExpense(e, state.inventory, { subs: state.invSubs, uid: db.uid });
  await applyInventory(out);
  const parts = [];
  if (out.added.length) {
    const dup = out.added.flatMap((a) => findSimilar(a.name, state.inventory, { excludeIds: out.added.map((x) => x.id) }).slice(0, 1).map((d) => d.name));
    parts.push(` · ${out.added.length} ${out.added.length === 1 ? 'sculă adăugată' : 'scule adăugate'} în inventar${dup.length ? ` (ai deja: ${dup.join(', ')})` : ''}`);
  }
  if (out.returned.length) parts.push(` · returnat din inventar: ${out.returned.map((x) => x.name).join(', ')}`);
  if (out.unmatched.length) parts.push(` · negăsit în inventar: ${out.unmatched.join(', ')}`);
  return parts.join('');
}

function invFiltered() {
  const f = state.invFilter;
  const q = normalize(f.q.trim());
  return state.inventory.filter((x) =>
    (f.status === 'all' || (f.status === 'owned' ? OWNED.has(x.status) : x.status === f.status)) &&
    (!f.loc || (x.location || '') === (f.loc === '—' ? '' : f.loc)) &&
    (!q || normalize(`${x.label} ${x.name} ${x.serial} ${x.location} ${x.lentTo} ${x.notes} ${x.store}`).includes(q)));
}

const daysSince = (d) => (d ? Math.max(0, Math.round((Date.parse(todayISO()) - Date.parse(d)) / 864e5)) : 0);

// Cardul unei scule: eticheta mare (B1), poza sau iconița, unde e și în ce stare
function toolCard(x) {
  const st = statusByKey(x.status);
  const warranty = x.warrantyUntil && x.warrantyUntil >= todayISO() && OWNED.has(x.status);
  return `<button class="tool-card st-${esc(x.status)}" data-action="edit-inv" data-id="${esc(x.id)}">
    <span class="tool-pic">${x.image ? `<img src="${imgURL(x)}" alt="" loading="lazy">` : '🔧'}${x.label ? `<span class="tool-label">${esc(x.label)}</span>` : ''}</span>
    <span class="tool-name">${esc(x.name)}${x.qty > 1 ? ` ×${esc(x.qty)}` : ''}</span>
    <span class="tool-sub">${x.status === 'lent' ? `🤝 la <b>${esc(x.lentTo || '?')}</b> · ${daysSince(x.lentDate)} zile` : esc(x.location || 'fără loc')}</span>
    <span class="tool-tags">${x.status !== 'avail' && x.status !== 'lent' ? `<span class="badge ${st.cls}">${esc(st.name)}</span>` : ''}${warranty ? '<span class="badge ok">🛡️ garanție</span>' : ''}</span>
  </button>`;
}

function renderInventory() {
  const f = state.invFilter;
  const list = invFiltered();
  const owned = state.inventory.filter((x) => OWNED.has(x.status));
  const count = owned.reduce((a, x) => a + (x.qty || 1), 0);
  const value = owned.reduce((a, x) => a + (x.price || 0) * (x.qty || 1), 0);
  const lent = owned.filter((x) => x.status === 'lent').sort((a, b) => (a.lentDate || '').localeCompare(b.lentDate || ''));
  const broken = owned.filter((x) => x.status === 'broken' || x.status === 'repair');
  const inWarranty = owned.filter((x) => x.warrantyUntil && x.warrantyUntil >= todayISO()).length;
  const locs = [...new Set(state.inventory.map((x) => x.location || ''))].sort();
  const groups = {};
  for (const x of list) (groups[x.location || ''] ||= []).push(x);
  const subsNames = state.invSubs.map((k) => subcatByKey(k).name).join(', ');
  return `<h2 class="view-title">🧰 Inventar</h2>
  <section class="stat-row">
    <div class="stat"><b>${count}</b><span>scule deținute</span></div>
    <div class="stat"><b>${money(value)}</b><span>valoare</span></div>
    <div class="stat ${lent.length ? 'warn' : ''}"><b>${lent.length}</b><span>împrumutate</span></div>
    <div class="stat"><b>${inWarranty}</b><span>în garanție</span></div>
  </section>
  ${lent.length ? `<section class="card"><h3>🤝 La cine sunt</h3><div class="tool-grid">${lent.map(toolCard).join('')}</div></section>` : ''}
  ${broken.length ? `<section class="card"><h3>🛠️ Stricate / la reparat</h3><div class="tool-grid">${broken.map(toolCard).join('')}</div></section>` : ''}
  <section class="card filters">
    <input id="i-q" type="search" placeholder="Caută sculă, etichetă (B1), serie, persoană…" value="${esc(f.q)}">
    <div class="grid2">
      <select id="i-status">
        <option value="owned" ${f.status === 'owned' ? 'selected' : ''}>Ce am (toate deținute)</option>
        ${INV_STATUSES.map((s2) => `<option value="${s2.key}" ${f.status === s2.key ? 'selected' : ''}>${esc(s2.name)}</option>`).join('')}
        <option value="all" ${f.status === 'all' ? 'selected' : ''}>Toate, inclusiv returnate</option>
      </select>
      <select id="i-loc"><option value="">Toate locurile</option>${locs.map((l) => `<option value="${esc(l || '—')}" ${f.loc === (l || '—') ? 'selected' : ''}>${esc(l || 'Fără loc')}</option>`).join('')}</select>
    </div>
    <div class="row-flex wrap"><button class="primary" data-action="new-inv">+ Adaugă sculă</button>
      <button data-action="inv-scan" title="Adaugă în inventar sculele de pe bonurile salvate deja">🔄 Din bonurile salvate</button></div>
    <p class="muted small">Se adaugă automat din bonuri: ${esc(subsNames)} – fiecare bucată separat, cu etichetă (B1, B2…). Consumabilele (discuri, burghie) nu intră aici, le vezi la Produse.</p>
  </section>
  ${Object.keys(groups).sort().map((loc) => `<section class="card"><h3>📍 ${esc(loc || 'Fără loc stabilit')} <span class="muted small">(${groups[loc].length})</span></h3>
    <div class="tool-grid">${groups[loc].map(toolCard).join('')}</div></section>`).join('')
    || `<p class="muted center">${state.inventory.length ? 'Nimic găsit.' : 'Inventarul e gol. Sculele intră automat din <b>produsele</b> bonurilor (chitanța de la card nu are produse). Deschide bonul și adaugă produsul în „🧾 Produse”, sau apasă „+ Adaugă sculă” și alege bonul.'}</p>`}`;
}

// Fișa sculei: etichetă, serie, împrumut / înapoiere cu stare, istoric, garanție cu copia bonului, consumabile potrivite
function openInventory(x) {
  const isNew = !state.inventory.some((i) => i.id === x.id);
  if (isNew && !x.label && x.name) x.label = nextLabel(x.name, state.inventory);
  const locs = [...new Set(['Garaj', 'Casă', 'Mașină', 'Șantier', 'Atelier', 'Magazie', ...state.inventory.map((i) => i.location).filter(Boolean)])];
  const people = [...new Set(state.inventory.flatMap((i) => [(i.lentTo || ''), ...(i.loans || []).map((l) => l.to)]).filter(Boolean))];
  const exp = x.expenseId ? state.expenses.find((e) => e.id === x.expenseId) : null;
  const today = todayISO();
  const wLeft = x.warrantyUntil ? Math.round((Date.parse(x.warrantyUntil) - Date.parse(today)) / 864e5) : null;
  const cons = x.name ? consumablesFor(x.name) : [];
  openModal(isNew ? 'Sculă nouă' : `${x.label ? x.label + ' · ' : ''}${x.name}`, `
  <form id="inv-form" class="form">
    ${x.image ? `<img class="preview" src="${imgURL(x)}" alt="">` : ''}
    <div class="grid-label">
      <label>Etichetă<input name="label" value="${esc(x.label || '')}" maxlength="7" placeholder="B1" autocapitalize="characters"></label>
      <label>Denumire<input name="name" value="${esc(x.name)}" required placeholder="ex.: Bormașină Bosch"></label>
    </div>
    <p class="muted small">Scrie eticheta pe sculă (marker / autocolant): așa știi exact care dintre două scule la fel s-a întors.</p>
    <div id="inv-dup" class="ocr hidden"></div>
    <label>Serie (de pe plăcuța sculei)<input name="serial" value="${esc(x.serial || '')}" placeholder="ex.: 3 601 H80 000"></label>
    ${isNew ? '' : `<section class="loan-box">
      ${x.status === 'lent' ? `<p>🤝 Împrumutată lui <b>${esc(x.lentTo || '?')}</b> din ${fmtDate(x.lentDate)} (${daysSince(x.lentDate)} zile)</p>
        <div class="grid2"><label>Adusă înapoi la<input type="date" id="back-date" value="${esc(today)}"></label>
        <label>În ce stare<select id="back-state">${RETURN_STATES.map((r) => `<option value="${r.key}">${esc(r.name)}</option>`).join('')}</select></label></div>
        <input id="back-note" placeholder="Observații (ex.: lipsește acumulatorul)">
        <button type="button" class="primary" id="do-return">↩️ A adus-o înapoi</button>`
      : OWNED.has(x.status) ? `<div class="grid2"><label>Împrumut lui<input id="lend-to" list="lend-people" placeholder="Ion"></label>
        <label>Din data<input type="date" id="lend-date" value="${esc(today)}"></label></div>
        <datalist id="lend-people">${people.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
        <button type="button" id="do-lend">🤝 Împrumută</button>` : ''}
      ${(x.loans || []).length ? `<details><summary>Istoric împrumuturi (${x.loans.length})</summary><ul class="loan-list">${[...x.loans].reverse().map((l) => `<li><b>${esc(l.to)}</b> · ${fmtDate(l.from)} → ${l.back ? fmtDate(l.back) : '<i>încă la el</i>'}${l.state ? ` · ${esc(RETURN_STATES.find((r) => r.key === l.state)?.name || '')}` : ''}${l.note ? ` · ${esc(l.note)}` : ''}</li>`).join('')}</ul></details>` : ''}
    </section>`}
    <section class="warranty-box ${wLeft != null && wLeft >= 0 ? 'ok' : ''}">
      <b>🛡️ Garanție</b> ${x.warrantyUntil ? (wLeft >= 0 ? `până la ${fmtDate(x.warrantyUntil)} · mai sunt ${wLeft} zile` : `expirată din ${fmtDate(x.warrantyUntil)}`) : 'nestabilită'}
      ${exp ? `<div class="row-flex wrap"><button type="button" id="w-copy">📤 Copie bon pentru garanție</button><button type="button" id="w-share">🖼️ Trimite poza bonului</button></div>` : '<p class="small muted">Alege bonul de cumpărare mai jos ca să ai dovada pentru garanție.</p>'}
    </section>
    <div class="grid2">
      <label>Unde se află<input name="location" list="inv-locs" value="${esc(x.location || '')}" placeholder="Garaj"></label>
      <label>Stare<select name="status">${INV_STATUSES.map((s2) => `<option value="${s2.key}" ${s2.key === x.status ? 'selected' : ''}>${esc(s2.name)}</option>`).join('')}</select></label>
    </div>
    <datalist id="inv-locs">${locs.map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
    <div id="lent-box" class="grid2 ${x.status === 'lent' ? '' : 'hidden'}">
      <label>Împrumutată lui<input name="lentTo" value="${esc(x.lentTo || '')}"></label>
      <label>Din data<input name="lentDate" type="date" value="${esc(x.lentDate || '')}"></label>
    </div>
    <div class="grid2">
      <label>Cumpărată la<input name="purchaseDate" type="date" value="${esc(x.purchaseDate || '')}"></label>
      <label>Preț (lei)<input name="price" inputmode="decimal" value="${esc(x.price ?? '')}"></label>
    </div>
    <div class="grid2">
      <label>Magazin<input name="store" value="${esc(x.store || '')}"></label>
      <label>Garanție până la<input name="warrantyUntil" type="date" value="${esc(x.warrantyUntil || '')}"></label>
    </div>
    <label>Subcategorie<select name="sub">${SUBCATS.map((c) => `<option value="${c.key}" ${c.key === x.sub ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label>Notițe (accesorii, baterii…)<textarea name="notes" rows="2">${esc(x.notes || '')}</textarea></label>
    <label>Bonul de cumpărare (dovadă pentru garanție)<select name="expenseId">
      <option value="">— fără bon —</option>
      ${state.expenses.filter((e) => !e.isReturn).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 150).map((e) =>
        `<option value="${esc(e.id)}" ${e.id === x.expenseId ? 'selected' : ''}>${fmtDate(e.date)} · ${esc(e.store || '?')} · ${esc(money(e.total))}</option>`).join('')}
    </select></label>
    ${exp ? `<p><button type="button" class="link" data-action="edit-expense" data-id="${esc(exp.id)}">🧾 Vezi bonul (${fmtDate(exp.date)} · ${esc(exp.store || '')} · ${money(exp.total)})</button></p>` : ''}
    ${cons.length ? `<details class="cons-box"><summary>🔩 Consumabile potrivite (${cons.length})</summary><ul class="loan-list">${cons.map((g) => `<li><b>${esc(g.name)}</b> · ${num(g.qty)} buc. · ultima ${fmtDate(g.last?.date)} ${esc(g.last?.store || '')}</li>`).join('')}</ul></details>` : ''}
    ${(x.returns || []).length ? `<p class="muted small">↩️ Returnată la magazin</p>` : ''}
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="danger" id="inv-del">Șterge</button>'}
      <button type="button" id="inv-photo">📷 ${x.image ? 'Schimbă poza' : 'Poză'}</button>
      <button class="primary">Salvează</button>
    </div>
  </form>`, (root) => {
    const form = $('#inv-form', root);
    const persist = async (next, msg) => { if (await save('inventory', { ...readInv(form, x), ...next })) { closeModal(); toast(msg); } };
    $('#do-lend', root)?.addEventListener('click', () => {
      const to = $('#lend-to', root).value.trim();
      if (!to) { toast('Scrie cui o împrumuți'); $('#lend-to', root).focus(); return; }
      const cur = readInv(form, x);
      persist(lendTool(cur, to, $('#lend-date', root).value || today), `🤝 ${cur.label || cur.name} împrumutată lui ${to}`);
    });
    $('#do-return', root)?.addEventListener('click', () => {
      const cur = readInv(form, x);
      const stt = $('#back-state', root).value;
      persist(returnTool({ ...cur, status: 'lent', lentTo: x.lentTo, lentDate: x.lentDate }, $('#back-date', root).value || today, stt, $('#back-note', root).value.trim()),
        stt === 'ok' ? '↩️ Adusă înapoi, în regulă' : `↩️ Adusă înapoi: ${RETURN_STATES.find((r) => r.key === stt).name.toLowerCase()}`);
    });
    $('#w-copy', root)?.addEventListener('click', () => printReceipts([exp], { title: `Garanție ${x.label ? x.label + ' · ' : ''}${x.name}`, urlOf: blobURL }));
    $('#w-share', root)?.addEventListener('click', async () => { const r = await shareReceiptPhotos(exp, download); if (r === 'none') toast('Bonul nu are poză'); else if (r === 'downloaded') toast('Poza bonului a fost descărcată'); });
    form.status.addEventListener('change', () => {
      $('#lent-box', root).classList.toggle('hidden', form.status.value !== 'lent');
      if (form.status.value === 'lent' && !form.lentDate.value) form.lentDate.value = today;
    });
    const dupCheck = () => {
      const d = findSimilar(form.name.value, state.inventory, { excludeIds: [x.id] });
      const box = $('#inv-dup', root);
      box.classList.toggle('hidden', !d.length);
      box.textContent = d.length ? `⚠️ Ai deja: ${d.slice(0, 3).map((i) => `${i.label ? i.label + ' ' : ''}${i.name}${i.location ? ' (' + i.location + ')' : ''}`).join(', ')}` : '';
      if (isNew && !form.label.dataset.touched) form.label.value = nextLabel(form.name.value, state.inventory);
    };
    form.label.addEventListener('input', () => { form.label.dataset.touched = '1'; });
    form.name.addEventListener('change', dupCheck);
    if (isNew && x.name) dupCheck();
    form.expenseId.addEventListener('change', () => {
      const e = state.expenses.find((i) => i.id === form.expenseId.value);
      if (!e) return;
      if (!form.purchaseDate.value) form.purchaseDate.value = e.date;
      if (!form.store.value) form.store.value = e.store || '';
      if (!form.warrantyUntil.value && e.date) form.warrantyUntil.value = addMonths(e.date, WARRANTY_MONTHS);
    });
    form.purchaseDate.addEventListener('change', () => {
      if (!form.warrantyUntil.value && form.purchaseDate.value) form.warrantyUntil.value = addMonths(form.purchaseDate.value, WARRANTY_MONTHS);
    });
    $('#inv-photo', root).addEventListener('click', async () => {
      const f = await pickFile();
      if (!f) return;
      const img = await compressImage(f, 1200);
      if (!img) return;
      Object.assign(x, readInv(form, x), { image: img });
      openInventory(x);
    });
    $('#inv-del', root)?.addEventListener('click', async () => { if (await remove('inventory', x.id, 'scula din inventar')) closeModal(); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const data = readInv(form, x);
      if (data.label && state.inventory.some((i) => i.id !== x.id && i.label === data.label && OWNED.has(i.status)) && !confirm(`Eticheta ${data.label} e folosită deja la altă sculă. Păstrezi?`)) return;
      if (!(await save('inventory', data))) return;
      closeModal();
      toast('Salvat în inventar ✔');
    });
  });
}

// Consumabilele cumpărate care se potrivesc cu o sculă (disc 125 → polizor 125)
function consumablesFor(toolName) {
  const seen = new Map();
  for (const e of state.expenses) for (const i of e.items || []) if (i.amount > 0 && fits(i.name, toolName)) seen.set(productKey(i.name), i.name);
  return [...seen.values()].flatMap((n) => productSituation(n, state.expenses).slice(0, 1)).filter((g, k, a) => a.findIndex((y) => y.key === g.key) === k);
}
// Sculele tale pentru care e bun un consumabil
const toolsFor = (name) => state.inventory.filter((x) => OWNED.has(x.status) && fits(name, x.name));

function readInv(form, x) {
  const status = form.status.value;
  const label = form.label.value.trim().toUpperCase().replace(/\s+/g, '');
  return {
    ...x,
    name: form.name.value.trim(),
    label: /^[A-Z]{1,3}\d{1,4}$/.test(label) ? label : '',
    serial: form.serial.value.trim(),
    qty: x.qty || 1,
    location: form.location.value.trim(),
    status,
    lentTo: status === 'lent' ? form.lentTo.value.trim() : '',
    lentDate: status === 'lent' ? form.lentDate.value : '',
    purchaseDate: form.purchaseDate.value,
    price: toNum(form.price.value),
    store: form.store.value.trim(),
    warrantyUntil: form.warrantyUntil.value,
    sub: form.sub.value,
    notes: form.notes.value.trim(),
    expenseId: form.expenseId.value,
    itemId: form.expenseId.value === x.expenseId ? x.itemId : '',
    edited: true,
    createdAt: x.createdAt || Date.now(),
  };
}

// Adaugă în inventar sculele de pe bonurile salvate înainte (cumpărările întâi, apoi retururile).
async function scanInventory() {
  const sorted = state.expenses.slice().sort((a, b) => (a.isReturn - b.isReturn) || a.date.localeCompare(b.date));
  let added = 0;
  let returned = 0;
  for (const e of sorted) {
    const out = syncFromExpense(e, state.inventory, { subs: state.invSubs, uid: db.uid });
    added += out.added.length;
    returned += out.returned.length;
    await applyInventory(out);
  }
  toast(added || returned ? `Inventar actualizat: +${added} adăugate, ${returned} returnate` : 'Nimic nou de adăugat din bonuri');
}

function exportInventoryCSV() {
  const n = (v) => (v == null || v === '' ? '' : String(+v).replace('.', ','));
  const head = ['Denumire', 'Bucati', 'Loc', 'Stare', 'Imprumutata lui', 'Din data', 'Data cumparare', 'Pret/buc', 'Magazin', 'Garantie pana la', 'Subcategorie', 'Note'];
  const rows = state.inventory.map((x) => [csvCell(x.name), n(x.qty), csvCell(x.location), csvCell(statusByKey(x.status).name), csvCell(x.lentTo), csvCell(x.lentDate),
    csvCell(x.purchaseDate), n(x.price), csvCell(x.store), csvCell(x.warrantyUntil), csvCell(subcatByKey(x.sub).name), csvCell(x.notes)].join(';'));
  download(new Blob(['\ufeff' + [head.join(';'), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' }), `fiscan-inventar-${todayISO()}.csv`);
}

// Ai corectat numele magazinului pe un bon cu CUI: data viitoare același CUI primește același nume.
async function learnStore(e) {
  const cif = parseReceipt(e.ocrText || '').cif;
  if (!cif || !e.store) return;
  state.storeRules = sanitizeStoreRules({ ...state.storeRules, [cif]: e.store });
  await db.put('meta', { id: 'storeRules', rules: state.storeRules });
}

async function setAnafStatus(ok) {
  state.anafStatus = { ok, at: Date.now() };
  await db.put('meta', { id: 'anafStatus', ...state.anafStatus });
}

// Ține minte la ce proiect merg de obicei bonurile unui magazin.
async function learnStoreProject(e) {
  const key = storeKey(e.store);
  if (!key || !e.projectId || state.storeProjects[key] === e.projectId) return;
  state.storeProjects = sanitizeStoreProjects({ ...state.storeProjects, [key]: e.projectId });
  await db.put('meta', { id: 'storeProjects', data: state.storeProjects });
}

// Ține minte numele corectate: data viitoare produsul cu același cod de bare
// (sau aceleași cuvinte citite) apare direct cu numele bun.
async function learnNames(items) {
  const names = { ...state.itemNames };
  let changed = false;
  for (const i of items) {
    if (!i.ocrName || i.name === i.ocrName) continue;
    const key = i.ean ? 'ean ' + i.ean : itemKey(i.ocrName);
    if (key && names[key] !== i.name) { names[key] = i.name; changed = true; }
  }
  if (!changed) return;
  state.itemNames = sanitizeItemNames(names);
  await db.put('meta', { id: 'itemNames', data: state.itemNames });
}

// Ține minte subcategoriile alese manual: data viitoare același produs e încadrat la fel.
async function learnSubcats(items) {
  if (!items.length) return;
  const rules = { ...state.itemRules };
  for (const i of items) {
    const key = itemKey(i.name);
    if (i.ean) rules['ean ' + i.ean] = i.sub;
    if (!key) continue;
    if (i.sub === classifyItem(i.name)) delete rules[key];
    else rules[key] = i.sub;
  }
  state.itemRules = sanitizeRules(rules);
  await db.put('meta', { id: 'itemRules', rules: state.itemRules });
}

// Pozele bonului: calitate mare doar când contează (scule / garanție / bifat), altfel rămân ușoare.
// Plus o miniatură mică pentru liste, ca aplicația să rămână rapidă și cu mii de bonuri.
async function finishPhotos(data, originals, wanted) {
  const hq = wanted || data.items.some((i) => i.sub === 'tools' || state.invSubs.includes(i.sub));
  data.hq = hq;
  if (hq) {
    for (const [i, f] of originals.entries()) {
      if (!f) continue;
      const big = await compressRaw(f, 2400, 0.88).catch(() => null);
      if (!big) continue;
      if (i === 0) data.image = big; else if (data.extraImages?.[i - 1]) data.extraImages[i - 1] = big;
    }
  }
  if (data.image && (!data.thumb || originals.some(Boolean))) data.thumb = await makeThumb(data.image);
}
const makeThumb = (blob) => compressRaw(blob, 240, 0.6).catch(() => null);

// Bonurile mai vechi primesc miniatura pe rând, în fundal, fără să blocheze aplicația.
async function backfillThumbs() {
  const todo = state.expenses.filter((e) => e.image && !e.thumb).map((e) => e.id);
  for (const id of todo) {
    await new Promise((r) => setTimeout(r, 30));
    const raw = await db.get('expenses', id);
    if (!raw?.image || raw.thumb) continue;
    const thumb = await makeThumb(raw.image);
    if (!thumb) continue;
    await db.put('expenses', { ...raw, thumb });
    const e = state.expenses.find((x) => x.id === id);
    if (e) e.thumb = thumb;
  }
}

// Produsele din textul citit, cu numele și subcategoriile învățate din corecturi.
function itemsFromText(text, isReturn) {
  return parseItems(text, { isReturn }).map((i) => {
    // numele corectat data trecută (după codul de bare sau după primele cuvinte citite)
    const name = (i.ean && state.itemNames['ean ' + i.ean]) || state.itemNames[itemKey(i.name)] || i.name;
    return { id: db.uid(), ...i, ocrName: i.name, name, sub: classifyItem(name, state.itemRules, i.ean) };
  });
}

function newExpense(extra = {}) {
  let lastProj = '';
  try { lastProj = localStorage.getItem('lastProject') || ''; } catch { /* ignoră */ }
  return { id: db.uid(), date: todayISO(), total: null, store: '', categoryId: '', projectId: projById(lastProj) ? lastProj : '', vehicleId: '', notes: '', ocrText: '', image: null, ...extra };
}

async function photoReceipt(capture = true, extra = {}) {
  const f = await pickFile({ capture });
  if (!f) return;
  const image = await compressImage(f);
  if (!image) return;
  openExpense(newExpense({ image, ...extra }), { runOcr: true, ocrSource: f });
}

// Bon pornit din ecranul unui proiect: intră direct în proiect (și la mașina lui).
function projectExtra(el) {
  if (el?.dataset?.project === undefined) return {};
  const p = projById(el.dataset.project);
  return { projectId: p?.id || '', vehicleId: p?.vehicleId || '', fromProject: true };
}
async function savePantry(p) {
  state.pantry = sanitizePantry(p);
  await db.put('meta', { id: 'pantry', data: state.pantry });
  render();
}
function savePeriod() { try { localStorage.setItem('period', JSON.stringify(state.period)); } catch { /* ignoră */ } }

// ---------- kilometraj ----------
function openOdometer(o, { runOcr = false } = {}) {
  const isNew = !state.odometer.some((x) => x.id === o.id);
  openModal(isNew ? 'Kilometraj' : 'Editează kilometraj', `
  <form id="odo-form" class="form">
    ${o.image ? `<img class="preview" src="${imgURL(o)}" alt="bord">` : ''}
    <div id="ocr-status" class="ocr ${runOcr ? '' : 'hidden'}">🔍 Citesc cifrele…</div>
    <label>Vehiculul<select name="vehicleId" required>${options(state.vehicles, o.vehicleId, '— alege —')}</select></label>
    <div class="grid2">
      <label>Data<input name="date" type="date" value="${esc(o.date)}" required></label>
      <label>${meterUnit(vehById(o.vehicleId)) === 'h' ? 'Ore motor' : 'Km'}<input name="km" inputmode="numeric" value="${esc(o.km ?? '')}" required></label>
    </div>
    <label>Notițe<input name="notes" value="${esc(o.notes || '')}"></label>
    <div class="actions">${isNew ? '' : '<button type="button" class="danger" id="odo-del">Șterge</button>'}<button class="primary">Salvează</button></div>
  </form>`, (root) => {
    const form = $('#odo-form', root);
    if (runOcr) {
      recognize(o.image, { digits: true }).then((text) => {
        const km = parseOdometer(text);
        if (!form.isConnected) return;
        if (km && !form.km.value) form.km.value = km;
        $('#ocr-status', root).textContent = km ? `✅ Am citit ${km} km. Verifică!` : '⚠️ Nu am putut citi cifrele. Introdu manual.';
      }).catch((e) => { $('#ocr-status', root).textContent = '⚠️ ' + e.message; });
    }
    $('#odo-del', root)?.addEventListener('click', async () => { if (await remove('odometer', o.id, 'citirea')) closeModal(); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const km = toNum(form.km.value);
      if (!km) return toast('Introdu kilometrii');
      if (!(await save('odometer', { ...o, vehicleId: form.vehicleId.value, date: form.date.value, km, notes: form.notes.value.trim() }))) return;
      closeModal();
      toast('Kilometraj salvat ✔');
    });
  });
}

// ---------- fișa tehnică, istoricul pentru vânzare, drumuri ----------
const fmtN = (n, d = 0) => (n == null || n === '' ? '' : num(n, d));
function sheetRows(rows) {
  const r = rows.filter(([, val]) => val !== '' && val != null);
  return r.length ? `<table>${r.map(([k, val]) => `<tr><td>${esc(k)}</td><td class="n">${esc(val)}</td></tr>`).join('')}</table>` : '';
}

// Fișa tehnică: se face din datele salvate, doar când ai nevoie (tipărire sau „Salvează ca PDF”)
function printVehicleSheet(v) {
  if (!v) return;
  const t = typeOf(v.type);
  const s = vehicleStats(v.id);
  const u = t.meter === 'h' ? 'ore' : 'km';
  const rems = state.reminders.filter((r) => r.vehicleId === v.id && !r.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const docs = (v.docs || []).map((d) => `<figure><img src="${blobURL(d.image)}" alt=""><figcaption>${d.kind === 'tyre' ? 'Eticheta anvelope / presiuni' : d.kind === 'oil' ? 'Eticheta ulei / service' : 'Document'}</figcaption></figure>`).join('');
  printPage(`Fișă tehnică · ${v.name}`, `${t.icon} ${t.name}`, `<article class="p-receipt">
    <h2>Identificare</h2>${sheetRows([['Număr înmatriculare', v.plate], ['Marca', v.make], ['Model', v.model], ['An fabricație', v.year || ''], ['Prima înmatriculare', v.firstReg ? fmtDate(v.firstReg) : ''], ['Categorie', v.category], ['VIN', v.vin]])}
    <h2>Motor</h2>${sheetRows([['Combustibil', v.fuelType], ['Cilindree', v.engineCc ? `${v.engineCc} cm³` : ''], ['Putere', v.powerKw ? `${fmtN(v.powerKw, 1)} kW (${Math.round(v.powerKw * 1.36)} CP)` : ''], ['Baterie', v.batteryKwh ? `${fmtN(v.batteryKwh, 1)} kWh` : '']])}
    <h2>Roți și anvelope</h2>${sheetRows([['Anvelope', v.tyreSize], ['Anvelope iarnă', v.tyreSizeWinter], ['Presiune față', v.pressureFront ? `${fmtN(v.pressureFront, 1)} bar` : ''], ['Presiune spate', v.pressureRear ? `${fmtN(v.pressureRear, 1)} bar` : ''], ['Strângere roți', v.wheelTorque]])}
    <h2>Întreținere</h2>${sheetRows([['Ulei motor', v.oilType], ['Cantitate ulei', v.oilLiters ? `${fmtN(v.oilLiters, 1)} L` : ''], ['Revizie la', `${fmtN(v.serviceKm || SERVICE_DEFAULTS[v.type || 'car'])} ${u}${v.serviceMonths ? ` sau ${v.serviceMonths} luni` : ''}`], ['La bord acum', s.lastKm != null ? `${fmtN(s.lastKm)} ${u}` : ''], ['Consum mediu', s.consumption ? `${fmtN(s.consumption, 1)} L/100 km` : s.kwh100 ? `${fmtN(s.kwh100, 1)} kWh/100 km` : '']])}
    ${v.notes ? `<p><i>${esc(v.notes)}</i></p>` : ''}
    ${rems.length ? `<h2>Expirări</h2>${sheetRows(rems.map((r) => [r.title || r.type, `${fmtDate(r.dueDate)}${r.dueKm ? ` / ${fmtN(r.dueKm)} ${u}` : ''}`]))}` : ''}
    <div class="p-photos">${docs}</div>
  </article>`);
}

// Istoricul pentru vânzare: km în timp, service și reparații, fără datele proprietarului
function openSaleHistory(v) {
  if (!v) return;
  openModal('📜 Istoric pentru vânzare', `
  <form id="hist-form" class="form">
    <p class="small">Un document pentru cumpărător: evoluția kilometrajului, reviziile și reparațiile, cu dovezi. Nu conține numele tău, adresa sau notițele personale.</p>
    <label class="check"><input type="checkbox" name="amounts" checked> Cu sumele plătite</label>
    <label class="check"><input type="checkbox" name="photos"> Cu pozele bonurilor de service</label>
    <label class="check"><input type="checkbox" name="plate" checked> Cu numărul de înmatriculare</label>
    <label class="check"><input type="checkbox" name="fuel"> Cu lista alimentărilor</label>
    <div class="actions"><button class="primary">📄 Fă documentul (PDF / tipărire)</button></div>
  </form>`, (root) => {
    const form = $('#hist-form', root);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const opt = { amounts: form.amounts.checked, photos: form.photos.checked, plate: form.plate.checked, fuel: form.fuel.checked };
      closeModal();
      printSaleHistory(v, opt);
    });
  });
}

function printSaleHistory(v, opt) {
  const t = typeOf(v.type);
  const u = t.meter === 'h' ? 'ore' : 'km';
  const s = vehicleStats(v.id);
  // un punct pe lună (cel mai mare km citit în luna respectivă)
  const byMonth = new Map();
  for (const r of s.readings) { const m = r.date.slice(0, 7); if (!byMonth.has(m) || byMonth.get(m).km < r.km) byMonth.set(m, r); }
  const timeline = [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
  const kmAt = (date) => { let k = null; for (const r of s.readings) if (r.date <= date) k = r.km; return k; };
  const service = vehicleExpenses(v.id).filter((e) => !isFuelExpense(e, state)).sort((a, b) => a.date.localeCompare(b.date));
  const total = service.reduce((a, e) => a + (+e.total || 0), 0);
  const fuelRows = opt.fuel ? s.fuel.map((e) => [fmtDate(e.date), `${e.fuel?.liters ? fmtN(e.fuel.liters, 2) + ' L' : e.fuel?.kwh ? fmtN(e.fuel.kwh, 1) + ' kWh' : ''}${e.fuel?.km ? ` · ${fmtN(e.fuel.km)} ${u}` : ''}${opt.amounts ? ` · ${money(e.total)}` : ''}`]) : [];
  const desc = [v.make, v.model, v.year].filter(Boolean).join(' ') || v.name;
  printPage(`Istoric vehicul · ${desc}`, `${opt.plate && v.plate ? v.plate + ' · ' : ''}${v.vin ? 'VIN ' + v.vin : ''}`, `<article class="p-receipt">
    <h2>Kilometraj în timp</h2>
    ${timeline.length ? `<table>${timeline.map((r) => `<tr><td>${esc(fmtDate(r.date))}</td><td class="n">${esc(fmtN(r.km))} ${u}</td></tr>`).join('')}</table>` : '<p>Nicio citire salvată.</p>'}
    ${s.consumption || s.kwh100 ? `<p>Consum mediu: <b>${esc(s.consumption ? fmtN(s.consumption, 1) + ' L/100 km' : fmtN(s.kwh100, 1) + ' kWh/100 km')}</b></p>` : ''}
    <h2>Revizii, reparații și piese (${service.length})</h2>
    ${service.length ? `<table>${service.map((e) => `<tr><td>${esc(fmtDate(e.date))}${kmAt(e.date) != null ? `<br><small>${esc(fmtN(kmAt(e.date)))} ${u}</small>` : ''}</td>
      <td><b>${esc(e.store || '')}</b>${catById(e.categoryId) ? ` · ${esc(catLabel(catById(e.categoryId)))}` : ''}${(e.items || []).length ? `<br><small>${esc(e.items.map((i) => i.name).slice(0, 12).join(', '))}</small>` : ''}</td>
      ${opt.amounts ? `<td class="n">${esc(money(e.total))}</td>` : ''}</tr>`).join('')}</table>
      ${opt.amounts ? `<p>Total întreținere: <b>${esc(money(total))}</b></p>` : ''}` : '<p>Nicio cheltuială de service salvată.</p>'}
    ${fuelRows.length ? `<h2>Alimentări (${fuelRows.length})</h2>${sheetRows(fuelRows)}` : ''}
    ${opt.photos ? `<div class="p-photos">${service.flatMap((e) => [e.image, ...(e.extraImages || [])].filter(Boolean)).map((b) => `<img src="${blobURL(b)}" alt="">`).join('')}</div>` : ''}
    <p><small>Document generat din bonurile și citirile de kilometraj salvate în aplicație. Nu conține date personale ale proprietarului.</small></p>
  </article>`);
}

// Import Google Timeline: fișierul e citit doar pe telefon; se păstrează km cu mașina pe fiecare zi
function importTimeline(v) {
  if (!v) return;
  openModal('🗺️ Drumuri din Google Timeline', `
  <div class="form">
    <p class="small">Pe telefon: <b>Setări → Locație → Cronologie → Exportă datele cronologiei</b> (sau din Google Takeout, „Istoricul locațiilor”). Alege aici fișierul <code>.json</code>.</p>
    <p class="small">Fișierul e citit doar pe telefon, nu se trimite nicăieri. Din el păstrăm <b>doar kilometrii parcurși cu mașina în fiecare zi</b> – fără locuri, adrese sau trasee.</p>
    <input type="file" id="tl-file" accept="application/json,.json">
    <div id="tl-status" class="ocr hidden"></div>
  </div>`, (root) => {
    $('#tl-file', root).addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      const st = $('#tl-status', root);
      st.classList.remove('hidden');
      if (!file) return;
      if (file.size > 300e6) { st.textContent = '⚠️ Fișier prea mare.'; return; }
      st.textContent = '🔍 Citesc…';
      try {
        const days = parseTimeline(JSON.parse(await file.text()));
        const n = Object.keys(days).length;
        if (!n) { st.textContent = 'ℹ️ Nu am găsit drumuri cu mașina în fișier.'; return; }
        const trips = sanitizeTrips({ ...state.trips, [v.id]: { ...(state.trips[v.id] || {}), ...days } });
        await db.put('meta', { id: 'trips', data: trips });
        state.trips = trips;
        const km = Object.values(days).reduce((a, x) => a + x, 0);
        closeModal();
        render();
        toast(`🗺️ ${n} zile cu drumuri, ${num(km, 0)} km importați`);
      } catch { st.textContent = '⚠️ Fișierul nu pare un export Timeline (.json).'; }
    });
  });
}

async function needVehicle() {
  if (state.vehicles.length) return true;
  toast('Adaugă întâi o mașină');
  openVehicle({ id: db.uid(), name: '', plate: '' });
  return false;
}

// ---------- remindere ----------
function openReminder(r) {
  const isNew = !state.reminders.some((x) => x.id === r.id);
  openModal(isNew ? 'Expirare nouă' : 'Editează expirare', `
  <form id="rem-form" class="form">
    <div class="grid2">
      <label>Tip<select name="type">${REMINDER_TYPES.map((t) => `<option ${t === r.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Expiră la<input name="dueDate" type="date" value="${esc(r.dueDate)}" required></label>
    </div>
    <label>Denumire (opțional)<input name="title" value="${esc(r.title || '')}" placeholder="ex.: RCA Allianz"></label>
    <label>Vehiculul<select name="vehicleId">${options(state.vehicles, r.vehicleId, '— general —')}</select></label>
    <label id="km-box" class="${r.type === 'Revizie' || r.dueKm ? '' : 'hidden'}">Sau la kilometrajul / orele<input name="dueKm" inputmode="numeric" value="${esc(r.dueKm ?? '')}" placeholder="ex.: 135000"></label>
    <label>Anunță-mă cu câte zile înainte<input name="notifyDays" value="${esc((r.notifyDays || [30, 7, 1]).join(', '))}"></label>
    <label>Notițe (poliță, asigurator, cost)<textarea name="notes" rows="2">${esc(r.notes || '')}</textarea></label>
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="danger" id="rem-del">Șterge</button><button type="button" id="rem-ics">📆 Calendar</button><button type="button" id="rem-renew">🔄 Reînnoit</button>'}
      <button class="primary">Salvează</button>
    </div>
  </form>`, (root) => {
    const form = $('#rem-form', root);
    const read = () => ({
      ...r,
      type: form.type.value,
      title: form.title.value.trim() || form.type.value,
      dueDate: form.dueDate.value,
      vehicleId: form.vehicleId.value,
      notifyDays: form.notifyDays.value.split(/[,; ]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0),
      notes: form.notes.value.trim(),
      dueKm: toNum(form.dueKm.value),
      notified: r.dueDate === form.dueDate.value && r.dueKm === toNum(form.dueKm.value) ? (r.notified || []) : [],
    });
    form.type.addEventListener('change', () => $('#km-box', root).classList.toggle('hidden', form.type.value !== 'Revizie' && !form.dueKm.value));
    $('#rem-del', root)?.addEventListener('click', async () => { if (await remove('reminders', r.id, 'expirarea')) closeModal(); });
    $('#rem-ics', root)?.addEventListener('click', () => downloadICS([read()], 'expirare.ics'));
    $('#rem-renew', root)?.addEventListener('click', () => {
      const v = vehById(form.vehicleId.value);
      if (form.type.value === 'Anvelope') {
        const n = renewTyre({ dueDate: form.dueDate.value, title: form.title.value });
        form.dueDate.value = n.dueDate; form.title.value = n.title;
        return toast(`Următorul schimb: ${n.title.toLowerCase()} (${fmtDate(n.dueDate)}). Salvează.`);
      }
      if (form.type.value === 'Revizie') {
        // revizia făcută azi: următoarea peste un an sau peste intervalul de km
        const km = v ? vehicleStats(v.id).lastKm : null;
        form.dueDate.value = addYears(todayISO(), 1);
        if (km != null) form.dueKm.value = km + (v.serviceKm || SERVICE_DEFAULTS[v.type || 'car']);
        return toast('Următoarea revizie calculată de azi. Verifică și salvează.');
      }
      const years = form.type.value === 'ITP' ? 2 : 1;
      form.dueDate.value = addYears(form.dueDate.value, years);
      toast(`Data mutată cu ${years} an${years > 1 ? 'i' : ''}. Verifică și salvează.`);
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!(await save('reminders', read()))) return;
      closeModal();
      toast('Salvat ✔');
      checkReminders();
    });
  });
}

function icsDate(s) { return s.replace(/-/g, ''); }
function downloadICS(reminders, filename = 'expirari.ics') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const events = reminders.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate)).map((r) => {
    const v = vehById(r.vehicleId);
    const [y, m, d] = r.dueDate.split('-').map(Number);
    const next = new Date(y, m - 1, d + 1);
    const end = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
    const what = icsText(r.title || r.type);
    const alarms = (r.notifyDays?.length ? r.notifyDays : [30, 7, 1]).map((n) =>
      `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:${what}\r\nTRIGGER:-P${Math.max(0, Math.round(+n || 0))}DT0H\r\nEND:VALARM`).join('\r\n');
    return `BEGIN:VEVENT\r\nUID:${icsText(r.id)}@bonuri-app\r\nDTSTAMP:${stamp}\r\nDTSTART;VALUE=DATE:${icsDate(r.dueDate)}\r\nDTEND;VALUE=DATE:${end}\r\n` +
      `SUMMARY:Expiră ${what}${v ? icsText(' – ' + v.name + (v.plate ? ' ' + v.plate : '')) : ''}\r\n` +
      `DESCRIPTION:${icsText(r.notes)}\r\n${alarms}\r\nEND:VEVENT`;
  }).join('\r\n');
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Bonuri si Masina//RO\r\nCALSCALE:GREGORIAN\r\n${events}\r\nEND:VCALENDAR\r\n`;
  download(new Blob([ics], { type: 'text/calendar' }), filename);
}

async function notify(n) {
  const opts = { body: n.body, tag: n.key, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  const reg = await navigator.serviceWorker?.getRegistration?.();
  if (reg) return reg.showNotification(n.title, opts);
  return new Notification(n.title, opts);
}

async function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const kmNow = Object.fromEntries(state.vehicles.map((v) => [v.id, vehicleStats(v.id).lastKm]).filter(([, k]) => k != null));
  const due = RC.dueNotifications(state.reminders, new Date(), kmNow);
  for (const n of due) {
    try { await notify(n); } catch { /* ignoră */ }
    const r = state.reminders.find((x) => x.id === n.id);
    r.notified = [...(r.notified || []), n.key];
    await db.put('reminders', r);
  }
}

async function enableNotifications() {
  if (!('Notification' in window)) return toast('Browserul nu suportă notificări');
  const p = await Notification.requestPermission();
  if (p === 'granted') {
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg?.periodicSync) {
        const st = await navigator.permissions.query({ name: 'periodic-background-sync' }).catch(() => null);
        if (!st || st.state === 'granted') await reg.periodicSync.register('check-reminders', { minInterval: 12 * 3600 * 1000 });
      }
    } catch { /* nu e suportat */ }
    toast('Notificări activate ✔');
    checkReminders();
  } else toast('Notificările au fost refuzate din setările browserului');
  render();
}

// ---------- liste ----------
function openList(t) {
  const isNew = !state.tasks.some((x) => x.id === t.id);
  openModal(isNew ? 'Listă nouă' : 'Editează lista', `
  <form id="list-form" class="form">
    <label>Titlu<input name="title" value="${esc(t.title)}" placeholder="ex.: Materiale pentru fundație" required></label>
    <div class="grid2">
      <label>Pentru data<input name="date" type="date" value="${esc(t.date || '')}"></label>
      <label>Proiect<select name="projectId">${options(state.projects, t.projectId)}</select></label>
    </div>
    <label>Ce ai de cumpărat / făcut (câte unul pe rând)<textarea name="items" rows="8" placeholder="10 saci ciment&#10;pâine&#10;schimb ulei">${esc(t.items.map((i) => i.text).join('\n'))}</textarea></label>
    <div class="actions">${isNew ? '' : '<button type="button" class="danger" id="list-del">Șterge</button>'}<button class="primary">Salvează</button></div>
  </form>`, (root) => {
    const form = $('#list-form', root);
    $('#list-del', root)?.addEventListener('click', async () => { if (await remove('tasks', t.id, 'lista')) closeModal(); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const lines = form.items.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const items = lines.map((text) => t.items.find((i) => i.text === text) || { id: db.uid(), text, done: false });
      if (!(await save('tasks', { ...t, title: form.title.value.trim(), date: form.date.value, projectId: form.projectId.value, items, createdAt: t.createdAt || Date.now() }))) return;
      closeModal();
      toast('Listă salvată ✔');
    });
  });
}

// ---------- categorii / proiecte / mașini ----------
function openCategory(c) {
  const isNew = !state.categories.some((x) => x.id === c.id);
  openModal(isNew ? 'Categorie nouă' : 'Editează categoria', `
  <form id="cat-form" class="form">
    <label>Nume<input name="name" value="${esc(c.name)}" required></label>
    <label>Face parte din (subcategorie)<select name="parentId" ${state.categories.some((x) => x.parentId === c.id) ? 'disabled' : ''}>
      <option value="">— categorie principală —</option>${state.categories.filter((x) => !x.parentId && x.id !== c.id).map((x) => `<option value="${esc(x.id)}" ${x.id === c.parentId ? 'selected' : ''}>${esc(x.icon || '')} ${esc(x.name)}</option>`).join('')}</select></label>
    <label>Iconiță (emoji, opțional)<input name="icon" value="${esc(c.icon || '')}" maxlength="8" placeholder="ex.: 🧸"></label>
    <label>Culoare<input name="color" type="color" value="${esc(c.color || '#607d8b')}"></label>
    <label class="check"><input type="checkbox" name="isCar" ${c.isCar ? 'checked' : ''}> Ține de mașină</label>
    <label class="check"><input type="checkbox" name="isFuel" ${c.isFuel ? 'checked' : ''}> Este combustibil (cere litri / km)</label>
    <div class="actions">${isNew ? '' : '<button type="button" class="danger" id="cat-del">Șterge</button>'}<button class="primary">Salvează</button></div>
  </form>`, (root) => {
    const form = $('#cat-form', root);
    $('#cat-del', root)?.addEventListener('click', async () => {
      const used = state.expenses.filter((e) => e.categoryId === c.id).length;
      if (used && !confirm(`${used} bonuri folosesc categoria. Rămân fără categorie. Continui?`)) return;
      if (await remove('categories', c.id, 'categoria')) closeModal();
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const isFuel = form.isFuel.checked;
      if (!(await save('categories', { ...c, name: form.name.value.trim(), color: form.color.value, isFuel, isCar: form.isCar.checked || isFuel, order: c.order ?? state.categories.length,
        parentId: form.parentId.disabled ? '' : form.parentId.value, icon: form.icon.value.trim() }))) return;
      closeModal();
    });
  });
}

function openProject(p) {
  const isNew = !state.projects.some((x) => x.id === p.id);
  const total = projectExpenses(state.expenses, p.id, { from: '', to: '' }).reduce((a, r) => a + r.share, 0);
  const kind = p.kind || 'house';
  const icon = p.icon || kindOf(kind).icon;
  openModal(isNew ? 'Proiect nou' : 'Editează proiectul', `
  <form id="proj-form" class="form">
    ${isNew ? '' : `<p>Total cheltuit (toată perioada): <b>${money(total)}</b></p>`}
    <label>Nume<input name="name" value="${esc(p.name)}" required placeholder="ex.: Casa București"></label>
    <label>Tip<select name="kind">${PROJECT_KINDS.map((k) => `<option value="${k.key}" ${k.key === kind ? 'selected' : ''}>${k.icon} ${esc(k.name)}</option>`).join('')}</select></label>
    <div class="icon-pick" role="radiogroup" aria-label="Iconiță">${PROJECT_ICONS.map((i) => `<button type="button" class="ip ${i === icon ? 'on' : ''}" data-icon="${i}" aria-label="${i}">${i}</button>`).join('')}</div>
    <div class="color-pick" role="radiogroup" aria-label="Culoare">${PROJECT_COLORS.map((c) => `<button type="button" class="cp ${c === p.color ? 'on' : ''}" data-color="${c}" style="background:${c}" aria-label="culoare"></button>`).join('')}</div>
    ${state.vehicles.length ? `<label>Vehiculul proiectului (opțional)<select name="vehicleId">${options(state.vehicles, p.vehicleId || '', '— niciunul —')}</select></label>` : ''}
    <label>Buget (opțional)<input name="budget" inputmode="decimal" value="${esc(p.budget ?? '')}"></label>
    <label>Notițe<textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></label>
    <div class="actions">${isNew ? '' : '<button type="button" class="danger" id="proj-del">Șterge</button>'}<button class="primary">Salvează</button></div>
  </form>`, (root) => {
    const form = $('#proj-form', root);
    let pickedIcon = icon;
    let pickedColor = p.color || '';
    $('.icon-pick', root).addEventListener('click', (ev) => {
      const b = ev.target.closest('.ip'); if (!b) return;
      pickedIcon = b.dataset.icon;
      root.querySelectorAll('.ip').forEach((x) => x.classList.toggle('on', x === b));
    });
    $('.color-pick', root).addEventListener('click', (ev) => {
      const b = ev.target.closest('.cp'); if (!b) return;
      pickedColor = b.dataset.color;
      root.querySelectorAll('.cp').forEach((x) => x.classList.toggle('on', x === b));
    });
    form.kind.addEventListener('change', () => {
      pickedIcon = kindOf(form.kind.value).icon;
      root.querySelectorAll('.ip').forEach((x) => x.classList.toggle('on', x.dataset.icon === pickedIcon));
    });
    $('#proj-del', root)?.addEventListener('click', async () => {
      const used = state.expenses.filter((e) => expenseShares(e).has(p.id)).length;
      if (used && !confirm(`${bonuri(used)} sunt în acest proiect. Bonurile rămân, dar fără proiect. Continui?`)) return;
      if (await remove('projects', p.id, 'proiectul')) { closeModal(); if (state.projectId === p.id) { state.view = 'home'; render(); } }
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const data = { ...p, name: form.name.value.trim(), kind: form.kind.value, icon: pickedIcon, color: pickedColor,
        vehicleId: form.vehicleId ? form.vehicleId.value : (p.vehicleId || ''), budget: toNum(form.budget.value), notes: form.notes.value.trim(),
        order: p.order ?? state.projects.length };
      if (!(await save('projects', data))) return;
      closeModal();
    });
  });
}

function openVehicle(v) {
  const isNew = !state.vehicles.some((x) => x.id === v.id);
  v.docs = v.docs || [];
  const t = typeOf(v.type);
  const docImg = (kind) => v.docs.find((d) => d.kind === kind)?.image;
  const f = (name, label, attrs = '') => `<label>${label}<input name="${name}" value="${esc(v[name] ?? '')}" ${attrs}></label>`;
  openModal(isNew ? 'Vehicul nou' : 'Editează vehiculul', `
  <form id="veh-form" class="form">
    <label>Tip<select name="type">${VEHICLE_TYPES.map((x) => `<option value="${x.key}" ${x.key === (v.type || 'car') ? 'selected' : ''}>${x.icon} ${esc(x.name)}</option>`).join('')}</select></label>
    ${f('name', 'Nume', 'required placeholder="ex.: Dacia Logan"')}
    <div class="ocr-box">
      <button type="button" id="veh-ocr">📷 Citește din talon / cartea de identitate (CIV)</button>
      <p class="muted small">Se citesc doar datele mașinii (număr, marcă, model, VIN, motor). Numele și adresa proprietarului nu se citesc, iar poza talonului nu se păstrează.</p>
      <div id="veh-ocr-status" class="ocr hidden"></div>
    </div>
    <fieldset><legend>Identificare</legend>
      <div class="grid2">${f('plate', 'Număr înmatriculare', 'placeholder="B 123 ABC"')}${f('firstReg', 'Prima înmatriculare', 'type="date"')}</div>
      <div class="grid2">${f('make', 'Marca')}${f('model', 'Model')}</div>
      <div class="grid2">${f('year', 'An fabricație', 'inputmode="numeric"')}${f('category', 'Categorie (J)', 'placeholder="M1"')}</div>
      <label>VIN / serie șasiu<input name="vin" value="${esc(v.vin || '')}" maxlength="17" autocapitalize="characters"></label>
      <div class="row-flex wrap"><button type="button" id="vin-decode" class="link">🌐 Completează după VIN (bază de date gratuită NHTSA)</button></div>
    </fieldset>
    <fieldset><legend>Motor</legend>
      <div class="grid3">
        <label class="v-fuel">Combustibil<input name="fuelType" list="fuel-types2" value="${esc(v.fuelType || '')}"></label>
        ${f('engineCc', 'Cilindree (cm³)', 'inputmode="numeric"')}${f('powerKw', 'Putere (kW)', 'inputmode="decimal"')}
      </div>
      <label class="v-bat">Baterie (kWh)<input name="batteryKwh" inputmode="decimal" value="${esc(v.batteryKwh ?? '')}"></label>
      <datalist id="fuel-types2"><option>benzină</option><option>motorină</option><option>GPL</option><option>hibrid</option><option>electric</option></datalist>
    </fieldset>
    <fieldset><legend>Roți și anvelope</legend>
      <div class="grid2">${f('tyreSize', 'Anvelope (vară / toate)', 'placeholder="205/55 R16"')}${f('tyreSizeWinter', 'Anvelope iarnă', 'placeholder="195/65 R15"')}</div>
      <div class="grid3">${f('pressureFront', 'Presiune față (bar)', 'inputmode="decimal"')}${f('pressureRear', 'Presiune spate (bar)', 'inputmode="decimal"')}${f('wheelTorque', 'Strângere roți', 'placeholder="110 Nm"')}</div>
      <div class="doc-row">${docImg('tyre') ? `<img class="thumb" src="${blobURL(docImg('tyre'))}" alt="eticheta anvelope">` : ''}<button type="button" data-doc="tyre">📷 Eticheta de pe ușa șoferului</button></div>
    </fieldset>
    <fieldset><legend>Întreținere</legend>
      <div class="grid2">${f('oilType', 'Ulei motor', 'placeholder="5W-30 C3"')}${f('oilLiters', 'Cantitate ulei (L)', 'inputmode="decimal"')}</div>
      <div class="grid2">
        <label><span class="svc-label">Revizie la fiecare (km)</span><input name="serviceKm" inputmode="numeric" value="${esc(v.serviceKm ?? '')}" placeholder="${esc(SERVICE_DEFAULTS[v.type || 'car'])}"></label>
        ${f('serviceMonths', 'sau la fiecare (luni)', 'inputmode="numeric" placeholder="12"')}
      </div>
      <div class="doc-row">${docImg('oil') ? `<img class="thumb" src="${blobURL(docImg('oil'))}" alt="eticheta ulei">` : ''}<button type="button" data-doc="oil">📷 Eticheta de ulei / service</button></div>
      <label>Notițe tehnice<textarea name="notes" rows="2">${esc(v.notes || '')}</textarea></label>
    </fieldset>
    <div class="actions">${isNew ? '' : '<button type="button" class="danger" id="veh-del">Șterge</button>'}<button class="primary">Salvează</button></div>
  </form>`, (root) => {
    const form = $('#veh-form', root);
    const st = $('#veh-ocr-status', root);
    const syncType = () => {
      const tt = typeOf(form.type.value);
      root.querySelectorAll('.v-bat').forEach((el) => el.classList.toggle('hidden', tt.energy === 'fuel'));
      $('.svc-label', root).textContent = tt.meter === 'h' ? 'Revizie la fiecare (ore)' : 'Revizie la fiecare (km)';
      form.serviceKm.placeholder = String(SERVICE_DEFAULTS[tt.key]);
    };
    form.type.addEventListener('change', syncType);
    syncType();
    const fill = (data, label) => {
      const got = [];
      for (const [k, val] of Object.entries(data)) {
        const el = form[k];
        if (!el || val == null || val === '' || el.value) continue;
        el.value = val;
        got.push(k);
      }
      if (data.fuelType === 'electric' && form.type.value === 'car') form.type.value = 'electric';
      if (data.fuelType === 'hibrid' && form.type.value === 'car') form.type.value = 'hybrid';
      syncType();
      st.classList.remove('hidden');
      st.textContent = got.length ? `✅ ${label}: am completat ${got.length} câmpuri. Verifică-le.` : `ℹ️ ${label}: nimic nou de completat (câmpurile goale se completează, cele scrise rămân).`;
    };
    $('#veh-ocr', root).addEventListener('click', async () => {
      const file = await pickFile();
      if (!file) return;
      st.classList.remove('hidden');
      st.textContent = '🔍 Citesc talonul…';
      try {
        const text = await recognize(file, { onProgress: () => {} });
        const data = parseRegistration(text);
        if (!v.name && !form.name.value && (data.make || data.model)) form.name.value = [data.make, data.model].filter(Boolean).join(' ');
        fill(data, 'Talon');
      } catch (e) { st.textContent = '⚠️ ' + (e.message || 'Nu am putut citi poza'); }
    });
    $('#vin-decode', root).addEventListener('click', async () => {
      const vin = cleanVin(form.vin.value);
      if (!vin) return toast('Scrie întâi VIN-ul (17 caractere)');
      form.vin.value = vin;
      st.classList.remove('hidden');
      st.textContent = '🌐 Caut VIN-ul…';
      try {
        const data = await decodeVin(vin);
        if (!data) { st.textContent = 'ℹ️ Baza de date nu are informații pentru acest VIN (e mai completă pentru mașini vândute în SUA).'; return; }
        fill(data, 'VIN');
      } catch { st.textContent = '⚠️ Nu am putut accesa baza de date VIN. Completează manual.'; }
    });
    root.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', async () => {
      const kind = b.dataset.doc;
      const file = await pickFile();
      if (!file) return;
      const img = await compressImage(file, 1600);
      if (!img) return;
      Object.assign(v, readVeh(form, v));
      v.docs = [...v.docs.filter((d) => d.kind !== kind), { kind, image: img }];
      if (kind === 'tyre' || kind === 'oil') {
        // încercăm să citim și valorile de pe etichetă
        recognize(file).then((text) => {
          if (!form.isConnected) return;
          if (kind === 'tyre') fill(parseTyreSticker(text), 'Eticheta anvelope');
          else { const m = text.toUpperCase().match(/\b(\d{1,2}W[- ]?\d{2})\b/); if (m) fill({ oilType: m[1].replace(' ', '-') }, 'Eticheta ulei'); }
        }).catch(() => {});
      }
      openVehicle(v);
    }));
    $('#veh-del', root)?.addEventListener('click', async () => { if (await remove('vehicles', v.id, 'vehiculul')) closeModal(); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      state.vehicleId = v.id;
      const data = readVeh(form, v);
      if (data.vin && !validVin(data.vin)) { toast('VIN-ul are 17 caractere, fără I, O, Q'); form.vin.focus(); return; }
      if (!(await save('vehicles', data))) return;
      // fiecare vehicul are proiectul lui (cu iconița pe ecranul principal)
      const vp = vehicleProject(v.id);
      if (!vp) await save('projects', { id: db.uid(), name: data.name, kind: 'vehicle', icon: typeOf(data.type).icon, vehicleId: v.id, order: state.projects.length });
      else if (VEHICLE_TYPES.some((x) => x.icon === vp.icon) && vp.icon !== typeOf(data.type).icon) await save('projects', { ...vp, icon: typeOf(data.type).icon });
      closeModal();
    });
  });
}

function readVeh(form, v) {
  const n = (k) => toNum(form[k].value);
  return {
    ...v, type: form.type.value, name: form.name.value.trim(), plate: form.plate.value.trim().toUpperCase(), firstReg: form.firstReg.value,
    make: form.make.value.trim(), model: form.model.value.trim(), year: n('year'), category: form.category.value.trim().toUpperCase(),
    vin: form.vin.value.trim().toUpperCase().replace(/\s/g, ''), fuelType: form.fuelType.value.trim(), engineCc: n('engineCc'), powerKw: n('powerKw'),
    batteryKwh: n('batteryKwh'), tyreSize: form.tyreSize.value.trim(), tyreSizeWinter: form.tyreSizeWinter.value.trim(),
    pressureFront: n('pressureFront'), pressureRear: n('pressureRear'), wheelTorque: form.wheelTorque.value.trim(),
    oilType: form.oilType.value.trim(), oilLiters: n('oilLiters'), serviceKm: n('serviceKm'), serviceMonths: n('serviceMonths'), notes: form.notes.value.trim(),
  };
}

// ---------- export / import ----------
function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportCSV() {
  const n = (x) => (x == null || x === '' ? '' : String(+x).replace('.', ','));
  const head = ['Data', 'Magazin', 'CIF', 'Categorie', 'Proiect', 'Masina', 'Total', 'Litri', 'Pret/L', 'Km', 'Carburant', 'Note'];
  const rows = state.expenses.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
    const v = vehById(e.vehicleId);
    const cif = (e.ocrText || '').match(/C\.?\s*I\.?\s*F\.?\s*[:.]?\s*((?:RO\s*)?\d{4,10})/i)?.[1] || '';
    return [csvCell(e.date), csvCell(e.store), csvCell(cif.replace(/\s/g, '')), csvCell(catById(e.categoryId)?.name), csvCell(projById(e.projectId)?.name),
      csvCell(v ? `${v.name} ${v.plate || ''}`.trim() : ''), n(e.total), n(e.fuel?.liters), n(e.fuel?.pricePerLiter), n(e.fuel?.km),
      csvCell(e.fuel?.fuelType), csvCell(e.notes)].join(';');
  });
  download(new Blob(['﻿' + [head.join(';'), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' }), `fiscan-cheltuieli-${todayISO()}.csv`);
}

function exportItemsCSV() {
  const n = (x) => (x == null || x === '' ? '' : String(+x).replace('.', ','));
  const head = ['Data', 'Magazin', 'Produs', 'Grupa', 'Subcategorie', 'Cantitate', 'Pret unitar', 'Suma', 'Categorie bon', 'Proiect', 'Retur'];
  const rows = allItems().sort((a, b) => a.e.date.localeCompare(b.e.date)).map((i) => [
    csvCell(i.e.date), csvCell(i.e.store), csvCell(i.name), csvCell(groupOf(i.sub).name.replace(/^\S+\s/, '')), csvCell(subcatByKey(i.sub).name), n(i.qty), n(i.unitPrice), n(i.amount),
    csvCell(catById(i.e.categoryId)?.name), csvCell(projById(i.e.projectId)?.name), i.e.isReturn ? 'da' : ''].join(';'));
  download(new Blob(['\ufeff' + [head.join(';'), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' }), `fiscan-produse-${todayISO()}.csv`);
}

const blobToDataURL = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
function dataURLToBlob(url) {
  const [head, b64] = url.split(',');
  const type = head.slice(5, head.indexOf(';'));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// Cere o parolă într-o fereastră proprie (nu în prompt(), care o afișează în clar).
function askPassword(title, { confirmIt = false, optional = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openModal(title, `
    <form id="pw-form" class="form">
      ${optional ? '<p class="small">Recomandat: backup-ul conține toate bonurile tale. Cu parolă, nimeni nu îl poate citi fără ea (de ex. dacă îl trimiți pe e-mail sau în cloud). <b>Dacă uiți parola, backup-ul nu mai poate fi deschis.</b></p>' : ''}
      <label>Parolă<input name="pw" type="password" autocomplete="new-password" minlength="${optional ? 0 : 1}"></label>
      ${confirmIt ? '<label>Repetă parola<input name="pw2" type="password" autocomplete="new-password"></label>' : ''}
      <div class="actions">${optional ? '<button type="button" id="pw-skip">Fără parolă</button>' : ''}<button class="primary">Continuă</button></div>
    </form>`, (root) => {
      const form = $('#pw-form', root);
      $('#modal').addEventListener('close', () => finish(null), { once: true });
      $('#pw-skip', root)?.addEventListener('click', () => { finish(''); closeModal(); });
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const pw = form.pw.value;
        if (confirmIt && pw && pw.length < 8) return toast('Parola trebuie să aibă minim 8 caractere');
        if (confirmIt && pw !== form.pw2.value) return toast('Parolele nu coincid');
        if (!pw && !optional) return toast('Introdu parola');
        finish(pw);
        closeModal();
      });
      form.pw.focus();
    });
  });
}

async function exportJSON() {
  const pw = await askPassword('Backup complet', { confirmIt: true, optional: true });
  if (pw === null) return;
  toast('Pregătesc backup-ul…');
  const out = { app: 'bonuri-masina', version: 1, exportedAt: new Date().toISOString() };
  for (const s of DATA_STORES) {
    out[s] = await Promise.all(state[s].map(async (o) => {
      const copy = { ...o };
      delete copy.thumb; // se refac la restaurare
      if (o.image instanceof Blob) copy.image = await blobToDataURL(o.image);
      if (Array.isArray(o.extraImages)) copy.extraImages = await Promise.all(o.extraImages.map(blobToDataURL));
      return copy;
    }));
  }
  // ce a învățat aplicația din corecturi (nume produse, subcategorii, magazine, firme verificate)
  out.learned = { itemRules: state.itemRules, itemNames: state.itemNames, storeRules: state.storeRules, cuiCache: state.cuiCache, storeProjects: state.storeProjects, pantry: state.pantry, trips: state.trips };
  let json = JSON.stringify(out);
  if (pw) json = JSON.stringify(await encryptText(json, pw));
  download(new Blob([json], { type: 'application/json' }), `fiscan-backup-${todayISO()}${pw ? '-criptat' : ''}.json`);
}

const MAX_BACKUP_BYTES = 300e6;

async function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Fișier prea mare.');
      let data = JSON.parse(await file.text());
      if (data?.app !== 'bonuri-masina') throw new Error('Fișierul nu este un backup al aplicației.');
      if (data.encrypted) {
        const pw = await askPassword('Parola backup-ului');
        if (!pw) return;
        data = JSON.parse(await decryptText(data, pw));
        if (data?.app !== 'bonuri-masina') throw new Error('Backup invalid.');
      }
      if (!confirm('Restaurarea adaugă/actualizează datele din backup. Continui?')) return;
      let ok = 0;
      let skipped = 0;
      for (const s of DATA_STORES) {
        const list = Array.isArray(data[s]) ? data[s] : [];
        for (const o of list) {
          if (!o || typeof o !== 'object') { skipped++; continue; }
          const img = o.image;
          const extras = Array.isArray(o.extraImages) ? o.extraImages : [];
          const clean = sanitize(s, { ...o, image: null, extraImages: [] });
          if (!clean) { skipped++; continue; }
          if (safeImageDataURL(img)) clean.image = dataURLToBlob(img);
          if (s === 'expenses') clean.extraImages = extras.filter(safeImageDataURL).slice(0, 9).map(dataURLToBlob);
          await db.put(s, clean);
          ok++;
        }
      }
      const L = data.learned && typeof data.learned === 'object' ? data.learned : {};
      await db.put('meta', { id: 'itemRules', rules: sanitizeRules({ ...sanitizeRules(L.itemRules), ...state.itemRules }) });
      await db.put('meta', { id: 'itemNames', data: sanitizeItemNames({ ...sanitizeItemNames(L.itemNames), ...state.itemNames }) });
      await db.put('meta', { id: 'storeRules', rules: sanitizeStoreRules({ ...sanitizeStoreRules(L.storeRules), ...state.storeRules }) });
      await db.put('meta', { id: 'cuiCache', data: sanitizeCuiCache({ ...sanitizeCuiCache(L.cuiCache), ...state.cuiCache }) });
      await db.put('meta', { id: 'storeProjects', data: sanitizeStoreProjects({ ...sanitizeStoreProjects(L.storeProjects), ...state.storeProjects }) });
      await db.put('meta', { id: 'pantry', data: sanitizePantry({ ...sanitizePantry(L.pantry), ...state.pantry }) });
      await db.put('meta', { id: 'trips', data: sanitizeTrips({ ...sanitizeTrips(L.trips), ...state.trips }) });
      await loadAll();
      render();
      backfillThumbs().catch(() => {});
      toast(`Backup restaurat ✔ (${ok} înregistrări${skipped ? `, ${skipped} ignorate` : ''})`);
    } catch (e) { alert('Eroare: ' + (e.message || 'fișier invalid')); }
  };
  input.click();
}

async function wipe() {
  if (!confirm('Sigur ștergi TOATE datele? Nu se poate anula.')) return;
  if (prompt('Scrie STERGE pentru confirmare') !== 'STERGE') return;
  for (const s of db.STORES) await db.clear(s);
  await seed();
  await loadAll();
  await migrate().catch(() => {});
  render();
  toast('Date șterse');
}

// ---------- evenimente ----------
const actions = {
  'photo-receipt': (el) => photoReceipt(true, projectExtra(el)),
  'gallery-receipt': (el) => photoReceipt(false, projectExtra(el)),
  'new-expense': (el) => openExpense(newExpense(projectExtra(el))),
  period: (el) => { state.period = { ...state.period, key: el.dataset.key }; savePeriod(); render(); },
  'open-project': (el) => { state.view = 'project'; state.projectId = el.dataset.id || ''; state.projCat = ''; state.listLimit = 100; render(); window.scrollTo(0, 0); },
  'proj-cat': (el) => { state.projCat = el.dataset.id || ''; state.listLimit = 100; render(); },
  'go-home': () => { state.view = 'home'; render(); window.scrollTo(0, 0); },
  'open-car': (el) => { state.vehicleId = el.dataset.id; state.view = 'car'; render(); window.scrollTo(0, 0); },
  'setup-projects': async () => {
    const have = new Set(state.projects.map((p) => normalize(p.name)));
    const sugg = SUGGESTED_PROJECTS.filter((x) => !have.has(normalize(x.name)));
    const picked = [...document.querySelectorAll('.setup-pick')].filter((c) => c.checked).map((c) => sugg[+c.dataset.i]).filter(Boolean);
    let order = state.projects.length;
    for (const x of picked) { const c = sanitize('projects', { id: db.uid(), ...x, order: order++ }); if (c) await db.put('projects', c); }
    await db.put('meta', { id: 'projectsSetup', done: true });
    await loadAll();
    render();
    toast(picked.length ? `✔ ${picked.length} proiecte create` : 'Gata');
  },
  'skip-setup': async () => { await db.put('meta', { id: 'projectsSetup', done: true }); state.projectsSetup = true; render(); },
  'edit-expense': (el) => openExpense({ ...state.expenses.find((e) => e.id === el.dataset.id) }),
  'new-fuel': async () => {
    if (!(await needVehicle())) return;
    const fuelCat = state.categories.find((c) => c.isFuel);
    openExpense(newExpense({ categoryId: fuelCat?.id || '', vehicleId: state.vehicleId, projectId: vehicleProject(state.vehicleId)?.id || '', fuel: { liters: null } }));
  },
  'new-charge': async () => {
    if (!(await needVehicle())) return;
    const fuelCat = state.categories.find((c) => c.isFuel);
    openExpense(newExpense({ categoryId: fuelCat?.id || '', vehicleId: state.vehicleId, projectId: vehicleProject(state.vehicleId)?.id || '', energyMode: 'electric', fuel: { kwh: null, place: 'public' } }));
  },
  'std-reminders': async () => {
    const v = vehById(state.vehicleId);
    if (!v) return;
    const list = standardReminders(v, state.reminders, { lastKm: vehicleStats(v.id).lastKm, uid: db.uid });
    if (!list.length) return toast('Ai deja toate expirările obișnuite pentru acest vehicul');
    for (const r of list) { const c = sanitize('reminders', r); if (c) await db.put('reminders', c); }
    await loadAll();
    render();
    toast(`➕ ${list.length} expirări adăugate (${list.map((r) => r.title).join(', ')}). Deschide-le și pune datele exacte.`);
  },
  'veh-sheet': () => printVehicleSheet(vehById(state.vehicleId)),
  'veh-history': () => openSaleHistory(vehById(state.vehicleId)),
  'veh-timeline': () => importTimeline(vehById(state.vehicleId)),
  'photo-odometer': async () => {
    if (!(await needVehicle())) return;
    const f = await pickFile();
    if (!f) return;
    const image = await compressImage(f, 1200);
    if (image) openOdometer({ id: db.uid(), vehicleId: state.vehicleId, date: todayISO(), km: null, image }, { runOcr: true });
  },
  'new-odometer': async () => { if (await needVehicle()) openOdometer({ id: db.uid(), vehicleId: state.vehicleId, date: todayISO(), km: null }); },
  'edit-odometer': (el) => openOdometer({ ...state.odometer.find((o) => o.id === el.dataset.id) }),
  'new-reminder': (el) => openReminder({ id: db.uid(), type: 'RCA', dueDate: '', vehicleId: el.dataset.vehicle || state.vehicleId || '', notifyDays: [30, 7, 1], notified: [] }),
  'edit-reminder': (el) => openReminder({ ...state.reminders.find((r) => r.id === el.dataset.id) }),
  'ics-all': () => (state.reminders.length ? downloadICS(state.reminders) : toast('Nicio expirare adăugată')),
  'new-list': () => openList({ id: db.uid(), title: '', date: todayISO(), projectId: '', items: [] }),
  'edit-list': (el) => openList({ ...state.tasks.find((t) => t.id === el.dataset.id) }),
  'toggle-item': async (el) => {
    const t = state.tasks.find((x) => x.id === el.dataset.list);
    const it = t.items.find((i) => i.id === el.dataset.item);
    it.done = el.checked;
    await save('tasks', t);
  },
  'new-category': () => openCategory({ id: db.uid(), name: '', color: '#607d8b' }),
  'edit-category': (el) => openCategory({ ...catById(el.dataset.id) }),
  'new-project': () => openProject({ id: db.uid(), name: '' }),
  'edit-project': (el) => openProject({ ...projById(el.dataset.id) }),
  'new-vehicle': () => openVehicle({ id: db.uid(), name: '', plate: '' }),
  'edit-vehicle': (el) => openVehicle({ ...vehById(el.dataset.id) }),
  'enable-notif': enableNotifications,
  'test-notif': async () => {
    if (window.Notification?.permission !== 'granted') return toast('Activează întâi notificările');
    await notify({ key: 'test', title: '🔔 Test', body: 'Notificările funcționează.' });
  },
  'export-csv': exportCSV,
  'export-items-csv': exportItemsCSV,
  'export-inv-csv': exportInventoryCSV,
  'new-inv': () => openInventory({ id: db.uid(), name: '', qty: 1, status: 'avail', sub: 'tools', location: '', purchaseDate: '', returns: [] }),
  'edit-inv': (el) => openInventory({ ...state.inventory.find((x) => x.id === el.dataset.id) }),
  'inv-scan': scanInventory,
  'inv-sub': async (el) => {
    const subs = new Set(state.invSubs);
    if (el.checked) subs.add(el.dataset.sub); else subs.delete(el.dataset.sub);
    state.invSubs = sanitizeInvSubs([...subs]);
    await db.put('meta', { id: 'inventorySettings', subs: state.invSubs });
    render();
  },
  rmode: (el) => { state.receiptsMode = el.dataset.mode; render(); },
  'pantry-star': async (el) => {
    const key = el.dataset.key;
    const p = { ...state.pantry };
    if (p[key]) delete p[key];
    else {
      // stocul pornește de la ultima cumpărare
      const g = productSituation(el.dataset.name, state.expenses).find((x) => x.key === key);
      p[key] = { key, name: el.dataset.name, used: 0, resetAt: g?.last?.date || todayISO() };
    }
    await savePantry(p);
    toast(p[key] ? '⭐ Pus în cămară' : 'Scos din cămară');
  },
  'pantry-use': async (el) => { const e = state.pantry[el.dataset.key]; if (e) await savePantry({ ...state.pantry, [e.key]: { ...e, used: (e.used || 0) + 1 } }); },
  'pantry-done': async (el) => {
    const e = state.pantry[el.dataset.key];
    if (!e) return;
    const t = todayISO();
    await savePantry({ ...state.pantry, [e.key]: { ...e, resetAt: t, used: pantryStock({ ...e, resetAt: t, used: 0 }, state.expenses).bought } });
    toast('Marcat ca terminat · apasă 🛒 ca să-l pui pe listă');
  },
  'pantry-list': async (el) => {
    const e = state.pantry[el.dataset.key];
    if (!e) return;
    let t = state.tasks.find((x) => normalize(x.title) === 'cumparaturi' && x.items.some((i) => !i.done)) || state.tasks.find((x) => normalize(x.title) === 'cumparaturi');
    t = t ? { ...t, items: [...t.items] } : { id: db.uid(), title: 'Cumpărături', date: todayISO(), projectId: '', items: [], createdAt: Date.now() };
    if (!t.items.some((i) => !i.done && normalize(i.text) === normalize(e.name))) t.items.push({ id: db.uid(), text: e.name, done: false });
    await save('tasks', t);
    toast(`🛒 ${e.name} pus pe lista „Cumpărături”`);
  },
  'prod-sub': (el) => { state.prodFilter.sub = state.prodFilter.sub === el.dataset.sub ? '' : el.dataset.sub; state.view = 'receipts'; state.receiptsMode = 'products'; render(); },
  'export-json': exportJSON,
  'import-json': importJSON,
  'more-receipts': () => { state.listLimit += 100; render(); },
  'show-to-check': () => { state.view = 'receipts'; state.receiptsMode = 'bills'; state.filter = { q: '', cat: '', proj: '', month: '', check: true }; render(); window.scrollTo(0, 0); },
  'print-receipts': () => {
    const list = filteredExpenses();
    const photos = list.length <= 40;
    if (!photos) toast('Multe bonuri: le pregătesc fără poze. Filtrează pe o lună ca să apară și pozele.');
    printReceipts(list, { title: 'Bonuri' + (state.filter.month ? ' ' + state.filter.month : ''), photos, urlOf: blobURL });
  },
  wipe,
  ask: (el) => { state.ask = el.dataset.q; state.view = 'home'; doAsk(); },
};

function doAsk() {
  state.askResult = state.ask.trim() ? runQuery(state.ask, { ...state, subcats: SUBCATS, groups: GROUPS }) : null;
  render();
}

// ---------- meniul de jos: 5 butoane + „Mai mult” (se apasă sau se trage în sus) ----------
const sheet = $('#more-sheet');
const backdrop = $('#sheet-backdrop');
function setSheet(open) {
  sheet.style.transform = '';
  sheet.classList.toggle('open', open);
  sheet.setAttribute('aria-hidden', String(!open));
  backdrop.hidden = !open;
}
function goView(view) { state.view = view; state.listLimit = 100; setSheet(false); render(); window.scrollTo(0, 0); }
const SHEET_GO = {
  lists: () => goView('lists'),
  products: () => { state.receiptsMode = 'products'; goView('receipts'); },
  'new-project': () => { setSheet(false); openProject({ id: db.uid(), name: '' }); },
  ask: () => { goView('home'); $('#ask-form input')?.scrollIntoView({ block: 'center' }); $('#ask-form input')?.focus(); },
  check: () => { setSheet(false); actions['show-to-check'](); },
  settings: () => goView('settings'),
  export: () => { goView('settings'); $('#set-export')?.scrollIntoView({ block: 'start' }); },
  categories: () => { goView('settings'); $('#set-categories')?.scrollIntoView({ block: 'start' }); },
};
sheet.addEventListener('click', (ev) => { const b = ev.target.closest('[data-go]'); if (b) SHEET_GO[b.dataset.go]?.(); });
backdrop.addEventListener('click', () => setSheet(false));
// tragerea: de pe bara de jos în sus deschide, de pe foaie în jos închide
(() => {
  let startY = null; let moved = 0; let from = null;
  const down = (ev, where) => { startY = ev.clientY; moved = 0; from = where; };
  const move = (ev) => {
    if (startY === null) return;
    moved = ev.clientY - startY;
    const open = sheet.classList.contains('open');
    if (from === 'nav' && !open && moved < -8) { sheet.classList.add('dragging'); sheet.style.transform = `translateY(calc(100% + ${moved}px))`; }
    if (from === 'sheet' && open && moved > 8) { sheet.classList.add('dragging'); sheet.style.transform = `translateY(${moved}px)`; }
  };
  const up = () => {
    if (startY === null) return;
    sheet.classList.remove('dragging');
    if (from === 'nav' && moved < -40) { setSheet(true); suppressClick = true; } else if (from === 'sheet' && moved > 60) setSheet(false);
    else sheet.style.transform = '';
    startY = null;
  };
  $('#tabs').addEventListener('pointerdown', (ev) => down(ev, 'nav'));
  sheet.querySelector('.sheet-handle').addEventListener('pointerdown', (ev) => down(ev, 'sheet'));
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
})();
let suppressClick = false;

document.addEventListener('click', (ev) => {
  if (suppressClick) { suppressClick = false; if (ev.target.closest('nav.tabs')) return; }
  if (ev.target.closest('nav.tabs [data-more]')) { setSheet(!sheet.classList.contains('open')); return; }
  const nav = ev.target.closest('nav.tabs button');
  if (nav) { if (nav.dataset.view === 'receipts') state.receiptsMode = 'bills'; goView(nav.dataset.view); return; }
  const el = ev.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  if (el.type === 'checkbox') { actions[el.dataset.action](el); return; }
  ev.preventDefault();
  actions[el.dataset.action](el);
});

document.addEventListener('submit', async (ev) => {
  if (ev.target.id === 'ask-form') {
    ev.preventDefault();
    state.ask = ev.target.q.value;
    doAsk();
  } else if (ev.target.classList.contains('add-item')) {
    ev.preventDefault();
    const text = ev.target.text.value.trim();
    if (!text) return;
    const t = state.tasks.find((x) => x.id === ev.target.dataset.list);
    t.items.push({ id: db.uid(), text, done: false });
    await save('tasks', t);
  }
});

document.addEventListener('input', (ev) => {
  const id = ev.target.id;
  if (id === 'f-q') { state.filter.q = ev.target.value; state.listLimit = 100; rerenderKeepFocus(id); }
  if (id === 'p-q') { state.prodFilter.q = ev.target.value; rerenderKeepFocus(id); }
  if (id === 'i-q') { state.invFilter.q = ev.target.value; rerenderKeepFocus(id); }
});
document.addEventListener('change', (ev) => {
  const id = ev.target.id;
  if (/^f-/.test(id)) state.listLimit = 100;
  if (id === 'f-cat') state.filter.cat = ev.target.value;
  else if (id === 'f-proj') state.filter.proj = ev.target.value;
  else if (id === 'f-month') state.filter.month = ev.target.value;
  else if (id === 'f-check') state.filter.check = ev.target.checked;
  else if (id === 'p-from' || id === 'p-to') { state.period = { ...state.period, [id === 'p-from' ? 'from' : 'to']: ev.target.value }; savePeriod(); }
  else if (id === 'p-month') state.prodFilter.month = ev.target.value;
  else if (id === 'p-sub') state.prodFilter.sub = ev.target.value;
  else if (id === 'i-status') state.invFilter.status = ev.target.value;
  else if (id === 'i-loc') state.invFilter.loc = ev.target.value;
  else if (id === 'veh-select') state.vehicleId = ev.target.value;
  else if (ev.target.name === 'projectId' && ev.target.closest('#exp-form')) { try { localStorage.setItem('lastProject', ev.target.value); } catch { /* ignoră */ } return; }
  else return;
  render();
});

function rerenderKeepFocus(id) {
  const el = document.getElementById(id);
  const pos = el?.selectionStart;
  render();
  const n = document.getElementById(id);
  if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* ignoră */ } }
}

$('#modal-close').addEventListener('click', closeModal);

// ---------- pornire ----------
async function start() {
  // Protecție clickjacking: aplicația nu rulează încadrată în pagina altcuiva.
  if (window.top !== window.self) {
    document.body.innerHTML = '<p style="padding:20px">Deschide aplicația direct, nu într-un cadru.</p>';
    return;
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  try { const p = JSON.parse(localStorage.getItem('period') || 'null'); if (p?.key) state.period = { key: String(p.key), from: String(p.from || ''), to: String(p.to || '') }; } catch { /* ignoră */ }
  await seed();
  await loadAll();
  await migrate().catch(() => {});
  render();
  checkReminders();
  setInterval(checkReminders, 3600 * 1000);
  setTimeout(() => backfillThumbs().catch(() => {}), 1500);
}

start();
