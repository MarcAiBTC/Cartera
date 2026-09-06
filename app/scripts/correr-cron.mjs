// Ejecuta en local una de las rutas de cron, con las variables de app/.env.
// Sirve para no tener que esperar a que Vercel la dispare —son diarias— y
// para ver el detalle de los fallos, que en produccion solo van al log.
//
//   npx vite-node scripts/correr-cron.mjs precios
//   npx vite-node scripts/correr-cron.mjs catalogo
//   npx vite-node scripts/correr-cron.mjs benchmark

const cual = process.argv[2];
const rutas = {
  precios: () => import("../api/precios.ts"),
  catalogo: () => import("../api/catalogo.ts"),
  benchmark: () => import("../api/benchmark.ts"),
};
if (!rutas[cual]) {
  console.error(`uso: npx vite-node scripts/correr-cron.mjs <${Object.keys(rutas).join("|")}>`);
  process.exit(1);
}

// `autorizada()` deja pasar cuando no hay secreto configurado; aqui se quita
// para no tener que firmar la peticion en local.
delete process.env.CRON_SECRET;
process.env.SUPABASE_URL ??= process.env.VITE_SUPABASE_URL;

const { default: handler } = await rutas[cual]();
const t0 = Date.now();
const r = await handler(new Request(`http://local/api/${cual}`));
const cuerpo = await r.text();
console.log(`HTTP ${r.status}  ·  ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log(cuerpo.length > 4000 ? cuerpo.slice(0, 4000) + "\n…" : cuerpo);
