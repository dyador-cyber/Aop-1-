// Pregătirea pozei pentru OCR: tonuri de gri + prag adaptiv (Bradley).
// Elimină umbrele și fundalul neuniform: fiecare pixel e comparat cu media zonei din jurul lui,
// nu cu un prag fix. Lucrează pe date RGBA brute, deci merge și în browser (ImageData) și în teste.
export function binarize(rgba, width, height, { windowFrac = 1 / 24, t = 0.12 } = {}) {
  const n = width * height;
  const gray = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];

  // imagine integrală pentru medii rapide pe ferestre (Uint32 ajunge până la ~16 milioane de pixeli)
  const w1 = width + 1;
  const integral = new Uint32Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x];
      integral[(y + 1) * w1 + x + 1] = integral[y * w1 + x + 1] + row;
    }
  }
  const half = Math.max(4, Math.round(Math.max(width, height) * windowFrac / 2));
  const out = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height - 1, y + half);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width - 1, x + half);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * w1 + x1 + 1] - integral[y0 * w1 + x1 + 1] - integral[(y1 + 1) * w1 + x0] + integral[y0 * w1 + x0];
      const v = gray[y * width + x] * count < sum * (1 - t) ? 0 : 255;
      const k = (y * width + x) * 4;
      out[k] = out[k + 1] = out[k + 2] = v;
      out[k + 3] = 255;
    }
  }
  return out;
}

// Prag Otsu pe histograma tonurilor de gri.
function otsu(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i] | 0]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0; let wB = 0; let best = 0; let thr = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB; const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = i; }
  }
  return thr;
}

// Găsește dreptunghiul bonului (hârtia luminoasă) ca să eliminăm fundalul.
// Returnează { x, y, w, h } sau null dacă nu e un contrast clar.
export function findPaper(rgba, width, height) {
  const n = width * height;
  const gray = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  const thr = otsu(gray);
  const col = new Float64Array(width);
  const row = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] > thr) { col[x]++; row[y]++; }
    }
  }
  const span = (arr, len, other) => {
    // cea mai lungă secvență continuă în care peste 45% din linie e hârtie
    let bs = 0; let be = -1; let s = -1;
    for (let i = 0; i <= len; i++) {
      const on = i < len && arr[i] / other > 0.45;
      if (on && s < 0) s = i;
      if (!on && s >= 0) { if (i - 1 - s > be - bs) { bs = s; be = i - 1; } s = -1; }
    }
    return be >= bs ? [bs, be] : null;
  };
  const cx = span(col, width, height);
  if (!cx) return null;
  // rândurile se calculează doar în coloanele bonului
  row.fill(0);
  for (let y = 0; y < height; y++) for (let x = cx[0]; x <= cx[1]; x++) if (gray[y * width + x] > thr) row[y]++;
  const cy = span(row, height, cx[1] - cx[0] + 1);
  if (!cy) return null;
  const w = cx[1] - cx[0] + 1; const h = cy[1] - cy[0] + 1;
  if (w < width * 0.15 || h < height * 0.15) return null;
  const pad = Math.round(Math.max(w, h) * 0.02);
  const x = Math.max(0, cx[0] - pad); const y = Math.max(0, cy[0] - pad);
  return { x, y, w: Math.min(width - x, w + 2 * pad), h: Math.min(height - y, h + 2 * pad) };
}

export function crop(rgba, width, box) {
  const out = new Uint8ClampedArray(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    const src = ((box.y + y) * width + box.x) * 4;
    out.set(rgba.subarray(src, src + box.w * 4), y * box.w * 4);
  }
  return out;
}
