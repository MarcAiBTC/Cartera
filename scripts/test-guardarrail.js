// prevFiable(): descarta el cierre anterior cuando no cuadra con su propia serie,
// pero NUNCA esconde un movimiento real. Los casos usan series de verdad.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = 'C:/Users/Marc/Desktop/Proyectos/Inversiones/Cartera/repo/index.html';

let ok = 0, ko = 0;
const eq = (a, b, msg) => {
  if (a === b) { ok++; console.log('  ✓ ' + msg); }
  else { ko++; console.log('  ✗ ' + msg + '  → esperado ' + b + ', obtenido ' + a); }
};

const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'),
  { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://marcaibtc.github.io/Cartera/' });
const fiable = (prev, hoy, spark) => dom.window.eval('prevFiable')(prev, hoy, spark);

console.log('El caso real que lo motivó');
// precios.json del 24-ago-2026, FBTC.SW: la serie es de la clase en dólares y la
// cotización de hoy es la de la clase en francos, todo pasado a euros al cambio
// del franco. Daba -19,32% con el bitcoin plano.
const fbtc = [6.706022,6.725268,6.667531,6.686777,6.715645,6.715645,6.527466,6.6825,
              6.740237,6.70923,6.791559,6.785143,6.652563,6.661116,6.654701,6.541366,
              6.650424,6.765898,7.248107,7.459809,8.044661,6.490044];
eq(fiable(8.044661, 6.490044, fbtc), false, 'descarta el cierre de 8,04 € cuando hoy vale 6,49 €');
eq(fiable(6.765898, 6.490044, fbtc), true, 'un cierre normal de la misma serie sí vale');

console.log('\nMovimientos reales que NO se deben esconder');
const plana = n => Array(n).fill(100);
eq(fiable(100, 81, [...plana(20), 81]), true, 'un desplome real del -19% se sigue enseñando');
eq(fiable(100, 119, [...plana(20), 119]), true, 'un subidón real del +19% se sigue enseñando');
// Tendencia sostenida: los dos extremos se alejan de la mediana a la vez.
const sube = Array.from({length: 21}, (_, i) => 100 * Math.pow(1.03, i));
eq(fiable(sube[19], sube[20], sube), true, 'una subida sostenida de 21 sesiones no dispara nada');
// Un desplome que se queda abajo: al día siguiente la mediana está arriba, pero
// el precio de hoy también está lejos de ella, así que tampoco salta.
const cae = [...plana(15), 60, 60, 60, 60, 60, 60];
eq(fiable(60, 60, cae), true, 'tras un desplome, los días siguientes se siguen midiendo');

console.log('\nCasos de borde');
eq(fiable(0, 6.49, fbtc), false, 'sin cierre anterior no hay variación');
eq(fiable(8.04, 0, fbtc), false, 'sin precio de hoy tampoco');
eq(fiable(8.04, 6.49, null), true, 'sin serie no se juzga: se deja pasar');
eq(fiable(8.04, 6.49, [6.7, 6.7, 6.7]), true, 'con menos de 6 cierres tampoco se juzga');

console.log('\n' + ok + ' ok · ' + ko + ' fallos');
process.exit(ko ? 1 : 0);
