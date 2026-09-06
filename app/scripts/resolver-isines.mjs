// Traduce a simbolo de Yahoo los ISIN que se le pasen, y deja el alias
// guardado en el catalogo. Es el mismo codigo que /api/isin.
//
//   npx vite-node scripts/resolver-isines.mjs US0231351067 ES0140609019
//   npx vite-node scripts/resolver-isines.mjs --de-mis-activos --correo tu@correo

import { createClient } from "@supabase/supabase-js";
import { resolverIsines } from "../api/_lib/isin.ts";

const args = process.argv.slice(2);
const bandera = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const db = createClient(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

let isines = args.filter((a) => !a.startsWith("--") && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(a));

if (args.includes("--de-mis-activos")) {
  const correo = bandera("correo");
  const { data: lista } = await db.auth.admin.listUsers();
  const u = lista.users.find((x) => x.email?.toLowerCase() === correo?.toLowerCase());
  if (!u) {
    console.error(`No hay ninguna cuenta con el correo ${correo}.`);
    process.exit(1);
  }
  const { data } = await db.from("assets").select("isin").eq("user_id", u.id).not("isin", "is", null);
  isines = [...new Set([...isines, ...(data ?? []).map((a) => a.isin)])];
}

if (!isines.length) {
  console.error("No me has dado ningun ISIN.");
  process.exit(1);
}

console.log(`Resolviendo ${isines.length} ISIN...\n`);
const res = await resolverIsines(db, isines);
for (const r of res) {
  console.log(`  ${r.isin}  ->  ${(r.symbol ?? "SIN SIMBOLO").padEnd(16)} ${(r.name ?? "").slice(0, 34).padEnd(36)} [${r.origen}]`);
}
const ok = res.filter((r) => r.symbol).length;
console.log(`\nResueltos ${ok} de ${res.length}. Los nuevos quedan guardados en el catalogo.`);
