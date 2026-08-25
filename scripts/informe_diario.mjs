// Informe diario de cartera por correo — 100% gratuito, sin APIs de pago.
// Un correo por perfil: la cartera de Marc a su dirección y la de Leti a la suya.
//
// - Posiciones: datos/cartera-<perfil>.enc.json, que la propia app publica cifrado
//   cada vez que cambias algo (el repo es público, así que nunca va en claro).
//   Respaldo para Marc: el viejo secret POSICIONES_JSON, si el fichero no existe.
// - Precios: precios.json del repo (mismo feed que usa index.html).
// - Mercado: SPY y EUR/USD de Yahoo Finance en el momento del envío (sin clave).
// - Noticias: endpoint público de búsqueda de Yahoo Finance (sin clave).
// - Redacción: el comentario del día se escribe con plantillas a partir de las
//   cifras. Si existe ANTHROPIC_API_KEY (opcional, de pago), lo redacta Claude
//   con los titulares del día; sin ella todo sigue funcionando igual.
// - Gráfico: donut en PNG generado aquí mismo (Gmail no pinta SVG ni ejecuta JS).
// - Envío: SMTP de Gmail con contraseña de aplicación; Resend como respaldo.
//
// Ejecutar con Node >= 18 desde la raíz del repo: node scripts/informe_diario.mjs
// Vars: CARTERA_PASS (descifra), MAIL_MARC / MAIL_LETI (destinos),
//       GMAIL_USER + GMAIL_APP_PASSWORD (envío) o RESEND_API_KEY (respaldo),
//       POSICIONES_JSON (respaldo de datos), FORCE=1 (salta el control horario),
//       DRY_RUN=1 (genera pero no envía), ANTHROPIC_API_KEY (comentario con IA).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { donutPNG } from './tarta_png.mjs';

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
const nf = (n, d) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fe = (n, d = 2) => n == null || isNaN(n) ? '—' : nf(n, d) + ' €';
const fes = (n, d = 2) => n == null || isNaN(n) ? '—' : (n >= 0 ? '+' : '') + fe(n, d);   // con signo
const fp = n => n == null || !isFinite(n) ? '—' : (n >= 0 ? '+' : '') + nf(n, 2) + '%';
const fpp = n => n == null || !isFinite(n) ? '—' : (n >= 0 ? '+' : '') + nf(n, 2) + ' pp';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Paleta ───────────────────────────────────────────────────────────────────
// Los mismos colores de la app: el correo y la pantalla tienen que poder leerse
// juntos, y si el oro fuera dorado en una y azul en el otro no habría forma.
const C = {
  tinta: '#28234a', tinta2: '#4e4870', suave: '#736d95', tenue: '#9d97b8',
  linea: '#e8e4f5', linea2: '#d9d4ec', fondo: '#f3f1fb', tarjeta: '#ffffff', pista: '#f0edfa',
  up: '#0ea97d', dn: '#f0537c',
  violeta: '#5b4bc4', violeta2: '#8e7cf0',
};
const UND_COLORS = {
  'Oro': '#e9a23b', 'Bitcoin': '#f7931a', 'Ethereum': '#627eea', 'Plata': '#8fa3b8',
  'S&P 500': '#6d7df6', 'MSCI World': '#22b8cf', 'China': '#e5484d',
  'Strategy': '#9b7bf3', 'Caixabank': '#2fbf9c', 'Liquidez': '#9a94b8',
};
const UND_PALETA = ['#6d7df6', '#2fbf9c', '#e9a23b', '#9b7bf3', '#f783ac', '#22b8cf', '#ff8e42', '#0ea97d', '#c6b5f8', '#e5484d', '#8fa3b8', '#ffb477'];
// Hash del nombre, no índice de posición: el color de un subyacente tiene que
// ser el mismo hoy y mañana aunque cambie el orden de la cartera.
const undColor = u => {
  if (UND_COLORS[u]) return UND_COLORS[u];
  const t = String(u || ''); let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return UND_PALETA[h % UND_PALETA.length];
};
// Posiciones antiguas guardadas sin subyacente. Copiado tal cual de index.html
// para que el correo agrupe exactamente igual que la pantalla.
const UND_MAP = {
  1: 'Liquidez', 2: 'Oro', 3: 'Bitcoin', 4: 'Oro', 5: 'Ethereum',
  6: 'S&P 500', 7: 'S&P 500', 8: 'MSCI World', 9: 'China',
  10: 'Strategy', 11: 'Caixabank', 12: 'Oro', 13: 'Bitcoin', 14: 'Ethereum',
  15: 'Oro', 16: 'Plata', 17: 'S&P 500', 18: 'Liquidez',
};
const und = a => a.cat === 'liquidez' ? 'Liquidez' : (a.underlying || UND_MAP[a.id] || a.name);

const col = n => n == null ? C.suave : n > 0 ? C.up : n < 0 ? C.dn : C.suave;
const flecha = n => n == null ? '' : n >= 0 ? '▲' : '▼';

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

// ── 4. Mercado del día: SPY (y el euro) ───────────────────────────────────────
// Se pide en el momento del envío y no al feed: precios.json se regenera cada
// 15 min y puede llevar una hora de retraso justo cuando cierra Wall Street,
// que es lo único que importa para el «hoy» del SPY.
//
// El porcentaje que se enseña es el del SPY EN EUROS. La cartera se mide en
// euros y las posiciones en el índice no llevan cobertura de divisa: comparar
// contra el SPY en dólares escondería el efecto del cambio, que sí se sufre.
// Es el mismo criterio que usa benchmark.json en la pestaña Análisis.
async function serieYahoo(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=10d&interval=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (informe-cartera)' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Yahoo devolvió ${r.status} para ${sym}`);
  const d = await r.json();
  const res = d?.chart?.result?.[0];
  if (!res) throw new Error(`sin serie para ${sym}`);
  const ts = res.timestamp || [], cierres = res.indicators?.quote?.[0]?.close || [];
  // Yahoo manda close:null en la vela del día mientras la sesión está abierta;
  // si no se filtran, el «cierre anterior» se corre un día entero.
  const velas = ts.map((t, i) => ({ dia: new Date(t * 1000).toISOString().slice(0, 10), c: cierres[i] }))
                  .filter(v => v.c > 0);
  return { ahora: res.meta?.regularMarketPrice, velas };
}
// Último precio y cierre anterior de verdad: la última vela solo cuenta como
// «cierre anterior» si no es la de hoy.
function ultimoYPrevio(s) {
  if (!s.velas.length) return null;
  const hoy = new Date().toISOString().slice(0, 10);
  const ult = s.velas[s.velas.length - 1];
  const esDeHoy = ult.dia === hoy;
  const prev = esDeHoy ? s.velas[s.velas.length - 2] : ult;
  if (!prev) return null;
  const ahora = s.ahora > 0 ? s.ahora : ult.c;
  return { ahora, prev: prev.c };
}
let mercadoCache = null;
function mercadoDia() {
  if (mercadoCache) return mercadoCache;
  mercadoCache = (async () => {
    try {
      const [spy, eur] = await Promise.all([serieYahoo('SPY'), serieYahoo('EURUSD=X').catch(() => null)]);
      const s = ultimoYPrevio(spy);
      if (!s) return null;
      const pctUsd = (s.ahora - s.prev) / s.prev * 100;
      let pctEur = null;
      const e = eur && ultimoYPrevio(eur);
      // SPY en euros = SPY en dólares dividido por los dólares que cuesta un euro.
      if (e && e.ahora > 0 && e.prev > 0) pctEur = ((s.ahora / e.ahora) / (s.prev / e.prev) - 1) * 100;
      return { pctUsd, pctEur, pct: pctEur ?? pctUsd, enEuros: pctEur != null };
    } catch (e) {
      console.log(`  · sin datos del SPY (${e.message}): el informe sale sin comparación con el mercado.`);
      return null;
    }
  })();
  return mercadoCache;
}

// ── 5. Noticias (Yahoo Finance search, sin clave) ─────────────────────────────
// La caché es global: si las dos carteras llevan oro, se pregunta una vez.
const cacheNoticias = new Map();
async function noticiasDe(q, etiqueta) {
  const clave = q + '|' + etiqueta;
  if (cacheNoticias.has(clave)) return cacheNoticias.get(clave);
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=4&quotesCount=0&lang=es-ES&region=ES`;
  const p = (async () => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (informe-cartera)' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return [];
      const d = await r.json();
      return (d.news || []).map(n => ({
        titulo: n.title, medio: n.publisher, enlace: n.link,
        ts: (n.providerPublishTime || 0) * 1000, sobre: etiqueta,
      }));
    } catch { return []; }
  })();
  cacheNoticias.set(clave, p);
  return p;
}

// ── 5b. Enlace al gráfico de cada activo (TradingView; Yahoo para fondos) ────
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

// ── 6. Cifras del perfil ──────────────────────────────────────────────────────
// Las mismas fórmulas que index.html, y por los mismos motivos:
//
//  · El coste de la LIQUIDEZ es su propio saldo. Una cuenta guardada con
//    costUnit:0 mandaba el saldo entero al correo como plusvalía.
//  · Lo APORTADO no es el coste: al cerrar una venta con ganancia el importe
//    entra en la liquidez y el coste total sube sin que haya entrado un euro de
//    fuera. Por eso se le restan el resultado realizado y los cobros, igual que
//    hace aportadoHoy() en la app.
function calcular(datos) {
  const assets = datos.assets || [];
  const trades = datos.trades || [], rendim = datos.rendim || [];

  const filas = assets.map(a => {
    const p = px(a), pv = pxPrev(a);
    const valor = p != null ? a.qty * p : null;
    const coste = a.cat === 'liquidez'
      ? a.qty * (a.mp ?? 1) * rateDe(a)
      : a.qty * (a.costUnit || 0) * rateDe(a);
    const dia = (p != null && pv > 0 && a.cat !== 'liquidez')
      ? { abs: a.qty * (p - pv), pct: (p - pv) / pv * 100 } : null;
    return { a, u: und(a), valor, coste, dia };
  });

  const total = filas.reduce((s, f) => s + (f.valor || 0), 0);
  const costeTotal = filas.reduce((s, f) => s + f.coste, 0);
  const liquidez = filas.filter(f => f.a.cat === 'liquidez').reduce((s, f) => s + (f.valor || 0), 0);

  let diaAbs = 0, diaBase = 0, hayDia = false;
  for (const f of filas) if (f.dia) { diaAbs += f.dia.abs; diaBase += (f.valor || 0) - f.dia.abs; hayDia = true; }
  const diaPct = hayDia && diaBase > 0 ? diaAbs / diaBase * 100 : null;

  const ahora = Date.now();
  const realizado = trades.reduce((s, t) => {
    const d = t.dateOut ? Date.parse(t.dateOut) : NaN;
    return isFinite(d) && d <= ahora ? s + (+t.result || 0) : s;
  }, 0);
  const cobrado = rendim.reduce((s, r) => {
    const d = Date.parse(r.date);
    return isFinite(d) && d <= ahora ? s + (+r.eur || 0) : s;
  }, 0);
  const ganTotal = (total - costeTotal) + realizado + cobrado;
  const aportado = costeTotal - realizado - cobrado;
  const rentPct = aportado > 0 ? ganTotal / aportado * 100 : null;

  // Reparto por subyacente, CON liquidez: es el reparto de verdad del dinero.
  // Una tarta que escondiera el efectivo diría que se está más invertido de lo
  // que se está, que es justo el error que hay que poder ver de un vistazo.
  const mapa = new Map();
  for (const f of filas) {
    if (!(f.valor > 0)) continue;
    let g = mapa.get(f.u);
    if (!g) { g = { u: f.u, v: 0, items: [] }; mapa.set(f.u, g); }
    g.v += f.valor; g.items.push(f);
  }
  const reparto = [...mapa.values()]
    .map(g => ({ ...g, pct: total > 0 ? g.v / total * 100 : 0, col: undColor(g.u) }))
    .sort((x, y) => y.v - x.v);

  // Qué mueve hoy, agrupado por subyacente y ordenado por EUROS: un +9% sobre
  // 200 € mueve menos la cartera que un +0,4% sobre 20 000 €.
  const mm = new Map();
  for (const f of filas) {
    if (!f.dia || f.a.cat === 'liquidez') continue;
    let g = mm.get(f.u);
    if (!g) { g = { u: f.u, abs: 0, base: 0, items: [] }; mm.set(f.u, g); }
    g.abs += f.dia.abs; g.base += (f.valor || 0) - f.dia.abs;
    g.items.push({ name: f.a.name, broker: f.a.broker || 'Otro', abs: f.dia.abs, pct: f.dia.pct });
  }
  const movers = [...mm.values()]
    .map(g => ({ ...g, pct: g.base > 0 ? g.abs / g.base * 100 : 0, col: undColor(g.u),
                 items: g.items.sort((x, y) => Math.abs(y.abs) - Math.abs(x.abs)) }))
    .filter(m => Math.abs(m.abs) >= 0.01)
    .sort((x, y) => Math.abs(y.abs) - Math.abs(x.abs));

  const fuera = filas.filter(f => f.a.cat !== 'liquidez' && !f.dia).length;

  return { filas, total, costeTotal, liquidez, diaAbs, diaPct, hayDia,
           realizado, cobrado, ganTotal, aportado, rentPct, reparto, movers, fuera };
}

// ── 7. El comentario del día ──────────────────────────────────────────────────
// Tres casos, porque «plano» puede querer decir dos cosas muy distintas: que no
// se mueve nada, o que se mueve mucho y se compensa. La segunda es justo la que
// no se ve mirando solo el porcentaje de la cabecera.
function comentario(k, mercado) {
  const { diaAbs, diaPct, movers, hayDia } = k;
  if (!hayDia || !movers.length) {
    return 'Hoy no hay variación del día que contar: falta el cierre anterior de las posiciones. Suele ser cosa del feed de precios, no de la cartera.';
  }
  const sube = diaAbs >= 0;
  const bruto = movers.reduce((s, m) => s + Math.abs(m.abs), 0);
  const aFavor = movers.filter(m => sube ? m.abs > 0 : m.abs < 0);
  const enContra = movers.filter(m => sube ? m.abs < 0 : m.abs > 0);
  const motor = aFavor[0], freno = enContra[0];
  const ladoTot = aFavor.reduce((s, m) => s + Math.abs(m.abs), 0);

  let t;
  if (bruto < 0.5) {
    t = 'Día plano: hoy no se mueve nada que se note.';
  } else if (Math.abs(diaAbs) < bruto * 0.18 && motor && freno) {
    t = `La cartera se queda casi igual (<b>${fes(diaAbs, 0)}</b>), pero por dentro sí se mueve: `
      + `<b>${esc(motor.u)}</b> ${fes(motor.abs, 0)} y <b>${esc(freno.u)}</b> ${fes(freno.abs, 0)} se anulan entre sí.`;
  } else {
    t = `La cartera <b>${sube ? 'sube' : 'baja'} ${nf(Math.abs(diaPct ?? 0), 2)}%</b> hoy · <b>${fes(diaAbs, 0)}</b>.`;
    if (motor) {
      const cuota = ladoTot > 0 ? Math.abs(motor.abs) / ladoTot * 100 : 0;
      t += ` Manda <b>${esc(motor.u)}</b> con ${fes(motor.abs, 0)}`
         + (cuota >= 35 ? ` — el ${nf(cuota, 0)}% de todo lo que ${sube ? 'sube' : 'baja'} hoy` : '') + '.';
    }
    if (freno && Math.abs(freno.abs) >= 0.5 && Math.abs(freno.abs) >= Math.abs(diaAbs) * 0.12)
      t += ` En sentido contrario, <b>${esc(freno.u)}</b> ${fes(freno.abs, 0)}.`;
  }

  // El contexto de mercado va en la misma frase: sin él, un −1,2% asusta aunque
  // ese día se haya caído el mundo entero.
  if (mercado && diaPct != null) {
    const dif = diaPct - mercado.pct;
    const comparativa = Math.abs(dif) < 0.15
      ? 'prácticamente en línea con el mercado'
      : `<b>${fpp(dif)}</b> ${dif > 0 ? 'por delante' : 'por detrás'} del mercado`;
    t += ` El S&amp;P 500${mercado.enEuros ? ' (en €)' : ''} ha hecho <b>${fp(mercado.pct)}</b>: vas ${comparativa}.`;
  }
  return t;
}

// Versión con IA, OPCIONAL y apagada por defecto: solo se activa si existe
// ANTHROPIC_API_KEY. Al modelo se le mandan porcentajes y nombres de subyacente
// —nunca euros, ni saldos, ni cuántas participaciones hay de nada—, así que del
// tamaño de la cartera no sale nada fuera. Si falla o tarda, se usa el texto de
// plantilla y el correo se envía igual.
async function comentarioIA(k, mercado, noticias) {
  const clave = process.env.ANTHROPIC_API_KEY;
  if (!clave || k.diaPct == null) return null;
  const top = k.movers.slice(0, 6).map(m => `${m.u}: ${fp(m.pct)}`).join(' · ');
  const tits = noticias.slice(0, 8).map(n => `- (${n.sobre}) ${n.titulo}`).join('\n');
  const prompt = `Eres un analista que escribe el resumen diario de una cartera para su dueño, en español de España.

Datos de hoy (${hoyMadrid}):
- La cartera se mueve ${fp(k.diaPct)}.
- S&P 500${mercado?.enEuros ? ' en euros' : ''}: ${mercado ? fp(mercado.pct) : 'sin dato'}.
- Movimiento por subyacente: ${top || 'sin datos'}.

Titulares de las últimas 48 h sobre esas posiciones:
${tits || '(ninguno)'}

Escribe 2 o 3 frases, 55 palabras como mucho, que expliquen QUÉ ha pasado y POR QUÉ se ha movido la cartera, apoyándote en los titulares cuando encajen con el movimiento. Empieza por la cartera. Si ningún titular explica el movimiento, dilo en vez de inventar una causa. Nada de consejos de inversión ni de previsiones. Devuelve solo el texto, sin comillas ni markdown.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) throw new Error(`la API devolvió ${r.status}`);
    const d = await r.json();
    const txt = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
    return txt ? esc(txt) : null;
  } catch (e) {
    console.log(`  · comentario con IA no disponible (${e.message}); se usa el de plantilla.`);
    return null;
  }
}

// ── 8. Piezas del HTML ────────────────────────────────────────────────────────
// Todo con tablas y estilos en línea: Gmail borra las hojas de estilo del
// <head>, no entiende flex ni grid y recorta el CSS en la app móvil. Una sola
// columna de 600 px como máximo, cifras de 15-17 px y nada que obligue a hacer
// zoom ni a desplazarse en horizontal: el informe se lee de pie, en el metro.
const tarjeta = contenido =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.tarjeta};border-radius:16px;margin:0 0 12px">
     <tr><td style="padding:18px 16px">${contenido}</td></tr></table>`;

// Título de tarjeta, con una línea opcional que explica CÓMO se lee lo que hay
// debajo. Es la diferencia entre un gráfico bonito y uno que se entiende sin
// preguntarle a nadie, y cuesta una línea de 12 px.
const titulo = (t, pie) =>
  `<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.tenue};margin:0 0 ${pie ? 4 : 12}px">${t}</div>`
  + (pie ? `<div style="font-size:12px;line-height:1.45;color:${C.tenue};margin:0 0 13px">${pie}</div>` : '');

// Barra divergente: mitad izquierda para lo que resta, mitad derecha para lo que
// suma, con el eje en el centro. Se dibuja con celdas de tabla y bgcolor porque
// un <div> con el ancho en % dentro de un <td> no es fiable en Outlook.
//
// Debajo va siempre la pista completa, en lavanda muy claro. Sin ella, el día
// que Bitcoin se lleva el 90% del movimiento las demás filas quedaban reducidas
// a un punto suelto en mitad de la nada, sin forma de saber si eso era «poco» o
// un fallo de pintado. Con la pista se ve que la barra es corta, no que falta.
const barra = (v, max) => {
  const p = Math.max(2, Math.min(100, Math.round(Math.abs(v) / (max || 1) * 100)));
  const pos = v >= 0;
  const cel = (ancho, color, radio) => ancho <= 0 ? ''
    : `<td width="${ancho}%" bgcolor="${color}" style="background:${color};height:10px;line-height:10px;font-size:1px;border-radius:${radio}">&nbsp;</td>`;
  // El relleno arranca pegado al eje (esquina viva) y se redondea por fuera.
  const izq = pos ? cel(100, C.pista, '5px 0 0 5px')
                  : cel(100 - p, C.pista, '5px 0 0 5px') + cel(p, C.dn, '4px 0 0 4px');
  const der = pos ? cel(p, C.up, '0 4px 4px 0') + cel(100 - p, C.pista, '0 5px 5px 0')
                  : cel(100, C.pista, '0 5px 5px 0');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="50%" style="padding:0 2px 0 0;border-right:2px solid ${C.linea2}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${izq}</tr></table></td>
      <td width="50%" style="padding:0 0 0 2px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${der}</tr></table></td>
    </tr></table>`;
};

const punto = c => `<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${c};margin-right:7px"></span>`;

// Una fila del bloque «qué ha movido hoy»: nombre y cifras arriba, barra debajo.
// En dos líneas y no en tres columnas porque en un móvil de 320 px un nombre
// como «Bitcoin» con dos productos parte la fila en cuatro renglones.
const filaMover = (m, max) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 11px"><tr>
    <td style="font-size:15px;color:${C.tinta};padding:0 0 5px">${punto(m.col)}${esc(m.u)}${
      m.items.length > 1 ? `<span style="color:${C.tenue};font-size:12px;font-weight:600">&nbsp;·&nbsp;${m.items.length}</span>` : ''}</td>
    <td align="right" style="padding:0 0 5px;white-space:nowrap">
      <span style="font-size:15px;font-weight:700;color:${col(m.abs)}">${fes(m.abs, 0)}</span>
      <span style="font-size:13px;font-weight:600;color:${C.suave}">&nbsp;${fp(m.pct)}</span></td>
  </tr><tr><td colspan="2">${barra(m.abs, max)}</td></tr></table>`;

// ── 9. Construir el informe de un perfil ──────────────────────────────────────
async function construirInforme(perfil, carga) {
  const k = calcular(carga.datos);
  const mercado = await mercadoDia();

  // Las noticias se piden por lo que MÁS SE HA MOVIDO hoy, no por lo que más
  // pesa: son las que pueden explicar el día. Si no llega para seis consultas,
  // se completa con las posiciones grandes.
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
  const porUnd = new Map();
  for (const f of k.filas) if (!porUnd.has(f.u)) porUnd.set(f.u, f);
  const consultas = [];
  const pedir = f => {
    if (!f || f.a.cat === 'liquidez' || f.a.cat === 'fondo') return;
    const q = consultaDe(f);
    if (q && !consultas.some(c => c.q === q) && consultas.length < 6) consultas.push({ q, etiqueta: f.u });
  };
  for (const m of k.movers) pedir(porUnd.get(m.u));
  for (const f of k.filas.slice().sort((x, y) => (y.valor || 0) - (x.valor || 0))) pedir(f);

  const brutas = (await Promise.all(consultas.map(c => noticiasDe(c.q, c.etiqueta)))).flat();
  const vistas = new Set();
  const noticias = brutas
    .filter(n => n.titulo && n.enlace && !vistas.has(n.titulo) && vistas.add(n.titulo))
    .filter(n => n.ts > Date.now() - 48 * 3600 * 1000)
    .sort((x, y) => y.ts - x.ts)
    .slice(0, 6);

  const texto = (await comentarioIA(k, mercado, noticias)) || comentario(k, mercado);

  // ── Cabecera ───────────────────────────────────────────────────────────────
  const sube = k.diaAbs >= 0;
  const fechaCorta = new Date().toLocaleDateString('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit' });
  const asunto = k.hayDia
    ? `📊 Cartera ${perfil.nombre} ${fechaCorta}: ${fes(k.diaAbs)} (${fp(k.diaPct)})`
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
  const aviso = txt => `<div style="margin-top:10px;font-size:12px;line-height:1.45;background:rgba(0,0,0,.22);border-radius:9px;padding:8px 11px;color:#ffffff">⚠️ ${txt}</div>`;

  // La comparación con el mercado va en su propia fila: es la pregunta de «¿esto
  // es cosa mía o del día que ha hecho?» y merece verse sin abrir nada.
  const dif = mercado && k.diaPct != null ? k.diaPct - mercado.pct : null;
  const vsMercado = mercado ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;background:rgba(255,255,255,.15);border-radius:11px">
      <tr>
        <td width="50%" style="padding:10px 12px;font-size:13px;color:#ffffff">
          <span style="opacity:.82">S&amp;P 500${mercado.enEuros ? ' en €' : ''} hoy</span><br>
          <span style="font-size:17px;font-weight:700">${fp(mercado.pct)}</span>
        </td>
        <td width="50%" align="right" style="padding:10px 12px;font-size:13px;color:#ffffff">
          ${dif == null ? '' : `<span style="opacity:.82">Tu cartera va</span><br>
          <span style="font-size:17px;font-weight:700;color:${dif >= 0 ? '#b8f5c9' : '#ffc9c9'}">${fpp(dif)}</span>
          <span style="opacity:.82;font-size:12px">&nbsp;${dif >= 0 ? 'mejor' : 'peor'}</span>`}
        </td>
      </tr></table>` : '';

  const cabecera = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.violeta};background-image:linear-gradient(135deg,${C.violeta},${C.violeta2});border-radius:16px;margin:0 0 12px">
    <tr><td style="padding:20px 16px;color:#ffffff">
      <div style="font-size:12px;opacity:.85">Cartera de ${esc(perfil.nombre)} · ${esc(fechaLarga)} · ${esc(horaTexto)}</div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.75;margin-top:16px">Valor total</div>
      <div style="font-size:32px;font-weight:800">${fe(k.total)}</div>
      <div style="font-size:19px;font-weight:700;margin-top:8px;color:${k.hayDia ? (sube ? '#b8f5c9' : '#ffc9c9') : '#e6e1fb'}">
        ${k.hayDia ? `${flecha(k.diaAbs)}&nbsp;${fes(k.diaAbs)} · ${fp(k.diaPct)}` : 'Sin variación del día'}<span style="font-size:12px;font-weight:600;opacity:.82"> hoy</span>
      </div>
      ${vsMercado}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;background:rgba(255,255,255,.15);border-radius:11px">
        <tr><td style="padding:10px 12px;font-size:13px;color:#ffffff">
          <span style="opacity:.82">Rentabilidad acumulada</span><br>
          <span style="font-size:17px;font-weight:700">${fes(k.ganTotal, 0)}${k.rentPct != null ? ` · ${fp(k.rentPct)}` : ''}</span>
          ${k.aportado > 0 ? `<br><span style="opacity:.8;font-size:12px">sobre ${fe(k.aportado, 0)} aportados de tu bolsillo</span>` : ''}
        </td></tr></table>
      ${feedViejo ? aviso(`El feed de precios lleva más de 3 h sin actualizarse (${esc(new Date(feedTs).toLocaleString('es-ES', { timeZone: TZ }))}).`) : ''}
      ${avisoDatos ? aviso(esc(avisoDatos)) : ''}
    </td></tr></table>`;

  // ── Comentario del día ─────────────────────────────────────────────────────
  const bloqueTexto = tarjeta(
    `${titulo('Hoy, en corto')}
     <div style="font-size:16px;line-height:1.55;color:${C.tinta}">${texto}</div>`);

  // ── Qué ha movido la cartera ───────────────────────────────────────────────
  const TOP = 6;
  const vis = k.movers.slice(0, TOP), resto = k.movers.slice(TOP);
  const max = Math.max(...k.movers.map(m => Math.abs(m.abs)), 0.01);
  // El resto no desaparece: se agrupa en una fila para que las cifras sigan
  // sumando el total del día y no quede dinero movido sin explicar.
  const restoAbs = resto.reduce((s, m) => s + m.abs, 0);
  const restoBase = resto.reduce((s, m) => s + m.base, 0);
  const filaResto = resto.length ? filaMover({
    u: `Otros ${resto.length}`, col: C.linea2, items: [],
    abs: restoAbs, pct: restoBase > 0 ? restoAbs / restoBase * 100 : 0,
  }, max) : '';
  const notaFuera = k.fuera
    ? `<div style="font-size:12px;line-height:1.45;color:${C.tenue};margin-top:2px">${k.fuera === 1
        ? '1 posición se queda' : `${k.fuera} posiciones se quedan`} fuera del cálculo de hoy: sin precio de hoy o sin cierre anterior fiable.</div>` : '';
  const bloqueMovers = tarjeta(k.movers.length
    ? `${titulo('Qué ha movido la cartera hoy',
        'Euros que cada bloque suma o resta hoy. A la derecha del eje lo que tira hacia arriba, a la izquierda lo que pesa hacia abajo.')
      }${vis.map(m => filaMover(m, max)).join('')}${filaResto}${notaFuera}`
    : `${titulo('Qué ha movido la cartera hoy')}
       <div style="font-size:14px;line-height:1.5;color:${C.suave}">Todavía no hay variación del día: hace falta el precio de hoy y el cierre anterior de cada posición.</div>`);

  // ── Titulares ──────────────────────────────────────────────────────────────
  const bloqueNoticias = noticias.length ? tarjeta(
    `${titulo('Titulares de tus posiciones · 48 h')}
     ${noticias.map(n => `
       <div style="margin:0 0 13px">
         <a href="${esc(n.enlace)}" style="font-size:15px;line-height:1.4;color:${C.violeta};text-decoration:none;font-weight:600">${esc(n.titulo)}</a>
         <div style="font-size:12px;color:${C.tenue};margin-top:3px">${esc(n.medio || '')} · ${esc(n.sobre)} · ${esc(new Date(n.ts).toLocaleString('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</div>
       </div>`).join('')}`) : '';

  // ── Reparto de la cartera (donut + pesos) ──────────────────────────────────
  const tarta = donutPNG(k.reparto.map(g => ({ pct: g.pct, col: g.col })), { lado: 660 });
  const filaPeso = g => `
    <tr>
      <td style="padding:8px 0;border-top:1px solid ${C.linea};font-size:14px;line-height:1.35;color:${C.tinta}">${punto(g.col)}${esc(g.u)}</td>
      <td align="right" style="padding:8px 0 8px 8px;border-top:1px solid ${C.linea};font-size:15px;font-weight:700;color:${C.tinta};white-space:nowrap">${nf(g.pct, 1)}%</td>
      <td align="right" style="padding:8px 0 8px 12px;border-top:1px solid ${C.linea};font-size:13px;color:${C.suave};white-space:nowrap">${fe(g.v, 0)}</td>
    </tr>`;
  const bloqueTarta = tarjeta(
    `${titulo('Reparto de la cartera', 'Peso de cada bloque sobre el total, con la liquidez dentro: el dinero parado también ocupa sitio.')}
     <div style="text-align:center;margin:0 0 8px">
       <img src="cid:tarta" alt="Reparto de la cartera por subyacente" width="230"
            style="width:230px;max-width:75%;height:auto;display:inline-block;border:0">
     </div>
     <div style="text-align:center;font-size:13px;line-height:1.5;color:${C.suave};margin:0 0 14px">
       ${fe(k.total, 0)} repartidos en ${k.reparto.length} ${k.reparto.length === 1 ? 'bloque' : 'bloques'}${
         k.total > 0 ? `<br>${nf(k.liquidez / k.total * 100, 1)}% en liquidez · ${nf(100 - k.liquidez / k.total * 100, 1)}% invertido` : ''}
     </div>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
       ${k.reparto.map(filaPeso).join('')}
     </table>`);

  // ── Detalle de posiciones ──────────────────────────────────────────────────
  const filaPos = f => {
    const cu = chartURL(f.a);
    const nombre = cu
      ? `<a href="${esc(cu)}" style="color:${C.tinta};text-decoration:none">${esc(f.a.name)} <span style="color:${C.tenue};font-size:11px">↗</span></a>`
      : esc(f.a.name);
    return `<tr>
      <td style="padding:9px 0;border-top:1px solid ${C.linea};font-size:14px;line-height:1.35;color:${C.tinta}">
        ${nombre}<div style="font-size:11px;color:${C.tenue};margin-top:2px">${esc(f.a.broker || '')}</div></td>
      <td align="right" style="padding:9px 0 9px 10px;border-top:1px solid ${C.linea};white-space:nowrap">
        <div style="font-size:14px;font-weight:700;color:${C.tinta}">${fe(f.valor, 0)}</div>
        <div style="font-size:12px;font-weight:600;color:${col(f.dia?.abs)};margin-top:2px">${f.dia ? `${fes(f.dia.abs, 0)} · ${fp(f.dia.pct)}` : '—'}</div></td>
    </tr>`;
  };
  const bloquePosiciones = tarjeta(
    `${titulo('Detalle de posiciones')}
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
       ${k.filas.slice().sort((x, y) => (y.valor || 0) - (x.valor || 0)).map(filaPos).join('')}
     </table>`);

  // Texto de vista previa: lo que se lee en la bandeja de entrada sin abrir el
  // correo. Sin esto, Gmail enseña el primer texto que encuentre («Cartera de
  // Marc · lunes, 25 de…»), que no dice nada.
  const preheader = k.hayDia
    ? `${fe(k.total, 0)} · hoy ${fes(k.diaAbs, 0)} (${fp(k.diaPct)})${mercado ? ` · S&P 500 ${fp(mercado.pct)}` : ''}${k.movers[0] ? ` · manda ${k.movers[0].u}` : ''}`
    : `${fe(k.total, 0)} · hoy sin datos intradía`;

  const html = `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${esc(asunto)}</title>
</head>
<body style="margin:0;padding:0;background:${C.fondo};color:${C.tinta};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;-webkit-text-size-adjust:100%">
<div style="display:none;font-size:1px;color:${C.fondo};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.fondo}">
  <tr><td align="center" style="padding:14px 10px 22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">
      <tr><td>
${cabecera}
${bloqueTexto}
${bloqueMovers}
${bloqueNoticias}
${bloqueTarta}
${bloquePosiciones}
        <div style="text-align:center;color:${C.tenue};font-size:11px;line-height:1.6;padding:2px 8px">
          Informe automático (GitHub Actions) · precios del feed de ${esc(new Date(feedTs).toLocaleTimeString('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }))}${carga.publicado ? ` · cartera publicada el ${esc(new Date(carga.publicado).toLocaleString('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}` : ''}
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return {
    asunto, html,
    adjuntos: [{ filename: 'reparto.png', content: tarta, cid: 'tarta', contentType: 'image/png' }],
    // Para revisarlo en el navegador (DRY_RUN) no hay cid: que valga, así que
    // ahí la imagen va incrustada como data:.
    htmlPreview: html.replace('cid:tarta', 'data:image/png;base64,' + tarta.toString('base64')),
    resumen: `total ${fe(k.total)}, día ${fes(k.diaAbs)} (${fp(k.diaPct)}), ${noticias.length} noticias`,
  };
}

// ── 10. Envío ─────────────────────────────────────────────────────────────────
// Gmail con contraseña de aplicación es lo único gratis que entrega a cualquier
// dirección: el remitente de pruebas de Resend solo escribe al dueño de la
// cuenta, así que con él nunca le llegaría nada a Leti.
let transporte = null;
async function enviar(destino, asunto, html, adjuntos, htmlPreview) {
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
      attachments: (adjuntos || []).map(a => ({ ...a, contentDisposition: 'inline' })),
    });
    return info.messageId || 'enviado';
  }
  if (process.env.RESEND_API_KEY) {
    // Resend no garantiza el cid:, así que por esta vía la tarta va incrustada.
    const rs = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${REMITE_NOMBRE} <onboarding@resend.dev>`, to: [destino], subject: asunto, html: htmlPreview }),
    });
    const txt = await rs.text();
    if (!rs.ok) throw new Error(`Resend devolvió ${rs.status}: ${txt}`);
    return txt;
  }
  throw new Error('sin transporte: faltan GMAIL_USER + GMAIL_APP_PASSWORD (o RESEND_API_KEY)');
}

// ── 11. Bucle principal ───────────────────────────────────────────────────────
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

  const { asunto, html, htmlPreview, adjuntos } = await construirInforme(perfil, carga);
  writeFileSync(`informe-${perfil.id}.html`, htmlPreview);
  // Gmail recorta los mensajes de más de 102 KB y esconde el final tras un «ver
  // mensaje completo»: justo la tarta y las posiciones. Con la imagen adjunta
  // (cid:) y no incrustada el correo ronda los 35 KB, pero si algún día una
  // cartera enorme se acercara al límite conviene enterarse por el log y no
  // porque el correo aparezca cortado.
  const kb = Buffer.byteLength(html) / 1024;
  if (kb > 90) console.log(`  ⚠ el correo pesa ${kb.toFixed(0)} KB y Gmail recorta a partir de 102 KB. Toca acortar el detalle de posiciones.`);
  // Sin cifras: el log de Actions de un repo público lo lee cualquiera sin cuenta.
  console.log(`✓ ${perfil.nombre}: informe generado desde ${carga.origen}.`);

  if (process.env.DRY_RUN === '1') { console.log(`  DRY_RUN=1: no se envía. Revisa informe-${perfil.id}.html.`); continue; }
  if (!perfil.destino) { console.error(`✗ ${perfil.nombre}: falta el secret MAIL_${perfil.id.toUpperCase()}, no hay a quién escribir.`); fallos++; continue; }

  try {
    const r = await enviar(perfil.destino, asunto, html, adjuntos, htmlPreview);
    // La marca es lo que impide que los crons de respaldo repitan el correo.
    writeFileSync(marca, new Date().toISOString());
    enviados++;
    console.log(`  Correo enviado a ${perfil.nombre}: ${String(r).slice(0, 120)}`);
  } catch (e) { console.error(`✗ ${perfil.nombre}: no se pudo enviar — ${e.message}`); fallos++; }
}

if (transporte) transporte.close();
console.log(`Resumen: ${enviados} correo(s) enviado(s), ${fallos} fallo(s).`);
if (fallos) process.exitCode = 1;
