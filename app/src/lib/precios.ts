// ── PRECIOS ──────────────────────────────────────────────────────────────
// El navegador NO puede pedirle precios a Yahoo: no manda cabeceras CORS y
// todos los proxies públicos que se probaron acabaron cayéndose. Por eso el
// precio siempre llega de un tercero que sí los manda:
//
//   1. La tabla `prices` de Supabase, que rellena el cron de Vercel. Es la vía
//      normal y la que se actualiza cada 15 minutos.
//   2. Si no hay Supabase configurado (modo local), los JSON que sigue
//      publicando el repositorio antiguo. Así la app arranca con precios
//      reales desde el primer minuto, sin esperar a nada.

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
  actualizado: string | null;
  origen: "nube" | "feed" | "ninguno";
}

export const MERCADO_VACIO: DatosMercado = {
  precios: {},
  fx: { EUR: 1 },
  catalogo: [],
  actualizado: null,
  origen: "ninguno",
};

async function desdeNube(): Promise<DatosMercado> {
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
  for (const f of fx.data ?? []) tasas[String(f.currency).toUpperCase()] = Number(f.eur_rate);

  const fechas = (pr.data ?? []).map((p) => p.updated_at).sort();
  return {
    precios,
    fx: tasas,
    catalogo: (cat.data ?? []) as EntradaCatalogo[],
    actualizado: fechas.at(-1) ?? null,
    origen: "nube",
  };
}

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

async function desdeFeed(): Promise<DatosMercado> {
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
  if (!feed && !catalogo) return MERCADO_VACIO;

  const precios: MapaPrecios = {};
  const meter = (
    sym: string,
    v: { eur: number; raw?: number; cur?: string; prev?: number },
    origen: string,
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
      updated_at: feed?.generated_at ?? catalogo?.generated_at ?? new Date().toISOString(),
    };
  };

  // El catálogo diario va primero para que el feed de 15 minutos lo pise.
  for (const [s, v] of Object.entries(catalogo?.precios ?? {})) meter(s, v, "catalogo");
  for (const [s, v] of Object.entries(feed?.precios ?? {})) meter(s, v, "feed");

  // Los alias ISIN/ticker → símbolo del feed son lo que permite que una
  // posición apuntada por ISIN encuentre su precio sin tocar nada más.
  //
  // Y PISAN al catálogo, no se limitan a rellenar huecos: hay tickers que
  // existen en dos mercados con precios muy distintos. «FBTC» es el ETF de
  // bitcoin de Fidelity en Estados Unidos, a unos 60 €, y también el de
  // Londres que es el que está en cartera, a unos 6,60 €. Cuando el alias
  // sólo rellenaba huecos ganaba el del catálogo y la posición aparecía valorada
  // diez veces de más, con un +625% inventado.
  for (const [alias, sym] of Object.entries(feed?.alias ?? {})) {
    const p = precios[String(sym).toUpperCase()];
    if (p) precios[alias.toUpperCase()] = p;
  }

  const fx: MapaFx = { EUR: 1 };
  for (const [c, r] of Object.entries(catalogo?.fx ?? {})) fx[c.toUpperCase()] = Number(r);

  return {
    precios,
    fx,
    catalogo: [],
    actualizado: feed?.generated_at ?? catalogo?.generated_at ?? null,
    origen: "feed",
  };
}

/** A partir de cuánto se considera que un precio de Supabase se ha quedado
 *  viejo y conviene mirar el feed. El cron rápido escribe cada 15 minutos, así
 *  que 45 son tres turnos fallados: ya no es un retraso, es que no está
 *  corriendo. */
const VIEJO_MS = 45 * 60 * 1000;

export async function cargarMercado(): Promise<DatosMercado> {
  if (hayNube) {
    try {
      const d = await desdeNube();
      if (Object.keys(d.precios).length > 0) {
        const edad = d.actualizado ? Date.now() - Date.parse(d.actualizado) : Infinity;
        if (!isFinite(edad) || edad < VIEJO_MS) return d;

        // Supabase tiene precios, pero de hace horas. Pasa cuando sólo está
        // el cron diario de Vercel —el plan Hobby no admite otra cosa— y
        // todavía no se ha configurado la GitHub Action del cuarto de hora.
        // Antes se devolvía igualmente lo de Supabase y la cartera enseñaba
        // el cierre de ayer teniendo el precio de hace diez minutos a un
        // fetch de distancia. Gana el más reciente de los dos.
        const feed = await desdeFeed();
        const edadFeed = feed.actualizado ? Date.now() - Date.parse(feed.actualizado) : Infinity;
        return edadFeed < edad ? feed : d;
      }
      // Una tabla `prices` vacía es el estado normal hasta que el cron corre
      // por primera vez: mientras tanto, mejor el feed que ningún precio.
    } catch (e) {
      console.warn("[precios] Supabase no ha respondido, se prueba el feed", e);
    }
  }
  return desdeFeed();
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
