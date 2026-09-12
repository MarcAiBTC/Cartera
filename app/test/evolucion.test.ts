// ── LA CARTERA EN EL TIEMPO ──────────────────────────────────────────────
// El gráfico «Patrimonio y dinero aportado», la rentabilidad por tiempo y la
// comparación con el S&P 500. Y las posiciones cerradas, que no son activos.

import { describe, expect, it } from "vitest";
import {
  evolucion,
  frenteAlIndice,
  rentabilidadPorTiempo,
  type Historico,
  type PuntoEvolucion,
} from "../src/lib/evolucion";
import { calcularFifo, calcularPosiciones } from "../src/lib/cartera";
import { planificar } from "../src/lib/import";
import type { Activo, Cuenta, EstadoCartera, Operacion } from "../src/lib/tipos";
import { ESTADO_VACIO } from "../src/lib/tipos";

let n = 0;
const op = (
  date: string,
  type: Operacion["type"],
  total: number,
  extra: Partial<Operacion> = {},
): Operacion => ({
  id: `o${++n}`,
  account_id: "tr",
  asset_id: null,
  type,
  date,
  quantity: null,
  price: null,
  total,
  fees: 0,
  currency: "EUR",
  total_eur: total,
  is_internal_transfer: false,
  source: "import",
  source_format: null,
  import_hash: null,
  notes: null,
  ...extra,
});

const activo = (id: string, extra: Partial<Activo> = {}): Activo => ({
  id,
  name: id,
  ticker: id,
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

// Trade Republic con su efectivo apuntado; MyInvestor sin él, y sin ningún
// ingreso: sólo la orden de compra, como el CSV de órdenes.
const ESTADO = (): EstadoCartera => ({
  ...structuredClone(ESTADO_VACIO),
  cuentas: [
    { id: "tr", name: "Trade Republic", broker: "Trade Republic" } as Cuenta,
    { id: "mi", name: "MyInvestor", broker: "MyInvestor" } as Cuenta,
  ],
  activos: [
    activo("X"),
    activo("Y"),
    activo("caja", {
      name: "Efectivo · Trade Republic",
      ticker: null,
      cat: "liquidez",
      mode: "manual",
      manual_qty: 1100,
      manual_price: 1,
      manual_cost_unit: 1,
    }),
  ],
  operaciones: [
    op("2024-01-01", "deposit", 1000),
    op("2024-01-02", "buy", 500, { asset_id: "X", quantity: 10 }),
    op("2024-02-01", "buy", 100, { asset_id: "Y", quantity: 1, account_id: "mi" }),
    op("2024-03-01", "sell", 600, { asset_id: "X", quantity: 10 }),
  ],
});

const HISTORICO: Historico = {
  desde: "2024-01-01",
  series: {
    X: [
      ["2024-01-01", 50],
      ["2024-01-29", 55],
    ],
    Y: [
      ["2024-01-29", 100],
      ["2024-02-26", 120],
    ],
  },
  sp500: [],
};

const HOY = { fecha: "2024-03-10", valor: 1220, aportado: 1100 };
const en = (p: PuntoEvolucion[], fecha: string) => p.find((x) => x.fecha === fecha)!;

describe("patrimonio y dinero aportado, semana a semana", () => {
  const puntos = evolucion(ESTADO(), HISTORICO, HOY);

  it("empieza el día de la primera operación", () => {
    expect(puntos[0]).toMatchObject({ fecha: "2024-01-01", valor: 1000, aportado: 1000 });
  });

  it("valora cada activo con el precio de esa semana", () => {
    // 10 X a 50 + 500 de efectivo.
    expect(en(puntos, "2024-01-08").valor).toBeCloseTo(1000, 6);
    // 10 X a 55 + 500 de efectivo + 1 Y a 100.
    expect(en(puntos, "2024-02-05").valor).toBeCloseTo(1150, 6);
  });

  it("una compra sin ingreso delante es dinero aportado ese día", () => {
    expect(en(puntos, "2024-01-29").aportado).toBe(1000);
    expect(en(puntos, "2024-02-05")).toMatchObject({ aportado: 1100, flujo: 100 });
  });

  it("vender no es aportar: el dinero se queda en la cuenta", () => {
    expect(en(puntos, "2024-03-04")).toMatchObject({ aportado: 1100 });
    expect(en(puntos, "2024-03-04").valor).toBeCloseTo(1100 + 120, 6);
  });

  it("el último punto es el de hoy y dice lo mismo que el resumen", () => {
    expect(puntos.at(-1)).toMatchObject({ fecha: "2024-03-10", valor: 1220, aportado: 1100 });
  });

  it("sin la historia de precios, cada activo vale lo de su última operación", () => {
    const sin = evolucion(ESTADO(), null, HOY);
    expect(en(sin, "2024-01-08").valor).toBeCloseTo(1000, 6);
    expect(en(sin, "2024-02-05").valor).toBeCloseTo(500 + 500 + 100, 6);
  });
});

describe("rentabilidad por tiempo", () => {
  const p = (fecha: string, valor: number, aportado: number, flujo: number) => ({
    fecha,
    valor,
    aportado,
    flujo,
  });

  it("un 10 % es un 10 %", () => {
    expect(
      rentabilidadPorTiempo([p("2024-01-01", 100, 100, 100), p("2024-01-08", 110, 100, 0)]),
    ).toBeCloseTo(10, 9);
  });

  it("el dinero que acaba de entrar no cuenta como ganancia", () => {
    // 100 € que suben un 10 %, y luego entran 1.000 más que no han hecho nada.
    const r = rentabilidadPorTiempo([
      p("2024-01-01", 100, 100, 100),
      p("2024-01-08", 110, 100, 0),
      p("2024-01-15", 1110, 1100, 1000),
    ]);
    expect(r).toBeCloseTo(10, 9);
  });
});

describe("contra el S&P 500", () => {
  const puntos = [
    { fecha: "2024-01-01", valor: 100, aportado: 100, flujo: 100 },
    { fecha: "2024-06-01", valor: 150, aportado: 100, flujo: 0 },
  ];

  it("mide el índice desde tu primera inversión", () => {
    const c = frenteAlIndice(puntos, [
      ["2023-12-29", 4000],
      ["2024-06-01", 5000],
    ])!;
    expect(c.desde).toBe("2024-01-01");
    expect(c.indicePct).toBeCloseTo(25, 9);
    expect(c.tuyoPct).toBeCloseTo(50, 9);
  });

  it("y cuánto valdría tu mismo dinero metido en él el mismo día", () => {
    const c = frenteAlIndice(puntos, [
      ["2023-12-29", 4000],
      ["2024-06-01", 5000],
    ])!;
    expect(c.indice).toBeCloseTo(125, 9);
    expect(c.diferencia).toBeCloseTo(25, 9);
  });

  it("si la serie empieza más tarde, lo dice", () => {
    const c = frenteAlIndice(puntos, [
      ["2024-02-01", 4000],
      ["2024-06-01", 5000],
    ])!;
    expect(c.desdeIndice).toBe("2024-02-01");
  });
});

describe("las posiciones cerradas no son activos", () => {
  const estado = (): EstadoCartera => ({
    ...structuredClone(ESTADO_VACIO),
    activos: [activo("ORO3X"), activo("NUEVO")],
    operaciones: [
      op("2025-01-01", "buy", 1, { asset_id: "ORO3X", quantity: 0.1 }),
      op("2025-01-02", "buy", 2, { asset_id: "ORO3X", quantity: 0.2 }),
      op("2025-02-01", "sell", 4, { asset_id: "ORO3X", quantity: 0.3 }),
    ],
  });

  it("vendida entera queda a cero exacto, sin restos de coma flotante", () => {
    const { saldos, realizadas } = calcularFifo(estado().operaciones);
    expect(saldos.get("ORO3X")!.qty).toBe(0);
    expect(realizadas[0].resultado).toBeCloseTo(1, 9);
  });

  it("no se lista, ni nada que esté a cero", () => {
    const e = estado();
    e.activos.push(
      activo("CUENTA", { cat: "liquidez", mode: "manual", manual_qty: 0 }),
      activo("FONDO", { mode: "manual", manual_qty: 3, manual_price: 10 }),
    );
    const ids = calcularPosiciones(e, {}, { EUR: 1 }).map((p) => p.activo.id);
    expect(ids).toEqual(["FONDO"]);
  });

  it("al importarla ya cerrada, entra archivada", () => {
    const plan = planificar(
      {
        formato: "generico-csv",
        broker: "Trade Republic",
        descartes: [],
        filas: [
          { linea: 2, fecha: "2025-01-01", tipo: "buy", isin: "IE00B8HGT870", nombre: "Gold 3x", cantidad: 5, total: 100, divisa: "EUR" },
          { linea: 3, fecha: "2025-03-01", tipo: "sell", isin: "IE00B8HGT870", nombre: "Gold 3x", cantidad: 5, total: 90, divisa: "EUR" },
        ],
      },
      { estado: structuredClone(ESTADO_VACIO), fx: { EUR: 1 } },
    );
    expect(plan.activosNuevos).toHaveLength(1);
    expect(plan.activosNuevos[0].archived).toBe(true);
  });
});
