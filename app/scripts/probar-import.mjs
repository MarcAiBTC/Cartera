// Sonda de desarrollo: pasa un extracto REAL por el importador y enseña qué
// saldría, sin escribir nada en ninguna parte. Es la unica forma de arreglar
// un adaptador — el formato que documenta el broker y el que exporta no
// siempre son el mismo.
//
//   npx vite-node scripts/probar-import.mjs <archivo>

import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import { tabular } from "../src/lib/import/csv.ts";
import { leerPdf } from "../src/lib/import/pdf.ts";
import { desdeMatriz, detectar, leer } from "../src/lib/import/index.ts";

const ruta = process.argv[2];
if (!ruta) {
  console.error("uso: npx vite-node scripts/probar-import.mjs <archivo.csv|.xlsx|.pdf> [formato]");
  process.exit(1);
}

// El Excel se lee igual que en la app: la hoja tal cual, en filas de celdas,
// que es lo que deja saltarse el titular y el saldo de encima de la tabla.
const entrada = /\.pdf$/i.test(ruta)
  ? { nombre: ruta, pdf: await leerPdf(readFileSync(ruta)) }
  : /\.(xlsx|xls|xlsm|ods)$/i.test(ruta)
  ? (() => {
      // `readFile` no llega al disco desde el build ESM: se le da el búfer.
      const libro = XLSX.read(readFileSync(ruta), { type: "buffer", cellDates: true });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      return {
        nombre: ruta,
        tabla: desdeMatriz(XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "" })),
      };
    })()
  : (() => {
      const txt = readFileSync(ruta, "utf8");
      return { nombre: ruta, texto: txt, tabla: tabular(txt) };
    })();

if (entrada.pdf) {
  console.log("filas de texto en el PDF:", entrada.pdf.length);
} else {
  console.log("cabeceras:", entrada.tabla.cabeceras.join(" | "));
  console.log("filas en el archivo:", entrada.tabla.filas.length);
}
console.log("formato detectado:", detectar(entrada));

const l = leer(entrada, process.argv[3] ? { formato: process.argv[3] } : {});
console.log("\noperaciones:", l.filas.length, " descartes:", l.descartes.length);

if (l.saldo != null) console.log("saldo que declara el archivo:", l.saldo.toFixed(2), "EUR");
if (l.posiciones?.length) {
  console.log("\n-- posiciones --");
  let total = 0;
  for (const p of l.posiciones) {
    total += p.valor;
    console.log(
      `  ${p.isin}  ${p.nombre.padEnd(30)} ${p.divisa}  ` +
        `${p.titulos.toFixed(5).padStart(12)} tit  ${p.valor.toFixed(2).padStart(10)}  ` +
        `(${(p.valor / p.titulos).toFixed(4)} por título)`,
    );
  }
  console.log(`  ${"".padEnd(12)} ${"suma".padEnd(30)}      ${total.toFixed(2).padStart(25)}`);
}

const por = new Map();
for (const f of l.filas) por.set(f.tipo, (por.get(f.tipo) ?? 0) + 1);
console.log("\n-- por tipo --");
for (const [k, v] of [...por].sort()) console.log(`  ${String(v).padStart(4)}  ${k}`);

console.log("\n-- activos que se crearian --");
// Los mismos que crearia `planificar`: solo lo que toca un valor, y con el
// nombre como ultimo recurso cuando el archivo no trae ni ISIN ni ticker.
const TOCA_UN_VALOR = new Set(["buy", "sell", "dividend"]);
const act = new Map();
for (const f of l.filas) {
  if (!TOCA_UN_VALOR.has(f.tipo)) continue;
  const k = (f.isin || f.ticker || f.nombre || "").toUpperCase();
  if (!k) continue;
  const a = act.get(k) ?? { ...f, ops: 0, titulos: 0, euros: 0, sinTitulos: 0 };
  a.ops += 1;
  a.euros += f.total;
  if (f.cantidad != null) a.titulos += f.cantidad;
  else a.sinTitulos += 1;
  act.set(k, a);
}
console.log("total:", act.size);
for (const [, a] of act)
  console.log(
    `  ${(a.nombre ?? "").padEnd(31)} isin=${(a.isin ?? "-").padEnd(13)} ` +
      `${String(a.ops).padStart(3)} ops  ${a.euros.toFixed(2).padStart(9)} EUR  ` +
      `${a.titulos.toFixed(4).padStart(12)} tit` +
      (a.sinTitulos ? `  (${a.sinTitulos} SIN titulos)` : ""),
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
