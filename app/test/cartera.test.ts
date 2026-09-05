// ── PRUEBAS DEL CÁLCULO ──────────────────────────────────────────────────
// Cada bloque de aquí corresponde a un error que la app llegó a cometer de
// verdad. No están para subir el porcentaje de cobertura: están para que esos
// errores concretos no vuelvan.

import { describe, expect, it } from "vitest";
import {
  calcularFifo,
  calcularPosiciones,
  calcularResumen,
  cierreFiable,
  porCategoria,
  porEjercicio,
} from "../src/lib/cartera";
import type { Activo, EstadoCartera, Operacion, Precio } from "../src/lib/tipos";
import { ESTADO_VACIO } from "../src/lib/tipos";

// ── Utilidades para montar casos ─────────────────────────────────────────

let n = 0;
const activo = (p: Partial<Activo>): Activo => ({
  id: `a${++n}`,
  name: "Activo",
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
  ...p,
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
  source: "manual",
  source_format: null,
  import_hash: null,
  notes: null,
  ...p,
});

const precio = (symbol: string, eur: number, prev?: number): Precio => ({
  symbol,
  eur,
  raw: eur,
  currency: "EUR",
  prev: prev ?? null,
  name: null,
  source: "test",
  updated_at: new Date().toISOString(),
});

const estado = (a: Activo[], o: Operacion[] = []): EstadoCartera => ({
  ...ESTADO_VACIO,
  activos: a,
  operaciones: o,
});

// ════════════════════════════════════════════════════════════════════════

describe("el efectivo no es ganancia", () => {
  it("una cuenta corriente sin coste declarado no inventa una plusvalía", () => {
    // El error original: el formulario pedía «precio de compra por unidad»,
    // que en una cuenta corriente no significa nada. Al dejarlo vacío se
    // guardaba coste 0 y meter 730 € los contaba como 730 € de ganancia.
    const caja = activo({
      cat: "liquidez",
      unit: "€",
      mode: "manual",
      manual_qty: 730,
      manual_cost_unit: 0, // ← el dato malo
      manual_price: 1,
    });

    const [p] = calcularPosiciones(estado([caja]), {}, { EUR: 1 });

    expect(p.valor).toBe(730);
    expect(p.coste).toBe(730); // el coste ES el saldo, pase lo que pase
    expect(p.ganancia).toBe(0);
  });

  it("añadir efectivo sube el aportado en la misma cantidad, no la ganancia", () => {
    const caja = activo({ cat: "liquidez", unit: "€", mode: "manual", manual_qty: 500, manual_price: 1 });
    const r = calcularResumen(
      calcularPosiciones(estado([caja]), {}, { EUR: 1 }),
      [],
      [],
      "2026-09-05",
    );
    expect(r.aportado).toBe(500);
    expect(r.ganancia).toBe(0);
  });
});

describe("aportado ≠ coste", () => {
  it("vender con beneficio no cuenta como dinero aportado", () => {
    // Compra 100, vende 150. El dinero recuperado sube el coste de la
    // liquidez sin que haya entrado un euro de fuera: si no se resta lo
    // realizado, cada venta con beneficio se leía como una aportación y el
    // gráfico convertía la ganancia en pérdida.
    const etf = activo({ ticker: "ETF" });
    const caja = activo({
      cat: "liquidez",
      unit: "€",
      mode: "manual",
      manual_qty: 150,
      manual_price: 1,
    });
    const ops = [
      op({ asset_id: etf.id, type: "buy", date: "2026-01-10", quantity: 1, total: 100 }),
      op({ asset_id: etf.id, type: "sell", date: "2026-06-10", quantity: 1, total: 150 }),
    ];

    const e = estado([etf, caja], ops);
    const { realizadas } = calcularFifo(ops);
    const r = calcularResumen(
      calcularPosiciones(e, {}, { EUR: 1 }),
      ops,
      realizadas,
      "2026-09-05",
    );

    expect(realizadas).toHaveLength(1);
    expect(realizadas[0].resultado).toBe(50);
    // Aportaste 100, no 150.
    expect(r.aportado).toBe(100);
    expect(r.ganancia).toBe(50);
  });

  it("los cobros tampoco cuentan como dinero aportado", () => {
    const caja = activo({
      cat: "liquidez",
      unit: "€",
      mode: "manual",
      manual_qty: 108.44,
      manual_price: 1,
    });
    const ops = [op({ asset_id: caja.id, type: "interest", date: "2026-07-31", total: 8.44 })];

    const r = calcularResumen(
      calcularPosiciones(estado([caja], ops), {}, { EUR: 1 }),
      ops,
      [],
      "2026-09-05",
    );

    expect(r.aportado).toBeCloseTo(100, 6);
    expect(r.ganancia).toBeCloseTo(8.44, 6);
  });
});

describe("la variación diaria con datos malos", () => {
  it("descarta un cierre anterior incoherente", () => {
    // Yahoo mezcla clases de distinta divisa: devolvía un «cierre de ayer»
    // diez veces mayor que el precio y el «hoy» de la cartera saltaba.
    expect(cierreFiable(6.6, 60)).toBeNull();
    expect(cierreFiable(6.6, 6.5)).toBe(6.5);
  });

  it("sin cierre fiable no se inventa una variación", () => {
    const etf = activo({ ticker: "ETF", mode: "manual", manual_qty: 10 });
    const [p] = calcularPosiciones(estado([etf]), { ETF: precio("ETF", 6.6, 60) }, { EUR: 1 });
    expect(p.dia).toBeNull();
    expect(p.diaPct).toBeNull();
  });

  it("con cierre fiable calcula la variación en euros", () => {
    const etf = activo({ ticker: "ETF", mode: "manual", manual_qty: 10 });
    const [p] = calcularPosiciones(estado([etf]), { ETF: precio("ETF", 11, 10) }, { EUR: 1 });
    expect(p.dia).toBeCloseTo(10, 6);
    expect(p.diaPct).toBeCloseTo(10, 6);
  });
});

describe("categorías desconocidas", () => {
  it("una categoría que no es de las cinco no rompe nada", () => {
    const raro = activo({ cat: "materias-primas", mode: "manual", manual_qty: 1, manual_cost_unit: 5, ticker: "X" });
    const grupos = porCategoria(
      calcularPosiciones(estado([raro]), { X: precio("X", 7) }, { EUR: 1 }),
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0].clave).toBe("otro");
    expect(grupos[0].valor).toBe(7);
  });
});

describe("FIFO", () => {
  it("vende los lotes más antiguos primero", () => {
    const a = activo({});
    const ops = [
      op({ asset_id: a.id, type: "buy", date: "2024-01-01", quantity: 10, total: 100 }), // 10 €/u
      op({ asset_id: a.id, type: "buy", date: "2025-01-01", quantity: 10, total: 200 }), // 20 €/u
      op({ asset_id: a.id, type: "sell", date: "2026-01-01", quantity: 15, total: 450 }), // 30 €/u
    ];

    const { saldos, realizadas } = calcularFifo(ops);
    const s = saldos.get(a.id)!;

    expect(s.qty).toBe(5);
    expect(s.coste).toBeCloseTo(100, 6); // quedan 5 del lote de 20 €
    // Coste consumido: 10×10 + 5×20 = 200. Cobrado 450 → +250.
    expect(realizadas[0].coste).toBeCloseTo(200, 6);
    expect(realizadas[0].resultado).toBeCloseTo(250, 6);
  });

  it("la comisión de compra entra en el coste y la de venta se resta del cobro", () => {
    const a = activo({});
    const ops = [
      op({ asset_id: a.id, type: "buy", date: "2026-01-01", quantity: 1, total: 100, fees: 5 }),
      op({ asset_id: a.id, type: "sell", date: "2026-02-01", quantity: 1, total: 120, fees: 5 }),
    ];
    const { realizadas } = calcularFifo(ops);
    expect(realizadas[0].coste).toBeCloseTo(105, 6);
    expect(realizadas[0].ingreso).toBeCloseTo(115, 6);
    expect(realizadas[0].resultado).toBeCloseTo(10, 6);
  });

  it("comprar y vender el mismo día no deja la posición en negativo", () => {
    const a = activo({});
    const ops = [
      // A propósito en el orden equivocado: la venta antes que la compra.
      op({ asset_id: a.id, type: "sell", date: "2026-03-01", quantity: 2, total: 60 }),
      op({ asset_id: a.id, type: "buy", date: "2026-03-01", quantity: 2, total: 50 }),
    ];
    const { saldos, realizadas } = calcularFifo(ops);
    expect(saldos.get(a.id)!.qty).toBe(0);
    expect(realizadas[0].resultado).toBeCloseTo(10, 6);
  });
});

describe("fiscal", () => {
  it("agrupa por ejercicio y separa ganancias de pérdidas", () => {
    const a = activo({});
    const b = activo({});
    const ops = [
      op({ asset_id: a.id, type: "buy", date: "2024-01-01", quantity: 1, total: 100 }),
      op({ asset_id: a.id, type: "sell", date: "2025-05-01", quantity: 1, total: 160 }),
      op({ asset_id: b.id, type: "buy", date: "2024-01-01", quantity: 1, total: 100 }),
      op({ asset_id: b.id, type: "sell", date: "2025-09-01", quantity: 1, total: 70 }),
      op({ asset_id: a.id, type: "dividend", date: "2025-06-01", total: 12 }),
    ];

    const { realizadas } = calcularFifo(ops);
    const [e] = porEjercicio(realizadas, ops);

    expect(e.anio).toBe(2025);
    expect(e.ganancias).toBeCloseTo(60, 6);
    expect(e.perdidas).toBeCloseTo(30, 6);
    expect(e.neto).toBeCloseTo(30, 6);
    expect(e.dividendos).toBeCloseTo(12, 6);
  });
});

describe("divisas", () => {
  it("una posición en dólares se valora en euros", () => {
    const us = activo({ ticker: "MSTR", currency: "USD", mode: "manual", manual_qty: 2, manual_cost_unit: 300 });
    // El precio del feed YA viene en euros; el coste declarado a mano, no.
    const [p] = calcularPosiciones(
      estado([us]),
      { MSTR: precio("MSTR", 350) },
      { EUR: 1, USD: 0.86 },
    );
    expect(p.valor).toBeCloseTo(700, 6);
    expect(p.coste).toBeCloseTo(2 * 300 * 0.86, 6);
  });
});
