// ── ENLACES PARA VER UN ACTIVO FUERA ─────────────────────────────────────
// TradingView para lo que cotiza en un mercado: acciones, ETF, ETC, cripto y
// materias primas. Los fondos de inversión no están en TradingView, así que
// para ellos va la ficha de quefondos por ISIN, y para un ETF sin ticker que
// se reconozca, la de justETF.
//
// Las direcciones se comprobaron una por una en septiembre de 2026: la de
// /symbols/MERCADO-TICKER/ contesta 200 en todos los mercados de la tabla, y
// sin mercado sólo funciona para Estados Unidos, donde redirige a NASDAQ o a
// NYSE. Morningstar, Finect y la ficha de Yahoo de los 0P… no resuelven un
// ISIN: por eso no están.

import type { Activo, EntradaCatalogo } from "./tipos";

export interface Enlace {
  texto: string;
  url: string;
}

const TV = "https://es.tradingview.com/symbols/";

/** Sufijo de Yahoo → mercado de TradingView. */
const MERCADO: Record<string, string> = {
  DE: "XETR",
  F: "FWB",
  AS: "EURONEXT",
  PA: "EURONEXT",
  BR: "EURONEXT",
  LS: "EURONEXT",
  IR: "EURONEXT",
  MI: "MIL",
  MC: "BME",
  L: "LSE",
  SW: "SIX",
  VI: "VIE",
  ST: "OMXSTO",
  CO: "OMXCOP",
  HE: "OMXHEX",
  OL: "OSL",
  HK: "HKEX",
  KS: "KRX",
  T: "TSE",
  TO: "TSX",
  NS: "NSE",
};

/** Los futuros de Yahoo (`GC=F`) son el contrato continuo en TradingView. */
const FUTUROS: Record<string, string> = {
  GC: "COMEX-GC1%21",
  SI: "COMEX-SI1%21",
  HG: "COMEX-HG1%21",
  CL: "NYMEX-CL1%21",
  NG: "NYMEX-NG1%21",
  PA: "NYMEX-PA1%21",
  PL: "NYMEX-PL1%21",
};

const ES_ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** La página de TradingView de un símbolo de Yahoo, o null si no la tiene:
 *  un índice, un cambio de divisa, un fondo (los `0P…` de Morningstar) o un
 *  mercado que no está en la tabla. */
export function urlTradingView(simbolo: string): string | null {
  const s = simbolo.trim().toUpperCase();
  if (!s || s.startsWith("^") || s.endsWith("=X") || s.startsWith("0P")) return null;

  const futuro = s.match(/^([A-Z]+)=F$/);
  if (futuro) return FUTUROS[futuro[1]] ? `${TV}${FUTUROS[futuro[1]]}/` : null;

  const par = s.match(/^([A-Z0-9]+)-(EUR|USD)$/);
  if (par) return `${TV}${par[1]}${par[2]}/`;

  const conMercado = s.match(/^(.+)\.([A-Z]+)$/);
  if (conMercado) {
    const [, base, sufijo] = conMercado;
    const mercado = MERCADO[sufijo];
    if (!mercado || ES_ISIN.test(base)) return null;
    // «0700.HK» es «700» en TradingView, y la clase de una acción nórdica
    // («ERIC-B.ST») va con guion bajo.
    const t = sufijo === "HK" ? base.replace(/^0+(?=\d)/, "") : base.replace(/-/g, "_");
    return `${TV}${mercado}-${encodeURIComponent(t)}/`;
  }

  if (ES_ISIN.test(s)) return null;
  // Sin sufijo es Estados Unidos, y la clase se escribe con punto: BRK.B.
  return `${TV}${encodeURIComponent(s.replace(/-/g, "."))}/`;
}

function entradaDe(a: Activo, catalogo: EntradaCatalogo[]): EntradaCatalogo | undefined {
  const t = a.ticker?.trim().toUpperCase() || undefined;
  const i = a.isin?.trim().toUpperCase() || undefined;
  const por = (campo: (c: EntradaCatalogo) => string | null, v: string | undefined) =>
    v ? catalogo.find((c) => campo(c)?.toUpperCase() === v) : undefined;
  return (
    por((c) => c.symbol, t) ??
    por((c) => c.yahoo, t) ??
    por((c) => c.ticker, t) ??
    por((c) => c.isin, i) ??
    por((c) => c.symbol, i)
  );
}

/** Dónde mirar este activo, del mejor sitio al peor. Nunca vacío salvo en el
 *  efectivo: si no hay nada mejor, una búsqueda. */
export function enlacesDe(a: Activo, catalogo: EntradaCatalogo[]): Enlace[] {
  if (a.cat === "liquidez") return [];
  const c = entradaDe(a, catalogo);
  const tickerEsIsin = a.ticker != null && ES_ISIN.test(a.ticker.trim().toUpperCase());
  const isin = (a.isin ?? c?.isin ?? (tickerEsIsin ? a.ticker : null))?.trim().toUpperCase() || null;
  const simbolo = (c?.yahoo ?? c?.symbol ?? a.ticker ?? "").trim().toUpperCase();

  const out: Enlace[] = [];

  // La cripto de verdad —no un ETC sobre ella, que cotiza en Xetra— va por su
  // par en euros.
  let tv: string | null = null;
  if (c?.coingecko) tv = `${TV}${c.symbol.toUpperCase()}EUR/`;
  else if (a.cat === "cripto" && /^[A-Z0-9]{2,10}$/.test(simbolo)) tv = `${TV}${simbolo}EUR/`;
  else if (simbolo) tv = urlTradingView(simbolo);
  if (tv) out.push({ texto: "Ver en TradingView", url: tv });

  if (isin) {
    const esFondo = a.cat === "fondo" || simbolo.startsWith("0P");
    if (esFondo) {
      out.push({
        texto: "Ficha del fondo",
        url: `https://www.quefondos.com/es/fondos/ficha/index.html?isin=${isin}`,
      });
    } else if (!tv && /^(IE|LU|JE)/.test(isin)) {
      out.push({
        texto: "Ficha en justETF",
        url: `https://www.justetf.com/es/etf-profile.html?isin=${isin}`,
      });
    }
  }

  if (out.length === 0) {
    out.push({
      texto: "Buscar en Google",
      url: `https://www.google.com/search?q=${encodeURIComponent(isin ?? a.ticker ?? a.name)}`,
    });
  }
  return out;
}
