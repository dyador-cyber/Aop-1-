// Produsele de pe bon: extragerea rândurilor și încadrarea pe subcategorii.
import { normalize, parseAmount } from './parsers.js';

export { isReturnText } from './parsers.js';

// Subcategorii de produse. Cuvintele-cheie sunt fără diacritice; un cuvânt de minim 4 litere
// se potrivește și ca început de cuvânt („surubelnit” → „șurubelniță”, „surubelnite”).
export const SUBCATS = [
  { key: 'tools', name: 'Scule & unelte', color: '#455a64', words: ['burghiu', 'burghie', 'bit', 'biti', 'surubelnit', 'ciocan', 'bormasin', 'flex', 'polizor', 'fierastrau', 'panza', 'cheie', 'chei', 'clesti', 'clest', 'patent', 'cutter', 'ruleta', 'nivela', 'boloboc', 'spaclu', 'mistrie', 'disc taiere', 'disc', 'trusa', 'set scule', 'menghina', 'capsator', 'pistol silicon', 'autofiletant', 'imbus', 'lanterna', 'scara'] },
  { key: 'materials', name: 'Materiale construcții', color: '#8d6e63', words: ['ciment', 'adeziv', 'bca', 'caramida', 'boltari', 'mortar', 'glet', 'var', 'nisip', 'pietris', 'beton', 'fier beton', 'otel beton', 'plasa sudata', 'plasa', 'polistiren', 'vata minerala', 'vata bazaltica', 'rigips', 'gips', 'gipscarton', 'profil', 'cuie', 'surub', 'suruburi', 'diblu', 'dibluri', 'ancora', 'spuma', 'silicon', 'chit', 'gresie', 'faianta', 'parchet', 'osb', 'cherestea', 'scandura', 'grinda', 'rigla', 'tigla', 'membrana', 'hidroizolatie', 'sapa', 'amorsa', 'izolatie', 'tencuiala', 'coltar', 'bitum', 'dala', 'pavaj', 'bordura'] },
  { key: 'electrical', name: 'Electrice', color: '#f9a825', words: ['cablu', 'conductor', 'priza', 'intrerupator', 'bec', 'led', 'doza', 'siguranta', 'prelungitor', 'stecher', 'tablou electric', 'corp iluminat', 'lampa', 'lustra', 'banda led', 'baterii', 'acumulator', 'incarcator', 'wago', 'copex', 'tub flexibil'] },
  { key: 'plumbing', name: 'Instalații sanitare', color: '#0288d1', words: ['teava', 'tevi', 'fiting', 'cot', 'mufa', 'robinet', 'baterie lavoar', 'baterie dus', 'baterie', 'sifon', 'vas wc', 'lavoar', 'cada', 'cabina dus', 'para dus', 'pvc', 'ppr', 'racord', 'garnitura', 'pompa', 'boiler', 'calorifer', 'radiator', 'teflon', 'canalizare', 'rezervor wc'] },
  { key: 'paint', name: 'Vopsele & finisaje', color: '#ab47bc', words: ['vopsea', 'lavabil', 'lavabila', 'email', 'grund', 'pensula', 'pensule', 'trafalet', 'diluant', 'lac', 'bait', 'tencuiala decorativa', 'banda mascare', 'folie protectie', 'hartie abraziva', 'smirghel', 'tava vopsea'] },
  { key: 'garden', name: 'Grădină', color: '#558b2f', words: ['furtun', 'gazon', 'seminte gazon', 'pamant flori', 'substrat', 'ghiveci', 'ingrasamant', 'grebla', 'foarfeca gradina', 'stropitoare', 'flori', 'rasad', 'motocoasa', 'sapaliga', 'lopata', 'roaba', 'tarus'] },
  { key: 'cleaning', name: 'Curățenie & detergenți', color: '#00897b', words: ['detergent', 'balsam rufe', 'clor', 'domestos', 'bref', 'laveta', 'lavete', 'burete', 'bureti', 'matura', 'maturi', 'faras', 'mop', 'galeata', 'saci menajeri', 'saci gunoi', 'saci', 'hartie igienica', 'prosoape hartie', 'servetele', 'dezinfectant', 'odorizant', 'ariel', 'persil', 'lenor', 'fairy', 'pronto', 'vanish', 'calgon', 'tablete vase', 'solutie geamuri', 'solutie curatat', 'mr proper', 'cilit', 'perie', 'manusi menaj'] },
  { key: 'hygiene', name: 'Igienă personală', color: '#ec407a', words: ['sampon', 'gel dus', 'sapun', 'pasta dinti', 'periuta', 'deodorant', 'spuma ras', 'aparat ras', 'lame ras', 'crema', 'absorbante', 'scutece', 'tampoane', 'dischete', 'betisoare', 'apa micelara', 'antiperspirant'] },
  { key: 'dairy', name: 'Lactate & ouă', color: '#fbc02d', words: ['lapte', 'unt', 'iaurt', 'branza', 'smantana', 'cascaval', 'oua', 'ou', 'telemea', 'kefir', 'sana', 'mozzarella', 'parmezan', 'frisca', 'urda', 'cas', 'margarina', 'zuzu', 'napolact', 'danone', 'covalact', 'olympus', 'hochland'] },
  { key: 'meat', name: 'Carne & pește', color: '#c62828', words: ['carne', 'pui', 'piept', 'pulpe', 'porc', 'vita', 'vitel', 'miel', 'curcan', 'carnati', 'carnaciori', 'salam', 'sunca', 'parizer', 'crenvursti', 'bacon', 'kaiser', 'mici', 'tocatura', 'tocata', 'ceafa', 'cotlet', 'muschi', 'pastrama', 'peste', 'somon', 'ton', 'macrou', 'hering', 'creveti', 'pate', 'lebar', 'caltabos', 'toba'] },
  { key: 'bakery', name: 'Panificație', color: '#a1887f', words: ['paine', 'franzela', 'chifla', 'chifle', 'covrig', 'covrigi', 'croissant', 'lipie', 'bagheta', 'cozonac', 'blat', 'toast', 'baton', 'painici', 'pateu', 'placinta', 'foietaj'] },
  { key: 'produce', name: 'Fructe & legume', color: '#43a047', words: ['mere', 'mar', 'banane', 'banana', 'rosii', 'cartofi', 'ceapa', 'usturoi', 'castraveti', 'ardei', 'portocale', 'lamai', 'lamaie', 'morcovi', 'varza', 'salata', 'spanac', 'dovlecei', 'vinete', 'struguri', 'pere', 'piersici', 'kiwi', 'ciuperci', 'patrunjel', 'marar', 'pepene', 'capsuni', 'afine', 'avocado', 'broccoli', 'conopida', 'telina', 'mandarine', 'grepfrut', 'prune', 'cirese', 'visine', 'caise', 'ridichi', 'sfecla', 'praz'] },
  { key: 'drinks', name: 'Băuturi', color: '#1e88e5', words: ['apa minerala', 'apa plata', 'apa', 'suc', 'cola', 'pepsi', 'fanta', 'sprite', 'bere', 'vin', 'cafea', 'ceai', 'energizant', 'redbull', 'red bull', 'borsec', 'dorna', 'bucovina', 'aqua carpatica', 'izvorul', 'whisky', 'vodka', 'rom', 'tuica', 'palinca', 'lichior', 'sampanie', 'prosecco', 'nectar', 'limonada', 'ursus', 'timisoreana', 'heineken', 'tuborg', 'bergenbier', 'stella', 'jacobs', 'lavazza', 'nescafe', 'doncafe', 'tchibo', 'lipton', 'schweppes', 'mirinda', '7up', 'coca'] },
  { key: 'sweets', name: 'Dulciuri & snacks', color: '#d81b60', words: ['ciocolata', 'biscuiti', 'napolitane', 'chips', 'bomboane', 'inghetata', 'prajitura', 'tort', 'alune', 'arahide', 'covrigei', 'popcorn', 'guma', 'milka', 'oreo', 'kinder', 'poiana', 'rom baton', 'eugenia', 'saratele', 'pufuleti', 'croissant umplut', 'strudel', 'gogoasa'] },
  { key: 'staples', name: 'Alimente de bază', color: '#ef6c00', words: ['faina', 'zahar', 'ulei', 'orez', 'paste', 'spaghete', 'malai', 'sare', 'piper', 'conserva', 'conserve', 'boia', 'otet', 'maioneza', 'ketchup', 'mustar', 'sos', 'supa', 'bulion', 'pasta tomate', 'fasole', 'linte', 'naut', 'mazare', 'porumb', 'cereale', 'fulgi', 'miere', 'gem', 'dulceata', 'drojdie', 'praf copt', 'condimente', 'masline'] },
  { key: 'auto', name: 'Auto', color: '#3949ab', words: ['ulei motor', 'antigel', 'lichid parbriz', 'stergatoare', 'anvelope', 'anvelopa', 'motorina', 'benzina', 'aditiv', 'filtru ulei', 'filtru aer', 'filtru polen', 'placute frana', 'odorizant auto', 'polish', 'ceara auto'] },
  { key: 'pets', name: 'Animale', color: '#6d4c41', words: ['hrana caini', 'hrana pisici', 'hrana', 'whiskas', 'pedigree', 'friskies', 'purina', 'nisip pisici', 'litiera'] },
  { key: 'other', name: 'Altele', color: '#757575', words: [] },
];
export const SUBCAT_KEYS = new Set(SUBCATS.map((s) => s.key));
export const subcatByKey = (k) => SUBCATS.find((s) => s.key === k) || SUBCATS[SUBCATS.length - 1];

const tokens = (s) => normalize(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);

// Cheia după care se memorează corecturile utilizatorului: primele 3 cuvinte din nume.
export function itemKey(name) {
  return tokens(name).filter((t) => /[a-z]/.test(t)).slice(0, 3).join(' ');
}

// Alege subcategoria cu cel mai lung cuvânt-cheie potrivit (ex. „nisip pisici” bate „nisip”).
export function classifyItem(name, learned = {}) {
  const key = itemKey(name);
  if (key && learned[key] && SUBCAT_KEYS.has(learned[key])) return learned[key];
  const toks = tokens(name);
  const joined = ' ' + toks.join(' ') + ' ';
  let best = 'other';
  let bestLen = 0;
  for (const sc of SUBCATS) {
    for (const w of sc.words) {
      let hit = false;
      if (w.includes(' ')) hit = joined.includes(' ' + w);
      else hit = toks.some((t) => t === w || (w.length >= 4 && t.startsWith(w)));
      if (hit && w.length > bestLen) { best = sc.key; bestLen = w.length; }
    }
  }
  return best;
}

// Rânduri care nu sunt produse.
const SKIP = /\b(total|subtotal|tva|t v a|card|numerar|cash|rest|plata|cif|cui|c i f|nr bon|bon fiscal|bon nefiscal|casier|casa|data|ora|visa|mastercard|maestro|contactless|auth|terminal|clerk|pin|aid|sale|thank|multumim|cod fiscal|reg com|adresa|tel|www|http|articole|puncte|client|fidelitate|sold|operator|cardholder|copy|debit|credit|retain|records|garantie|colectare|deee|valoare|achitat|bonuri valorice|tichete|sector|judet|municipiul|str|strada|bld|soseaua|nr inreg|id unic|serie|ean|art|motiv|ron|lei|brut|net|semnatura|angajat|delegat|livrare|facturare|casier|cod)\b/;
const DISCOUNT = /\b(reducere|discount|promo|cupon|voucher)\b/;
const AMOUNT_END = /(-?\s?\d{1,3}(?:[ .]\d{3})*[.,]\d{2}|-?\s?\d+[.,]\d{2})\s*(?:[A-Ea-e]\b|\*)?\s*$/;
// rând de cantitate unde numărul din față e citit greșit („A Bic. x 129,00” în loc de „-1 BUC. X 129,00”)
const QTY_UNIT = /\b(buc|bc|bic|bue|kg|set|pach|rola|sac)\b\.?\s*[xX×*]\s*(\d+(?:[.,]\d{1,3})?)/i;
const QTY = /(-?\d+(?:[.,]\d{1,3})?)\s*(buc|bc|kg|g|l|ml|m|m2|mp|set|pach|pac|rola|sac)?\.?\s*[xX×*]\s*(\d+(?:[.,]\d{1,3})?)/i;

function cleanName(s) {
  return s
    .replace(/^\s*\d{4,}\s*/, '') // coduri de produs / EAN la început
    .replace(/[|"'`~_=<>{}()[\]\\]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s.,:;*#+-]+|[\s.,:;*#+-]+$/g, '')
    .slice(0, 80);
}
const letterCount = (s) => (s.match(/[A-Za-zĂÂÎȘȚăâîșț]/g) || []).length;

// Extrage produsele: { name, qty, unitPrice, amount }.
// Formate acceptate (cele mai frecvente pe bonurile din România):
//   „PAINE ALBA 400G            3,50 A”
//   „LAPTE ZUZU 1L” + rândul următor „2,000 BUC x 7,49      14,98 B”
//   „2.000 x 7.49” + rândul următor „LAPTE ZUZU            14,98 B”
//   „CIMENT 40KG 10 x 32,50     325,00”
export function parseItems(text, { isReturn = false } = {}) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/[|"'`_~]+\s*$/g, '').trim()).filter(Boolean);
  const items = [];
  let pendingName = null;
  let pendingQty = null;
  let started = false;
  // o cantitate rămasă fără rând de sumă: produsul e numele de deasupra, suma = cantitate × preț
  const flush = () => {
    if (pendingQty?.name && Number.isFinite(pendingQty.qty) && Number.isFinite(pendingQty.unit)) {
      items.push({ name: pendingQty.name, qty: pendingQty.qty, unitPrice: pendingQty.unit, amount: +(pendingQty.qty * pendingQty.unit).toFixed(2) });
      started = true;
    }
    pendingQty = null;
  };
  for (const line of lines) {
    const n = normalize(line).replace(/[^a-z0-9 ]+/g, ' ');
    if (/\b(sub)?t[o0]tal\b|^\W*[it1l]?tal\b/.test(n.trim()) && (started || pendingQty)) break; // produsele se termină la TOTAL
    if (/\d{1,2}[./-]\d{1,2}[./-](20)?\d{2}\b/.test(line) || /\d{1,2}:\d{2}/.test(line)) { pendingName = null; continue; }
    const isDiscount = DISCOUNT.test(n);
    if (/\d{8,}/.test(line.replace(/\s/g, '')) && !AMOUNT_END.test(line)) continue; // coduri EAN, nr. bon
    if (!isDiscount && SKIP.test(n)) { flush(); pendingName = null; continue; }

    const tail = line.match(AMOUNT_END);
    let q = line.match(QTY);
    if (!q) {
      const u = line.match(QTY_UNIT);
      // forma lui q: [potrivire, cantitate, unitate, preț]
      if (u) q = Object.assign([u[0], '1', u[1], u[2]], { index: u.index });
    }
    // rând doar cu cantitate × preț (fără sumă separată)
    const qtyOnly = q && (!tail || tail.index < q.index + q[0].length);
    let namePart = line;
    if (q) namePart = namePart.replace(q[0], ' ');
    if (tail && !qtyOnly) namePart = namePart.slice(0, Math.max(0, namePart.length - (line.length - tail.index)));
    namePart = cleanName(namePart);
    const hasName = letterCount(namePart) >= 3 && letterCount(namePart) / namePart.replace(/\s/g, '').length >= 0.5;
    const qty = q ? parseAmount(q[1]) : null;
    const unit = q ? parseAmount(q[3]) : null;

    if (tail && !qtyOnly) {
      let amount = parseAmount(tail[1]);
      if (!Number.isFinite(amount)) continue;
      if (isDiscount) amount = -Math.abs(amount);
      const name = hasName ? namePart : (pendingQty?.name || pendingName);
      if (!name) { pendingQty = null; continue; }
      const use = q ? { qty, unit } : pendingQty ? { qty: pendingQty.qty, unit: pendingQty.unit } : { qty: null, unit: null };
      // suma trebuie să fie cantitate × preț; dacă OCR-ul a tăiat cifre („-12,00” în loc de „-129,00”), o recalculăm
      if (Number.isFinite(use.qty) && Number.isFinite(use.unit) && use.unit > 0) {
        const calc = Math.abs(use.qty * use.unit);
        if (Math.abs(Math.abs(amount) - calc) > Math.max(0.05, calc * 0.02)) amount = Math.sign(amount || 1) * +calc.toFixed(2);
      }
      items.push({ name, qty: Number.isFinite(use.qty) ? use.qty : null, unitPrice: Number.isFinite(use.unit) ? use.unit : null, amount });
      pendingName = null;
      pendingQty = null;
      started = true;
    } else if (qtyOnly) {
      // nu știm încă dacă numele e deasupra („LAPTE” / „2 x 7,49”) sau dedesubt („2 x 7,49” / „LAPTE 14,98”):
      // decidem la rândul următor
      flush();
      pendingQty = { qty, unit, name: hasName ? namePart : pendingName };
      pendingName = null;
    } else if (hasName) {
      flush();
      pendingName = namePart;
    }
  }
  flush();
  return items.map((it) => ({
    ...it,
    amount: isReturn ? -Math.abs(it.amount) : it.amount,
  }));
}
