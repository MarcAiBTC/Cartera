// Ejecutar con:  node scripts/test-liquidez-no-es-ganancia.js
//
// Añadir efectivo a la cartera es una APORTACIÓN, nunca una ganancia.
//
// El fallo: el formulario pedía «Precio de compra (por unidad)», que en una
// cuenta corriente no significa nada. Al dejarlo vacío se guardaba costUnit:0 y
// cs() devolvía 0, así que el saldo entero se leía como plusvalía sin vender.
// Y el porcentaje sobre el capital salía mal por los dos lados a la vez: la
// ganancia subía en el importe del saldo y el aportado bajaba en ese mismo
// importe, porque aportadoHoy() se calcula desde tc().
//
// Da igual que el dinero sea nuevo o que sea dinero que ya tenías y no habías
// apuntado: en los dos casos es capital, no beneficio.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const HTML = 'C:/Users/Marc/Desktop/Proyectos/Inversiones/Cartera/repo/index.html';

let ok = 0, ko = 0;
const eq = (a, b, msg, tol = 0.02) => {
  const good = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : a === b;
  if (good) { ok++; console.log('  ✓ ' + msg); }
  else { ko++; console.log('  ✗ ' + msg + '  → esperado ' + b + ', obtenido ' + a); }
};

// Cartera de partida: 1.000 € aportados en un fondo que hoy vale 1.200 €.
// Ganancia real = 200 €, aportado = 1.000 €, rentabilidad = 20%.
const estado = {
  assets: [
    { id: 2, name: 'Fondo Mundo', cat: 'fondo', broker: 'MyInvestor',
      qty: 100, costUnit: 10, mp: 12, ccy: 'EUR', mode: 'manual' },
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

  console.log('\n1 · Punto de partida');
  eq(E('tv()'), 1200, 'patrimonio 1.200 €');
  eq(E('gananciaTotal()'), 200, 'ganancia 200 €');
  eq(E('aportadoHoy()'), 1000, 'aportado 1.000 €');
  eq(E('gananciaTotal()/aportadoHoy()*100'), 20, 'rentabilidad 20%');

  console.log('\n2 · El caso del fallo: efectivo guardado con costUnit a 0');
  // Exactamente lo que dejaba el formulario al no tocar «precio de compra».
  E("assets.push({id:99,name:'Cuenta corriente',cat:'liquidez',broker:'ING',qty:730,unit:'€',costUnit:0,mp:1,ccy:'EUR',mode:'manual'});");
  eq(E('tv()'), 1930, 'el patrimonio sí sube: 1.200 + 730 de efectivo');
  eq(E("cs(assets.find(a=>a.id===99))"), 730, 'el coste del efectivo es su saldo, no 0');
  eq(E("gn(assets.find(a=>a.id===99))"), 0, 'y por tanto no genera ni un euro de plusvalía');
  eq(E('gananciaTotal()'), 200, 'la ganancia total NO se mueve: sigue en 200 €');
  eq(E('aportadoHoy()'), 1730, 'el aportado sube en los 730 €: eso sí es capital tuyo');
  eq(E('gananciaTotal()/aportadoHoy()*100'), 200 / 1730 * 100, 'y la rentabilidad baja al repartirse sobre más capital', 0.01);
  // Con el fallo, esto daba ganancia 930 € y aportado 1.000 € → 93%.
  eq(E('gananciaTotal()') === 930, false, 'no cuenta los 730 € como ganancia (era el fallo)');

  console.log('\n3 · La normalización deja el dato guardado limpio');
  E('autoUpgradeAssets();');
  eq(E("assets.find(a=>a.id===99).costUnit"), 1, 'costUnit del efectivo pasa a 1');
  eq(E("JSON.parse(localStorage.getItem('cv9')).assets.find(a=>a.id===99).costUnit"), 1, 'y se guarda así, para el JSON y el informe');

  console.log('\n4 · Da igual cómo llegue el dato: la fórmula no se deja engañar');
  // Un backup viejo o un JSON editado a mano pueden traer cualquier cosa.
  E("assets.find(a=>a.id===99).costUnit=0.4;");
  eq(E("cs(assets.find(a=>a.id===99))"), 730, 'cs() ignora un costUnit absurdo en liquidez');
  eq(E('gananciaTotal()'), 200, 'la ganancia sigue sin inventarse nada');
  E("assets.find(a=>a.id===99).costUnit=1;");

  console.log('\n5 · Efectivo en dólares: el coste sigue siendo el saldo');
  E("fxRates.USD=0.5;");
  E("assets.push({id:98,name:'Cuenta USD',cat:'liquidez',broker:'Revolut',qty:200,unit:'$',costUnit:1,mp:1,ccy:'USD',mode:'manual'});");
  eq(E("vl(assets.find(a=>a.id===98))"), 100, '200 $ al 0,5 son 100 €');
  eq(E("cs(assets.find(a=>a.id===98))"), 100, 'y su coste, los mismos 100 €');
  eq(E('gananciaTotal()'), 200, 'la ganancia total sigue intacta');
  E("assets=assets.filter(a=>a.id!==98);");

  console.log('\n6 · Guardar por el formulario ya no puede meter el fallo');
  E("openAModal(); pCat('liquidez');");
  eq(E("el('a-cost-wrap').style.display"), 'none', 'el campo «precio de compra» desaparece en liquidez');
  eq(E("el('a-qty-l').textContent"), 'Saldo', 'y «Cantidad» pasa a llamarse «Saldo»');
  eq(E("el('a-liq-hint').style.display"), 'block', 'con el aviso de que meter dinero es aportar, no ganar');
  E("el('a-name').value='Cuenta nueva'; el('a-qty').value='500'; el('a-costunit').value=''; saveAsset();");
  const nueva = E("assets.find(a=>a.name==='Cuenta nueva')");
  eq(nueva.costUnit, 1, 'se guarda con coste = saldo aunque el campo fuera vacío');
  eq(E("gn(assets.find(a=>a.name==='Cuenta nueva'))"), 0, 'y no aporta plusvalía');
  eq(E('gananciaTotal()'), 200, 'la ganancia total sigue siendo la de las inversiones');
  eq(E('aportadoHoy()'), 2230, 'el aportado recoge los 500 € nuevos');

  console.log('\n7 · Volver a la categoría normal reactiva el campo');
  E("openAModal(); pCat('fondo');");
  eq(E("el('a-cost-wrap').style.display"), '', 'el precio de compra vuelve para lo que sí se compra');
  eq(E("el('a-qty-l').textContent"), 'Cantidad', 'y la etiqueta también');
  E("closeAModal();");

  console.log('\n8 · Los días guardados apuntan el coste de lo invertido');
  E("assets=assets.filter(a=>a.name!=='Cuenta nueva'); saveSnap();");
  const s0 = E('snaps[snaps.length-1]');
  eq(s0.costInv, 1000, 'costInv es el coste de mercado, sin el efectivo');
  eq(s0.cost, 1730, 'cost sigue siendo el total, ya con el efectivo bien valorado');
  eq(E('costInvEn(snaps[snaps.length-1])'), 1000, 'costInvEn() lo lee directo');

  console.log('\n9 · Un día guardado viejo (sin costInv) se reconstruye');
  eq(E('costInvEn({cost:1730,liq:730})'), 1000, 'restando la liquidez, como se hacía antes');
  eq(E('costInvEn({cost:900,liq:1500})'), 0, 'y nunca por debajo de cero');

  console.log('\n10 · El aportado del día de hoy cuadra con el gráfico');
  eq(E('serieEvo()[serieEvo().length-1].ap'), 1730, 'la serie cierra con el aportado real');
  eq(E('serieEvo()[serieEvo().length-1].apInv'), 1000, 'y el aportado invertido deja el efectivo fuera');

  console.log('\n11 · El día de hoy escrito por la versión vieja se rehace');
  // Un día de hoy sin costInv viene del código anterior, y su cost puede llevar
  // el efectivo valorado a cero. Como es de hoy y la cartera es la misma, se
  // puede recalcular con las cifras de ahora sin suponer nada.
  E('snaps.length=0;');
  E("snaps.push({id:1,ts:Date.now(),val:999,cost:1000,liq:0,auto:true});");
  E('autoSnapDaily();');
  eq(E('snaps.length'), 1, 'no duplica el día');
  eq(E('snaps[0].costInv'), 1000, 'le pone el coste de mercado que faltaba');
  eq(E('snaps[0].cost'), 1730, 'y rehace el coste total con el efectivo bien valorado');
  eq(E('snaps[0].liq'), 730, 'apuntando también la liquidez de hoy');
  // Un día ANTERIOR no se toca: reescribir historia con las cifras de hoy sería
  // cambiar un error por otro, y encima sin que se note.
  E("snaps.push({id:2,ts:Date.now()-3*864e5,val:900,cost:880,liq:0});");
  E('autoSnapDaily();');
  eq(E('snaps.find(s=>s.id===2).cost'), 880, 'un día viejo se queda como estaba');
  eq(E('snaps.find(s=>s.id===2).costInv==null'), true, 'y sin costInv inventado');

  console.log('\n12 · Sin errores en consola');
  eq(errs.length, 0, 'nada ha reventado' + (errs.length ? ' → ' + errs.join(' | ') : ''));

  console.log('\n' + (ko ? '✗ ' + ko + ' fallos' : '✓ todo correcto') + ' · ' + ok + ' comprobaciones');
  process.exit(ko ? 1 : 0);
})();
