// OCR în browser cu Tesseract.js (încărcat la prima folosire).
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

let loading;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_URL;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { loading = null; reject(new Error('Nu am putut încărca modulul OCR (verifică internetul).')); };
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
      logger: (m) => workers[kind].progress?.(m),
    });
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
  return data.text || '';
}

// Micșorează poza (bonurile ocupă altfel prea mult) -> Blob JPEG.
export async function compressImage(file, maxSide = 1600, quality = 0.75) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', quality));
}
