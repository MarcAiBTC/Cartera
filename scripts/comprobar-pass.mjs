// Comprueba si una contraseña abre las carteras cifradas, sin enseñarla nunca.
//
// Uso, en TU terminal (no hace falta que se la enseñes a nadie):
//   PowerShell:  $env:CARTERA_PASS = 'la contraseña'; node scripts/comprobar-pass.mjs
//   bash:        CARTERA_PASS='la contraseña' node scripts/comprobar-pass.mjs
//
// Imprime la longitud y una huella SHA-256 recortada. La misma huella se puede
// sacar en el navegador para la contraseña que la app usó de verdad al cifrar:
//
//   (async()=>{const p=localStorage.getItem('pub_pass');
//    const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(p));
//    console.log('longitud',p.length,'· huella',
//      [...new Uint8Array(h)].slice(0,5).map(b=>b.toString(16).padStart(2,'0')).join(''),
//      '· espacios en los extremos:',p!==p.trim());})()
//
// Si las dos huellas coinciden, la contraseña es la misma. Si no, son distintas
// por mucho que parezcan iguales al leerlas.

import { webcrypto } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const pass = process.env.CARTERA_PASS;
if (!pass) {
  console.error('Falta CARTERA_PASS. Mira las instrucciones al principio de este fichero.');
  process.exit(2);
}

const huella = async s => {
  const h = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].slice(0, 5).map(b => b.toString(16).padStart(2, '0')).join('');
};

async function descifrar(sobre, p) {
  const b = s => Buffer.from(s, 'base64');
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(p), 'PBKDF2', false, ['deriveKey']);
  const k = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b(sobre.enc.salt), iterations: sobre.enc.iter || 210000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return JSON.parse(new TextDecoder().decode(
    await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: b(sobre.enc.iv) }, k, b(sobre.enc.ct))));
}

const variantes = [
  ['tal cual', pass],
  ['sin espacios en los extremos', pass.trim()],
  ['acentos en NFC', pass.normalize('NFC')],
  ['acentos en NFD', pass.normalize('NFD')],
  ['sin espacios + NFC', pass.trim().normalize('NFC')],
];

console.log(`Contraseña recibida: ${pass.length} caracteres · huella ${await huella(pass)}`);
if (pass !== pass.trim()) console.log('⚠ Lleva espacios (o un salto de línea) al principio o al final.');
console.log();

for (const perfil of ['marc', 'leti']) {
  const ruta = `datos/cartera-${perfil}.enc.json`;
  if (!existsSync(ruta)) { console.log(`${perfil}: no está ${ruta} en local (bájalo con: git pull).`); continue; }
  const sobre = JSON.parse(readFileSync(ruta, 'utf8'));
  let abierta = null;
  const vistas = new Set();
  for (const [nombre, v] of variantes) {
    if (vistas.has(v)) continue;
    vistas.add(v);
    try { const d = await descifrar(sobre, v); abierta = { nombre, n: (d.assets || []).length }; break; } catch {}
  }
  console.log(abierta
    ? `✓ ${perfil}: ABRE (${abierta.nombre}) · ${abierta.n} posiciones · cifrada el ${sobre.actualizado}`
    : `✗ ${perfil}: no abre con ninguna variante de esta contraseña.`);
}
