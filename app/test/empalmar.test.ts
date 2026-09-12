// ── ALARGAR UNA SERIE CON SU SUBYACENTE ──────────────────────────────────
// El ETP de bitcoin de Fidelity cotiza en Londres desde el 29-09-2025 y hay
// compras de MyInvestor de antes: sin alargarla, esas órdenes se quedaban sin
// participaciones.

import { describe, expect, it } from "vitest";
import { empalmar, type Serie } from "../api/_lib/series";

/** Una serie diaria desde `desde`, con el valor que diga `f` para el día i. */
const serie = (desde: string, dias: number, f: (i: number) => number): Serie =>
  Array.from({ length: dias }, (_, i) => [
    new Date(Date.parse(desde) + i * 86400e3).toISOString().slice(0, 10),
    f(i),
  ]);

describe("empalmar", () => {
  // El bitcoin, desde el 1 de septiembre; el ETP vale una milésima y empieza
  // el 29.
  const btc = serie("2025-09-01", 60, (i) => 90000 + i * 100);
  const etp = serie("2025-09-29", 30, (i) => (90000 + (i + 28) * 100) / 1000);

  it("pone delante los días que faltan, a la escala del producto", () => {
    const s = empalmar(etp, btc);
    expect(s[0][0]).toBe("2025-09-01");
    expect(s[0][1]).toBeCloseTo(90, 6);
    // Lo que ya tenía no se toca.
    expect(s.slice(-30)).toEqual(etp);
    expect(s).toHaveLength(28 + 30);
  });

  it("un día suelto que se separa no lo impide", () => {
    const conSalto = etp.map(([d, v], i): [string, number] => [d, i === 3 ? v * 1.08 : v]);
    expect(empalmar(conSalto, btc)[0][0]).toBe("2025-09-01");
  });

  it("si no se mueven juntas, no se inventa nada", () => {
    // Otra cosa: sube cuando el bitcoin baja.
    const otra = serie("2025-09-29", 30, (i) => 100 - i * 2);
    expect(empalmar(otra, btc)).toEqual(otra);
  });

  it("si el subyacente no llega más atrás, se queda igual", () => {
    expect(empalmar(etp, serie("2025-10-05", 30, () => 1))).toEqual(etp);
  });
});
