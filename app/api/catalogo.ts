// ── CRON · DIVISAS Y MANTENIMIENTO ───────────────────────────────────────
// Una vez al día. Refresca el cambio de todas las divisas que aparecen en
// alguna cartera o en el catálogo, guarda su histórico y jubila los símbolos
// que Yahoo ya no sirve.
//
// Jubilar en vez de borrar: un símbolo retirado deja de pedirse cada cuarto de
// hora —que es lo que hacía que el cron tardara cada vez más— pero su fila
// sigue ahí, así que las posiciones antiguas conservan su nombre y su ISIN.

import { clienteServicio, autorizada, respuesta } from "./_lib/supabase";
import { Cambios, serieCambios, yahoo, dormir } from "./_lib/mercado";

export const config = { maxDuration: 300 };

export default async function handler(req: Request): Promise<Response> {
  if (!autorizada(req)) return respuesta({ error: "no autorizada" }, 401);

  const sb = clienteServicio();
  const ahora = new Date().toISOString();

  // ── Divisas en uso ────────────────────────────────────────────────────
  const [activos, precios] = await Promise.all([
    sb.from("assets").select("currency"),
    sb.from("prices").select("currency"),
  ]);

  const divisas = new Set<string>();
  for (const f of [...(activos.data ?? []), ...(precios.data ?? [])]) {
    const c = String((f as { currency?: string }).currency ?? "").toUpperCase();
    if (c && c !== "EUR") divisas.add(c);
  }

  const cambios = new Cambios();
  const fallos: string[] = [];
  for (const d of divisas) {
    try {
      await cambios.aEuros(d);
    } catch (e) {
      fallos.push(`fx ${d}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const tasas = Object.entries(cambios.todas()).map(([currency, eur_rate]) => ({
    currency,
    eur_rate,
    updated_at: ahora,
  }));
  if (tasas.length > 0) await sb.from("fx").upsert(tasas, { onConflict: "currency" });

  // ── Histórico, para convertir cada operación al cambio de su día ──────
  let puntosHistorico = 0;
  for (const d of divisas) {
    try {
      const serie = await serieCambios(d, "EUR", 1900);
      const filas = Object.entries(serie).map(([date, eur_rate]) => ({
        currency: d,
        date,
        eur_rate,
      }));
      for (let i = 0; i < filas.length; i += 500) {
        await sb
          .from("fx_history")
          .upsert(filas.slice(i, i + 500), { onConflict: "currency,date" });
      }
      puntosHistorico += filas.length;
    } catch (e) {
      fallos.push(`histórico ${d}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ── Jubilar lo que Yahoo ya no sirve ──────────────────────────────────
  // Sólo se revisan los que llevan más de tres días sin precio nuevo: pedir
  // los 519 todos los días sería repetir el trabajo del cron de precios.
  const limite = new Date(Date.now() - 3 * 86400e3).toISOString();
  const viejos = await sb
    .from("catalog")
    .select("symbol,yahoo")
    .eq("retired", false)
    .not("yahoo", "is", null)
    .limit(40);

  const desactualizados = await sb.from("prices").select("symbol,updated_at").lt("updated_at", limite);
  const sospechosos = new Set(
    ((desactualizados.data ?? []) as { symbol: string }[]).map((p) => p.symbol),
  );

  const jubilados: string[] = [];
  for (const c of (viejos.data ?? []) as { symbol: string; yahoo: string }[]) {
    if (!sospechosos.has(c.symbol)) continue;
    try {
      await yahoo(c.yahoo);
      await dormir(350);
    } catch {
      jubilados.push(c.symbol);
    }
  }
  if (jubilados.length > 0) {
    await sb.from("catalog").update({ retired: true }).in("symbol", jubilados);
  }

  return respuesta({
    ok: true,
    momento: ahora,
    divisas: tasas.length,
    historico: puntosHistorico,
    jubilados,
    fallos,
  });
}
