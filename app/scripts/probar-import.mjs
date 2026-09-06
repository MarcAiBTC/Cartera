// Sonda de desarrollo: pasa un extracto REAL por el importador y enseña qué
// saldría, sin escribir nada en ninguna parte. Es la unica forma de arreglar
// un adaptador — el formato que documenta el broker y el que exporta no
// siempre son el mismo.
//
//   npx vite-node scripts/probar-import.mjs <archivo>

import { readFileSync } from "node:fs";
import { tabular } from "../src/lib/import/csv.ts";
import { detectar, leer } from "../src/lib/import/index.ts";

const ruta = process.argv[2];
if (!ruta) {
  console.error("uso: npx vite-node scripts/probar-import.mjs <archivo.csv>");
  process.exit(1);
}

const txt = readFileSync(ruta, "utf8");
const entrada = { nombre: ruta, texto: txt, tabla: tabular(txt) };
console.log("formato detectado:", detectar(entrada));
console.log("filas en el archivo:", entrada.tabla.filas.length);

const l = leer(entrada);
console.log("\noperaciones:", l.filas.length, " descartes:", l.descartes.length);

const por = new Map();
for (const f of l.filas) por.set(f.tipo, (por.get(f.tipo) ?? 0) + 1);
console.log("\n-- por tipo --");
for (const [k, v] of [...por].sort()) console.log(`  ${String(v).padStart(4)}  ${k}`);

console.log("\n-- activos que se crearian --");
const act = new Map();
for (const f of l.filas) {
  if (!f.isin && !f.ticker) continue;
  const k = f.isin || f.ticker;
  if (!act.has(k)) act.set(k, f);
}
console.log("total:", act.size);
for (const [, a] of act)
  console.log(
    `  ${(a.nombre ?? "").padEnd(24)} isin=${(a.isin ?? "-").padEnd(13)} tick=${(a.ticker ?? "-").padEnd(5)} ${a.categoria}`,
  );

console.log("\n-- descartes --");
for (const d of l.descartes) console.log(`  linea ${d.linea}: ${d.motivo}`);

const suma = (t) => l.filas.filter((f) => f.tipo === t).reduce((s, f) => s + f.total, 0);
console.log("\n-- dinero --");
for (const t of ["deposit", "withdrawal", "buy", "sell", "interest", "dividend", "fee"])
  console.log(`  ${t.padEnd(11)} ${suma(t).toFixed(2).padStart(10)} EUR`);
console.log(
  `  ${"comisiones".padEnd(11)} ${l.filas.reduce((s, f) => s + (f.comision ?? 0), 0).toFixed(2).padStart(10)} EUR`,
);
const fechas = l.filas.map((f) => f.fecha).sort();
console.log(`\n  desde ${fechas[0]} hasta ${fechas.at(-1)}`);
