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
// a un hueco en la cartera.

import { clienteServicio, autorizada, respuesta } from "./_lib/supabase";
import { Cambios, coingecko, dormir, yahoo } from "./_lib/mercado";

export const config = { maxDuration: 300 };

interface Simbolo {
  symbol: string;
  yahoo: string | null;
  coingecko: string | null;
}

export default async function handler(req: Request): Promise<Response> {
  if (!autorizada(req)) return respuesta({ error: "no autorizada" }, 401);

  const sb = clienteServicio();
  const ahora = new Date().toISOString();

  // Qué hay que cotizar: el catálogo vivo más lo que tenga cualquier cartera.
  // Lo segundo es lo que hace que un activo recién importado tenga precio en
  // el siguiente cuarto de hora sin que nadie toque el catálogo.
  const [cat, activos] = await Promise.all([
    sb.from("catalog").select("symbol,yahoo,coingecko").eq("retired", false),
    sb.from("assets").select("ticker,isin").eq("archived", false),
  ]);
  if (cat.error) return respuesta({ error: cat.error.message }, 500);

  const simbolos = new Map<string, Simbolo>();
  for (const c of (cat.data ?? []) as Simbolo[]) {
    simbolos.set(c.symbol.toUpperCase(), {
      symbol: c.symbol.toUpperCase(),
      yahoo: c.yahoo,
      coingecko: c.coingecko,
    });
  }
  for (const a of (activos.data ?? []) as { ticker: string | null; isin: string | null }[]) {
    for (const clave of [a.ticker, a.isin]) {
      const k = clave?.toUpperCase();
      if (!k || simbolos.has(k)) continue;
      // Sin entrada en el catálogo se prueba el propio ticker en Yahoo: para
      // los símbolos normales (AMZN, MSTR) acierta a la primera.
      simbolos.set(k, { symbol: k, yahoo: k, coingecko: null });
    }
  }

  const previos = await sb.from("prices").select("symbol,eur,raw,currency,prev,source");
  const anteriores = new Map(
    ((previos.data ?? []) as { symbol: string }[]).map((p) => [p.symbol, p]),
  );

  const filas: Record<string, unknown>[] = [];
  const fallos: string[] = [];
  const cambios = new Cambios();

  // ── Cripto, en una sola llamada ───────────────────────────────────────
  const cripto = [...simbolos.values()].filter((s) => s.coingecko);
  if (cripto.length > 0) {
    try {
      const d = await coingecko(cripto.map((s) => s.coingecko!));
      for (const s of cripto) {
        const p = d[s.coingecko!];
        if (!p) continue;
        filas.push({
          symbol: s.symbol,
          eur: p.eur,
          raw: p.eur,
          currency: "EUR",
          prev: p.previo,
          source: "coingecko",
          updated_at: ahora,
        });
      }
    } catch (e) {
      fallos.push(`coingecko: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ── El resto, uno a uno por Yahoo ─────────────────────────────────────
  const hechos = new Set(filas.map((f) => f.symbol as string));
  for (const s of simbolos.values()) {
    if (hechos.has(s.symbol) || !s.yahoo) continue;
    try {
      const q = await yahoo(s.yahoo);
      const tasa = await cambios.aEuros(q.divisa);
      filas.push({
        symbol: s.symbol,
        eur: q.precio * tasa,
        raw: q.precio,
        currency: q.divisa,
        prev: q.previo != null ? q.previo * tasa : null,
        source: "yahoo",
        updated_at: ahora,
      });
      // Sin ráfagas: Yahoo penaliza el exceso con bloqueos temporales.
      await dormir(350);
    } catch (e) {
      fallos.push(`${s.symbol}: ${e instanceof Error ? e.message : e}`);
      const viejo = anteriores.get(s.symbol);
      if (viejo) filas.push(viejo as Record<string, unknown>);
    }
  }

  if (filas.length > 0) {
    const { error } = await sb.from("prices").upsert(filas, { onConflict: "symbol" });
    if (error) return respuesta({ error: error.message }, 500);
  }

  // Las divisas que se hayan tenido que resolver por el camino.
  const tasas = Object.entries(cambios.todas()).map(([currency, eur_rate]) => ({
    currency,
    eur_rate,
    updated_at: ahora,
  }));
  if (tasas.length > 0) await sb.from("fx").upsert(tasas, { onConflict: "currency" });

  return respuesta({
    ok: true,
    momento: ahora,
    escritos: filas.length,
    divisas: tasas.length,
    fallos,
  });
}
