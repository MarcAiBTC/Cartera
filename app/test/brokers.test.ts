// ── LOS FORMATOS NUEVOS DE REVOLUT Y MYINVESTOR ──────────────────────────
// Los dos archivos reales que subió el usuario caían en el importador
// genérico: ninguno de los dos detectores los reconocía, y el genérico
// adivina columnas sin saber qué es cada cosa.
//
// Las filas de abajo son inventadas y copian la forma exacta de cada archivo.

import { describe, expect, it } from "vitest";
import { tabular } from "../src/lib/import/csv";
import { esRevolut, leerRevolut } from "../src/lib/import/revolut";
import {
  esMyInvestorMovimientos,
  leerMyInvestorMovimientos,
} from "../src/lib/import/myinvestor";

// ════════════════════════════════════════════════════════════════════════
//  REVOLUT INVEST · el formato nuevo
// ════════════════════════════════════════════════════════════════════════

const REV = (...filas: string[]) =>
  tabular(
    ["Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate", ...filas].join("\n"),
  );

describe("Revolut Invest · formato nuevo", () => {
  it("lo reconoce, aunque no traiga «activity type» ni «trade date»", () => {
    const t = REV("2025-06-27T14:10:32.463Z,GOOGL,BUY - MARKET,1,USD 174.37,USD 174.37,USD,1.1759");
    expect(t.cabeceras).not.toContain("activity type");
    expect(esRevolut(t)).toBe(true);
  });

  it("entiende los tipos escritos enteros", () => {
    const { filas } = leerRevolut(
      REV(
        "2024-10-28T13:24:18.844175Z,,CASH TOP-UP,,,USD 10,USD,1.0838",
        "2024-10-28T13:30:01.211Z,MCD,BUY - MARKET,0.0334941,USD 298.56,USD 10,USD,1.0838",
        "2024-11-25T19:40:51.348Z,MCD,SELL - MARKET,0.0334941,USD 295.87,USD 8.84,USD,1.0528",
        "2024-11-26T05:34:52.876898Z,,CASH WITHDRAWAL,,,USD -8.84,USD,1.0501",
        "2026-04-09T15:34:49.313666Z,48CA,DIVIDEND,,,EUR 1.34,EUR,1.0000",
      ),
    );
    expect(filas.map((f) => f.tipo)).toEqual([
      "deposit",
      "buy",
      "sell",
      "withdrawal",
      "dividend",
    ]);
  });

  it("le quita el prefijo de divisa a los importes", () => {
    // «USD 298.56» es un número con la divisa pegada delante.
    const { filas } = leerRevolut(
      REV("2024-10-28T13:30:01.211Z,MCD,BUY - MARKET,0.0334941,USD 298.56,USD 10,USD,1.0838"),
    );
    expect(filas[0].precio).toBeCloseTo(298.56, 6);
    expect(filas[0].total).toBeCloseTo(10, 6);
    expect(filas[0].divisa).toBe("USD");
  });

  it("usa el cambio que trae el propio extracto", () => {
    // Revolut dice a qué cambio operó: 1.0838 dólares por euro. Ese número
    // vale más que el histórico de divisas, porque lleva dentro su margen.
    const { filas } = leerRevolut(
      REV("2024-10-28T13:30:01.211Z,MCD,BUY - MARKET,0.0334941,USD 298.56,USD 10,USD,1.0838"),
    );
    expect(filas[0].cambio).toBeCloseTo(1 / 1.0838, 8);
    // 10 USD son 9.23 EUR, no 10.
    expect(filas[0].total * filas[0].cambio!).toBeCloseTo(9.227, 3);
  });

  it("en euros el cambio es 1 y no cambia nada", () => {
    const { filas } = leerRevolut(
      REV("2025-10-01T14:59:30.101Z,NESR,BUY - MARKET,1.26678489,EUR 78.94,EUR 100,EUR,1.0000"),
    );
    expect(filas[0].cambio).toBe(1);
    expect(filas[0].total).toBe(100);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  MYINVESTOR · el extracto de la cuenta
// ════════════════════════════════════════════════════════════════════════

const MI = (...filas: string[]) =>
  tabular(["Fecha de operación;Fecha de valor;Concepto;Importe;Divisa", ...filas].join("\n"));

describe("MyInvestor · extracto de cuenta", () => {
  it("lo reconoce por sus columnas, sin ISIN de por medio", () => {
    const t = MI("30/07/2026;30/07/2026;Envio de dinero - imaginBank;250;EUR");
    expect(esMyInvestorMovimientos(t)).toBe(true);
  });

  it("saca las participaciones del valor liquidativo pegado al concepto", () => {
    // «PICTET-CHINA IX P EUR @ 0.0368» son 30 caracteres justos: el precio
    // sobrevive al corte, y 4,99 € a 0,0368 son 135,6 participaciones.
    const { filas } = leerMyInvestorMovimientos(
      MI("30/07/2026;31/07/2026;PICTET-CHINA IX P EUR @ 0.0368;-4,99;EUR"),
    );
    expect(filas[0].tipo).toBe("buy");
    expect(filas[0].nombre).toBe("PICTET-CHINA IX P EUR");
    expect(filas[0].precio).toBeCloseTo(0.0368, 6);
    expect(filas[0].cantidad).toBeCloseTo(4.99 / 0.0368, 4);
    expect(filas[0].categoria).toBe("fondo");
  });

  it("avisa una vez por fondo cuando el corte se come el precio", () => {
    const { filas, descartes } = leerMyInvestorMovimientos(
      MI(
        "05/08/2026;06/08/2026;VANGUARD US 500 STOCK INDEX EU;-50;EUR",
        "31/07/2026;03/08/2026;VANGUARD US 500 STOCK INDEX EU;-50;EUR",
      ),
    );
    // Las dos compras entran, con su importe correcto.
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.tipo === "buy" && f.cantidad === undefined)).toBe(true);
    // Y sale UN solo aviso, no uno por fila.
    expect(descartes).toHaveLength(1);
    expect(descartes[0].motivo).toMatch(/2 compras por 100\.00 €/);
  });

  it("«PERIODO …» son los intereses de la cuenta", () => {
    const { filas } = leerMyInvestorMovimientos(
      MI("11/01/2026;11/01/2026;PERIODO 11/12/2025 11/01/2026;1,23;EUR"),
    );
    expect(filas[0].tipo).toBe("interest");
    expect(filas[0].nombre).toBeUndefined();
  });

  it("lo que escribes tú al ingresar lleva minúsculas, y no es un fondo", () => {
    const { filas } = leerMyInvestorMovimientos(
      MI(
        "21/09/2023;21/09/2023;Prueba envio fondos;10;EUR",
        "01/06/2026;01/06/2026;invertir dinero fifa;120;EUR",
        "01/07/2026;01/07/2026;Vacaciones;-80;EUR",
      ),
    );
    expect(filas.map((f) => f.tipo)).toEqual(["deposit", "deposit", "withdrawal"]);
    // Y ninguno crea un activo llamado «Vacaciones».
    expect(filas.every((f) => f.nombre === undefined)).toBe(true);
  });

  it("manda el signo: una promoción retirada no es un cobro", () => {
    const { filas } = leerMyInvestorMovimientos(
      MI(
        "10/05/2024;10/05/2024;PROMOCION AMIGO 2023 ANF;15;EUR",
        "11/05/2024;11/05/2024;PROMOCION AMIGO 2023 ANF;-15;EUR",
      ),
    );
    expect(filas.map((f) => f.tipo)).toEqual(["interest", "withdrawal"]);
  });

  it("una fila sin importe no entra", () => {
    const { filas, descartes } = leerMyInvestorMovimientos(MI("11/09/2023;11/09/2023;;0;EUR"));
    expect(filas).toHaveLength(0);
    expect(descartes).toHaveLength(1);
  });
});
