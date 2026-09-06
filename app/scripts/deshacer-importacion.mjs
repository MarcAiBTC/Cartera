// ── DESHACER UNA IMPORTACIÓN ─────────────────────────────────────────────
// Borra las operaciones que entraron por un archivo y los activos que se
// crearon con ellas. Existe porque un importador que lee mal un formato no
// falla: rellena. Y lo que rellena hay que poder quitarlo entero, no fila a
// fila desde el móvil.
//
//   node scripts/deshacer-importacion.mjs --correo tu@correo            ← mirar
//   node scripts/deshacer-importacion.mjs --correo tu@correo --hazlo    ← borrar
//
// Por defecto sólo enseña lo que haría. Sin `--hazlo` no toca nada.
//
// Con `--formato traderepublic-csv` se limita a lo que vino de ese formato;
// sin él, a todo lo que tenga `source = 'import'`. Lo apuntado a mano nunca
// se toca: eso es lo que separa `source` de `import` y de `manual`.

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const bandera = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const correo = bandera("correo");
const formato = bandera("formato");
const hazlo = args.includes("--hazlo");

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !CLAVE || !correo) {
  console.error(
    "Faltan datos. Necesito SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en app/.env\n" +
      "y --correo con la cuenta cuya importación hay que deshacer.",
  );
  process.exit(1);
}

const db = createClient(URL, CLAVE, { auth: { persistSession: false } });

// ── De quién ─────────────────────────────────────────────────────────────
// La clave de servicio se salta la RLS, así que aquí el filtro por usuario
// hay que ponerlo a mano en cada consulta. Es justo lo que la RLS haría sola
// desde el navegador, y olvidarlo aquí borraría la cartera de otra persona.

const { data: lista, error: eUsuarios } = await db.auth.admin.listUsers();
if (eUsuarios) {
  console.error("No se ha podido consultar los usuarios:", eUsuarios.message);
  process.exit(1);
}
const usuario = lista.users.find((u) => u.email?.toLowerCase() === correo.toLowerCase());
if (!usuario) {
  console.error(`No hay ninguna cuenta con el correo ${correo}.`);
  process.exit(1);
}

console.log(`\nCuenta: ${usuario.email}  (${usuario.id})`);

// ── Qué se va ────────────────────────────────────────────────────────────

let q = db.from("operations").select("id,asset_id,type,date,total_eur,source_format").eq("user_id", usuario.id).eq("source", "import");
if (formato) q = q.eq("source_format", formato);
const { data: ops, error: eOps } = await q;
if (eOps) {
  console.error("No se han podido leer las operaciones:", eOps.message);
  process.exit(1);
}

if (ops.length === 0) {
  console.log("\nNo hay ninguna operación importada que deshacer.");
  process.exit(0);
}

const porTipo = new Map();
for (const o of ops) porTipo.set(o.type, (porTipo.get(o.type) ?? 0) + 1);
const fechas = ops.map((o) => o.date).sort();

console.log(`\nOperaciones importadas: ${ops.length}  (${fechas[0]} → ${fechas.at(-1)})`);
for (const [t, n] of [...porTipo].sort()) console.log(`  ${String(n).padStart(4)}  ${t}`);

// Un activo se borra sólo si TODAS sus operaciones se van con él. Si le queda
// alguna apuntada a mano, se queda: no es basura de la importación.
const { data: activos } = await db.from("assets").select("id,name,ticker,isin,cat").eq("user_id", usuario.id);
const { data: todas } = await db.from("operations").select("id,asset_id").eq("user_id", usuario.id);

const seVan = new Set(ops.map((o) => o.id));
const quedanPorActivo = new Map();
for (const o of todas ?? []) {
  if (!o.asset_id || seVan.has(o.id)) continue;
  quedanPorActivo.set(o.asset_id, (quedanPorActivo.get(o.asset_id) ?? 0) + 1);
}

const activosHuerfanos = (activos ?? []).filter((a) => !quedanPorActivo.has(a.id));

console.log(`\nActivos que se quedarían sin ninguna operación: ${activosHuerfanos.length} de ${activos?.length ?? 0}`);
for (const a of activosHuerfanos.slice(0, 60)) {
  console.log(`  ${(a.name ?? "").slice(0, 44).padEnd(46)} ${a.cat}`);
}
if (activosHuerfanos.length > 60) console.log(`  … y ${activosHuerfanos.length - 60} más`);

if (!hazlo) {
  console.log("\nModo mirar: no se ha borrado nada. Añade --hazlo para borrarlo de verdad.");
  process.exit(0);
}

// ── Borrar ───────────────────────────────────────────────────────────────
// Las operaciones primero: un activo con operaciones colgando no se puede
// borrar, y así un fallo a mitad deja la cartera coherente en vez de con
// activos vacíos.

const trozos = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

let borradas = 0;
for (const t of trozos(ops.map((o) => o.id), 100)) {
  const { error } = await db.from("operations").delete().eq("user_id", usuario.id).in("id", t);
  if (error) {
    console.error("Fallo al borrar operaciones:", error.message);
    process.exit(1);
  }
  borradas += t.length;
}
console.log(`\nOperaciones borradas: ${borradas}`);

let quitados = 0;
for (const t of trozos(activosHuerfanos.map((a) => a.id), 100)) {
  const { error } = await db.from("assets").delete().eq("user_id", usuario.id).in("id", t);
  if (error) {
    console.error("Fallo al borrar activos:", error.message);
    process.exit(1);
  }
  quitados += t.length;
}
console.log(`Activos borrados:     ${quitados}`);
console.log("\nListo. Vuelve a subir el archivo en Importar.");
