// Ejecutar con:  npm i jsdom && node scripts/test-compra.js
// Registrar compra: el dinero sale de una cuenta, así que el «aportado» no sube.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = 'C:/Users/Marc/Desktop/Proyectos/Inversiones/Cartera/repo/index.html';

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

  console.log('\n1 · Compra pagada con la cuenta del mismo broker');
  E('openBuyModal(2);');
  eq(E("el('b-pago').value"), '1', 'propone por defecto la cuenta del mismo broker');
  E("el('b-qty').value=5; el('b-price').value=60; updBuyP();");
  eq(E("el('b-pago-hint').textContent.includes('1000')"), true, 'avisa de cómo queda el saldo');
  const apAntes = E('aportadoHoy()');
  E('saveBuy();');
  eq(E('assets[1].qty'), 15, 'la posición pasa a 15 títulos');
  eq(E('assets[0].qty'), 700, 'el efectivo baja 300');
  eq(E('aportadoHoy()'), apAntes, 'EL APORTADO NO CAMBIA: el dinero ya estaba dentro');
  eq(E('tc()'), 1500, 'el coste total tampoco');
  eq(E('aports[0].pagoId'), 1, 'la aportación guarda con qué se pagó');

  console.log('\n2 · Compra con dinero nuevo de fuera');
  E('openBuyModal(2);');
  E("el('b-pago').value='0'; el('b-qty').value=1; el('b-price').value=60; updBuyP(); saveBuy();");
  eq(E('assets[0].qty'), 700, 'el efectivo no se toca');
  eq(E('aportadoHoy()'), apAntes + 60, 'el aportado sube los 60 € que has puesto');

  console.log('\n3 · Borrar la aportación devuelve el dinero a la cuenta');
  E('delAport(aports[1].id);');
  eq(E('assets[0].qty'), 1000, 'el efectivo vuelve a 1000');
  eq(E('assets[1].qty'), 11, 'y la posición pierde los 5 títulos comprados');

  eq(errs.length, 0, 'sin errores de JS · ' + errs.join(' | '));
  console.log('\n' + ok + ' ok · ' + ko + ' fallos');
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
