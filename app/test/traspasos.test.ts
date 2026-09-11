// ── TRASPASOS ENTRE FONDOS ───────────────────────────────────────────────
// Un traspaso no es una venta: la ganancia se difiere y el fondo de destino
// hereda el coste y la antigüedad del de origen. Tratado como venta, la
// pantalla Fiscal pedía declarar cada traspaso y el fondo nuevo entraba con
// coste de mercado, sin la ganancia que llevaba dentro.

import { describe, expect, it } from "vitest";
import {
  calcularFifo,
  calcularPosiciones,
  calcularResumen,
  paresDeTraspaso,
  porEjercicio,
} from "../src/lib/cartera";
import type { Activo, EstadoCartera, Operacion, Precio } from "../src/lib/tipos";
import { ESTADO_VACIO } from "../src/lib/tipos";

let n = 0;
const activo = (id: string): Activo => ({
  id,
  name: id,
  ticker: id,
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
});

const op = (p: Partial<Operacion>): Operacion => ({
  id: `o${++n}`,
  account_id: null,
  asset_id: null,
  type: "buy",
  date: "2026-01-01",
  quantity: null,
  price: null,
  total: 0,
  fees: 0,
  currency: "EUR",
  total_eur: null,
  is_internal_transfer: false,
  source: "import",
  source_format: null,
  import_hash: null,
  notes: null,
  ...p,
});

const precio = (symbol: string, eur: number): Precio => ({
  symbol,
  eur,
  raw: eur,
  currency: "EUR",
  prev: null,
  name: null,
  source: "prueba",
  updated_at: new Date().toISOString(),
});

// A se compra en 2024 a 10 €; en 2025 se traspasan 4 participaciones —ya a
// 15 €— al fondo B, que entra con 2 participaciones a 30 €.
const compraA = op({ asset_id: "A", date: "2024-01-10", quantity: 10, total: 100 });
const salida = op({
  asset_id: "A",
  type: "sell",
  date: "2025-06-02",
  quantity: 4,
  total: 60,
  is_internal_transfer: true,
});
const entrada = op({
  asset_id: "B",
  date: "2025-06-03",
  quantity: 2,
  total: 60.5,
  is_internal_transfer: true,
});
const ops = [compraA, salida, entrada];

describe("traspasos entre fondos", () => {
  it("casa cada reembolso con su suscripción", () => {
    expect(paresDeTraspaso(ops).get(salida.id)).toBe(entrada.id);
  });

  it("no cierra ninguna venta: no hay nada que declarar", () => {
    const { realizadas, traspasos } = calcularFifo(ops);
    expect(realizadas).toHaveLength(0);
    expect(traspasos.get(salida.id)?.coste).toBeCloseTo(40, 9);
    const e = porEjercicio(realizadas, ops).find((x) => x.anio === 2025);
    expect(e?.ventas ?? []).toHaveLength(0);
  });

  it("el fondo de destino hereda el coste y la fecha de compra", () => {
    const { saldos } = calcularFifo(ops);
    const b = saldos.get("B")!;
    expect(b.qty).toBeCloseTo(2, 9);
    expect(b.coste).toBeCloseTo(40, 9);
    expect(b.lotes[0].fecha).toBe("2024-01-10");
    expect(saldos.get("A")!.coste).toBeCloseTo(60, 9);
  });

  it("la ganancia sale cuando se reembolsa de verdad, con la antigüedad heredada", () => {
    const venta = op({ asset_id: "B", type: "sell", date: "2026-02-01", quantity: 2, total: 70 });
    const { realizadas } = calcularFifo([...ops, venta]);
    expect(realizadas).toHaveLength(1);
    expect(realizadas[0].resultado).toBeCloseTo(30, 9);
    expect(realizadas[0].fechaCompra).toBe("2024-01-10");
  });

  it("no cambia lo aportado ni la ganancia total, sólo cómo se reparte", () => {
    const estado: EstadoCartera = {
      ...structuredClone(ESTADO_VACIO),
      activos: [activo("A"), activo("B")],
      operaciones: ops,
    };
    const precios = { A: precio("A", 15), B: precio("B", 32) };
    const posiciones = calcularPosiciones(estado, precios, { EUR: 1 });
    const { realizadas } = calcularFifo(ops);
    const r = calcularResumen(posiciones, ops, realizadas, "2026-09-10");
    // Sólo entraron 100 € de fuera.
    expect(r.aportado).toBeCloseTo(100, 9);
    // 6 × 15 + 2 × 32 = 154 → 54 de ganancia, toda latente.
    expect(r.ganancia).toBeCloseTo(54, 9);
    expect(r.realizado).toBe(0);
    expect(posiciones.find((p) => p.activo.id === "B")!.ganancia).toBeCloseTo(24, 9);
  });

  it("sin histórico del fondo de origen se queda como venta, para no perder la ganancia", () => {
    const sola = op({ ...salida, id: "sola", asset_id: "C" });
    const destino = op({ ...entrada, id: "destino" });
    const { realizadas, saldos } = calcularFifo([sola, destino]);
    expect(realizadas).toHaveLength(1);
    // Y la suscripción, sin nada que heredar, entra a su precio.
    expect(saldos.get("B")!.coste).toBeCloseTo(60.5, 9);
  });

  it("una compra normal del mismo importe no se toma por traspaso", () => {
    const normal = op({ asset_id: "B", date: "2025-06-03", quantity: 2, total: 60 });
    expect(paresDeTraspaso([compraA, salida, normal]).size).toBe(0);
  });
});
