import * as db from './db.js';
import { parseReceipt, parseOdometer, runQuery, isFuelExpense, normalize, shortCompanyName, findBrand } from './parsers.js';
import { lookupCui } from './anaf.js';
import { expenseFlags, isUnknownItem } from './checks.js';
import { shareReceiptPhotos, printReceipts } from './copy.js';
import { recognize, compressImage as compressRaw } from './ocr.js';
import { sanitize, sanitizeRules, sanitizeInvSubs, sanitizeStoreRules, sanitizeCuiCache, sanitizeItemNames, safeImageDataURL, csvCell, icsText } from './sanitize.js';
import { SUBCATS, GROUPS, groupOf, subcatByKey, classifyItem, parseItems, itemKey } from './items.js';
import { INV_STATUSES, OWNED, statusByKey, syncFromExpense, undoExpense, findSimilar, addMonths, WARRANTY_MONTHS } from './inventory.js';
import { encryptText, decryptText } from './crypto.js';

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
const APP_VERSION = '2026.09.25-4';
const DATA_STORES = ['expenses', 'odometer', 'vehicles', 'reminders', 'tasks', 'categories', 'projects', 'inventory'];
const REMINDER_TYPES = ['RCA', 'ITP', 'CASCO', 'Rovinietă', 'Revizie / schimb ulei', 'Permis / buletin', 'Altul'];

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
  anafStatus: null,
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
  const st = await db.get('meta', 'anafStatus');
  state.anafStatus = st && typeof st.at === 'number' ? { ok: st.ok === true, at: st.at } : null;
}
function sortState() {
  state.categories.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
  state.projects.sort((a, b) => a.name.localeCompare(b.name));
  state.inventory.sort((a, b) => a.name.localeCompare(b.name));
}

async function seed() {
  const cats = await db.getAll('categories');
  if (cats.length) return;
  let i = 0;
  for (const c of DEFAULT_CATEGORIES) await db.put('categories', { id: db.uid(), order: i++, ...c });
  await db.put('projects', { id: db.uid(), name: 'Construcție casă', notes: '' });
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
const VIEWS = { home: renderHome, receipts: renderReceipts, car: renderCar, lists: renderLists, settings: renderSettings };

function render() {
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  $('#view').innerHTML = VIEWS[state.view]();
}

function expenseRow(e) {
  const cat = catById(e.categoryId);
  const proj = projById(e.projectId);
  const img = blobURL(e.thumb || e.image);
  const fuel = e.fuel?.liters ? ` · ${num(e.fuel.liters)} L` : '';
  const flags = expenseFlags(e);
  return `<li class="row" data-action="edit-expense" data-id="${esc(e.id)}">
    ${img ? `<img class="thumb" src="${img}" alt="" loading="lazy" decoding="async">` : '<div class="thumb ph">🧾</div>'}
    <div class="grow">
      <div class="title">${e.isReturn ? '↩️ ' : ''}${esc(e.store || 'Fără nume')}${e.extraImages?.length ? ` <span class="muted small">📄×${e.extraImages.length + 1}</span>` : ''}</div>
      <div class="sub">${fmtDate(e.date)} · <span class="dot" style="background:${esc(cat?.color || '#999')}"></span>${esc(cat?.name || 'Fără categorie')}${proj ? ' · 📁 ' + esc(proj.name) : ''}${fuel}</div>
      ${e.items?.length ? `<div class="sub items-peek">🧾 ${esc(e.items.slice(0, 4).map((i) => i.name).join(', '))}${e.items.length > 4 ? ` +${e.items.length - 4}` : ''}</div>` : ''}
      ${flags.length ? `<div class="sub warn-text">${flags[0].text.startsWith('❓') ? '' : '⚠️ '}${esc(flags[0].text.replace(/ – .*/, ''))}${flags.length > 1 ? ` (+${flags.length - 1})` : ''}</div>` : ''}
    </div>
    <div class="amount">${money(e.total)}</div>
  </li>`;
}

function reminderRow(r) {
  const days = RC.daysUntil(r.dueDate, new Date());
  const cls = days < 0 ? 'bad' : days <= 7 ? 'bad' : days <= 30 ? 'warn' : 'ok';
  const txt = days < 0 ? `expirat de ${-days} zile` : days === 0 ? 'expiră azi' : `în ${days} zile`;
  const v = vehById(r.vehicleId);
  return `<li class="row" data-action="edit-reminder" data-id="${esc(r.id)}">
    <div class="grow"><div class="title">${esc(r.title || r.type)}</div>
    <div class="sub">${v ? '🚗 ' + esc(v.name) + ' · ' : ''}${fmtDate(r.dueDate)}</div></div>
    <span class="badge ${cls}">${txt}</span></li>`;
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

function renderHome() {
  const now = todayISO();
  const month = now.slice(0, 7);
  const monthExp = state.expenses.filter((e) => (e.date || '').startsWith(month));
  const monthTotal = monthExp.reduce((s, e) => s + (+e.total || 0), 0);
  const byCat = {};
  for (const e of monthExp) { const n = catById(e.categoryId)?.name || 'Fără categorie'; byCat[n] = (byCat[n] || 0) + (+e.total || 0); }
  const upcoming = state.reminders.filter((r) => !r.done && RC.daysUntil(r.dueDate, new Date()) <= 45)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const todayLists = state.tasks.filter((t) => t.date && t.date <= now && t.items.some((i) => !i.done));
  const toCheck = state.expenses.filter((e) => expenseFlags(e).length).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const projectTotals = state.projects.map((p) => ({ p, total: state.expenses.filter((e) => e.projectId === p.id).reduce((s, e) => s + (+e.total || 0), 0) }));

  return `
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
  ${renderAskResult()}
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
  <section class="card">
    <h3>Luna aceasta: ${money(monthTotal)}</h3>
    ${breakdown(byCat, monthTotal) || '<p class="muted">Niciun bon luna aceasta. Apasă „Fotografiază bon”.</p>'}
  </section>
  ${projectTotals.length ? `<section class="card"><h3>📁 Proiecte</h3><table class="breakdown"><tbody>
    ${projectTotals.map(({ p, total }) => `<tr data-action="ask" data-q="${esc(p.name)}" class="click"><td>${esc(p.name)}</td><td class="num">${money(total)}</td></tr>`).join('')}
  </tbody></table></section>` : ''}`;
}

function filteredExpenses() {
  const f = state.filter;
  const q = f.q.toLowerCase();
  return state.expenses.filter((e) =>
    (!f.cat || e.categoryId === f.cat) &&
    (!f.proj || e.projectId === f.proj) &&
    (!f.month || (e.date || '').startsWith(f.month)) &&
    (!f.check || expenseFlags(e).length > 0) &&
    (!q || `${e.store} ${e.notes} ${e.ocrText}`.toLowerCase().includes(q)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
}

function modeSwitch() {
  const m = state.receiptsMode;
  return `<div class="seg" role="tablist">
    <button data-action="rmode" data-mode="bills" class="${m === 'bills' ? 'on' : ''}">🧾 Bonuri</button>
    <button data-action="rmode" data-mode="products" class="${m === 'products' ? 'on' : ''}">📊 Produse</button>
    <button data-action="rmode" data-mode="inventory" class="${m === 'inventory' ? 'on' : ''}">🧰 Inventar</button></div>`;
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

function renderProducts() {
  const f = state.prodFilter;
  const items = allItems(f.month);
  const bySub = {};
  const countSub = {};
  for (const i of items) {
    const n = subcatByKey(i.sub).name;
    bySub[n] = (bySub[n] || 0) + (+i.amount || 0);
    countSub[i.sub] = (countSub[i.sub] || 0) + 1;
  }
  const total = items.reduce((a, i) => a + (+i.amount || 0), 0);
  const q = normalize(f.q.trim());
  const sel = items.filter((i) => (!f.sub || i.sub === f.sub) && (!q || normalize(i.name).includes(q)))
    .sort((a, b) => b.e.date.localeCompare(a.e.date));
  const selTotal = sel.reduce((a, i) => a + (+i.amount || 0), 0);
  const withUnit = sel.filter((i) => i.unitPrice > 0);
  const avgUnit = withUnit.length ? withUnit.reduce((a, i) => a + i.unitPrice, 0) / withUnit.length : null;
  const qtySum = sel.reduce((a, i) => a + (i.qty > 0 ? i.qty : i.qty == null ? 1 : 0), 0);
  const noItems = state.expenses.filter((e) => (!f.month || (e.date || '').startsWith(f.month)) && !(e.items || []).length).length;
  const byGroup = {};
  for (const i of items) { const g = groupOf(i.sub).key; byGroup[g] = (byGroup[g] || 0) + (+i.amount || 0); }
  const groups = GROUPS.filter((g) => byGroup[g.key] !== undefined).sort((a, b) => byGroup[b.key] - byGroup[a.key]);
  const pct = (v) => (total ? Math.round(v / total * 100) : 0);
  return `${modeSwitch()}
  <section class="card filters">
    <input id="p-q" type="search" placeholder="Caută produs: unt, ciment, detergent…" value="${esc(f.q)}">
    <div class="grid2">
      <select id="p-sub"><option value="">Toate subcategoriile</option>${SUBCATS.map((c) => `<option value="${c.key}" ${c.key === f.sub ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <input id="p-month" type="month" value="${esc(f.month)}">
    </div>
  </section>
  ${f.q || f.sub ? `<section class="card result">
    <div class="big">${money(selTotal)}</div>
    <div class="muted">${sel.length} ${sel.length === 1 ? 'produs' : 'produse'}${f.q ? ` „${esc(f.q)}”` : ''}${f.sub ? ` · ${esc(subcatByKey(f.sub).name)}` : ''}${f.month ? ` · ${esc(f.month)}` : ''}</div>
    ${sel.length ? `<div class="kpis"><div><b>${num(qtySum, 2)}</b><span>bucăți / cantitate</span></div>
      ${avgUnit != null ? `<div><b>${money(avgUnit)}</b><span>preț mediu / unitate</span></div>` : ''}
      <div><b>${money(selTotal / sel.length)}</b><span>medie pe cumpărare</span></div></div>` : ''}
    <ul class="list">${sel.slice(0, 300).map(itemRow).join('') || '<li class="muted pad">Nimic găsit.</li>'}</ul>
  </section>` : ''}
  <section class="card"><h3>Pe grupe și subcategorii: ${money(total)}</h3>
    ${groups.length ? `<table class="breakdown"><tbody>${groups.map((g) => {
      const subs = SUBCATS.filter((c) => c.group === g.key && bySub[c.name] !== undefined).sort((a, b) => bySub[b.name] - bySub[a.name]);
      const single = SUBCATS.filter((c) => c.group === g.key).length === 1;
      return `<tr class="group-row ${single ? 'click' : ''}" ${single ? `data-action="prod-sub" data-sub="${subs[0]?.key}"` : ''}><td><b>${esc(g.name)}</b>${single ? ` <span class="muted small">(${countSub[subs[0]?.key]})</span>` : ''}</td><td class="num"><b>${money(byGroup[g.key])}</b></td><td class="num muted">${pct(byGroup[g.key])}%</td></tr>`
        + (SUBCATS.filter((c) => c.group === g.key).length > 1 ? subs.map((c) => `<tr class="click sub-row" data-action="prod-sub" data-sub="${c.key}">
          <td><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name.replace(/^Materiale – (.)/, (m, ch) => ch.toUpperCase()))} <span class="muted small">(${countSub[c.key]})</span></td>
          <td class="num">${money(bySub[c.name])}</td><td class="num muted">${pct(bySub[c.name])}%</td></tr>`).join('') : '');
    }).join('')}</tbody></table>`
      : '<p class="muted">Niciun produs încă. Produsele se citesc automat de pe bonurile noi fotografiate.</p>'}
    ${noItems ? `<p class="muted small">${bonuri(noItems)} fără produse citite (de ex. bonuri de card sau introduse manual).</p>` : ''}
  </section>`;
}

function renderReceipts() {
  if (state.receiptsMode === 'products') return renderProducts();
  if (state.receiptsMode === 'inventory') return renderInventory();
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
      <select id="f-cat">${options(state.categories, f.cat, 'Toate categoriile')}</select>
      <select id="f-proj">${options(state.projects, f.proj, 'Toate proiectele')}</select>
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

function vehicleStats(vid) {
  const fuel = state.expenses.filter((e) => e.vehicleId === vid && isFuelExpense(e, state)).sort((a, b) => a.date.localeCompare(b.date));
  const readings = [
    ...state.odometer.filter((o) => o.vehicleId === vid).map((o) => ({ date: o.date, km: +o.km })),
    ...fuel.filter((e) => e.fuel?.km).map((e) => ({ date: e.date, km: +e.fuel.km })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
  const lastKm = readings.length ? Math.max(...readings.map((r) => r.km)) : null;
  const year = todayISO().slice(0, 4);
  const yearFuel = fuel.filter((e) => e.date.startsWith(year));
  const withKm = fuel.filter((e) => e.fuel?.km && e.fuel?.liters).sort((a, b) => a.fuel.km - b.fuel.km);
  let consumption = null;
  if (withKm.length >= 2) {
    const dist = withKm[withKm.length - 1].fuel.km - withKm[0].fuel.km;
    const liters = withKm.slice(1).reduce((s, e) => s + +e.fuel.liters, 0);
    if (dist > 0) consumption = liters / dist * 100;
  }
  const carCost = state.expenses.filter((e) => e.vehicleId === vid && e.date.startsWith(year)).reduce((s, e) => s + (+e.total || 0), 0);
  return {
    fuel, readings, lastKm, consumption, carCost,
    yearLiters: yearFuel.reduce((s, e) => s + (+e.fuel?.liters || 0), 0),
    yearFuelCost: yearFuel.reduce((s, e) => s + (+e.total || 0), 0),
  };
}

function renderCar() {
  if (!state.vehicles.length) {
    return `<section class="card center"><p>Adaugă mașina ta ca să urmărești combustibilul, kilometrii și expirările.</p>
      <button class="primary" data-action="new-vehicle">+ Adaugă mașină</button></section>
      ${renderRemindersCard(state.reminders)}`;
  }
  const vid = state.vehicleId;
  const v = vehById(vid);
  const s = vehicleStats(vid);
  const rems = state.reminders.filter((r) => r.vehicleId === vid || !r.vehicleId);
  const odo = state.odometer.filter((o) => o.vehicleId === vid).sort((a, b) => b.date.localeCompare(a.date) || b.km - a.km);
  return `
  <section class="card">
    <div class="row-flex">
      <select id="veh-select">${state.vehicles.map((x) => `<option value="${esc(x.id)}" ${x.id === vid ? 'selected' : ''}>${esc(x.name)} ${x.plate ? '(' + esc(x.plate) + ')' : ''}</option>`).join('')}</select>
      <button data-action="edit-vehicle" data-id="${esc(vid)}">✏️</button>
      <button data-action="new-vehicle">+</button>
    </div>
    <div class="kpis">
      <div><b>${s.lastKm != null ? num(s.lastKm, 0) : '—'}</b><span>km la bord</span></div>
      <div><b>${s.consumption ? num(s.consumption) : '—'}</b><span>L / 100 km</span></div>
      <div><b>${num(s.yearLiters)} L</b><span>carburant ${todayISO().slice(0, 4)}</span></div>
      <div><b>${money(s.yearFuelCost)}</b><span>carburant ${todayISO().slice(0, 4)}</span></div>
      <div><b>${money(s.carCost)}</b><span>total mașină ${todayISO().slice(0, 4)}</span></div>
    </div>
  </section>
  <section class="quick">
    <button class="big-btn" data-action="new-fuel">⛽<span>Alimentare</span></button>
    <button class="big-btn" data-action="photo-odometer">📷<span>Poză bord</span></button>
    <button class="big-btn" data-action="new-odometer">🔢<span>Km manual</span></button>
  </section>
  ${renderRemindersCard(rems, vid)}
  <section class="card"><h3>⛽ Alimentări ${esc(v?.name || '')}</h3>
    <ul class="list">${s.fuel.slice().reverse().slice(0, 50).map(expenseRow).join('') || '<li class="muted pad">Nicio alimentare.</li>'}</ul></section>
  <section class="card"><h3>🔢 Kilometraj</h3>
    <ul class="list">${odo.slice(0, 50).map((o) => `<li class="row" data-action="edit-odometer" data-id="${esc(o.id)}">
      ${o.image ? `<img class="thumb" src="${imgURL(o)}" alt="">` : '<div class="thumb ph">🔢</div>'}
      <div class="grow"><div class="title">${num(o.km, 0)} km</div><div class="sub">${fmtDate(o.date)}${o.notes ? ' · ' + esc(o.notes) : ''}</div></div></li>`).join('') || '<li class="muted pad">Nicio citire.</li>'}</ul></section>`;
}

function renderRemindersCard(rems, vid = '') {
  const sorted = rems.slice().sort((a, b) => (a.done - b.done) || a.dueDate.localeCompare(b.dueDate));
  return `<section class="card"><div class="row-flex"><h3 class="grow">📅 Asigurări, ITP, expirări</h3>
    <button data-action="new-reminder" data-vehicle="${esc(vid)}">+ Adaugă</button></div>
    <ul class="list">${sorted.map(reminderRow).join('') || '<li class="muted pad">Adaugă data de expirare RCA, ITP, rovinietă… și primești notificare înainte.</li>'}</ul>
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
  <section class="card"><div class="row-flex"><h3 class="grow">Categorii</h3><button data-action="new-category">+ Adaugă</button></div>
    <ul class="list">${state.categories.map((c) => `<li class="row" data-action="edit-category" data-id="${esc(c.id)}">
      <span class="dot big" style="background:${esc(c.color)}"></span><div class="grow">${esc(c.name)}</div>
      <span class="muted small">${c.isFuel ? 'combustibil' : c.isCar ? 'mașină' : ''}</span></li>`).join('')}</ul></section>
  <section class="card"><div class="row-flex"><h3 class="grow">Proiecte</h3><button data-action="new-project">+ Adaugă</button></div>
    <p class="muted small">Ex.: „Construcție casă”, „Renovare baie”. Atașezi bonurile la proiect și vezi costul total.</p>
    <ul class="list">${state.projects.map((p) => `<li class="row" data-action="edit-project" data-id="${esc(p.id)}"><div class="grow">📁 ${esc(p.name)}</div></li>`).join('')}</ul></section>
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
  <section class="card"><h3>Export / integrare</h3>
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
    <label>Categorie<select name="categoryId">${options(state.categories, exp.categoryId, '— alege —')}</select></label>
    <label>Proiect<select name="projectId">${options(state.projects, exp.projectId)}</select></label>
    <div id="car-block" class="${cat?.isCar || exp.vehicleId ? '' : 'hidden'}">
      <label>Mașina<select name="vehicleId">${options(state.vehicles, exp.vehicleId)}</select></label>
    </div>
    <fieldset id="fuel-block" class="${cat?.isFuel || exp.fuel?.liters ? '' : 'hidden'}"><legend>⛽ Alimentare</legend>
      <div class="grid3">
        <label>Litri<input name="liters" inputmode="decimal" value="${esc(exp.fuel?.liters ?? '')}"></label>
        <label>Preț / L<input name="ppl" inputmode="decimal" value="${esc(exp.fuel?.pricePerLiter ?? '')}"></label>
        <label>Km la bord<input name="km" inputmode="numeric" value="${esc(exp.fuel?.km ?? '')}"></label>
      </div>
      <label>Tip carburant<input name="fuelType" list="fuel-types" value="${esc(exp.fuel?.fuelType || '')}"></label>
      <datalist id="fuel-types"><option>benzină</option><option>motorină</option><option>GPL</option><option>electric (kWh)</option></datalist>
    </fieldset>
    <details id="items-box" ${exp.items?.length || (!isNew && exp.image) ? 'open' : ''}><summary>🧾 Produse (<span id="items-count">0</span>) <span id="items-sum" class="muted small"></span></summary>
      <div id="items-list"></div>
      <button type="button" id="item-add" class="link">+ Adaugă produs</button>
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
      $('#fuel-block', root).classList.toggle('hidden', !(c?.isFuel || form.liters.value));
      if (c?.isCar && !form.vehicleId.value && state.vehicles.length) form.vehicleId.value = state.vehicleId || state.vehicles[0].id;
    };
    form.categoryId.addEventListener('change', syncBlocks);
    const recalc = () => {
      const l = toNum(form.liters.value); const p = toNum(form.ppl.value); const t = toNum(form.total.value);
      if (l && t && !touched.has('ppl')) form.ppl.value = (t / l).toFixed(2);
      else if (l && p && !t) form.total.value = (l * p).toFixed(2);
    };
    form.liters.addEventListener('change', recalc);
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
      renderChecks();
    };
    // ---- „De verificat”: ce ar putea fi citit greșit, arătat direct în formular
    const renderChecks = () => {
      const box = $('#checks', root);
      if (!box) return;
      const flags = expenseFlags({ ...readExpenseForm(form, exp), reviewed: false, createdAt: exp.createdAt });
      box.classList.toggle('hidden', !flags.length);
      box.innerHTML = flags.length ? `<strong>⚠️ De verificat</strong><ul>${flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>
        <label class="check"><input type="checkbox" id="exp-reviewed" ${exp.reviewed ? 'checked' : ''}> Am verificat, e în regulă</label>` : '';
    };
    $('#checks', root).addEventListener('change', (ev) => { if (ev.target.id === 'exp-reviewed') exp.reviewed = ev.target.checked; });
    const renderItems = () => {
      $('#items-list', root).innerHTML = exp.items.map((i) => `<div class="item-row" data-id="${esc(i.id)}">
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
      if (ev.target.classList.contains('it-sub')) { it.sub = ev.target.value; it.manualSub = true; }
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
  const liters = toNum(form.liters.value);
  const km = toNum(form.km.value);
  const cat = catById(form.categoryId.value);
  const hasFuel = liters || cat?.isFuel;
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
    fuel: hasFuel ? { liters, pricePerLiter: toNum(form.ppl.value), km, fuelType: form.fuelType.value.trim() } : null,
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
    (!q || normalize(`${x.name} ${x.location} ${x.lentTo} ${x.notes} ${x.store}`).includes(q)));
}

function invRow(x) {
  const st = statusByKey(x.status);
  const today = todayISO();
  const warranty = x.warrantyUntil && x.warrantyUntil >= today && OWNED.has(x.status);
  return `<li class="row" data-action="edit-inv" data-id="${esc(x.id)}">
    ${x.image ? `<img class="thumb" src="${imgURL(x)}" alt="">` : `<div class="thumb ph">${esc(subcatByKey(x.sub).key === 'tools' ? '🔧' : '📦')}</div>`}
    <div class="grow"><div class="title">${esc(x.name)}${x.qty > 1 ? ` <span class="muted">×${esc(x.qty)}</span>` : ''}</div>
    <div class="sub">${x.purchaseDate ? fmtDate(x.purchaseDate) : 'fără dată'}${x.store ? ' · ' + esc(x.store) : ''}${x.price ? ' · ' + money(x.price) : ''}${warranty ? ` · 🛡️ garanție până ${fmtDate(x.warrantyUntil)}` : ''}
    ${x.status === 'lent' && x.lentTo ? ` · la <b>${esc(x.lentTo)}</b>${x.lentDate ? ' din ' + fmtDate(x.lentDate) : ''}` : ''}</div></div>
    ${x.status !== 'avail' ? `<span class="badge ${st.cls}">${esc(st.name)}</span>` : ''}</li>`;
}

function renderInventory() {
  const f = state.invFilter;
  const list = invFiltered();
  const owned = state.inventory.filter((x) => OWNED.has(x.status));
  const count = owned.reduce((a, x) => a + (x.qty || 1), 0);
  const value = owned.reduce((a, x) => a + (x.price || 0) * (x.qty || 1), 0);
  const lent = owned.filter((x) => x.status === 'lent');
  const inWarranty = owned.filter((x) => x.warrantyUntil && x.warrantyUntil >= todayISO()).length;
  const locs = [...new Set(state.inventory.map((x) => x.location || ''))].sort();
  const groups = {};
  for (const x of list) (groups[x.location || ''] ||= []).push(x);
  const subsNames = state.invSubs.map((k) => subcatByKey(k).name).join(', ');
  return `${modeSwitch()}
  <section class="card">
    <div class="kpis">
      <div><b>${count}</b><span>bucăți deținute</span></div>
      <div><b>${money(value)}</b><span>valoare de cumpărare</span></div>
      <div><b>${lent.length}</b><span>împrumutate</span></div>
      <div><b>${inWarranty}</b><span>în garanție</span></div>
    </div>
    ${lent.length ? `<p class="small">🤝 Împrumutate: ${lent.map((x) => `<b>${esc(x.name)}</b> → ${esc(x.lentTo || '?')}`).join(' · ')}</p>` : ''}
    <div class="row-flex wrap"><button class="primary" data-action="new-inv">+ Adaugă sculă</button>
      <button data-action="inv-scan" title="Adaugă în inventar sculele de pe bonurile salvate deja">🔄 Din bonurile salvate</button></div>
    <p class="muted small">Se adaugă automat din bonuri: ${esc(subsNames)} (modifici în Setări). Retururile le scot din inventar.</p>
  </section>
  <section class="card filters">
    <input id="i-q" type="search" placeholder="Caută sculă, loc, persoană…" value="${esc(f.q)}">
    <div class="grid2">
      <select id="i-status">
        <option value="owned" ${f.status === 'owned' ? 'selected' : ''}>Ce am (toate deținute)</option>
        ${INV_STATUSES.map((s2) => `<option value="${s2.key}" ${f.status === s2.key ? 'selected' : ''}>${esc(s2.name)}</option>`).join('')}
        <option value="all" ${f.status === 'all' ? 'selected' : ''}>Toate, inclusiv returnate</option>
      </select>
      <select id="i-loc"><option value="">Toate locurile</option>${locs.map((l) => `<option value="${esc(l || '—')}" ${f.loc === (l || '—') ? 'selected' : ''}>${esc(l || 'Fără loc')}</option>`).join('')}</select>
    </div>
  </section>
  ${Object.keys(groups).sort().map((loc) => `<section class="card"><h3>📍 ${esc(loc || 'Fără loc stabilit')} <span class="muted small">(${groups[loc].length})</span></h3>
    <ul class="list">${groups[loc].map(invRow).join('')}</ul></section>`).join('')
    || `<p class="muted center">${state.inventory.length ? 'Nimic găsit.' : 'Inventarul e gol. Sculele intră automat din <b>produsele</b> bonurilor (chitanța de la card nu are produse). Deschide bonul și adaugă produsul în „🧾 Produse”, sau apasă „+ Adaugă sculă” și alege bonul.'}</p>`}`;
}

function openInventory(x) {
  const isNew = !state.inventory.some((i) => i.id === x.id);
  const locs = [...new Set(['Garaj', 'Casă', 'Mașină', 'Șantier', 'Atelier', 'Magazie', ...state.inventory.map((i) => i.location).filter(Boolean)])];
  const exp = x.expenseId ? state.expenses.find((e) => e.id === x.expenseId) : null;
  openModal(isNew ? 'Sculă nouă' : 'Sculă', `
  <form id="inv-form" class="form">
    ${x.image ? `<img class="preview" src="${imgURL(x)}" alt="">` : ''}
    <label>Denumire<input name="name" value="${esc(x.name)}" required placeholder="ex.: Bormașină Bosch"></label>
    <div id="inv-dup" class="ocr hidden"></div>
    <div class="grid2">
      <label>Bucăți<input name="qty" inputmode="numeric" value="${esc(x.qty ?? 1)}"></label>
      <label>Unde se află<input name="location" list="inv-locs" value="${esc(x.location || '')}" placeholder="Garaj"></label>
    </div>
    <datalist id="inv-locs">${locs.map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
    <label>Stare<select name="status">${INV_STATUSES.map((s2) => `<option value="${s2.key}" ${s2.key === x.status ? 'selected' : ''}>${esc(s2.name)}</option>`).join('')}</select></label>
    <div id="lent-box" class="grid2 ${x.status === 'lent' ? '' : 'hidden'}">
      <label>Împrumutată lui<input name="lentTo" value="${esc(x.lentTo || '')}"></label>
      <label>Din data<input name="lentDate" type="date" value="${esc(x.lentDate || '')}"></label>
    </div>
    <div class="grid2">
      <label>Cumpărată la<input name="purchaseDate" type="date" value="${esc(x.purchaseDate || '')}"></label>
      <label>Preț / buc. (lei)<input name="price" inputmode="decimal" value="${esc(x.price ?? '')}"></label>
    </div>
    <div class="grid2">
      <label>Magazin<input name="store" value="${esc(x.store || '')}"></label>
      <label>Garanție până la<input name="warrantyUntil" type="date" value="${esc(x.warrantyUntil || '')}"></label>
    </div>
    <label>Subcategorie<select name="sub">${SUBCATS.map((c) => `<option value="${c.key}" ${c.key === x.sub ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label>Notițe (serie, accesorii, baterii…)<textarea name="notes" rows="2">${esc(x.notes || '')}</textarea></label>
    <label>Bonul de cumpărare (dovadă pentru garanție)<select name="expenseId">
      <option value="">— fără bon —</option>
      ${state.expenses.filter((e) => !e.isReturn).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 150).map((e) =>
        `<option value="${esc(e.id)}" ${e.id === x.expenseId ? 'selected' : ''}>${fmtDate(e.date)} · ${esc(e.store || '?')} · ${esc(money(e.total))}</option>`).join('')}
    </select></label>
    ${exp ? `<p><button type="button" class="link" data-action="edit-expense" data-id="${esc(exp.id)}">🧾 Vezi bonul (${fmtDate(exp.date)} · ${esc(exp.store || '')} · ${money(exp.total)})</button></p>` : ''}
    ${(x.returns || []).length ? `<p class="muted small">↩️ Returnat ${x.returns.reduce((a, r) => a + r.qty, 0)} buc.</p>` : ''}
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="danger" id="inv-del">Șterge</button>'}
      <button type="button" id="inv-photo">📷 ${x.image ? 'Schimbă poza' : 'Poză'}</button>
      <button class="primary">Salvează</button>
    </div>
  </form>`, (root) => {
    const form = $('#inv-form', root);
    form.status.addEventListener('change', () => {
      $('#lent-box', root).classList.toggle('hidden', form.status.value !== 'lent');
      if (form.status.value === 'lent' && !form.lentDate.value) form.lentDate.value = todayISO();
    });
    const dupCheck = () => {
      const d = findSimilar(form.name.value, state.inventory, { excludeIds: [x.id] });
      const box = $('#inv-dup', root);
      box.classList.toggle('hidden', !d.length);
      box.textContent = d.length ? `⚠️ Ai deja: ${d.slice(0, 3).map((i) => `${i.name}${i.location ? ' (' + i.location + ')' : ''}`).join(', ')}` : '';
    };
    form.name.addEventListener('change', dupCheck);
    if (isNew && x.name) dupCheck();
    // alegerea bonului completează data, magazinul și garanția
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
      if (!(await save('inventory', readInv(form, x)))) return;
      closeModal();
      toast('Salvat în inventar ✔');
    });
  });
}

function readInv(form, x) {
  const status = form.status.value;
  return {
    ...x,
    name: form.name.value.trim(),
    qty: Math.max(0, Math.round(toNum(form.qty.value) ?? 1)),
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

async function photoReceipt(capture = true) {
  const f = await pickFile({ capture });
  if (!f) return;
  const image = await compressImage(f);
  if (!image) return;
  openExpense(newExpense({ image }), { runOcr: true, ocrSource: f });
}

// ---------- kilometraj ----------
function openOdometer(o, { runOcr = false } = {}) {
  const isNew = !state.odometer.some((x) => x.id === o.id);
  openModal(isNew ? 'Kilometraj' : 'Editează kilometraj', `
  <form id="odo-form" class="form">
    ${o.image ? `<img class="preview" src="${imgURL(o)}" alt="bord">` : ''}
    <div id="ocr-status" class="ocr ${runOcr ? '' : 'hidden'}">🔍 Citesc cifrele…</div>
    <label>Mașina<select name="vehicleId" required>${options(state.vehicles, o.vehicleId, '— alege —')}</select></label>
    <div class="grid2">
      <label>Data<input name="date" type="date" value="${esc(o.date)}" required></label>
      <label>Km<input name="km" inputmode="numeric" value="${esc(o.km ?? '')}" required></label>
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
    <label>Mașina<select name="vehicleId">${options(state.vehicles, r.vehicleId, '— general —')}</select></label>
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
      notified: r.dueDate === form.dueDate.value ? (r.notified || []) : [],
    });
    $('#rem-del', root)?.addEventListener('click', async () => { if (await remove('reminders', r.id, 'expirarea')) closeModal(); });
    $('#rem-ics', root)?.addEventListener('click', () => downloadICS([read()], 'expirare.ics'));
    $('#rem-renew', root)?.addEventListener('click', () => {
      const [y, m, d] = form.dueDate.value.split('-').map(Number);
      const years = form.type.value === 'ITP' ? 2 : 1;
      form.dueDate.value = `${y + years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
  const due = RC.dueNotifications(state.reminders, new Date());
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
      if (!(await save('categories', { ...c, name: form.name.value.trim(), color: form.color.value, isFuel, isCar: form.isCar.checked || isFuel, order: c.order ?? state.categories.length }))) return;
      closeModal();
    });
  });
}

function openProject(p) {
  const isNew = !state.projects.some((x) => x.id === p.id);
  const total = state.expenses.filter((e) => e.projectId === p.id).reduce((s, e) => s + (+e.total || 0), 0);
  openModal(isNew ? 'Proiect nou' : 'Editează proiectul', `
  <form id="proj-form" class="form">
    ${isNew ? '' : `<p>Total cheltuit: <b>${money(total)}</b></p>`}
    <label>Nume<input name="name" value="${esc(p.name)}" required placeholder="ex.: Construcție casă"></label>
    <label>Buget (opțional)<input name="budget" inputmode="decimal" value="${esc(p.budget ?? '')}"></label>
    <label>Notițe<textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></label>
    <div class="actions">${isNew ? '' : '<button type="button" class="danger" id="proj-del">Șterge</button>'}<button class="primary">Salvează</button></div>
  </form>`, (root) => {
    const form = $('#proj-form', root);
    $('#proj-del', root)?.addEventListener('click', async () => { if (await remove('projects', p.id, 'proiectul')) closeModal(); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!(await save('projects', { ...p, name: form.name.value.trim(), budget: toNum(form.budget.value), notes: form.notes.value.trim() }))) return;
      closeModal();
    });
  });
}

function openVehicle(v) {
  const isNew = !state.vehicles.some((x) => x.id === v.id);
  openModal(isNew ? 'Mașină nouă' : 'Editează mașina', `
  <form id="veh-form" class="form">
    <label>Nume<input name="name" value="${esc(v.name)}" required placeholder="ex.: Dacia Logan"></label>
    <label>Număr înmatriculare<input name="plate" value="${esc(v.plate || '')}" placeholder="B 123 ABC"></label>
    <label>Carburant<input name="fuelType" list="fuel-types2" value="${esc(v.fuelType || '')}"></label>
    <datalist id="fuel-types2"><option>benzină</option><option>motorină</option><option>GPL</option><option>hibrid</option><option>electric</option></datalist>
    <label>VIN / serie șasiu (opțional)<input name="vin" value="${esc(v.vin || '')}"></label>
    <div class="actions">${isNew ? '' : '<button type="button" class="danger" id="veh-del">Șterge</button>'}<button class="primary">Salvează</button></div>
  </form>`, (root) => {
    const form = $('#veh-form', root);
    $('#veh-del', root)?.addEventListener('click', async () => { if (await remove('vehicles', v.id, 'mașina')) closeModal(); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      state.vehicleId = v.id;
      if (!(await save('vehicles', { ...v, name: form.name.value.trim(), plate: form.plate.value.trim().toUpperCase(), fuelType: form.fuelType.value.trim(), vin: form.vin.value.trim() }))) return;
      closeModal();
    });
  });
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
  out.learned = { itemRules: state.itemRules, itemNames: state.itemNames, storeRules: state.storeRules, cuiCache: state.cuiCache };
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
  render();
  toast('Date șterse');
}

// ---------- evenimente ----------
const actions = {
  'photo-receipt': () => photoReceipt(true),
  'gallery-receipt': () => photoReceipt(false),
  'new-expense': () => openExpense(newExpense()),
  'edit-expense': (el) => openExpense({ ...state.expenses.find((e) => e.id === el.dataset.id) }),
  'new-fuel': async () => {
    if (!(await needVehicle())) return;
    const fuelCat = state.categories.find((c) => c.isFuel);
    openExpense(newExpense({ categoryId: fuelCat?.id || '', vehicleId: state.vehicleId, projectId: '', fuel: { liters: null } }));
  },
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

document.addEventListener('click', (ev) => {
  const nav = ev.target.closest('nav.tabs button');
  if (nav) { state.view = nav.dataset.view; state.listLimit = 100; render(); window.scrollTo(0, 0); return; }
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
  await seed();
  await loadAll();
  render();
  checkReminders();
  setInterval(checkReminders, 3600 * 1000);
  setTimeout(() => backfillThumbs().catch(() => {}), 1500);
}

start();
