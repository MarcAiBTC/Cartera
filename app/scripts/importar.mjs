// ── IMPORTAR UN EXTRACTO DESDE LA TERMINAL ───────────────────────────────
// Hace exactamente lo que hace la pantalla Importar, llamando a las MISMAS
// funciones (`leer` y `planificar`). No es una segunda implementación: si
// esto y la app dieran números distintos, uno de los dos estaría mintiendo.
//
//   npx vite-node scripts/importar.mjs <archivo> --correo tu@correo
//   npx vite-node scripts/importar.mjs <archivo> --correo tu@correo --hazlo
//
// Sin `--hazlo` sólo enseña el plan y las cifras para cuadrar. Con `--hazlo`
// crea la cuenta y los activos que falten e inserta las operaciones.
//
// Las operaciones ya importadas no se duplican: cada una lleva su `huella`,
// y las que ya están en la base se saltan. Se puede ejecutar dos veces.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { tabular } from "../src/lib/import/csv.ts";
import { leer, detectar, planificar } from "../src/lib/import/index.ts";
import { FORMATO_LBL } from "../src/lib/import/tipos.ts";

const args = process.argv.slice(2);
const bandera = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const archivo = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
const correo = bandera("correo");
const hazlo = args.includes("--hazlo");

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!archivo || !correo || !URL || !CLAVE) {
  console.error("uso: npx vite-node scripts/importar.mjs <archivo> --correo tu@correo [--hazlo]");
  process.exit(1);
}

const db = createClient(URL, CLAVE, { auth: { persistSession: false } });

// La clave de servicio se salta la RLS: el filtro por usuario va a mano en
// cada consulta, que es justo lo que la RLS haría sola desde el navegador.
const { data: lista } = await db.auth.admin.listUsers();
const usuario = lista.users.find((u) => u.email?.toLowerCase() === correo.toLowerCase());
if (!usuario) {
  console.error(`No hay ninguna cuenta con el correo ${correo}.`);
  process.exit(1);
}
const uid = usuario.id;

// ── El estado actual, para casar con lo que ya hay ───────────────────────

const mio = (t, cols = "*") => db.from(t).select(cols).eq("user_id", uid);
const [{ data: cuentas }, { data: activos }, { data: operaciones }] = await Promise.all([
  mio("accounts"),
  mio("assets"),
  mio("operations"),
]);

const { data: catalogo } = await db.from("catalog").select("*").eq("retired", false);
const { data: fxFilas } = await db.from("fx").select("code,rate");
const fx = Object.fromEntries((fxFilas ?? []).map((f) => [f.code, f.rate]));

const { data: fxHist } = await db.from("fx_history").select("code,date,rate");
const fxHistorico = {};
for (const f of fxHist ?? []) {
  (fxHistorico[f.code] ??= {})[f.date] = f.rate;
}

const estado = {
  cuentas: cuentas ?? [],
  activos: activos ?? [],
  operaciones: operaciones ?? [],
  snapshots: [],
  seguimiento: [],
  objetivos: [],
  cashflow: {},
  ajustes: {},
};

// ── Leer y planificar ────────────────────────────────────────────────────

const texto = readFileSync(archivo, "utf8");
const entrada = { nombre: archivo, texto, tabla: tabular(texto) };
const formato = detectar(entrada);
const lectura = leer(entrada);

console.log(`\nArchivo:  ${archivo}`);
console.log(`Formato:  ${FORMATO_LBL[formato] ?? formato}`);
console.log(`Filas:    ${entrada.tabla.filas.length}  →  ${lectura.filas.length} operaciones, ${lectura.descartes.length} descartes`);

const plan = planificar(lectura, {
  estado,
  fx,
  fxHistorico,
  catalogo: catalogo ?? [],
  cuentaId: (cuentas ?? []).find((c) => c.broker === lectura.broker)?.id,
  broker: lectura.broker,
});

console.log(`\nNuevas:      ${plan.nuevas.length}`);
console.log(`Duplicadas:  ${plan.duplicadas.length}   (ya estaban: no se vuelven a insertar)`);
console.log(`Activos que se crean: ${plan.activosNuevos.length}`);
for (const a of plan.activosNuevos) {
  console.log(`   ${(a.name ?? "").slice(0, 26).padEnd(28)} isin=${(a.isin ?? "-").padEnd(13)} tick=${(a.ticker ?? "-").padEnd(6)} ${a.cat}`);
}
if (plan.cuentaNueva) console.log(`Cuenta que se crea:  ${plan.cuentaNueva.name}`);

if (lectura.descartes.length) {
  console.log(`\nDescartes:`);
  for (const d of lectura.descartes) console.log(`   linea ${d.linea}: ${d.motivo}`);
}

const suma = (tipos) =>
  plan.nuevas.reduce((s, p) => (tipos.includes(p.fila.tipo) ? s + (p.operacion.total_eur ?? 0) : s), 0);
const ingresos = suma(["deposit"]);
const retiradas = suma(["withdrawal"]);
const compras = suma(["buy"]);
const ventas = suma(["sell"]);
const cobros = suma(["dividend", "interest"]);
const gastos = suma(["fee"]);
const comisiones = plan.nuevas.reduce((s, p) => s + (p.operacion.fees ?? 0), 0);

console.log(`\n── Para cuadrar con el bróker ──`);
const l = (t, v) => console.log(`  ${t.padEnd(22)} ${v.toFixed(2).padStart(10)} EUR`);
l("Ingresos", ingresos);
l("Retiradas", retiradas);
l("Compras (bruto)", compras);
l("Ventas (bruto)", ventas);
l("Intereses y dividendos", cobros);
l("Comisiones", comisiones);
l("Otros gastos", gastos);
console.log("  " + "─".repeat(34));
// El efectivo que deberia quedar en el broker, si el extracto lo cuenta todo.
l("Efectivo teórico", ingresos - retiradas - compras + ventas + cobros - gastos - comisiones);
l("Aportado neto", ingresos - retiradas);
if (plan.efectivo) {
  console.log(`
  Cuenta de efectivo: «${plan.efectivo.activo.name}» con saldo ${plan.efectivo.saldo.toFixed(2)} EUR`);
  console.log(`  ${plan.efectivo.existente ? "(ya existe: se actualiza el saldo)" : "(se crea)"}`);
}

if (!hazlo) {
  console.log("\nModo mirar: no se ha escrito nada. Añade --hazlo para importar.");
  process.exit(0);
}

// ── Escribir ─────────────────────────────────────────────────────────────

let cuentaId = plan.planeadas[0]?.operacion.account_id ?? null;
if (plan.cuentaNueva) {
  const { data, error } = await db
    .from("accounts")
    .insert({ ...plan.cuentaNueva, user_id: uid })
    .select()
    .single();
  if (error) throw new Error(`cuenta: ${error.message}`);
  cuentaId = data.id;
  console.log(`\nCuenta creada: ${data.name}`);
}

// Los activos primero: las operaciones necesitan su id.
const idPorClave = new Map();
for (const a of estado.activos) {
  if (a.isin) idPorClave.set(a.isin.toUpperCase(), a.id);
  if (a.ticker) idPorClave.set(a.ticker.toUpperCase(), a.id);
}
if (plan.activosNuevos.length) {
  const { data, error } = await db
    .from("assets")
    .insert(plan.activosNuevos.map((a) => ({ ...a, user_id: uid })))
    .select();
  if (error) throw new Error(`activos: ${error.message}`);
  for (const a of data) {
    if (a.isin) idPorClave.set(a.isin.toUpperCase(), a.id);
    if (a.ticker) idPorClave.set(a.ticker.toUpperCase(), a.id);
  }
  console.log(`Activos creados: ${data.length}`);
}

const trozos = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

const operacionesNuevas = plan.nuevas.map((p) => ({
  ...p.operacion,
  user_id: uid,
  account_id: cuentaId,
  asset_id:
    p.operacion.asset_id ??
    idPorClave.get((p.fila.isin ?? "").toUpperCase()) ??
    idPorClave.get((p.fila.ticker ?? "").toUpperCase()) ??
    null,
}));

let escritas = 0;
for (const t of trozos(operacionesNuevas, 200)) {
  const { error } = await db.from("operations").insert(t);
  if (error) throw new Error(`operaciones: ${error.message}`);
  escritas += t.length;
}
console.log(`Operaciones insertadas: ${escritas}`);

// ── El efectivo ──────────────────────────────────────────────────────────
// Va al final a proposito: el saldo depende de las operaciones, asi que
// primero tienen que estar dentro.
if (plan.efectivo) {
  const { existente, activo, saldo } = plan.efectivo;
  const fila = { ...activo, user_id: uid };
  delete fila.id;
  delete fila.created_at;
  delete fila.updated_at;
  const { error } = existente
    ? await db.from("assets").update(fila).eq("id", existente.id)
    : await db.from("assets").insert(fila);
  if (error) throw new Error(`efectivo: ${error.message}`);
  console.log(`Efectivo ${existente ? "actualizado" : "creado"}: ${saldo.toFixed(2)} EUR`);
}
console.log("\nHecho. Recarga la app.");
