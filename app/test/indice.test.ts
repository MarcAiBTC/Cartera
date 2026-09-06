// ── LA COMPARACIÓN CONTRA EL ÍNDICE ──────────────────────────────────────
// La tarjeta antigua comparaba «tu % contra el % del índice entre dos
// fechas», y arrancaba en la primera FOTO guardada de la cartera — que es la
// primera vez que abriste la app, no el día que empezaste a invertir. En una
// cuenta recién importada no hay ninguna foto, así que la tarjeta no salía
// teniendo dos años de operaciones dentro.
//
// Y aun con fotos, ese cálculo sólo valdría metiendo todo el dinero el primer
// día. Aportando a plazos, la fecha de cada euro pesa tanto como el índice.

import { describe, expect, it } from "vitest";
import { contraIndice, type PuntoIndice } from "../src/lib/cartera";
import type { Operacion } from "../src/lib/tipos";

const op = (date: string, type: string, total: number): Operacion =>
  ({ id: date + type + total, date, type, total, total_eur: total, fees: 0 }) as unknown as Operacion;

/** Un índice que se dobla: 100 el primer día, 200 el último. */
const SERIE: PuntoIndice[] = [
  { date: "2024-01-01", value: 100 },
  { date: "2024-07-01", value: 150 },
  { date: "2025-01-01", value: 200 },
];

describe("contra el índice", () => {
  it("arranca en el primer movimiento de dinero, no en la primera foto", () => {
    const c = contraIndice([op("2024-07-01", "deposit", 300)], SERIE, 300)!;
    expect(c.desde).toBe("2024-07-01");
  });

  it("cada aportación compra al precio de SU día", () => {
    // 100 € el día que el índice valía 100 → 1 participación.
    // 300 € el día que valía 150 → 2 participaciones.
    // 3 participaciones × 200 al final = 600 €.
    const c = contraIndice(
      [op("2024-01-01", "deposit", 100), op("2024-07-01", "deposit", 300)],
      SERIE,
      500,
    )!;
    expect(c.aportadoNeto).toBe(400);
    expect(c.indice).toBeCloseTo(600, 6);
    expect(c.tuyo).toBe(500);
    expect(c.diferencia).toBeCloseTo(-100, 6);
  });

  it("meterlo todo el primer día no es lo mismo que aportar a plazos", () => {
    const golpe = contraIndice([op("2024-01-01", "deposit", 400)], SERIE, 500)!;
    const plazos = contraIndice(
      [op("2024-01-01", "deposit", 100), op("2024-07-01", "deposit", 300)],
      SERIE,
      500,
    )!;
    // El mismo dinero, las mismas fechas de índice: 800 € contra 600 €. Ésta
    // es justo la diferencia que el cálculo antiguo no veía.
    expect(golpe.indice).toBeCloseTo(800, 6);
    expect(plazos.indice).toBeCloseTo(600, 6);
  });

  it("una retirada vende participaciones", () => {
    const c = contraIndice(
      [op("2024-01-01", "deposit", 200), op("2024-07-01", "withdrawal", 150)],
      SERIE,
      50,
    )!;
    // 2 participaciones, menos 1 al vender a 150 → 1 × 200 = 200.
    expect(c.aportadoNeto).toBe(50);
    expect(c.indice).toBeCloseTo(200, 6);
  });

  it("una compra NO es una aportación", () => {
    // Comprar mueve a acciones un dinero que ya estaba dentro. Contarla aquí
    // sería aportar el mismo euro dos veces.
    const conCompra = contraIndice(
      [op("2024-01-01", "deposit", 100), op("2024-01-01", "buy", 100)],
      SERIE,
      200,
    )!;
    const sinCompra = contraIndice([op("2024-01-01", "deposit", 100)], SERIE, 200)!;
    expect(conCompra.indice).toBeCloseTo(sinCompra.indice, 6);
  });

  it("un ingreso en sábado usa el último día que cotizó", () => {
    const c = contraIndice([op("2024-06-30", "deposit", 100)], SERIE, 100)!;
    // 2024-06-30 no está en la serie: vale el 100 del 2024-01-01.
    expect(c.indice).toBeCloseTo(200, 6);
  });

  it("sin ingresos no hay nada que comparar", () => {
    expect(contraIndice([op("2024-01-01", "buy", 100)], SERIE, 100)).toBeNull();
    expect(contraIndice([], SERIE, 100)).toBeNull();
  });

  it("sin serie tampoco", () => {
    expect(contraIndice([op("2024-01-01", "deposit", 100)], [], 100)).toBeNull();
  });

  it("sacar más de lo que se metió deja la comparación sin sentido", () => {
    const c = contraIndice(
      [op("2024-01-01", "deposit", 100), op("2024-07-01", "withdrawal", 300)],
      SERIE,
      0,
    );
    expect(c).toBeNull();
  });
});
