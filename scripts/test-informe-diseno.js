// Ejecutar con:  node scripts/test-informe-diseno.js
//
// Comprueba las piezas nuevas del correo diario: la cabecera con el total, la
// comparación con el SPY, la rentabilidad acumulada, el bloque de lo que ha
// movido la cartera, la tarta de reparto (PNG) y el detalle de posiciones.
//
// Se prueba de fuera adentro: se cifra una cartera de mentira igual que hace la
// app, se ejecuta el script del informe con DRY_RUN y se lee el HTML que sale.
// Es el único punto de vista que importa —lo que acaba en el buzón—, y de paso
// cubre el descifrado y las fórmulas sin tener que exportar nada del script.
//
// Las cifras esperadas se recalculan aquí a partir de precios.json en vez de
// escribirse a mano: el feed se regenera cada 15 minutos y un número fijo
// habría convertido este test en una alarma diaria sin motivo.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { webcrypto } = require('crypto');

const RAIZ = path.resolve(__dirname, '..');
const PASS = 'contraseña del test · ñ 🔐';

let ok = 0, ko = 0;
const eq = (a, b, msg, tol = 0.02) => {
  const bien = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : a === b;
  if (bien) { ok++; console.log('  OK  ' + msg); }
  else { ko++; console.log('  FALLO ' + msg + '  -> esperado ' + b + ', obtenido ' + a); }
};
const num = t => parseFloat(String(t).replace(/\./g, '').replace(',', '.'));

// ── La cartera de prueba ─────────────────────────────────────────────────────
// Con dos productos sobre el mismo subyacente (Oro), para verificar que la tarta
// y el bloque del día los agrupan; con liquidez, para verificar que entra en el
// reparto pero no en el movimiento del día; y con ventas y cobros apuntados,
// que es lo que separa «lo aportado» del «coste».
const assets = [
  { id: 101, name: 'Efectivo TR',   cat: 'liquidez', broker: 'Trade Republic', qty: 4000, costUnit: 1, mp: 1, ccy: 'EUR', mode: 'manual' },
  { id: 102, name: 'Xetra Gold',    cat: 'metal',  broker: 'Trade Republic', qty: 20, costUnit: 120, ccy: 'EUR', mode: 'auto', isin: 'FR0013416716', underlying: 'Oro' },
  { id: 103, name: 'iShares Gold',  cat: 'metal',  broker: 'MyInvestor',     qty: 30, costUnit: 60,  ccy: 'EUR', mode: 'auto', isin: 'IE00B4ND3602', underlying: 'Oro' },
  { id: 104, name: 'CaixaBank',     cat: 'accion', broker: 'MyInvestor',     qty: 200, costUnit: 8,  ccy: 'EUR', mode: 'auto', ticker: '48CA', underlying: 'Caixabank' },
];
const TRADES = [{ id: 1, dateIn: '2025-01-02', dateOut: '2025-09-30', result: 500 }];
const RENDIM = [{ id: 1, assetId: 101, kind: 'interes', date: '2026-03-01', eur: 80 }];
const estado = { version: 2, perfil: 'marc', perfilNombre: 'Marc', assets,
  snaps: [], wl: [], targets: {}, trades: TRADES, aports: [], rendim: RENDIM };
const estadoLeti = { version: 2, perfil: 'leti', perfilNombre: 'Leti',
  assets: [{ id: 201, name: 'Efectivo MyInvestor', cat: 'liquidez', broker: 'MyInvestor', qty: 1000, costUnit: 1, mp: 1, ccy: 'EUR', mode: 'manual' }],
  snaps: [], wl: [], targets: {}, trades: [], aports: [], rendim: [] };

// ── Lo que deberían dar las cuentas, calculado aparte ────────────────────────
const feed = JSON.parse(fs.readFileSync(path.join(RAIZ, 'precios.json'), 'utf8'));
const simDe = a => {
  const i = (a.isin || '').toUpperCase(), t = (a.ticker || '').toUpperCase();
  return (feed.alias[i] && feed.precios[feed.alias[i]]) ? feed.alias[i]
       : feed.precios[t] ? t
       : (feed.alias[t] && feed.precios[feed.alias[t]]) ? feed.alias[t] : null;
};
const precioDe = a => a.cat === 'liquidez' ? (a.mp ?? 1) : feed.precios[simDe(a)].eur;
const prevDe = a => {
  const p = feed.precios[simDe(a)];
  const sp = p.src !== 'coingecko' && Array.isArray(p.spark) && p.spark.length >= 2 ? p.spark[p.spark.length - 2] : 0;
  return sp > 0 ? sp : p.prev;
};
const valor = a => a.qty * precioDe(a);
const TOTAL = assets.reduce((s, a) => s + valor(a), 0);
const COSTE = assets.reduce((s, a) => s + (a.cat === 'liquidez' ? a.qty * (a.mp ?? 1) : a.qty * a.costUnit), 0);
const REALIZADO = 500, COBRADO = 80;
const GANANCIA = (TOTAL - COSTE) + REALIZADO + COBRADO;
const APORTADO = COSTE - REALIZADO - COBRADO;
const RENT = GANANCIA / APORTADO * 100;
const PESO_ORO = assets.filter(a => a.underlying === 'Oro').reduce((s, a) => s + valor(a), 0) / TOTAL * 100;
const PESO_LIQ = 4000 / TOTAL * 100;
const DIA_ORO = assets.filter(a => a.underlying === 'Oro').reduce((s, a) => s + a.qty * (precioDe(a) - prevDe(a)), 0);

// ── Cifrar como la app y ejecutar el informe ─────────────────────────────────
async function cifrar(txt, pass) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const k = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(txt));
  const b64 = u => Buffer.from(u).toString('base64');
  return { alg: 'AES-GCM-256', iter: 210000, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

(async () => {
  // ── 1 · El dibujo de la tarta ──────────────────────────────────────────────
  // Va primero porque no necesita ni red ni cartera: si el PNG estuviera roto,
  // todo lo demás fallaría por un motivo que no tiene nada que ver.
  console.log('\n1 · La tarta se dibuja como un PNG válido');
  const { donutPNG, png } = await import('../scripts/tarta_png.mjs');
  const buf = donutPNG([{ pct: 50, col: '#f7931a' }, { pct: 30, col: '#6d7df6' }, { pct: 20, col: '#9a94b8' }], { lado: 120 });
  eq(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'empieza por la firma de un PNG');
  eq(buf.readUInt32BE(16), 120, 'el ancho declarado en la cabecera es el pedido');
  eq(buf.readUInt32BE(20), 120, 'y el alto también');
  eq(buf.slice(-8, -4).toString('ascii'), 'IEND', 'y termina con el trozo IEND');

  // El agujero del donut tiene que quedar transparente y el anillo pintado: es
  // lo que distingue un donut de un círculo relleno, y se comprueba mirando el
  // píxel del centro y uno del anillo.
  const pixel = (b, lado, x, y) => {
    // Se descomprime el PNG a mano para no depender de ninguna librería.
    const zlib = require('zlib');
    const idat = [];
    let off = 8;
    while (off < b.length) {
      const len = b.readUInt32BE(off), tipo = b.slice(off + 4, off + 8).toString('ascii');
      if (tipo === 'IDAT') idat.push(b.slice(off + 8, off + 8 + len));
      off += 12 + len;
    }
    const crudo = zlib.inflateSync(Buffer.concat(idat));
    const fila = y * (1 + lado * 4) + 1 + x * 4;
    return [crudo[fila], crudo[fila + 1], crudo[fila + 2], crudo[fila + 3]];
  };
  eq(pixel(buf, 120, 60, 60)[3], 0, 'el agujero del centro es transparente');
  // A 45° y a media altura del anillo: dentro de la primera porción, lejos del
  // corte que hay a las 12 en punto entre la última porción y la primera.
  const anillo = pixel(buf, 120, 93, 27);
  eq(anillo[3] > 200, true, 'el anillo está pintado donde toca');
  eq(anillo.slice(0, 3).join(','), '247,147,26', 'y con el color que se le pasó a la primera porción');
  eq(donutPNG([], { lado: 40 }).length > 0, true, 'sin posiciones devuelve un PNG vacío en vez de reventar');
  eq(donutPNG([{ pct: 100, col: '#0ea97d' }], { lado: 40 }).length > 0, true, 'con una sola porción tampoco se parte');

  // ── 2 · El informe completo ────────────────────────────────────────────────
  console.log('\n2 · El informe se genera desde la cartera cifrada');
  const rutas = { marc: path.join(RAIZ, 'datos', 'cartera-marc.enc.json'),
                  leti: path.join(RAIZ, 'datos', 'cartera-leti.enc.json') };
  // Las carteras de verdad no son basura del test: se guardan y se devuelven.
  const previos = {};
  for (const [p, r] of Object.entries(rutas)) previos[p] = fs.existsSync(r) ? fs.readFileSync(r) : null;

  let salida = '', htmlMarc = '', htmlLeti = '';
  try {
    for (const [p, datos] of Object.entries({ marc: estado, leti: estadoLeti })) {
      fs.writeFileSync(rutas[p], JSON.stringify({
        perfil: p, actualizado: new Date().toISOString(), enc: await cifrar(JSON.stringify(datos), PASS),
      }, null, 1));
    }
    try {
      salida = execFileSync(process.execPath, [path.join(RAIZ, 'scripts', 'informe_diario.mjs')], {
        cwd: RAIZ, encoding: 'utf8',
        env: { ...process.env, CARTERA_PASS: PASS, FORCE: '1', DRY_RUN: '1',
               POSICIONES_JSON: '', RESEND_API_KEY: '', ANTHROPIC_API_KEY: '' },
      });
    } catch (e) { salida = (e.stdout || '') + (e.stderr || ''); }
    htmlMarc = fs.readFileSync(path.join(RAIZ, 'informe-marc.html'), 'utf8');
    htmlLeti = fs.readFileSync(path.join(RAIZ, 'informe-leti.html'), 'utf8');
  } finally {
    for (const [p, r] of Object.entries(rutas)) {
      if (previos[p]) fs.writeFileSync(r, previos[p]);
      else if (fs.existsSync(r)) fs.unlinkSync(r);
    }
    for (const f of ['informe-marc.html', 'informe-leti.html']) {
      const q = path.join(RAIZ, f); if (fs.existsSync(q)) fs.unlinkSync(q);
    }
    fs.rmSync(path.join(RAIZ, '.informe-enviado'), { recursive: true, force: true });
  }
  eq(/Marc: informe generado/.test(salida), true, 'genera el de Marc');
  eq(/Leti: informe generado/.test(salida), true, 'genera el de Leti');

  console.log('\n3 · La cabecera dice cuánto hay y cuánto se ha movido');
  const total = num((htmlMarc.match(/font-size:32px;font-weight:800">([^<]+) €</) || [])[1]);
  eq(total, TOTAL, 'el valor total es la suma de las posiciones', 1);
  eq(/Rentabilidad acumulada/.test(htmlMarc), true, 'aparece la rentabilidad acumulada');
  const gan = num((htmlMarc.match(/Rentabilidad acumulada[\s\S]{0,200}?font-weight:700">\+?(-?[\d.,]+) €/) || [])[1]);
  eq(gan, GANANCIA, 'la ganancia acumulada suma lo no realizado, lo vendido y lo cobrado', 1);
  const pct = num((htmlMarc.match(/Rentabilidad acumulada[\s\S]{0,260}? · \+?(-?[\d.,]+)%/) || [])[1]);
  eq(pct, RENT, 'el porcentaje va sobre lo aportado, no sobre el coste', 0.05);
  const ap = num((htmlMarc.match(/sobre ([\d.,]+) € aportados/) || [])[1]);
  eq(ap, APORTADO, 'lo aportado descuenta la venta cerrada y los intereses cobrados', 1);
  eq(/style="display:none;font-size:1px/.test(htmlMarc), true, 'lleva texto de vista previa para la bandeja de entrada');

  console.log('\n4 · Se compara con el mercado (SPY)');
  const haySpy = /S&amp;P 500/.test(htmlMarc);
  if (!haySpy) {
    console.log('  ·   sin red o Yahoo caído: no se puede comprobar la comparación con el SPY.');
    eq(/Tu cartera va/.test(htmlMarc), false, 'y entonces el informe no la enseña a medias');
  } else {
    eq(/S&amp;P 500( en €)? hoy/.test(htmlMarc), true, 'la cabecera enseña el día del S&P 500');
    eq(/Tu cartera va/.test(htmlMarc), true, 'y cuánto va por delante o por detrás');
    eq(/[+-][\d.,]+ pp/.test(htmlMarc), true, 'la diferencia va en puntos porcentuales, no en %');
    eq(/El S&amp;P 500[^<]*<b>[+-]/.test(htmlMarc), true, 'y el comentario del día también la menciona');
  }

  console.log('\n5 · El bloque de lo que ha movido la cartera');
  eq(/Qué ha movido la cartera hoy/.test(htmlMarc), true, 'está el bloque');
  const bloque = htmlMarc.split('Qué ha movido la cartera hoy')[1].split('Reparto de la cartera')[0];
  eq(/>Oro</.test(bloque), true, 'agrupa los dos ETC de oro en una sola fila «Oro»');
  eq((bloque.match(/>Xetra Gold</g) || []).length, 0, 'y no repite los productos sueltos');
  eq(/&nbsp;·&nbsp;2</.test(bloque), true, 'avisa de que esa fila sale de 2 productos');
  const oroDia = num((bloque.match(/>Oro<[\s\S]{0,300}?font-weight:700;color:#[0-9a-f]{6}">\+?(-?[\d.,]+) €/) || [])[1]);
  eq(oroDia, DIA_ORO, 'los euros del día del oro son la suma de sus dos productos', 1.5);
  eq(/>Efectivo TR</.test(bloque), false, 'la liquidez no aparece: ni sube ni baja');

  console.log('\n6 · La tarta de reparto y los pesos');
  eq(/data:image\/png;base64,/.test(htmlMarc), true, 'la vista previa lleva la tarta incrustada');
  eq(/alt="Reparto de la cartera por subyacente"/.test(htmlMarc), true, 'la imagen lleva texto alternativo');
  const leyenda = htmlMarc.split('Reparto de la cartera')[2].split('Detalle de posiciones')[0];
  const pesos = [...leyenda.matchAll(/font-weight:700;color:#28234a;white-space:nowrap">([\d.,]+)%/g)].map(m => num(m[1]));
  eq(pesos.length, 3, 'hay una fila por subyacente (Oro, Caixabank y Liquidez)');
  eq(pesos.reduce((s, x) => s + x, 0), 100, 'los pesos suman el 100% de la cartera', 0.2);
  eq(pesos[0] >= pesos[1] && pesos[1] >= pesos[2], true, 'y van de mayor a menor');
  eq(/>Liquidez</.test(leyenda), true, 'la liquidez cuenta como un bloque más');
  eq(Math.max(...pesos), Math.max(PESO_ORO, PESO_LIQ), 'el bloque más grande pesa lo que dice la cuenta', 0.2);

  console.log('\n7 · El detalle de posiciones');
  const detalle = htmlMarc.split('Detalle de posiciones')[1].split('Titulares de tus posiciones')[0];
  for (const a of assets) eq(detalle.includes(a.name), true, `aparece «${a.name}»`);
  eq(/Trade Republic/.test(detalle) && /MyInvestor/.test(detalle), true, 'con el broker de cada una');

  console.log('\n7b · El orden de los bloques');
  // Lo tuyo primero y en orden de menos a más detalle; los titulares al final,
  // que son lectura opcional. Si algún bloque se cuela en medio, el correo deja
  // de leerse de arriba abajo sin saltos y se nota en el móvil.
  const orden = ['Hoy, en corto', 'Qué ha movido la cartera hoy', 'Reparto de la cartera',
                 'Detalle de posiciones', 'Titulares de tus posiciones'];
  const dónde = orden.map(t => htmlMarc.indexOf(t));
  eq(dónde.every(i => i >= 0), true, 'están los cinco bloques');
  eq(dónde.every((v, i) => i === 0 || v > dónde[i - 1]), true, 'y van en este orden: ' + orden.join(' → '));

  console.log('\n8 · Cada informe es solo de quien es');
  eq(/Cartera de Marc/.test(htmlMarc), true, 'el de Marc se identifica');
  eq(/Cartera de Leti/.test(htmlLeti), true, 'y el de Leti también');
  eq(/Xetra Gold|CaixaBank/.test(htmlLeti), false, 'la cartera de Marc no se filtra en el correo de Leti');
  eq(/Efectivo MyInvestor/.test(htmlMarc), false, 'ni la de Leti en el de Marc');

  console.log('\n9 · El HTML sobrevive a un cliente de correo');
  // Gmail borra el <style> del <head> y no entiende flex ni grid: si alguna
  // de estas cosas se cuela, el correo se ve bien aquí y se rompe en el móvil.
  eq(/<style/.test(htmlMarc), false, 'no hay hojas de estilo (Gmail las borra)');
  eq(/display:\s*flex|display:\s*grid/.test(htmlMarc), false, 'no hay flex ni grid');
  eq(/<script/i.test(htmlMarc), false, 'no hay JavaScript');
  eq(/name="viewport"/.test(htmlMarc), true, 'declara el viewport para el móvil');
  eq(/max-width:600px/.test(htmlMarc), true, 'y una columna que no pasa de 600 px');
  eq(/position:\s*(absolute|fixed)/.test(htmlMarc), false, 'nada posicionado en absoluto');
  // Una sola palabra larga que no se pueda partir —el nombre kilométrico de un
  // fondo, una ruta de fichero— ensancha su tabla y con ella todo el correo, y
  // el mensaje acaba leyéndose con desplazamiento horizontal en el móvil.
  eq((htmlMarc.match(/word-break:break-word;overflow-wrap:anywhere/g) || []).length >= 3, true,
     'las tarjetas y la cabecera parten las palabras largas');

  console.log('\n10 · El modo de vista previa (scripts/vista-previa.mjs)');
  // Lee una cartera EN CLARO y genera un solo perfil. Es lo que permite mirar
  // cómo queda el correo sin tener que teclear la contraseña.
  const claro = path.join(RAIZ, 'cartera-de-prueba.json');
  let prev = '', htmlPrev = '';
  try {
    fs.writeFileSync(claro, JSON.stringify({ ...estado, exportedAt: new Date(Date.now() - 6 * 864e5).toISOString() }));
    try {
      prev = execFileSync(process.execPath, [path.join(RAIZ, 'scripts', 'informe_diario.mjs')], {
        cwd: RAIZ, encoding: 'utf8',
        env: { ...process.env, FORCE: '1', DRY_RUN: '1', SOLO_PERFIL: 'marc', CARTERA_FILE: claro,
               CARTERA_PASS: '', POSICIONES_JSON: '', RESEND_API_KEY: '', ANTHROPIC_API_KEY: '' },
      });
    } catch (e) { prev = (e.stdout || '') + (e.stderr || ''); }
    const q = path.join(RAIZ, 'informe-marc.html');
    htmlPrev = fs.existsSync(q) ? fs.readFileSync(q, 'utf8') : '';
  } finally {
    for (const f of [claro, path.join(RAIZ, 'informe-marc.html'), path.join(RAIZ, 'informe-leti.html')]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    fs.rmSync(path.join(RAIZ, '.informe-enviado'), { recursive: true, force: true });
  }
  eq(/Marc: informe generado desde fichero/.test(prev), true, 'lee la cartera en claro sin pedir contraseña');
  eq(/Leti/.test(prev), false, 'SOLO_PERFIL deja fuera al otro perfil');
  eq(num((htmlPrev.match(/font-size:32px;font-weight:800">([^<]+) €</) || [])[1]), TOTAL,
     'y las cifras salen igual que por el camino cifrado', 1);
  eq(/Vista previa: las posiciones salen de cartera-de-prueba\.json/.test(htmlPrev), true,
     'avisa de que es una vista previa y con qué fichero');
  eq(/salen de [^<]*[\\/]/.test(htmlPrev), false,
     'sin la ruta entera: una ruta de Windows es una palabra que no se puede partir');
  eq(/exportado hace 6 días/.test(htmlPrev), true, 'y de lo viejas que son las posiciones');

  console.log('\n' + ok + ' bien · ' + ko + ' mal');
  process.exit(ko ? 1 : 0);
})();
