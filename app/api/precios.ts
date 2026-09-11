// ── CRON · PRECIOS ───────────────────────────────────────────────────────
// Cada 15 minutos en horario de mercado. Lee qué símbolos hacen falta, los
// pide a Yahoo y a CoinGecko, los pasa a euros y los escribe en `prices`.
//
// Que esto corra en el servidor no es un detalle de arquitectura: es LA razón
// de que la app funcione. Yahoo no manda cabeceras CORS, así que desde el
// navegador la petición ni se llega a hacer, y todos los proxies públicos que
// se probaron acabaron cayéndose. Aquí no hay navegador y no hay CORS.
//
// Un símbolo que falla NO borra su precio anterior: se queda el último bueno y
// el fallo se cuenta en la respuesta. Es preferible un precio de hace una hora
// a un hueco en la cartera. La cotización en sí vive en `_lib/refresco.ts`,
// que comparte con el botón de la app (/api/refrescar).

import { clienteServicio, autorizada, respuesta } from "./_lib/supabase.js";
import { cotizar, type Simbolo } from "./_lib/refresco.js";

export const config = { maxDuration: 300 };

// Por nombre de metodo, nunca `export default`: ver la nota en _lib/supabase.ts.
export async function GET(req: Request): Promise<Response> {
  if (!autorizada(req)) return respuesta({ error: "no autorizada" }, 401);

  const sb = clienteServicio();
  const ahora = new Date().toISOString();

  // Qué hay que cotizar: el catálogo vivo más lo que tenga cualquier cartera.
  // Lo segundo es lo que hace que un activo recién importado tenga precio en
  // el siguiente cuarto de hora sin que nadie toque el catálogo.
  const [cat, activos] = await Promise.all([
    sb.from("catalog").select("symbol,yahoo,coingecko,isin").eq("retired", false),
    sb.from("assets").select("ticker,isin").eq("archived", false),
  ]);
  if (cat.error) return respuesta({ error: cat.error.message }, 500);

  const simbolos = new Map<string, Simbolo>();
  /** ISIN de la cartera que nadie sabe traducir todavia. Se informan en la
   *  respuesta para que se vean, en vez de pedirlos a Yahoo en balde. */
  const sinTraducir = new Set<string>();
  for (const c of (cat.data ?? []) as Simbolo[]) {
    simbolos.set(c.symbol.toUpperCase(), {
      symbol: c.symbol.toUpperCase(),
      yahoo: c.yahoo,
      coingecko: c.coingecko,
    });
  }
  // El ISIN que el catálogo ya sabe traducir no hace falta pedirlo: su
  // símbolo real ya está en la lista de arriba.
  const isinesConocidos = new Set(
    ((cat.data ?? []) as { isin: string | null }[])
      .map((c) => c.isin?.toUpperCase())
      .filter((i): i is string => Boolean(i)),
  );

  for (const a of (activos.data ?? []) as { ticker: string | null; isin: string | null }[]) {
    const t = a.ticker?.toUpperCase();
    if (t && !simbolos.has(t)) {
      // Sin entrada en el catálogo se prueba el propio ticker en Yahoo: para
      // los símbolos normales (AMZN, MSTR) acierta a la primera.
      simbolos.set(t, { symbol: t, yahoo: t, coingecko: null });
    }

    // Un ISIN NO es un símbolo de Yahoo: pedirlo devuelve 404 siempre. Si el
    // activo ya tiene ticker, o si el catálogo sabe traducir ese ISIN, no hay
    // nada que pedir; y si no lo sabe, lo que hace falta es resolverlo
    // (/api/isin), no insistir.
    const i = a.isin?.toUpperCase();
    if (i && !t && !simbolos.has(i) && !isinesConocidos.has(i)) {
      sinTraducir.add(i);
    }
  }

  // De uno en uno y con pausa: Yahoo penaliza las ráfagas con bloqueos.
  const { filas, fallos, tasas } = await cotizar([...simbolos.values()], { ahora, pausa: 350 });

  if (filas.length > 0) {
    const { error } = await sb.from("prices").upsert(filas, { onConflict: "symbol" });
    if (error) return respuesta({ error: error.message }, 500);
  }

  // Las divisas que se hayan tenido que resolver por el camino.
  const filasFx = Object.entries(tasas).map(([currency, eur_rate]) => ({
    currency,
    eur_rate,
    updated_at: ahora,
  }));
  if (filasFx.length > 0) await sb.from("fx").upsert(filasFx, { onConflict: "currency" });

  return respuesta({
    ok: true,
    momento: ahora,
    escritos: filas.length,
    divisas: filasFx.length,
    fallos,
    // Un ISIN aqui significa: hay un activo en alguna cartera al que nadie
    // sabe ponerle precio.
    sinTraducir: [...sinTraducir],
  });
}
