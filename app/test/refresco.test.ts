// ── EL BOTÓN DE ACTUALIZAR PRECIOS ──────────────────────────────────────
// Qué símbolos pide el servidor para una cartera, y cómo se juntan después
// los precios de Supabase con los del resumen público. Lo que va a Yahoo no
// se prueba aquí: necesita red.

import { describe, expect, it } from "vitest";
import { simbolosDeCartera, type EntradaCat } from "../api/_lib/refresco";
import { mezclar, type DeFeed, type DeNube } from "../src/lib/precios";
import type { EntradaCatalogo, Precio } from "../src/lib/tipos";

const cat = (
  symbol: string,
  yahoo: string | null,
  isin: string | null,
  extra: Partial<EntradaCat> = {},
): EntradaCat => ({ symbol, yahoo, isin, coingecko: null, ticker: null, ...extra });

const CATALOGO = [
  cat("XETH.DE", "XETH.DE", null),
  cat("CH1315732268", "XETH.DE", "CH1315732268"),
  cat("0P00000SUJ.F", "0P00000SUJ.F", "IE0032126645"),
  cat("CABK.MC", "CABK.MC", "ES0140609019", { ticker: "CABK" }),
  cat("BTC", null, null, { coingecko: "bitcoin", ticker: "BTC" }),
];

const claves = (activos: { ticker: string | null; isin: string | null }[]) =>
  simbolosDeCartera(activos, CATALOGO)
    .simbolos.map((s) => s.symbol)
    .sort();

describe("qué cotiza el botón", () => {
  it("un valor del catálogo, con su símbolo y con su alias ISIN", () => {
    expect(claves([{ ticker: "XETH.DE", isin: "CH1315732268" }])).toEqual([
      "CH1315732268",
      "XETH.DE",
    ]);
    const { simbolos } = simbolosDeCartera([{ ticker: "XETH.DE", isin: null }], CATALOGO);
    expect(simbolos.every((s) => s.yahoo === "XETH.DE")).toBe(true);
  });

  it("un fondo guardado sólo con su ISIN encuentra su símbolo", () => {
    expect(claves([{ ticker: null, isin: "IE0032126645" }])).toEqual(["0P00000SUJ.F"]);
  });

  it("el ticker corto, por la columna ticker del catálogo", () => {
    expect(claves([{ ticker: "CABK", isin: null }])).toEqual(["CABK.MC"]);
  });

  it("la cripto va por CoinGecko", () => {
    const { simbolos } = simbolosDeCartera([{ ticker: "BTC", isin: null }], CATALOGO);
    expect(simbolos).toEqual([{ symbol: "BTC", yahoo: null, coingecko: "bitcoin" }]);
  });

  it("lo que no está en el catálogo se prueba tal cual, salvo un ISIN pelado", () => {
    const r = simbolosDeCartera(
      [
        { ticker: "AMZN", isin: null },
        { ticker: null, isin: "US0000000001" },
      ],
      CATALOGO,
    );
    expect(r.simbolos).toEqual([{ symbol: "AMZN", yahoo: "AMZN", coingecko: null }]);
    expect(r.sinTraducir).toEqual(["US0000000001"]);
  });
});

const precio = (symbol: string, eur: number, updated_at: string): Precio => ({
  symbol,
  eur,
  raw: eur,
  currency: "EUR",
  prev: null,
  name: null,
  source: "prueba",
  updated_at,
});

const entrada = (symbol: string, isin: string, yahoo: string): EntradaCatalogo => ({
  symbol,
  name: null,
  isin,
  ticker: null,
  yahoo,
  coingecko: null,
  currency: null,
  cat: null,
  underlying: null,
  retired: false,
});

const nube = (precios: Precio[], catalogo: EntradaCatalogo[] = []): DeNube => ({
  precios: Object.fromEntries(precios.map((p) => [p.symbol, p])),
  fx: { EUR: 1, USD: 0.85 },
  fxFecha: "2026-09-10T15:00:00Z",
  catalogo,
});
const feed = (precios: Precio[], alias: Record<string, string> = {}): DeFeed => ({
  precios: Object.fromEntries(precios.map((p) => [p.symbol, p])),
  alias,
  fx: { EUR: 1, USD: 0.86 },
  fxFecha: "2026-09-12T05:00:00Z",
});

describe("juntar Supabase y el resumen público", () => {
  it("símbolo a símbolo gana el precio más reciente", () => {
    const m = mezclar(
      nube([precio("A", 1, "2026-09-12T10:00:00Z"), precio("B", 2, "2026-09-12T12:00:00Z")]),
      feed([precio("A", 1.5, "2026-09-12T11:00:00Z"), precio("C", 3, "2026-09-11T11:00:00Z")]),
    );
    expect(m.precios.A.eur).toBe(1.5);
    expect(m.precios.B.eur).toBe(2);
    expect(m.precios.C.eur).toBe(3);
    expect(m.actualizado).toBe("2026-09-12T12:00:00Z");
    // Las divisas, de la fuente más reciente.
    expect(m.fx.USD).toBe(0.86);
  });

  it("los alias apuntan al precio que gana, venga de donde venga", () => {
    const m = mezclar(
      nube([precio("FBTC.L", 6.9, "2026-09-12T12:00:00Z")]),
      feed([precio("FBTC.L", 6.5, "2026-09-12T08:00:00Z")], {
        FBTC: "FBTC.L",
        XS2434891219: "FBTC.L",
      }),
    );
    expect(m.precios.FBTC.eur).toBe(6.9);
    expect(m.precios.XS2434891219.eur).toBe(6.9);
  });

  it("una fila vieja con el ISIN no tapa el precio nuevo de su símbolo", () => {
    const m = mezclar(
      nube(
        [precio("IE0032126645", 80, "2026-09-10T15:00:00Z")],
        [entrada("0P00000SUJ.F", "IE0032126645", "0P00000SUJ.F")],
      ),
      feed([precio("0P00000SUJ.F", 81.04, "2026-09-12T08:00:00Z")]),
    );
    expect(m.precios.IE0032126645.eur).toBe(81.04);
  });

  it("sin ninguna de las dos fuentes, no hay mercado", () => {
    expect(mezclar(null, null).origen).toBe("ninguno");
  });
});
