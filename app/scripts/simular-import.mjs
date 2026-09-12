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

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { combinar, detectar, leer, leerArchivo, planificar } from "../src/lib/import/index.ts";
import { simular } from "../src/lib/import/simular.ts";
import { calcularCartera } from "../src/lib/cartera.ts";

const args = process.argv.slice(2);
const bandera = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const desdeCero = args.includes("--cero");
const cuadra = Number(bandera("cuadra"));
const correo = bandera("correo");
// Sólo estas banderas se comen el argumento siguiente. Descartar el de después
// de CUALQUIER `--` se tragaba el archivo cuando venía detrás de `--cero`.
const CON_VALOR = new Set(["--cuadra", "--correo", "--valor", "--mismo", "--saldo", "--extra", "--volcar", "--titulos"]);
const rutas = args.filter((a, i) => !a.startsWith("--") && !CON_VALOR.has(args[i - 1]));

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
// --valor "FIDELITY PHYSICAL BITCOIN ET=180" para lo que ningún archivo sabe:
// los ETC y los ETF viven en la cuenta de valores, que el extracto de posición
// no cubre, y sus compras vienen sin participaciones.
const valores = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== "--valor") continue;
  const [clave, v] = (args[i + 1] ?? "").split("=");
  if (clave && v != null) valores[clave.toUpperCase()] = Number(v);
}

// --mismo "VANGUARD US 500 STOCK EUR=VANGUARD US 500 STOCK INDEX EU" cuando el
// mismo fondo llega con dos nombres: MyInvestor cambió el rótulo y el concepto
// viene cortado a 30 caracteres. Sin ISIN no se puede adivinar, así que lo dice
// una persona —en la pantalla, un desplegable; aquí, esta bandera—.
const mismos = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== "--mismo") continue;
  const [de, a] = (args[i + 1] ?? "").split("=");
  if (de && a) mismos[de.toUpperCase()] = a.toUpperCase();
}

// --saldo 218.32: el dinero sin invertir, que la pantalla pregunta. Un archivo
// de órdenes de fondos no dice nada del dinero parado.
const saldo = bandera("saldo") != null ? Number(bandera("saldo")) : undefined;

// --extra "Oro ETC=180" para lo que no está en ningún archivo, como en la
// pantalla la línea «Añadir algo que no esté aquí».
const extras = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] !== "--extra") continue;
  const [nombre, v] = (args[i + 1] ?? "").split("=");
  if (nombre && v != null) extras.push({ nombre, valor: Number(v) });
}

// --titulos "FIDELITY PHYSICAL BITCOIN ET=0.0321": lo que dice el banco que
// tienes de algo cuyos títulos se calculan con el cierre de cada día.
const titulos = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== "--titulos") continue;
  const [clave, v] = (args[i + 1] ?? "").split("=");
  if (clave && v != null) titulos[clave.toUpperCase()] = Number(v);
}

let cierres = {};
const planear = () =>
  planificar(junto, {
    estado,
    fx,
    catalogo,
    precios: porSimbolo,
    cuentaId: cuenta?.id,
    valores,
    mismos,
    saldo,
    extras,
    cierres,
    titulos,
  });
let plan = planear();

// Lo que el plan no sabe calcular sin el cierre de un día —los títulos de un
// ETC de MyInvestor, los euros del oro de Revolut—: se pide como lo pide la
// pantalla, y se vuelve a planear.
if (plan.faltanCierres.length) {
  const { cierresDe } = await import("../api/_lib/series.ts");
  const simbolos = plan.faltanCierres.map((f) => f.simbolo);
  const desde = plan.faltanCierres.map((f) => f.desde).sort()[0];
  const r = await cierresDe(db, simbolos, desde);
  cierres = Object.fromEntries(simbolos.map((s) => [s, r.series[s] ?? []]));
  console.log(
    `cierres desde ${desde}: ${simbolos
      .map((s) => `${s} ${cierres[s].length} días (desde ${cierres[s][0]?.[0] ?? "—"})`)
      .join(" · ")}` +
      (r.fallos.length ? ` · fallos: ${r.fallos.join(", ")}` : ""),
  );
  plan = planear();
}

console.log(
  `plan: ${plan.nuevas.length} nuevas · ${plan.corregidas.length} se corrigen · ` +
    `${plan.duplicadas.length} ya estaban · ${plan.activosNuevos.length} activos por crear · ` +
    `${plan.renombrar.length} se renombran · ${plan.descartes.length} avisos`,
);

if (plan.corregidas.length) {
  const por = {};
  for (const p of plan.corregidas) {
    for (const k of Object.keys(p.cambios ?? {})) {
      const antes = p.corrige[k];
      const ahora = p.cambios[k];
      if (antes === ahora || ["import_hash", "source_format", "notes", "price", "total"].includes(k)) continue;
      por[k] = (por[k] ?? 0) + 1;
    }
    if (p.corrige.account_id == null) por.cuenta = (por.cuenta ?? 0) + 1;
  }
  console.log(`  qué se corrige: ${Object.entries(por).map(([k, v]) => `${k} ×${v}`).join(" · ")}`);
}
for (const r of plan.renombrar) {
  console.log(
    `  renombra ${r.activo.name} → ${Object.entries(r.campos).map(([k, v]) => `${k}=${v}`).join(" ")}`,
  );
}
const traspasos = plan.planeadas.filter((p) => p.fila.tipo === "sell" && p.fila.traspasoInterno);
if (traspasos.length) {
  console.log(`\n-- ${traspasos.length} traspasos entre fondos --`);
  for (const p of traspasos) {
    console.log(
      `  ${p.fila.fecha}  ${plan.nombres[p.fila.isin] ?? p.fila.isin}  ${p.fila.total.toFixed(2)} ${p.fila.divisa}  ${p.fila.nota}`,
    );
  }
}

if (plan.activosNuevos.length) {
  console.log("\n-- activos por crear --");
  for (const { clave, activo } of plan.porCrear) {
    const otros = Object.keys(plan.mismos).filter((k) => plan.mismos[k] === clave);
    console.log(
      `  ${(activo.name ?? clave).padEnd(34)} ${(activo.isin ?? activo.ticker ?? "sin ISIN").padEnd(14)}` +
        (otros.length ? `  +une ${otros.join(", ")}` : ""),
    );
  }
  console.log(`     usa --mismo "UN NOMBRE=OTRO NOMBRE" si dos son el mismo fondo`);
}

if (plan.posiciones.length) {
  console.log(`\n-- posiciones (el extracto cuadra su total: ${plan.extractoCuadra ? "sí" : "NO"}) --`);
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

if (plan.sinCubrir.length) {
  console.log("\n-- el extracto no los cubre: hay que decir cuánto valen --");
  for (const c of plan.sinCubrir) {
    console.log(
      `  ${c.nombre.padEnd(32)} ${String(c.ops).padStart(2)} compras  ` +
        `costaron ${c.euros.toFixed(2).padStart(8)} €  ` +
        (c.titulos != null ? `${c.titulos} títulos  ` : "títulos: se desconocen  ") +
        (c.valor != null ? `→ vale ${c.valor.toFixed(2)} €` : "→ SIN VALOR: entra a cero"),
    );
  }
  console.log(`     usa --valor "NOMBRE=123.45" para decir lo que vale cada uno`);
}

if (plan.estimados.length) {
  console.log("\n-- títulos calculados con el cierre de cada día --");
  for (const e of plan.estimados) {
    console.log(
      `  ${e.nombre.padEnd(34)} ${String(e.ops).padStart(2)} órdenes calculadas · ` +
        `${e.titulos.toFixed(6)} títulos` +
        (e.declarados != null ? "  (reescalados a lo que dice el banco)" : ""),
    );
  }
  console.log(`     usa --titulos "NOMBRE=1.234" con lo que diga el banco`);
}

if (plan.descartes.length) {
  console.log("\n-- avisos --");
  for (const d of plan.descartes) console.log(`  linea ${d.linea}: ${d.motivo}`);
}

// ── Aplicar el plan en memoria: lo mismo que `confirmar()` ───────────────
// Con la MISMA función que usa la pantalla para enseñar cómo queda la cuenta.

const { estado: despues, delBroker: suyos } = simular(plan, estado, cuenta?.id);

// --volcar cartera.json: la cartera resultante, tal cual la guarda el modo
// «sólo en este dispositivo» (`cartera:local`), para mirar las pantallas con
// estos datos sin tocar la base.
if (bandera("volcar")) {
  writeFileSync(bandera("volcar"), JSON.stringify(despues));
  console.log(`cartera volcada en ${bandera("volcar")}`);
}
const puestas = plan.posiciones.filter((p) => !p.aldia).length;
const m = plan.nuevas.length;

// ── La cartera que saldría ───────────────────────────────────────────────

const hoy = new Date().toISOString().slice(0, 10);
const { posiciones, resumen: r } = calcularCartera(despues, porSimbolo, fx, hoy);

console.log(`\n=== LA CARTERA DESPUÉS (${desdeCero ? "desde cero" : "sobre lo que ya hay"}) ===`);
console.log(`  patrimonio ${r.valor.toFixed(2)} €   inversión ${r.valorInv.toFixed(2)}   liquidez ${r.liquidez.toFixed(2)}`);
console.log(`  aportado   ${r.aportado.toFixed(2)} €   ganancia  ${r.ganancia.toFixed(2)} (${(r.gananciaPct ?? 0).toFixed(1)}%)`);
console.log(`  ${puestas} posiciones puestas al día · ${m} operaciones insertadas`);

// Sólo la cuenta que se acaba de importar: es la que se cuadra con el banco.
// Los activos que salen de una POSICIÓN cuentan aunque no tengan ni una
// operación: dos de los seis fondos de esta cartera se compraron antes de la
// ventana del Excel y no aparecen en ningún movimiento.
const delBroker = posiciones.filter((p) => suyos.has(p.activo.id) && Math.abs(p.qty) > 1e-9);
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
