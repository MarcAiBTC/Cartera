// Informe diario de cartera por correo — 100% gratuito, sin APIs de pago.
// Un correo por perfil: la cartera de Marc a su dirección y la de Leti a la suya.
//
// - Posiciones: datos/cartera-<perfil>.enc.json, que la propia app publica cifrado
//   cada vez que cambias algo (el repo es público, así que nunca va en claro).
//   Respaldo para Marc: el viejo secret POSICIONES_JSON, si el fichero no existe.
// - Precios: precios.json del repo (mismo feed que usa index.html).
// - Noticias: endpoint público de búsqueda de Yahoo Finance (sin clave).
// - Redacción: plantilla HTML en este script (sin IA).
// - Envío: SMTP de Gmail con contraseña de aplicación; Resend como respaldo.
//
// Ejecutar con Node >= 18 desde la raíz del repo: node scripts/informe_diario.mjs
// Vars: CARTERA_PASS (descifra), MAIL_MARC / MAIL_LETI (destinos),
//       GMAIL_USER + GMAIL_APP_PASSWORD (envío) o RESEND_API_KEY (respaldo),
//       POSICIONES_JSON (respaldo de datos), FORCE=1 (salta el control horario),
//       DRY_RUN=1 (genera pero no envía).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const TZ = 'Europe/Madrid';
const REMITE_NOMBRE = 'Cartera';
const MARCAS = '.informe-enviado';   // carpeta de marcas diarias (cache del workflow)

// Perfiles a los que se les manda informe. La dirección va en un secret, no
// aquí: el repositorio es público y un correo escrito en el código acaba en
// todos los rastreadores de spam.
const PERFILES = [
  { id: 'marc', nombre: 'Marc', destino: process.env.MAIL_MARC },
  { id: 'leti', nombre: 'Leti', destino: process.env.MAIL_LETI },
];

const up = s => (s || '').toString().toUpperCase().trim();
const fe = (n, d = 2) => n == null || isNaN(n) ? '—'
  : new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n) + ' €';
const fp = n => n == null || !isFinite(n) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── 1. Control horario: el cron UTC no sabe de horario de verano ──────────────
// GitHub además retrasa los crons hasta 2 h, así que se acepta toda la franja
// 22:00–23:59 en Madrid; una marca por perfil y día evita que los disparos de
// respaldo manden el correo dos veces.
const partes = new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'long',
  day: '2-digit', month: 'long', year: 'numeric',
}).formatToParts(new Date());
const parte = t => partes.find(p => p.type === t)?.value || '';
const horaMadrid = parseInt(parte('hour'), 10);
const horaTexto = `${parte('hour')}:${parte('minute')}`;
const fechaLarga = `${parte('weekday')}, ${parte('day')} de ${parte('month')} de ${parte('year')}`;
const hoyMadrid = new Date().toLocaleDateString('sv-SE', { timeZone: TZ }); // AAAA-MM-DD

if (process.env.FORCE !== '1' && horaMadrid !== 22 && horaMadrid !== 23) {
  console.log(`Son las ${horaTexto} en Madrid (fuera de la franja 22:00–23:59): este disparo corresponde al otro horario (verano/invierno) o llegó demasiado tarde. No se envía nada.`);
  process.exit(0);
}

// ── 2. Precios (repo) ─────────────────────────────────────────────────────────
const feed = JSON.parse(readFileSync(new URL('../precios.json', import.meta.url), 'utf8'));
const alias = feed.alias || {};
const precios = feed.precios || {};
const feedTs = Date.parse(feed.generated_at) || Date.now();
const feedViejo = Date.now() - feedTs > 3 * 3600 * 1000; // >3 h sin actualizar
// EUR por unidad de divisa (para activos cuyo coste/precio manual va en USD…)
const fx = Object.assign({ EUR: 1 }, feed.fx || {});
const rateDe = a => {
  const c = up(a.ccy || 'EUR');
  return c === 'EUR' ? 1 : (fx[c] > 0 ? fx[c] : 1);
};

// Misma resolución de símbolo que keyOf() en index.html.
const keyOf = a => {
  if (a.yfSym && precios[a.yfSym]) return a.yfSym;
  const i = up(a.isin), t = up(a.ticker);
  return (alias[i] && precios[alias[i]]) ? alias[i]
       : precios[t] ? t
       : (alias[t] && precios[alias[t]]) ? alias[t] : null;
};
// px()/pxPrev() como en index.html (con el arreglo del spark para el cierre anterior).
// Los precios del feed ya están en EUR; los introducidos a mano van en la divisa
// del activo (a.ccy) y se convierten aquí.
const px = a => {
  if (a.cat === 'liquidez') return (a.mp ?? 1) * rateDe(a);
  if (a.mode === 'auto') {
    const sym = keyOf(a);
    if (sym && precios[sym].eur > 0) return precios[sym].eur;
  }
  if (a.mp == null) return null;
  return a.mode === 'auto' && a.pxOk ? a.mp : a.mp * rateDe(a);
};
const pxPrev = a => {
  if (a.cat === 'liquidez') return (a.mp ?? 1) * rateDe(a);
  if (a.mode !== 'auto') return null;
  const sym = keyOf(a); if (!sym) return null;
  const pe = precios[sym];
  let prev = pe.prev > 0 ? pe.prev : null;
  // chartPreviousClose de Yahoo puede ser el cierre de hace un mes: manda el penúltimo del spark.
  if (pe.src !== 'coingecko' && Array.isArray(pe.spark) && pe.spark.length >= 2) {
    const sp2 = pe.spark[pe.spark.length - 2];
    if (sp2 > 0) prev = sp2;
  }
  return prev;
};

// ── 3. Cargar la cartera de un perfil ─────────────────────────────────────────
// El fichero que publica la app: metadatos en claro (de quién es y de cuándo) y
// el contenido cifrado con AES-GCM. La clave sale de la contraseña con PBKDF2,
// exactamente igual que en el navegador; si no coincide, descifrar falla y se
// avisa en vez de mandar un informe vacío.
async function descifrar(sobre, pass) {
  const b = s => Buffer.from(s, 'base64');
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const k = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b(sobre.enc.salt), iterations: sobre.enc.iter || 210000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: b(sobre.enc.iv) }, k, b(sobre.enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// La app guarda la contraseña tal cual se escribió (no hace .trim()) y GitHub
// conserva los espacios al pegar un secret, así que un espacio invisible en
// cualquiera de los dos lados rompía el descifrado sin dar ninguna pista.
// Se prueban las variantes razonables de la MISMA contraseña — no se prueba
// ninguna otra, así que esto no debilita el cifrado — y se avisa si hizo falta
// una distinta de la literal, para poder corregir el secret con calma.
function variantesPass(p) {
  const v = [];
  for (const s of [p, p.trim()]) for (const f of [null, 'NFC', 'NFD']) {
    const n = f ? s.normalize(f) : s;
    if (!v.includes(n)) v.push(n);
  }
  return v;
}

async function cargarCartera(perfil) {
  const ruta = new URL(`../datos/cartera-${perfil}.enc.json`, import.meta.url);
  if (existsSync(ruta)) {
    if (!process.env.CARTERA_PASS) throw new Error('hay fichero cifrado pero falta el secret CARTERA_PASS');
    const sobre = JSON.parse(readFileSync(ruta, 'utf8'));
    const variantes = variantesPass(process.env.CARTERA_PASS);
    let datos, abierto = false, usada = 0;
    for (let i = 0; i < variantes.length && !abierto; i++) {
      try { datos = await descifrar(sobre, variantes[i]); abierto = true; usada = i; } catch { /* probamos la siguiente */ }
    }
    if (!abierto) throw new Error('CARTERA_PASS no abre el fichero (¿cambiaste la contraseña en la app y no en el secret?)');
    if (usada > 0) console.log('  ⚠ CARTERA_PASS solo abrió el fichero tras limpiar espacios o normalizar acentos. Funciona, pero conviene corregir el secret.');
    return { datos, publicado: Date.parse(sobre.actualizado) || null, origen: 'app' };
  }
  // Respaldo del método antiguo, solo para Marc: el secret que se pegaba a mano.
  if (perfil === 'marc' && process.env.POSICIONES_JSON) {
    const c = JSON.parse(process.env.POSICIONES_JSON);
    return { datos: Array.isArray(c) ? { assets: c } : c, publicado: null, origen: 'secret' };
  }
  return null;
}

// ── 4. Noticias (Yahoo Finance search, sin clave) ─────────────────────────────
// La caché es global: si las dos carteras llevan oro, se pregunta una vez.
const cacheNoticias = new Map();
async function noticiasDe(q) {
  if (cacheNoticias.has(q)) return cacheNoticias.get(q);
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=4&quotesCount=0&lang=es-ES&region=ES`;
  const p = (async () => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (informe-cartera)' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return [];
      const d = await r.json();
      return (d.news || []).map(n => ({
        titulo: n.title, medio: n.publisher, enlace: n.link,
        ts: (n.providerPublishTime || 0) * 1000, sobre: q,
      }));
    } catch { return []; }
  })();
  cacheNoticias.set(q, p);
  return p;
}

// ── 4b. Enlace al gráfico de cada activo (TradingView; Yahoo para fondos) ────
const TV_EXCH = { MC: 'BME', MI: 'MIL', DE: 'XETR', L: 'LSE', PA: 'EURONEXT', AS: 'EURONEXT', SW: 'SIX', F: 'FWB' };
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const CRIPTO = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'XRP', 'DOT', 'AVAX', 'LINK', 'DOGE', 'LTC']);
const chartURL = a => {
  const t = up(a.ticker);
  if (CRIPTO.has(t)) return 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(t + 'EUR');
  const sym = a.yfSym || keyOf(a) || (t && !ISIN_RE.test(t) ? t : '');
  if (!sym) return null;
  if (sym === 'GC=F') return 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent('COMEX:GC1!');
  if (sym === 'SI=F') return 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent('COMEX:SI1!');
  const [base, suf] = sym.split('.');
  if (base.startsWith('0P') || ISIN_RE.test(base)) return 'https://es.finance.yahoo.com/quote/' + encodeURIComponent(sym);
  if (!suf) return 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(base);
  const ex = TV_EXCH[suf];
  return ex ? 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(ex + ':' + base)
            : 'https://es.finance.yahoo.com/quote/' + encodeURIComponent(sym);
};

// ── 5. Construir el informe de un perfil ──────────────────────────────────────
const col = n => n == null ? '#8b86a8' : n >= 0 ? '#1f9d55' : '#d64545';
const flecha = n => n == null ? '' : n >= 0 ? '▲' : '▼';

async function construirInforme(perfil, carga) {
  const assets = carga.datos.assets || [];

  const filas = assets.map(a => {
    const p = px(a), pv = pxPrev(a);
    const valor = p != null ? a.qty * p : null;
    const coste = a.qty * (a.costUnit || 0) * rateDe(a);
    const dia = (p != null && pv > 0 && a.cat !== 'liquidez')
      ? { abs: a.qty * (p - pv), pct: (p - pv) / pv * 100 } : null;
    return { a, valor, coste, dia };
  });
  const total = filas.reduce((s, f) => s + (f.valor || 0), 0);
  const costeTotal = filas.reduce((s, f) => s + f.coste, 0);
  let diaAbs = 0, diaBase = 0, hayDia = false;
  for (const f of filas) if (f.dia) { diaAbs += f.dia.abs; diaBase += (f.valor || 0) - f.dia.abs; hayDia = true; }
  const diaPct = hayDia && diaBase > 0 ? diaAbs / diaBase * 100 : null;
  const ganTotal = total - costeTotal;

  const conDia = filas.filter(f => f.dia && Math.abs(f.dia.abs) >= 0.01);
  const subidas = conDia.filter(f => f.dia.abs > 0).sort((x, y) => y.dia.abs - x.dia.abs).slice(0, 3);
  const bajadas = conDia.filter(f => f.dia.abs < 0).sort((x, y) => x.dia.abs - y.dia.abs).slice(0, 3);

  const consultaDe = f => {
    const a = f.a, u = (a.underlying || a.name || '').toLowerCase();
    if (/bitcoin/.test(u)) return 'BTC-USD';
    if (/ethereum/.test(u)) return 'ETH-USD';
    if (/\boro\b|gold/.test(u)) return 'GC=F';
    if (/plata|silver/.test(u)) return 'SI=F';
    if (a.yfSym && !a.yfSym.startsWith('0P')) return a.yfSym;
    if (a.ticker && !up(a.ticker).startsWith('0P')) return up(a.ticker);
    return null;
  };
  const consultas = [];
  for (const f of filas.slice().sort((x, y) => (y.valor || 0) - (x.valor || 0))) {
    if (f.a.cat === 'liquidez' || f.a.cat === 'fondo') continue;
    const q = consultaDe(f);
    if (q && !consultas.includes(q)) consultas.push(q);
    if (consultas.length >= 6) break;
  }
  const brutas = (await Promise.all(consultas.map(noticiasDe))).flat();
  const vistas = new Set();
  const noticias = brutas
    .filter(n => n.titulo && n.enlace && !vistas.has(n.titulo) && vistas.add(n.titulo))
    .filter(n => n.ts > Date.now() - 48 * 3600 * 1000)
    .sort((x, y) => y.ts - x.ts)
    .slice(0, 8);

  const signo = diaAbs >= 0 ? '+' : '';
  const fechaCorta = new Date().toLocaleDateString('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit' });
  const asunto = hayDia
    ? `📊 Cartera ${perfil.nombre} ${fechaCorta}: ${signo}${fe(diaAbs)} (${fp(diaPct)})`
    : `📊 Cartera ${perfil.nombre} ${fechaCorta}: sin datos intradía hoy`;

  // Si la app lleva días sin publicar, el informe estaría contando una cartera
  // vieja sin decirlo. Antes pasaba siempre y en silencio; ahora se avisa.
  const diasSinPublicar = carga.publicado ? Math.floor((Date.now() - carga.publicado) / 864e5) : null;
  const avisoDatos =
    carga.origen === 'secret'
      ? 'Estas posiciones vienen del secret POSICIONES_JSON, que se actualiza a mano. Conecta la app (botón «Informe diario») para que se publiquen solas.'
      : diasSinPublicar != null && diasSinPublicar >= 4
        ? `La app no publica la cartera desde hace ${diasSinPublicar} días. Ábrela para que se ponga al día.`
        : null;

  const filaHtml = f => {
    const d = f.dia;
    const cu = chartURL(f.a);
    const nombre = cu
      ? `<a href="${esc(cu)}" style="color:#2c2846;text-decoration:none">${esc(f.a.name)} <span style="color:#8b86a8;font-size:11px">📈</span></a>`
      : esc(f.a.name);
    return `<tr>
      <td style="padding:7px 10px;border-bottom:1px solid #eee9f7">${nombre}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee9f7;text-align:right;white-space:nowrap">${fe(f.valor)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee9f7;text-align:right;white-space:nowrap;color:${col(d?.abs)}">${d ? `${flecha(d.abs)} ${fe(d.abs)}` : '—'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee9f7;text-align:right;white-space:nowrap;color:${col(d?.pct)}">${d ? fp(d.pct) : '—'}</td>
    </tr>`;
  };
  const moverHtml = f =>
    `<li style="margin:4px 0">${esc(f.a.name)}: <b style="color:${col(f.dia.abs)}">${flecha(f.dia.abs)} ${fe(f.dia.abs)} (${fp(f.dia.pct)})</b></li>`;
  const notiHtml = n =>
    `<li style="margin:8px 0"><a href="${esc(n.enlace)}" style="color:#5b4bc4;text-decoration:none;font-weight:600">${esc(n.titulo)}</a><br>
     <span style="color:#8b86a8;font-size:12px">${esc(n.medio || '')} · ${esc(n.sobre)} · ${new Date(n.ts).toLocaleString('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></li>`;

  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f4f2fb;font-family:'Segoe UI',Arial,sans-serif;color:#2c2846">
<div style="max-width:640px;margin:0 auto;padding:24px 14px">
  <div style="background:linear-gradient(135deg,#5b4bc4,#8e7cf0);border-radius:16px;padding:22px 24px;color:#fff">
    <div style="font-size:13px;opacity:.85">Cartera de ${esc(perfil.nombre)} · ${esc(fechaLarga)} · ${esc(horaTexto)} (Madrid)</div>
    <div style="font-size:15px;margin-top:10px;opacity:.9">Valor de la cartera</div>
    <div style="font-size:32px;font-weight:800">${fe(total)}</div>
    <div style="font-size:18px;font-weight:700;margin-top:6px;color:${diaAbs >= 0 ? '#b8f5c9' : '#ffc9c9'}">
      ${flecha(diaAbs)} Hoy: ${signo}${fe(diaAbs)} (${fp(diaPct)})
    </div>
    <div style="font-size:13px;margin-top:4px;opacity:.85">Desde compra: ${ganTotal >= 0 ? '+' : ''}${fe(ganTotal)} (${fp(costeTotal > 0 ? ganTotal / costeTotal * 100 : null)})</div>
    ${feedViejo ? `<div style="margin-top:8px;font-size:12px;background:rgba(0,0,0,.25);border-radius:8px;padding:6px 10px">⚠️ Ojo: el feed de precios lleva más de 3 h sin actualizarse (${new Date(feedTs).toLocaleString('es-ES', { timeZone: TZ })}).</div>` : ''}
    ${avisoDatos ? `<div style="margin-top:8px;font-size:12px;background:rgba(0,0,0,.25);border-radius:8px;padding:6px 10px">⚠️ ${esc(avisoDatos)}</div>` : ''}
  </div>

  <div style="background:#fff;border-radius:16px;padding:18px 22px;margin-top:14px">
    <h2 style="font-size:16px;margin:0 0 8px">🔎 Qué ha movido la cartera hoy</h2>
    ${subidas.length ? `<div style="font-size:13px;color:#8b86a8;margin-top:6px">Tiran hacia arriba</div><ul style="margin:4px 0;padding-left:18px;font-size:14px">${subidas.map(moverHtml).join('')}</ul>` : ''}
    ${bajadas.length ? `<div style="font-size:13px;color:#8b86a8;margin-top:6px">Pesan hacia abajo</div><ul style="margin:4px 0;padding-left:18px;font-size:14px">${bajadas.map(moverHtml).join('')}</ul>` : ''}
    ${!conDia.length ? '<p style="font-size:14px">Sin movimientos intradía relevantes (o sin datos de cierre anterior).</p>' : ''}
  </div>

  <div style="background:#fff;border-radius:16px;padding:18px 22px;margin-top:14px">
    <h2 style="font-size:16px;margin:0 0 10px">📋 Posiciones</h2>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr style="color:#8b86a8;text-align:right"><th style="text-align:left;padding:4px 10px">Activo</th><th style="padding:4px 10px">Valor</th><th style="padding:4px 10px">Hoy €</th><th style="padding:4px 10px">Hoy %</th></tr>
      ${filas.slice().sort((x, y) => (y.valor || 0) - (x.valor || 0)).map(filaHtml).join('')}
    </table>
  </div>

  ${noticias.length ? `<div style="background:#fff;border-radius:16px;padding:18px 22px;margin-top:14px">
    <h2 style="font-size:16px;margin:0 0 8px">📰 Noticias de tus posiciones (últimas 48 h)</h2>
    <ul style="margin:0;padding-left:18px;font-size:14px">${noticias.map(notiHtml).join('')}</ul>
  </div>` : ''}

  <div style="text-align:center;color:#8b86a8;font-size:11px;margin-top:16px">
    Informe automático (GitHub Actions) · precios del feed de ${new Date(feedTs).toLocaleTimeString('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}${carga.publicado ? ` · cartera publicada el ${new Date(carga.publicado).toLocaleString('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
  </div>
</div></body></html>`;

  return { asunto, html, resumen: `total ${fe(total)}, día ${signo}${fe(diaAbs)} (${fp(diaPct)}), ${noticias.length} noticias` };
}

// ── 6. Envío ──────────────────────────────────────────────────────────────────
// Gmail con contraseña de aplicación es lo único gratis que entrega a cualquier
// dirección: el remitente de pruebas de Resend solo escribe al dueño de la
// cuenta, así que con él nunca le llegaría nada a Leti.
let transporte = null;
async function enviar(destino, asunto, html) {
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    if (!transporte) {
      const { default: nodemailer } = await import('nodemailer');
      transporte = nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 465, secure: true,
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '') },
      });
    }
    const info = await transporte.sendMail({
      from: `"${REMITE_NOMBRE}" <${process.env.GMAIL_USER}>`, to: destino, subject: asunto, html,
    });
    return info.messageId || 'enviado';
  }
  if (process.env.RESEND_API_KEY) {
    const rs = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${REMITE_NOMBRE} <onboarding@resend.dev>`, to: [destino], subject: asunto, html }),
    });
    const txt = await rs.text();
    if (!rs.ok) throw new Error(`Resend devolvió ${rs.status}: ${txt}`);
    return txt;
  }
  throw new Error('sin transporte: faltan GMAIL_USER + GMAIL_APP_PASSWORD (o RESEND_API_KEY)');
}

// ── 7. Bucle principal ────────────────────────────────────────────────────────
if (!existsSync(MARCAS)) mkdirSync(MARCAS, { recursive: true });
let fallos = 0, enviados = 0;

for (const perfil of PERFILES) {
  const marca = `${MARCAS}/${perfil.id}-${hoyMadrid}`;
  if (existsSync(marca)) { console.log(`· ${perfil.nombre}: ya se envió hoy, se salta.`); continue; }

  let carga;
  try { carga = await cargarCartera(perfil.id); }
  catch (e) { console.error(`✗ ${perfil.nombre}: ${e.message}`); fallos++; continue; }

  if (!carga) { console.log(`· ${perfil.nombre}: sin cartera publicada todavía (datos/cartera-${perfil.id}.enc.json no existe). Se salta.`); continue; }
  if (!(carga.datos.assets || []).length) { console.log(`· ${perfil.nombre}: la cartera publicada no tiene posiciones. Se salta.`); continue; }

  const { asunto, html } = await construirInforme(perfil, carga);
  writeFileSync(`informe-${perfil.id}.html`, html);
  // Sin cifras: el log de Actions de un repo público lo lee cualquiera sin cuenta.
  console.log(`✓ ${perfil.nombre}: informe generado desde ${carga.origen}.`);

  if (process.env.DRY_RUN === '1') { console.log(`  DRY_RUN=1: no se envía. Revisa informe-${perfil.id}.html.`); continue; }
  if (!perfil.destino) { console.error(`✗ ${perfil.nombre}: falta el secret MAIL_${perfil.id.toUpperCase()}, no hay a quién escribir.`); fallos++; continue; }

  try {
    const r = await enviar(perfil.destino, asunto, html);
    // La marca es lo que impide que los crons de respaldo repitan el correo.
    writeFileSync(marca, new Date().toISOString());
    enviados++;
    console.log(`  Correo enviado a ${perfil.nombre}: ${String(r).slice(0, 120)}`);
  } catch (e) { console.error(`✗ ${perfil.nombre}: no se pudo enviar — ${e.message}`); fallos++; }
}

if (transporte) transporte.close();
console.log(`Resumen: ${enviados} correo(s) enviado(s), ${fallos} fallo(s).`);
if (fallos) process.exitCode = 1;
