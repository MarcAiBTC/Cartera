// ── CRON · REFERENCIA DE MERCADO ─────────────────────────────────────────
// Una vez al día. Guarda la serie del S&P 500 convertida a euros, que es
// contra lo que se compara la cartera en la pantalla de Análisis.
//
// La conversión se hace día a día con el cambio DE ESE DÍA, no con el de hoy:
// aplicar el dólar actual a toda la serie convierte la comparación en una
// medida del dólar, no del índice.

import { clienteServicio, autorizada, respuesta } from "./_lib/supabase";
import { historicoYahoo, serieCambios } from "./_lib/mercado";

export const config = { maxDuration: 120 };

export default async function handler(req: Request): Promise<Response> {
  if (!autorizada(req)) return respuesta({ error: "no autorizada" }, 401);

  const sb = clienteServicio();

  let indice: Record<string, number>;
  let dolar: Record<string, number>;
  try {
    [indice, dolar] = await Promise.all([
      // ^GSPC es el índice; SPY sería el ETF, con su comisión y su desfase.
      historicoYahoo("^GSPC", "5y"),
      serieCambios("USD", "EUR", 1900),
    ]);
  } catch (e) {
    return respuesta({ error: e instanceof Error ? e.message : String(e) }, 502);
  }

  const dias = Object.keys(dolar).sort();
  /** El cambio del día, o el del día hábil anterior si ese no cotizó. */
  const cambioEn = (fecha: string): number | null => {
    if (dolar[fecha] != null) return dolar[fecha];
    let anterior: number | null = null;
    for (const d of dias) {
      if (d > fecha) break;
      anterior = dolar[d];
    }
    return anterior;
  };

  const filas: { symbol: string; date: string; value: number }[] = [];
  for (const [fecha, valor] of Object.entries(indice)) {
    const c = cambioEn(fecha);
    if (c == null) continue;
    filas.push({ symbol: "SP500_EUR", date: fecha, value: valor * c });
  }

  if (filas.length === 0) return respuesta({ error: "serie vacía" }, 502);

  // En tandas: una sola sentencia con 1.200 filas se queda sin tiempo.
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await sb
      .from("benchmark")
      .upsert(filas.slice(i, i + 500), { onConflict: "symbol,date" });
    if (error) return respuesta({ error: error.message }, 500);
  }

  // De paso, el histórico de divisas que necesita el importador para convertir
  // cada operación al cambio de su día.
  const historico = dias.map((date) => ({ currency: "USD", date, eur_rate: dolar[date] }));
  for (let i = 0; i < historico.length; i += 500) {
    await sb
      .from("fx_history")
      .upsert(historico.slice(i, i + 500), { onConflict: "currency,date" });
  }

  return respuesta({ ok: true, puntos: filas.length, cambios: historico.length });
}
