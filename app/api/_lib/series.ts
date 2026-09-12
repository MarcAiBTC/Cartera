// ── SERIES DE PRECIOS EN EUROS ───────────────────────────────────────────
// Lo que comparten /api/historico y /api/cierres: pedir a Yahoo los cierres de
// unos cuantos símbolos y pasarlos a euros con el cambio de CADA fecha, no con
// el de hoy —si no, la historia de un fondo en dólares mediría el dólar—.

import type { SupabaseClient } from "@supabase/supabase-js";
import { serieCambios, serieYahoo } from "./mercado.js";
import { simbolosDeCartera, type EntradaCat } from "./refresco.js";

export type Serie = [string, number][];

/** El último valor con fecha ≤ `fecha`; antes del primero, el primero. */
export function enFecha(serie: Serie, fecha: string): number | null {
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

/** Cierres de Yahoo en euros, por símbolo de Yahoo, cuatro peticiones a la
 *  vez. Lo que falla va a `fallos` y no tumba el resto. */
export async function seriesEnEuros(
  yahoos: string[],
  desde: string,
  intervalo: (y: string) => "1d" | "1wk",
): Promise<{ series: Map<string, Serie>; fallos: string[] }> {
  const crudas = new Map<string, { divisa: string; puntos: Serie }>();
  const fallos: string[] = [];
  const cola = [...new Set(yahoos)];
  const trabajar = async () => {
    for (let y = cola.shift(); y; y = cola.shift()) {
      try {
        crudas.set(y, await serieYahoo(y, desde, intervalo(y)));
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
  const dias = Math.ceil((Date.now() - Date.parse(desde)) / 86400e3) + 7;
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

  const series = new Map<string, Serie>();
  for (const [y, c] of crudas) {
    const d = base(c.divisa);
    const peniques = d !== c.divisa ? 100 : 1;
    const out: Serie = [];
    for (const [fecha, v] of c.puntos) {
      const t = d === "EUR" ? 1 : enFecha(cambios[d] ?? [], fecha);
      if (t == null) continue;
      out.push([fecha, Number(((v * t) / peniques).toFixed(4))]);
    }
    series.set(y, out);
  }
  return { series, fallos };
}

/** El símbolo de Yahoo de un ticker de la cartera, con el catálogo. La
 *  cripto, que el cron cotiza en CoinGecko, va por su par en euros de Yahoo:
 *  CoinGecko sólo da la historia larga con clave de pago. */
export function yahooDe(ticker: string, catalogo: EntradaCat[]): string | null {
  const [s] = simbolosDeCartera([{ ticker, isin: null }], catalogo).simbolos;
  if (!s) return null;
  return s.coingecko ? `${s.symbol}-EUR` : s.yahoo;
}

/** Con qué se alarga hacia atrás la serie de algo que cotiza desde hace
 *  poco, por su subyacente: un ETC sigue al precio de lo que guarda. */
const POR_SUBYACENTE: Record<string, string> = {
  bitcoin: "BTC-EUR",
  ethereum: "ETH-EUR",
  ether: "ETH-EUR",
  oro: "GC=F",
  gold: "GC=F",
  plata: "SI=F",
  silver: "SI=F",
  platino: "PL=F",
  paladio: "PA=F",
};

/** La serie alargada hacia atrás con la de su subyacente, escalada por la
 *  mediana del cociente de los primeros días que coinciden. Sólo si se
 *  mueven juntas —cuatro de cada cinco días a menos de un 4 %—: el bitcoin
 *  cierra a medianoche y el ETC a las cuatro y media, así que un día suelto
 *  puede separarse, pero un producto distinto se separa siempre. */
export function empalmar(serie: Serie, subyacente: Serie): Serie {
  if (serie.length < 5 || subyacente.length === 0) return serie;
  const inicio = serie[0][0];
  if (subyacente[0][0] >= inicio) return serie;
  const razones = serie
    .slice(0, 20)
    .map(([d, v]) => v / (enFecha(subyacente, d) ?? NaN))
    .filter((r) => isFinite(r) && r > 0)
    .sort((a, b) => a - b);
  if (razones.length < 5) return serie;
  const k = razones[razones.length >> 1];
  const juntas = razones.filter((r) => Math.abs(r / k - 1) <= 0.04).length;
  if (juntas < razones.length * 0.8) return serie;
  const antes = subyacente
    .filter(([d]) => d < inicio)
    .map(([d, v]): [string, number] => [d, Number((v * k).toFixed(4))]);
  return [...antes, ...serie];
}

const sinAcentos = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** Los cierres diarios en euros de unos tickers de la cartera desde una
 *  fecha, por el ticker tal y como se pidió. Lo usan /api/cierres y
 *  `scripts/simular-import.mjs`. */
export async function cierresDe(
  sb: SupabaseClient,
  tickers: string[],
  desde: string,
): Promise<{ series: Record<string, Serie>; fallos: string[] }> {
  const { data } = await sb
    .from("catalog")
    .select("symbol,yahoo,coingecko,isin,ticker,underlying")
    .eq("retired", false);
  const catalogo = (data ?? []) as (EntradaCat & { underlying?: string | null })[];
  const porTicker = new Map<string, string>();
  const fallos: string[] = [];
  for (const t of tickers) {
    const y = yahooDe(t, catalogo);
    if (y) porTicker.set(t, y);
    else fallos.push(`${t}: sin símbolo de Yahoo`);
  }
  // Una semana antes: el primer día puede ser festivo y hace falta el cierre
  // anterior.
  const inicio = new Date(Date.parse(desde) - 7 * 86400e3).toISOString().slice(0, 10);
  const r = await seriesEnEuros([...porTicker.values()], inicio, () => "1d");

  // Lo que empieza a cotizar DESPUÉS de la primera fecha que hace falta: el
  // ETP de bitcoin de Fidelity llegó a Londres a finales de septiembre de
  // 2025, y las compras de MyInvestor de ese mes se quedaban sin precio. Las
  // otras bolsas no sirven —en Suiza Yahoo mezcla la clase en dólares, en
  // Xetra está deslistado—, así que se alarga con su subyacente.
  const subDe = new Map<string, string>();
  for (const y of porTicker.values()) {
    const s = r.series.get(y);
    if (!s?.length || s[0][0] <= desde) continue;
    const u = catalogo.find((c) => (c.yahoo ?? c.symbol) === y && c.underlying)?.underlying;
    const sub = u ? POR_SUBYACENTE[sinAcentos(u)] : undefined;
    if (sub && sub !== y) subDe.set(y, sub);
  }
  const subs = subDe.size
    ? await seriesEnEuros([...new Set(subDe.values())], inicio, () => "1d")
    : { series: new Map<string, Serie>(), fallos: [] };

  const series: Record<string, Serie> = {};
  for (const [t, y] of porTicker) {
    const s = r.series.get(y);
    if (!s) continue;
    const sub = subDe.get(y);
    series[t] = sub ? empalmar(s, subs.series.get(sub) ?? []) : s;
  }
  return { series, fallos: [...fallos, ...r.fallos, ...subs.fallos] };
}
