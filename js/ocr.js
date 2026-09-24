// OCR în browser cu Tesseract.js. Tot codul (JS + WebAssembly) este inclus în aplicație
// (vendor/tesseract), deci nu se execută cod descărcat de pe alte servere.
// Singurul lucru descărcat la prima folosire sunt datele de limbă (ron/eng, doar date, nu cod).
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
  if (kind === 'digits') await w.setParameters({ tessedit_char_whitelist: '0123456789 ' });
  return w;
}

// Returnează textul recunoscut din imagine (Blob).
export async function recognize(blob, { digits = false, onProgress } = {}) {
  const worker = await getWorker(digits ? 'digits' : 'text', (m) => {
    if (onProgress && m.status) onProgress(m.status, m.progress || 0);
  });
  const { data } = await worker.recognize(blob);
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
