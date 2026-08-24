// Ejecutar con:  npm i jsdom && node scripts/test-inicio.js
// Aviso de intereses sin apuntar, agrupación por broker y rentabilidad anual.
// Las funciones de cálculo son const de nivel superior: no cuelgan de window,
// así que se leen con eval dentro del contexto de la página.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = 'C:/Users/Marc/Desktop/Proyectos/Inversiones/Cartera/repo/index.html';

let ok = 0, ko = 0;
const eq = (a, b, msg, tol = 0.02) => {
  const good = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : a === b;
  if (good) { ok++; console.log('  ✓ ' + msg); }
  else { ko++; console.log('  ✗ ' + msg + '  → esperado ' + b + ', obtenido ' + a); }
};
const hace = d => Date.now() - d * 864e5;
const fecha = d => new Date(hace(d)).toISOString().slice(0, 10);

const estado = {
  assets: [
    { id: 1, name: 'Efectivo TR', cat: 'liquidez', broker: 'Trade Republic',
      qty: 2000, costUnit: 1, mp: 1, ccy: 'EUR', mode: 'manual', apr: 2.15, aprDesde: hace(60) },
    { id: 2, name: 'Acme', cat: 'accion', broker: 'Trade Republic',
      qty: 10, costUnit: 50, mp: 60, ccy: 'EUR', mode: 'manual' },
    { id: 3, name: 'Fondo Mundo', cat: 'fondo', broker: 'MyInvestor',
      qty: 100, costUnit: 10, mp: 11, ccy: 'EUR', mode: 'manual' },
    { id: 4, name: 'Efectivo MyI', cat: 'liquidez', broker: 'MyInvestor',
      qty: 500, costUnit: 1, mp: 1, ccy: 'EUR', mode: 'manual', apr: 0 },
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

  console.log('\n1 · Aviso de intereses sin apuntar');
  eq(E('cobrosPendientes().length'), 1, 'solo avisa de la cuenta con TAE');
  eq(E('cobrosPendientes()[0].a.id'), 1, 'y es la de Trade Republic');
  eq(E('cobrosPendientes()[0].dias'), 60, 'cuenta los días desde que pusiste la TAE');
  eq(E('cobrosPendientes()[0].est'), 2000 * 0.0215 * 60 / 365, 'estima el devengo', 0.05);
  eq(E("el('h-aviso').innerHTML.includes('Apuntar cobro')"), true, 'la tira aparece en Inicio');

  console.log('\n2 · Se apaga en cuanto apuntas el cobro');
  E("rendim.push({id:9,date:'" + fecha(3) + "',kind:'interes',assetId:1,name:'Efectivo TR',eur:7.07}); render();");
  eq(E('cobrosPendientes().length'), 0, 'ya no hay nada pendiente');
  eq(E("el('h-aviso').innerHTML.trim()"), '', 'y la tira desaparece');

  console.log('\n3 · Umbrales: ni antes de 35 días ni por céntimos');
  E('assets[0].aprDesde=' + hace(20) + '; rendim.length=0;');
  eq(E('cobrosPendientes().length'), 0, 'a los 20 días todavía no molesta');
  E('assets[0].aprDesde=' + hace(60) + '; assets[0].qty=20;');
  eq(E('cobrosPendientes().length'), 0, 'con 20 € de saldo el devengo no llega a 0,50 €');
  E('assets[0].qty=2000;');

  console.log('\n4 · El aviso abre el modal con la cuenta ya elegida');
  E('openRendModal(1);');
  eq(E("el('r-asset').value"), '1', 'preselecciona Trade Republic');
  eq(E("el('r-kind').value"), 'interes', 'y el concepto correcto');
  E('closeRendModal();');

  console.log('\n5 · Agrupar por clase y por broker');
  E("setBandMode('clase');");
  const clases = E("[...document.querySelectorAll('#h-bands .band-name')].map(x=>x.textContent)");
  eq(clases.join(' · '), 'Liquidez · Fondos · Acciones', 'por clase: liquidez, fondos, acciones');
  E("setBandMode('broker');");
  const brokers = E("[...document.querySelectorAll('#h-bands .band-name')].map(x=>x.textContent)");
  eq(brokers.join(' · '), 'Trade Republic · MyInvestor', 'por broker, ordenado por dinero');
  const valores = E("[...document.querySelectorAll('#h-bands .band-val')].map(x=>x.textContent)");
  eq(valores[0].includes('2600'), true, 'Trade Republic suma 2000 efectivo + 600 de Acme');
  eq(valores[1].includes('1600'), true, 'MyInvestor suma 500 efectivo + 1100 del fondo');

  console.log('\n6 · El modo se guarda y no rompe el despliegue');
  E('svSt();');
  eq(JSON.parse(w.localStorage.getItem('cv9')).bandMode, 'broker', 'bandMode persiste');
  E("toggleBand('Trade Republic');");
  eq(E("document.querySelectorAll('#h-bands .band-body tbody tr').length"), 2, 'despliega las 2 posiciones del broker');
  E("setBandMode('clase');");
  eq(E("document.querySelectorAll('#h-bands .band-body').length"), 0, 'al cambiar de modo se cierra lo abierto');

  console.log('\n7 · Rentabilidad anualizada');
  eq(E('anualizar(10,365.25)'), 10, 'un año: el anual es el acumulado');
  eq(E('anualizar(21,730.5)'), 10, 'dos años al 21% acumulado son 10% anual', 0.05);
  eq(E('anualizar(8.3,60)'), null, 'con 60 días no anualiza: sería inventar');
  eq(E('anualizar(-100,400)'), null, 'una pérdida total no se anualiza');

  console.log('\n8 · La ventana sale del movimiento más antiguo, no del primer día guardado');
  E("trades.push({id:5,name:'Vieja',dateIn:'2025-06-27',dateOut:'2025-08-25',result:35,invested:174,recovered:209,qty:1,priceIn:174,priceOut:209});");
  E("snaps.push({id:7,ts:" + hace(90) + ",val:3100,cost:3000,liq:2000});");
  eq(E("new Date(inicioHistoria()).toISOString().slice(0,10)"), '2025-06-27', 'coge la entrada de la operación más vieja');
  E('renderAnalisis();');
  eq(E("el('an-gan-sub').innerHTML.includes('anual')"), true, 'el subtítulo enseña el equivalente anual');
  eq(E("el('an-anual')===null"), true, 'va como clase, no como id suelto');
  const sub = E("el('an-gan-sub').textContent");
  console.log('    → ' + sub);

  console.log('\n9 · Una categoría desconocida no tumba la pantalla');
  // Un cat:'etp' (backup viejo, JSON editado a mano) hacía que CC[cat].s lanzara
  // dentro de render() y Inicio se quedaba en blanco, sin mensaje y sin manera de
  // llegar a la posición para arreglarla.
  const antes = errs.length;
  E("assets.push({id:42,name:'Xetra Gold',cat:'etp',broker:'Trade Republic',qty:20,costUnit:40,mp:52,ccy:'EUR',mode:'manual'});");
  E('render();');
  eq(errs.length, antes, 'render() no lanza con una categoría fuera de las cinco');
  eq(E("el('h-comp').innerHTML.length > 0"), true, 'la barra de composición se sigue pintando');
  eq(E("el('h-note').textContent.startsWith('5 posiciones')"), true, 'la posición cuenta en el resumen');
  eq(E("[...document.querySelectorAll('#h-bands .band-name')].some(x=>x.textContent==='etp')"), true,
     'y aparece como banda propia en vez de desaparecer del agrupado');
  E("setBandMode('broker');render();setBandMode('clase');");
  eq(errs.length, antes, 'tampoco al agrupar por broker');
  E('renderAnalisis();');
  eq(errs.length, antes, 'ni en la pestaña de análisis');
  E("assets=assets.filter(a=>a.id!==42);render();");

  eq(errs.length, 0, 'sin errores de JS · ' + errs.join(' | '));
  console.log('\n' + ok + ' ok · ' + ko + ' fallos');
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
