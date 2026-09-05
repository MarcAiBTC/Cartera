// ── SEMBRAR EL CATÁLOGO ──────────────────────────────────────────────────
// Sube a Supabase los símbolos que la app anterior llevaba dentro: los ~519
// del catálogo embebido en `index.html` y los de `simbolos.json`, con su
// alias ISIN → símbolo de Yahoo.
//
// Ese alias es lo que hace que una compra importada de Trade Republic —que
// sólo trae el ISIN— encuentre su precio. Sin él, cada activo importado
// nacería sin cotización y habría que emparejarlo a mano.
//
// Se ejecuta UNA vez al montar el proyecto, y otra vez si algún día se
// regenera el catálogo. Usa la clave de servicio porque `catalog` es una
// tabla compartida que la RLS deja de sólo lectura para todos.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/sembrar-catalogo.mjs
//   node scripts/sembrar-catalogo.mjs --seco     ← sólo contar
//
// Las rutas por defecto apuntan al repositorio antiguo, que sigue estando al
// lado mientras dure la convivencia.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const seco = process.argv.includes("--seco");
// fileURLToPath y no .pathname: en Windows, .pathname devuelve «/C:/…» y
// concatenarlo da la ruta imposible «C:C:…».
const RAIZ = fileURLToPath(new URL("../../", import.meta.url));

// ── El catálogo embebido en el HTML ───────────────────────────────────────
// Se extrae con una expresión regular en vez de evaluando el archivo: es una
// app de 363 KB con efectos secundarios por todas partes, y aquí sólo hace
// falta una lista.

function leerCatalogoEmbebido() {
  const html = readFileSync(RAIZ + "index.html", "utf8");
  const desde = html.indexOf("const CATALOGO=[");
  if (desde < 0) return [];
  const hasta = html.indexOf("\n];", desde);
  const bloque = html.slice(desde, hasta);

  const filas = [];
  // {s:"MMM",n:"3M",c:"accion",u:"3M",un:"acc.",cy:"USD"}
  const re = /\{s:"([^"]+)",n:"([^"]*)",c:"([^"]*)"(?:,u:"([^"]*)")?(?:,un:"([^"]*)")?(?:,cy:"([^"]*)")?/g;
  let m;
  while ((m = re.exec(bloque)) != null) {
    const [, simbolo, nombre, cat, subyacente, , divisa] = m;
    filas.push({
      symbol: simbolo.toUpperCase(),
      name: nombre || null,
      isin: null,
      ticker: simbolo.split(".")[0].toUpperCase(),
      yahoo: simbolo,
      coingecko: null,
      currency: (divisa || "EUR").toUpperCase(),
      cat: cat || null,
      underlying: subyacente || null,
      retired: false,
    });
  }
  return filas;
}

// ── simbolos.json: lo que de verdad está en cartera ──────────────────────

function leerSimbolos() {
  let lista;
  try {
    lista = JSON.parse(readFileSync(RAIZ + "simbolos.json", "utf8"));
  } catch {
    return [];
  }
  return lista
    .filter((s) => s.sym || s.isin || s.ticker)
    .map((s) => ({
      symbol: String(s.sym || s.isin || s.ticker).toUpperCase(),
      name: s.nombre || null,
      isin: s.isin ? String(s.isin).toUpperCase() : null,
      ticker: s.ticker ? String(s.ticker).toUpperCase() : null,
      yahoo: s.cg ? null : s.sym || null,
      coingecko: s.cg || null,
      currency: null,
      cat: s.cg ? "cripto" : null,
      underlying: null,
      retired: false,
    }));
}

// ── Los alias del feed: ISIN y ticker → símbolo de Yahoo ─────────────────

function leerAlias() {
  let feed;
  try {
    feed = JSON.parse(readFileSync(RAIZ + "precios.json", "utf8"));
  } catch {
    return [];
  }
  return Object.entries(feed.alias ?? {}).map(([alias, sym]) => {
    const esIsin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(alias.toUpperCase());
    return {
      symbol: alias.toUpperCase(),
      name: null,
      isin: esIsin ? alias.toUpperCase() : null,
      ticker: esIsin ? null : alias.toUpperCase(),
      yahoo: String(sym),
      coingecko: null,
      currency: null,
      cat: null,
      underlying: null,
      retired: false,
    };
  });
}

// ── Fusión ───────────────────────────────────────────────────────────────
// El orden importa: lo que va después completa lo anterior sin borrarlo. Los
// alias del feed son los últimos porque son los que están verificados contra
// Yahoo de verdad.

const mapa = new Map();
const fundir = (filas) => {
  for (const f of filas) {
    const previo = mapa.get(f.symbol);
    if (!previo) {
      mapa.set(f.symbol, f);
      continue;
    }
    for (const [k, v] of Object.entries(f)) {
      if (v != null && v !== "" && (previo[k] == null || previo[k] === "")) previo[k] = v;
    }
    // El símbolo de Yahoo del feed sí pisa: es el comprobado.
    if (f.yahoo) previo.yahoo = f.yahoo;
  }
};

fundir(leerCatalogoEmbebido());
fundir(leerSimbolos());
fundir(leerAlias());

const filas = [...mapa.values()];
console.log(`Catálogo listo: ${filas.length} símbolos`);
console.log(`  con ISIN       ${filas.filter((f) => f.isin).length}`);
console.log(`  cripto         ${filas.filter((f) => f.coingecko).length}`);
console.log(`  sin Yahoo      ${filas.filter((f) => !f.yahoo && !f.coingecko).length}`);

if (seco) {
  console.log("\nModo seco: no se ha escrito nada.");
  console.log(filas.slice(0, 3));
  process.exit(0);
}

const URL_SB = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICIO = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_SB || !SERVICIO) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  process.exit(1);
}

const sb = createClient(URL_SB, SERVICIO, { auth: { persistSession: false } });

for (let i = 0; i < filas.length; i += 300) {
  const { error } = await sb
    .from("catalog")
    .upsert(filas.slice(i, i + 300), { onConflict: "symbol" });
  if (error) {
    console.error(`Ha fallado a partir de la fila ${i}: ${error.message}`);
    process.exit(1);
  }
  console.log(`  subidos ${Math.min(i + 300, filas.length)}/${filas.length}`);
}

console.log("\nCatálogo sembrado. El siguiente cron de precios ya cotizará estos símbolos.");
