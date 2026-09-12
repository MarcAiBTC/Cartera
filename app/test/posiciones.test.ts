// ── LA LISTA DE POSICIONES ───────────────────────────────────────────────
// El orden de la lista y de las bandas de Inicio, y adónde lleva cada enlace.

import { describe, expect, it } from "vitest";
import {
  ordenarGrupos,
  ordenarPosiciones,
  porSubyacente,
  subyacenteDe,
  type Grupo,
  type Posicion,
} from "../src/lib/cartera";
import { enlacesDe, urlTradingView } from "../src/lib/enlaces";
import type { Activo, EntradaCatalogo } from "../src/lib/tipos";

const activo = (name: string, extra: Partial<Activo> = {}): Activo => ({
  id: name,
  name,
  ticker: null,
  isin: null,
  cat: "accion",
  unit: "títulos",
  currency: "EUR",
  underlying: null,
  mode: "operations",
  manual_qty: null,
  manual_cost_unit: null,
  manual_price: null,
  archived: false,
  ...extra,
});

const pos = (
  name: string,
  valor: number | null,
  ganancia: number | null,
  gananciaPct: number | null,
  dia: number | null,
  extra: Partial<Activo> = {},
): Posicion => ({
  activo: activo(name, extra),
  qty: 1,
  coste: 0,
  costeUnit: 0,
  precio: valor,
  valor,
  ganancia,
  gananciaPct,
  dia,
  diaPct: null,
  estado: "vivo",
});

const LISTA = [
  pos("Bitcoin", 300, 100, 50, -20),
  pos("Apple", 1000, 50, 5, 4),
  pos("Efectivo · TR", 2000, 0, 0, null, { cat: "liquidez" }),
  pos("Zinc", 50, -10, -16.7, 1),
  pos("Sin precio", null, null, null, null),
];
const nombres = (ps: Posicion[]) => ps.map((p) => p.activo.name);

describe("ordenar las posiciones", () => {
  it("por tamaño, de mayor a menor; lo que no tiene precio, al final", () => {
    expect(nombres(ordenarPosiciones(LISTA, "valor"))).toEqual([
      "Efectivo · TR",
      "Apple",
      "Bitcoin",
      "Zinc",
      "Sin precio",
    ]);
  });

  it("por rentabilidad: el efectivo no tiene, y va al final en los dos sentidos", () => {
    expect(nombres(ordenarPosiciones(LISTA, "rentabilidad")).slice(0, 3)).toEqual([
      "Bitcoin",
      "Apple",
      "Zinc",
    ]);
    const asc = nombres(ordenarPosiciones(LISTA, "rentabilidad", true));
    expect(asc.slice(0, 3)).toEqual(["Zinc", "Apple", "Bitcoin"]);
    expect(asc.slice(3)).toContain("Efectivo · TR");
  });

  it("«hoy» va en euros, no en porcentaje", () => {
    expect(nombres(ordenarPosiciones(LISTA, "hoy")).slice(0, 3)).toEqual([
      "Apple",
      "Zinc",
      "Bitcoin",
    ]);
  });

  it("por nombre, como en un diccionario", () => {
    expect(nombres(ordenarPosiciones(LISTA, "nombre", true))[0]).toBe("Apple");
  });

  it("las bandas se ordenan igual, y el efectivo no tiene ganancia", () => {
    const g = (clave: string, valor: number, ganancia: number): Grupo => ({
      clave,
      etiqueta: clave,
      valor,
      coste: valor - ganancia,
      ganancia,
      gananciaPct: (ganancia / (valor - ganancia)) * 100,
      peso: 0,
      dia: 0,
      posiciones: [],
    });
    const orden = ordenarGrupos(
      [g("liquidez", 2000, 0), g("fondo", 1000, 100), g("cripto", 300, 100)],
      "ganancia",
    );
    expect(orden.map((x) => x.clave)).toEqual(["fondo", "cripto", "liquidez"]);
  });
});

describe("peso en la cartera", () => {
  it("ordena como el tamaño", () => {
    expect(nombres(ordenarPosiciones(LISTA, "peso"))).toEqual(
      nombres(ordenarPosiciones(LISTA, "valor")),
    );
  });
});

describe("de qué es cada cosa", () => {
  it("el Vanguard US 500 EUR sin subyacente cuenta como S&P 500", () => {
    expect(
      subyacenteDe(activo("Vanguard US 500 Stock Index EUR", { cat: "fondo", isin: "IE0032126645" })),
    ).toBe("S&P 500");
  });

  it("manda el activo; después, el catálogo; después, el nombre", () => {
    expect(subyacenteDe(activo("Mi fondo S&P 500", { underlying: "Otra cosa" }))).toBe("Otra cosa");
    expect(
      subyacenteDe(activo("Raro", { isin: "IE0000000001" }), [
        { symbol: "X", isin: "IE0000000001", underlying: "MSCI World" } as EntradaCatalogo,
      ]),
    ).toBe("MSCI World");
    expect(subyacenteDe(activo("Amazon.com"))).toBe("Amazon.com");
  });

  it("la plata y el oro físicos, también por el nombre; Goldman Sachs no es oro", () => {
    expect(subyacenteDe(activo("Physical Silver", { cat: "metal" }))).toBe("Plata");
    expect(subyacenteDe(activo("iShares Physical Gold", { cat: "metal" }))).toBe("Oro");
    expect(subyacenteDe(activo("Goldman Sachs"))).toBe("Goldman Sachs");
  });

  it("en la tarta, los dos Vanguard del S&P 500 van juntos", () => {
    const g = porSubyacente([
      pos("Vanguard US500 USD Acc", 500, 0, 0, null, { underlying: "S&P 500" }),
      pos("Vanguard US 500 Stock Index EUR", 1000, 0, 0, null, { cat: "fondo" }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ clave: "S&P 500", valor: 1500 });
  });
});

describe("enlaces para ver un activo", () => {
  it("de Yahoo a TradingView, mercado a mercado", () => {
    expect(urlTradingView("SXR8.DE")).toBe("https://es.tradingview.com/symbols/XETR-SXR8/");
    expect(urlTradingView("SAN.MC")).toBe("https://es.tradingview.com/symbols/BME-SAN/");
    expect(urlTradingView("IWDA.AS")).toBe("https://es.tradingview.com/symbols/EURONEXT-IWDA/");
    expect(urlTradingView("0700.HK")).toBe("https://es.tradingview.com/symbols/HKEX-700/");
    expect(urlTradingView("ERIC-B.ST")).toBe("https://es.tradingview.com/symbols/OMXSTO-ERIC_B/");
    expect(urlTradingView("AAPL")).toBe("https://es.tradingview.com/symbols/AAPL/");
    expect(urlTradingView("GC=F")).toBe("https://es.tradingview.com/symbols/COMEX-GC1%21/");
    expect(urlTradingView("BTC-EUR")).toBe("https://es.tradingview.com/symbols/BTCEUR/");
  });

  it("lo que no está en TradingView no se inventa", () => {
    expect(urlTradingView("0P00000G12.F")).toBeNull();
    expect(urlTradingView("^GSPC")).toBeNull();
    expect(urlTradingView("EURUSD=X")).toBeNull();
    expect(urlTradingView("LU1815002040.LU")).toBeNull();
    expect(urlTradingView("RARO.XX")).toBeNull();
  });

  const CATALOGO = [
    { symbol: "BTC", coingecko: "bitcoin", yahoo: null, isin: null, ticker: "BTC" },
    { symbol: "0P00000G12.F", yahoo: "0P00000G12.F", isin: "IE0032620787", coingecko: null, ticker: null },
    { symbol: "XETH.DE", yahoo: "XETH.DE", isin: "DE000A3GMKD7", coingecko: null, ticker: "XETH" },
  ] as EntradaCatalogo[];

  it("la cripto va por su par en euros; un ETC sobre ella, por su mercado", () => {
    expect(enlacesDe(activo("Bitcoin", { ticker: "BTC", cat: "cripto" }), CATALOGO)[0].url).toBe(
      "https://es.tradingview.com/symbols/BTCEUR/",
    );
    expect(
      enlacesDe(activo("ETC Ether", { isin: "DE000A3GMKD7", cat: "cripto" }), CATALOGO)[0].url,
    ).toBe("https://es.tradingview.com/symbols/XETR-XETH/");
  });

  it("un fondo, a su ficha por ISIN, aunque sólo tenga el ISIN", () => {
    const e = enlacesDe(activo("Vanguard US 500", { isin: "IE0032620787", cat: "fondo" }), CATALOGO);
    expect(e).toEqual([
      {
        texto: "Ficha del fondo",
        url: "https://www.quefondos.com/es/fondos/ficha/index.html?isin=IE0032620787",
      },
    ]);
  });

  it("el efectivo no tiene adónde ir; lo desconocido, a una búsqueda", () => {
    expect(enlacesDe(activo("Efectivo", { cat: "liquidez" }), [])).toEqual([]);
    expect(enlacesDe(activo("Warrant raro", { isin: "DE000XX00000" }), [])[0].texto).toBe(
      "Buscar en Google",
    );
  });
});
