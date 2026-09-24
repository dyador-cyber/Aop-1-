// Validarea datelor care intră în aplicație (formulare, backup-uri importate).
// Tot ce nu respectă formatul așteptat este eliminat sau înlocuit cu o valoare sigură,
// astfel încât un fișier de backup modificat rău-intenționat să nu poată injecta cod.

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const str = (v, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : '');
const id = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : typeof v === 'number' && Number.isInteger(v) ? String(v) : '');
const numOrNull = (v, min = -1e12, max = 1e12) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const date = (v) => (typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : '');
const bool = (v) => v === true;
const time = (v) => numOrNull(v, 0, 1e14);
const image = (v) => (typeof Blob !== 'undefined' && v instanceof Blob && IMAGE_TYPES.includes(v.type) && v.size <= 15e6 ? v : null);

const SCHEMAS = {
  expenses: (o) => ({
    id: id(o.id), date: date(o.date), total: numOrNull(o.total, -1e9, 1e9), store: str(o.store, 120),
    categoryId: id(o.categoryId), projectId: id(o.projectId), vehicleId: id(o.vehicleId),
    notes: str(o.notes, 2000), ocrText: str(o.ocrText, 20000), image: image(o.image),
    fuel: o.fuel && typeof o.fuel === 'object' ? {
      liters: numOrNull(o.fuel.liters, 0, 1e5), pricePerLiter: numOrNull(o.fuel.pricePerLiter, 0, 1e4),
      km: numOrNull(o.fuel.km, 0, 1e8), fuelType: str(o.fuel.fuelType, 30),
    } : null,
    createdAt: time(o.createdAt), updatedAt: time(o.updatedAt),
  }),
  odometer: (o) => ({ id: id(o.id), vehicleId: id(o.vehicleId), date: date(o.date), km: numOrNull(o.km, 0, 1e8), notes: str(o.notes, 500), image: image(o.image) }),
  vehicles: (o) => ({ id: id(o.id), name: str(o.name, 80), plate: str(o.plate, 20), fuelType: str(o.fuelType, 30), vin: str(o.vin, 40) }),
  reminders: (o) => ({
    id: id(o.id), type: str(o.type, 40), title: str(o.title, 120), dueDate: date(o.dueDate), vehicleId: id(o.vehicleId),
    notifyDays: (Array.isArray(o.notifyDays) ? o.notifyDays : []).map((n) => numOrNull(n, 0, 3650)).filter((n) => n !== null).map(Math.round).slice(0, 10),
    notes: str(o.notes, 2000),
    notified: (Array.isArray(o.notified) ? o.notified : []).map((k) => str(k, 40)).filter(Boolean).slice(-100),
    done: bool(o.done),
  }),
  tasks: (o) => ({
    id: id(o.id), title: str(o.title, 120), date: date(o.date), projectId: id(o.projectId),
    items: (Array.isArray(o.items) ? o.items : []).slice(0, 500)
      .map((i) => ({ id: id(i?.id), text: str(i?.text, 300), done: bool(i?.done) }))
      .filter((i) => i.id && i.text),
    createdAt: time(o.createdAt),
  }),
  categories: (o) => ({
    id: id(o.id), key: str(o.key, 30), name: str(o.name, 80), color: COLOR_RE.test(o.color) ? o.color : '#607d8b',
    isCar: bool(o.isCar), isFuel: bool(o.isFuel), order: numOrNull(o.order, 0, 1e6),
  }),
  projects: (o) => ({ id: id(o.id), name: str(o.name, 80), budget: numOrNull(o.budget, 0, 1e12), notes: str(o.notes, 2000) }),
};

// Returnează obiectul curățat sau null dacă nu poate fi folosit.
export function sanitize(store, obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !SCHEMAS[store]) return null;
  const clean = SCHEMAS[store](obj);
  if (!clean.id) return null;
  if (store === 'reminders' && !clean.dueDate) return null;
  if (store === 'expenses' && !clean.date) return null;
  if (store === 'odometer' && (!clean.date || clean.km === null)) return null;
  if ((store === 'categories' || store === 'projects' || store === 'vehicles') && !clean.name) return null;
  return clean;
}

// Acceptă doar imagini raster (nu SVG, care poate conține cod) din data: URL-uri.
export function safeImageDataURL(v) {
  return typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 20e6;
}

// Protecție „CSV/formula injection”: Excel nu va executa celule care încep cu = + - @.
export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

// Escapare text pentru fișiere calendar (RFC 5545).
export function icsText(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n|\r/g, '\\n');
}
