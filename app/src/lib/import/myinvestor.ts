// ── MYINVESTOR ───────────────────────────────────────────────────────────
// Dos caminos, porque MyInvestor da los datos de dos maneras:
//
//   1. El Excel de movimientos de la web (Mi cartera → Movimientos →
//      Descargar). Es una tabla normal y lo lee `leerMyInvestorTabla`.
//   2. El JSON de la propia web, con la forma `{ payload: { data: [...] } }`.
//      Es el que trae los campos completos —incluido el valor liquidativo de
//      la operación— y el que distingue los traspasos internos.
//
// El traspaso interno es la razón de tener adaptador propio: un
// INTERNAL_TRANSFER_SUBSCRIPTION mueve dinero entre dos fondos tuyos. Si se
// importa como una compra normal, el «dinero aportado» sube sin que hayas
// puesto un euro, y toda la rentabilidad sale mal.

import { campo, fecha, num, type Tabla } from "./csv";
import type { TipoOperacion } from "../tipos";
import { clasificar, lecturaVacia, type Descarte, type FilaImportada, type Lectura } from "./tipos";

interface OperacionMI {
  operationType?: string;
  status?: string;
  isin?: string;
  fundName?: string;
  shares?: number | string;
  amountBuyVL?: number | string;
  cash?: number | string;
  orderDate?: string;
}

const TIPOS_MI: Record<string, { tipo: TipoOperacion; traspaso: boolean }> = {
  INVESTMENT_FUNDS_SUBSCRIPTION: { tipo: "buy", traspaso: false },
  INVESTMENT_FUNDS_REIMBURSEMENT: { tipo: "sell", traspaso: false },
  INTERNAL_TRANSFER_SUBSCRIPTION: { tipo: "buy", traspaso: true },
  INTERNAL_TRANSFER_REIMBURSEMENT: { tipo: "sell", traspaso: true },
};

export function esMyInvestorJson(valor: unknown): boolean {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
  const p = (valor as { payload?: { data?: unknown } }).payload;
  return Boolean(p && Array.isArray(p.data));
}

export function leerMyInvestorJson(valor: unknown): Lectura {
  const out = lecturaVacia("myinvestor-json", "MyInvestor");
  const filas: FilaImportada[] = [];
  const descartes: Descarte[] = [];
  const datos = ((valor as { payload: { data: OperacionMI[] } }).payload.data ?? []) as OperacionMI[];

  datos.forEach((o, i) => {
    const linea = i + 1;
    const crudo = JSON.stringify(o);

    // Una orden rechazada no llegó a ejecutarse: no es una operación.
    if ((o.status ?? "").toUpperCase() === "REJECTED") {
      descartes.push({ linea, motivo: "Orden rechazada", crudo });
      return;
    }

    const codigo = (o.operationType ?? "").toUpperCase();
    const conocido = TIPOS_MI[codigo];
    let traspaso = conocido?.traspaso ?? false;
    let tipo: TipoOperacion | undefined = conocido?.tipo;
    if (!tipo) {
      tipo = clasificar(codigo);
      // Cualquier variante nueva que lleve TRANSFER/TRASPASO en el nombre se
      // trata como traspaso aunque el código exacto no esté en la tabla.
      traspaso = /TRANSFER|TRASPASO/.test(codigo);
    }
    if (!tipo) {
      descartes.push({ linea, motivo: `Tipo «${o.operationType ?? "?"}» no reconocido`, crudo });
      return;
    }

    const isin = (o.isin ?? "").toUpperCase();
    if (!isin) {
      descartes.push({ linea, motivo: "Sin ISIN", crudo });
      return;
    }

    const cantidad = num(o.shares);
    const precio = num(o.amountBuyVL);
    const efectivo = num(o.cash);
    const total =
      efectivo != null
        ? Math.abs(efectivo)
        : cantidad != null && precio != null
          ? Math.abs(cantidad * precio)
          : undefined;

    if (total == null || total === 0) {
      descartes.push({ linea, motivo: "Sin importe", crudo });
      return;
    }

    const d = fecha(o.orderDate, "dmy");
    if (!d) {
      descartes.push({ linea, motivo: "Sin fecha reconocible", crudo });
      return;
    }

    filas.push({
      linea,
      fecha: d,
      tipo,
      isin,
      nombre: o.fundName || isin,
      cantidad: cantidad != null ? Math.abs(cantidad) : undefined,
      precio: precio != null ? Math.abs(precio) : undefined,
      total,
      divisa: "EUR",
      traspasoInterno: traspaso,
      nota: o.operationType,
    });
  });

  return { ...out, filas, descartes };
}

// ── EL EXTRACTO DE FONDOS ────────────────────────────────────────────────
// Inversiones → Fondos → Operaciones y consultas → Consulta de operaciones.
//
// Éste es EL archivo: trae el ISIN, las participaciones y el valor liquidativo
// de cada orden. El de la cuenta corriente sólo trae el dinero, y con el
// nombre del fondo cortado a 30 caracteres. Si hay que elegir uno, es éste.

export function esMyInvestorTabla(t: Tabla): boolean {
  const h = t.cabeceras.join(" ");
  if (!h.includes("isin")) return false;
  return /participaciones|titulos|títulos|valor liquidativo|\bvl\b|fondo/.test(h);
}

/** Una orden que no llegó a ejecutarse no es una operación: no movió ni
 *  dinero ni participaciones. Suele venir sin valor liquidativo, así que
 *  colarla dejaría el fondo con títulos inventados. */
const NO_EJECUTADA = /anulad|cancelad|rechazad|denegad|pendiente|en curso|tramit/i;

export function leerMyInvestorTabla(t: Tabla): Lectura {
  const out = lecturaVacia("myinvestor-tabla", "MyInvestor");
  const filas: FilaImportada[] = [];
  const descartes: Descarte[] = [];

  t.filas.forEach((f, i) => {
    const linea = t.lineas[i] ?? i + 2;
    const crudo = Object.values(f).join(" · ");

    const estado = campo(f, "estado", "situación", "status");
    if (estado && NO_EJECUTADA.test(estado)) {
      descartes.push({ linea, motivo: `Orden no ejecutada («${estado}»)`, crudo });
      return;
    }

    const d = fecha(
      campo(f, "fecha de la orden", "fecha orden", "fecha", "fecha valor", "date"),
      "dmy",
    );
    if (!d) {
      descartes.push({ linea, motivo: "Sin fecha reconocible", crudo });
      return;
    }

    const textoTipo = campo(
      f,
      "tipo de operación",
      "tipo de orden",
      "operación",
      "tipo",
      "concepto",
      "movimiento",
    );
    const tipo = clasificar(textoTipo);
    if (!tipo) {
      descartes.push({
        linea,
        motivo: `Tipo de movimiento no reconocido${textoTipo ? `: «${textoTipo}»` : ""}`,
        crudo,
      });
      return;
    }

    const isin = campo(f, "isin")?.toUpperCase();
    const nombre = campo(f, "fondo", "nombre del fondo", "nombre", "producto", "descripción") ?? isin;
    const cantidad = num(
      campo(f, "participaciones", "nº participaciones", "num participaciones", "títulos", "cantidad"),
    );
    const precio = num(campo(f, "valor liquidativo", "vl", "precio", "cotización"));
    const bruto = num(
      campo(f, "importe", "efectivo", "importe bruto", "importe liquidado", "total"),
    );

    let total = bruto != null ? Math.abs(bruto) : undefined;
    if (total == null && cantidad != null && precio != null) total = Math.abs(cantidad * precio);
    if (total == null || total === 0) {
      descartes.push({ linea, motivo: "Sin importe", crudo });
      return;
    }

    filas.push({
      linea,
      fecha: d,
      tipo,
      isin,
      nombre: nombre ?? undefined,
      cantidad: cantidad != null ? Math.abs(cantidad) : undefined,
      precio: precio != null ? Math.abs(precio) : undefined,
      total,
      divisa: (campo(f, "divisa", "moneda", "currency") ?? "EUR").toUpperCase(),
      traspasoInterno: /traspaso/i.test(textoTipo ?? ""),
      nota: textoTipo,
    });
  });

  return { ...out, filas, descartes };
}

// ── EL EXTRACTO DE LA CUENTA CORRIENTE ───────────────────────────────────
// Un tercer archivo, distinto de los dos de arriba: Cuentas → Corriente →
// Operaciones y consultas → Consulta de operaciones. Se descarga en CSV, con
// punto y coma y decimales con coma:
//
//   Fecha de operación;Fecha de valor;Concepto;Importe;Divisa
//   30/07/2026;31/07/2026;PICTET-CHINA IX P EUR @ 0.0368;-4,99;EUR
//   30/07/2026;30/07/2026;Envio de dinero - imaginBank;250;EUR
//
// …o en Excel, que es la misma tabla con otros nombres de columna («Fecha
// Operación», «Movimiento», «Importe», «Saldo»), ocho filas de titular y saldo
// por encima y los importes con el € pegado.
//
// Es el extracto de la CUENTA CORRIENTE, no el de los fondos. Todo cuelga de
// una sola columna de texto libre —`Concepto`— y hay que deducir de ella si
// aquello fue una compra de fondo, un ingreso o los intereses del mes.
//
// QUÉ ES EL NÚMERO DE DETRÁS DEL «@». Son las PARTICIPACIONES compradas, no el
// valor liquidativo, y confundirlos no es un matiz: son tres órdenes de
// magnitud. «PICTET-CHINA IX P EUR @ 0.0368» con importe 4,99 € son 0,0368
// participaciones de un fondo que vale unos 135 €. Leerlo como precio daba
// 4,99 / 0,0368 = 135,6 participaciones: la misma cifra, pero de sitio, y el
// fondo aparecía en la cartera 3.600 veces más grande de lo que es. Las dos
// pruebas que lo dejan claro están en el propio extracto, donde el corte no
// llega a estropear el número:
//
//   ETC ISHARES PHYSICAL GOLD @ 1   −55,99 €  → 1 unidad a 55,99 €
//   X GALAXY PHY ETHEREUM ETC @ 2   −15,05 €  → 2 unidades a 7,53 €
//   X GALAXY PHY ETHEREUM ETC @ 1    −7,54 €  → 1 unidad  a 7,54 €
//
// Y hay un detalle que lo condiciona todo: **el concepto viene cortado a 30
// caracteres**. Cuando el nombre del fondo es corto, las participaciones
// sobreviven al final; cuando es largo, el corte se las come:
//
//   PICTET-CHINA IX P EUR @ 0.0368   ← 30 caracteres justos, se salvan
//   FIDELITY PHYSICAL BITCOIN ET @   ← 30 caracteres, se perdieron
//   PICTET CHINA INDEX P ACC @ 0.0   ← peor: cortadas a la mitad
//
// De ahí que unas compras entren con participaciones y otras no. Las que no,
// se avisan agrupadas por fondo: el dinero es correcto, lo que falta son las
// participaciones, y eso sólo está en el extracto de fondos.

/** Frases del banco que NO son un valor, con lo que significan. */
const FRASES: [RegExp, "interest" | "deposit" | "withdrawal" | "fee"][] = [
  // «PERIODO 11/12/2025 11/01/2026» es la remuneración de la cuenta.
  [/^periodo\s+\d/i, "interest"],
  // Bonos por traer a un amigo. Dinero que regala el banco: se cobra igual.
  [/^promocion/i, "interest"],
  [/^envio de dinero/i, "deposit"],
  [/^transferencia/i, "deposit"],
  [/^movimiento\b/i, "deposit"],
  [/^comision|^gastos?\b/i, "fee"],
];

/** Dónde corta MyInvestor el concepto. Todo lo que llegue justo a esta
 *  longitud puede venir mutilado. */
const CORTE = 30;

/** Las participaciones que el banco pega al final del concepto, si han
 *  sobrevivido al corte.
 *
 *  Un número cortado engaña sin avisar —«@ 0.0» y «@ 0.» son en realidad
 *  0,0368 y 0,05— así que sólo se da por bueno lo que no puede estar cortado:
 *
 *   · un cero es siempre basura: nadie compra cero participaciones;
 *   · un entero pelado que llega justo al corte se descarta, porque bien
 *     pudo ser el «1» de un «1.85» al que le faltan las decimales. Los «@ 1»
 *     y «@ 2» de verdad se quedan en 29 caracteres y por eso pasan. */
function titulosDelConcepto(concepto: string): number | undefined {
  const m = concepto.match(/@\s*([\d.,]+)\s*$/);
  if (!m) return undefined;
  const v = num(m[1]);
  if (v == null || v <= 0) return undefined;
  if (concepto.length >= CORTE && !/[.,]/.test(m[1])) return undefined;
  return v;
}

/** Un fondo se reconoce por dos señales, y las dos son del banco:
 *
 *   · lleva el «@» del valor liquidativo, aunque el número se haya cortado;
 *   · o está escrito TODO EN MAYÚSCULAS, que es como el banco escribe los
 *     nombres de producto y nunca los conceptos que escribes tú.
 *
 *  Lo que tecleas al hacer un ingreso («ultimo sueldo», «Inversion Mayo»)
 *  lleva minúsculas siempre. */
function pareceFondo(concepto: string): boolean {
  if (/@/.test(concepto)) return true;
  const sinPrecio = concepto.replace(/@.*$/, "").trim();
  if (sinPrecio.length < 6) return false;
  if (/[a-z]/.test(sinPrecio)) return false;
  return /[A-Z]{3}/.test(sinPrecio) && sinPrecio.split(/\s+/).length >= 2;
}

export function esMyInvestorMovimientos(t: Tabla): boolean {
  const h = t.cabeceras.join(" ");
  // El de fondos trae ISIN y participaciones; ése lo lee el otro lector.
  if (h.includes("isin")) return false;
  // El CSV dice «Fecha de operación» y «Concepto»; el Excel, «Fecha
  // Operación» y «Movimiento». Es el mismo extracto.
  const tieneFecha = /fecha\s*(de\s*)?(la\s*)?operaci/.test(h);
  const tieneConcepto = /concepto|movimiento|descripci/.test(h);
  return tieneFecha && tieneConcepto && h.includes("importe");
}

export interface OpcionesCuenta {
  /** Deja fuera las compras y ventas de fondos y trae sólo el dinero:
   *  ingresos, retiradas, intereses y comisiones.
   *
   *  Es lo que hace falta cuando también se importa el extracto de fondos,
   *  que es donde están esas mismas compras pero con ISIN y participaciones.
   *  Si entraran por los dos sitios, cada compra contaría dos veces: el doble
   *  de títulos y el efectivo por los suelos. */
  soloEfectivo?: boolean;
}

export function leerMyInvestorMovimientos(t: Tabla, op: OpcionesCuenta = {}): Lectura {
  const out = lecturaVacia(op.soloEfectivo ? "myinvestor-efectivo" : "myinvestor-cuenta", "MyInvestor");
  const filas: FilaImportada[] = [];
  const descartes: Descarte[] = [];
  /** Fondos cuyas compras entran sin participaciones, agrupados por nombre. */
  const sinParticipaciones = new Map<string, { veces: number; euros: number; linea: number }>();

  t.filas.forEach((f, i) => {
    const linea = t.lineas[i] ?? i + 2;
    const crudo = Object.values(f).join(" · ");

    const d = fecha(
      campo(f, "fecha de operación", "fecha operación", "fecha de la operación", "fecha"),
      "dmy",
    );
    if (!d) {
      descartes.push({ linea, motivo: "Sin fecha reconocible", crudo });
      return;
    }

    const concepto = (
      campo(f, "concepto", "movimiento", "descripción", "description") ?? ""
    ).trim();
    const importe = num(campo(f, "importe", "amount"));
    const divisa = (campo(f, "divisa", "currency") ?? "EUR").toUpperCase();

    if (importe == null || importe === 0) {
      // Las filas a cero son cortes de extracto, no movimientos.
      descartes.push({ linea, motivo: "Sin importe", crudo: crudo || "(fila vacía)" });
      return;
    }

    // ── ¿Efectivo o fondo? ──────────────────────────────────────────────
    const frase = FRASES.find(([re]) => re.test(concepto));
    if (frase) {
      const tipo = frase[1];
      // «PROMOCION …» en negativo no es un cobro: es que lo retiraron.
      const real =
        tipo === "interest" && importe < 0
          ? "withdrawal"
          : tipo === "deposit" && importe < 0
            ? "withdrawal"
            : tipo;
      filas.push({
        linea,
        fecha: d,
        tipo: real,
        total: Math.abs(importe),
        divisa,
        nota: concepto,
      });
      return;
    }

    if (pareceFondo(concepto)) {
      const nombre = concepto.replace(/@.*$/, "").trim();
      const cantidad = titulosDelConcepto(concepto);
      const total = Math.abs(importe);
      // Negativo es dinero que sale de la cuenta: has comprado.
      const tipo: TipoOperacion = importe < 0 ? "buy" : "sell";

      // Con el extracto de fondos delante, esta compra ya entra por allí y
      // con más datos. Aquí sólo estorbaría.
      if (op.soloEfectivo) return;

      filas.push({
        linea,
        fecha: d,
        tipo,
        nombre,
        categoria: "fondo",
        cantidad,
        precio: cantidad != null ? total / cantidad : undefined,
        total,
        divisa,
        nota: concepto,
      });

      if (cantidad == null) {
        // No es un descarte —la fila entra y el dinero es correcto— pero hay
        // que decirlo. Se acumula por fondo y se avisa UNA vez al final: un
        // aviso por fila serían 119 líneas iguales, y un listado que nadie lee
        // esconde los avisos que sí importan.
        const acc = sinParticipaciones.get(nombre) ?? { veces: 0, euros: 0, linea };
        acc.veces += 1;
        acc.euros += total;
        sinParticipaciones.set(nombre, acc);
      }
      return;
    }

    // Texto libre: lo que tú escribiste al mover el dinero. Manda el signo.
    filas.push({
      linea,
      fecha: d,
      tipo: importe > 0 ? "deposit" : "withdrawal",
      total: Math.abs(importe),
      divisa,
      nota: concepto || undefined,
    });
  });

  for (const [nombre, a] of sinParticipaciones) {
    descartes.push({
      linea: a.linea,
      motivo:
        `«${nombre}»: ${a.veces} compras por ${a.euros.toFixed(2)} € entran con el importe ` +
        `correcto pero SIN participaciones, así que el fondo se queda a cero títulos. ` +
        `MyInvestor corta el concepto a ${CORTE} caracteres y en este fondo el corte se come ` +
        `las participaciones. Descárgate el extracto de fondos —Inversiones → Fondos → ` +
        `Operaciones y consultas → Consulta de operaciones— que trae el ISIN y las ` +
        `participaciones de cada compra, e impórtalo en vez de éste`,
      crudo: `${a.veces} líneas del archivo`,
    });
  }

  return { ...out, filas, descartes };
}
