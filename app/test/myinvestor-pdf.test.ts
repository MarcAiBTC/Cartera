// ── EL EXTRACTO DE POSICIÓN DE MYINVESTOR, EN PDF ────────────────────────
// El archivo que arregla MyInvestor. Los otros dos —el Excel de la cuenta y
// el CSV— cuentan movimientos con el nombre del fondo cortado a 30 caracteres:
// sin ISIN no hay precio y sin participaciones no hay posición, así que los
// ocho fondos de la cartera valían cero euros. Este PDF dice lo que tienes.
//
// El PDF de las pruebas se construye aquí, con las mismas coordenadas y los
// mismos textos que el de verdad (las cifras cambiadas), porque el de verdad
// lleva el nombre, la dirección y el número de cuenta de una persona.

import { describe, expect, it } from "vitest";
import { leerPdf, textoPdf } from "../src/lib/import/pdf";
import { esMyInvestorExtracto, leerMyInvestorExtracto } from "../src/lib/import/myinvestor";
import { combinar, desdeMatriz, detectar, leer, parecido, planificar } from "../src/lib/import";
import type { Activo, EstadoCartera, Operacion } from "../src/lib/tipos";
import { ESTADO_VACIO } from "../src/lib/tipos";

// ── Un PDF de mentira, con la forma del de verdad ────────────────────────

interface Celda {
  x: number;
  y: number;
  t: string;
}

/** Donde WinAnsi se separa de Latin-1. El euro es el que importa: en un PDF
 *  va en el byte 0x80, que en Latin-1 no es ningún carácter. */
const WINANSI: Record<string, number> = { "€": 0x80, "’": 0x92 };

/** Escapa una cadena como la escribe un PDF: un byte por carácter, y los de
 *  fuera del ASCII en octal, que es justo lo que hay que saber deshacer. */
function literal(s: string): string {
  let out = "";
  for (const c of s) {
    const n = WINANSI[c] ?? c.charCodeAt(0);
    if (c === "(" || c === ")" || c === "\\") out += "\\" + c;
    else if (n > 126) out += "\\" + n.toString(8).padStart(3, "0");
    else out += c;
  }
  return out;
}

/** Un PDF con una página por grupo de celdas. Basta para el lector: recorre
 *  los flujos entre `stream` y `endstream`, así que no hacen falta ni la tabla
 *  de referencias cruzadas ni el catálogo de objetos. */
async function pdfDe(paginas: Celda[][], comprimir = true): Promise<Uint8Array> {
  const trozos: Uint8Array[] = [];
  const escribe = (s: string) => trozos.push(Uint8Array.from(s, (c) => c.charCodeAt(0)));

  escribe("%PDF-1.4\n");
  for (const celdas of paginas) {
    const cuerpo = celdas
      .map((c) => `BT\n/F1 12 Tf\n1 0 0 1 ${c.x} ${c.y} Tm\n(${literal(c.t)})Tj\nET\n`)
      .join("");
    const crudo = Uint8Array.from(cuerpo, (c) => c.charCodeAt(0));
    const datos = comprimir
      ? new Uint8Array(
          await new Response(
            new Blob([crudo as BlobPart]).stream().pipeThrough(new CompressionStream("deflate")),
          ).arrayBuffer(),
        )
      : crudo;
    escribe(`1 0 obj\n<< /Length ${datos.length} >>\nstream\n`);
    trozos.push(datos);
    escribe("\nendstream\nendobj\n");
  }
  escribe("%%EOF\n");

  const total = trozos.reduce((s, t) => s + t.length, 0);
  const salida = new Uint8Array(total);
  let i = 0;
  for (const t of trozos) {
    salida.set(t, i);
    i += t.length;
  }
  return salida;
}

/** Una fila de la tabla de movimientos, con las X del extracto de verdad. */
const movimiento = (y: number, f: string, orden: string, concepto: string, importe: string) => [
  { x: 57.45, y, t: f },
  { x: 133.95, y, t: f },
  { x: 210.45, y, t: orden },
  { x: 398.44, y, t: concepto },
  { x: 632.96, y, t: importe },
];

/** Una fila de la tabla de posiciones. */
const posicion = (
  y: number,
  isin: string,
  nombre: string,
  divisa: string,
  titulos: string,
  valor: string,
) => [
  { x: 57.45, y, t: isin },
  { x: 156.7, y, t: nombre },
  { x: 323.5, y, t: divisa },
  { x: 374.0, y, t: titulos },
  { x: 602.5, y, t: valor },
  { x: 694.2, y, t: valor },
];

const PAGINA_RESUMEN: Celda[] = [
  { x: 65, y: 466.7, t: "PERSONA DE EJEMPLO" },
  { x: 56.7, y: 254.8, t: "Cuentas" },
  { x: 57.45, y: 218.7, t: "Efectivo" },
  { x: 239.6, y: 218.7, t: "Activada" },
  { x: 56.7, y: 157.3, t: "Posición Integrada, ahorro e inversiones" },
  { x: 57.45, y: 123.0, t: "Efectivo" },
  { x: 330.6, y: 123.0, t: "218,3200 €" },
  // Las cifras cuadran con las cuatro posiciones de más abajo al cambio que
  // usan las pruebas (USD 0,86): 390,13 + 238,66 + 1.172,58 + 563,29 × 0,86.
  // Que cuadren no es cosmética: es la prueba de que la tabla de posiciones lo
  // cuenta todo, y sin ella no se puede archivar nada.
  { x: 57.45, y: 106.9, t: "Inversión" },
  { x: 330.6, y: 106.9, t: "2.285,8000 €" },
  { x: 57.45, y: 90.4, t: "Total" },
  { x: 330.6, y: 90.4, t: "2.504,1200 €" },
];

const PAGINA_MOVIMIENTOS: Celda[] = [
  { x: 56.7, y: 527.7, t: "Detalle últimos movimientos de efectivo" },
  { x: 57.45, y: 493.13, t: "Fecha " },
  { x: 57.45, y: 478.84, t: "operación" },
  { x: 133.95, y: 486, t: "Fecha valor" },
  { x: 210.45, y: 486, t: "Operacion" },
  { x: 398.44, y: 486, t: "Concepto" },
  { x: 632.96, y: 486, t: "Importe" },
  { x: 709.46, y: 486, t: "Saldo" },
  // El concepto que no cabe se parte en dos renglones, uno por encima del
  // resto de la fila y otro por debajo. Es el caso que rompe el agrupado.
  { x: 57.45, y: 455.74, t: "03/09/2026" },
  { x: 133.95, y: 455.74, t: "04/09/2026" },
  { x: 210.45, y: 455.74, t: "SUSCRIPCION IIC" },
  { x: 398.44, y: 462.68, t: "PICTET-CHINA IX P EUR @ " },
  { x: 398.44, y: 448.8, t: "0.0381" },
  { x: 632.96, y: 455.74, t: "-4,99" },
  ...movimiento(425.74, "24/08/2026", "TRANSFERENCIA INMEDIATA", "Envio de dinero - otroBanco", "100,00"),
  ...movimiento(395.74, "12/08/2026", "LIQUIDAC. INTERESES", "PERIODO 11/07/2026 11/08/2026", "0,07"),
  ...movimiento(365.74, "05/08/2026", "SUSCRIPCION IIC", "FIDELITY MSCI WORLD INDEX P AC", "-9,99"),
];

const PAGINA_POSICIONES: Celda[] = [
  { x: 56.7, y: 527.7, t: "Posiciones" },
  { x: 57.45, y: 486, t: "Código" },
  { x: 156.7, y: 486, t: "Nombre" },
  { x: 323.5, y: 486, t: "Divisa" },
  { x: 374.0, y: 486, t: "Títulos" },
  { x: 488.3, y: 486, t: "Precio medio posicion" },
  { x: 602.5, y: 486, t: "Valor de mercado" },
  { x: 694.2, y: 486, t: "Valor de mercado EUR" },
  ...posicion(455.7, "IE00BYX5NX33", "MSCI WORLD INDEX P ACC EUR", "EUR", "27.415", "390,1300 €"),
  ...posicion(425.7, "LU0625737910", "PICTET CHINA INDEX P ACC", "EUR", "1.80942", "238,6600 €"),
  ...posicion(395.7, "IE0032126645", "VANGUARD US 500 STOCK EUR", "EUR", "14.45", "1.172,5800 €"),
  ...posicion(365.7, "IE0002639668", "VANGUARD US 500 STOCK IND USD", "USD", "6.1", "563,2900 $"),
];

const PAGINA_PIE: Celda[] = [
  { x: 56.7, y: 527.7, t: "Tarjetas" },
  { x: 57.45, y: 493, t: "Tipo" },
  { x: 300.3, y: 493, t: "Estado" },
  { x: 56.7, y: 458, t: "Movimientos Tarjetas" },
  { x: 57.45, y: 420, t: "Tarjeta" },
  { x: 171.4, y: 420, t: "Fecha operación" },
  { x: 398.44, y: 420, t: "Concepto" },
  { x: 632.96, y: 420, t: "Importe" },
  { x: 56.7, y: 300, t: "MyInvestor Banco S.A. CIF A-00.000.000 Madrid" },
];

const EXTRACTO = () =>
  pdfDe([PAGINA_RESUMEN, PAGINA_MOVIMIENTOS, PAGINA_POSICIONES, PAGINA_PIE]);

// ════════════════════════════════════════════════════════════════════════
//  EL LECTOR DE PDF
// ════════════════════════════════════════════════════════════════════════

describe("leer un PDF", () => {
  it("saca el texto de un flujo comprimido", async () => {
    const filas = await leerPdf(await pdfDe([[{ x: 50, y: 700, t: "Posición Integrada" }]]));
    expect(textoPdf(filas)).toBe("Posición Integrada");
  });

  it("lee también un flujo sin comprimir", async () => {
    const filas = await leerPdf(
      await pdfDe([[{ x: 50, y: 700, t: "Posiciones" }]], false),
    );
    expect(textoPdf(filas)).toBe("Posiciones");
  });

  it("junta en una fila las celdas que comparten renglón", async () => {
    const filas = await leerPdf(await pdfDe([PAGINA_POSICIONES]));
    const fila = filas.find((f) => f.celdas[0]?.texto === "IE00BYX5NX33");
    expect(fila?.celdas.map((c) => c.texto)).toEqual([
      "IE00BYX5NX33",
      "MSCI WORLD INDEX P ACC EUR",
      "EUR",
      "27.415",
      "390,1300 €",
      "390,1300 €",
    ]);
  });

  it("junta los dos renglones de una celda partida, aunque el primero quede por encima de la fila", async () => {
    const filas = await leerPdf(await pdfDe([PAGINA_MOVIMIENTOS]));
    const fila = filas.find((f) => f.celdas[0]?.texto === "03/09/2026");
    // Y con esto el concepto vuelve a medir los 30 caracteres que corta el
    // banco, que es de lo que depende el resto del adaptador.
    expect(fila?.celdas[3].texto).toBe("PICTET-CHINA IX P EUR @ 0.0381");
    expect(fila?.celdas[3].texto).toHaveLength(30);
  });

  it("no confunde una página con otra", async () => {
    const filas = await leerPdf(await EXTRACTO());
    expect(new Set(filas.map((f) => f.pagina))).toEqual(new Set([1, 2, 3, 4]));
  });
});

// ════════════════════════════════════════════════════════════════════════
//  EL ADAPTADOR
// ════════════════════════════════════════════════════════════════════════

describe("MyInvestor · extracto de posición", () => {
  it("lo reconoce y no lo confunde con otra cosa", async () => {
    const filas = await leerPdf(await EXTRACTO());
    expect(esMyInvestorExtracto(filas)).toBe(true);
    expect(detectar({ nombre: "extracto.pdf", pdf: filas })).toBe("myinvestor-extracto");
  });

  it("lee las posiciones con su ISIN, sus títulos y su divisa", async () => {
    const l = leerMyInvestorExtracto(await leerPdf(await EXTRACTO()));
    expect(l.posiciones?.map((p) => p.isin)).toEqual([
      "IE00BYX5NX33",
      "LU0625737910",
      "IE0032126645",
      "IE0002639668",
    ]);
    const usd = l.posiciones!.find((p) => p.isin === "IE0002639668")!;
    expect(usd.divisa).toBe("USD");
    expect(usd.titulos).toBeCloseTo(6.1, 6);
    expect(usd.valor).toBeCloseTo(563.29, 2);
  });

  it("«27.415» son veintisiete títulos y no veintisiete mil", async () => {
    // La regla del punto de millares de `num()` daba 27415 aquí, y con ella la
    // posición salía mil veces más grande. Los títulos vienen en formato
    // inglés y se leen aparte.
    const l = leerMyInvestorExtracto(await leerPdf(await EXTRACTO()));
    const mundo = l.posiciones!.find((p) => p.isin === "IE00BYX5NX33")!;
    expect(mundo.titulos).toBeCloseTo(27.415, 6);
    expect(mundo.valor / mundo.titulos).toBeCloseTo(14.23, 2);
  });

  it("se queda con el saldo que declara el banco", async () => {
    const l = leerMyInvestorExtracto(await leerPdf(await EXTRACTO()));
    expect(l.saldo).toBeCloseTo(218.32, 2);
  });

  it("importa el dinero y deja fuera las órdenes de fondo", async () => {
    const l = leerMyInvestorExtracto(await leerPdf(await EXTRACTO()));
    // El ingreso y los intereses entran; las dos suscripciones, no: de este
    // PDF vale la posición, y las compras están enteras en el Excel.
    expect(l.filas.map((f) => f.tipo)).toEqual(["deposit", "interest"]);
    expect(l.descartes.some((d) => /órdenes de fondo/.test(d.motivo))).toBe(true);
  });

  it("no se cuela con la tabla de movimientos de las tarjetas", async () => {
    // Tiene las mismas columnas que la de la cuenta y viene después.
    const l = leerMyInvestorExtracto(await leerPdf(await EXTRACTO()));
    expect(l.filas).toHaveLength(2);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  CASAR LAS POSICIONES CON LA CARTERA
// ════════════════════════════════════════════════════════════════════════

const activo = (id: string, name: string, extra: Partial<Activo> = {}): Activo => ({
  id,
  name,
  ticker: null,
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
  ...extra,
});

const compra = (assetId: string, euros: number, i: number): Operacion => ({
  id: `op${i}`,
  account_id: "cuenta1",
  asset_id: assetId,
  type: "buy",
  date: "2026-01-0" + ((i % 9) + 1),
  quantity: null,
  price: null,
  total: euros,
  fees: 0,
  currency: "EUR",
  total_eur: euros,
  is_internal_transfer: false,
  source: "import",
  source_format: "myinvestor-cuenta",
  import_hash: `h${i}`,
  notes: null,
});

function estadoCon(activos: Activo[], ops: Operacion[]): EstadoCartera {
  const e = structuredClone(ESTADO_VACIO);
  e.cuentas = [{ id: "cuenta1", name: "MyInvestor", broker: "MyInvestor", currency: "EUR" }];
  e.activos = activos;
  e.operaciones = ops;
  return e;
}

describe("parecido entre nombres", () => {
  it("reconoce el nombre cortado a 30 caracteres", () => {
    // «ACC» se quedó en «AC» y «EUR» en «EU»: exigir la palabra entera tiraba
    // justo los emparejamientos que importan.
    expect(parecido("FIDELITY MSCI WORLD INDEX P AC", "MSCI WORLD INDEX P ACC EUR")).toBeGreaterThan(0.7);
    expect(parecido("PICTET-CHINA IX P EUR", "PICTET CHINA INDEX P ACC")).toBeGreaterThan(0.5);
  });

  it("no casa dos fondos distintos de la misma gestora", () => {
    expect(parecido("PICTET CHINA INDEX P ACC", "PICTET EUROPE INDEX P ACC")).toBeLessThan(0.9);
    expect(parecido("AXA TRESOR COURT TERME C EUR", "MSCI WORLD INDEX P ACC EUR")).toBeLessThan(0.5);
  });
});

describe("planificar con posiciones", () => {
  const plan = async (estado: EstadoCartera, emparejamientos?: Record<string, string>) => {
    const entrada = { nombre: "extracto.pdf", pdf: await leerPdf(await EXTRACTO()) };
    return planificar(leer(entrada, { formato: "myinvestor-extracto" }), {
      estado,
      fx: { EUR: 1, USD: 0.86 },
      cuentaId: "cuenta1",
      emparejamientos,
    });
  };

  it("le pone el ISIN al activo que el banco había dejado sin él", async () => {
    const estado = estadoCon(
      [activo("a1", "FIDELITY MSCI WORLD INDEX P AC")],
      [compra("a1", 100, 1), compra("a1", 139.97, 2)],
    );
    const p = (await plan(estado)).posiciones.find((x) => x.posicion.isin === "IE00BYX5NX33")!;
    expect(p.activo?.id).toBe("a1");
    expect(p.campos.isin).toBe("IE00BYX5NX33");
    expect(p.campos.manual_qty).toBeCloseTo(27.415, 6);
    expect(p.campos.mode).toBe("manual");
    // El coste sale de las compras que ya están importadas.
    expect(p.coste).toBeCloseTo(239.97, 2);
    expect(p.campos.manual_cost_unit).toBeCloseTo(239.97 / 27.415, 4);
  });

  it("junta el mismo fondo que entró dos veces con el nombre cortado distinto", async () => {
    const estado = estadoCon(
      [activo("a1", "PICTET-CHINA IX P EUR"), activo("a2", "PICTET CHINA INDEX P ACC")],
      [compra("a1", 59.88, 1), compra("a1", 59.88, 2), compra("a2", 14.98, 3)],
    );
    const p = (await plan(estado)).posiciones.find((x) => x.posicion.isin === "LU0625737910")!;
    // Se queda el que más historia tiene y el otro se archiva, pero su dinero
    // cuenta: si no, esos 14,98 € desaparecerían del coste.
    expect(p.activo?.id).toBe("a1");
    expect(p.absorbidos.map((a) => a.id)).toEqual(["a2"]);
    expect(p.coste).toBeCloseTo(134.74, 2);
    // Y el activo que se queda pasa a llamarse como lo llama el banco.
    expect(p.campos.name).toBe("PICTET CHINA INDEX P ACC");
  });

  it("entre dos clases del mismo fondo elige por la divisa del nombre", async () => {
    // «VANGUARD US 500 STOCK INDEX EU» se parece exactamente igual a la clase
    // en euros («…STOCK EUR», comparten EU/EUR) y a la de dólares («…STOCK IND
    // USD», comparten INDEX/IND): el recuento de palabras empata. Lo que las
    // separa es la divisa que el nombre lleva al final y que el extracto
    // declara en su columna. Sin esto los 747 € se iban a un activo nuevo al
    // lado del bueno, y el fondo se quedaba con 4,96 € de coste.
    const estado = estadoCon(
      [activo("a1", "VANGUARD US 500 STOCK INDEX EU")],
      [compra("a1", 747.28, 1)],
    );
    const ps = (await plan(estado)).posiciones;
    const eur = ps.find((x) => x.posicion.isin === "IE0032126645")!;
    const usd = ps.find((x) => x.posicion.isin === "IE0002639668")!;
    expect(eur.activo?.id).toBe("a1");
    expect(eur.dudoso).toBe(false);
    expect(eur.coste).toBeCloseTo(747.28, 2);
    expect(usd.activo).toBeUndefined();
    expect(usd.coste).toBe(0);
  });

  it("pero si las dos clases están en la misma divisa, pregunta", async () => {
    // La divisa sólo deshace el empate cuando de verdad lo deshace. Dos clases
    // del mismo fondo y de la misma divisa —acumulación y distribución— siguen
    // empatadas, y elegir ahí es mudarle el dinero al fondo de al lado.
    const lectura = leerMyInvestorExtracto(await leerPdf(await EXTRACTO()));
    lectura.posiciones = lectura.posiciones!.map((p) =>
      p.isin === "IE0002639668" ? { ...p, divisa: "EUR" } : p,
    );
    const estado = estadoCon(
      [activo("a1", "VANGUARD US 500 STOCK INDEX EU")],
      [compra("a1", 747.28, 1)],
    );
    const ps = planificar(lectura, {
      estado,
      fx: { EUR: 1, USD: 0.86 },
      cuentaId: "cuenta1",
    }).posiciones.filter((x) => /VANGUARD/.test(x.posicion.nombre));
    expect(ps.every((p) => p.dudoso)).toBe(true);
    expect(ps.every((p) => p.activo == null)).toBe(true);
  });

  it("y hace caso cuando se lo dices a mano", async () => {
    const estado = estadoCon(
      [activo("a1", "VANGUARD US 500 STOCK INDEX EU")],
      [compra("a1", 747.28, 1)],
    );
    const p = (await plan(estado, { IE0032126645: "a1" })).posiciones.find(
      (x) => x.posicion.isin === "IE0032126645",
    )!;
    expect(p.activo?.id).toBe("a1");
    expect(p.dudoso).toBe(false);
    expect(p.coste).toBeCloseTo(747.28, 2);
  });

  it("el coste de una posición en dólares va en dólares, no en euros", async () => {
    // El motor multiplica `manual_cost_unit` por el cambio. Con el coste en
    // euros, una posición en dólares salía un 16% inflada.
    const estado = estadoCon(
      [activo("a1", "VANGUARD US 500 STOCK IND USD")],
      [compra("a1", 430, 1)],
    );
    const p = (await plan(estado, { IE0002639668: "a1" })).posiciones.find(
      (x) => x.posicion.isin === "IE0002639668",
    )!;
    expect(p.campos.currency).toBe("USD");
    expect(p.campos.manual_cost_unit).toBeCloseTo(430 / 0.86 / 6.1, 4);
  });

  it("un fondo del que no hay ninguna compra entra sin ganancia inventada", async () => {
    const p = (await plan(estadoCon([], []))).posiciones.find(
      (x) => x.posicion.isin === "IE00BYX5NX33",
    )!;
    expect(p.activo).toBeUndefined();
    expect(p.campos.manual_cost_unit).toBeCloseTo(p.campos.manual_price!, 6);
  });

  it("el saldo lo pone el extracto, no la suma de los movimientos", async () => {
    const { efectivo } = await plan(estadoCon([], []));
    expect(efectivo?.declarado).toBe(true);
    expect(efectivo?.saldo).toBeCloseTo(218.32, 2);
    // Los movimientos del PDF son un mes escaso: por sí solos no dan el saldo.
    expect(efectivo?.calculado).not.toBeCloseTo(218.32, 2);
  });

  // ── Lo que el extracto dice que ya no tienes ────────────────────────────
  // MyInvestor no lista una venta ni un traspaso en la cuenta corriente, así
  // que hay valores que aparecen en las compras y no vuelven a aparecer nunca.
  // Entran sin participaciones y sin precio: filas a cero euros que no dicen
  // nada. Y NO se pueden dar por vendidos, por mucho que el extracto cuadre su
  // propio total: el «Extracto de cuenta» de MyInvestor cuadra la cuenta de
  // efectivo, y los ETC y los ETF viven en la de valores, que no sale en él.
  // Darlos por cerrados borraba de la cartera 423 € que sí estaban ahí. Lo
  // único honesto es preguntar cuánto valen.

  /** El Excel de la cuenta y el PDF, juntos, como los sube la pantalla. */
  const conExcel = async (
    filas: string[][],
    fx: Record<string, number> = { EUR: 1, USD: 0.86 },
    valores?: Record<string, number>,
  ) => {
    const excel = desdeMatriz([
      ["", "", "TITULAR:", "PERSONA DE EJEMPLO", "", ""],
      ["", "", "Saldo:", "218,32€", "", ""],
      ["Movimientos", "", "", "", "", ""],
      ["Fecha Operación", "Fecha Valor", "Movimiento", "", "Importe", "Saldo"],
      ...filas,
    ]);
    const pdf = await leerPdf(await EXTRACTO());
    const lectura = combinar([
      leer({ nombre: "cuenta.xlsx", tabla: excel }, { formato: "myinvestor-cuenta" }),
      leer({ nombre: "extracto.pdf", pdf }, { formato: "myinvestor-extracto" }),
    ]);
    return {
      lectura,
      plan: planificar(lectura, {
        estado: estadoCon([], []),
        fx,
        cuentaId: "cuenta1",
        valores,
      }),
    };
  };

  /** Un ETC comprado y nunca más visto, y un fondo que sí está en el extracto. */
  const COMPRAS = [
    ["08/09/2025", "10/09/2025", "FIDELITY PHYSICAL BITCOIN ET @", "", "-9,30€", "262,41€"],
    ["16/09/2025", "18/09/2025", "FIDELITY PHYSICAL BITCOIN ET @", "", "-9,64€", "252,77€"],
    ["05/08/2026", "06/08/2026", "FIDELITY MSCI WORLD INDEX P AC", "", "-9,99€", "242,78€"],
  ];

  it("lee lo que el extracto declara como total", async () => {
    const l = leerMyInvestorExtracto(await leerPdf(await EXTRACTO()));
    expect(l.declarado?.efectivo).toBeCloseTo(218.32, 2);
    expect(l.declarado?.invertido).toBeCloseTo(2285.8, 2);
    expect(l.declarado?.total).toBeCloseTo(2504.12, 2);
  });

  it("no da por vendido lo que el extracto no menciona: lo pregunta", async () => {
    const { plan: p } = await conExcel(COMPRAS);
    // El extracto cuadra su propio total, y aun así eso NO autoriza a nada: lo
    // único que dice es hasta dónde llega el archivo.
    expect(p.extractoCuadra).toBe(true);
    expect(p.sinCubrir).toEqual([
      {
        clave: "FIDELITY PHYSICAL BITCOIN ET",
        nombre: "FIDELITY PHYSICAL BITCOIN ET",
        euros: 18.94,
        ops: 2,
        titulos: undefined,
        valor: undefined,
      },
    ]);
    // Entra vivo, con sus dos compras. Nunca archivado.
    const etc = p.activosNuevos.find((a) => a.name === "FIDELITY PHYSICAL BITCOIN ET")!;
    expect(etc.archived).toBeUndefined();
    expect(p.nuevas.filter((x) => x.fila.nombre === "FIDELITY PHYSICAL BITCOIN ET")).toHaveLength(2);
    // Y el fondo que sí está en el extracto no se crea aparte: se lo queda su
    // posición, con su ISIN y sus participaciones.
    expect(p.activosNuevos.map((a) => a.name)).not.toContain("FIDELITY MSCI WORLD INDEX P AC");
  });

  it("con lo que vale a mano, el ETC entra por su valor y con SU coste", async () => {
    const { plan: p } = await conExcel(COMPRAS, undefined, {
      "FIDELITY PHYSICAL BITCOIN ET": 25.5,
    });
    expect(p.sinCubrir[0].valor).toBe(25.5);
    const etc = p.activosNuevos.find((a) => a.name === "FIDELITY PHYSICAL BITCOIN ET")!;
    expect(etc.mode).toBe("manual");
    // Sin participaciones se cuenta como una posición entera, que es como lo
    // lee quien mira la app del banco.
    expect(etc.manual_qty).toBe(1);
    expect(etc.unit).toBe("posición");
    expect(etc.manual_price).toBeCloseTo(25.5, 6);
    // El coste sale de las compras, NO del valor: si no, cada valor tecleado
    // entraría sin ganancia ni pérdida y se perderían los 18,94 € de verdad.
    expect(etc.manual_cost_unit).toBeCloseTo(18.94, 6);
  });

  it("y si las compras traían las participaciones, las usa", async () => {
    // «X GALAXY PHY ETHEREUM ETC @ 1» son 29 caracteres: el corte a 30 no se
    // come el número, así que de éste sí se sabe cuántos hay.
    const { plan: p } = await conExcel(
      [
        ["26/09/2025", "30/09/2025", "X GALAXY PHY ETHEREUM ETC @ 1", "", "-10,03€", "189,08€"],
        ["23/12/2025", "29/12/2025", "X GALAXY PHY ETHEREUM ETC @ 2", "", "-15,05€", "174,03€"],
      ],
      undefined,
      { "X GALAXY PHY ETHEREUM ETC": 30 },
    );
    expect(p.sinCubrir[0].titulos).toBe(3);
    const etc = p.activosNuevos.find((a) => a.name === "X GALAXY PHY ETHEREUM ETC")!;
    expect(etc.manual_qty).toBe(3);
    expect(etc.unit).not.toBe("posición");
    expect(etc.manual_price).toBeCloseTo(10, 6);
    expect(etc.manual_cost_unit).toBeCloseTo(25.08 / 3, 6);
  });

  it("el oro y la cripto no entran como fondos", async () => {
    // El extracto de la cuenta lo llama todo «SUSCRIPCION IIC» y antes todo
    // entraba en «fondo»: el oro y la cripto salían contados como fondos en la
    // pantalla de reparto. El nombre es la única pista, y basta.
    const { plan: p } = await conExcel([
      ["08/09/2025", "10/09/2025", "FIDELITY PHYSICAL BITCOIN ET @", "", "-9,30€", "262,41€"],
      ["16/09/2025", "18/09/2025", "WT PHYSICAL GOLD-EUR DLY HDG @", "", "-19,84€", "242,57€"],
      ["26/09/2025", "30/09/2025", "X GALAXY PHY ETHEREUM ETC @ 1", "", "-10,03€", "232,54€"],
      // Un fondo de mineras NO es oro, por mucho que se llame GOLD: sin
      // PHYSICAL ni ETC en el nombre se queda donde estaba.
      ["01/10/2025", "02/10/2025", "WORLD GOLD FUND CLASS A2 EUR", "", "-5,00€", "227,54€"],
    ]);
    const cat = Object.fromEntries(p.activosNuevos.map((a) => [a.name, a.cat]));
    expect(cat["FIDELITY PHYSICAL BITCOIN ET"]).toBe("cripto");
    expect(cat["WT PHYSICAL GOLD-EUR DLY HDG"]).toBe("metal");
    expect(cat["X GALAXY PHY ETHEREUM ETC"]).toBe("cripto");
    expect(cat["WORLD GOLD FUND CLASS A2 EUR"]).toBe("fondo");
    // Y con el subyacente puesto, que es como los agrupa la pantalla de
    // reparto: dos ETC distintos del mismo metal son la misma apuesta.
    const sub = Object.fromEntries(p.activosNuevos.map((a) => [a.name, a.underlying]));
    expect(sub["FIDELITY PHYSICAL BITCOIN ET"]).toBe("Bitcoin");
    expect(sub["WT PHYSICAL GOLD-EUR DLY HDG"]).toBe("Oro");
    expect(sub["X GALAXY PHY ETHEREUM ETC"]).toBe("Ethereum");
    expect(sub["WORLD GOLD FUND CLASS A2 EUR"]).toBeNull();
  });

  it("retira el aviso de «sube el PDF» cuando ya no hay nada que arreglar", async () => {
    const { lectura, plan: p } = await conExcel(COMPRAS);
    // El Excel avisa de los dos por su cuenta: ninguno trae participaciones.
    expect(lectura.descartes.filter((d) => d.clave)).toHaveLength(2);
    // Con el PDF delante, la posición resuelve el fondo. El ETC sigue avisando:
    // el PDF no lo cubre y nadie ha dicho todavía lo que vale.
    expect(p.descartes.filter((d) => d.clave).map((d) => d.clave)).toEqual([
      "FIDELITY PHYSICAL BITCOIN ET",
    ]);
    // Y en cuanto se dice lo que vale, tampoco.
    const { plan: q } = await conExcel(COMPRAS, undefined, {
      "FIDELITY PHYSICAL BITCOIN ET": 25.5,
    });
    expect(q.descartes.filter((d) => d.clave)).toEqual([]);
  });

  it("reimportar el mismo PDF no cambia nada", async () => {
    const estado = estadoCon(
      [activo("a1", "FIDELITY MSCI WORLD INDEX P AC")],
      [compra("a1", 239.97, 1)],
    );
    const primero = await plan(estado);
    const p = primero.posiciones.find((x) => x.posicion.isin === "IE00BYX5NX33")!;
    // Se escribe lo que dice el plan…
    Object.assign(estado.activos[0], p.campos);
    // …y a la segunda ya no hay nada que hacer con esa posición.
    const segundo = await plan(estado);
    expect(segundo.posiciones.find((x) => x.posicion.isin === "IE00BYX5NX33")!.aldia).toBe(true);
  });
});
