// ── SIMULAR UNA IMPORTACIÓN COMPLETA, SIN ESCRIBIR NADA ──────────────────
// Sube los archivos, aplica el plan EN MEMORIA y calcula la cartera con el
// motor de verdad. Es la única manera de responder a la pregunta que importa
// —«¿cuadra con lo que dice el banco?»— antes de tocar la base de datos.
//
//   npx vite-node scripts/simular-import.mjs <archivo> [otro archivo…]
//   npx vite-node scripts/simular-import.mjs --cero <archivos…>   ← cartera vacía
//   npx vite-node scripts/simular-import.mjs --cuadra 2879.69 <archivos…>
//
// Varios archivos a la vez porque MyInvestor lo exige: el Excel de la cuenta
// trae las compras y el PDF las participaciones, y por separado el primero
// deja los fondos a cero y el segundo no sabe lo que costaron. Ver
// `probar-import.mjs` si lo que quieres es mirar UN archivo por dentro.
//
// Llama a `leerArchivo`, `combinar` y `planificar` —las mismas funciones que
// la pantalla Importar— y luego repite lo que hace `confirmar()`. Si esto y la
// app dieran números distintos, uno de los dos estaría mintiendo.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { combinar, detectar, leer, leerArchivo, planificar } from "../src/lib/import/index.ts";
import { calcularPosiciones, calcularFifo, calcularResumen } from "../src/lib/cartera.ts";

const args = process.argv.slice(2);
const bandera = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const desdeCero = args.includes("--cero");
const cuadra = Number(bandera("cuadra"));
const correo = bandera("correo");
const rutas = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

if (rutas.length === 0) {
  console.error("uso: npx vite-node scripts/simular-import.mjs [--cero] [--cuadra N] <archivos…>");
  process.exit(1);
}

// ── El estado de partida ─────────────────────────────────────────────────
// El de verdad, para que el dedupe y el casado de posiciones trabajen contra
// lo que ya hay. Con `--cero`, la cartera vacía: así se ve qué haría una
// importación limpia, que es lo que hace quien estrena la app.

const db = createClient(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data: lista } = await db.auth.admin.listUsers();
const usuario = correo
  ? lista.users.find((u) => u.email?.toLowerCase() === correo.toLowerCase())
  : lista.users[0];
if (!usuario) {
  console.error(correo ? `No hay ninguna cuenta con el correo ${correo}.` : "No hay usuarios.");
  process.exit(1);
}

const mio = (t) => db.from(t).select("*").eq("user_id", usuario.id);
const [cuentas, activos, operaciones, precios, fxf, cat] = await Promise.all([
  mio("accounts"),
  mio("assets"),
  mio("operations"),
  db.from("prices").select("*"),
  db.from("fx").select("*"),
  db.from("catalog").select("*").eq("retired", false).limit(20000),
]);
const porSimbolo = Object.fromEntries((precios.data ?? []).map((p) => [p.symbol.toUpperCase(), p]));
const fx = Object.fromEntries((fxf.data ?? []).map((f) => [f.code ?? f.currency, f.rate ?? f.eur_rate]));
const catalogo = cat.data ?? [];

const estado = {
  cuentas: desdeCero ? [] : (cuentas.data ?? []),
  activos: desdeCero ? [] : (activos.data ?? []),
  operaciones: desdeCero ? [] : (operaciones.data ?? []),
  snapshots: [],
  seguimiento: [],
  objetivos: [],
  cashflow: {},
  ajustes: {},
};

// ── Los archivos, leídos como los lee la pantalla ────────────────────────

const lecturas = [];
for (const ruta of rutas) {
  const archivo = new File([readFileSync(ruta)], basename(ruta));
  const entrada = await leerArchivo(archivo);
  const formato = detectar(entrada);
  console.log(`${basename(ruta).padEnd(44)} → ${formato}`);
  if (formato === "desconocido") {
    console.error(`   no se ha reconocido: se queda fuera`);
    continue;
  }
  lecturas.push(leer(entrada, { formato }));
}
if (lecturas.length === 0) process.exit(1);

const junto = combinar(lecturas);
console.log(
  `\njuntos: ${junto.filas.length} movimientos · ${junto.posiciones?.length ?? 0} posiciones` +
    (junto.saldo != null ? ` · saldo declarado ${junto.saldo.toFixed(2)}` : "") +
    (junto.declarado?.total != null ? ` · total declarado ${junto.declarado.total.toFixed(2)}` : ""),
);

const cuenta = estado.cuentas.find((c) => c.broker === junto.broker);
const plan = planificar(junto, { estado, fx, catalogo, cuentaId: cuenta?.id });

console.log(
  `plan: ${plan.nuevas.length} nuevas · ${plan.duplicadas.length} ya estaban · ` +
    `${plan.activosNuevos.length} activos por crear · ${plan.descartes.length} avisos`,
);

if (plan.posiciones.length) {
  console.log(`\n-- posiciones (extracto completo: ${plan.extractoCompleto ? "sí" : "NO"}) --`);
  for (const p of plan.posiciones) {
    console.log(
      `  ${p.posicion.isin}  ${p.posicion.nombre.slice(0, 30).padEnd(31)}` +
        `${p.posicion.titulos.toFixed(5).padStart(12)} tit ` +
        `${p.posicion.valor.toFixed(2).padStart(10)} ${p.posicion.divisa}` +
        `  coste ${p.coste.toFixed(2).padStart(8)}  → ` +
        (p.activo ? p.activo.name : "se crea") +
        (p.absorbidos.length ? `  +absorbe ${p.absorbidos.map((a) => a.name).join(", ")}` : "") +
        (p.dudoso ? "  ⚠ DUDOSO: hay que elegir a mano" : "") +
        (p.aldia ? "  (ya estaba al día)" : ""),
    );
  }
}

if (plan.cerrados.length) {
  console.log("\n-- el extracto dice que ya no los tienes: nacen archivados --");
  for (const c of plan.cerrados) {
    console.log(`  ${c.nombre.padEnd(32)} ${c.ops} compras  ${c.euros.toFixed(2)} €`);
  }
}

if (plan.descartes.length) {
  console.log("\n-- avisos --");
  for (const d of plan.descartes) console.log(`  linea ${d.linea}: ${d.motivo}`);
}

// ── Aplicar el plan en memoria: lo mismo que `confirmar()` ───────────────
// El orden importa y es el de la pantalla: primero las posiciones, que son las
// que fijan a qué activo van las compras, y luego las operaciones.

const despues = structuredClone(estado);
const cuentaId = cuenta?.id ?? "cuenta-nueva";
if (!cuenta && plan.cuentaNueva) despues.cuentas.push({ id: cuentaId, ...plan.cuentaNueva });

const porClave = new Map();
let n = 0;
for (const a of plan.activosNuevos) {
  const id = `nuevo-${++n}`;
  despues.activos.push({ id, archived: false, underlying: null, ...a });
  for (const k of [a.isin, a.ticker, a.name]) if (k) porClave.set(k.toUpperCase(), id);
}

const redirigir = new Map();
let puestas = 0;
for (const p of plan.posiciones) {
  if (p.aldia) {
    if (p.activo) for (const k of p.claves) porClave.set(k, p.activo.id);
    continue;
  }
  let id;
  if (p.activo) {
    Object.assign(
      despues.activos.find((a) => a.id === p.activo.id),
      p.campos,
    );
    id = p.activo.id;
  } else {
    id = `posicion-${p.posicion.isin}`;
    despues.activos.push({ id, archived: false, ...p.campos });
  }
  for (const k of p.claves) porClave.set(k, id);
  for (const o of p.reasignar) despues.operaciones.find((x) => x.id === o.id).asset_id = id;
  for (const a of p.absorbidos) {
    redirigir.set(a.id, id);
    despues.activos.find((x) => x.id === a.id).archived = true;
  }
  puestas++;
}

let m = 0;
for (const p of plan.nuevas) {
  const clave = (p.fila.isin || p.fila.ticker || p.fila.nombre || "").toUpperCase();
  const suyo = p.activo ? (redirigir.get(p.activo.id) ?? p.activo.id) : undefined;
  despues.operaciones.push({
    ...p.operacion,
    id: `op-${++m}`,
    account_id: cuentaId,
    asset_id: porClave.get(clave) ?? suyo ?? null,
  });
}

if (plan.efectivo) {
  const campos = {
    name: plan.efectivo.activo.name,
    cat: "liquidez",
    currency: "EUR",
    unit: "€",
    mode: "manual",
    manual_qty: plan.efectivo.saldo,
    manual_cost_unit: 1,
    manual_price: 1,
  };
  const existe = despues.activos.find((a) => a.id === plan.efectivo.existente?.id);
  if (existe) Object.assign(existe, campos);
  else despues.activos.push({ id: "efectivo", archived: false, isin: null, ticker: null, ...campos });
}

// ── La cartera que saldría ───────────────────────────────────────────────

const posiciones = calcularPosiciones(despues, porSimbolo, fx);
const { realizadas } = calcularFifo(despues.operaciones);
const hoy = new Date().toISOString().slice(0, 10);
const r = calcularResumen(posiciones, despues.operaciones, realizadas, hoy);

console.log(`\n=== LA CARTERA DESPUÉS (${desdeCero ? "desde cero" : "sobre lo que ya hay"}) ===`);
console.log(`  patrimonio ${r.valor.toFixed(2)} €   inversión ${r.valorInv.toFixed(2)}   liquidez ${r.liquidez.toFixed(2)}`);
console.log(`  aportado   ${r.aportado.toFixed(2)} €   ganancia  ${r.ganancia.toFixed(2)} (${(r.gananciaPct ?? 0).toFixed(1)}%)`);
console.log(`  ${puestas} posiciones puestas al día · ${m} operaciones insertadas`);

// Sólo la cuenta que se acaba de importar: es la que se cuadra con el banco.
// Los activos que salen de una POSICIÓN cuentan aunque no tengan ni una
// operación: dos de los seis fondos de esta cartera se compraron antes de la
// ventana del Excel y no aparecen en ningún movimiento.
const suyos = new Set(
  despues.operaciones.filter((o) => o.account_id === cuentaId && o.asset_id).map((o) => o.asset_id),
);
for (const p of plan.posiciones) {
  suyos.add(p.activo?.id ?? `posicion-${p.posicion.isin}`);
}
const delBroker = posiciones.filter(
  (p) => suyos.has(p.activo.id) || p.activo.name === plan.efectivo?.activo.name,
);
if (delBroker.length) {
  console.log(`\n-- ${junto.broker || "la cuenta"} --`);
  let total = 0;
  for (const p of delBroker) {
    total += p.valor ?? 0;
    console.log(
      `  ${p.activo.name.slice(0, 30).padEnd(31)} ${p.qty.toFixed(4).padStart(12)} × ` +
        `${(p.precio ?? 0).toFixed(2).padStart(9)} = ${(p.valor ?? 0).toFixed(2).padStart(9)} €` +
        `   coste ${p.coste.toFixed(2).padStart(9)}   [${p.estado}]`,
    );
  }
  console.log(`  ${"TOTAL".padEnd(31)} ${total.toFixed(2).padStart(37)} €`);
  if (isFinite(cuadra)) {
    const d = total - cuadra;
    console.log(`  ${"el banco dice".padEnd(31)} ${cuadra.toFixed(2).padStart(37)} €`);
    console.log(
      `  ${"diferencia".padEnd(31)} ${d.toFixed(2).padStart(37)} €  ` +
        (Math.abs(d) <= 1 + 0.02 * total
          ? "(dentro del ruido del cambio de divisa del día)"
          : "⚠ NO CUADRA"),
    );
  }
}

console.log("\nNo se ha escrito nada.");
