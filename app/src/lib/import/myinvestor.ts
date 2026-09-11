// ── MYINVESTOR ───────────────────────────────────────────────────────────
// Cuatro caminos, porque MyInvestor no tiene un archivo que lo cuente todo:
//
//   1. El extracto de FONDOS (Inversiones → Fondos → Consulta de operaciones).
//      Trae ISIN, participaciones y valor liquidativo de cada orden. Es el
//      mejor, y también el que MyInvestor no siempre deja bajar.
//   2. El extracto de la CUENTA CORRIENTE, en Excel o CSV. Sólo dinero, con el
//      nombre del fondo cortado a 30 caracteres: sin ISIN y casi sin
//      participaciones. Es de donde salen las compras y lo que costaron.
//   3. El EXTRACTO DE POSICIÓN, en PDF (Perfil → Documentos y extractos). No
//      cuenta lo que hiciste sino lo que TIENES: ISIN, participaciones y valor
//      de cada fondo, y el saldo real de la cuenta. Es el que arregla lo que
//      el 2 deja roto, y sin él los fondos de MyInvestor valían cero euros.
//   4. El JSON de la propia web, `{ payload: { data: [...] } }`, que trae los
//      campos completos y distingue los traspasos internos.
//
// El traspaso interno es la razón de tener adaptador propio: un
// INTERNAL_TRANSFER_SUBSCRIPTION mueve dinero entre dos fondos tuyos. Si se
// importa como una compra normal, el «dinero aportado» sube sin que hayas
// puesto un euro, y toda la rentabilidad sale mal.
//
// El reparto entre el 2 y el 3 es deliberado: las operaciones y su coste
// salen del Excel, y las participaciones y el saldo, del PDF. Ninguno de los
// dos puede con los dos trabajos.

import { campo, ES_ISIN, fecha, normaliza, num, type Tabla } from "./csv";
import { celdaEn, textoPdf, type FilaPdf } from "./pdf";
import type { TipoOperacion } from "../tipos";
import {
  clasificar,
  lecturaVacia,
  type Descarte,
  type FilaImportada,
  type Lectura,
  type PosicionImportada,
} from "./tipos";

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

// ── LAS ÓRDENES DE FONDOS, EN CSV ────────────────────────────────────────
// La lista de órdenes de la sección de fondos, en la web:
//
//   Fecha de la orden;ISIN;Importe estimado;Nº de participaciones;Estado
//   07/09/2026;IE0032126645;50 EUR;0,62;Finalizada
//   02/06/2026;IE0032126645;349.94 EUR;4,42;Finalizada
//   03/06/2026;FR0000447823;352.11 EUR;0,132;Finalizada
//
// Es el mejor archivo que da MyInvestor: todas las órdenes desde el primer
// día, cada una con su ISIN y sus participaciones. Con él los fondos cuadran
// al céntimo con el banco. Pero tiene dos trampas, y las dos rompían la
// cartera sin avisar:
//
//   · NO DICE SI ES COMPRA O VENTA. No hay columna de tipo y los importes van
//     todos en positivo. Las dos últimas líneas de arriba son un TRASPASO: el
//     2 de junio se reembolsan 4,42 participaciones del Vanguard y al día
//     siguiente ese dinero entra en el AXA. Leído todo como compras, el
//     Vanguard salía con 30,37 participaciones cuando el banco dice 14,45.
//   · LAS PARTICIPACIONES LLEVAN COMA DECIMAL y los importes, punto. Con tres
//     cifras detrás de la coma, «0,707» es idéntico a un millar escrito a la
//     inglesa, y `num()` —que tiene que servir para los dos— lo leía como 707.
//     El fondo salía mil veces más grande.

export function esMyInvestorOrdenes(t: Tabla): boolean {
  const h = t.cabeceras.map(normaliza);
  if (!h.includes("isin")) return false;
  // Lo que lo distingue del extracto de fondos, que también trae ISIN y
  // participaciones, es justo lo que le falta: el tipo de operación.
  const titulos = h.some((c) => c.includes("participaciones"));
  const tipo = h.some((c) => /tipo|operacion|concepto|movimiento/.test(c));
  return titulos && !tipo;
}

/** Participaciones escritas a la española: la coma es SIEMPRE el decimal y el
 *  punto, si lo hay, un millar. Lo contrario que `titulos()` del PDF, y por la
 *  misma razón: en este campo no hay ambigüedad posible si se sabe de dónde
 *  viene, y `num()` no lo sabe. */
function participaciones(v: string | undefined): number | undefined {
  if (!v) return undefined;
  let t = v.trim().replace(/\s/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return isFinite(n) && n > 0 ? n : undefined;
}

/** «352.11 EUR» → 352,11 euros. El importe va a la inglesa —punto decimal—
 *  y con la divisa pegada, que en los fondos en dólares es USD. */
function importeConDivisa(v: string | undefined): { total?: number; divisa?: string } {
  const m = (v ?? "").trim().match(/^(.*?)\s*([A-Za-z]{3})?$/);
  if (!m) return {};
  const t = m[1].replace(/\s/g, "");
  const total = /^\d+(\.\d+)?$/.test(t) ? Number(t) : num(t);
  return { total: total != null && total > 0 ? total : undefined, divisa: m[2]?.toUpperCase() };
}

interface Orden {
  i: number;
  fecha: string;
  isin: string;
  total: number;
  divisa: string;
  cantidad: number;
}

/** Hasta cuántos días después del reembolso entra el dinero en el otro
 *  fondo. En este archivo son uno o dos; con un fin de semana o un festivo
 *  por medio pueden ser cuatro. */
const DIAS_TRASPASO = 6;

/** Cuánto pueden diferir las dos patas de un traspaso. El reembolso se apunta
 *  con un importe ESTIMADO —el valor liquidativo de la víspera— y la
 *  suscripción con lo que de verdad salió; el caso más separado del archivo
 *  real es un 4,4 % (World Gold 9,63 € → AXA 10,07 €). */
const HOLGURA_TRASPASO = 0.06;

/** Un importe con céntimos. Una suscripción la eliges tú y es un número
 *  redondo —5, 10, 50 €—; las dos patas de un traspaso nunca lo son, porque
 *  salen de multiplicar participaciones por valor liquidativo. */
const conCentimos = (v: number) => Math.abs(v - Math.round(v)) > 0.004;

/** Los traspasos del archivo: `reembolso → suscripción`, por posición en la
 *  lista.
 *
 *  Un traspaso deja una huella que no tiene nada más: dos órdenes de fondos
 *  distintos, en la misma divisa, la segunda entre uno y seis días después de
 *  la primera, por casi el mismo dinero y las dos con céntimos. La primera es
 *  el reembolso —el dinero sale antes de entrar— y la segunda la suscripción.
 *
 *  Y una comprobación que evita el error caro: sólo se puede reembolsar lo que
 *  se tiene. Si antes de esa fecha no había participaciones suficientes de ese
 *  fondo, la primera pata no es una venta, y no se empareja. */
function traspasos(ordenes: Orden[]): Map<number, number> {
  const cronologico = [...ordenes].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.i - b.i);
  const pares = new Map<number, number>();
  const usadas = new Set<number>();
  const dias = (de: string, a: string) => (Date.parse(a) - Date.parse(de)) / 86400e3;

  for (const s of cronologico) {
    if (usadas.has(s.i) || !conCentimos(s.total)) continue;

    const candidatas = cronologico
      .filter(
        (e) =>
          !usadas.has(e.i) &&
          e.isin !== s.isin &&
          e.divisa === s.divisa &&
          conCentimos(e.total) &&
          dias(s.fecha, e.fecha) > 0 &&
          dias(s.fecha, e.fecha) <= DIAS_TRASPASO &&
          Math.abs(e.total - s.total) / Math.max(e.total, s.total) <= HOLGURA_TRASPASO,
      )
      .sort(
        (a, b) =>
          Math.abs(a.total - s.total) - Math.abs(b.total - s.total) ||
          dias(s.fecha, a.fecha) - dias(s.fecha, b.fecha),
      );
    if (candidatas.length === 0) continue;

    // Lo que había de ese fondo antes de ese día, con los reembolsos que ya se
    // han decidido restando. El archivo redondea las participaciones a dos o
    // tres decimales: de ahí la holgura.
    const tenia = cronologico
      .filter((o) => o.isin === s.isin && o.fecha < s.fecha)
      .reduce((acc, o) => acc + (pares.has(o.i) ? -o.cantidad : o.cantidad), 0);
    if (tenia + 0.001 < s.cantidad) continue;

    const e = candidatas[0];
    pares.set(s.i, e.i);
    usadas.add(s.i);
    usadas.add(e.i);
  }
  return pares;
}

export function leerMyInvestorOrdenes(t: Tabla): Lectura {
  const out = lecturaVacia("myinvestor-ordenes", "MyInvestor");
  const descartes: Descarte[] = [];
  const ordenes: (Orden & { linea: number })[] = [];

  t.filas.forEach((f, i) => {
    const linea = t.lineas[i] ?? i + 2;
    const crudo = Object.values(f).join(" · ");

    const estado = campo(f, "estado", "situación", "status");
    if (estado && NO_EJECUTADA.test(estado)) {
      descartes.push({ linea, motivo: `Orden no ejecutada («${estado}»)`, crudo });
      return;
    }

    const d = fecha(campo(f, "fecha de la orden", "fecha orden", "fecha"), "dmy");
    if (!d) {
      descartes.push({ linea, motivo: "Sin fecha reconocible", crudo });
      return;
    }

    const isin = (campo(f, "isin") ?? "").toUpperCase();
    if (!ES_ISIN(isin)) {
      descartes.push({ linea, motivo: "Sin ISIN", crudo });
      return;
    }

    const { total, divisa } = importeConDivisa(campo(f, "importe estimado", "importe"));
    const cantidad = participaciones(campo(f, "nº de participaciones", "participaciones"));
    if (total == null || cantidad == null) {
      descartes.push({
        linea,
        motivo: total == null ? "Sin importe" : "Sin participaciones",
        crudo,
      });
      return;
    }

    ordenes.push({
      i: ordenes.length,
      linea,
      fecha: d,
      isin,
      total,
      divisa: divisa ?? (campo(f, "divisa", "moneda") ?? "EUR").toUpperCase(),
      cantidad,
    });
  });

  const pares = traspasos(ordenes);
  const origen = new Map([...pares].map(([s, e]) => [e, s]));
  const vistas = new Map<string, number>();

  const filas: FilaImportada[] = ordenes.map((o) => {
    const destino = pares.get(o.i);
    const desde = origen.get(o.i);
    const traspaso = destino != null || desde != null;
    // Dos órdenes idénticas el mismo día son dos órdenes: pasa con los
    // reembolsos de un traspaso partido en dos.
    const k = [o.fecha, o.isin, o.total, o.cantidad, destino != null].join("|");
    const vez = (vistas.get(k) ?? 0) + 1;
    vistas.set(k, vez);

    return {
      linea: o.linea,
      fecha: o.fecha,
      tipo: destino != null ? "sell" : "buy",
      isin: o.isin,
      categoria: "fondo",
      cantidad: o.cantidad,
      precio: o.total / o.cantidad,
      total: o.total,
      divisa: o.divisa,
      traspasoInterno: traspaso,
      nota:
        destino != null
          ? `Traspaso a ${ordenes[destino].isin}`
          : desde != null
            ? `Traspaso desde ${ordenes[desde].isin}`
            : "Suscripción",
      ocurrencia: vez,
    };
  });

  return { ...out, filas, descartes };
}

// ── LAS ÓRDENES Y LA CUENTA CORRIENTE, JUNTAS ────────────────────────────
// Cada suscripción de fondo sale DOS veces: como orden, con su ISIN y sus
// participaciones, y como cargo en la cuenta corriente, con el nombre cortado
// y sin nada más. Importadas las dos, cada compra contaba doble —veintidós
// activos en vez de siete, la mitad sin precio— y la pantalla sólo sabía
// pedir que se cambiara el tipo de archivo a mano.
//
// Pero la cuenta trae lo que a las órdenes les falta: el dinero —ingresos,
// intereses, y en el Excel el saldo— y las compras de la cuenta de VALORES,
// los ETC y los ETF, que no son órdenes de fondos y no salen en ese archivo.
// Así que no se tira el archivo entero: de la cuenta se quitan justo los
// fondos que ya están en las órdenes, y lo demás se queda.
//
// Qué es «ya está en las órdenes» se decide por PRODUCTO y no fila a fila. El
// Vanguard se compra 50 € cada lunes, y un ETC de 9,05 € puede caer por
// casualidad junto a una orden de 10 USD. Uno a uno fallaría alguno; por
// producto, si la mayoría de sus cargos casan con una orden, es un fondo de
// las órdenes, y si casi ninguno casa, es otra cosa.

/** Días entre la orden y su cargo en la cuenta. MyInvestor carga la
 *  suscripción de uno a cuatro días después de la orden, y un puente estira
 *  eso. Antes, nunca: con dos días de margen hacia atrás, el cargo del MSCI
 *  World del 23 de abril se quedaba una orden de 5 € del 24 —la del MSCI
 *  Europe— en vez de la suya del 19, y el Europe entraba dos veces. */
const CARGO_DESPUES = 7;
const CARGO_ANTES = 0;

/** ¿Este cargo de la cuenta es esta orden? En la misma divisa, por el mismo
 *  dinero —5 € de orden son 4,99 € de cargo—. En otra divisa, el cargo va en
 *  euros al cambio de ese día: 10 USD son entre 8 y 10 €. */
function esElCargoDe(cargo: FilaImportada, orden: FilaImportada): boolean {
  const d = (Date.parse(cargo.fecha) - Date.parse(orden.fecha)) / 86400e3;
  if (d < -CARGO_ANTES || d > CARGO_DESPUES) return false;
  if (cargo.divisa.toUpperCase() === orden.divisa.toUpperCase()) {
    return Math.abs(cargo.total - orden.total) <= Math.max(0.05, orden.total * 0.02);
  }
  const r = cargo.total / orden.total;
  return r >= 0.8 && r <= 1.0;
}

export function cruzarConOrdenes(
  cuenta: Lectura,
  ordenes: Lectura,
): { cuenta: Lectura; ordenes: Lectura } {
  // Las patas de un traspaso no pasan por la cuenta: el dinero va de un fondo
  // a otro sin tocarla.
  const libres = ordenes.filas
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !f.traspasoInterno && (f.tipo === "buy" || f.tipo === "sell"));
  const usadas = new Set<number>();
  /** Fila de la cuenta → orden con la que casa */
  const pareja = new Map<number, number>();

  const productos = cuenta.filas
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.nombre && (f.tipo === "buy" || f.tipo === "sell"))
    .sort((a, b) => a.f.fecha.localeCompare(b.f.fecha));

  for (const { f, i } of productos) {
    const dias = (o: FilaImportada) => Math.abs(Date.parse(f.fecha) - Date.parse(o.fecha));
    const mejor = libres
      .filter(({ f: o, i: j }) => !usadas.has(j) && esElCargoDe(f, o))
      .sort(
        (a, b) =>
          Math.abs(a.f.total - f.total) - Math.abs(b.f.total - f.total) || dias(a.f) - dias(b.f),
      )[0];
    if (!mejor) continue;
    usadas.add(mejor.i);
    pareja.set(i, mejor.i);
  }

  // El voto, producto a producto.
  const votos = new Map<string, { filas: number; casan: number }>();
  for (const { f, i } of productos) {
    const k = f.nombre!.toUpperCase();
    const v = votos.get(k) ?? { filas: 0, casan: 0 };
    v.filas += 1;
    if (pareja.has(i)) v.casan += 1;
    votos.set(k, v);
  }
  const sobran = new Set([...votos].filter(([, v]) => v.casan * 2 >= v.filas).map(([k]) => k));
  if (sobran.size === 0) return { cuenta, ordenes };

  // Un abono de un fondo en la cuenta es un reembolso a efectivo. Las órdenes
  // no dicen si una orden es compra o venta y la leían como compra; aquí está
  // la prueba de que salió dinero del fondo.
  const reembolsos = new Set<number>();
  for (const { f, i } of productos) {
    const j = pareja.get(i);
    if (j != null && f.tipo === "sell" && sobran.has(f.nombre!.toUpperCase())) reembolsos.add(j);
  }

  const quitadas = productos.filter(({ f }) => sobran.has(f.nombre!.toUpperCase()));
  const fuera = new Set(quitadas.map(({ i }) => i));

  return {
    cuenta: {
      ...cuenta,
      filas: cuenta.filas.filter((_, i) => !fuera.has(i)),
      // «Este fondo entra sin participaciones» deja de ser verdad: sus
      // compras entran por las órdenes, con ISIN y participaciones.
      descartes: [
        ...cuenta.descartes.filter((d) => !d.clave || !sobran.has(d.clave)),
        {
          linea: Math.min(...quitadas.map(({ f }) => f.linea)),
          motivo:
            `${quitadas.length} cargos de fondos de la cuenta corriente no entran por aquí: ` +
            `son las mismas órdenes del CSV de órdenes, que las trae con ISIN y participaciones. ` +
            `De la cuenta se usa el dinero y lo que no son fondos`,
          crudo: [...sobran].join(" · "),
        },
      ],
    },
    ordenes: reembolsos.size
      ? {
          ...ordenes,
          filas: ordenes.filas.map((f, j) =>
            reembolsos.has(j) ? { ...f, tipo: "sell" as const, nota: "Reembolso a la cuenta" } : f,
          ),
        }
      : ordenes,
  };
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

/** ¿Este concepto es un movimiento de dinero y no una orden de fondo? Con el
 *  tipo que le corresponde ya corregido por el signo: el mismo «PROMOCION» en
 *  negativo no es un cobro, es que lo retiraron. */
function tipoDeCaja(concepto: string, importe: number): TipoOperacion | undefined {
  const frase = FRASES.find(([re]) => re.test(concepto));
  if (!frase) return undefined;
  const tipo = frase[1];
  if (importe < 0 && (tipo === "interest" || tipo === "deposit")) return "withdrawal";
  return tipo;
}

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

/** Qué es en realidad lo que se ha comprado.
 *
 *  El extracto de la cuenta corriente no distingue: todo sale como
 *  «SUSCRIPCION IIC» o como un cargo, y ponerlo todo en «fondo» dejaba el oro
 *  y la cripto contados como fondos en la pantalla de reparto. El nombre sí lo
 *  dice, y aquí es la única pista que hay.
 *
 *  Con cuidado de no pasarse: el metal sólo cuando el nombre dice PHYSICAL o
 *  ETC. «WORLD GOLD FUND» es un fondo de mineras, no oro, y llamarlo metal
 *  sería peor que dejarlo donde estaba. */
export function queEs(nombre: string): { cat: string; underlying?: string } {
  const n = nombre.toUpperCase();
  if (/\bBITCOIN\b|\bBTC\b/.test(n)) return { cat: "cripto", underlying: "Bitcoin" };
  if (/\bETHEREUM\b|\bETH\b/.test(n)) return { cat: "cripto", underlying: "Ethereum" };
  if (/\bSOLANA\b|\bCRIPTO\b|\bCRYPTO\b/.test(n)) return { cat: "cripto" };
  const fisico = /\bPHYSICAL\b|\bPHY\b|\bETC\b/.test(n);
  if (fisico && /\bGOLD\b|\bORO\b/.test(n)) return { cat: "metal", underlying: "Oro" };
  if (fisico && /\bSILVER\b|\bPLATA\b/.test(n)) return { cat: "metal", underlying: "Plata" };
  return { cat: "fondo" };
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
    const caja = tipoDeCaja(concepto, importe);
    if (caja) {
      filas.push({
        linea,
        fecha: d,
        tipo: caja,
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
        categoria: queEs(nombre).cat,
        subyacente: queEs(nombre).underlying,
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
        `las participaciones. Se arregla subiendo además el PDF «Extracto de cuenta» ` +
        `—Perfil → Documentos y extractos—, que dice cuántas participaciones tienes hoy de ` +
        `cada fondo y con su ISIN`,
      crudo: `${a.veces} líneas del archivo`,
      clave: nombre.toUpperCase(),
    });
  }

  return { ...out, filas, descartes, saldo: saldoFinal(t) };
}

/** El saldo con el que se queda la cuenta al final del extracto, leído de la
 *  columna «Saldo» del propio archivo.
 *
 *  Hace falta porque un extracto es una ventana: el Excel que baja MyInvestor
 *  empieza el día que le pides, y el dinero que ya había antes no aparece en
 *  ninguna fila. Sumando sólo los movimientos, la cuenta de efectivo salía en
 *  −173,39 € cuando en el banco había 218,32. Lo que falta —391,71— es
 *  justamente lo que había el día antes de la primera línea.
 *
 *  El CSV de la cuenta corriente no trae columna de saldo; ahí no hay nada que
 *  hacer y se devuelve `undefined`. */
function saldoFinal(t: Tabla): number | undefined {
  const conSaldo = t.filas
    .map((f) => ({
      d: fecha(campo(f, "fecha de operación", "fecha operación", "fecha"), "dmy"),
      s: num(campo(f, "saldo", "saldo posterior", "balance")),
    }))
    .filter((x): x is { d: string; s: number } => x.d != null && x.s != null);
  if (conSaldo.length === 0) return undefined;

  // Unos extractos van de lo más antiguo a lo más nuevo y otros al revés. La
  // última fila del archivo sólo es la más reciente en los primeros.
  const primera = conSaldo[0];
  const ultima = conSaldo[conSaldo.length - 1];
  return ultima.d >= primera.d ? ultima.s : primera.s;
}

// ── EL EXTRACTO DE POSICIÓN, EN PDF ──────────────────────────────────────
// Perfil → Documentos y extractos → «Extracto de cuenta». Es un PDF, y es el
// único archivo de MyInvestor que dice LO QUE TIENES en vez de lo que has ido
// haciendo:
//
//   Posiciones
//   Código        Nombre                     Divisa  Títulos  Valor de mercado
//   IE00BYX5NX33  MSCI WORLD INDEX P ACC EUR EUR     27.415   390,1300 €
//   LU0625737910  PICTET CHINA INDEX P ACC   EUR     1.80942  238,6600 €
//
// Y eso resuelve de una vez las tres cosas que los otros archivos de
// MyInvestor no pueden resolver:
//
//   · EL ISIN. El extracto de la cuenta corriente sólo trae el nombre del
//     fondo cortado a 30 caracteres, y sin ISIN un fondo no tiene precio:
//     los ocho fondos de la cartera valían cero euros.
//   · LAS PARTICIPACIONES. El «@» del concepto se pierde con el corte en la
//     mitad de los fondos. Aquí están todas, y las de hoy.
//   · EL SALDO DE VERDAD, y los fondos que no salen en ningún movimiento
//     porque se compraron antes de la ventana del extracto. Dos de los seis
//     fondos de esta cartera —369 € en AXA Trésor y 6 € en MSCI Europe— no
//     aparecían por ningún lado.
//
// LO QUE NO TRAE: el histórico. Sólo lista los últimos movimientos de la
// cuenta —un mes escaso— así que como fuente de operaciones es peor que el
// Excel. De ahí el reparto: de aquí salen las POSICIONES y el SALDO; las
// compras, del Excel de movimientos. Por eso las órdenes de fondo que
// aparecen en la lista de movimientos de este PDF se dejan pasar en vez de
// importarlas: entrarían cojas (sin participaciones y sólo del último mes) y
// se pisarían con las del Excel.

/** Los rótulos que parten el PDF en secciones. Se mira el rótulo y no la
 *  posición porque el mismo juego de columnas —«Fecha operación, Concepto,
 *  Importe, Saldo»— aparece dos veces: una para la cuenta y otra, vacía, para
 *  los movimientos de las tarjetas. */
const SECCIONES: [string, RegExp][] = [
  ["resumen", /^posici[oó]n integrada/i],
  ["movimientos", /movimientos de efectivo/i],
  ["posiciones", /^posiciones$/i],
  ["otra", /^(tarjetas|movimientos tarjetas|cr[eé]ditos|intervinientes|cuentas)$/i],
];

export function esMyInvestorExtracto(filas: FilaPdf[]): boolean {
  const t = textoPdf(filas);
  if (!/myinvestor/i.test(t)) return false;
  return /posici[oó]n integrada/i.test(t) || /^\s*posiciones\s*$/im.test(t);
}

/** Las participaciones de la tabla de posiciones.
 *
 *  Vienen en formato inglés y sin separador de millares, y eso las hace un
 *  campo minado: «27.415» son veintisiete participaciones y pico, pero `num()`
 *  ve un punto con tres cifras detrás, lo toma por separador de millares y
 *  devuelve 27.415. La posición salía mil veces más grande, así que este
 *  número se lee aparte y con la regla contraria. */
function titulos(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const t = v.trim().replace(/\s/g, "");
  // Si algún día lo escriben a la española, que mande la coma decimal.
  const n = /,/.test(t) ? num(t) : /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : undefined;
  return n != null && isFinite(n) && n > 0 ? n : undefined;
}

export function leerMyInvestorExtracto(filas: FilaPdf[]): Lectura {
  const out = lecturaVacia("myinvestor-extracto", "MyInvestor");
  const importadas: FilaImportada[] = [];
  const descartes: Descarte[] = [];
  const posiciones: PosicionImportada[] = [];
  let saldo: number | undefined;
  const declarado: { efectivo?: number; invertido?: number; total?: number } = {};
  let seccion = "";
  /** X de cada columna, tomadas de la fila de cabecera de cada tabla. */
  let cols: Record<string, number> = {};
  /** Órdenes de fondo de la lista de movimientos, que aquí no se importan. */
  let ordenes = 0;
  let lineaOrdenes = 0;

  filas.forEach((f, i) => {
    const linea = i + 1;
    const crudo = f.celdas.map((c) => c.texto).join(" · ");

    // ── ¿Ha empezado otra sección? ──────────────────────────────────────
    if (f.celdas.length === 1) {
      const s = SECCIONES.find(([, re]) => re.test(f.celdas[0].texto));
      if (s) {
        seccion = s[0];
        cols = {};
        return;
      }
    }

    // ── El resumen: efectivo, inversión, total ──────────────────────────
    // Las tres líneas, no sólo el efectivo. «Inversión» y «Total» son la
    // prueba de que la tabla de posiciones está completa: si cuadran con lo
    // que hay en la tabla, lo que no está en la tabla no lo tienes.
    if (seccion === "resumen") {
      const rotulo = f.celdas[0]?.texto ?? "";
      const v = num(f.celdas[1]?.texto);
      if (v == null) return;
      if (/^efectivo$/i.test(rotulo)) {
        saldo = v;
        declarado.efectivo = v;
      } else if (/^inversi[oó]n$/i.test(rotulo)) declarado.invertido = v;
      else if (/^total$/i.test(rotulo)) declarado.total = v;
      return;
    }

    // ── La tabla de posiciones ──────────────────────────────────────────
    if (seccion === "posiciones") {
      const cabecera = f.celdas.find((c) => /^c[oó]digo$/i.test(c.texto));
      if (cabecera) {
        for (const c of f.celdas) {
          if (/^c[oó]digo$/i.test(c.texto)) cols.isin = c.x;
          else if (/^nombre$/i.test(c.texto)) cols.nombre = c.x;
          else if (/^divisa$/i.test(c.texto)) cols.divisa = c.x;
          else if (/^t[ií]tulos$/i.test(c.texto)) cols.titulos = c.x;
          else if (/^valor de mercado$/i.test(c.texto)) cols.valor = c.x;
        }
        return;
      }
      if (cols.isin == null) return;

      const isin = (celdaEn(f, cols.isin) ?? "").toUpperCase();
      if (!ES_ISIN(isin)) return;

      const nombre = celdaEn(f, cols.nombre, 40) ?? isin;
      const t = titulos(celdaEn(f, cols.titulos, 20));
      const valor = num(celdaEn(f, cols.valor, 40));
      if (t == null || valor == null) {
        descartes.push({
          linea,
          motivo: `«${nombre}»: la fila de posición viene sin títulos o sin valor`,
          crudo,
        });
        return;
      }
      posiciones.push({
        isin,
        nombre,
        divisa: (celdaEn(f, cols.divisa, 20) ?? "EUR").toUpperCase(),
        titulos: t,
        valor,
      });
      return;
    }

    // ── Los últimos movimientos de la cuenta ────────────────────────────
    if (seccion !== "movimientos") return;

    const cabecera = f.celdas.find((c) => /^fecha\s*operaci/i.test(c.texto));
    if (cabecera) {
      for (const c of f.celdas) {
        if (/^fecha\s*operaci/i.test(c.texto)) cols.fecha = c.x;
        else if (/^operacion$/i.test(c.texto)) cols.orden = c.x;
        else if (/^concepto$/i.test(c.texto)) cols.concepto = c.x;
        else if (/^importe$/i.test(c.texto)) cols.importe = c.x;
      }
      return;
    }
    if (cols.fecha == null) return;

    const d = fecha(celdaEn(f, cols.fecha, 20), "dmy");
    if (!d) return;

    const orden = celdaEn(f, cols.orden, 60) ?? "";
    const concepto = (celdaEn(f, cols.concepto, 80) ?? "").trim();
    const importe = num(celdaEn(f, cols.importe, 30));
    if (importe == null || importe === 0) {
      descartes.push({ linea, motivo: "Movimiento sin importe", crudo });
      return;
    }

    // Primero lo que es dinero y no producto. El orden importa: «PERIODO
    // 11/07/2026 11/08/2026» —los intereses del mes— va en mayúsculas y con
    // varias palabras, así que `pareceFondo` lo da por producto y se perdían
    // los dos cobros del extracto.
    const caja = tipoDeCaja(concepto, importe);
    if (!caja) {
      // Una suscripción o un reembolso de fondo se deja pasar: el histórico
      // entero está en el Excel de movimientos, y de este PDF lo que vale es
      // la posición, no un mes suelto de compras sin participaciones.
      if (/suscripcion|reembolso|traspaso/i.test(orden) || pareceFondo(concepto)) {
        ordenes++;
        lineaOrdenes = lineaOrdenes || linea;
        return;
      }
    }

    importadas.push({
      linea,
      fecha: d,
      tipo: caja ?? clasificar(orden) ?? (importe > 0 ? "deposit" : "withdrawal"),
      total: Math.abs(importe),
      divisa: "EUR",
      nota: concepto || orden,
    });
  });

  if (ordenes > 0) {
    descartes.push({
      linea: lineaOrdenes,
      motivo:
        `${ordenes} órdenes de fondo de la lista de movimientos no entran por aquí: este PDF ` +
        `sólo lista el último mes y sin participaciones. Lo que sí entra —y es lo que ` +
        `arregla la cartera— son las posiciones y el saldo. El histórico de compras sale del ` +
        `Excel de movimientos de la cuenta corriente`,
      crudo: `${ordenes} líneas del PDF`,
    });
  }

  return { ...out, filas: importadas, descartes, posiciones, saldo, declarado };
}
