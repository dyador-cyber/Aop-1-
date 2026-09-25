// Verificarea firmei la ANAF după CUI (serviciul public și gratuit „PlatitorTva”).
// Se trimite DOAR codul fiscal al firmei de pe bon și data. Rezultatul e păstrat pe telefon,
// deci același CUI se verifică o singură dată. Dacă ANAF nu răspunde, aplicația merge mai departe
// cu datele citite de pe bon, fără să deranjeze utilizatorul.

// ANAF a schimbat în timp versiunea serviciului; încercăm întâi varianta nouă, apoi pe cea veche.
const ENDPOINTS = [
  'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva',
  'https://webservicesp.anaf.ro/PlatitorTvaRest/api/v8/ws/tva',
];
const TIMEOUT_MS = 8000;

// Caută recursiv o cheie în răspuns (structura diferă între versiuni).
function findKey(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return undefined;
  if (typeof obj[key] === 'string' && obj[key].trim()) return obj[key].trim();
  for (const v of Object.values(obj)) {
    const r = findKey(v, key, depth + 1);
    if (r) return r;
  }
  return undefined;
}

// Extrage denumirea și adresa din răspunsul ANAF. Exportată pentru teste.
export function parseAnafResponse(json) {
  const found = Array.isArray(json?.found) ? json.found[0] : null;
  if (!found) return null;
  const name = findKey(found, 'denumire');
  if (!name) return null;
  const address = findKey(found, 'adresa') || findKey(found, 'adresa_sediu_social') || '';
  return { name: name.slice(0, 120), address: address.replace(/\s+/g, ' ').slice(0, 200) };
}

// Returnează { name, address } sau null (negăsit / serviciu indisponibil).
export async function lookupCui(cui, date = new Date()) {
  const digits = String(cui || '').replace(/\D/g, '');
  if (!digits) return null;
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const body = JSON.stringify([{ cui: Number(digits), data: day }]);
  let lastError;
  for (const url of ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal, referrerPolicy: 'no-referrer', credentials: 'omit' });
      if (!res.ok) { lastError = new Error('HTTP ' + res.status); continue; }
      const parsed = parseAnafResponse(await res.json());
      return parsed ? { ...parsed, ok: true } : { ok: true, notFound: true };
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('ANAF indisponibil');
}
