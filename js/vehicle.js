// Vehicule: tipuri, citirea talonului / cărții de identitate (CIV), VIN, eticheta anvelopelor,
// expirările standard și importul drumurilor din Google Timeline. Doar calcule, fără interfață.
// Datele personale ale proprietarului (câmpurile C.* de pe talon) nu sunt citite și nu se păstrează.

export const VEHICLE_TYPES = [
  { key: 'car', name: 'Autoturism (benzină / motorină / GPL)', icon: '🚗', energy: 'fuel', meter: 'km' },
  { key: 'electric', name: 'Electric', icon: '🔌', energy: 'electric', meter: 'km' },
  { key: 'hybrid', name: 'Hibrid plug-in', icon: '🚙', energy: 'both', meter: 'km' },
  { key: 'moto', name: 'Motocicletă / scuter', icon: '🏍️', energy: 'fuel', meter: 'km' },
  { key: 'machine', name: 'Utilaj / tractor (ore de funcționare)', icon: '🚜', energy: 'fuel', meter: 'h' },
];
export const typeOf = (k) => VEHICLE_TYPES.find((t) => t.key === k) || VEHICLE_TYPES[0];
export const meterUnit = (v) => typeOf(v?.type).meter; // 'km' sau 'h'

// ---------- VIN ----------
// 17 caractere, fără I, O, Q (se confundă cu 1 și 0)
export const validVin = (v) => /^[A-HJ-NPR-Z0-9]{17}$/.test(v || '');
const fixVin = (s) => s.replace(/[OQ]/g, '0').replace(/I/g, '1');
export function cleanVin(raw) {
  const up = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const v = fixVin(up);
  if (validVin(v)) return v;
  // OCR a citit un caracter în plus („1L” → „1IL”): încercăm fără câte un I / L / 1
  if (up.length === 18) {
    for (let i = 0; i < up.length; i++) {
      if (!'IL1'.includes(up[i])) continue;
      const w = fixVin(up.slice(0, i) + up.slice(i + 1));
      if (validVin(w)) return w;
    }
  }
  return '';
}
function findVin(text) {
  const up = String(text || '').toUpperCase();
  for (const m of up.matchAll(/[A-Z0-9][A-Z0-9 ]{15,22}[A-Z0-9]/g)) {
    const v = cleanVin(m[0].replace(/\s/g, ''));
    // un VIN are și litere și cifre
    if (v && /[A-Z]/.test(v) && /\d{4}/.test(v)) return v;
  }
  return '';
}

// ---------- talon / CIV ----------
const FUELS = [
  ['motorină', /motorin|diesel|gasoil/i],
  ['benzină', /benzin|petrol|gasolin/i],
  ['GPL', /\bgpl\b|\blpg\b/i],
  ['electric', /electric/i],
  ['hibrid', /hibrid|hybrid/i],
];
const fuelFrom = (s) => FUELS.find(([, re]) => re.test(s || ''))?.[0] || '';
const clean = (s) => String(s || '').replace(/[|_"'`~]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

// Caută valoarea unui câmp: după codul european („D.1 DACIA”) sau după eticheta din CIV („Marca: DACIA”).
function field(lines, codes, labels) {
  for (const l of lines) {
    for (const c of codes) {
      const re = new RegExp(`^\\W{0,3}${c.replace('.', '\\s?[.,]\\s?')}(?![.,]?\\d)\\s*[:.)-]?\\s+(.+)$`, 'i');
      const m = l.match(re);
      if (m) return clean(m[1]);
    }
    for (const lab of labels) {
      const m = l.match(new RegExp(`${lab}\\s*[:.]\\s*(.+)$`, 'i'));
      if (m) return clean(m[1]);
    }
  }
  return '';
}

export function parseRegistration(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = {};
  const plateRaw = field(lines, ['A'], ['nr\\.? de inmatriculare', 'numar de inmatriculare', 'nr\\.? inmatriculare']) || String(text || '');
  const pm = plateRaw.toUpperCase().match(/\b(B|[A-Z]{2})\s?-?\s?(\d{2,3})\s?-?\s?([A-Z]{3})\b/);
  if (pm) out.plate = `${pm[1]} ${pm[2]} ${pm[3]}`;
  const b = field(lines, ['B'], ['data primei inmatriculari']);
  const dm = (b || '').match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (dm) out.firstReg = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
  const make = field(lines, ['D.1'], ['marca']);
  if (make) out.make = make.split(/\s+/).slice(0, 3).join(' ').slice(0, 40);
  const model = field(lines, ['D.3'], ['denumire comerciala', 'model']);
  if (model) out.model = model.slice(0, 40);
  out.vin = cleanVin(field(lines, ['E'], ['nr\\.? de identificare', 'serie sasiu', 'vin'])) || findVin(text);
  if (!out.vin) delete out.vin;
  const cc = field(lines, ['P.1'], ['capacitate cilindrica', 'cilindree']).match(/\d{2,5}/);
  if (cc) out.engineCc = +cc[0];
  const kw = field(lines, ['P.2'], ['putere(?: neta)?(?: maxima)?']).match(/\d{1,4}(?:[.,]\d)?/);
  if (kw) out.powerKw = +kw[0].replace(',', '.');
  const fuel = fuelFrom(field(lines, ['P.3'], ['combustibil', 'sursa de energie'])) || fuelFrom(text);
  if (fuel) out.fuelType = fuel;
  const cat = field(lines, ['J'], ['categoria']).toUpperCase().replace(/^([MNLTO])[IL]\b/, '$11').match(/\b([MNLTO]\d?[A-Z]?)\b/);
  if (cat) out.category = cat[1];
  return out;
}

// Eticheta de pe ușa șoferului: mărimea anvelopelor și presiunile (bar, kPa sau psi → bar)
export function parseTyreSticker(text) {
  let t = String(text || '').replace(/,/g, '.');
  const out = {};
  const sz = t.match(/(\d{3})\s?\/\s?(\d{2})\s?Z?R\s?(\d{2})/i);
  if (sz) { out.tyreSize = `${sz[1]}/${sz[2]} R${sz[3]}`; t = t.replace(sz[0], ' '); }
  const bars = [];
  for (const m of t.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{1,2})?)\s?(bar|kpa|psi)?(?![\d.])/gi)) {
    const n = +m[1];
    const u = (m[2] || '').toLowerCase();
    let v = null;
    if (u === 'bar' || (!u && n >= 1.5 && n <= 4)) v = n;
    else if (u === 'kpa' || (!u && n >= 150 && n <= 400)) v = n / 100;
    else if (u === 'psi' || (!u && n >= 22 && n <= 58)) v = n / 14.504;
    if (v != null && v >= 1.5 && v <= 4) bars.push(+v.toFixed(1));
  }
  if (bars.length) { out.pressureFront = bars[0]; out.pressureRear = bars[1] ?? bars[0]; }
  return out;
}

// Decodare VIN gratuită (NHTSA). Se trimite doar VIN-ul, și doar când apeși butonul.
export function parseVpic(json) {
  const r = json?.Results?.[0];
  if (!r || typeof r !== 'object') return null;
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const out = {};
  if (s(r.Make)) out.make = s(r.Make).slice(0, 40);
  if (s(r.Model)) out.model = s(r.Model).slice(0, 40);
  if (/^\d{4}$/.test(s(r.ModelYear))) out.year = +r.ModelYear;
  const cc = parseFloat(s(r.DisplacementCC));
  if (cc > 0) out.engineCc = Math.round(cc);
  const f = fuelFrom(`${s(r.FuelTypePrimary)} ${s(r.ElectrificationLevel)}`);
  if (f) out.fuelType = f;
  return Object.keys(out).length ? out : null;
}
export async function decodeVin(vin) {
  if (!validVin(vin)) throw new Error('VIN invalid');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return parseVpic(await res.json());
  } finally { clearTimeout(timer); }
}

// ---------- expirări ----------
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function addYears(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return `${y + n}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// Schimbul anvelopelor: iarna de la 1 noiembrie, vara de la 1 aprilie (data orientativă)
export function nextTyreSeason(today = new Date()) {
  const y = today.getFullYear();
  const t = iso(today);
  if (t < `${y}-04-01`) return { dueDate: `${y}-04-01`, title: 'Anvelope de vară' };
  if (t < `${y}-11-01`) return { dueDate: `${y}-11-01`, title: 'Anvelope de iarnă' };
  return { dueDate: `${y + 1}-04-01`, title: 'Anvelope de vară' };
}
export function renewTyre(r) {
  const [y] = r.dueDate.split('-').map(Number);
  return /iarn/i.test(r.title) ? { dueDate: `${y + 1}-04-01`, title: 'Anvelope de vară' } : { dueDate: `${y}-11-01`, title: 'Anvelope de iarnă' };
}
export const SERVICE_DEFAULTS = { car: 15000, electric: 30000, hybrid: 15000, moto: 6000, machine: 250 };

// Expirările care lipsesc pentru un vehicul (RCA, ITP, rovinietă, extinctor, trusă, revizie, anvelope).
export function standardReminders(v, existing, { today = new Date(), lastKm = null, uid } = {}) {
  const t = iso(today);
  const inYear = addYears(t, 1);
  const kind = v.type || 'car';
  const has = (type) => existing.some((r) => r.vehicleId === v.id && r.type === type && !r.done);
  const list = [];
  const add = (type, extra = {}) => { if (!has(type)) list.push({ id: uid(), type, title: extra.title || type, dueDate: extra.dueDate || inYear, vehicleId: v.id, notifyDays: extra.notifyDays || [30, 7, 1], notified: [], notes: extra.notes || '', ...extra }); };
  add('RCA', { notes: 'Pune data de pe polița RCA.' });
  if (kind !== 'machine') add('ITP', { notes: 'Pune data de pe talon / certificatul ITP.' });
  if (['car', 'electric', 'hybrid'].includes(kind)) add('Rovinietă');
  if (kind !== 'moto') add('Extinctor', { notes: 'Verifică data de pe eticheta extinctorului.' });
  if (['car', 'electric', 'hybrid'].includes(kind)) add('Trusă prim ajutor', { notes: 'Data de expirare de pe trusă.' });
  const every = v.serviceKm || SERVICE_DEFAULTS[kind] || 15000;
  add('Revizie', { title: kind === 'machine' ? 'Revizie (ore motor)' : 'Revizie', dueDate: addYears(t, 1), dueKm: lastKm != null ? lastKm + every : null, notes: `La fiecare ${every} ${kind === 'machine' ? 'ore' : 'km'} sau un an.` });
  if (['car', 'electric', 'hybrid'].includes(kind)) {
    const s = nextTyreSeason(today);
    add('Anvelope', { title: s.title, dueDate: s.dueDate, notifyDays: [14, 3] });
  }
  return list;
}

// ---------- Google Timeline ----------
// Din exportul Timeline (Takeout „Semantic Location History” sau „Timeline.json” de pe telefon)
// păstrăm doar kilometrii parcurși cu mașina pe fiecare zi. Locurile și traseele nu se salvează.
const DRIVE = /vehicle|driving|motorcycl|car|taxi/i;
export function parseTimeline(json) {
  const days = {};
  const add = (start, meters, type) => {
    if (!DRIVE.test(String(type || '')) || !(meters > 0)) return;
    const d = String(start || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    days[d] = +((days[d] || 0) + meters / 1000).toFixed(1);
  };
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    if (o.activitySegment) { const a = o.activitySegment; add(a.duration?.startTimestamp || a.duration?.startTimestampMs && new Date(+a.duration.startTimestampMs).toISOString(), +a.distance, a.activityType); return; }
    if (o.activity && (o.startTime || o.endTime)) { const a = o.activity; add(o.startTime, +(a.distanceMeters ?? a.distance), a.topCandidate?.type || a.type); return; }
    for (const k of ['timelineObjects', 'semanticSegments']) if (o[k]) walk(o[k], depth + 1);
  };
  walk(json);
  return days;
}
