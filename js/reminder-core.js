// Logica de notificări pentru expirări (RCA, ITP, CASCO, rovinietă...).
// Script clasic: folosit atât de pagină cât și de service worker.
(function (root) {
  const DAY = 24 * 3600 * 1000;

  function daysUntil(dateStr, today) {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const [y, m, d] = String(dateStr).split('-').map(Number);
    return Math.round((new Date(y, m - 1, d) - t) / DAY);
  }

  // Returnează notificările care trebuie afișate acum. Fiecare are o cheie unică
  // (dată + prag) salvată în reminder.notified ca să nu se repete.
  // kmNow = { idVehicul: km (sau ore) la bord } pentru reviziile la kilometraj.
  function dueNotifications(reminders, today, kmNow) {
    today = today || new Date();
    const out = [];
    for (const r of reminders || []) {
      if (!r.dueDate || r.done) continue;
      // revizia vine la km (cu 500 km / 25 ore înainte) sau la dată, care e primul
      const km = kmNow && r.dueKm && r.vehicleId ? kmNow[r.vehicleId] : null;
      if (km != null && km >= r.dueKm - (r.dueKm < 20000 ? 25 : 500)) {
        const kmKey = `${r.dueKm}km`;
        if (!(r.notified || []).includes(kmKey)) {
          const left = r.dueKm - km;
          const what = r.title || r.type || 'Revizie';
          out.push({ id: r.id, key: kmKey, days: 0, title: '🔧 ' + what, body: left > 0 ? `${what}: mai sunt ${left} până la ${r.dueKm}.` : `${what}: ai depășit ${r.dueKm} cu ${-left}.` });
          continue;
        }
      }
      const days = daysUntil(r.dueDate, today);
      const thresholds = (r.notifyDays && r.notifyDays.length ? r.notifyDays : [30, 7, 1]).slice().sort((a, b) => a - b);
      let key = null;
      if (days < 0) key = `${r.dueDate}:expirat`;
      else {
        const t = thresholds.find((x) => days <= x);
        if (t !== undefined) key = `${r.dueDate}:${t}`;
      }
      if (!key || (r.notified || []).includes(key)) continue;
      const what = r.title || r.type || 'Document';
      const body = days < 0
        ? `${what} a EXPIRAT de ${-days} zile (${r.dueDate}).`
        : days === 0 ? `${what} expiră AZI (${r.dueDate}).`
          : `${what} expiră în ${days} ${days === 1 ? 'zi' : 'zile'} (${r.dueDate}).`;
      out.push({ id: r.id, key, days, title: '⚠️ ' + what, body });
    }
    return out;
  }

  const api = { daysUntil, dueNotifications };
  root.ReminderCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
