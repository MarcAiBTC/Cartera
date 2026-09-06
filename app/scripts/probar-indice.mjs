import { createClient } from "@supabase/supabase-js";
import { contraIndice } from "../src/lib/cartera.ts";

const i = process.argv.indexOf("--correo");
const correo = process.argv[i + 1];
const db = createClient(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: l } = await db.auth.admin.listUsers();
const u = l.users.find((x) => x.email?.toLowerCase() === correo.toLowerCase());
const { data: ops } = await db.from("operations").select("*").eq("user_id", u.id);
const serie = [];
for (let d = 0; ; d += 1000) {
  const { data } = await db.from("benchmark").select("date,value").eq("symbol", "SP500_EUR").order("date").range(d, d + 999);
  if (!data?.length) break;
  serie.push(...data);
  if (data.length < 1000) break;
}

console.log(`serie del indice: ${serie.length} puntos, de ${serie[0].date} a ${serie.at(-1).date}`);
const c = contraIndice(ops, serie, 3071.91);
if (!c) { console.log("sin comparacion"); process.exit(0); }
const e = (n) => Number(n).toFixed(2).padStart(10);
console.log(`\n  desde              ${c.desde}`);
console.log(`  aportado neto     ${e(c.aportadoNeto)} EUR`);
console.log(`  tu cartera hoy    ${e(c.tuyo)} EUR   ${c.tuyoPct.toFixed(2)}%`);
console.log(`  el indice         ${e(c.indice)} EUR   ${c.indicePct.toFixed(2)}%`);
console.log(`  diferencia        ${e(c.diferencia)} EUR`);
