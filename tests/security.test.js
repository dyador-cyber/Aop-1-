import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, safeImageDataURL, csvCell, icsText } from '../js/sanitize.js';
import { encryptText, decryptText } from '../js/crypto.js';

test('sanitize elimină câmpuri și tipuri neașteptate', () => {
  const evil = {
    id: 'abc123', date: '2026-01-01"><img src=x onerror=alert(1)>', total: '1"><script>alert(1)</script>',
    store: 'Magazin', categoryId: '"><svg onload=alert(1)>', fuel: { liters: 'x', km: 1e20 },
    __proto__: { polluted: true }, extra: 'nu trebuie păstrat',
  };
  assert.equal(sanitize('expenses', evil), null, 'data invalidă -> respins');
  const ok = sanitize('expenses', { ...evil, date: '2026-01-01' });
  assert.equal(ok.total, null);
  assert.equal(ok.categoryId, '');
  assert.equal(ok.fuel.liters, null);
  assert.equal(ok.fuel.km, null);
  assert.equal('extra' in ok, false);
  assert.equal(ok.polluted, undefined);
  assert.equal({}.polluted, undefined);
});

test('sanitize: id, culoare, liste, lungimi', () => {
  assert.equal(sanitize('projects', { id: '../../x', name: 'a' }), null);
  assert.equal(sanitize('categories', { id: 'c1', name: 'X', color: 'red;background:url(x)' }).color, '#607d8b');
  const t = sanitize('tasks', { id: 't1', title: 'x'.repeat(1000), items: [{ id: 'i1', text: 'ok', done: 'yes' }, { id: '<b>', text: 'rău' }, 'str'] });
  assert.equal(t.title.length, 120);
  assert.deepEqual(t.items, [{ id: 'i1', text: 'ok', done: false }]);
  const r = sanitize('reminders', { id: 'r1', type: 'RCA', dueDate: '2026-10-01', notifyDays: [30, 'x', -5, 7.4, 99999] });
  assert.deepEqual(r.notifyDays, [30, 7]);
  assert.equal(sanitize('reminders', { id: 'r2', dueDate: 'mâine' }), null);
});

test('imagini: doar raster, fără SVG', () => {
  assert.equal(safeImageDataURL('data:image/jpeg;base64,AAAA'), true);
  assert.equal(safeImageDataURL('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(safeImageDataURL('data:text/html;base64,PGh0bWw+'), false);
  assert.equal(safeImageDataURL('javascript:alert(1)'), false);
  const svg = new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' });
  assert.equal(sanitize('odometer', { id: 'o1', date: '2026-01-01', km: 5, image: svg }).image, null);
  const jpg = new Blob([new Uint8Array(4)], { type: 'image/jpeg' });
  assert.equal(sanitize('odometer', { id: 'o1', date: '2026-01-01', km: 5, image: jpg }).image, jpg);
});

test('CSV: fără injecție de formule', () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('+1'), `"'+1"`);
  assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(csvCell('Dedeman'), '"Dedeman"');
});

test('ICS: fără injecție de câmpuri', () => {
  assert.equal(icsText('RCA\r\nATTENDEE:mailto:x@y.z'), 'RCA\\nATTENDEE:mailto:x@y.z');
  assert.equal(icsText('a;b,c\\'), 'a\\;b\\,c\\\\');
});

test('backup criptat: dus-întors și parolă greșită', async () => {
  const enc = await encryptText('{"secret":1}', 'parola-lunga-123');
  assert.equal(enc.encrypted, true);
  assert.equal(enc.data.includes('secret'), false);
  assert.equal(await decryptText(enc, 'parola-lunga-123'), '{"secret":1}');
  await assert.rejects(decryptText(enc, 'gresit'), /Parolă greșită/);
  const tampered = { ...enc, data: enc.data.slice(0, -4) + 'AAAA' };
  await assert.rejects(decryptText(tampered, 'parola-lunga-123'));
  await assert.rejects(decryptText({ ...enc, iterations: 1 }, 'parola-lunga-123'), /invalid/);
});
