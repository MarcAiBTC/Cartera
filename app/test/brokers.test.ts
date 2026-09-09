// ── LOS FORMATOS NUEVOS DE REVOLUT Y MYINVESTOR ──────────────────────────
// Los dos archivos reales que subió el usuario caían en el importador
// genérico: ninguno de los dos detectores los reconocía, y el genérico
// adivina columnas sin saber qué es cada cosa.
//
// Las filas de abajo son inventadas y copian la forma exacta de cada archivo.

import { describe, expect, it } from "vitest";
import { tabular } from "../src/lib/import/csv";
import { desdeMatriz, detectar } from "../src/lib/import";
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

  it("el número de detrás del «@» son PARTICIPACIONES, no el valor liquidativo", () => {
    // 4,99 € por 0,0368 participaciones de un fondo que vale ~135 €. Leerlo
    // al revés daba 135,6 participaciones: el fondo entraba 3.600 veces más
    // grande de lo que es.
    const { filas } = leerMyInvestorMovimientos(
      MI("30/07/2026;31/07/2026;PICTET-CHINA IX P EUR @ 0.0368;-4,99;EUR"),
    );
    expect(filas[0].tipo).toBe("buy");
    expect(filas[0].nombre).toBe("PICTET-CHINA IX P EUR");
    expect(filas[0].cantidad).toBeCloseTo(0.0368, 6);
    expect(filas[0].precio).toBeCloseTo(4.99 / 0.0368, 2);
    expect(filas[0].categoria).toBe("fondo");
  });

  it("un ETC entero: «@ 1» con 55,99 € es una unidad a 55,99 €", () => {
    const { filas } = leerMyInvestorMovimientos(
      MI("13/08/2025;15/08/2025;ETC ISHARES PHYSICAL GOLD @ 1;-55,99;EUR"),
    );
    expect(filas[0].cantidad).toBe(1);
    expect(filas[0].precio).toBeCloseTo(55.99, 2);
  });

  it("no se fía de un número que el corte ha partido por la mitad", () => {
    // «PICTET CHINA INDEX P ACC @ 0.0» son 0,0368 participaciones a las que
    // el corte se ha comido tres cifras, y «… @ 1» a 30 caracteres pudo ser
    // «1.85». Antes que un número inventado, ninguno.
    const { filas } = leerMyInvestorMovimientos(
      MI(
        "08/09/2025;09/09/2025;PICTET CHINA INDEX P ACC @ 0.0;-4,99;EUR",
        "02/06/2026;03/06/2026;VANGUARD US 500 STOCK EUR @ 0.;-50;EUR",
        "01/07/2026;02/07/2026;ABCDEFGHIJKLMNOPQRSTUVWXY @ 12;-50;EUR",
      ),
    );
    expect(filas).toHaveLength(3);
    expect(filas.every((f) => f.cantidad === undefined && f.precio === undefined)).toBe(true);
    // Y el dinero sigue siendo el correcto.
    expect(filas.map((f) => f.total)).toEqual([4.99, 50, 50]);
  });

  it("«sólo el dinero» deja fuera los fondos y se queda con la caja", () => {
    const t = MI(
      "30/07/2026;31/07/2026;PICTET-CHINA IX P EUR @ 0.0368;-4,99;EUR",
      "30/07/2026;30/07/2026;Envio de dinero - imaginBank;250;EUR",
      "12/07/2026;11/07/2026;PERIODO 11/06/2026 11/07/2026;0,06;EUR",
    );
    expect(leerMyInvestorMovimientos(t).filas).toHaveLength(3);

    const solo = leerMyInvestorMovimientos(t, { soloEfectivo: true });
    expect(solo.formato).toBe("myinvestor-efectivo");
    expect(solo.filas.map((f) => f.tipo)).toEqual(["deposit", "interest"]);
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

// ════════════════════════════════════════════════════════════════════════
//  MYINVESTOR · el mismo extracto, pero en Excel
// ════════════════════════════════════════════════════════════════════════
// La hoja no empieza por la tabla: gasta ocho filas en el titular, el número
// de cuenta y el saldo. Leída dando por hecho que la cabecera es la primera
// fila, las columnas se llamaban «TITULAR:» y el archivo entero acababa en el
// importador genérico sin reconocer ni una línea.
//
// El titular y el número de cuenta van INVENTADOS. Esto es un repositorio
// público y un extracto de banco lleva dentro el nombre, la dirección y el
// IBAN de una persona: para probar el lector da igual lo que ponga en esas
// filas, lo que se prueba es que se salten.

const HOJA: string[][] = [
  ["", "", "TITULAR:", "PERSONA DE EJEMPLO", "", ""],
  ["", "", "CUENTA:", "0000000000", "", ""],
  ["", "", "Saldo:", "218,32€", "", ""],
  ["", "", "", "", "", ""],
  ["", "", "", "", "", ""],
  ["Movimientos", "", "", "", "", ""],
  ["", "", "", "", "", ""],
  ["Fecha Operación", "Fecha Valor", "Movimiento", "", "Importe", "Saldo"],
  ["08/09/2025", "10/09/2025", "FIDELITY PHYSICAL BITCOIN ET @", "", "-9.30€", "262.41€"],
  ["12/09/2025", "11/09/2025", "PERIODO 11/08/2025 11/09/2025", "", "0.06€", "257.48€"],
  ["30/07/2026", "30/07/2026", "Envio de dinero - imaginBank", "", "250€", "507.48€"],
];

describe("MyInvestor · el Excel de la cuenta", () => {
  it("salta el titular y el saldo y encuentra la cabecera de verdad", () => {
    const t = desdeMatriz(HOJA);
    expect(t.cabeceras).toContain("fecha operación");
    expect(t.cabeceras).toContain("movimiento");
    expect(t.filas).toHaveLength(3);
    // La columna sin nombre no se queda en blanco ni pisa a otra.
    expect(t.cabeceras).toContain("columna 4");
    // Y la línea que se señala es la de Excel, no la del array.
    expect(t.lineas[0]).toBe(9);
  });

  it("se reconoce como extracto de MyInvestor aunque las columnas se llamen distinto", () => {
    const t = desdeMatriz(HOJA);
    expect(esMyInvestorMovimientos(t)).toBe(true);
    expect(detectar({ nombre: "Movimientos.xlsx", tabla: t })).toBe("myinvestor-cuenta");
  });

  it("lee las tres filas con su importe, con el € pegado y el punto decimal", () => {
    const { filas } = leerMyInvestorMovimientos(desdeMatriz(HOJA));
    expect(filas.map((f) => f.tipo)).toEqual(["buy", "interest", "deposit"]);
    expect(filas.map((f) => f.total)).toEqual([9.3, 0.06, 250]);
    expect(filas[0].fecha).toBe("2025-09-08");
    // El saldo de la última columna no se cuela como importe.
    expect(filas[2].total).toBe(250);
  });
});
