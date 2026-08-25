// Ejecutar con:  node scripts/test-cierre-anterior.js
//
// yfQuote() y el cierre anterior. El fallo que motivó esta suite:
//
//   Yahoo manda la vela diaria de HOY con close:null mientras la sesión está
//   abierta. El código filtraba los nulos y cogía `cl[cl.length-2]` como cierre
//   anterior, así que en cuanto la vela de hoy venía vacía el «penúltimo» pasaba
//   a ser el cierre de ANTEAYER y la variación del día era la de dos días.
//   En Physical Gold (GLDA.DE) eso eran +10,11 € en lugar de +4,60 €.
//
//   Peor: no era estable. loadFeed() escribe el cierre correcto y, pasado el TTL
//   de 90 s del feed, Yahoo lo pisaba con el incorrecto. El total del día saltaba
//   de un valor a otro y volvía (36 → 56 → 36) según quién escribiera el último.
//
// Los tres primeros casos son respuestas REALES de Yahoo capturadas el 24/08/2026.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = 'C:/Users/Marc/Desktop/Proyectos/Inversiones/Cartera/repo/index.html';

let ok = 0, ko = 0;
const eq = (a, b, msg, tol = 1e-6) => {
  const good = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : a === b;
  if (good) { ok++; console.log('  ✓ ' + msg); }
  else { ko++; console.log('  ✗ ' + msg + '  → esperado ' + b + ', obtenido ' + a); }
};

const D = d => Math.floor(Date.parse(d + 'T07:00:00Z') / 1000);

// Respuesta de Yahoo con la forma exacta que usa yfQuote().
const chart = ({ price, mktTime, ts, closes, cur = 'EUR' }) => ({
  chart: { result: [{
    meta: { regularMarketPrice: price, regularMarketTime: mktTime, currency: cur },
    timestamp: ts,
    indicators: { quote: [{ close: closes }] },
  }] },
});

// ── Casos ────────────────────────────────────────────────────────────────────
const CASOS = {
  // ETP europeo a media sesión: la vela de hoy existe pero viene con close:null.
  // Cierre anterior correcto = 156.29 (viernes 21), NO 153.39 (jueves 20).
  'GLDA.DE': chart({
    price: 158.71, mktTime: Date.parse('2026-08-24T15:36:00Z') / 1000,
    ts:     [D('2026-08-19'), D('2026-08-20'), D('2026-08-21'), D('2026-08-24')],
    closes: [152.36,          153.39,          156.29,          null],
  }),
  'GBSE.MI': chart({
    price: 24.41, mktTime: Date.parse('2026-08-24T15:35:00Z') / 1000,
    ts:     [D('2026-08-19'), D('2026-08-20'), D('2026-08-21'), D('2026-08-24')],
    closes: [23.42,           23.635,          24.04,           null],
  }),
  'XETH.DE': chart({
    price: 6.4195, mktTime: Date.parse('2026-08-24T15:36:00Z') / 1000,
    ts:     [D('2026-08-19'), D('2026-08-20'), D('2026-08-21'), D('2026-08-24')],
    closes: [5.286,           5.866,           6.1025,          null],
  }),
  // Acción USA en sesión: la vela de hoy SÍ trae dato. Aquí el criterio viejo y
  // el nuevo coinciden, y tienen que seguir coincidiendo.
  'MSTR': chart({
    price: 105.14, mktTime: Date.parse('2026-08-24T17:00:00Z') / 1000, cur: 'USD',
    ts:     [D('2026-08-20'), D('2026-08-21'), D('2026-08-24')],
    closes: [96.36,           102.24,          105.14],
  }),
  // Mercado cerrado (domingo): el último cierre ES el del día del precio.
  // El cierre anterior es el de la sesión de antes, no el mismo día.
  'CERRADO.MC': chart({
    price: 13.265, mktTime: Date.parse('2026-08-21T17:30:00Z') / 1000,
    ts:     [D('2026-08-19'), D('2026-08-20'), D('2026-08-21')],
    closes: [12.80,           12.905,          13.265],
  }),
  // Fondo (0P…) cuyo VL nuevo sólo aparece en la serie: el precio se toma del
  // último cierre, y el cierre anterior tiene que ser el de ANTES de ese, no el
  // de antes de la hora rezagada de regularMarketTime.
  '0P00000G12.F': chart({
    price: 79.0433, mktTime: Date.parse('2026-08-21T20:00:00Z') / 1000,
    ts:     [D('2026-08-20'), D('2026-08-21'), D('2026-08-24')],
    closes: [79.9388,         79.0433,         78.6399],
  }),
  // Serie sin timestamps utilizables: cae al criterio de respaldo.
  'SIN-FECHAS': chart({
    price: 10, mktTime: Date.parse('2026-08-24T15:00:00Z') / 1000,
    ts: [null, null, null], closes: [8, 9, 10],
  }),
};

(async () => {
  const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
    runScripts: 'dangerously', url: 'https://localhost/', pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem('cv9', JSON.stringify({
        assets: [{ id: 1, name: 'X', cat: 'liquidez', qty: 1, costUnit: 1, mp: 1, ccy: 'EUR', mode: 'manual' }],
        snaps: [], wl: [], targets: {}, trades: [], aports: [], rendim: [],
      }));
      w.fetch = () => Promise.reject(new Error('sin red'));
      w.HTMLCanvasElement.prototype.getContext = () => ({
        canvas: { width: 300, height: 150 }, save() {}, restore() {}, beginPath() {},
        moveTo() {}, lineTo() {}, stroke() {}, fill() {}, clearRect() {}, fillRect() {},
        arc() {}, closePath() {}, measureText: () => ({ width: 10 }), fillText() {},
        setTransform() {}, translate() {}, scale() {}, createLinearGradient: () => ({ addColorStop() {} }),
      });
      w.Chart = function () { return { destroy() {}, update() {}, data: {}, options: {} }; };
      w.Chart.register = () => {};
    },
  });
  const w = dom.window;
  await new Promise(r => w.addEventListener('load', r));
  await new Promise(r => setTimeout(r, 300));

  // pxFetch es una función de nivel superior: se puede sustituir por una que
  // devuelva las respuestas de laboratorio sin tocar la red ni los proxies.
  w.CASOS = CASOS;
  w.eval(`pxFetch = async function(urls){
    const u = Array.isArray(urls) ? urls[0] : urls;
    const sym = decodeURIComponent(u.split('/chart/')[1].split('?')[0]);
    if(!CASOS[sym]) throw new Error('sin caso para ' + sym);
    return CASOS[sym];
  };`);
  const q = async sym => w.eval('yfQuote(' + JSON.stringify(sym) + ')');

  console.log('\n1 · ETP europeo con la vela de hoy vacía (el fallo)');
  const glda = await q('GLDA.DE');
  eq(glda.p, 158.71, 'el precio es el de mercado en vivo');
  eq(glda.prev, 156.29, 'el cierre anterior es el de AYER, no el de anteayer');
  eq(+((glda.p - glda.prev) * 1.900532).toFixed(2), 4.60, 'la posición aporta +4,60 € y no +10,11 €', 0.01);

  const gbse = await q('GBSE.MI');
  eq(gbse.prev, 24.04, 'WT Physical Gold: cierre de ayer');
  eq(+((gbse.p - gbse.prev) * 7).toFixed(2), 2.59, 'aporta +2,59 € y no +5,42 €', 0.01);

  const xeth = await q('XETH.DE');
  eq(xeth.prev, 6.1025, 'Galaxy Ethereum: cierre de ayer');
  eq(+((xeth.p - xeth.prev) * 7).toFixed(2), 2.22, 'aporta +2,22 € y no +3,87 €', 0.01);

  console.log('\n2 · Lo que ya funcionaba tiene que seguir igual');
  const mstr = await q('MSTR');
  eq(mstr.p, 105.14, 'acción USA: precio en vivo');
  eq(mstr.prev, 102.24, 'y su cierre anterior no cambia');
  eq(mstr.cur, 'USD', 'la divisa se respeta');

  console.log('\n3 · Mercado cerrado: «hoy» es la última sesión');
  const cer = await q('CERRADO.MC');
  eq(cer.p, 13.265, 'el precio es el del cierre del viernes');
  eq(cer.prev, 12.905, 'y el anterior, el del jueves (no el propio viernes)');

  console.log('\n4 · Fondo con el VL nuevo sólo en la serie de cierres');
  const f = await q('0P00000G12.F');
  eq(f.p, 78.6399, 'manda el cierre posterior a la hora del precio');
  eq(f.prev, 79.0433, 'y el anterior es el cierre del día de antes de ESE');

  console.log('\n5 · Serie sin fechas: respaldo al criterio viejo');
  const sf = await q('SIN-FECHAS');
  eq(sf.prev, 9, 'coge el penúltimo cierre');

  console.log('\n6 · La serie del sparkline no arrastra los nulos');
  eq(glda.closes.length, 3, 'GLDA: tres cierres reales, sin la vela vacía de hoy');
  eq(glda.closes.some(c => c == null), false, 'ningún null en la serie');
  eq(glda.closes[glda.closes.length - 1], 156.29, 'y termina en el último cierre real');

  console.log('\n7 · Coherencia con el feed del repositorio');
  // El feed calcula prev como spark[len-2] sobre una serie que SÍ incluye el
  // precio de hoy. Con la corrección, las dos fuentes dan el mismo número: es lo
  // que hacía que el total del día saltara y volviera.
  const feedSpark = [152.36, 153.39, 156.29, 158.71];
  eq(feedSpark[feedSpark.length - 2], glda.prev, 'feed y Yahoo coinciden en el cierre anterior de GLDA');
  const feedGbse = [23.42, 23.635, 24.04, 24.41];
  eq(feedGbse[feedGbse.length - 2], gbse.prev, 'y en el de GBSE');

  console.log('\n' + (ko ? '✗ ' + ko + ' fallos' : '✓ todo correcto') + ' · ' + ok + ' comprobaciones');
  process.exit(ko ? 1 : 0);
})();
