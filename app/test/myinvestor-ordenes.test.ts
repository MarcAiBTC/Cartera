// ── LAS ÓRDENES DE FONDOS DE MYINVESTOR ─────────────────────────────────
// El CSV de «Órdenes» de la sección de fondos: el mejor archivo del banco y
// también el más traicionero. No dice qué es compra y qué es venta, y las
// participaciones llevan coma decimal —«0,711»— que leída a la inglesa son
// setecientas once. Los datos imitan la forma del archivo real, sin nada que
// identifique a nadie: sólo fechas, ISIN e importes.

import { describe, expect, it } from "vitest";
import { desdeTexto, detectar, hayTrabajo, leer, planificar } from "../src/lib/import";
import { simular } from "../src/lib/import/simular";
import { calcularPosiciones } from "../src/lib/cartera";
import type { Activo, EntradaCatalogo, EstadoCartera, Operacion } from "../src/lib/tipos";
import { ESTADO_VACIO } from "../src/lib/tipos";

const CABECERA = "Fecha de la orden;ISIN;Importe estimado;Nº de participaciones;Estado";

// Un traspaso del Vanguard partido en dos el 1 de septiembre, otro entero en
// junio, y el del World Gold al AXA en agosto. Entre medias, compras normales
// —de importe redondo— el mismo día que las patas de los traspasos.
const ORDENES = `${CABECERA}
07/09/2026;IE0032126645;50 EUR;0,62;Finalizada
07/09/2026;IE00BYX5NX33;10 EUR;0,711;Finalizada
21/08/2026;FR0000447823;10.07 EUR;0,004;Finalizada
20/08/2026;LU0171305526;9.63 EUR;0,1;Finalizada
03/06/2026;FR0000447823;352.11 EUR;0,132;Finalizada
02/06/2026;IE0032126645;349.94 EUR;4,42;Finalizada
03/09/2025;IE00BYX5NX33;49.34 EUR;4,182;Finalizada
03/09/2025;LU0625737910;49.34 EUR;0,347;Finalizada
03/09/2025;IE00BYX5NX33;5 EUR;0,423;Finalizada
03/09/2025;LU0625737910;5 EUR;0,035;Finalizada
01/09/2025;IE0032126645;49.5 EUR;0,74;Finalizada
01/09/2025;IE0032126645;49.5 EUR;0,74;Finalizada
27/08/2025;IE0002639668;10 USD;0,12;Finalizada
01/04/2025;LU0171305526;5 EUR;0,1;Finalizada
04/01/2024;IE0032126645;600 EUR;10,48;Finalizada
06/11/2023;IE0002639668;1.64 USD;0,03;Finalizada
12/12/2023;IE0032126645;30 EUR;0,5;Cancelada`;

const lectura = () => leer(desdeTexto(ORDENES, "ordenes.csv"));
const fila = (fecha: string, isin: string, total: number) =>
  lectura().filas.filter((f) => f.fecha === fecha && f.isin === isin && f.total === total);

const catalogo = (): EntradaCatalogo[] => [
  // El nombre está en la fila del símbolo y el ISIN en la del alias: así es
  // como sale del catálogo de verdad.
  {
    symbol: "0P0001CLDK.F",
    name: "Fidelity MSCI World Index",
    isin: null,
    ticker: "0P0001CLDK",
    yahoo: "0P0001CLDK.F",
    coingecko: null,
    currency: "EUR",
    cat: "fondo",
    underlying: "MSCI World",
    retired: false,
  },
  {
    symbol: "IE00BYX5NX33",
    name: null,
    isin: "IE00BYX5NX33",
    ticker: null,
    yahoo: "0P0001CLDK.F",
    coingecko: null,
    currency: null,
    cat: null,
    underlying: null,
    retired: false,
  },
  {
    symbol: "0P00000RNC",
    name: "Vanguard US500 USD Acc",
    isin: "IE0002639668",
    ticker: "0P00000RNC",
    yahoo: "0P00000RNC",
    coingecko: null,
    currency: "USD",
    cat: "fondo",
    underlying: "S&P 500",
    retired: false,
  },
];

const vacio = (): EstadoCartera => structuredClone(ESTADO_VACIO);

describe("leer las órdenes de fondos", () => {
  it("reconoce el archivo aunque no tenga columna de tipo", () => {
    expect(detectar(desdeTexto(ORDENES, "ordenes.csv"))).toBe("myinvestor-ordenes");
  });

  it("lee las participaciones con coma decimal, no como millares", () => {
    // `num()` las leía a la inglesa: 0,711 eran 711 y el fondo salía mil
    // veces más grande.
    expect(fila("2026-09-07", "IE00BYX5NX33", 10)[0].cantidad).toBe(0.711);
    expect(fila("2025-09-03", "IE00BYX5NX33", 49.34)[0].cantidad).toBe(4.182);
  });

  it("saca la divisa del propio importe", () => {
    const f = fila("2025-08-27", "IE0002639668", 10)[0];
    expect(f.divisa).toBe("USD");
    expect(f.total).toBe(10);
  });

  it("deja fuera las órdenes que no se ejecutaron", () => {
    const l = lectura();
    expect(l.filas.some((f) => f.fecha === "2023-12-12")).toBe(false);
    expect(l.descartes.some((d) => /no ejecutada/.test(d.motivo))).toBe(true);
  });

  it("reconoce los traspasos: el primero es un reembolso y el segundo su suscripción", () => {
    const ventas = lectura().filas.filter((f) => f.tipo === "sell");
    expect(ventas.map((f) => `${f.fecha} ${f.isin} ${f.total}`).sort()).toEqual([
      "2025-09-01 IE0032126645 49.5",
      "2025-09-01 IE0032126645 49.5",
      "2026-06-02 IE0032126645 349.94",
      "2026-08-20 LU0171305526 9.63",
    ]);
    expect(ventas.every((f) => f.traspasoInterno)).toBe(true);

    const entrada = fila("2026-06-03", "FR0000447823", 352.11)[0];
    expect(entrada.tipo).toBe("buy");
    expect(entrada.traspasoInterno).toBe(true);
    expect(entrada.nota).toBe("Traspaso desde IE0032126645");
  });

  it("no toma por traspaso una compra de importe redondo del mismo día", () => {
    for (const f of fila("2025-09-03", "IE00BYX5NX33", 5)) {
      expect(f.tipo).toBe("buy");
      expect(f.traspasoInterno).toBe(false);
    }
    // Ni una compra con céntimos que no tiene pareja.
    expect(fila("2023-11-06", "IE0002639668", 1.64)[0].tipo).toBe("buy");
  });

  it("no vende lo que todavía no se tiene", () => {
    // Dos compras con céntimos y casi el mismo importe, a dos días: parecen un
    // traspaso, pero del primer fondo no había nada que reembolsar.
    const l = leer(
      desdeTexto(
        `${CABECERA}
12/03/2025;LU0625737910;5.10 EUR;0,04;Finalizada
10/03/2025;IE00BYX5MD61;5.12 EUR;0,6;Finalizada`,
        "ordenes.csv",
      ),
    );
    expect(l.filas.map((f) => f.tipo)).toEqual(["buy", "buy"]);
  });

  it("mantiene las dos órdenes idénticas del mismo día", () => {
    const plan = planificar(lectura(), { estado: vacio(), fx: { EUR: 1, USD: 0.86 } });
    const iguales = plan.nuevas.filter((p) => p.fila.fecha === "2025-09-01");
    expect(iguales).toHaveLength(2);
    expect(new Set(iguales.map((p) => p.operacion.import_hash)).size).toBe(2);
  });

  it("deja cada fondo con las participaciones que tiene de verdad", () => {
    const plan = planificar(lectura(), { estado: vacio(), fx: { EUR: 1, USD: 0.86 } });
    const { estado } = simular(plan, vacio());
    const qty = (isin: string) =>
      calcularPosiciones(estado, {}, { EUR: 1 }).find((p) => p.activo.isin === isin)?.qty ?? 0;
    // 10,48 − 0,74 − 0,74 − 4,42 + 0,62
    expect(qty("IE0032126645")).toBeCloseTo(5.2, 6);
    expect(qty("LU0171305526")).toBeCloseTo(0, 6);
    expect(qty("IE00BYX5NX33")).toBeCloseTo(0.711 + 4.182 + 0.423, 6);
  });
});

describe("planificar las órdenes", () => {
  it("les pone el nombre del catálogo en vez del ISIN", () => {
    const plan = planificar(lectura(), {
      estado: vacio(),
      fx: { EUR: 1, USD: 0.86 },
      catalogo: catalogo(),
    });
    const nombres = plan.activosNuevos.map((a) => a.name);
    expect(nombres).toContain("Fidelity MSCI World Index");
    expect(nombres).toContain("Vanguard US500 USD Acc");
    // Lo que el catálogo no conoce sigue saliendo, aunque sea con el ISIN.
    expect(nombres).toContain("IE0032126645");
    expect(plan.nombres.IE00BYX5NX33).toBe("Fidelity MSCI World Index");
  });

  describe("sobre una importación que entró mal", () => {
    // Así quedó el archivo leído como «otro bróker»: todo compras, sin
    // cuenta, en euros, y 0,711 convertido en 711.
    const MAL = `${CABECERA}
07/09/2026;IE00BYX5NX33;10 EUR;0,711;Finalizada
27/08/2025;IE0002639668;10 USD;0,12;Finalizada`;

    const activo = (id: string, isin: string): Activo => ({
      id,
      name: isin,
      ticker: null,
      isin,
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
    const op = (id: string, assetId: string, date: string, quantity: number): Operacion => ({
      id,
      account_id: null,
      asset_id: assetId,
      type: "buy",
      date,
      quantity,
      price: null,
      total: 10,
      fees: 0,
      currency: "EUR",
      total_eur: 10,
      is_internal_transfer: false,
      source: "import",
      source_format: "generico-csv",
      import_hash: `viejo-${id}`,
      notes: null,
    });
    const estadoMal = (): EstadoCartera => {
      const e = vacio();
      e.activos = [activo("w", "IE00BYX5NX33"), activo("u", "IE0002639668")];
      e.operaciones = [op("o1", "w", "2026-09-07", 711), op("o2", "u", "2025-08-27", 0.12)];
      return e;
    };
    const plan = (estado: EstadoCartera) =>
      planificar(leer(desdeTexto(MAL, "ordenes.csv")), {
        estado,
        fx: { EUR: 1, USD: 0.86 },
        catalogo: catalogo(),
      });

    it("corrige en su sitio en vez de duplicar", () => {
      const p = plan(estadoMal());
      expect(p.nuevas).toHaveLength(0);
      expect(p.corregidas).toHaveLength(2);
      const mundo = p.corregidas.find((x) => x.corrige!.id === "o1")!;
      expect(mundo.cambios?.quantity).toBe(0.711);
      const usd = p.corregidas.find((x) => x.corrige!.id === "o2")!;
      expect(usd.cambios?.currency).toBe("USD");
      expect(usd.cambios?.total_eur).toBeCloseTo(8.6, 6);
      expect(hayTrabajo(p)).toBe(true);
    });

    it("pone nombre, símbolo y divisa a los activos que se llamaban como su ISIN", () => {
      const p = plan(estadoMal());
      const w = p.renombrar.find((r) => r.activo.id === "w")!;
      expect(w.campos.name).toBe("Fidelity MSCI World Index");
      expect(w.campos.ticker).toBe("0P0001CLDK.F");
      const u = p.renombrar.find((r) => r.activo.id === "u")!;
      expect(u.campos.currency).toBe("USD");
    });

    it("una vez corregido, reimportar ya no toca nada", () => {
      const { estado } = simular(plan(estadoMal()), estadoMal());
      const otra = plan(estado);
      expect(otra.corregidas).toHaveLength(0);
      expect(otra.duplicadas).toHaveLength(2);
      expect(otra.renombrar).toHaveLength(0);
      expect(hayTrabajo(otra)).toBe(false);
    });
  });
});

describe("el dinero y lo que no está en ningún archivo", () => {
  const opciones = { estado: vacio(), fx: { EUR: 1, USD: 0.86 } };

  it("pregunta el efectivo: sin respuesta no se inventa ninguno", () => {
    const plan = planificar(lectura(), opciones);
    expect(plan.efectivo).toBeUndefined();
    expect(plan.liquidez?.nombre).toBe("Efectivo · MyInvestor");
  });

  it("con lo que dice una persona, crea la cuenta de efectivo con ese saldo", () => {
    const plan = planificar(lectura(), { ...opciones, saldo: 218.32 });
    expect(plan.efectivo?.saldo).toBe(218.32);
    expect(plan.efectivo?.origen).toBe("persona");
    expect(plan.efectivo?.activo.manual_cost_unit).toBe(1);
  });

  it("lo añadido a mano entra con su valor y sin ganancia inventada", () => {
    const plan = planificar(lectura(), {
      ...opciones,
      extras: [{ nombre: "ETC iShares Physical Gold", valor: 180 }],
    });
    expect(plan.extras).toHaveLength(1);
    expect(plan.extras[0]).toMatchObject({
      name: "ETC iShares Physical Gold",
      cat: "metal",
      mode: "manual",
      manual_qty: 1,
      manual_price: 180,
      manual_cost_unit: 180,
    });

    const { estado, delBroker } = simular(plan, vacio());
    const oro = calcularPosiciones(estado, {}, { EUR: 1 }).find((p) => p.activo.name.includes("Gold"))!;
    expect(oro.valor).toBe(180);
    expect(oro.ganancia).toBe(0);
    expect(delBroker.has(oro.activo.id)).toBe(true);
  });
});
