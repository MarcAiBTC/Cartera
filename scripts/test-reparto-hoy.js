// Ejecutar con:  node scripts/test-reparto-hoy.js
//
// Dos vistas nuevas que comparten motor (und()):
//   · la tarta «Cuánto tengo de cada cosa» de Análisis (expoPorUnd / renderExpo)
//   · la tira «Qué mueve hoy la cartera» de Inicio     (moversHoy / rHoy)
//
// Lo que se comprueba de verdad: que agrupar por subyacente suma lo que tiene
// que sumar (dos productos del mismo índice = una porción), que los porcentajes
// se recalculan al quitar la liquidez, y que el desglose del día cuadra euro a
// euro con el «Hoy» del héroe —si no cuadra, la explicación miente—.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = 'C:/Users/Marc/Desktop/Proyectos/Inversiones/Cartera/repo/index.html';

let ok = 0, ko = 0;
const eq = (a, b, msg, tol = 0.02) => {
  const good = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : a === b;
  if (good) { ok++; console.log('  ✓ ' + msg); }
  else { ko++; console.log('  ✗ ' + msg + '  → esperado ' + b + ', obtenido ' + a); }
};

// Cartera de laboratorio: el S&P 500 repartido en dos productos de dos brokers
// (que es el caso que ninguna vista anterior sabía juntar), bitcoin en uno solo,
// oro, y liquidez para poder probar las dos bases de la tarta.
const estado = {
  assets: [
    { id: 1, name: 'Efectivo TR', cat: 'liquidez', broker: 'Trade Republic',
      qty: 2000, costUnit: 1, mp: 1, ccy: 'EUR', mode: 'manual' },
    { id: 2, name: 'ETF S&P 500', cat: 'fondo', broker: 'MyInvestor', underlying: 'S&P 500',
      qty: 100, costUnit: 10, mp: 12, ccy: 'EUR', mode: 'manual' },
    { id: 3, name: 'Fondo S&P 500', cat: 'fondo', broker: 'ING', underlying: 'S&P 500',
      qty: 10, costUnit: 50, mp: 60, ccy: 'EUR', mode: 'manual' },
    { id: 4, name: 'ETP Bitcoin', cat: 'cripto', broker: 'Trade Republic', underlying: 'Bitcoin',
      qty: 20, costUnit: 30, mp: 40, ccy: 'EUR', mode: 'manual' },
    { id: 5, name: 'ETC Oro', cat: 'metal', broker: 'Revolut', underlying: 'Oro',
      qty: 5, costUnit: 40, mp: 40, ccy: 'EUR', mode: 'manual' },
  ],
  snaps: [], wl: [], targets: {}, trades: [], aports: [], rendim: [],
};
// Valores: S&P 500 = 1200 + 600 = 1800 · Bitcoin = 800 · Oro = 200 · Liquidez = 2000
// Total = 4800 · en mercado = 2800

(async () => {
  const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
    runScripts: 'dangerously', url: 'https://localhost/', pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem('cv9', JSON.stringify(estado));
      w.fetch = () => Promise.reject(new Error('sin red'));
      w.confirm = () => true;
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
  const errs = [];
  w.addEventListener('error', e => errs.push(e.message || String(e.error)));
  await new Promise(r => w.addEventListener('load', r));
  await new Promise(r => setTimeout(r, 400));
  const E = e => w.eval(e);

  console.log('\n1 · Agrupar por subyacente junta los productos del mismo índice');
  eq(E('expoPorUnd().length'), 4, 'cuatro subyacentes, no cinco posiciones');
  eq(E("expoPorUnd()[0].u"), 'Liquidez', 'ordena por dinero: la liquidez manda');
  eq(E("expoPorUnd().find(g=>g.u==='S&P 500').v"), 1800, 'el S&P 500 suma los dos productos');
  eq(E("expoPorUnd().find(g=>g.u==='S&P 500').items.length"), 2, 'y recuerda de cuáles sale');
  eq(E("expoPorUnd().find(g=>g.u==='S&P 500').items[0].name"), 'ETF S&P 500', 'el mayor primero dentro del grupo');
  eq(E('expoPorUnd().reduce((s,g)=>s+g.v,0)'), E('tv()'), 'la tarta reparte el patrimonio entero');
  eq(E('expoPorUnd().reduce((s,g)=>s+g.pct,0)'), 100, 'y los porcentajes suman 100', 0.01);

  console.log('\n2 · La ganancia de cada porción sale de sus productos');
  eq(E("expoPorUnd().find(g=>g.u==='S&P 500').c"), 1500, 'coste = 1000 del ETF + 500 del fondo');
  eq(E("expoPorUnd().find(g=>g.u==='S&P 500').g"), 300, 'ganancia de la porción');
  eq(E("expoPorUnd().find(g=>g.u==='S&P 500').gp"), 20, 'y su rentabilidad, 300 sobre 1500');
  eq(E("expoPorUnd().find(g=>g.u==='Oro').gp"), 0, 'el oro está plano');

  console.log('\n3 · «Solo invertido» recalcula sobre el dinero en mercado');
  eq(E('expoPorUnd(false).length'), 3, 'la liquidez sale de la tarta');
  eq(E('expoPorUnd(false).reduce((s,g)=>s+g.v,0)'), 2800, 'la base pasa a ser lo invertido');
  eq(E("expoPorUnd(false).find(g=>g.u==='S&P 500').pct"), 1800 / 2800 * 100, 'y el S&P 500 pesa más', 0.01);
  eq(E('expoPorUnd(false).reduce((s,g)=>s+g.pct,0)'), 100, 'los porcentajes vuelven a sumar 100', 0.01);

  console.log('\n4 · La tarta se pinta y la leyenda es el control');
  E("setExpoBase('total'); renderExpo();");
  eq(E("document.querySelectorAll('#an-expo .ex-arc').length"), 4, 'un arco por subyacente');
  eq(E("document.querySelectorAll('#an-expo .ex-row').length"), 4, 'y una fila de leyenda por arco');
  eq(E("document.querySelectorAll('#an-expo .ex-body').length"), 0, 'nada desplegado de partida');
  // Sin separador de miles en la comparación: Intl cambia de formato según el ICU
  // que traiga el runtime, y lo que se comprueba aquí es la cifra, no el formato.
  eq(E("el('an-expo').querySelector('.ex-mid').textContent.split('.').join('').split(' ').join('').includes('4800€')"), true, 'el centro enseña el total');
  E("toggleExpo('S&P 500');");
  eq(E("document.querySelectorAll('#an-expo .ex-body .ex-sub').length"), 2, 'al abrir salen los dos productos');
  eq(E("el('an-expo').textContent.includes('ING')"), true, 'con el broker de cada uno');
  eq(E("el('an-expo').querySelector('.ex-mid').textContent.includes('37.5% de la cartera')"), true, 'y el centro pasa a la porción abierta');
  E("toggleExpo('S&P 500');");
  eq(E("document.querySelectorAll('#an-expo .ex-body').length"), 0, 'volver a pulsar la cierra');

  console.log('\n5 · Cambiar de base no deja un grupo abierto que ya no existe');
  E("toggleExpo('Liquidez'); setExpoBase('inv');");
  eq(E('expoOpen'), null, 'la liquidez abierta se cierra sola al quitarla de la base');
  eq(E("document.querySelectorAll('#an-expo .ex-arc').length"), 3, 'quedan tres arcos');
  eq(E("el('exb-inv').classList.contains('on')"), true, 'el interruptor refleja la base');
  E("svSt();");
  eq(JSON.parse(w.localStorage.getItem('cv9')).expoBase, 'inv', 'y la preferencia persiste');
  E("setExpoBase('total');");

  console.log('\n6 · Qué mueve hoy: agrupa igual y suma los euros del día');
  // Cierre de ayer: S&P 500 plano, bitcoin +25%, oro -10%.
  E("lpxPrev['#2']=12; lpxPrev['#3']=60; lpxPrev['#4']=32; lpxPrev['#5']=44.4444444;");
  E("lpx['#2']=12; lpx['#3']=60; lpx['#4']=40; lpx['#5']=40;");
  E("assets.forEach(a=>{if(a.id>1)a.mode='auto';}); render();");
  const ms = E('moversHoy().map(m=>m.u)');
  eq(ms[0], 'Bitcoin', 'manda quien mueve más EUROS, no más porcentaje');
  eq(E("moversHoy().find(m=>m.u==='Bitcoin').abs"), 160, 'bitcoin aporta +160 € (20 × 8)');
  eq(E("moversHoy().find(m=>m.u==='Oro').abs"), -22.22, 'el oro resta 22,22 €', 0.02);
  eq(E("moversHoy().find(m=>m.u==='S&P 500').abs"), 0, 'el S&P 500 no se mueve hoy');
  eq(E("moversHoy().find(m=>m.u==='S&P 500').items.length"), 2, 'pero sigue siendo una sola fila de dos productos');
  eq(E('moversHoy().length'), 3, 'la liquidez nunca entra en el día');

  console.log('\n7 · Las filas del día cuadran con el «Hoy» del héroe');
  eq(E('moversHoy().reduce((s,m)=>s+m.abs,0)'), E('tDay().abs'), 'la suma de las filas es el total del día', 0.001);
  eq(E("el('h-hoy').textContent.includes('Bitcoin')"), true, 'la tira nombra al que manda');
  eq(E("el('h-hoy').textContent.includes('Oro')"), true, 'y al que tira en contra');
  eq(E("el('h-hoy').querySelectorAll('.hoy-row').length"), 3, 'tres filas: un subyacente cada una');
  eq(E("el('h-hoy').querySelector('.hoy-mas')===null"), true, 'con 3 subyacentes no hace falta el «ver todos»');

  console.log('\n8 · Sin cierre anterior lo dice, no se queda en blanco');
  E("lpxPrev={}; prevDudoso={}; assets.forEach(a=>{a.mp2=null;}); render();");
  eq(E('tDay()===null'), true, 'sin cierres no hay variación del día');
  eq(E("el('h-hoy').textContent.includes('feed de precios')"), true, 'y la tira explica que faltan datos');

  console.log('\n9 · Un subyacente desconocido también tiene color, y siempre el mismo');
  eq(E("undColor('Bitcoin')"), '#f7931a', 'los conocidos llevan el suyo');
  eq(E("undColor('Nombre Rarísimo')===undColor('Nombre Rarísimo')"), true, 'el mismo nombre da el mismo color');
  eq(E("/^#[0-9a-f]{6}$/i.test(undColor('Nombre Rarísimo'))"), true, 'y es un color válido');

  console.log('\n10 · Nada de esto lanza errores en consola');
  eq(errs.length, 0, 'sin excepciones durante toda la sesión' + (errs.length ? ' → ' + errs.join(' | ') : ''));

  console.log('\n' + (ko ? '✗ ' + ko + ' fallos' : '✓ todo correcto') + ' · ' + ok + ' comprobaciones');
  process.exit(ko ? 1 : 0);
})();
