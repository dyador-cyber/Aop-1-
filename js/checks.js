// „⚠️ De verificat”: ce anume poate fi greșit la un bon citit automat.
// Se calculează din datele salvate, deci nu trebuie ținut nimic în plus în baza de date.

import { toolDoubt } from './items.js';

const money = (n) => (Math.round(Math.abs(n) * 100) / 100).toFixed(2).replace('.', ',');

// Neidentificat = nu se știe ce e și numele citit n-a fost încă corectat de utilizator.
export const isUnknownItem = (i) => i.sub === 'other' && !!i.ocrName && i.name === i.ocrName;

export function expenseFlags(e, now = Date.now()) {
  const out = [];
  if (!e || e.reviewed) return out;
  const items = Array.isArray(e.items) ? e.items : [];
  const total = typeof e.total === 'number' ? e.total : null;
  const unknown = items.filter(isUnknownItem).length;
  // „POLIZOR 125 + DISC”: sculă (intră în inventar) sau consumabil? Decide utilizatorul, o singură dată.
  const doubt = items.filter((i) => ['tools', 'consumables'].includes(i.sub) && !i.confirmed && toolDoubt(i.name)).length;
  if (doubt) out.push({ key: 'tool-doubt', text: `🔧 ${doubt === 1 ? 'un produs' : `${doubt} produse`}: sculă sau consumabil? – alege subcategoria` });
  if (unknown) out.push({ key: 'items-unknown', text: `❓ ${unknown === 1 ? 'un produs neidentificat' : `${unknown} produse neidentificate`} – scrie numele corect, data viitoare îl recunosc singur` });
  if (total === null) out.push({ key: 'total-missing', text: 'Lipsește totalul' });
  else {
    if (e.totalSource === 'estimat') out.push({ key: 'total-est', text: 'Totalul nu s-a citit clar – verifică-l pe bon' });
    if (typeof e.paid === 'number' && Math.abs(e.paid - Math.abs(total)) > 0.05) out.push({ key: 'paid', text: `Totalul (${money(total)}) diferă de suma plătită (${money(e.paid)})` });
    if (items.length) {
      const sum = items.reduce((a, i) => a + (+i.amount || 0), 0);
      if (Math.abs(Math.abs(sum) - Math.abs(total)) > 0.05) out.push({ key: 'items-sum', text: `Suma produselor (${money(sum)}) diferă de total (${money(total)})` });
    }
  }
  if (e.cif && !e.cifValid) out.push({ key: 'cif', text: 'CUI-ul firmei pare citit greșit' });
  else if (e.cifRepaired && e.supplierSource !== 'anaf') out.push({ key: 'cif-fixed', text: 'CUI-ul a fost corectat automat – verifică firma' });
  if (e.date) {
    const ref = typeof e.createdAt === 'number' ? e.createdAt : now;
    if ((ref - Date.parse(e.date)) / 864e5 > 60) out.push({ key: 'date-old', text: 'Data pare veche – verifică anul' });
  }
  if (!e.categoryId) out.push({ key: 'no-cat', text: 'Fără categorie' });
  return out;
}
