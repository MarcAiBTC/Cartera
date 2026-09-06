// ── EL EXTRACTO NUEVO DE TRADE REPUBLIC ──────────────────────────────────
// Estas pruebas existen porque una importación real entró mal entera: de 208
// filas salieron 41 «activos», y 24 de ellos eran conceptos bancarios con
// nombres como «Interest payment for payout collection 019a3d67…». Las cuatro
// acciones sí entraron, pero con el ISIN metido en el campo del ticker, así
// que se quedaron mudas para siempre: Yahoo no cotiza «US0231351067».
//
// Las filas de abajo son inventadas y reproducen, una a una, cada trampa del
// formato. Si alguna vez vuelven a fallar, fallan aquí y no en la cartera.

import { describe, expect, it } from "vitest";
import { tabular } from "../src/lib/import/csv";
import { esTradeRepublic, leerTradeRepublic } from "../src/lib/import/traderepublic";

const CABECERA =
  '"datetime","date","account_type","category","type","asset_class","name","symbol",' +
  '"shares","price","amount","fee","tax","currency","original_amount","original_currency",' +
  '"fx_rate","description","transaction_id","counterparty_name","counterparty_iban",' +
  '"payment_reference","mcc_code"';

/** Escribe una fila del extracto poniendo cada valor en su columna. */
function fila(v: Record<string, string | number>): string {
  const cols = [
    "datetime", "date", "account_type", "category", "type", "asset_class", "name", "symbol",
    "shares", "price", "amount", "fee", "tax", "currency", "original_amount", "original_currency",
    "fx_rate", "description", "transaction_id", "counterparty_name", "counterparty_iban",
    "payment_reference", "mcc_code",
  ];
  return cols.map((c) => `"${v[c] ?? ""}"`).join(",");
}

const extracto = (...filas: string[]) => tabular([CABECERA, ...filas].join("\n"));

const COMPRA_ACCION = fila({
  date: "2025-03-10", account_type: "DEFAULT", category: "TRADING", type: "BUY",
  asset_class: "STOCK", name: "Amazon.com", symbol: "US0231351067",
  shares: "2.0000000000", price: "180.500000", amount: "-361.00", fee: "-1.00", currency: "EUR",
});

const COMPRA_CRIPTO = fila({
  date: "2025-03-11", account_type: "DEFAULT", category: "TRADING", type: "BUY",
  asset_class: "CRYPTO", name: "Bitcoin", symbol: "BTC",
  shares: "0.0010000000", price: "80000.000000", amount: "-80.00", fee: "-1.00", currency: "EUR",
});

const VENTA_CRIPTO = fila({
  date: "2025-04-01", account_type: "DEFAULT", category: "TRADING", type: "SELL",
  asset_class: "CRYPTO", name: "Bitcoin", symbol: "BTC",
  shares: "-0.0005000000", price: "90000.000000", amount: "45.00", fee: "-1.00", currency: "EUR",
});

const INTERESES = fila({
  date: "2025-04-01", account_type: "DEFAULT", category: "CASH", type: "INTEREST_PAYMENT",
  amount: "1.070000", tax: "0.00", currency: "EUR",
  description: "Interest payment for payout collection 019a3d67-7887-7038-8c06-a7afa4e172f6",
  name: "Interest payment for payout collection 019a3d67-7887-7038-8c06-a7afa4e172f6",
});

const INGRESO = fila({
  date: "2025-04-02", account_type: "DEFAULT", category: "CASH", type: "TRANSFER_INSTANT_INBOUND",
  name: "NOMBRE APELLIDO", amount: "200.000000", currency: "EUR",
});

const RETIRADA = fila({
  date: "2025-04-03", account_type: "DEFAULT", category: "CASH", type: "CUSTOMER_OUTBOUND_REQUEST",
  name: "NOMBRE APELLIDO", amount: "-100.000000", currency: "EUR",
});

// Los dos lados del vencimiento de un turbo: los títulos salen aquí…
const VENCIMIENTO = fila({
  date: "2025-05-20", account_type: "DEFAULT", category: "CORPORATE_ACTION",
  type: "WARRANT_EXERCISE", asset_class: "DERIVATIVE", name: "Long 78.990 $",
  symbol: "DE000VC5T597", shares: "-3.0000000000",
});
// …y el dinero llega aquí, el mismo día y con el mismo ISIN.
const AMORTIZACION = fila({
  date: "2025-05-20", account_type: "DEFAULT", category: "CASH", type: "TILG",
  asset_class: "DERIVATIVE", name: "Long 78.990 $", symbol: "DE000VC5T597",
  amount: "26.100000", currency: "EUR",
});

// Cambio de custodia: sale y entra lo mismo el mismo día.
const MIGRA_SALE = fila({
  date: "2025-06-16", account_type: "DEFAULT", category: "DELIVERY", type: "MIGRATION",
  asset_class: "FUND", name: "Physical Gold", symbol: "FR0013416716",
  shares: "-0.1524770000", price: "104.868300", currency: "EUR",
});
const MIGRA_ENTRA = fila({
  date: "2025-06-16", account_type: "DEFAULT", category: "DELIVERY", type: "MIGRATION",
  asset_class: "FUND", name: "Physical Gold", symbol: "FR0013416716",
  shares: "0.1524770000", price: "104.868300", currency: "EUR",
});

describe("Trade Republic · extracto nuevo", () => {
  it("lo reconoce aunque no traiga columna isin", () => {
    const t = extracto(COMPRA_ACCION);
    expect(t.cabeceras).not.toContain("isin");
    expect(esTradeRepublic(t)).toBe(true);
  });

  it("mete el ISIN en isin y el ticker de cripto en ticker", () => {
    const { filas } = leerTradeRepublic(extracto(COMPRA_ACCION, COMPRA_CRIPTO));

    const accion = filas.find((f) => f.nombre === "Amazon.com")!;
    expect(accion.isin).toBe("US0231351067");
    expect(accion.ticker).toBeUndefined();
    expect(accion.categoria).toBe("accion");

    const cripto = filas.find((f) => f.nombre === "Bitcoin")!;
    expect(cripto.ticker).toBe("BTC");
    expect(cripto.isin).toBeUndefined();
    expect(cripto.categoria).toBe("cripto");
  });

  it("guarda el importe bruto y la comisión aparte, los dos en positivo", () => {
    const [compra] = leerTradeRepublic(extracto(COMPRA_ACCION)).filas;
    // El motor suma la comisión al coste en las compras y la resta en las
    // ventas, así que `total` tiene que ser el bruto y no el neto.
    expect(compra.total).toBe(361);
    expect(compra.comision).toBe(1);
    expect(compra.cantidad).toBe(2);
    expect(compra.precio).toBe(180.5);
  });

  it("traduce los enums en mayúsculas, que el vocabulario común no reconoce", () => {
    const { filas } = leerTradeRepublic(extracto(INTERESES, INGRESO, RETIRADA, VENTA_CRIPTO));
    expect(filas.map((f) => f.tipo)).toEqual(["interest", "deposit", "withdrawal", "sell"]);
  });

  it("no convierte un movimiento de caja en un activo", () => {
    const { filas } = leerTradeRepublic(extracto(INTERESES, INGRESO, RETIRADA));
    // Éste era el fallo caro: el concepto del banco viaja en `name`, y con él
    // la cartera se inventaba un activo por cada cobro de intereses.
    for (const f of filas) {
      expect(f.isin).toBeUndefined();
      expect(f.ticker).toBeUndefined();
      expect(f.nombre).toBeUndefined();
    }
  });

  it("funde el vencimiento de un derivado con su amortización, en una venta", () => {
    const { filas } = leerTradeRepublic(extracto(VENCIMIENTO, AMORTIZACION));
    expect(filas).toHaveLength(1);
    const [v] = filas;
    expect(v.tipo).toBe("sell");
    expect(v.isin).toBe("DE000VC5T597");
    expect(v.cantidad).toBe(3);
    expect(v.total).toBe(26.1);
    expect(v.precio).toBeCloseTo(8.7, 6);
    expect(v.categoria).toBe("otro");
  });

  it("un vencimiento sin amortización es una venta a cero: pérdida entera", () => {
    const { filas } = leerTradeRepublic(extracto(VENCIMIENTO));
    expect(filas).toHaveLength(1);
    expect(filas[0].tipo).toBe("sell");
    expect(filas[0].total).toBe(0);
  });

  it("se traga el par de cambio de custodia sin dejar rastro", () => {
    const { filas, descartes } = leerTradeRepublic(extracto(MIGRA_SALE, MIGRA_ENTRA));
    expect(filas).toHaveLength(0);
    expect(descartes).toHaveLength(0);
  });

  it("pero avisa del cambio de custodia que se queda sin pareja", () => {
    const { filas, descartes } = leerTradeRepublic(extracto(MIGRA_SALE));
    expect(filas).toHaveLength(0);
    expect(descartes).toHaveLength(1);
    expect(descartes[0].motivo).toMatch(/sin pareja/);
  });

  it("los ETC de oro y plata son metal, no fondo", () => {
    const oro = fila({
      date: "2025-07-01", category: "TRADING", type: "BUY", asset_class: "FUND",
      name: "Physical Gold", symbol: "FR0013416716",
      shares: "1", price: "50.00", amount: "-50.00", currency: "EUR",
    });
    const fondo = fila({
      date: "2025-07-01", category: "TRADING", type: "BUY", asset_class: "FUND",
      name: "MSCI World", symbol: "IE00B4L5Y983",
      shares: "1", price: "100.00", amount: "-100.00", currency: "EUR",
    });
    const { filas } = leerTradeRepublic(extracto(oro, fondo));
    expect(filas[0].categoria).toBe("metal");
    expect(filas[1].categoria).toBe("fondo");
  });

  it("manda el signo del importe, no la etiqueta del bróker", () => {
    // Un TRANSFER_INSTANT_INBOUND con importe negativo es dinero que sale,
    // por mucho que el bróker lo llame «inbound».
    const alReves = fila({
      date: "2025-08-01", category: "CASH", type: "TRANSFER_INSTANT_INBOUND",
      amount: "-50.000000", currency: "EUR",
    });
    const { filas } = leerTradeRepublic(extracto(alReves));
    expect(filas[0].tipo).toBe("withdrawal");
  });

  it("no pierde ninguna fila por el camino", () => {
    const t = extracto(
      COMPRA_ACCION, COMPRA_CRIPTO, VENTA_CRIPTO, INTERESES, INGRESO, RETIRADA,
      VENCIMIENTO, AMORTIZACION, MIGRA_SALE, MIGRA_ENTRA,
    );
    const { filas, descartes } = leerTradeRepublic(t);
    // 10 filas = 7 operaciones (la amortización se funde con su vencimiento)
    // + 2 de migración que se anulan + 1 amortización ya contada.
    expect(filas).toHaveLength(7);
    expect(descartes).toHaveLength(0);
  });
});
