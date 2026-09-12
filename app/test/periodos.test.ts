// ── CONTRA EL ÍNDICE, POR AÑOS Y POR TRIMESTRES ──────────────────────────
// Las dos curvas acumuladas cortadas por periodos: cada uno desde el último
// punto del anterior, y encadenados tienen que dar el total.

import { describe, expect, it } from "vitest";
import { porPeriodos, type PuntoComparado } from "../src/lib/evolucion";

const pc = (fecha: string, tuyo: number, indice: number | null): PuntoComparado => ({
  fecha,
  tuyo,
  indice,
});

describe("porPeriodos", () => {
  // Desde el 20 de febrero de 2025: +10 % en el T1, otro +10 % en el T2 y el
  // T3 todavía en curso.
  const curva = [
    pc("2025-02-20", 0, 0),
    pc("2025-03-06", 5, 2),
    pc("2025-03-27", 10, 4),
    pc("2025-05-01", 15.5, 6.08),
    pc("2025-06-26", 21, 8.16),
    pc("2025-07-10", 18.58, 9.24),
  ];

  it("por trimestres, cada uno desde el último punto del anterior", () => {
    const t = porPeriodos(curva, "trimestre");
    expect(t.map((p) => p.etiqueta)).toEqual(["T1 2025", "T2 2025", "T3 2025"]);
    expect(t[0].tuyo).toBeCloseTo(10, 9);
    expect(t[0].indice).toBeCloseTo(4, 9);
    expect(t[1].desde).toBe("2025-03-27");
    expect(t[1].tuyo).toBeCloseTo(10, 9);
    expect(t[1].indice).toBeCloseTo((1.0816 / 1.04 - 1) * 100, 9);
    // El primero empieza con la primera compra; el último no ha acabado.
    expect(t[0].empiezaTarde).toBe(true);
    expect(t[2].enCurso).toBe(true);
    expect(t[1].empiezaTarde || t[1].enCurso).toBe(false);
  });

  it("encadenados dan el total, los tuyos y los del índice", () => {
    for (const tipo of ["trimestre", "año"] as const) {
      const ps = porPeriodos(curva, tipo);
      const tuyo = ps.reduce((f, p) => f * (1 + p.tuyo / 100), 1);
      const indice = ps.reduce((f, p) => f * (1 + (p.indice ?? 0) / 100), 1);
      expect((tuyo - 1) * 100).toBeCloseTo(18.58, 9);
      expect((indice - 1) * 100).toBeCloseTo(9.24, 9);
    }
  });

  it("por años naturales, y un punto de partida del 26 de diciembre no hace empezar tarde el año", () => {
    const a = porPeriodos(
      [pc("2024-12-26", 0, 0), pc("2025-06-26", 10, 5), pc("2025-12-25", 20, 8), pc("2026-03-05", 26, 10)],
      "año",
    );
    expect(a.map((p) => p.clave)).toEqual(["2025", "2026"]);
    expect(a[0].empiezaTarde).toBe(false);
    expect(a[0].tuyo).toBeCloseTo(20, 9);
    expect(a[1].tuyo).toBeCloseTo((1.26 / 1.2 - 1) * 100, 9);
    expect(a[1].enCurso).toBe(true);
  });

  it("sin dato del índice en uno de los dos extremos, ese periodo no se compara", () => {
    const t = porPeriodos(
      [pc("2025-01-02", 0, 0), pc("2025-02-06", 3, null), pc("2025-04-03", 6, 5)],
      "trimestre",
    );
    expect(t.map((p) => p.indice)).toEqual([null, null]);
    expect(t[1].tuyo).toBeCloseTo((1.06 / 1.03 - 1) * 100, 9);
  });
});
