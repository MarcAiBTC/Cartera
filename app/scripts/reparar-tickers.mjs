// Rellena el `ticker` de los activos que se guardaron sólo con el ISIN.
//
// Un valor importado de un bróker europeo llega identificado por su ISIN. Si
// en el momento de importar el catálogo no estaba cargado —pasaba cuando los
// precios de Supabase iban atrasados y la app tiraba del feed, que no trae
// catálogo— el activo se guardaba sin `ticker` y se quedaba sin cotización
// para siempre. Esto lo arregla mirando el ISIN en el catálogo.
//
//   npx vite-node scripts/reparar-tickers.mjs            (enseña qué haría)
//   npx vite-node scripts/reparar-tickers.mjs --escribir (lo hace)

import { createClient } from "@supabase/supabase-js";

const escribir = process.argv.includes("--escribir");
const db = createClient(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const [{ data: activos, error: e1 }, { data: catalogo, error: e2 }] = await Promise.all([
  db.from("assets").select("id,user_id,name,isin,ticker,cat,currency").is("ticker", null),
  db.from("catalog").select("*"),
]);
if (e1 || e2) {
  console.error("No se ha podido leer:", (e1 ?? e2).message);
  process.exit(1);
}

const porIsin = new Map();
for (const c of catalogo ?? []) if (c.isin) porIsin.set(c.isin.toUpperCase(), c);

const arreglables = [];
const huerfanos = [];
for (const a of activos ?? []) {
  if (!a.isin) continue;
  const c = porIsin.get(a.isin.toUpperCase());
  const simbolo = c?.yahoo ?? c?.symbol ?? c?.ticker ?? null;
  if (simbolo) arreglables.push({ a, c, simbolo });
  else huerfanos.push(a);
}

console.log(`activos sin ticker: ${(activos ?? []).length}`);
console.log(`  con ISIN que el catálogo traduce: ${arreglables.length}`);
console.log(`  con ISIN que nadie sabe traducir: ${huerfanos.length}\n`);

for (const { a, c, simbolo } of arreglables) {
  console.log(`  ${(a.name ?? "").padEnd(24)} ${a.isin}  →  ${simbolo}`);
}
if (huerfanos.length) {
  console.log("\n  sin traducción posible (habrá que ponerles el precio a mano):");
  for (const a of huerfanos) console.log(`  ${(a.name ?? "").padEnd(24)} ${a.isin}`);
}

if (!escribir) {
  console.log("\nEnsayo. Añade --escribir para guardarlo de verdad.");
  process.exit(0);
}

let hechos = 0;
for (const { a, c, simbolo } of arreglables) {
  // Sólo se toca lo que está vacío: si el usuario ya puso una categoría o una
  // divisa a mano, manda la suya.
  const cambio = { ticker: simbolo };
  if (!a.cat && c.cat) cambio.cat = c.cat;
  if (!a.currency && c.currency) cambio.currency = c.currency;
  const { error } = await db.from("assets").update(cambio).eq("id", a.id);
  if (error) console.error(`  ✗ ${a.name}: ${error.message}`);
  else hechos++;
}
console.log(`\nArreglados ${hechos} de ${arreglables.length}.`);
