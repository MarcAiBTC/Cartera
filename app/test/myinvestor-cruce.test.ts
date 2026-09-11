// ── LAS ÓRDENES Y LA CUENTA CORRIENTE, SUBIDAS JUNTAS ───────────────────
// Cada suscripción de fondo sale en los dos archivos. Juntos contaban doble;
// ahora de la cuenta se quedan el dinero y lo que no son fondos —los ETC de
// la cuenta de valores—, y esos ETC se buscan en el catálogo por su nombre
// cortado. Los datos imitan la forma de los archivos reales, sin nada que
// identifique a nadie.

import { describe, expect, it } from "vitest";
import { combinar, desdeTexto, entradaPorNombre, leer, planificar } from "../src/lib/import";
import { simular } from "../src/lib/import/simular";
import { calcularPosiciones } from "../src/lib/cartera";
import type { EntradaCatalogo, EstadoCartera, Precio } from "../src/lib/tipos";
import { ESTADO_VACIO } from "../src/lib/tipos";

const CAB_ORDENES = "Fecha de la orden;ISIN;Importe estimado;Nº de participaciones;Estado";
const CAB_CUENTA = "Fecha de operación;Fecha de valor;Concepto;Importe;Divisa";

const ORDENES = `${CAB_ORDENES}
10/08/2026;IE0032126645;50 EUR;0,61;Finalizada
03/08/2026;IE0032126645;50 EUR;0,61;Finalizada
27/07/2026;IE0032126645;50 EUR;0,63;Finalizada
27/07/2026;LU0625737910;5 EUR;0,037;Finalizada
27/08/2025;IE0002639668;10 USD;0,12;Finalizada
20/08/2025;IE0002639668;10 USD;0,13;Finalizada`;

// El cargo llega de dos a cuatro días después de la orden, con el nombre
// cortado a 30 caracteres. Los fondos en dólares se cargan en euros.
const CUENTA = `${CAB_CUENTA}
12/08/2026;13/08/2026;VANGUARD US 500 STOCK INDEX EU;-50;EUR
05/08/2026;06/08/2026;VANGUARD US 500 STOCK INDEX EU;-50;EUR
31/07/2026;03/08/2026;VANGUARD US 500 STOCK INDEX EU;-50;EUR
30/07/2026;31/07/2026;PICTET-CHINA IX P EUR @ 0.0368;-4,99;EUR
30/07/2026;30/07/2026;Envio de dinero - imaginBank;250;EUR
12/07/2026;11/07/2026;PERIODO 11/06/2026 11/07/2026;0,06;EUR
22/01/2026;26/01/2026;X GALAXY PHY ETHEREUM ETC @ 1;-7,54;EUR
22/01/2026;26/01/2026;FIDELITY PHYSICAL BITCOIN ET @;-14,95;EUR
23/12/2025;29/12/2025;X GALAXY PHY ETHEREUM ETC @ 2;-15,05;EUR
01/12/2025;03/12/2025;FIDELITY PHYSICAL BITCOIN ET @;-14,64;EUR
01/09/2025;03/09/2025;FIDELITY PHYSICAL BITCOIN ET @;-9,05;EUR
29/08/2025;01/09/2025;VANGUARD US 500 STOCK IND USD;-8,55;EUR
22/08/2025;25/08/2025;VANGUARD US 500 STOCK IND USD;-8,61;EUR
01/08/2025;01/08/2025;Envio de dinero - imaginBank;300;EUR`;

const entrada = (
  symbol: string,
  name: string | null,
  isin: string | null,
  yahoo = symbol,
): EntradaCatalogo => ({
  symbol,
  name,
  isin,
  ticker: null,
  yahoo,
  coingecko: null,
  currency: null,
  cat: null,
  underlying: null,
  retired: false,
});

const catalogo = (): EntradaCatalogo[] => [
  entrada("FBTC.L", "Fidelity Physical Bitcoin ETP", "XS2434891219"),
  // El ISIN del Ethereum va en la fila del alias, como en el catálogo real.
  entrada("XETH.DE", "Xtrackers Galaxy Physical Ethereum", null),
  entrada("CH1315732268", null, "CH1315732268", "XETH.DE"),
  entrada("IGLN.L", "iShares Physical Gold ETC", "IE00B4ND3602"),
  entrada("GBSE.MI", "WisdomTree Physical Gold EUR Hedged", "JE00B8DFY052"),
  entrada("3GOL.L", "WisdomTree Gold 3x Daily Leveraged", "IE00B8HGT870"),
  entrada("0P00000G12.F", "Vanguard US500 EUR Acc", "IE0032620787"),
];

const precio = (symbol: string, eur: number): Precio => ({
  symbol,
  eur,
  raw: eur,
  currency: "EUR",
  prev: null,
  name: null,
  source: "prueba",
  updated_at: "2026-09-11",
});

const vacio = (): EstadoCartera => structuredClone(ESTADO_VACIO);
const FX = { EUR: 1, USD: 0.86 };

const juntas = (ordenes = ORDENES, cuenta = CUENTA) =>
  combinar([leer(desdeTexto(ordenes, "ordenes.csv")), leer(desdeTexto(cuenta, "cuenta.csv"))]);

describe("órdenes y cuenta corriente juntas", () => {
  it("las suscripciones de fondos entran una sola vez: por las órdenes", () => {
    const l = juntas();
    const deLaCuenta = l.filas.filter((f) => f.formato === "myinvestor-cuenta");
    expect(deLaCuenta.some((f) => /VANGUARD|PICTET/.test(f.nombre ?? ""))).toBe(false);
    expect(l.filas.filter((f) => f.formato === "myinvestor-ordenes")).toHaveLength(6);
  });

  it("de la cuenta se quedan el dinero y los ETC", () => {
    const deLaCuenta = juntas().filas.filter((f) => f.formato === "myinvestor-cuenta");
    expect(deLaCuenta.filter((f) => f.tipo === "deposit")).toHaveLength(2);
    expect(deLaCuenta.filter((f) => f.tipo === "interest")).toHaveLength(1);
    expect(deLaCuenta.filter((f) => f.tipo === "buy").map((f) => f.nombre).sort()).toEqual([
      "FIDELITY PHYSICAL BITCOIN ET",
      "FIDELITY PHYSICAL BITCOIN ET",
      "FIDELITY PHYSICAL BITCOIN ET",
      "X GALAXY PHY ETHEREUM ETC",
      "X GALAXY PHY ETHEREUM ETC",
    ]);
  });

  it("retira el aviso de «sin participaciones» de los fondos que ya traen las órdenes", () => {
    const { descartes } = juntas();
    expect(descartes.some((d) => d.clave === "VANGUARD US 500 STOCK INDEX EU")).toBe(false);
    // El del bitcoin sigue: sus compras sí entran por la cuenta, y sin títulos.
    expect(descartes.some((d) => d.clave === "FIDELITY PHYSICAL BITCOIN ET")).toBe(true);
  });

  it("un ETC que cae junto a una orden no se toma por fondo: decide la mayoría", () => {
    // La compra de 9,05 € casa por fecha y cambio con la orden de 10 USD,
    // pero las otras dos compras del mismo producto no casan con nada.
    const l = juntas(
      `${CAB_ORDENES}
29/08/2025;IE0002639668;10 USD;0,12;Finalizada`,
      `${CAB_CUENTA}
20/10/2025;22/10/2025;FIDELITY PHYSICAL BITCOIN ET @;-18,71;EUR
14/10/2025;15/10/2025;FIDELITY PHYSICAL BITCOIN ET @;-9,69;EUR
01/09/2025;03/09/2025;FIDELITY PHYSICAL BITCOIN ET @;-9,05;EUR`,
    );
    expect(l.filas.filter((f) => f.nombre === "FIDELITY PHYSICAL BITCOIN ET")).toHaveLength(3);
  });

  it("un abono del fondo en la cuenta convierte la orden en reembolso", () => {
    // Las órdenes no dicen si es compra o venta. Los 100 € que VUELVEN a la
    // cuenta el día 18 dicen que la orden del 15 fue un reembolso.
    const l = juntas(
      `${CAB_ORDENES}
15/05/2026;IE0032126645;100 EUR;1,2;Finalizada
01/05/2026;IE0032126645;200 EUR;2,4;Finalizada`,
      `${CAB_CUENTA}
18/05/2026;19/05/2026;VANGUARD US 500 STOCK INDEX EU;100;EUR
04/05/2026;05/05/2026;VANGUARD US 500 STOCK INDEX EU;-200;EUR`,
    );
    const orden = l.filas.find((f) => f.fecha === "2026-05-15")!;
    expect(orden.tipo).toBe("sell");
    expect(orden.traspasoInterno).toBe(false);
    expect(l.filas.find((f) => f.fecha === "2026-05-01")!.tipo).toBe("buy");
    expect(l.filas.some((f) => f.formato === "myinvestor-cuenta")).toBe(false);
  });

  it("el efectivo sale solo: ingresos y cobros menos fondos y ETC", () => {
    const plan = planificar(juntas(), { estado: vacio(), fx: FX, catalogo: catalogo() });
    // 550,06 − (150 + 5 + 2 × 10 USD a 0,86) − (7,54 + 14,95 + 15,05 + 14,64 + 9,05)
    expect(plan.efectivo?.origen).toBe("calculado");
    expect(plan.efectivo?.saldo).toBeCloseTo(316.63, 2);
  });
});

describe("los ETC, por su nombre cortado", () => {
  it("encuentra cada uno en el catálogo", () => {
    const c = catalogo();
    const sym = (n: string) => entradaPorNombre(n, c)?.symbol;
    expect(sym("FIDELITY PHYSICAL BITCOIN ET")).toBe("FBTC.L");
    expect(sym("X GALAXY PHY ETHEREUM ETC")).toBe("XETH.DE");
    expect(sym("ETC ISHARES PHYSICAL GOLD")).toBe("IGLN.L");
    expect(sym("WT PHYSICAL GOLD-EUR DLY HDG")).toBe("GBSE.MI");
  });

  it("no se inventa uno cuando el parecido es de marca y poco más", () => {
    const c = catalogo();
    expect(entradaPorNombre("WISDOMTREE PHYSICAL SILVER", c)).toBeUndefined();
    expect(entradaPorNombre("VANGUARD US 500 STOCK EUR", c)).toBeUndefined();
  });

  it("nacen con el nombre entero, el ISIN y el símbolo que cotiza", () => {
    const plan = planificar(juntas(), { estado: vacio(), fx: FX, catalogo: catalogo() });
    const eth = plan.activosNuevos.find((a) => a.ticker === "XETH.DE")!;
    expect(eth.name).toBe("Xtrackers Galaxy Physical Ethereum");
    expect(eth.isin).toBe("CH1315732268");
    expect(eth.cat).toBe("cripto");
    // Tres unidades leídas del «@» y un precio: nada que preguntar.
    expect(plan.sinCubrir.some((c) => c.clave === "X GALAXY PHY ETHEREUM ETC")).toBe(false);
    // El bitcoin no dice cuántas unidades: eso sí se pregunta. (Los fondos
    // también, porque este catálogo de prueba no les da precio.)
    expect(plan.sinCubrir.map((c) => c.clave)).toContain("FIDELITY PHYSICAL BITCOIN ET");
  });

  it("sus compras caen en él aunque lleguen con el nombre cortado", () => {
    const precios = { "XETH.DE": precio("XETH.DE", 6.25) };
    const plan = planificar(juntas(), { estado: vacio(), fx: FX, catalogo: catalogo(), precios });
    const { estado } = simular(plan, vacio());
    expect(estado.operaciones.filter((o) => o.asset_id == null && o.type === "buy")).toHaveLength(0);
    const eth = calcularPosiciones(estado, precios, FX).find((p) => p.activo.ticker === "XETH.DE")!;
    expect(eth.qty).toBe(3);
    expect(eth.valor).toBeCloseTo(18.75, 9);
    expect(eth.coste).toBeCloseTo(7.54 + 15.05, 9);
  });

  it("con lo que vale hoy y el precio, saca las unidades y sigue cotizando", () => {
    const precios = { "FBTC.L": precio("FBTC.L", 7.5) };
    const plan = planificar(juntas(), {
      estado: vacio(),
      fx: FX,
      catalogo: catalogo(),
      precios,
      valores: { "FIDELITY PHYSICAL BITCOIN ET": 30 },
    });
    const btc = plan.activosNuevos.find((a) => a.name === "Fidelity Physical Bitcoin ETP")!;
    expect(btc).toMatchObject({ mode: "manual", ticker: "FBTC.L", unit: "títulos" });
    expect(btc.manual_qty).toBeCloseTo(4, 9);
    // El coste, de las compras: 14,95 + 14,64 + 9,05 entre 4 unidades.
    expect(btc.manual_cost_unit).toBeCloseTo(38.64 / 4, 9);

    const { estado } = simular(plan, vacio());
    const pos = calcularPosiciones(estado, precios, FX).find((p) => p.activo.ticker === "FBTC.L")!;
    expect(pos.valor).toBeCloseTo(30, 9);
  });

  it("sin precio para hacer la cuenta, entra como valor fijo y sin símbolo", () => {
    const plan = planificar(juntas(), {
      estado: vacio(),
      fx: FX,
      catalogo: catalogo(),
      valores: { "FIDELITY PHYSICAL BITCOIN ET": 30 },
    });
    const btc = plan.activosNuevos.find((a) => a.name === "Fidelity Physical Bitcoin ETP")!;
    expect(btc).toMatchObject({ ticker: null, isin: null, manual_qty: 1, unit: "posición" });
    expect(btc.manual_price).toBe(30);
  });
});
