// ── PRECIOS ──────────────────────────────────────────────────────────────
// El navegador NO puede pedirle precios a Yahoo: no manda cabeceras CORS y
// todos los proxies públicos que se probaron acabaron cayéndose. Por eso el
// precio siempre llega de un tercero que sí los manda, y hay dos:
//
//   1. La tabla `prices` de Supabase. La escriben el cron y el botón de
//      actualizar de la cabecera (/api/refrescar), que cotiza en el momento.
//   2. Los JSON públicos del repositorio, que publica una GitHub Action: sobre
//      el papel cada 15 minutos, en la práctica cada tres o cuatro horas.
//
// Se leen los dos y, SÍMBOLO A SÍMBOLO, gana el precio más reciente. Antes se
// elegía una fuente entera —Supabase si lo suyo tenía menos de 45 minutos—, y
// actualizar los veinte valores de una cartera dejaba los otros quinientos con
// el precio de hace dos días.

import { supabase, hayNube } from "./supabase";
import type { EntradaCatalogo, Precio } from "./tipos";
import type { MapaFx, MapaPrecios } from "./cartera";

const FEED =
  (import.meta.env.VITE_FEED_URL as string | undefined) ??
  "https://raw.githubusercontent.com/MarcAiBTC/Cartera/main";

export interface DatosMercado {
  precios: MapaPrecios;
  fx: MapaFx;
  catalogo: EntradaCatalogo[];
  /** El precio más reciente de todos, en ISO */
  actualizado: string | null;
  /** De dónde ha salido al menos un precio de los que ganan */
  origen: "nube" | "feed" | "ninguno";
}

export const MERCADO_VACIO: DatosMercado = {
  precios: {},
  fx: { EUR: 1 },
  catalogo: [],
  actualizado: null,
  origen: "ninguno",
};

const cuando = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
/** ¿`b` es más reciente que `a`? Un hueco siempre pierde. */
const masNuevo = (a: Precio | undefined, b: Precio) =>
  !a || !(cuando(a.updated_at) >= cuando(b.updated_at));

// ── Supabase ─────────────────────────────────────────────────────────────

export interface DeNube {
  precios: MapaPrecios;
  fx: MapaFx;
  /** Cuándo se escribieron las divisas, para compararlas con las del feed */
  fxFecha: string | null;
  catalogo: EntradaCatalogo[];
}

async function desdeNube(): Promise<DeNube> {
  const sb = supabase!;
  const [pr, fx, cat] = await Promise.all([
    sb.from("prices").select("*"),
    sb.from("fx").select("*"),
    sb.from("catalog").select("*").eq("retired", false),
  ]);
  if (pr.error) throw pr.error;

  const precios: MapaPrecios = {};
  for (const p of (pr.data ?? []) as Precio[]) precios[p.symbol.toUpperCase()] = p;

  const tasas: MapaFx = { EUR: 1 };
  let fxFecha: string | null = null;
  for (const f of fx.data ?? []) {
    tasas[String(f.currency).toUpperCase()] = Number(f.eur_rate);
    if (!fxFecha || cuando(f.updated_at) > cuando(fxFecha)) fxFecha = f.updated_at;
  }

  return { precios, fx: tasas, fxFecha, catalogo: (cat.data ?? []) as EntradaCatalogo[] };
}

// ── Los JSON públicos ────────────────────────────────────────────────────

/** Forma de los JSON que publica el repositorio antiguo. */
interface FeedPrecios {
  generated_at: string;
  alias?: Record<string, string>;
  precios?: Record<string, { eur: number; raw?: number; cur?: string; prev?: number }>;
}
interface FeedCatalogo {
  generated_at: string;
  fx?: Record<string, number>;
  precios?: Record<string, { eur: number; cur?: string; prev?: number }>;
}

export interface DeFeed {
  precios: MapaPrecios;
  /** ISIN o ticker → símbolo. Se aplican al mezclar, no antes: tienen que
   *  apuntar al precio que gane, sea de la fuente que sea. */
  alias: Record<string, string>;
  fx: MapaFx;
  fxFecha: string | null;
}

async function desdeFeed(): Promise<DeFeed | null> {
  const pedir = async <T,>(archivo: string): Promise<T | null> => {
    try {
      const r = await fetch(`${FEED}/${archivo}`, { cache: "no-store" });
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  };

  const [feed, catalogo] = await Promise.all([
    pedir<FeedPrecios>("precios.json"),
    pedir<FeedCatalogo>("catalogo-precios.json"),
  ]);
  if (!feed && !catalogo) return null;

  const precios: MapaPrecios = {};
  const meter = (
    sym: string,
    v: { eur: number; raw?: number; cur?: string; prev?: number },
    origen: string,
    fecha: string,
  ) => {
    if (!v || !isFinite(v.eur)) return;
    precios[sym.toUpperCase()] = {
      symbol: sym.toUpperCase(),
      eur: v.eur,
      raw: v.raw ?? null,
      currency: v.cur ?? "EUR",
      prev: v.prev ?? null,
      name: null,
      source: origen,
      // Cada precio con la fecha de SU archivo. Antes todos llevaban la del
      // feed rápido, y el precio del catálogo diario —de esta mañana— se hacía
      // pasar por uno de hace diez minutos.
      updated_at: fecha,
    };
  };

  // El catálogo diario va primero para que el feed rápido lo pise.
  for (const [s, v] of Object.entries(catalogo?.precios ?? {})) {
    meter(s, v, "catalogo", catalogo!.generated_at);
  }
  for (const [s, v] of Object.entries(feed?.precios ?? {})) meter(s, v, "feed", feed!.generated_at);

  const fx: MapaFx = { EUR: 1 };
  for (const [c, r] of Object.entries(catalogo?.fx ?? {})) fx[c.toUpperCase()] = Number(r);

  return { precios, alias: feed?.alias ?? {}, fx, fxFecha: catalogo?.generated_at ?? null };
}

// ── Juntar las dos ───────────────────────────────────────────────────────

/** Deja el precio de cada valor también bajo su ISIN.
 *
 *  La tabla `prices` está indexada por el símbolo de Yahoo —«CABK.MC»— y un
 *  valor importado de un bróker europeo llega identificado por su ISIN
 *  —«ES0140609019»—. Si en el momento de importar no se pudo traducir el uno
 *  al otro, el activo se quedaba guardado sin `ticker` y MUDO PARA SIEMPRE.
 *  Con el alias puesto, `buscaPrecio` lo encuentra por el ISIN.
 *
 *  El ISIN y su símbolo son el mismo valor, así que se queda el más reciente
 *  de los dos: una fila vieja escrita con el ISIN no puede tapar el precio de
 *  hace un minuto que acaba de llegar con el símbolo. */
function aliasDelCatalogo(precios: MapaPrecios, catalogo: EntradaCatalogo[]): void {
  for (const c of catalogo) {
    if (!c.isin) continue;
    const simbolo = (c.yahoo ?? c.symbol ?? c.ticker ?? "").toUpperCase();
    const p = simbolo ? precios[simbolo] : undefined;
    const k = c.isin.toUpperCase();
    if (p && masNuevo(precios[k], p)) precios[k] = p;
  }
}

export function mezclar(nube: DeNube | null, feed: DeFeed | null): DatosMercado {
  if (!nube && !feed) return MERCADO_VACIO;

  const precios: MapaPrecios = { ...(feed?.precios ?? {}) };
  let deLaNube = 0;
  for (const [s, p] of Object.entries(nube?.precios ?? {})) {
    if (!masNuevo(precios[s], p)) continue;
    precios[s] = p;
    deLaNube++;
  }

  // Los alias ISIN/ticker → símbolo del feed son lo que permite que una
  // posición apuntada por ISIN encuentre su precio sin tocar nada más.
  //
  // Y PISAN, no se limitan a rellenar huecos: hay tickers que existen en dos
  // mercados con precios muy distintos. «FBTC» es el ETF de bitcoin de
  // Fidelity en Estados Unidos, a unos 60 €, y también el de Londres que es
  // el que está en cartera, a unos 6,60 €. Cuando el alias sólo rellenaba
  // huecos ganaba el otro y la posición salía valorada diez veces de más.
  for (const [alias, sym] of Object.entries(feed?.alias ?? {})) {
    const p = precios[String(sym).toUpperCase()];
    if (p) precios[alias.toUpperCase()] = p;
  }

  const catalogo = nube?.catalogo ?? [];
  aliasDelCatalogo(precios, catalogo);

  // Las divisas, enteras de la fuente más reciente, con la otra de respaldo
  // para lo que le falte.
  const fxDeLaNube = cuando(nube?.fxFecha) > cuando(feed?.fxFecha) || !feed;
  const [respaldo, buenas] = fxDeLaNube ? [feed?.fx, nube?.fx] : [nube?.fx, feed?.fx];
  const fx: MapaFx = { ...(respaldo ?? {}), ...(buenas ?? {}), EUR: 1 };

  const fechas = Object.values(precios)
    .map((p) => p.updated_at)
    .filter((f) => isFinite(cuando(f)))
    .sort((a, b) => cuando(a) - cuando(b));

  return {
    precios,
    fx,
    catalogo,
    actualizado: fechas.at(-1) ?? null,
    origen: deLaNube > 0 || !feed ? "nube" : "feed",
  };
}

export async function cargarMercado(): Promise<DatosMercado> {
  const [nube, feed] = await Promise.all([
    hayNube
      ? desdeNube().catch((e) => {
          console.warn("[precios] Supabase no ha respondido, sólo el feed", e);
          return null;
        })
      : Promise.resolve(null),
    desdeFeed(),
  ]);
  return mezclar(nube, feed);
}

// ── Pedir precios nuevos ─────────────────────────────────────────────────

export interface ResultadoRefresco {
  ok: boolean;
  /** Precios escritos en esta vuelta */
  actualizados: number;
  /** Símbolos que Yahoo o CoinGecko no han querido dar */
  fallos: string[];
  error?: string;
  /** Sin cuenta no hay servidor al que pedir: sólo se ha releído el feed */
  soloResumen?: boolean;
}

/** Le pide al servidor que cotice YA lo que tiene esta cuenta. Ver
 *  api/refrescar.ts. No lanza nunca: un fallo vuelve como `ok: false` con el
 *  motivo, para que el botón pueda decirlo. */
export async function pedirRefresco(token: string): Promise<ResultadoRefresco> {
  const fallo = (error: string): ResultadoRefresco => ({ ok: false, actualizados: 0, fallos: [], error });
  try {
    const r = await fetch("/api/refrescar", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    // En `vite dev` no hay /api y contesta el index.html con un 200.
    if (!(r.headers.get("content-type") ?? "").includes("json")) {
      return fallo("El servidor de precios no está disponible");
    }
    const j = (await r.json()) as { error?: string; actualizados?: number; fallos?: string[] };
    if (!r.ok) return fallo(j.error ?? `El servidor ha contestado ${r.status}`);
    return { ok: true, actualizados: j.actualizados ?? 0, fallos: j.fallos ?? [] };
  } catch {
    return fallo("Sin conexión");
  }
}

// ── REFERENCIA DE MERCADO ────────────────────────────────────────────────
// La serie del S&P 500 en euros, para poder contestar «¿lo habría hecho mejor
// comprando el índice y olvidándome?». En euros a propósito: comparar una
// cartera en euros con un índice en dólares mide, sobre todo, el dólar.

export interface PuntoBenchmark {
  date: string;
  value: number;
}

export async function cargarBenchmark(): Promise<PuntoBenchmark[]> {
  if (hayNube) {
    try {
      // Por paginas de mil. PostgREST corta en 1000 filas por defecto y no
      // avisa: la serie tiene 1255 dias, asi que una sola consulta devolvia
      // hasta agosto del ano pasado y la comparacion contra el indice se
      // hacia contra un cierre de hace doce meses, sin que nada fallara.
      const PAGINA = 1000;
      const puntos: PuntoBenchmark[] = [];
      for (let desde = 0; ; desde += PAGINA) {
        const { data, error } = await supabase!
          .from("benchmark")
          .select("date,value")
          .eq("symbol", "SP500_EUR")
          .order("date")
          .range(desde, desde + PAGINA - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        puntos.push(...(data as PuntoBenchmark[]));
        if (data.length < PAGINA) break;
      }
      if (puntos.length > 0) return puntos;
    } catch {
      /* se prueba el feed */
    }
  }

  try {
    const r = await fetch(`${FEED}/benchmark.json`, { cache: "no-store" });
    if (!r.ok) return [];
    // El feed guarda dos vectores paralelos: `d` las fechas y `c` los cierres.
    const j = (await r.json()) as { sp500_eur?: { d: string[]; c: number[] } };
    const s = j.sp500_eur;
    if (!s?.d || !s?.c) return [];
    return s.d.map((date, i) => ({ date, value: s.c[i] })).filter((p) => isFinite(p.value));
  } catch {
    return [];
  }
}
