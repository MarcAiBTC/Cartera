// El ETP de bitcoin de Fidelity cotiza en varias plazas. Yahoo mezclaba en
// FBTC.SW el histórico de la clase en dólares con la cotización en francos: el
// cierre anterior salía inflado ~24% y la variación del día, en -19%. Aquí se
// comprueba que la posición deja de usar ese símbolo y que con el feed bueno la
// variación diaria vuelve a ser la real.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = 'C:/Users/Marc/Desktop/Proyectos/Inversiones/Cartera/repo/index.html';

let ok = 0, ko = 0;
const eq = (a, b, msg, tol = 0.01) => {
  const good = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : a === b;
  if (good) { ok++; console.log('  ✓ ' + msg); }
  else { ko++; console.log('  ✗ ' + msg + '  → esperado ' + b + ', obtenido ' + a); }
};

const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'),
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://marcaibtc.github.io/Cartera/' });
const w = dom.window;

console.log('El símbolo retirado se olvida');
// Posición como la tiene guardada quien ya la usaba: con FBTC.SW pegado.
w.eval(`
  assets = [{id:3,name:'Fidelity Physical Bitcoin',cat:'cripto',broker:'MyInvestor',
             mode:'auto',ticker:'FBTC',yfSym:'FBTC.SW',qty:22,unit:'títulos',
             costUnit:8.23,mp:6.49,ccy:'EUR'}];
  autoUpgradeAssets();
  window.__a = assets[0];
`);
eq(w.__a.yfSym, 'FBTC.L', 'la posición pasa de FBTC.SW a FBTC.L');
eq(w.eval(`CAT_BY_SYM['FBTC.SW']?1:0`), 0, 'FBTC.SW ya no está en el catálogo');
eq(w.eval(`CAT_BY_SYM['FBTC.L']?1:0`), 1, 'FBTC.L sí está');

// FBTC.DE lleva deslistado en Yahoo desde hace tiempo: tampoco debe quedar.
w.eval(`
  assets = [{id:4,name:'Fidelity Physical Bitcoin',cat:'cripto',mode:'auto',
             ticker:'FBTC',yfSym:'FBTC.DE',qty:1,costUnit:1,mp:1,ccy:'EUR'}];
  autoUpgradeAssets(); window.__b = assets[0];
`);
eq(w.__b.yfSym, 'FBTC.L', 'la posición con el símbolo deslistado FBTC.DE también se recoloca');

console.log('\nLa variación diaria sale de la plaza buena');
// Feed como el que publica update_precios.py, ya con FBTC.L.
w.eval(`
  lpx={};lpxPrev={};lpxSpark={};
  const eur=7.5925*0.85477, prev=7.581*0.85477;
  lpx['#3']=eur; lpxPrev['#3']=prev;
  window.__d = dayChg({id:3,cat:'cripto',mode:'auto',qty:22,ticker:'FBTC'});
`);
eq(w.__d.pct, 0.15, 'la variación del día es +0,15%, no -19,32%');
eq(w.__d.abs, 22 * (7.5925 - 7.581) * 0.85477, 'en euros, +0,22 € sobre 22 títulos');

console.log('\nEl dato que causaba el fallo ya no se usa');
const sim = JSON.parse(fs.readFileSync('C:/Users/Marc/Desktop/Proyectos/Inversiones/Cartera/repo/simbolos.json', 'utf8'));
const f = sim.find(x => x.ticker === 'FBTC');
eq(f.sym, 'FBTC.L', 'simbolos.json (lo que se pide a Yahoo cada 15 min) apunta a Londres');
eq(f.isin, 'XS2434891219', 'y conserva el ISIN, que es lo que casa con la posición');

console.log('\n' + ok + ' ok · ' + ko + ' fallos');
process.exit(ko ? 1 : 0);
