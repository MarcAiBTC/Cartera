// ── EL BOTÓN «ACTUALIZAR PRECIOS» ────────────────────────────────────────
// Lo pulsa una persona desde la cabecera de la app. Cotiza AHORA MISMO lo que
// tiene en cartera y en seguimiento —no el catálogo entero, que son quinientos
// símbolos y cuatro minutos— y lo deja en `prices`, donde lo leen todas sus
// pantallas y sus otros dispositivos.
//
// Existe porque los precios automáticos no llegan cuando deberían: la GitHub
// Action «del cuarto de hora» corre en la práctica cada tres o cuatro horas
// —GitHub no garantiza sus horarios— y la de Supabase no funcionó nunca.
//
//   POST /api/refrescar     Authorization: Bearer <token de la sesión>
//
// No lleva el secreto del cron: la llama el navegador. La protege la sesión
// —sólo quien ha entrado, y sólo sus valores— y dos topes: un símbolo
// cotizado hace menos de un minuto no se vuelve a pedir, y como mucho se
// piden TOPE por llamada. Pulsar veinte veces seguidas cuesta una sola ronda
// a Yahoo.

import { clienteServicio, respuesta } from "./_lib/supabase.js";
import { cotizar, simbolosDeCartera, type EntradaCat } from "./_lib/refresco.js";

export const config = { maxDuration: 60 };

/** Lo cotizado hace menos de esto no se vuelve a pedir. */
const RECIENTE_MS = 60 * 1000;
/** Símbolos como mucho por llamada. Una cartera real tiene veinte. */
const TOPE = 80;

// Por nombre de método, nunca `export default`: ver la nota en _lib/supabase.ts.
export async function POST(req: Request): Promise<Response> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return respuesta({ error: "Hace falta entrar con tu cuenta" }, 401);

  const sb = clienteServicio();
  const { data: quien, error: sinSesion } = await sb.auth.getUser(token);
  if (sinSesion || !quien.user) {
    return respuesta({ error: "La sesión ha caducado: vuelve a entrar" }, 401);
  }
  const uid = quien.user.id;

  const [activos, seguimiento, cat] = await Promise.all([
    sb.from("assets").select("ticker,isin").eq("user_id", uid).eq("archived", false),
    sb.from("watchlist").select("ticker").eq("user_id", uid),
    sb.from("catalog").select("symbol,yahoo,coingecko,isin,ticker").eq("retired", false),
  ]);
  if (activos.error) return respuesta({ error: activos.error.message }, 500);
  if (cat.error) return respuesta({ error: cat.error.message }, 500);

  const { simbolos, sinTraducir } = simbolosDeCartera(
    [
      ...((activos.data ?? []) as { ticker: string | null; isin: string | null }[]),
      ...((seguimiento.data ?? []) as { ticker: string }[]).map((w) => ({
        ticker: w.ticker,
        isin: null,
      })),
    ],
    (cat.data ?? []) as EntradaCat[],
  );

  const ahora = new Date();
  const momento = ahora.toISOString();
  const previos = simbolos.length
    ? await sb
        .from("prices")
        .select("symbol,updated_at")
        .in(
          "symbol",
          simbolos.map((s) => s.symbol),
        )
    : { data: [] };
  const recientes = new Set(
    ((previos.data ?? []) as { symbol: string; updated_at: string }[])
      .filter((p) => ahora.getTime() - Date.parse(p.updated_at) < RECIENTE_MS)
      .map((p) => p.symbol),
  );
  const pendientes = simbolos.filter((s) => !recientes.has(s.symbol)).slice(0, TOPE);

  const { filas, fallos, tasas } = await cotizar(pendientes, { ahora: momento, simultaneas: 4 });

  if (filas.length > 0) {
    const { error } = await sb.from("prices").upsert(filas, { onConflict: "symbol" });
    if (error) return respuesta({ error: error.message }, 500);
  }
  // El euro siempre está; sólo merece escribirse si ha hecho falta otra.
  const filasFx = Object.entries(tasas).map(([currency, eur_rate]) => ({
    currency,
    eur_rate,
    updated_at: momento,
  }));
  if (filasFx.length > 1) await sb.from("fx").upsert(filasFx, { onConflict: "currency" });

  return respuesta({
    ok: true,
    momento,
    actualizados: filas.length,
    yaEstaban: recientes.size,
    fallos,
    sinTraducir,
  });
}
