// Ejecutar con:  npm i jsdom && node scripts/test-informe.js
//
// Prueba de extremo a extremo del informe diario: la app cifra la cartera y la
// "sube" a GitHub (la petición se intercepta), y el script del informe descifra
// ese mismo fichero y genera el correo. Si el cifrado del navegador y el
// descifrado de Node dejaran de entenderse, el correo llegaría vacío sin que
// nada más avisara, así que la comprobación es toda la cadena junta.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { webcrypto } = require('crypto');
const { JSDOM } = require('jsdom');

const RAIZ = path.resolve(__dirname, '..');
const HTML = path.join(RAIZ, 'index.html');
const PASS = 'contraseña de prueba · ñ áé 🔐';

let ok = 0, ko = 0;
const eq = (a, b, msg, tol = 0.02) => {
  const good = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tol : a === b;
  if (good) { ok++; console.log('  OK  ' + msg); }
  else { ko++; console.log('  FALLO ' + msg + '  -> esperado ' + b + ', obtenido ' + a); }
};

const estado = {
  assets: [
    { id: 1, name: 'Efectivo TR', cat: 'liquidez', broker: 'Trade Republic', qty: 1500, costUnit: 1, mp: 1, ccy: 'EUR', mode: 'manual' },
    { id: 2, name: 'Amundi MSCI World', cat: 'fondo', broker: 'MyInvestor', qty: 100, costUnit: 10, mp: 14, ccy: 'EUR', mode: 'manual', underlying: 'MSCI World' },
    { id: 3, name: 'Xetra Gold', cat: 'metal', broker: 'Trade Republic', qty: 20, costUnit: 40, mp: 52, ccy: 'EUR', mode: 'manual', underlying: 'Oro' },
  ],
  snaps: [], wl: [], targets: { 'MSCI World': 50, Oro: 30, Liquidez: 20 },
  trades: [], aports: [], rendim: [],
};
// 1500 + 1400 + 1040 = 3940 €
const TOTAL_ESPERADO = 3940;

const estadoLeti = {
  assets: [
    { id: 1, name: 'Efectivo MyInvestor', cat: 'liquidez', broker: 'MyInvestor', qty: 800, costUnit: 1, mp: 1, ccy: 'EUR', mode: 'manual' },
    { id: 2, name: 'Vanguard Global', cat: 'fondo', broker: 'MyInvestor', qty: 50, costUnit: 20, mp: 23, ccy: 'EUR', mode: 'manual', underlying: 'MSCI World' },
  ],
  snaps: [], wl: [], targets: {}, trades: [], aports: [], rendim: [],
};
const TOTAL_LETI = 800 + 1150;

(async () => {
  const subidas = {};   // ruta -> contenido en claro del fichero .enc.json

  const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
    runScripts: 'dangerously', url: 'https://marcaibtc.github.io/Cartera/', pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem('cv9', JSON.stringify(estado));
      w.localStorage.setItem('cv9_leti', JSON.stringify(estadoLeti));
      w.localStorage.setItem('pub_token', 'github_pat_de_prueba');
      w.localStorage.setItem('pub_pass', PASS);
      // jsdom no trae crypto.subtle: se le presta el de Node, que es la misma
      // implementación de WebCrypto que usa el navegador.
      Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });
      // Se intercepta la API de GitHub; cualquier otra red se corta.
      w.fetch = (url, opts = {}) => {
        const u = String(url);
        if (!u.startsWith('https://api.github.com/')) return Promise.reject(new Error('sin red'));
        const ruta = u.split('/contents/')[1].split('?')[0];
        if (!opts.method || opts.method === 'GET') {
          return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') });
        }
        const cuerpo = JSON.parse(opts.body);
        subidas[ruta] = Buffer.from(cuerpo.content, 'base64').toString('utf8');
        return Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve('{}'), json: () => Promise.resolve({}) });
      };
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

  console.log('\n1 · La app se reconoce configurada');
  eq(E('pubListo()'), true, 'hay token y contraseña');
  eq(E('pubSeguro()'), true, 'hay cifrado disponible');
  eq(E("el('pub-dot').className.includes('ok')||el('pub-dot').className.includes('wait')"), true, 'el punto de la cabecera no está en gris');

  console.log('\n2 · Publica los dos perfiles cifrados');
  eq(await E("publicarPerfil('marc',false)"), true, 'publica Marc');
  eq(await E("publicarPerfil('leti',false)"), true, 'publica Leti (leyendo su localStorage sin cambiar de perfil)');
  eq(Object.keys(subidas).sort().join(' · '),
     'datos/cartera-leti.enc.json · datos/cartera-marc.enc.json', 'sube un fichero por perfil');

  console.log('\n3 · Lo que se sube no es legible');
  const sobre = JSON.parse(subidas['datos/cartera-marc.enc.json']);
  eq(sobre.perfil, 'marc', 'el perfil va en claro (es metadato, no dinero)');
  eq(!!Date.parse(sobre.actualizado), true, 'y la fecha de publicación también');
  eq(/Xetra Gold|Amundi|1500/.test(subidas['datos/cartera-marc.enc.json']), false,
     'ningún nombre ni importe aparece en el fichero');
  eq(sobre.enc.alg, 'AES-GCM-256', 'va cifrado con AES-GCM de 256 bits');
  eq(sobre.enc.iter >= 200000, true, 'con un PBKDF2 de al menos 200 000 vueltas');

  console.log('\n4 · Dos publicaciones no repiten sal ni IV');
  E("(function(){var e=pubEstado();delete e.marc;pubGuardaEstado(e);})()");
  const antes = sobre.enc.iv;
  await E("publicarPerfil('marc',false)");
  const sobre2 = JSON.parse(subidas['datos/cartera-marc.enc.json']);
  eq(sobre2.enc.iv !== antes, true, 'IV distinto en cada subida');
  eq(sobre2.enc.salt !== sobre.enc.salt, true, 'sal distinta en cada subida');

  console.log('\n5 · Sin cambios no se sube nada');
  eq(await E("publicarPerfil('marc',true)"), false, 'la huella coincide y se ahorra el commit');

  console.log('\n6 · Guardar la cartera dispara la publicación automática');
  E("assets.push({id:99,name:'Nuevo',cat:'accion',broker:'Revolut',qty:1,costUnit:10,mp:12,ccy:'EUR',mode:'manual'});svSt();");
  eq(E('pubPendiente'), true, 'svSt() deja el publicador en pendiente');
  // El temporizador real espera 12 s de calma; aquí se adelanta el disparo.
  await E('pubAuto()');
  eq(E('pubPendiente'), false, 'al publicar deja de haber nada pendiente');
  eq(JSON.parse(subidas['datos/cartera-marc.enc.json']).actualizado >= sobre.actualizado, true, 'y el fichero subido se ha rehecho');

  console.log('\n7 · El script del informe descifra lo que subió la app');
  const dirDatos = path.join(RAIZ, 'datos');
  const escritos = [];
  const previos = new Map(); // carteras reales que el fixture va a pisar
  for (const [ruta, contenido] of Object.entries(subidas)) {
    const destino = path.join(RAIZ, ruta);
    if (fs.existsSync(destino)) previos.set(destino, fs.readFileSync(destino));
    fs.writeFileSync(destino, contenido);
    escritos.push(destino);
  }
  let salida = '';
  try {
    salida = execFileSync(process.execPath, [path.join(RAIZ, 'scripts', 'informe_diario.mjs')], {
      cwd: RAIZ, encoding: 'utf8',
      env: { ...process.env, CARTERA_PASS: PASS, FORCE: '1', DRY_RUN: '1', POSICIONES_JSON: '', RESEND_API_KEY: '' },
    });
  } catch (e) { salida = (e.stdout || '') + (e.stderr || ''); }
  console.log(salida.split('\n').filter(Boolean).map(l => '    ' + l).join('\n'));

  eq(/Marc: informe generado/.test(salida), true, 'genera el informe de Marc');
  eq(/Leti: informe generado/.test(salida), true, 'genera el de Leti');
  eq(/desde app/.test(salida), true, 'los datos vienen del fichero de la app, no del secret');

  const htmlMarc = fs.readFileSync(path.join(RAIZ, 'informe-marc.html'), 'utf8');
  const htmlLeti = fs.readFileSync(path.join(RAIZ, 'informe-leti.html'), 'utf8');
  const totalDe = h => {
    const m = h.match(/font-size:32px;font-weight:800">([^<]+)</);
    return m ? parseFloat(m[1].replace(/\./g, '').replace(',', '.')) : null;
  };
  eq(totalDe(htmlMarc), TOTAL_ESPERADO + 12, 'el total de Marc incluye la posición añadida en el paso 6', 1);
  eq(totalDe(htmlLeti), TOTAL_LETI, 'el total de Leti es el suyo, no el de Marc', 1);
  eq(/Cartera de Marc/.test(htmlMarc), true, 'cada informe se identifica');
  eq(/Cartera de Leti/.test(htmlLeti), true, 'y el de Leti también');
  eq(/Xetra Gold/.test(htmlLeti), false, 'la cartera de Marc no se filtra en el correo de Leti');
  eq(/Vanguard Global/.test(htmlMarc), false, 'ni la de Leti en el de Marc');

  console.log('\n8 · Con la contraseña equivocada no se inventa nada');
  let malo = '';
  try {
    malo = execFileSync(process.execPath, [path.join(RAIZ, 'scripts', 'informe_diario.mjs')], {
      cwd: RAIZ, encoding: 'utf8',
      env: { ...process.env, CARTERA_PASS: 'otra distinta', FORCE: '1', DRY_RUN: '1', POSICIONES_JSON: '', RESEND_API_KEY: '' },
    });
  } catch (e) { malo = (e.stdout || '') + (e.stderr || ''); }
  eq(/no abre el fichero/.test(malo), true, 'avisa de que la contraseña no abre el fichero');
  eq(/informe generado/.test(malo), false, 'y no genera ningún informe');

  // Las carteras de verdad no son basura del test: si el fixture pisó una que ya
  // existía, se devuelve tal cual estaba. Solo se borra lo que no había antes.
  for (const f of escritos) {
    if (previos.has(f)) fs.writeFileSync(f, previos.get(f));
    else fs.unlinkSync(f);
  }
  for (const f of ['informe-marc.html', 'informe-leti.html']) {
    const p = path.join(RAIZ, f); if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.rmSync(path.join(RAIZ, '.informe-enviado'), { recursive: true, force: true });

  console.log('\nErrores JS: ' + (errs.length ? errs.join(' | ') : 'ninguno'));
  console.log('\n' + ok + ' bien · ' + ko + ' mal');
  process.exit(ko || errs.length ? 1 : 0);
})();
