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
// euros va con el cambio de CADA fecha, no con el de hoy; si no, la historia
// de un fondo en dólares mediría el dólar, no el fondo.

import { clienteServicio, respuesta } from "./_lib/supabase.js";
import { simbolosDeCartera, type EntradaCat } from "./_lib/refresco.js";
import { serieCambios, serieYahoo } from "./_lib/mercado.js";

export const config = { maxDuration: 60 };

type Serie = [string, number][];

/** Símbolos de Yahoo como mucho por llamada. */
const TOPE = 60;

/** Busca en una serie ordenada el último valor con fecha ≤ `fecha`; antes del
 *  primero, el primero. */
function enFecha(serie: Serie, fecha: string): number | null {
  if (serie.length === 0) return null;
  let lo = 0;
  let hi = serie.length - 1;
  let r = serie[0][1];
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (serie[m][0] <= fecha) {
      r = serie[m][1];
      lo = m + 1;
    } else hi = m - 1;
  }
  return r;
}

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
  const crudas = new Map<string, { divisa: string; puntos: Serie }>();
  const fallos: string[] = [];
  const cola = [...grupos.keys(), INDICE];
  const trabajar = async () => {
    for (let y = cola.shift(); y; y = cola.shift()) {
      try {
        crudas.set(y, await serieYahoo(y, inicio, y === INDICE ? "1d" : "1wk"));
      } catch (e) {
        fallos.push(`${y}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, trabajar));

  // Las divisas, con su serie del BCE. GBp son peniques de libra.
  const base = (d: string) => (d === "GBp" || d === "GBX" ? "GBP" : d);
  const divisas = new Set(
    [...crudas.values()].map((c) => base(c.divisa)).filter((d) => d !== "EUR"),
  );
  const dias = Math.ceil((Date.now() - Date.parse(inicio)) / 86400e3) + 7;
  const cambios: Record<string, Serie> = {};
  await Promise.all(
    [...divisas].map(async (d) => {
      try {
        const s = await serieCambios(d, "EUR", dias);
        cambios[d] = Object.entries(s).sort((a, b) => a[0].localeCompare(b[0]));
      } catch {
        fallos.push(`cambio ${d}`);
      }
    }),
  );

  const aEuros = (c: { divisa: string; puntos: Serie }): Serie => {
    const d = base(c.divisa);
    const peniques = d !== c.divisa ? 100 : 1;
    const out: Serie = [];
    for (const [fecha, v] of c.puntos) {
      const t = d === "EUR" ? 1 : enFecha(cambios[d] ?? [], fecha);
      if (t == null) continue;
      out.push([fecha, Number(((v * t) / peniques).toFixed(4))]);
    }
    return out;
  };

  const series: Record<string, Serie> = {};
  for (const [y, claves] of grupos) {
    const c = crudas.get(y);
    if (!c) continue;
    const s = aEuros(c);
    for (const k of claves) series[k] = s;
  }
  const sp = crudas.get(INDICE);

  // Sin sangrar, a diferencia de `respuesta()`: con cientos de puntos, la
  // sangría triplica lo que viaja.
  const cuerpo = { desde, series, sp500: sp ? aEuros(sp) : [], indice: INDICE, fallos };
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
