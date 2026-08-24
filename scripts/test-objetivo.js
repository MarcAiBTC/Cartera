// Ejecutar con:  npm i jsdom && node scripts/test-objetivo.js
// Añadir y quitar activos en la pestaña Objetivo.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = 'C:/Users/Marc/Desktop/Proyectos/Inversiones/Cartera/repo/index.html';

let ok = 0, ko = 0;
const eq = (a, b, msg, tol = 0.02) => {
  const good = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : a === b;
  if (good) { ok++; console.log('  OK  ' + msg); }
  else { ko++; console.log('  FALLO ' + msg + '  -> esperado ' + b + ', obtenido ' + a); }
};

const estado = {
  assets: [
    { id: 1, name: 'Efectivo TR', cat: 'liquidez', broker: 'Trade Republic', qty: 1000, costUnit: 1, mp: 1, ccy: 'EUR', mode: 'manual' },
    { id: 2, name: 'Acme', cat: 'accion', broker: 'Trade Republic', qty: 10, costUnit: 50, mp: 60, ccy: 'EUR', mode: 'manual', underlying: 'Acme' },
    { id: 3, name: 'Fondo Mundo', cat: 'fondo', broker: 'MyInvestor', qty: 100, costUnit: 10, mp: 14, ccy: 'EUR', mode: 'manual', underlying: 'MSCI World' },
  ],
  snaps: [], wl: [], targets: {}, trades: [], aports: [], rendim: [],
};

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

  E("goto('objetivo')");
  const nombres = () => E("[...document.querySelectorAll('#tg-rows .tg-name')].map(x=>x.childNodes[0].textContent)");

  console.log('\n1 · Punto de partida');
  eq(nombres().sort().join(' · '), 'Acme · Liquidez · MSCI World', 'lista lo que tienes mas la liquidez');
  eq(E('tgTotal()'), 3000, 'la base es el patrimonio entero');

  console.log('\n2 · Anadir un activo que no tengo');
  eq(E("tgAddUnd('Oro')"), true, 'tgAddUnd devuelve true');
  eq(nombres().includes('Oro'), true, 'Oro aparece en la tabla');
  eq(E("targets['Oro']"), 0, 'entra con 0%');
  eq(E('tgTotal()'), 3000, 'no cambia la base');
  eq(E("tgExtra.join()"), 'Oro', 'queda guardado en tgExtra');
  eq(E("JSON.parse(localStorage.getItem('cv9')).tgExtra.join()"), 'Oro', 'y persiste en localStorage');

  console.log('\n3 · No duplica ni con otra caja');
  E("tgAddUnd('oro')");
  eq(E('tgExtra.length'), 1, 'anadir «oro» no crea una fila nueva');
  eq(nombres().filter(x => x === 'Oro').length, 1, 'sigue habiendo una sola fila de Oro');

  console.log('\n4 · Reparto con el activo nuevo');
  E("updateTarget({value:'50',dataset:{und:'MSCI World'}});updateTarget({value:'30',dataset:{und:'Oro'}});updateTarget({value:'20',dataset:{und:'Acme'}});");
  await new Promise(r => setTimeout(r, 600));
  // Con 4000 EUR de total futuro faltan 1200 en Oro, 600 en MSCI World y 200 en
  // Acme: 2000 de deficit para 1000 de presupuesto, asi que se reparte a prorrata.
  const rep = E('tgReparto(1000)');
  eq(Math.round(rep.alloc['Oro']), 600, 'Oro se lleva la mayor parte: es el mas descolgado');
  eq(Math.round(rep.alloc['MSCI World']), 300, 'MSCI World, la mitad que Oro');
  eq(Math.round(rep.alloc['Acme']), 100, 'y Acme lo que queda');

  console.log('\n5 · Quitar un activo que si tengo');
  E("tgQuitar('Acme')");
  eq(nombres().includes('Acme'), false, 'Acme desaparece de la tabla');
  eq(E("assets.some(a=>a.name==='Acme')"), true, 'pero la posicion sigue en la cartera');
  eq(E('tgTotal()'), 2400, 'su dinero sale de la base (3000 - 600)');
  eq(E("targets['Acme']===undefined"), true, 'su objetivo se borra');
  eq(E("el('tg-fuera').textContent.includes('Acme')"), true, 'aparece en la tira de fuera');
  eq(E("tgFuera.join()"), 'Acme', 'y en tgFuera');

  console.log('\n6 · Los porcentajes siguen cuadrando');
  E("tgNormalizar()");
  const suma = E("tgRows().reduce((s,r)=>s+r.tgt,0)");
  eq(Math.round(suma * 10) / 10, 100, 'normalizar deja 100,0 exacto');
  const actual = E("tgRows().reduce((s,r)=>s+r.cur,0)");
  eq(Math.round(actual * 10) / 10, 100, 'y los pesos actuales de la tabla suman 100,0');

  console.log('\n7 · Devolver al reparto');
  E("tgRestaurar('Acme')");
  eq(nombres().includes('Acme'), true, 'Acme vuelve a la tabla');
  eq(E('tgTotal()'), 3000, 'y su dinero vuelve a la base');
  eq(E("el('tg-fuera').textContent.trim()"), '', 'la tira desaparece');

  console.log('\n8 · Quitar un anadido a mano lo borra del todo');
  E("tgQuitar('Oro')");
  eq(E('tgExtra.length'), 0, 'sale de tgExtra');
  eq(E('tgFuera.length'), 0, 'y no ensucia tgFuera: nunca tuviste saldo ahi');
  eq(nombres().includes('Oro'), false, 'ya no esta en la tabla');

  console.log('\n9 · La liquidez no se puede quitar');
  E("tgQuitar('Liquidez')");
  eq(nombres().includes('Liquidez'), true, 'sigue ahi');
  eq(E("document.querySelectorAll('#tg-rows .tg-x').length"), nombres().length - 1, 'todas las filas menos Liquidez tienen boton de quitar');

  console.log('\n10 · El modal del catalogo rellena el subyacente');
  E("openTgModal()");
  eq(E("el('ov-tg').classList.contains('open')"), true, 'el modal se abre');
  E("catSearch('SPDR Gold','t')");
  eq(E('catHits.length>0'), true, 'el buscador encuentra algo');
  E("catPick(0,'t')");
  eq(E("el('t-und').value.length>0"), true, 'vuelca el subyacente en el campo');
  E("saveTgUnd()");
  eq(E("el('ov-tg').classList.contains('open')"), false, 'y al guardar se cierra');
  eq(E('tgExtra.length'), 1, 'la fila queda anadida');

  console.log('\n11 · Copia de seguridad');
  eq(E("(function(){var d={targets:{},tgExtra:['Oro'],tgFuera:['Acme']};return Array.isArray(d.tgExtra);})()"), true, 'formato del backup');

  console.log('\nErrores JS: ' + (errs.length ? errs.join(' | ') : 'ninguno'));
  console.log('\n' + ok + ' bien · ' + ko + ' mal');
  process.exit(ko || errs.length ? 1 : 0);
})();
