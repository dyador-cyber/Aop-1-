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
  function dueNotifications(reminders, today) {
    today = today || new Date();
    const out = [];
    for (const r of reminders || []) {
      if (!r.dueDate || r.done) continue;
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
