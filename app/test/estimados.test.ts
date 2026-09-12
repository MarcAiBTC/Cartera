// ── LO QUE EL ARCHIVO NO TRAE ────────────────────────────────────────────
// El oro de Revolut, que dice las onzas y no los euros; los ETC de MyInvestor,
// que dicen los euros y no los títulos; la misma operación en dos bancos; y
// qué se va al borrar uno.

import { describe, expect, it } from "vitest";
import { desdeTexto, detectar, huella, leer, planificar, type Lectura } from "../src/lib/import";
import { loDeLaCuenta } from "../src/lib/cartera";
import type { Activo, Cuenta, EstadoCartera, Operacion } from "../src/lib/tipos";
import { ESTADO_VACIO } from "../src/lib/tipos";

const vacio = (): EstadoCartera => structuredClone(ESTADO_VACIO);

describe("el oro de Revolut, que sólo dice las onzas", () => {
  const CSV = [
    "Tipo,Producto,Fecha de inicio,Fecha de finalización,Descripción,Importe,Comisión,Divisa,State,Saldo",
    "Cambio,Actual,2025-06-30 14:54:36,2025-06-30 14:54:36,Conversión a XAU,0.035521,0.000353,XAU,COMPLETADO,0.035168",
    "Cambio,Actual,2026-03-20 20:39:33,2026-03-20 20:39:33,Conversión a XAU,0.012618,0.000252,XAU,COMPLETADO,0.047534",
  ].join("\n");
  const e = desdeTexto(CSV, "account-statement.csv");
  const lectura = leer(e, { formato: detectar(e) });

  it("cada conversión es una compra de oro en onzas, todavía sin euros", () => {
    const compras = lectura.filas.filter((f) => f.tipo === "buy");
    expect(compras).toHaveLength(2);
    expect(compras[0]).toMatchObject({
      ticker: "GC=F",
      unidad: "oz",
      estimarImporte: 0.035521,
    });
    // Lo recibido: la comisión va en onzas.
    expect(compras[0].cantidad).toBeCloseTo(0.035168, 9);
    expect(lectura.descartes).toHaveLength(0);
  });

  it("y la paga un ingreso de fuera: sale de la cuenta corriente, no del extracto", () => {
    const pagos = lectura.filas.filter((f) => f.tipo === "deposit");
    expect(pagos).toHaveLength(2);
    expect(pagos[0]).toMatchObject({ estimarImporte: 0.035521, estimarCon: "GC=F" });
    // Sin ticker ni nombre: si no, el ingreso caería en el activo del oro.
    expect(pagos[0].ticker).toBeUndefined();
    expect(pagos[0].nombre).toBeUndefined();
  });

  it("sin el cierre de ese día no entra: lo pide", () => {
    const plan = planificar(lectura, { estado: vacio(), fx: { EUR: 1 } });
    expect(plan.nuevas).toHaveLength(0);
    expect(plan.faltanCierres).toEqual([{ simbolo: "GC=F", desde: "2025-06-30" }]);
  });

  it("con el cierre, cuesta lo que valían las onzas ese día", () => {
    const plan = planificar(lectura, {
      estado: vacio(),
      fx: { EUR: 1 },
      cierres: {
        "GC=F": [
          ["2025-06-27", 2800],
          ["2026-03-20", 3500],
        ],
      },
    });
    expect(plan.faltanCierres).toEqual([]);
    expect(plan.nuevas).toHaveLength(4);
    const compras = plan.nuevas.filter((p) => p.operacion.type === "buy");
    expect(compras[0].operacion.total_eur).toBeCloseTo(0.035521 * 2800, 6);
    expect(compras[1].operacion.total_eur).toBeCloseTo(0.012618 * 3500, 6);
    expect(plan.activosNuevos).toHaveLength(1);
    expect(plan.activosNuevos[0]).toMatchObject({ ticker: "GC=F", unit: "oz", cat: "metal" });
    // Lo que cuesta entra de fuera: el efectivo de la cuenta no se mueve.
    expect(plan.efectivo?.saldo).toBeCloseTo(0, 6);
    // Y el ingreso no cuelga del activo del oro.
    expect(plan.nuevas.find((p) => p.operacion.type === "deposit")?.nuevoActivo).toBeUndefined();
  });

  it("si el precio no llega, lo dice en vez de meterlo a cero", () => {
    const plan = planificar(lectura, { estado: vacio(), fx: { EUR: 1 }, cierres: { "GC=F": [] } });
    expect(plan.nuevas).toHaveLength(0);
    expect(plan.faltanCierres).toEqual([]);
    expect(plan.descartes.some((d) => d.motivo.includes("no cuántos euros"))).toBe(true);
  });
});

describe("los ETC de MyInvestor, que llegan sin participaciones", () => {
  const lectura: Lectura = {
    formato: "myinvestor-cuenta",
    broker: "MyInvestor",
    descartes: [],
    filas: [
      { linea: 2, fecha: "2026-01-05", tipo: "buy", ticker: "FBTC.L", total: 10, divisa: "EUR" },
      { linea: 3, fecha: "2026-02-02", tipo: "buy", ticker: "FBTC.L", total: 20, divisa: "EUR" },
    ],
  };
  const cierres: Record<string, [string, number][]> = {
    "FBTC.L": [
      ["2026-01-05", 5],
      ["2026-02-02", 4],
    ],
  };

  it("los títulos de cada orden salen del cierre de su día", () => {
    const plan = planificar(lectura, { estado: vacio(), fx: { EUR: 1 }, cierres });
    expect(plan.nuevas.map((p) => p.operacion.quantity)).toEqual([2, 5]);
    expect(plan.estimados).toEqual([
      expect.objectContaining({ clave: "FBTC.L", ops: 2, titulos: 7 }),
    ]);
    // Con títulos y con precio, ya no hay que preguntar cuánto vale.
    expect(plan.sinCubrir).toHaveLength(0);
  });

  it("con lo que dice el banco, se reparten en su proporción", () => {
    const plan = planificar(lectura, {
      estado: vacio(),
      fx: { EUR: 1 },
      cierres,
      titulos: { "FBTC.L": 7.7 },
    });
    const q = plan.nuevas.map((p) => p.operacion.quantity!);
    expect(q[0]).toBeCloseTo(2.2, 9);
    expect(q[1]).toBeCloseTo(5.5, 9);
    expect(plan.estimados[0]).toMatchObject({ declarados: 7.7 });
    expect(plan.estimados[0].titulos).toBeCloseTo(7.7, 9);
  });

  it("sin cierres, los pide desde la primera orden", () => {
    const plan = planificar(lectura, { estado: vacio(), fx: { EUR: 1 } });
    expect(plan.faltanCierres).toEqual([{ simbolo: "FBTC.L", desde: "2026-01-05" }]);
  });
});

let n = 0;
const operacion = (p: Partial<Operacion>): Operacion => ({
  id: `o${++n}`,
  account_id: null,
  asset_id: null,
  type: "deposit",
  date: "2025-10-01",
  quantity: null,
  price: null,
  total: 100,
  fees: 0,
  currency: "EUR",
  total_eur: 100,
  is_internal_transfer: false,
  source: "import",
  source_format: null,
  import_hash: null,
  notes: null,
  ...p,
});

describe("la misma operación en dos bancos", () => {
  const fila = { linea: 2, fecha: "2025-10-01", tipo: "deposit" as const, total: 100, divisa: "EUR" };
  const estado = (): EstadoCartera => ({
    ...vacio(),
    cuentas: [{ id: "tr", name: "Trade Republic", broker: "Trade Republic", currency: "EUR" }],
    operaciones: [operacion({ account_id: "tr", import_hash: huella(fila) })],
  });
  const lectura = (broker: string): Lectura => ({
    formato: "revolut-csv",
    broker,
    descartes: [],
    filas: [fila],
  });

  it("un ingreso igual en otro banco no se toma por ya importado", () => {
    const plan = planificar(lectura("Revolut"), { estado: estado(), fx: { EUR: 1 } });
    expect(plan.nuevas).toHaveLength(1);
    // Y lleva otra huella: la base no admite dos iguales.
    expect(plan.nuevas[0].operacion.import_hash).not.toBe(huella(fila));
  });

  it("reimportado en su banco, sí lo es", () => {
    const plan = planificar(lectura("Trade Republic"), { estado: estado(), fx: { EUR: 1 } });
    expect(plan.nuevas).toHaveLength(0);
    expect(plan.duplicadas).toHaveLength(1);
  });

  it("y reimportar el de Revolut lo reconoce por su huella marcada", () => {
    const primera = planificar(lectura("Revolut"), { estado: estado(), fx: { EUR: 1 } });
    const e = estado();
    e.cuentas.push({ id: "rv", name: "Revolut", broker: "Revolut", currency: "EUR" } as Cuenta);
    e.operaciones.push(
      operacion({ account_id: "rv", import_hash: primera.nuevas[0].operacion.import_hash! }),
    );
    const otra = planificar(lectura("Revolut"), { estado: e, fx: { EUR: 1 } });
    expect(otra.nuevas).toHaveLength(0);
  });
});

describe("borrar un banco", () => {
  const activo = (id: string, extra: Partial<Activo> = {}): Activo => ({
    id,
    name: id,
    ticker: null,
    isin: null,
    cat: "fondo",
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

  it("se lleva sus operaciones, lo que sólo es suyo y su efectivo; lo compartido se queda", () => {
    const e: EstadoCartera = {
      ...vacio(),
      cuentas: [
        { id: "mi", name: "MyInvestor", broker: "MyInvestor", currency: "EUR" },
        { id: "tr", name: "Trade Republic", broker: "Trade Republic", currency: "EUR" },
      ],
      activos: [
        activo("A"),
        activo("B"),
        activo("C", { mode: "manual", manual_qty: 1 }),
        activo("caja-mi", { name: "Efectivo · MyInvestor", cat: "liquidez", mode: "manual" }),
        activo("caja-tr", { name: "Efectivo · Trade Republic", cat: "liquidez", mode: "manual" }),
      ],
      operaciones: [
        operacion({ id: "1", account_id: "mi", asset_id: "A", type: "buy" }),
        operacion({ id: "2", account_id: "mi", asset_id: "B", type: "buy" }),
        operacion({ id: "3", account_id: "tr", asset_id: "B", type: "buy" }),
        operacion({ id: "4", account_id: "mi" }),
      ],
    };
    const r = loDeLaCuenta(e, "mi");
    expect(r.operaciones.sort()).toEqual(["1", "2", "4"]);
    expect(r.activos.map((a) => a.id).sort()).toEqual(["A", "caja-mi"]);
    expect(r.compartidos.map((a) => a.id)).toEqual(["B"]);
  });
});
