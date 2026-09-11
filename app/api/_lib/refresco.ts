// ── COTIZAR UNA LISTA DE SÍMBOLOS ────────────────────────────────────────
// Lo comparten el cron, que cotiza el catálogo entero cada cuarto de hora, y
// /api/refrescar, que cotiza sólo lo que tiene una persona cuando pulsa el
// botón. Tenerlo en un sitio es lo que impide que los dos acaben poniendo
// precios distintos al mismo valor.
//
// Un símbolo que falla NO borra su precio anterior: simplemente no se
// escribe, y en `prices` se queda el último bueno. El fallo se cuenta aparte.

import { Cambios, coingecko, dormir, yahoo } from "./mercado.js";

export interface Simbolo {
  /** La clave con la que se guarda en `prices` */
  symbol: string;
  yahoo: string | null;
  coingecko: string | null;
}

export interface EntradaCat {
  symbol: string;
  yahoo: string | null;
  coingecko: string | null;
  isin: string | null;
  ticker?: string | null;
}

export interface FilaPrecio {
  symbol: string;
  eur: number;
  raw: number;
  currency: string;
  prev: number | null;
  source: string;
  updated_at: string;
}

const agrupar = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
};

/** Qué hay que cotizar para que ESTOS activos tengan precio.
 *
 *  Un activo se reconoce por su ticker o por su ISIN, y el catálogo puede
 *  tenerlo en dos filas: la del símbolo («XETH.DE») y la del alias ISIN →
 *  símbolo («CH1315732268»). Se escriben las dos, porque la app busca el
 *  precio por el ticker y, si no lo tiene, por el ISIN.
 *
 *  Lo que no está en el catálogo se prueba tal cual en Yahoo —para AMZN o
 *  MSTR acierta a la primera—, salvo un ISIN pelado, que en Yahoo da 404
 *  siempre: ése se devuelve en `sinTraducir` para que se vea. */
export function simbolosDeCartera(
  activos: { ticker: string | null; isin: string | null }[],
  catalogo: EntradaCat[],
): { simbolos: Simbolo[]; sinTraducir: string[] } {
  const porSimbolo = new Map<string, EntradaCat>();
  const porOtro = new Map<string, EntradaCat[]>();
  const porIsin = new Map<string, EntradaCat[]>();
  for (const c of catalogo) {
    porSimbolo.set(c.symbol.toUpperCase(), c);
    if (c.yahoo) agrupar(porOtro, c.yahoo.toUpperCase(), c);
    if (c.ticker) agrupar(porOtro, c.ticker.toUpperCase(), c);
    if (c.isin) agrupar(porIsin, c.isin.toUpperCase(), c);
  }

  const out = new Map<string, Simbolo>();
  const sinTraducir = new Set<string>();
  for (const a of activos) {
    const t = a.ticker?.trim().toUpperCase() || undefined;
    const i = a.isin?.trim().toUpperCase() || undefined;
    const suyos = [
      ...(t && porSimbolo.has(t) ? [porSimbolo.get(t)!] : []),
      ...(t ? (porOtro.get(t) ?? []) : []),
      ...(i && porSimbolo.has(i) ? [porSimbolo.get(i)!] : []),
      ...(i ? (porIsin.get(i) ?? []) : []),
    ];
    for (const c of suyos) {
      const s = c.symbol.toUpperCase();
      out.set(s, { symbol: s, yahoo: c.yahoo, coingecko: c.coingecko });
    }
    if (suyos.length > 0) continue;
    if (t) out.set(t, { symbol: t, yahoo: t, coingecko: null });
    else if (i) sinTraducir.add(i);
  }
  return { simbolos: [...out.values()], sinTraducir: [...sinTraducir] };
}

export interface Cotizadas {
  filas: FilaPrecio[];
  fallos: string[];
  /** Euros por unidad de cada divisa que ha hecho falta */
  tasas: Record<string, number>;
}

/** Pide los precios y los deja en euros, listos para `prices`.
 *
 *  La cripto va en una sola llamada a CoinGecko. El resto, por Yahoo, UNA
 *  petición por símbolo de Yahoo aunque varias claves lo compartan: el
 *  símbolo y su alias ISIN son el mismo precio, y pedirlo dos veces sólo
 *  gastaba cuota.
 *
 *  `simultaneas` y `pausa` son el ritmo: el cron, con quinientos símbolos, va
 *  de uno en uno y con pausa, porque Yahoo castiga las ráfagas; el botón, con
 *  veinte, puede ir de cuatro en cuatro y contestar en unos segundos. */
export async function cotizar(
  simbolos: Simbolo[],
  op: { ahora: string; simultaneas?: number; pausa?: number },
): Promise<Cotizadas> {
  const filas: FilaPrecio[] = [];
  const fallos: string[] = [];
  const cambios = new Cambios();
  const texto = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // ── Cripto, en una sola llamada ───────────────────────────────────────
  const cripto = simbolos.filter((s) => s.coingecko);
  if (cripto.length > 0) {
    try {
      const d = await coingecko(cripto.map((s) => s.coingecko!));
      for (const s of cripto) {
        const p = d[s.coingecko!];
        if (!p) {
          fallos.push(`${s.symbol}: CoinGecko no lo conoce`);
          continue;
        }
        filas.push({
          symbol: s.symbol,
          eur: p.eur,
          raw: p.eur,
          currency: "EUR",
          prev: p.previo,
          source: "coingecko",
          updated_at: op.ahora,
        });
      }
    } catch (e) {
      fallos.push(`coingecko: ${texto(e)}`);
    }
  }

  // ── El resto, por Yahoo ───────────────────────────────────────────────
  const hechos = new Set(filas.map((f) => f.symbol));
  const grupos = new Map<string, string[]>();
  for (const s of simbolos) {
    if (hechos.has(s.symbol) || s.coingecko || !s.yahoo) continue;
    agrupar(grupos, s.yahoo, s.symbol);
  }
  const cola = [...grupos];

  const trabajar = async () => {
    for (let x = cola.shift(); x; x = cola.shift()) {
      const [simbolo, claves] = x;
      try {
        const q = await yahoo(simbolo);
        const tasa = await cambios.aEuros(q.divisa);
        for (const symbol of claves) {
          filas.push({
            symbol,
            eur: q.precio * tasa,
            raw: q.precio,
            currency: q.divisa,
            prev: q.previo != null ? q.previo * tasa : null,
            source: "yahoo",
            updated_at: op.ahora,
          });
        }
      } catch (e) {
        for (const symbol of claves) fallos.push(`${symbol}: ${texto(e)}`);
      }
      if (op.pausa) await dormir(op.pausa);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, op.simultaneas ?? 1) }, trabajar));

  return { filas, fallos, tasas: cambios.todas() };
}
