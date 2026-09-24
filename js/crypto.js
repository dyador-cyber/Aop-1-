// Criptarea backup-urilor cu parolă: PBKDF2-SHA256 (600.000 iterații) + AES-256-GCM (WebCrypto).
const ITERATIONS = 600000;

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptText(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
  return { app: 'bonuri-masina', encrypted: true, v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: toB64(ct) };
}

export async function decryptText(payload, password) {
  const iterations = Number(payload.iterations);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 10000000) throw new Error('Backup invalid.');
  const key = await deriveKey(password, fromB64(payload.salt), iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(payload.iv) }, key, fromB64(payload.data));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('Parolă greșită sau fișier modificat.');
  }
}
