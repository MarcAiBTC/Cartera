// Ejecutar con:  npm i jsdom && node scripts/test-cobros.js
// Prueba de la lógica de aportado / ganancia / cobros sobre index.html real.
// Las funciones de cálculo son const de nivel superior: no cuelgan de window,
// así que se leen con eval dentro del contexto de la página.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const HTML = 'C:/Users/Marc/Desktop/Proyectos/Inversiones/Cartera/repo/index.html';
const html = fs.readFileSync(HTML, 'utf8');

let ok = 0, ko = 0;
const eq = (a, b, msg, tol = 0.005) => {
  const good = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : a === b;
  if (good) { ok++; console.log('  ✓ ' + msg); }
  else { ko++; console.log('  ✗ ' + msg + '  → esperado ' + b + ', obtenido ' + a); }
};

const estado = {
  assets: [
    { id: 1, name: 'Efectivo TR', cat: 'liquidez', broker: 'Trade Republic',
      qty: 1000, costUnit: 1, mp: 1, ccy: 'EUR', mode: 'manual', apr: 2.15 },
    { id: 2, name: 'Acme', cat: 'accion', broker: 'Trade Republic',
      qty: 10, costUnit: 50, mp: 60, ccy: 'EUR', mode: 'manual' },
  ],
  snaps: [], wl: [], targets: {}, trades: [], aports: [], rendim: [],
};

async function main() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://localhost/',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem('cv9', JSON.stringify(estado));
      w.fetch = () => Promise.reject(new Error('sin red'));
      w.HTMLCanvasElement.prototype.getContext = () => ({
        canvas: { width: 300, height: 150 }, save() {}, restore() {}, beginPath() {},
        moveTo() {}, lineTo() {}, stroke() {}, fill() {}, clearRect() {}, fillRect() {},
        arc() {}, closePath() {}, measureText: () => ({ width: 10 }), fillText() {},
        setTransform() {}, translate() {}, scale() {}, createLinearGradient: () => ({ addColorStop() {} }),
      });
      w.Chart = function () { return { destroy() {}, update() {}, data: {}, options: {} }; };
      w.Chart.register = () => {};
      w.XLSX = { utils: { aoa_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} };
    },
  });
  const w = dom.window;
  const errs = [];
  w.addEventListener('error', e => errs.push(e.message || String(e.error)));
  await new Promise(r => w.addEventListener('load', r));
  await new Promise(r => setTimeout(r, 400));
  const E = expr => w.eval(expr);

  console.log('\n1 · Punto de partida (sin cobros ni ventas)');
  eq(E('tv()'), 1600, 'patrimonio = 1000 efectivo + 600 acción');
  eq(E('tc()'), 1500, 'coste = 1000 + 500');
  eq(E('aportadoHoy()'), 1500, 'aportado = coste (nada realizado, nada cobrado)');
  eq(E('gananciaTotal()'), 100, 'ganancia = 100 de la acción');
  eq(E('rendimTotal()'), 0, 'cobros = 0');

  console.log('\n2 · Interés de 20 € en la cuenta remunerada');
  E("rendim.push({id:11,date:'2026-08-01',kind:'interes',assetId:1,name:'Efectivo TR',eur:20}); assets[0].qty=1020;");
  eq(E('tv()'), 1620, 'patrimonio sube 20');
  eq(E('tc()'), 1520, 'coste sube 20 (coste de la liquidez = su saldo)');
  eq(E('aportadoHoy()'), 1500, 'APORTADO NO SE MUEVE: no has puesto dinero');
  eq(E('gananciaTotal()'), 120, 'ganancia sube a 120');
  eq(E('rendimTotal()'), 20, 'cobros = 20');

  console.log('\n3 · Sin apuntar el cobro (comportamiento antiguo)');
  E('window.__g = rendim.splice(0, rendim.length);');
  eq(E('aportadoHoy()'), 1520, 'aportado se infla en 20 € que no has puesto');
  eq(E('gananciaTotal()'), 100, 'y la ganancia se come los intereses');
  E('window.__g.forEach(r=>rendim.push(r));');

  console.log('\n4 · Venta con beneficio apuntada en Historial');
  E("trades.push({id:21,name:'Acme',dateOut:'2026-08-10',result:100,invested:500,recovered:600,qty:10,priceIn:50,priceOut:60}); assets[1].qty=0; assets[0].qty=1620;");
  eq(E('tv()'), 1620, 'patrimonio igual: el dinero solo ha cambiado de sitio');
  eq(E('tc()'), 1620, 'coste = saldo');
  eq(E('aportadoHoy()'), 1500, 'aportado sigue siendo 1500');
  eq(E('gananciaTotal()'), 120, 'ganancia sigue siendo 120');

  console.log('\n5 · Devengo estimado del efectivo remunerado');
  eq(E('rentaEfectivoAnual()'), 1620 * 0.0215, 'renta anual del efectivo al 2,15%');

  console.log('\n6 · Los intereses del efectivo no inflan el TWR de lo invertido');
  E('assets[1].qty=10; assets[0].qty=1020; trades.length=0;');
  E('snaps.length=0;');
  E("snaps.push({id:1,ts:Date.parse('2026-07-01'),val:1600,cost:1500,liq:1000});"
  + "snaps.push({id:2,ts:Date.parse('2026-08-02'),val:1620,cost:1520,liq:1020});");
  eq(E('puntoEvo(snaps[0]).apInv'), 500, 'día 1: aportado invertido = 500');
  eq(E('puntoEvo(snaps[1]).apInv'), 500, 'día 2: sigue 500 — el interés no toca el mercado');
  eq(E('puntoEvo(snaps[1]).valInv'), 600, 'día 2: valor invertido = 600');
  eq(E('puntoEvo(snaps[1]).ap'), 1500, 'día 2: aportado total = 1500');
  eq(E('twrSeries().pts[1].idx'), 100, 'TWR invertido plano entre los dos días', 0.01);

  console.log('\n7 · Un dividendo SÍ es rentabilidad de lo invertido');
  E("rendim.push({id:31,date:'2026-08-02',kind:'dividendo',assetId:2,name:'Acme',eur:10});");
  eq(E('puntoEvo(snaps[1]).apInv'), 490, 'el dividendo baja el aportado invertido en 10');
  eq(E('puntoEvo(snaps[1]).ap'), 1490, 'y también el aportado total');

  console.log('\n8 · «Hoy» ya no se diluye con la liquidez');
  eq(/const tDay = \(\)=>\{[^\n]*a\.cat==='liquidez'\)continue/.test(html), true, 'tDay excluye la liquidez');

  console.log('\n9 · La app pinta sin romperse');
  E('renderAnalisis(); renderHist(); render();');
  eq(E("el('an-desglose').children.length"), 5, 'el desglose enseña 5 celdas (con Cobrado)');
  eq(E("el('rend-tbody').innerHTML.includes('Dividendo')"), true, 'la tabla de cobros lista el dividendo');
  eq(E("el('h-liqapr').style.display!=='none'"), true, 'el héroe enseña la remuneración del efectivo');
  eq(E("el('h-rend-yr').textContent.trim()!=='—'"), true, 'la barra de Historial enseña lo cobrado este año');
  eq(E("rowHTML(assets[0],tv()).includes('TAE')"), true, 'la fila del efectivo lleva la etiqueta TAE');

  console.log('\n10 · Persistencia y modal de cobro');
  E('svSt();');
  const g = JSON.parse(w.localStorage.getItem('cv9'));
  eq(Array.isArray(g.rendim), true, 'rendim se guarda en localStorage');
  eq(g.rendim.length, 2, 'con los dos cobros');
  E('openRendModal();');
  eq(E("el('ov-r').classList.contains('open')"), true, 'el modal de cobro se abre');
  eq(E("el('r-asset').options.length"), 2, 'lista las dos posiciones');
  eq(E("+el('r-eur').value > 0"), true, 'propone un importe de intereses devengados');
  E('closeRendModal();');

  eq(errs.length, 0, 'sin errores de JS en la página · ' + errs.join(' | '));

  console.log('\n' + ok + ' ok · ' + ko + ' fallos');
  process.exit(ko ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
