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

// sumă cu 2 zecimale, dar nu bucăți din date/ore (23.09.2026, 12.38.40)
const AMOUNT_RE = /(?<![\d.,/:-])(\d{1,3}(?:[ .]\d{3})+|\d+)[,.](\d{2})(?!\d|[.,/:-]\d)/g;

function amountsIn(line) {
  const out = [];
  for (const m of line.matchAll(AMOUNT_RE)) out.push(parseAmount(m[0]));
  return out.filter((n) => Number.isFinite(n));
}

const FUEL_WORDS = /\b(motorina|benzina|diesel|gpl|efix|maxx?motion|ultimate|euro ?diesel|euro ?super|premium ?95|standard ?95|carburant)\b/;

const HEADER_NOISE = /\b(bon|ron)\s*(ne)?f[it]?[it]?scal|fiscal|nefiscal|bine ati venit|welcome|reluare|printare|reimprimare|duplicat|copie|client\b|casa\b|bon vanzare/;

// Forma juridică la finalul rândului (și citită greșit: „S. R. L.”, „SRI”, „5RL”, „S.R.L.-D”)
const LEGAL_FORM = /\b(s\.?\s?r\.?\s?[l1i](\.?\s?-?\s?d)?|5\.?\s?r\.?\s?l|s\.?\s?a|s\.?\s?c\.?\s?s|s\.?\s?n\.?\s?c|s\.?\s?c\.?\s?a|p\.?\s?f\.?\s?a|i\.?\s?[il]|i\.?\s?f|ong|asociatia|cooperativa)\s*\.?\s*$/i;

// Validarea CUI/CIF românesc cu cifra de control (cheia 753217532).
export function validCui(cui) {
  const d = String(cui || '').replace(/^\s*R\s*O\s*/i, '').replace(/\s/g, '');
  if (!/^\d{2,10}$/.test(d)) return false;
  const body = d.slice(0, -1).padStart(9, '0');
  const key = '753217532';
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += +body[i] * +key[i];
  let ctrl = (sum * 10) % 11;
  if (ctrl === 10) ctrl = 0;
  return ctrl === +d.slice(-1);
}

// Dacă CUI-ul citit nu trece verificarea, încearcă o singură cifră confundată de OCR (1/7, 3/8, 5/6, 0/8…);
// acceptă corectura doar dacă e unică.
const CONFUSED = { 0: '86', 1: '7', 2: '7', 3: '8', 5: '6', 6: '58', 7: '12', 8: '0369', 9: '8' };
export function repairCui(digits) {
  if (validCui(digits)) return digits;
  const found = new Set();
  for (let i = 0; i < digits.length; i++) {
    for (const c of CONFUSED[digits[i]] || '') {
      const v = digits.slice(0, i) + c + digits.slice(i + 1);
      if (validCui(v)) found.add(v);
    }
  }
  return found.size === 1 ? [...found][0] : '';
}

// Nume scurt din denumirea oficială: fără forma juridică, cu majusculă doar la început de cuvânt.
export function shortCompanyName(name) {
  const t = String(name || '').replace(/^\s*s\.?\s?c\.?\s+/i, '').replace(LEGAL_FORM, '').replace(/\b(com|impex|trading|group|grup)\b\.?/gi, ' ').replace(/[^\p{L}\p{N}&.\- ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.toLowerCase().replace(/(^|[\s\-.&])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).slice(0, 40);
}

// Magazine cunoscute: numele afișat (uniform, util la analize) și cuvântul după care îl recunoaștem
const BRANDS = [
  ['Hornbach', 'hornbach'], ['Dedeman', 'dedeman'], ['Leroy Merlin', 'leroy'], ['Brico Depot', 'bricodepot'], ['Brico Depot', 'brico depot'],
  ['Praktiker', 'praktiker'], ['Mathaus', 'mathaus'], ['Arabesque', 'arabesque'], ['Kaufland', 'kaufland'], ['Lidl', 'lidl'],
  ['Mega Image', 'mega image'], ['Carrefour', 'carrefour'], ['Auchan', 'auchan'], ['Profi', 'profi'], ['Penny', 'penny'],
  ['Selgros', 'selgros'], ['Metro', 'metro cash'], ['Cora', 'cora'], ['OMV', 'omv'], ['Petrom', 'petrom'], ['Rompetrol', 'rompetrol'],
  ['MOL', 'mol '], ['Lukoil', 'lukoil'], ['Socar', 'socar'], ['Catena', 'catena'], ['Dr. Max', 'dr max'], ['Sensiblu', 'sensiblu'],
  ['Help Net', 'helpnet'], ['Dm', 'dm drogerie'], ['Ikea', 'ikea'], ['Jysk', 'jysk'], ['Altex', 'altex'], ['eMAG', 'emag'],
  ['Flanco', 'flanco'], ['Autonet', 'autonet'], ['Norauto', 'norauto'],
];

export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Coduri fiscale (CUI) ale unor magazine mari: pe bon, CUI-ul e adesea mai lizibil decât numele.
const KNOWN_CUI = { '17777320': 'Hornbach', '2816464': 'Dedeman', '15991149': 'Kaufland', '22891860': 'Lidl' };

// Magazinul după CUI: întâi regulile învățate din corecturile tale, apoi lista de mai sus.
// Tolerează o cifră citită greșit („RO1777 7320”, „ROV7777320”).
export function brandFromCif(text, learned = {}) {
  const t = String(text || '');
  // și varianta cu un singur spațiu eliminat între cifre („RO1777 7320”), dar nu peste rânduri
  const runs = [...new Set([...t.matchAll(/\d{6,10}/g), ...t.replace(/(\d) (?=\d)/g, '$1').matchAll(/\d{6,10}/g)].map((m) => m[0]))];
  const table = { ...KNOWN_CUI, ...Object.fromEntries(Object.entries(learned).map(([k, v]) => [k.replace(/\D/g, ''), v])) };
  for (const exact of [true, false]) {
    for (const r of runs) {
      for (const [cui, name] of Object.entries(table)) {
        if (cui.length < 6) continue;
        if (exact ? r === cui : cui.length >= 7 && Math.abs(r.length - cui.length) <= 1 && levenshtein(r, cui) === 1) return name;
      }
    }
  }
  return '';
}

// Recunoaște un magazin cunoscut și când OCR-ul greșește 1–2 litere („HORNBACU”, „ORBACH”, „H0RNBACH”).
export function findBrand(text) {
  const n = ' ' + normalize(text).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  for (const [name, w] of BRANDS) if (n.includes(' ' + w.trim() + ' ') || (w.includes(' ') && n.includes(' ' + w))) return name;
  const toks = n.trim().split(' ').map((t) => t.replace(/0/g, 'o').replace(/1/g, 'i'));
  for (const [name, w] of BRANDS) {
    if (w.includes(' ') || w.length < 6) continue;
    const max = w.length >= 8 ? 2 : 1;
    if (toks.some((t) => Math.abs(t.length - w.length) <= max && levenshtein(t, w) <= max)) return name;
  }
  return '';
}

// Bon de retur / stornare. Atenție: bonurile normale au în subsol „RETUR MARFĂ ÎN 90 ZILE”,
// deci nu ajunge simplul cuvânt „retur”.
export function isReturnText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => normalize(l).replace(/[^a-z0-9: -]+/g, ' ').replace(/\s+/g, ' ').trim());
  // „retur” citit cu o literă greșită („ratur”, „retor”, „rctur”), dar nu „retur marfă” din subsolul bonurilor normale
  const returWord = (l) => !/retur marfa|marfa/.test(l) && l.split(/[\s:-]+/).some((t) => t.length === 5 && levenshtein(t, 'retur') <= 1 && t !== 'retea');
  const strong = lines.some((l) => /^(bon (de )?)?(retur|storno|stornare|restituire|refund)$/.test(l)
    || /\bmotiv\s*:?\s*\S{0,2}\s*r\w{3,4}\b/.test(l) || /\bstorn(o|are|at)\b/.test(l) || /\b(bon|nota) (de )?retur\b/.test(l) || /\brefund\b/.test(l)
    || /^\W*x*\s*retur\b(?! marfa)/.test(l));
  if (strong) return true;
  // semne mai slabe: cel puțin două dintre ele
  let score = 0;
  if (lines.some(returWord)) score++;
  if (lines.some((l) => /(^|\s)-\s?\d+([.,]\d{1,3})?\s*(buc|bc|kg|pachet|set)\b/.test(l))) score++; // „-1 BUC”
  if (lines.filter((l) => /-\s?\d{1,3}(?:[ .]\d{3})*[.,]\d{2}\b/.test(l)).length >= 2) score++; // mai multe sume negative
  if (lines.some((l) => /semnatura\s*(angajat|delegat)|angajat\s*delegat/.test(l))) score++; // doar pe retururi
  return score >= 2;
}

const STORE_HINTS = [
  { key: 'fuel', words: ['omv', 'petrom', 'rompetrol', 'mol ', 'lukoil', 'socar', 'gazprom', 'benzinaria'] },
  { key: 'house_materials', words: ['dedeman', 'leroy', 'hornbach', 'brico', 'arabesque', 'materiale de constructii', 'praktiker', 'mathaus', 'ciment', 'adeziv', 'bca', 'caramida'] },
  { key: 'car_service', words: ['autonet', 'auto total', 'norauto', 'vulcanizare', 'service auto', 'piese auto', 'ulei motor', 'anvelope'] },
  { key: 'health', words: ['farmacia', 'catena', 'help net', 'helpnet', 'dona', 'sensiblu', 'dr.max', 'dr max'] },
  { key: 'food', words: ['kaufland', 'lidl', 'mega image', 'carrefour', 'auchan', 'profi', 'penny', 'cora', 'selgros', 'metro', 'la doi pasi', 'annabella'] },
];

export function parseReceipt(text, today = new Date(), { storeRules = {} } = {}) {
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const norm = normalize(raw);
  const result = { store: '', storeOfficial: '', date: '', total: null, cif: '', cifValid: false, fuel: null, suggestedCategoryKey: null, isReturn: false };

  // Magazin: linia cu SRL/SA sau un magazin cunoscut; altfel prima linie „curată” din antet
  const letters = (l) => (l.match(/[A-Za-zĂÂÎȘȚăâîșț]/g) || []).length;
  const isNoise = (l) => letters(l) < 4 || letters(l) / l.replace(/\s/g, '').length < 0.6 || HEADER_NOISE.test(normalize(l));
  const head = lines.slice(0, 15);
  // resturi de OCR la începutul rândului („FE LISSE MARKET SRL”, „| HORNBACH”)
  const tidy = (l) => {
    const toks = l.replace(/[|“”"'`~_]+/g, ' ').replace(/\s{2,}/g, ' ').trim().split(' ');
    while (toks.length > 2 && toks[0].length <= 2 && toks[1].length >= 3) toks.shift();
    let t = toks.join(' ').replace(/^[\s.,:;*#+-]+/, '').trim();
    // tot ce urmează după forma juridică e zgomot („LISSE MARKET SRL UL”)
    for (let k = t.length; k > 0; k--) {
      if (LEGAL_FORM.test(t.slice(0, k)) && /^[\s\W\w]{0,4}$/.test(t.slice(k)) && t.slice(k).trim().length <= 3) { t = t.slice(0, k).trim(); break; }
    }
    return t;
  };
  // „DATE FIRMA : LISSE MARKET SRL” – cea mai sigură sursă, când există
  const dateFirma = lines.map((l) => l.match(/(?:\b[a-z]{0,2}te\s*)?\bfirm[ae]\s*[:.]\s*(.{3,})$/i)?.[1]).find(Boolean);
  const legalLine = head.map(tidy).find((l) => LEGAL_FORM.test(l) && !isNoise(l));
  const firma = dateFirma && tidy(dateFirma);
  // „DATE FIRMA” citit cu forma juridică stricată („LISSE MARKET sp O”): antetul cu SRL e mai curat
  const storeLine = (firma && (LEGAL_FORM.test(firma) || !legalLine) && firma)
    || legalLine
    || head.map(tidy).find((l) => STORE_HINTS.some((h) => h.words.some((w) => normalize(l).includes(w.trim()))))
    || head.map(tidy).find((l) => !isNoise(l));

  // CIF: „CUI”/„CIF”/„COD FISCAL” (OCR citește uneori „I” ca „l”/„1”), cu sau fără RO, cifre posibil despărțite de spații
  for (const m of raw.matchAll(/(?:\bC\.?\s*[I1l]\.?\s*F|\bC\.?\s*U\.?\s*[I1lLr]|COD\s+FISCAL|COD\s+IDENTIFICARE\s+FISCALA)\.?\s*[:.]?\s*(R\s*[O0]\s*)?(\d(?:\s?\d){1,9})(?!\d)/gi)) {
    const digits = m[2].replace(/\s/g, '');
    const fixed = repairCui(digits);
    const pref = m[1] ? 'RO' : '';
    if (fixed) { result.cif = pref + fixed; result.cifValid = true; result.cifRepaired = fixed !== digits; break; }
    if (!result.cif) result.cif = pref + digits; // păstrăm prima citire, marcată ca nesigură
  }

  // magazinul: regula învățată / CUI cunoscut > nume recunoscut > rândul cu forma juridică
  const brand = brandFromCif(lines.slice(0, 20).join('\n'), storeRules) || findBrand(lines.slice(0, 15).join('\n'));
  if (storeLine) result.storeOfficial = storeLine.slice(0, 80);
  if (brand) result.store = brand;
  // CUI ilizibil, dar magazinul e recunoscut după nume: luăm CUI-ul cunoscut dacă cifrele citite seamănă
  if (brand && !result.cifValid) {
    const known = Object.entries({ ...KNOWN_CUI, ...Object.fromEntries(Object.entries(storeRules).map(([k, v]) => [k.replace(/\D/g, ''), v])) })
      .find(([cui, name]) => name === brand && validCui(cui));
    const read = result.cif.replace(/\D/g, '');
    if (known && (!read || levenshtein(read, known[0]) <= 2)) {
      result.cif = 'RO' + known[0]; result.cifValid = true; result.cifRepaired = !!read && read !== known[0];
    }
  }
  if (!brand && storeLine) result.store = LEGAL_FORM.test(storeLine) ? shortCompanyName(storeLine) : storeLine.slice(0, 60);

  // Data
  // Data: bonurile o conțin adesea de mai multe ori, iar OCR-ul poate greși o cifră pe un rând.
  // Adunăm toate datele valide, eliminăm datele din viitor și alegem pe cea mai frecventă
  // (la egalitate, pe cea mai recentă).
  const maxDate = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  const counts = new Map();
  const add = (y, m, d) => {
    if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return;
    const v = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (v <= maxDate) counts.set(v, (counts.get(v) || 0) + 1);
  };
  for (const m of raw.matchAll(/(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](20\d{2})(?!\d)/g)) add(m[3], m[2], m[1]);
  for (const m of raw.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) add(m[1], m[2], m[3]);
  const bestDate = [...counts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
  if (bestDate) result.date = bestDate[0];

  // Total: linia cu „TOTAL” (nu SUBTOTAL / TOTAL TVA)
  let total = null;
  let negative = false;
  for (let i = 0; i < lines.length; i++) {
    const n = normalize(lines[i]);
    // „TOTAL” poate fi citit greșit de OCR ca „ITAL”, „T0TAL”, „OTAL” la început de rând
    const isTotal = /\bt[o0]tal\b/.test(n) || /^[^a-z0-9]{0,3}[a-z]{0,2}[o0]?[t1il]al\b\s*[:.]?\s*(lei|ron)?/.test(n);
    if (!isTotal || /subtotal|total\s*tva|tva\s*total|total\s*taxe/.test(n)) continue;
    const unsign = (l) => l.replace(/(\d)([,.])\s(\d{2})(?!\d)/g, '$1$2$3').replace(/-\s*(?=\d)/g, ' ');
    let nums = amountsIn(unsign(lines[i]));
    if (!nums.length && lines[i + 1]) nums = amountsIn(unsign(lines[i + 1]));
    if (nums.length) {
      total = nums[nums.length - 1];
      negative = /-\s*\d[\d .]*[.,]\s?\d{2}\s*\S?\s*$/.test(lines[i]) || (!amountsIn(lines[i]).length && /-\s*\d/.test(lines[i + 1] || ''));
      break;
    }
  }
  // Verificare: dacă totalul apare o singură dată pe bon, dar o sumă care diferă printr-o singură
  // cifră apare de mai multe ori (ex. „-128,00” citit greșit, „129,00” de 4 ori), o alegem pe aceea.
  if (total != null) {
    const freq = new Map();
    for (const a of lines.flatMap((l) => amountsIn(l.replace(/(\d)([,.])\s(\d{2})(?!\d)/g, '$1$2$3').replace(/-\s*(?=\d)/g, ' ')))) freq.set(a.toFixed(2), (freq.get(a.toFixed(2)) || 0) + 1);
    const t = total.toFixed(2);
    if ((freq.get(t) || 0) <= 1) {
      const oneOff = (a, b) => a.length === b.length && [...a].filter((c, k) => c !== b[k]).length === 1;
      const alt = [...freq].filter(([a, c]) => c >= 2 && oneOff(a, t)).sort((x, y) => y[1] - x[1])[0];
      if (alt) total = +alt[0];
    }
  }
  // Suma plătită (CARD / NUMERAR − REST): verifică totalul și îl înlocuiește dacă linia TOTAL e ilizibilă
  let card = 0; let cash = 0; let change = 0;
  for (const l of lines) {
    const n = normalize(l);
    const nums = amountsIn(l.replace(/(\d)([,.])\s(\d{2})(?!\d)/g, '$1$2$3').replace(/-\s*(?=\d)/g, ' '));
    if (!nums.length || /\btva\b|total/.test(n)) continue;
    const v = Math.abs(nums[nums.length - 1]);
    if (/^\W*(card|visa|mastercard|maestro|plata card|card bancar)\b/.test(n)) card = card || v;
    else if (/^\W*(numerar|cash)\b/.test(n)) cash = cash || v;
    else if (/^\W*rest\b/.test(n)) change = change || v;
  }
  let paid = card || cash ? +(card + Math.max(0, cash - change)).toFixed(2) : null;
  // o singură cifră diferită între total și plată e o greșeală de citire, nu o diferență reală
  if (paid != null && total != null) {
    const a = Math.abs(total).toFixed(2); const b = paid.toFixed(2);
    if (a !== b && a.length === b.length && [...a].filter((c, k) => c !== b[k]).length === 1) paid = Math.abs(total);
  }
  result.paid = paid;
  result.totalSource = total != null ? 'total' : paid ? 'plata' : '';
  if (total == null && paid) total = paid;
  if (total == null) {
    const all = lines.filter((l) => !/\d{1,2}[./-]\d{1,2}[./-]20\d{2}/.test(l)).flatMap((l) => amountsIn(l.replace(/(\d)([,.])\s(\d{2})(?!\d)/g, '$1$2$3')));
    if (all.length) { total = Math.max(...all); result.totalSource = 'estimat'; }
  }
  result.isReturn = negative || isReturnText(raw);
  result.total = total != null && result.isReturn ? -Math.abs(total) : total;

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
    const hay = norm + ' ' + normalize(brand) + ' ';
    for (const h of STORE_HINTS) {
      if (h.words.some((w) => hay.includes(w))) { result.suggestedCategoryKey = h.key; break; }
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
    // sufixele lungi („-uri”, „-ele”) doar dacă rămâne o rădăcină de minim 4 litere („mături” → „matur”, nu „mat”)
    if (w.endsWith(s) && w.length - s.length >= (s.length >= 3 ? 4 : 3)) return w.slice(0, -s.length);
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
  const parent = cat?.parentId && ctx.categories.find((c) => c.id === cat.parentId); // „copii” găsește și „Haine”
  const proj = ctx.projects.find((p) => p.id === e.projectId);
  const veh = ctx.vehicles.find((v) => v.id === e.vehicleId);
  // după ce categoriile au pierdut prefixul „Casă –”/„Mașină –”, întrebările „casa” / „mașina” le găsesc tot
  const alias = [
    /^house_/.test(cat?.key || '') || /^house_/.test(parent?.key || '') || proj?.kind === 'house' ? 'casa' : '',
    cat?.isCar || e.vehicleId || proj?.kind === 'vehicle' ? 'masina' : '',
  ];
  const text = [cat?.name, parent?.name, proj?.name, veh?.name, veh?.plate, e.store, e.notes, ...alias].filter(Boolean).join(' ');
  return normalize(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3).map(stem);
}

export function isFuelExpense(e, ctx) {
  if (e.fuel && (e.fuel.liters > 0 || e.fuel.kwh > 0)) return true;
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
  const itemTerms = [];
  const unmatched = [];
  // cuvintele din numele produsului + numele subcategoriei lui („Băuturi”, „Scule & unelte”)
  const itemStems = (i) => {
    const sc = (ctx.subcats || []).find((x) => x.key === i.sub);
    const g = (ctx.groups || []).find((x) => x.key === sc?.group);
    return normalize(`${i.name} ${sc?.name || ''} ${g ? g.name + ' ' + g.alias : ''}`).split(/[^a-z0-9]+/).filter((w) => w.length >= 2).map(stem);
  };
  const hitsItem = (i, term) => itemStems(i).some((s) => stemsMatch(s, term.stem));
  for (const term of q.terms) {
    const anyHit = ctx.expenses.some((e) => expenseStems(e, ctx).some((s) => stemsMatch(s, term.stem)))
      || [...ctx.categories, ...ctx.projects, ...ctx.vehicles].some((o) =>
        normalize(`${o.name} ${o.plate || ''}`).split(/[^a-z0-9]+/).some((w) => w.length >= 3 && stemsMatch(stem(w), term.stem)));
    // un cuvânt care numește o subcategorie de produse („materiale”, „electrice”, „scule”) are prioritate
    // față de categoria bonului, dacă există produse potrivite
    const namesSub = [...(ctx.subcats || []).map((sc) => sc.name), ...(ctx.groups || []).map((g) => g.alias)]
      .some((n) => normalize(n).split(/[^a-z0-9]+/).some((w) => w.length >= 3 && stemsMatch(stem(w), term.stem)));
    if (namesSub && ctx.expenses.some((e) => (e.items || []).some((i) => hitsItem(i, term)))) itemTerms.push(term);
    else if (anyHit) matchedTerms.push(term);
    else if (ctx.expenses.some((e) => (e.items || []).some((i) => hitsItem(i, term)))
      || [...(ctx.subcats || []), ...(ctx.groups || []).map((g) => ({ name: `${g.name} ${g.alias}` }))]
        .some((sc) => normalize(sc.name).split(/[^a-z0-9]+/).some((w) => w.length >= 3 && stemsMatch(stem(w), term.stem)))) itemTerms.push(term);
    else unmatched.push(term.word);
  }
  for (const term of matchedTerms) {
    list = list.filter((e) => expenseStems(e, ctx).some((s) => stemsMatch(s, term.stem)));
  }

  const noMatch = q.terms.length > 0 && matchedTerms.length === 0 && itemTerms.length === 0 && !q.fuel && !q.km;
  if (noMatch) list = [];

  // Întrebare despre produse („unt”, „băuturi luna asta”): adunăm doar produsele potrivite, nu bonul întreg.
  if (itemTerms.length) {
    const items = list.flatMap((e) => (e.items || []).map((i) => ({ ...i, e })))
      .filter((i) => itemTerms.every((t) => hitsItem(i, t)))
      .sort((a, b) => (b.e.date || '').localeCompare(a.e.date || ''));
    const bySub = {};
    for (const i of items) {
      const n = (ctx.subcats || []).find((x) => x.key === i.sub)?.name || 'Altele';
      bySub[n] = (bySub[n] || 0) + (+i.amount || 0);
    }
    const expenses = [...new Set(items.map((i) => i.e))];
    return {
      query: q, label: q.range.label, expenses, items,
      total: +items.reduce((a, i) => a + (+i.amount || 0), 0).toFixed(2),
      liters: 0, byCategory: bySub, byProject: {}, kmInfo: null,
      matchedTerms: [...matchedTerms, ...itemTerms].map((t) => t.word), unmatched, noMatch: false,
    };
  }

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
