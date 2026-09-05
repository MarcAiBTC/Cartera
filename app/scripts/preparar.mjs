// ── PREPARAR SUPABASE ────────────────────────────────────────────────────
// Un solo comando que deja la base de datos lista: crea las tablas y la RLS,
// y siembra el catálogo de símbolos.
//
//   npm run preparar
//
// Lee las credenciales de `app/.env`, así que no hay que pegarlas en la
// terminal ni pasarlas por ningún sitio. Necesita dos:
//
//   DATABASE_URL               la cadena de conexión de Supabase
//   SUPABASE_SERVICE_ROLE_KEY  para escribir en el catálogo
//
// Se puede ejecutar más de una vez: si las tablas ya existen, lo dice y pasa
// al catálogo en vez de fallar. Eso es a propósito — la mitad de las veces que
// se ejecuta esto es porque algo salió mal a medias.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import pg from "pg";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const ESQUEMA = RAIZ + "supabase/migrations/0001_esquema.sql";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(`
Falta DATABASE_URL en app/.env.

Está en el botón «Connect», arriba del todo del panel de Supabase, al lado
del nombre del proyecto. No está dentro de Settings. Elige «Session pooler»,
copia la línea y sustituye [YOUR-PASSWORD] por la contraseña de la base de
datos:

  DATABASE_URL=postgresql://postgres.xxxx:CONTRASENA@aws-0-eu-central-1.pooler.supabase.com:5432/postgres

────────────────────────────────────────────────────────────────────────

Si no lo encuentras, hay otra forma sin DATABASE_URL: pegar el esquema a
mano. Copia el archivo al portapapeles con

  Get-Content supabase\\migrations\\0001_esquema.sql -Raw | Set-Clipboard

y pégalo en el SQL Editor de Supabase (barra izquierda, icono «SQL»), botón
«Run». Después vuelve aquí y ejecuta  npm run sembrar-catalogo
`);
  process.exit(1);
}

// ── 1 · El esquema ───────────────────────────────────────────────────────

const sql = readFileSync(ESQUEMA, "utf8");

// Supabase exige TLS. El certificado del pooler no valida contra las CA del
// sistema, y aquí se conecta a un servidor cuya dirección viene de un archivo
// local: no hay intermediario del que protegerse.
const cliente = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

console.log("Conectando con la base de datos…");
try {
  await cliente.connect();
} catch (e) {
  console.error(`\nNo se ha podido conectar: ${e.message}`);
  console.error("Comprueba la contraseña dentro de DATABASE_URL y que el proyecto no esté pausado.");
  process.exit(1);
}

try {
  await cliente.query(sql);
  console.log("Esquema aplicado: tablas, RLS y políticas.");
} catch (e) {
  // 42P07 = la tabla ya existe. Volver a ejecutar el script no es un error,
  // es lo normal cuando algo falló a mitad y se reintenta.
  if (e.code === "42P07" || /ya existe|already exists/i.test(e.message)) {
    console.log("El esquema ya estaba aplicado; se deja como está.");
  } else {
    console.error(`\nEl esquema ha fallado: ${e.message}`);
    if (e.position) console.error(`  cerca del carácter ${e.position}`);
    await cliente.end();
    process.exit(1);
  }
}

// ── 2 · Comprobar que están todas ────────────────────────────────────────

const ESPERADAS = [
  "accounts", "assets", "operations", "snapshots", "watchlist", "targets",
  "cashflow", "settings", "prices", "fx", "fx_history", "catalog", "benchmark",
];

const { rows } = await cliente.query(
  `select table_name from information_schema.tables
    where table_schema = 'public' and table_name = any($1)`,
  [ESPERADAS],
);
const hay = rows.map((r) => r.table_name);
const faltan = ESPERADAS.filter((t) => !hay.includes(t));

console.log(`Tablas: ${hay.length} de ${ESPERADAS.length}`);
if (faltan.length > 0) {
  console.error(`Faltan: ${faltan.join(", ")}`);
  await cliente.end();
  process.exit(1);
}

await cliente.end();

// ── 3 · El catálogo ──────────────────────────────────────────────────────

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("\nSin SUPABASE_SERVICE_ROLE_KEY no se puede sembrar el catálogo.");
  console.log("Añádela a app/.env y vuelve a ejecutar `npm run preparar`.");
  process.exit(0);
}

console.log("\nSembrando el catálogo de símbolos…");
execFileSync(process.execPath, [RAIZ + "scripts/sembrar-catalogo.mjs"], { stdio: "inherit" });

console.log(`
Listo. La base de datos ya está preparada.

Lo siguiente es migrar tu cartera:
  npm run migrar -- "C:\\ruta\\Cartera_Marc.json" --seco
`);
