// Deja informe.html con el correo de hoy, para abrirlo en el navegador y ver
// cómo va a quedar antes de que salga a las 22:05.
//
//   node scripts/vista-previa.mjs                        · cartera real (pide CARTERA_PASS)
//   CARTERA_PASS=... node scripts/vista-previa.mjs
//   node scripts/vista-previa.mjs ../Cartera_Marc_2026-08-10.json   · desde un export
//   node scripts/vista-previa.mjs leti                   · el perfil de Leti
//
// Sin contraseña y sin fichero no se inventa nada: se dice qué falta y se sale.
// informe.html está en .gitignore, así que la cartera descifrada no se sube a
// ningún sitio; el correo no se envía nunca desde aquí (va con DRY_RUN).

import { existsSync, renameSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

let perfil = 'marc', fichero = null;
for (const a of args) {
  if (a === 'marc' || a === 'leti') perfil = a;
  else fichero = path.resolve(a);
}
if (fichero && !existsSync(fichero)) {
  console.error(`No existe el fichero ${fichero}.`);
  process.exit(1);
}

const cifrado = path.join(RAIZ, 'datos', `cartera-${perfil}.enc.json`);
let pass = process.env.CARTERA_PASS || '';

if (!fichero) {
  if (!existsSync(cifrado)) {
    console.error(`No hay ${path.relative(RAIZ, cifrado)}. Abre la app para que publique la cartera, o pásame un export:\n`
      + `  node scripts/vista-previa.mjs ruta/a/Cartera_${perfil}.json`);
    process.exit(1);
  }
  // Se pide por teclado en vez de exigir la variable de entorno: escrita en la
  // línea de comandos, la contraseña se queda en el historial del terminal.
  if (!pass && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    pass = await rl.question(`Contraseña del informe (la de la app) para ${perfil}: `);
    rl.close();
  }
  if (!pass) {
    console.error('Falta la contraseña. Ponla en CARTERA_PASS o pásame un export de la app:\n'
      + '  node scripts/vista-previa.mjs ruta/a/Cartera_Marc.json');
    process.exit(1);
  }
}

const salida = path.join(RAIZ, `informe-${perfil}.html`);
try {
  execFileSync(process.execPath, [path.join(RAIZ, 'scripts', 'informe_diario.mjs')], {
    cwd: RAIZ, stdio: 'inherit',
    env: {
      ...process.env,
      FORCE: '1', DRY_RUN: '1', SOLO_PERFIL: perfil,
      CARTERA_PASS: pass, CARTERA_FILE: fichero || '',
      // El respaldo antiguo y el transporte no pintan nada en una vista previa.
      POSICIONES_JSON: '', RESEND_API_KEY: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '',
    },
  });
} catch {
  process.exit(1);
}

if (!existsSync(salida)) {
  console.error('El informe no llegó a generarse. Mira los mensajes de arriba.');
  process.exit(1);
}
const destino = path.join(RAIZ, 'informe.html');
renameSync(salida, destino);
const kb = (readFileSync(destino).length / 1024).toFixed(0);
console.log(`\nListo: informe.html (${kb} KB, con la tarta incrustada para poder verla en el navegador).`);
console.log(`Ábrelo con:  start informe.html      · o arrástralo al navegador.`);
