// ── LA HISTORIA DE LOS PRECIOS DE UNA CARTERA ────────────────────────────
// Para el gráfico «Patrimonio y dinero aportado» y la comparación con el
// S&P 500: el cierre de cada semana, en euros, de todo lo que ha tenido la
// cuenta que llama —también lo ya vendido, que valía algo mientras lo tuvo—
// desde su primera operación. Y el S&P 500 día a día, como un ETF de
// acumulación en euros (SXR8).
//
//   POST /api/historico    Authorization: Bearer <token de la sesión>
//
// Yahoo no manda CORS: esto sólo puede hacerse en el servidor. La conversión a
// euros va con el cambio de CADA fecha: ver `_lib/series.ts`.

import { clienteServicio, respuesta } from "./_lib/supabase.js";
import { simbolosDeCartera, type EntradaCat } from "./_lib/refresco.js";
import { seriesEnEuros, type Serie } from "./_lib/series.js";

export const config = { maxDuration: 60 };

/** Símbolos de Yahoo como mucho por llamada. */
const TOPE = 60;

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

  // También los archivados: una posición ya vendida valía algo mientras la
  // tuviste, y el patrimonio de aquellas semanas la incluye.
  const [activos, primera, cat] = await Promise.all([
    sb.from("assets").select("ticker,isin").eq("user_id", uid),
    sb.from("operations").select("date").eq("user_id", uid).order("date").limit(1),
    sb.from("catalog").select("symbol,yahoo,coingecko,isin,ticker").eq("retired", false),
  ]);
  if (activos.error) return respuesta({ error: activos.error.message }, 500);
  if (cat.error) return respuesta({ error: cat.error.message }, 500);

  const desde = (primera.data?.[0] as { date: string } | undefined)?.date ?? null;
  if (!desde) return respuesta({ desde: null, series: {}, sp500: [], fallos: [] });
  // Unos días antes: la primera semana necesita el cierre anterior.
  const inicio = new Date(Date.parse(desde) - 10 * 86400e3).toISOString().slice(0, 10);

  const { simbolos } = simbolosDeCartera(
    (activos.data ?? []) as { ticker: string | null; isin: string | null }[],
    (cat.data ?? []) as EntradaCat[],
  );

  // Cada símbolo de Yahoo, una sola vez aunque tenga alias. La cripto, que el
  // cron cotiza en CoinGecko, aquí va por su par en euros de Yahoo: CoinGecko
  // sólo da la historia larga con clave de pago.
  const grupos = new Map<string, string[]>();
  for (const s of simbolos) {
    const y = s.coingecko ? `${s.symbol}-EUR` : s.yahoo;
    if (!y) continue;
    const l = grupos.get(y);
    if (l) l.push(s.symbol);
    else if (grupos.size < TOPE) grupos.set(y, [s.symbol]);
  }

  // Contra qué se compara: un ETF del S&P 500 de acumulación que cotiza en
  // euros —el iShares Core de Xetra—, que es lo que de verdad podías haber
  // comprado en vez de lo que compraste.
  //   · No el ^GSPC de las noticias: es sólo precio, y los fondos indexados
  //     reinvierten los dividendos. Contra él ganaban punto y pico al año
  //     gratis.
  //   · Tampoco el ^SP500TR pasado a euros: no paga la retención de los
  //     dividendos ni comisión, y al convertirlo con el cambio del BCE de
  //     mediodía y el cierre de Nueva York se mide también la hora. Daba
  //     3,5 puntos más que el ETF en tres años (sept 2023 – sept 2026).
  const INDICE = "SXR8.DE";
  const { series: conv, fallos } = await seriesEnEuros(
    [...grupos.keys(), INDICE],
    inicio,
    (y) => (y === INDICE ? "1d" : "1wk"),
  );

  const series: Record<string, Serie> = {};
  for (const [y, claves] of grupos) {
    const s = conv.get(y);
    if (!s) continue;
    for (const k of claves) series[k] = s;
  }

  // Sin sangrar, a diferencia de `respuesta()`: con cientos de puntos, la
  // sangría triplica lo que viaja.
  const cuerpo = { desde, series, sp500: conv.get(INDICE) ?? [], indice: INDICE, fallos };
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
