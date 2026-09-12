// ── LA CARTERA EN EL TIEMPO, SIN ABRIR LA APP ────────────────────────────
// Reconstruye con los datos de verdad lo que dibuja la pantalla Análisis: el
// patrimonio y el aportado semana a semana, la rentabilidad por tiempo y la
// comparación con el S&P 500. Llama a /api/historico en local, con una sesión
// real del usuario, y a las mismas funciones que la pantalla.
//
//   set -a && . ./.env && set +a && npx vite-node scripts/evolucion.mjs [--correo x@y]
//
// La sesión sale de un enlace mágico generado con la clave de servicio: no
// manda ningún correo. No escribe nada.

import { createClient } from "@supabase/supabase-js";
import { POST } from "../api/historico.ts";
import { cargarMercado } from "../src/lib/precios.ts";
import { calcularFifo, calcularPosiciones, calcularResumen } from "../src/lib/cartera.ts";
import { evolucion, frenteAlIndice, valorEn } from "../src/lib/evolucion.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--correo");
const correo = i >= 0 ? args[i + 1] : undefined;
process.env.SUPABASE_URL ??= process.env.VITE_SUPABASE_URL;

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: lista } = await admin.auth.admin.listUsers();
const usuario = correo
  ? lista.users.find((u) => u.email?.toLowerCase() === correo.toLowerCase())
  : lista.users[0];
if (!usuario) throw new Error("No hay ese usuario");

const { data: enlace, error: e1 } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: usuario.email,
});
if (e1) throw e1;
const anon = createClient(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const { data: s, error: e2 } = await anon.auth.verifyOtp({
  token_hash: enlace.properties.hashed_token,
  type: "magiclink",
});
if (e2) throw e2;

// ── La historia de precios, como la pide la pantalla ─────────────────────
const t0 = Date.now();
const r = await POST(
  new Request("http://local/api/historico", {
    method: "POST",
    headers: { authorization: `Bearer ${s.session.access_token}` },
  }),
);
const historico = await r.json();
console.log(
  `/api/historico: HTTP ${r.status} en ${((Date.now() - t0) / 1000).toFixed(1)} s · ` +
    `${Object.keys(historico.series ?? {}).length} series · S&P ${historico.sp500?.length ?? 0} días` +
    ` (${historico.sp500?.[0]?.[0]} → ${historico.sp500?.at(-1)?.[0]}) · fallos: ` +
    `${(historico.fallos ?? []).join(", ") || "ninguno"}`,
);

// ── La cartera de hoy, como la calcula la app ────────────────────────────
const mio = (t) => admin.from(t).select("*").eq("user_id", usuario.id);
const [cuentas, activos, operaciones] = await Promise.all([
  mio("accounts"),
  mio("assets"),
  mio("operations"),
]);
const estado = {
  cuentas: cuentas.data ?? [],
  activos: activos.data ?? [],
  operaciones: operaciones.data ?? [],
  snapshots: [],
  seguimiento: [],
  objetivos: [],
  cashflow: {},
  ajustes: {},
};
const mercado = await cargarMercado();
const posiciones = calcularPosiciones(estado, mercado.precios, mercado.fx);
const { realizadas } = calcularFifo(estado.operaciones);
const hoy = new Date().toISOString().slice(0, 10);
const resumen = calcularResumen(posiciones, estado.operaciones, realizadas, hoy);
console.log(
  `\nhoy: patrimonio ${resumen.valor.toFixed(2)} · aportado ${resumen.aportado.toFixed(2)} · ` +
    `ganancia ${resumen.ganancia.toFixed(2)} (${resumen.gananciaPct?.toFixed(2)} % sobre lo aportado)`,
);
console.log(`posiciones abiertas: ${posiciones.length} · activos guardados: ${estado.activos.length}`);

// ── La evolución ─────────────────────────────────────────────────────────
const puntos = evolucion(estado, historico, {
  fecha: hoy,
  valor: resumen.valor,
  aportado: resumen.aportado,
});
console.log(`\n-- evolución: ${puntos.length} puntos, uno de cada 8 --`);
puntos.forEach((p, k) => {
  if (k % 8 !== 0 && k < puntos.length - 2) return;
  console.log(
    `  ${p.fecha}  patrimonio ${p.valor.toFixed(0).padStart(6)}  aportado ${p.aportado
      .toFixed(0)
      .padStart(6)}  ganancia ${(p.valor - p.aportado).toFixed(0).padStart(5)}`,
  );
});

// Hoy, lo que salía de las operaciones frente a lo que dice el resumen. Si
// el valor y el aportado no se desvían lo mismo, la diferencia entra en la
// última semana como ganancia o pérdida que no ha ocurrido.
const rehecho = puntos.at(-1)?.reconstruido;
if (rehecho) {
  const dv = resumen.valor - rehecho.valor;
  const da = resumen.aportado - rehecho.aportado;
  console.log(
    `  reconstruido hoy: patrimonio ${rehecho.valor.toFixed(2)} (${dv >= 0 ? "+" : ""}${dv.toFixed(2)} hasta el resumen) · ` +
      `aportado ${rehecho.aportado.toFixed(2)} (${da >= 0 ? "+" : ""}${da.toFixed(2)})` +
      (Math.abs(dv - da) > 1 ? `  ⚠ descuadre de ${(dv - da).toFixed(2)} €` : "  · cuadra"),
  );
}

// Saltos raros: una semana que se mueve más de un 15 % sin que entre dinero
// suele ser un precio mal convertido.
for (let k = 1; k < puntos.length - 1; k++) {
  const a = puntos[k - 1];
  const b = puntos[k];
  const cambio = (b.valor - b.flujo - a.valor) / Math.max(a.valor, 1);
  if (Math.abs(cambio) > 0.15) {
    console.log(`  ⚠ salto de ${(cambio * 100).toFixed(1)} % entre ${a.fecha} y ${b.fecha}`);
    // Qué precios se movieron esa semana: si alguno se movió tanto, el salto
    // es de verdad; si ninguno, es un error de cálculo.
    const mov = Object.entries(historico.series ?? {})
      .map(([k, s]) => {
        const x = valorEn(s, a.fecha);
        const y = valorEn(s, b.fecha);
        return [k, x && y ? (y / x - 1) * 100 : null];
      })
      .filter(([, v]) => v != null && Math.abs(v) > 5)
      .sort((p, q) => Math.abs(q[1]) - Math.abs(p[1]))
      .slice(0, 6);
    console.log(
      `     lo que más se movió: ${mov.map(([k, v]) => `${k} ${v.toFixed(1)} %`).join(", ") || "nada más de un 5 %"}`,
    );
  }
}

const c = frenteAlIndice(puntos, historico.sp500 ?? []);
console.log("\n-- contra el S&P 500 --");
if (!c) console.log("  sin comparación");
else {
  console.log(`  desde ${c.desde} (índice desde ${c.desdeIndice}, hasta ${c.hasta})`);
  console.log(`  S&P 500: ${c.indicePct.toFixed(2)} %   tu cartera, por tiempo: ${c.tuyoPct?.toFixed(2)} %`);
  console.log(
    `  tu dinero (${c.aportado.toFixed(0)} €) en el índice: ${c.indice?.toFixed(0)} € · ` +
      `tienes ${c.tuyo.toFixed(0)} € · diferencia ${c.diferencia?.toFixed(0)} €`,
  );
}
process.exit(0);
