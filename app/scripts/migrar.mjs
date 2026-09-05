// ── MIGRACIÓN ────────────────────────────────────────────────────────────
// Sube a Supabase la cartera de la app anterior. Se ejecuta una vez por
// persona: una para Marc y otra para Leti, cada una con su cuenta.
//
//   node scripts/migrar.mjs ../../Cartera_Marc_2026-08-10.json --email tu@correo --clave ***
//   node scripts/migrar.mjs cartera.json --email … --clave … --seco   ← sólo mirar
//
// Entra con el correo y la contraseña del usuario, NO con la clave de
// servicio: así las filas se escriben con su user_id y la RLS las protege
// desde el primer momento. Una migración hecha con la clave de servicio deja
// datos que luego nadie puede leer.
//
// LA DECISIÓN IMPORTANTE — por qué las posiciones entran como «manual»:
//
// En la app anterior la verdad era la POSICIÓN (cantidad y coste medio a
// mano), y las aportaciones, los cobros y los trades eran cuadernos aparte.
// Si aquí se metieran las dos cosas como fuente de verdad, cada compra
// contaría dos veces: una en la cantidad declarada y otra en el FIFO.
//
// Así que se respeta lo que ya era cierto: las posiciones entran con su saldo
// declarado (`mode: manual`) y el histórico entra como operaciones para que
// el Historial y la pantalla Fiscal tengan de dónde tirar. A partir de ahí,
// cada activo nuevo que llegue por importación sí funciona con FIFO.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ── Argumentos ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const bandera = (nombre) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? args[i + 1] : undefined;
};

// El primer argumento suelto que no sea el valor de una bandera.
const archivo = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
const email = bandera("email") ?? process.env.CARTERA_EMAIL;
const clave = bandera("clave") ?? process.env.CARTERA_CLAVE;
const seco = args.includes("--seco");

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

if (!archivo) {
  console.error("Falta el archivo. Uso: node scripts/migrar.mjs <export.json> --email … --clave …");
  process.exit(1);
}
if (!seco && (!URL || !ANON || !email || !clave)) {
  console.error(
    "Faltan credenciales. Necesito SUPABASE_URL y SUPABASE_ANON_KEY en el entorno,\n" +
      "y --email y --clave de la cuenta. Con --seco se puede probar sin nada de esto.",
  );
  process.exit(1);
}

const viejo = JSON.parse(readFileSync(archivo, "utf8"));

// ── Traducción ───────────────────────────────────────────────────────────

const num = (v) => (v == null || !isFinite(Number(v)) ? null : Number(v));
const iso = (v) => {
  if (!v) return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

const assets = viejo.assets ?? [];
const aports = viejo.aports ?? [];
const rendim = viejo.rendim ?? [];
const trades = viejo.trades ?? [];
const snaps = viejo.snaps ?? [];
const wl = viejo.wl ?? [];
const targets = viejo.targets ?? {};
const tgFuera = viejo.tgFuera ?? [];
const tgExtra = viejo.tgExtra ?? {};

// Cuentas: una por bróker distinto.
const brokers = [...new Set(assets.map((a) => a.broker).filter(Boolean))];
const cuentas = brokers.map((b) => ({ name: b, broker: b, currency: "EUR" }));

// Activos. `viejoId` no se sube: sólo sirve para volver a atar las
// operaciones a su activo una vez Supabase haya dado los ids de verdad.
const activos = assets.map((a) => ({
  viejoId: a.id,
  fila: {
    name: a.name,
    ticker: a.ticker || null,
    isin: a.isin || null,
    cat: a.cat || "accion",
    unit: a.unit || "títulos",
    currency: (a.ccy || "EUR").toUpperCase(),
    underlying: a.underlying || null,
    mode: "manual",
    manual_qty: num(a.qty),
    // En liquidez el coste ES el saldo. Se fuerza a 1 aunque el dato viejo
    // trajera un 0, que es exactamente el fallo que inflaba la ganancia.
    manual_cost_unit: a.cat === "liquidez" ? 1 : num(a.costUnit),
    manual_price: a.cat === "liquidez" ? 1 : num(a.mp),
    archived: false,
  },
}));

// Los trades cerrados no tienen activo en la cartera: se les crea uno
// archivado para que la venta tenga de qué colgar y la pantalla Fiscal pueda
// contarla.
const nombresTrade = [...new Set(trades.map((t) => t.name))];
for (const nombre of nombresTrade) {
  if (activos.some((a) => a.fila.name === nombre)) continue;
  const t = trades.find((x) => x.name === nombre);
  activos.push({
    viejoId: `trade:${nombre}`,
    fila: {
      name: nombre,
      ticker: null,
      isin: null,
      cat: t?.cat || "accion",
      unit: t?.unit || "títulos",
      currency: "EUR",
      underlying: null,
      mode: "operations",
      manual_qty: null,
      manual_cost_unit: null,
      manual_price: null,
      // Cerrado: no debe aparecer en la cartera de hoy.
      archived: true,
    },
  });
}

// Operaciones.
const operaciones = [];
const opear = (viejoId, fila) => operaciones.push({ viejoId, fila });

for (const a of aports) {
  const fecha = iso(a.date);
  if (!fecha) continue;
  opear(a.assetId, {
    type: "buy",
    date: fecha,
    quantity: num(a.qty),
    price: num(a.price),
    total: Math.abs(num(a.eur) ?? 0),
    fees: 0,
    currency: "EUR",
    total_eur: Math.abs(num(a.eur) ?? 0),
    source: "manual",
    notes: "migrado",
  });
}

for (const r of rendim) {
  const fecha = iso(r.date);
  if (!fecha) continue;
  opear(r.assetId, {
    // «interes» en la app vieja era el interés de la cuenta remunerada.
    type: r.kind === "interes" ? "interest" : "dividend",
    date: fecha,
    quantity: null,
    price: null,
    total: Math.abs(num(r.eur) ?? 0),
    fees: 0,
    currency: "EUR",
    total_eur: Math.abs(num(r.eur) ?? 0),
    source: "manual",
    notes: "migrado",
  });
}

// Cada trade cerrado se parte en su compra y su venta, con sus fechas: es lo
// que permite que el FIFO reconstruya la plusvalía por ejercicio.
for (const t of trades) {
  const clave = `trade:${t.name}`;
  const entrada = iso(t.dateIn);
  const salida = iso(t.dateOut);
  const qty = num(t.qty) ?? 0;
  if (entrada) {
    opear(clave, {
      type: "buy",
      date: entrada,
      quantity: qty,
      price: num(t.priceIn),
      total: Math.abs(num(t.invested) ?? 0),
      fees: 0,
      currency: "EUR",
      total_eur: Math.abs(num(t.invested) ?? 0),
      source: "manual",
      notes: t.notes || "migrado",
    });
  }
  if (salida) {
    opear(clave, {
      type: "sell",
      date: salida,
      quantity: qty,
      price: num(t.priceOut),
      total: Math.abs(num(t.recovered) ?? 0),
      fees: 0,
      currency: "EUR",
      total_eur: Math.abs(num(t.recovered) ?? 0),
      source: "manual",
      notes: t.notes || "migrado",
    });
  }
}

// Fotos del patrimonio. `ts` era una marca de tiempo en milisegundos.
const fotos = [];
const vistas = new Set();
for (const s of snaps) {
  const fecha = iso(s.ts ?? s.date);
  if (!fecha || vistas.has(fecha)) continue; // una por día: la última manda
  vistas.add(fecha);
  fotos.push({
    date: fecha,
    val: num(s.val) ?? 0,
    cost: num(s.cost) ?? 0,
    cost_inv: num(s.costInv),
    liq: num(s.liq),
    auto: Boolean(s.auto),
  });
}

const seguimiento = wl.map((w) => ({
  ticker: (w.ticker || w.name || "").toUpperCase(),
  name: w.name || null,
  note: w.notes || null,
  target_price: num(w.target),
})).filter((w) => w.ticker);

const objetivos = Object.entries(targets).map(([key, weight]) => ({
  key,
  weight: num(weight) ?? 0,
  extra: Object.prototype.hasOwnProperty.call(tgExtra, key),
  excluded: tgFuera.includes(key),
}));

// ── Resumen ──────────────────────────────────────────────────────────────

const costeDeclarado = activos
  .filter((a) => !a.fila.archived)
  .reduce((s, a) => s + (a.fila.manual_qty ?? 0) * (a.fila.manual_cost_unit ?? 0), 0);
const realizado = trades.reduce((s, t) => s + (num(t.result) ?? 0), 0);
const cobrado = rendim.reduce((s, r) => s + (num(r.eur) ?? 0), 0);

console.log(`\nArchivo: ${archivo}`);
console.log(`  cuentas        ${cuentas.length}`);
console.log(`  activos        ${activos.length} (${activos.filter((a) => a.fila.archived).length} cerrados)`);
console.log(`  operaciones    ${operaciones.length}`);
console.log(`  fotos          ${fotos.length}`);
console.log(`  seguimiento    ${seguimiento.length}`);
console.log(`  objetivos      ${objetivos.length}`);
console.log(`\nPara cuadrar con la app anterior:`);
console.log(`  coste declarado   ${costeDeclarado.toFixed(2)} €`);
console.log(`  realizado         ${realizado.toFixed(2)} €`);
console.log(`  cobrado           ${cobrado.toFixed(2)} €`);
console.log(`  aportado          ${(costeDeclarado - realizado - cobrado).toFixed(2)} €`);
console.log(`  (aportado = coste − realizado − cobrado)\n`);

if (seco) {
  console.log("Modo seco: no se ha escrito nada.");
  process.exit(0);
}

// ── Subida ───────────────────────────────────────────────────────────────

const sb = createClient(URL, ANON, { auth: { persistSession: false } });

const { data: sesion, error: errorLogin } = await sb.auth.signInWithPassword({
  email,
  password: clave,
});
if (errorLogin) {
  console.error(`No se ha podido entrar: ${errorLogin.message}`);
  process.exit(1);
}
console.log(`Entrando como ${sesion.user.email}`);

const meter = async (tabla, filas) => {
  if (filas.length === 0) return [];
  const salida = [];
  for (let i = 0; i < filas.length; i += 200) {
    const { data, error } = await sb.from(tabla).insert(filas.slice(i, i + 200)).select();
    if (error) throw new Error(`${tabla}: ${error.message}`);
    salida.push(...(data ?? []));
  }
  console.log(`  ${tabla}: ${salida.length}`);
  return salida;
};

try {
  const cuentasCreadas = await meter("accounts", cuentas);
  const porBroker = new Map(cuentasCreadas.map((c) => [c.broker, c.id]));

  const activosCreados = await meter("assets", activos.map((a) => a.fila));
  // El orden de vuelta de un insert es el de entrada, así que las dos listas
  // casan posición a posición.
  const idNuevo = new Map();
  activos.forEach((a, i) => idNuevo.set(String(a.viejoId), activosCreados[i]?.id));

  // La cuenta de cada activo se asigna después, ya con los dos ids.
  for (let i = 0; i < activos.length; i++) {
    const broker = assets.find((a) => a.id === activos[i].viejoId)?.broker;
    const cuenta = broker ? porBroker.get(broker) : undefined;
    if (!cuenta) continue;
    activosCreados[i].cuenta = cuenta;
  }

  await meter(
    "operations",
    operaciones
      .map((o) => {
        const asset_id = idNuevo.get(String(o.viejoId));
        if (!asset_id) return null;
        const i = activosCreados.findIndex((a) => a.id === asset_id);
        return { ...o.fila, asset_id, account_id: activosCreados[i]?.cuenta ?? null };
      })
      .filter(Boolean),
  );

  await meter("snapshots", fotos);
  await meter("watchlist", seguimiento);
  await meter("targets", objetivos);

  if (viejo.cashflow && Object.keys(viejo.cashflow).length > 0) {
    const { error } = await sb.from("cashflow").upsert({ data: viejo.cashflow });
    if (error) throw new Error(`cashflow: ${error.message}`);
    console.log("  cashflow: 1");
  }

  const { error: errAjustes } = await sb.from("settings").upsert({
    tg_base: viejo.tgBase ?? "total",
    tg_aporte: num(viejo.tgAporte) ?? 500,
    band_mode: viejo.bandMode ?? "cat",
    expo_base: viejo.expoBase ?? "total",
  });
  if (errAjustes) throw new Error(`settings: ${errAjustes.message}`);
  console.log("  settings: 1");

  console.log("\nMigración terminada. Abre la app y comprueba que el patrimonio, el coste,");
  console.log("el aportado y la ganancia coinciden con la app anterior ANTES de dar por buena");
  console.log("la migración. Si algo no cuadra, borra las filas y vuelve a empezar.");
} catch (e) {
  console.error(`\nHa fallado la migración: ${e.message}`);
  console.error("No se ha deshecho lo ya escrito: revisa las tablas antes de reintentar.");
  process.exit(1);
}
