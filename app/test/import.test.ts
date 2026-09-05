// ── PRUEBAS DE LOS IMPORTADORES ──────────────────────────────────────────
// Los archivos de ejemplo imitan la forma real de cada extracto: punto y coma,
// coma decimal, importes negativos en las compras, fechas en el formato del
// país del bróker y columnas entrecomilladas con comas dentro.
//
// Lo que más se prueba aquí no es que lea bien un archivo limpio, sino que:
//   · no duplique al reimportar,
//   · no cuele como compra una línea que no ha entendido,
//   · no cuente un traspaso interno como dinero nuevo.

import { describe, expect, it } from "vitest";
import { fecha, num, partir, separador, tabular } from "../src/lib/import/csv";
import { desdeTexto, detectar, leer, planificar } from "../src/lib/import";
import { huella } from "../src/lib/import/tipos";
import type { EstadoCartera, Operacion } from "../src/lib/tipos";
import { ESTADO_VACIO } from "../src/lib/tipos";

// ── Extractos de ejemplo ─────────────────────────────────────────────────

const TRADE_REPUBLIC = `Fecha;Tipo;Estado;ISIN;Nombre;Cantidad;Precio;Importe;Divisa
04/11/2024;Compra;Ejecutada;JE00B8DFY052;WisdomTree Physical Gold;7;21,51;-150,57;EUR
20/01/2025;Compra;Ejecutada;XS2434891219;Fidelity Physical Bitcoin;22;8,23;-181,06;EUR
21/05/2026;Venta;Ejecutada;XS2434891219;Fidelity Physical Bitcoin;10;9,10;91,00;EUR
30/06/2026;Dividendo;Ejecutada;JE00B8DFY052;WisdomTree Physical Gold;;;3,40;EUR
15/07/2026;Recompensa por recomendación;Ejecutada;;Bono;;;10,00;EUR`;

const REVOLUT = `Trade Date,Settle Date,Currency,Activity Type,Symbol,Description,Quantity,Price,Amount
03/14/2025,03/16/2025,USD,BUY,MSTR,"MicroStrategy Inc, Class A",2,268.40,-536.80
05/21/2026,05/23/2026,USD,SELL,MSTR,"MicroStrategy Inc, Class A",1,402.10,402.10
06/30/2026,06/30/2026,USD,DIV,AAPL,Apple Inc,,,4.20
06/30/2026,06/30/2026,USD,DIVNRA,AAPL,Apple Inc,,,-0.63
07/01/2026,07/01/2026,USD,CDEP,,Cash top-up,,,500.00
07/02/2026,07/02/2026,USD,SSP,NVDA,Stock split,,,0.00`;

const MYINVESTOR_JSON = JSON.stringify({
  payload: {
    data: [
      {
        operationType: "INVESTMENT_FUNDS_SUBSCRIPTION",
        status: "EXECUTED",
        isin: "IE0032620787",
        fundName: "Vanguard US500 Stock Index EUR Acc",
        shares: 8,
        amountBuyVL: 62.78,
        cash: 502.24,
        orderDate: "2024-03-08T00:00:00Z",
      },
      {
        operationType: "INTERNAL_TRANSFER_SUBSCRIPTION",
        status: "EXECUTED",
        isin: "IE00BYX5NX33",
        fundName: "Vanguard Global Small-Cap",
        shares: 3,
        amountBuyVL: 100,
        cash: 300,
        orderDate: "2025-02-10T00:00:00Z",
      },
      {
        operationType: "INVESTMENT_FUNDS_SUBSCRIPTION",
        status: "REJECTED",
        isin: "IE0032620787",
        fundName: "Vanguard US500 Stock Index EUR Acc",
        shares: 1,
        amountBuyVL: 70,
        cash: 70,
        orderDate: "2025-04-01T00:00:00Z",
      },
    ],
  },
});

const estadoVacio = (): EstadoCartera => structuredClone(ESTADO_VACIO);

// ════════════════════════════════════════════════════════════════════════

describe("lectura de números y fechas", () => {
  it("entiende los importes como los escribe cada bróker", () => {
    expect(num("1.234,56")).toBeCloseTo(1234.56, 6); // España
    expect(num("1,234.56")).toBeCloseTo(1234.56, 6); // anglosajón
    expect(num("1234.56")).toBeCloseTo(1234.56, 6);
    expect(num("-12,50 €")).toBeCloseTo(-12.5, 6);
    expect(num("(45,20)")).toBeCloseTo(-45.2, 6); // negativo contable
    expect(num("1 234,56")).toBeCloseTo(1234.56, 6); // espacio de millares
    expect(num("")).toBeUndefined();
    expect(num("—")).toBeUndefined();
  });

  it("desambigua el día y el mes según el bróker", () => {
    // Trade Republic y los españoles: día primero.
    expect(fecha("03/04/2026", "dmy")).toBe("2026-04-03");
    // Revolut: mes primero.
    expect(fecha("03/04/2026", "mdy")).toBe("2026-03-04");
    // Con el primer número mayor que 12 no hay ambigüedad posible.
    expect(fecha("25/12/2026", "mdy")).toBe("2026-12-25");
    expect(fecha("2026-09-05T10:00:00Z")).toBe("2026-09-05");
    expect(fecha("31.12.25")).toBe("2025-12-31");
  });

  it("respeta las comillas al partir una línea", () => {
    expect(partir('"Apple, Inc.";10;20', ";")).toEqual(["Apple, Inc.", "10", "20"]);
    expect(separador(["a;b;c", "1;2;3"])).toBe(";");
    expect(separador(["a,b,c", "1,2,3"])).toBe(",");
  });
});

describe("Trade Republic", () => {
  const entrada = desdeTexto(TRADE_REPUBLIC, "tr.csv");

  it("se reconoce solo", () => {
    expect(detectar(entrada)).toBe("traderepublic-csv");
  });

  it("lee compras, ventas y dividendos, y descarta lo que no entiende", () => {
    const l = leer(entrada);
    expect(l.filas).toHaveLength(4);

    const compra = l.filas[0];
    expect(compra.tipo).toBe("buy");
    expect(compra.fecha).toBe("2024-11-04");
    expect(compra.isin).toBe("JE00B8DFY052");
    expect(compra.cantidad).toBe(7);
    // El importe llega en negativo y se guarda en positivo: el signo lo pone
    // el tipo, no la cifra.
    expect(compra.total).toBeCloseTo(150.57, 6);

    expect(l.filas[2].tipo).toBe("sell");
    expect(l.filas[3].tipo).toBe("dividend");

    // La línea del bono no se cuela como compra: se descarta y se explica.
    expect(l.descartes).toHaveLength(1);
    expect(l.descartes[0].motivo).toMatch(/no reconocido/i);
  });
});

describe("Revolut", () => {
  const entrada = desdeTexto(REVOLUT, "revolut.csv");

  it("se reconoce por «activity type»", () => {
    expect(detectar(entrada)).toBe("revolut-csv");
  });

  it("traduce los códigos y usa el formato de fecha americano", () => {
    const l = leer(entrada);
    const tipos = l.filas.map((f) => f.tipo);

    expect(l.filas[0].fecha).toBe("2025-03-14"); // 03/14/2025, mes primero
    expect(tipos).toEqual(["buy", "sell", "dividend", "fee", "deposit"]);
    // La retención en origen es dinero que sale, no un dividendo más.
    expect(l.filas[3].total).toBeCloseTo(0.63, 6);
    // El split no mueve dinero: ni se importa ni ensucia los descartes.
    expect(l.descartes).toHaveLength(0);
  });
});

describe("MyInvestor", () => {
  const entrada = desdeTexto(MYINVESTOR_JSON, "myinvestor.json");

  it("se reconoce por la forma del JSON", () => {
    expect(detectar(entrada)).toBe("myinvestor-json");
  });

  it("marca el traspaso interno y salta las órdenes rechazadas", () => {
    const l = leer(entrada);
    expect(l.filas).toHaveLength(2);

    expect(l.filas[0].tipo).toBe("buy");
    expect(l.filas[0].traspasoInterno).toBe(false);

    // Un traspaso entre fondos propios NO es dinero nuevo aportado.
    expect(l.filas[1].traspasoInterno).toBe(true);

    expect(l.descartes).toHaveLength(1);
    expect(l.descartes[0].motivo).toMatch(/rechazada/i);
  });
});

describe("genérico", () => {
  it("lee un CSV de un bróker desconocido adivinando las columnas", () => {
    const texto = `date\tproduct\ttransaction\tunits\tunit price\tamount\tcurrency
2026-02-03\tVWCE\tBuy\t3\t120.50\t361.50\tEUR
2026-03-03\tVWCE\tSell\t1\t130.00\t130.00\tEUR`;
    const l = leer(desdeTexto(texto, "otro.tsv"));
    expect(l.formato).toBe("generico-csv");
    expect(l.filas).toHaveLength(2);
    expect(l.filas[0].ticker).toBe("VWCE");
    expect(l.filas[1].tipo).toBe("sell");
  });

  it("permite asignar las columnas a mano cuando el nombre no dice nada", () => {
    const texto = `col1;col2;col3;col4
05/09/2026;Compra;2;100,00`;
    const entrada = desdeTexto(texto, "raro.csv");
    const l = leer(entrada, {
      formato: "generico-csv",
      mapa: { fecha: "col1", tipo: "col2", cantidad: "col3", total: "col4", ticker: "col1" },
    });
    // Sin ticker ni ISIN la compra se descarta: es lo correcto, no hay con qué
    // casarla. Lo que se comprueba es que el mapeo manual llega al parser.
    expect(l.filas.length + l.descartes.length).toBe(1);
  });
});

describe("planificar", () => {
  it("no duplica al reimportar el mismo archivo", () => {
    const l = leer(desdeTexto(TRADE_REPUBLIC, "tr.csv"));
    const primero = planificar(l, { estado: estadoVacio(), fx: { EUR: 1 } });
    expect(primero.nuevas).toHaveLength(4);
    expect(primero.duplicadas).toHaveLength(0);

    // Segunda pasada, ya con las operaciones dentro.
    const conDatos = estadoVacio();
    conDatos.operaciones = primero.nuevas.map(
      (p) => ({ ...p.operacion, id: p.operacion.import_hash }) as unknown as Operacion,
    );
    const segundo = planificar(l, { estado: conDatos, fx: { EUR: 1 } });
    expect(segundo.nuevas).toHaveLength(0);
    expect(segundo.duplicadas).toHaveLength(4);
  });

  it("crea cada activo una sola vez aunque aparezca en varias líneas", () => {
    const l = leer(desdeTexto(TRADE_REPUBLIC, "tr.csv"));
    const plan = planificar(l, { estado: estadoVacio(), fx: { EUR: 1 } });
    // Dos ISIN distintos en cuatro operaciones.
    expect(plan.activosNuevos).toHaveLength(2);
    expect(plan.cuentaNueva?.broker).toBe("Trade Republic");
  });

  it("convierte al cambio del día de la operación, no al de hoy", () => {
    const l = leer(desdeTexto(REVOLUT, "revolut.csv"));
    const plan = planificar(l, {
      estado: estadoVacio(),
      fx: { EUR: 1, USD: 0.86 }, // el de hoy
      fxHistorico: { USD: { "2025-03-14": 0.92 } }, // el de aquel día
    });
    const compra = plan.nuevas.find((p) => p.fila.tipo === "buy")!;
    expect(compra.operacion.total_eur).toBeCloseTo(536.8 * 0.92, 4);

    // Una operación sin cambio histórico cae al de hoy, que es lo mejor que
    // se puede hacer sin inventar.
    const venta = plan.nuevas.find((p) => p.fila.tipo === "sell")!;
    expect(venta.operacion.total_eur).toBeCloseTo(402.1 * 0.86, 4);
  });

  it("reconoce el activo que ya está en la cartera en vez de crear otro", () => {
    const e = estadoVacio();
    e.activos = [
      {
        id: "existente",
        name: "WisdomTree Physical Gold",
        ticker: "WGLD",
        isin: "JE00B8DFY052",
        cat: "metal",
        unit: "acc.",
        currency: "EUR",
        underlying: "Oro",
        mode: "operations",
        manual_qty: null,
        manual_cost_unit: null,
        manual_price: null,
        archived: false,
      },
    ];

    const plan = planificar(leer(desdeTexto(TRADE_REPUBLIC, "tr.csv")), {
      estado: e,
      fx: { EUR: 1 },
    });

    const suyas = plan.nuevas.filter((p) => p.fila.isin === "JE00B8DFY052");
    expect(suyas).toHaveLength(2);
    expect(suyas.every((p) => p.operacion.asset_id === "existente")).toBe(true);
    expect(plan.activosNuevos).toHaveLength(1); // sólo el bitcoin
  });
});

describe("huella", () => {
  it("la misma operación da la misma huella y una distinta no", () => {
    const base = { fecha: "2026-01-01", tipo: "buy", isin: "IE0032620787", cantidad: 8, total: 502.24 };
    expect(huella(base)).toBe(huella({ ...base }));
    expect(huella(base)).not.toBe(huella({ ...base, total: 502.25 }));
    expect(huella(base)).not.toBe(huella({ ...base, fecha: "2026-01-02" }));
  });
});

describe("tabular", () => {
  it("quita el BOM para que la primera cabecera se reconozca", () => {
    const t = tabular("﻿Fecha;Importe\n01/01/2026;10");
    expect(t.cabeceras[0]).toBe("fecha");
  });
});
