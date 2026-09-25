// OCR în browser cu Tesseract.js. Tot codul (JS + WebAssembly) este inclus în aplicație
// (vendor/tesseract), deci nu se execută cod descărcat de pe alte servere.
// Singurul lucru descărcat la prima folosire sunt datele de limbă (ron/eng, doar date, nu cod).
import { binarize, findPaper, crop, rotate } from './preprocess.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;

let loading;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = BASE + 'tesseract.min.js';
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { loading = null; reject(new Error('Nu am putut încărca modulul OCR.')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const workers = {};

async function getWorker(kind, onProgress) {
  const T = await loadTesseract();
  if (!workers[kind]) {
    workers[kind] = T.createWorker(kind === 'digits' ? 'eng' : 'ron+eng', 1, {
      workerPath: BASE + 'worker.min.js',
      corePath: BASE,
      workerBlobURL: false,
      logger: (m) => workers[kind].progress?.(m),
    });
    workers[kind].catch(() => { delete workers[kind]; });
  }
  const w = await workers[kind];
  workers[kind].progress = onProgress;
  // bonuri: text pe un singur bloc (psm 6) dă cele mai bune rezultate pe poze reale
  await w.setParameters(kind === 'digits' ? { tessedit_char_whitelist: '0123456789 ' } : { tessedit_pageseg_mode: '6' });
  return w;
}

// Pregătește poza bonului: rezoluție mare, decupează hârtia (scoate fundalul), elimină umbrele.
async function prepareReceipt(blob, maxSide = 2400) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const W = Math.max(1, Math.round(bmp.width * scale));
  const H = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close?.();
  const { data } = ctx.getImageData(0, 0, W, H);
  const box = findPaper(data, W, H) || { x: 0, y: 0, w: W, h: H };
  const bin = binarize(box.w === W && box.h === H ? data : crop(data, W, box), box.w, box.h, { windowFrac: 1 / 16, t: 0.15 });
  canvas.width = canvas.height = 1; // eliberează memoria
  // păstrăm și poza întreagă: la o citire slabă mai încercăm o dată, fără decupare și cu prag mai blând
  return { data: bin, width: box.w, height: box.h, full: data, W, H };
}

async function toPng(data, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = canvas.height = 1;
  return out;
}

// Bonul poate fi fotografiat culcat sau cu susul în jos. Citim întâi o bandă mică din mijloc
// (≈ 1 s): dacă textul se citește bine, orientarea e corectă. Altfel încercăm celelalte orientări
// și o păstrăm pe cea citită clar mai bine. Bonurile drepte (cele mai multe) nu pierd timp.
async function pickOrientation(worker, img, onProgress) {
  const band = (w, h) => ({ left: Math.round(w * 0.1), top: Math.round(h * 0.3), width: Math.round(w * 0.8), height: Math.round(h * 0.2) });
  const first = await toPng(img.data, img.width, img.height);
  const c0 = (await worker.recognize(first, { rectangle: band(img.width, img.height) })).data.confidence;
  if (c0 >= 55) return { blob: first, deg: 0 };
  onProgress?.('verific orientarea', 0);
  let best = { blob: first, conf: c0, deg: 0 };
  for (const deg of [90, 270, 180]) {
    const r = rotate(img.data, img.width, img.height, deg);
    const b = await toPng(r.data, r.width, r.height);
    const c = (await worker.recognize(b, { rectangle: band(r.width, r.height) })).data.confidence;
    if (c > best.conf + 5) best = { blob: b, conf: c, deg };
    if (best.conf >= 65) break;
  }
  return best;
}

// Cât de bună e o citire: încrederea OCR, dar și câte cuvinte / sume a găsit
// (o citire aproape goală poate avea încredere mare).
function readScore(d) {
  const text = d.text || '';
  const words = (text.match(/[A-Za-z0-9ĂÂÎȘȚăâîșț]{3,}/g) || []).length;
  const amounts = (text.match(/\d+[.,]\s?\d{2}\b/g) || []).length;
  return (d.confidence || 0) * Math.log(2 + words + 3 * amounts);
}

// Returnează textul recunoscut din imagine (Blob).
export async function recognize(blob, { digits = false, onProgress } = {}) {
  const worker = await getWorker(digits ? 'digits' : 'text', (m) => {
    if (onProgress && m.status) onProgress(m.status, m.progress || 0);
  });
  let input = blob;
  let img = null;
  let deg = 0;
  if (!digits) {
    onProgress?.('pregătesc poza', 0);
    img = await prepareReceipt(blob).catch(() => null);
    if (img) {
      const o = await pickOrientation(worker, img, onProgress).catch(() => null);
      if (o) { input = o.blob; deg = o.deg; }
    }
  }
  let { data } = await worker.recognize(input);
  // Citire slabă (hârtie decolorată, umbre, bonul decupat greșit): a doua încercare pe poza întreagă,
  // cu un prag mai blând care păstrează și literele șterse. Rămâne varianta citită mai bine.
  if (img && data.confidence < 70) {
    try {
      onProgress?.('recitesc mai atent', 0);
      const soft = binarize(img.full, img.W, img.H, { windowFrac: 1 / 12, t: 0.08 });
      // pe hârtia ștearsă și orientarea poate fi ghicită greșit: încercăm și poza nerotită
      for (const d of deg ? [deg, 0] : [0]) {
        const r = rotate(soft, img.W, img.H, d);
        const next = (await worker.recognize(await toPng(r.data, r.width, r.height))).data;
        if (readScore(next) > readScore(data)) data = next;
      }
    } catch { /* rămâne prima citire */ }
  }
  return (data.text || '').slice(0, 20000);
}

// Redesenează poza ca JPEG (micșorată). Astfel se păstrează doar pixelii:
// se elimină metadatele (inclusiv locația GPS) și orice conținut activ (ex. SVG cu script).
// Aruncă eroare dacă fișierul nu este o imagine validă.
export async function compressImage(file, maxSide = 1600, quality = 0.75) {
  if (!file || !/^image\//.test(file.type || 'image/') || /svg/i.test(file.type) || file.size > 40e6) {
    throw new Error('Fișierul nu este o poză acceptată (JPG, PNG, WEBP, HEIC).');
  }
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('Nu pot deschide poza. Încearcă JPG sau PNG.');
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!out) throw new Error('Nu am putut procesa poza.');
  return out;
}
