// „📤 Copie bon”: trimite pozele originale sau pregătește o pagină de tipărit / salvat ca PDF
// (din fereastra de tipărire a telefonului: „Salvează ca PDF”). Nimic nu pleacă din telefon
// decât dacă utilizatorul alege singur aplicația în care trimite.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'RON' }).format(+n || 0);
const fmtDate = (s) => (s ? String(s).split('-').reverse().join('.') : '—');
const photosOf = (e) => [e.image, ...(e.extraImages || [])].filter((b) => b instanceof Blob);
const safeName = (s) => String(s || 'bon').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bon';

export function receiptFileBase(e) {
  return `bon-${safeName(e.store)}-${e.date || ''}`;
}

// Trimite pozele bonului (WhatsApp, e-mail, Drive…). Dacă telefonul nu poate, le descarcă.
export async function shareReceiptPhotos(e, download) {
  const photos = photosOf(e);
  if (!photos.length) return 'none';
  const base = receiptFileBase(e);
  const files = photos.map((b, i) => new File([b], `${base}${photos.length > 1 ? `-${i + 1}` : ''}.jpg`, { type: b.type || 'image/jpeg' }));
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: `Bon ${e.store || ''} ${fmtDate(e.date)}` });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  files.forEach((f) => download(f, f.name));
  return 'downloaded';
}

function receiptHTML(e, { photos = true, urlOf }) {
  const items = (e.items || []).map((i) => `<tr><td>${esc(i.name)}</td><td class="n">${i.qty != null && Math.abs(i.qty) !== 1 ? `${esc(Math.abs(i.qty))} ×` : ''}</td><td class="n">${money(i.amount)}</td></tr>`).join('');
  const imgs = photos ? photosOf(e).map((b) => `<img src="${urlOf(b)}" alt="">`).join('') : '';
  return `<article class="p-receipt">
    <h2>${e.isReturn ? '↩️ Retur – ' : ''}${esc(e.store || 'Bon')}</h2>
    <p>${e.supplierName ? `${esc(e.supplierName)} · ` : ''}${e.cif ? `CUI ${esc(e.cif)} · ` : ''}${esc(e.supplierAddress || '')}</p>
    <p><b>Data:</b> ${esc(fmtDate(e.date))} · <b>Total:</b> ${money(e.total)}</p>
    ${items ? `<table>${items}</table>` : ''}
    ${e.notes ? `<p><i>${esc(e.notes)}</i></p>` : ''}
    <div class="p-photos">${imgs}</div>
  </article>`;
}

// Pagina de tipărit: se pune peste aplicație doar cât timp e deschisă fereastra de tipărire.
export function printReceipts(list, { title = 'Bonuri', photos = true, urlOf } = {}) {
  document.getElementById('print-area')?.remove();
  const area = document.createElement('div');
  area.id = 'print-area';
  const total = list.reduce((s, e) => s + (+e.total || 0), 0);
  area.innerHTML = `<header class="p-head"><h1>${esc(title)}</h1><p>${list.length} ${list.length === 1 ? 'bon' : 'bonuri'} · total ${money(total)} · generat ${esc(new Date().toLocaleDateString('ro-RO'))} cu Fiscan</p></header>
    ${list.map((e) => receiptHTML(e, { photos, urlOf })).join('')}`;
  document.body.appendChild(area);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); area.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // lăsăm pozele să se încarce înainte de tipărire
  const imgs = [...area.querySelectorAll('img')];
  Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; })))).then(() => window.print());
}
