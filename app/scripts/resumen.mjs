// Calcula la cartera con el MISMO motor que la app y enseña las cifras, para
// poder cuadrarlas contra el broker sin abrir el navegador.
//
//   npx vite-node scripts/resumen.mjs --correo tu@correo

import { createClient } from "@supabase/supabase-js";
import { calcularPosiciones, calcularFifo, calcularResumen } from "../src/lib/cartera.ts";

const i = process.argv.indexOf("--correo");
const correo = i >= 0 ? process.argv[i + 1] : undefined;
const db = createClient(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: lista } = await db.auth.admin.listUsers();
const u = lista.users.find((x) => x.email?.toLowerCase() === correo?.toLowerCase());
if (!u) {
  console.error(`No hay ninguna cuenta con el correo ${correo}.`);
  process.exit(1);
}

const mio = (t) => db.from(t).select("*").eq("user_id", u.id);
const [cuentas, activos, operaciones] = await Promise.all([mio("accounts"), mio("assets"), mio("operations")]);
const [{ data: pr }, { data: fxf }] = await Promise.all([
  db.from("prices").select("*"),
  db.from("fx").select("*"),
]);

const precios = Object.fromEntries((pr ?? []).map((p) => [p.symbol.toUpperCase(), p]));
const fx = Object.fromEntries((fxf ?? []).map((f) => [f.currency ?? f.code, f.eur_rate ?? f.rate]));

const estado = {
  cuentas: cuentas.data ?? [],
  activos: activos.data ?? [],
  operaciones: operaciones.data ?? [],
  snapshots: [], seguimiento: [], objetivos: [], cashflow: {}, ajustes: {},
};

const hoy = new Date().toISOString().slice(0, 10);
const posiciones = calcularPosiciones(estado, precios, fx);
const { realizadas } = calcularFifo(estado.operaciones);
const resumen = calcularResumen(posiciones, estado.operaciones, realizadas, hoy);
const r = { posiciones, realizadas, resumen };
const e = (n) => (n == null ? "-" : Number(n).toFixed(2).padStart(12));

console.log(`\nOperaciones: ${estado.operaciones.length}   Activos: ${estado.activos.length}`);
const f = estado.operaciones.map((o) => o.date).sort();
console.log(`Desde ${f[0]} hasta ${f.at(-1)}\n`);

console.log("── RESUMEN ──");
for (const [k, v] of Object.entries(r.resumen ?? {})) {
  if (typeof v === "number") console.log(`  ${k.padEnd(22)} ${e(v)}`);
}

console.log("\n── POSICIONES ABIERTAS ──");
const abiertas = (r.posiciones ?? []).filter((p) => (p.qty ?? 0) > 1e-9);
for (const p of abiertas) {
  const nom = (p.activo?.name ?? "").slice(0, 22).padEnd(24);
  console.log(
    `  ${nom} ${String(p.activo?.cat).padEnd(8)} qty=${String(Number(p.qty).toFixed(6)).padStart(14)}` +
      `  valor=${e(p.valor)}  coste=${e(p.coste)}${p.valor == null ? "   SIN PRECIO" : ""}`,
  );
}
console.log(`  (${abiertas.length} abiertas de ${r.posiciones?.length ?? 0})`);

console.log("\n── REALIZADAS ──");
const rz = r.realizadas ?? [];
const total = rz.reduce((s, x) => s + (x.ganancia ?? x.plusvalia ?? 0), 0);
console.log(`  ventas: ${rz.length}   ganancia realizada total: ${e(total)}`);
