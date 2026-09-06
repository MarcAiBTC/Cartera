// ── IMPORTAR ─────────────────────────────────────────────────────────────
// El recorrido completo de un archivo de bróker:
//
//   archivo → texto/tabla → detectar formato → adaptador → filas
//           → planificar (casar con activos, convertir a euros, quitar
//             duplicados) → operaciones listas para insertar
//
// La planificación no escribe nada: devuelve lo que VA a pasar para que la
// pantalla lo enseñe antes de confirmar. Importar a ciegas un extracto de
// cinco años es la mejor manera de meter cien líneas mal y no enterarse.

import { tabular, type OrdenFecha, type Tabla } from "./csv";
import { esRevolut, leerRevolut } from "./revolut";
import { esTradeRepublic, leerTradeRepublic } from "./traderepublic";
import {
  esMyInvestorJson,
  esMyInvestorTabla,
  leerMyInvestorJson,
  leerMyInvestorTabla,
} from "./myinvestor";
import { adivinarMapa, leerGenerico, leerGenericoJson, type Mapa } from "./generico";
import { huella, type FilaImportada, type Formato, type Lectura } from "./tipos";
import type { Activo, Cuenta, EntradaCatalogo, EstadoCartera, Operacion } from "../tipos";
import type { MapaFx } from "../cartera";
import { tasa } from "../cartera";

export * from "./tipos";
export * from "./generico";
export { tabular } from "./csv";

// ── 1 · Leer el archivo ──────────────────────────────────────────────────

export interface Entrada {
  nombre: string;
  texto?: string;
  json?: unknown;
  tabla?: Tabla;
}

const EXT_EXCEL = /\.(xlsx|xls|xlsm|ods)$/i;

export async function leerArchivo(file: File): Promise<Entrada> {
  if (EXT_EXCEL.test(file.name)) {
    // La librería de Excel son 380 KB y la mayoría de los brókeres dan CSV.
    // Se carga sólo cuando de verdad llega un .xlsx.
    const XLSX = await import("xlsx");
    const libro = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    // `raw:false` deja las fechas y los números ya formateados como los ve el
    // usuario en Excel; el parser de `csv.ts` sabe deshacer ese formato.
    const objetos = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, {
      raw: false,
      defval: "",
    });
    return { nombre: file.name, tabla: desdeObjetos(objetos) };
  }

  const texto = await file.text();
  return desdeTexto(texto, file.name);
}

export function desdeTexto(texto: string, nombre = "pegado"): Entrada {
  const t = texto.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return { nombre, texto, json: JSON.parse(t) };
    } catch {
      // No era JSON válido: se intenta como tabla, que es lo más probable.
    }
  }
  return { nombre, texto, tabla: tabular(texto) };
}

function desdeObjetos(objetos: Record<string, unknown>[]): Tabla {
  const filas = objetos.map((o) => {
    const fila: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      fila[k.toLowerCase().trim()] = v == null ? "" : String(v);
    }
    return fila;
  });
  return {
    cabeceras: [...new Set(filas.flatMap((f) => Object.keys(f)))],
    filas,
    lineas: filas.map((_, i) => i + 2),
    separador: ",",
  };
}

// ── 2 · Detectar el formato ──────────────────────────────────────────────

export function detectar(e: Entrada): Formato {
  if (e.json !== undefined) {
    if (esMyInvestorJson(e.json)) return "myinvestor-json";
    if (Array.isArray(e.json)) return "generico-json";
    return "desconocido";
  }
  const t = e.tabla;
  if (!t || t.filas.length === 0) return "desconocido";
  if (esRevolut(t)) return "revolut-csv";
  if (esMyInvestorTabla(t)) return "myinvestor-tabla";
  if (esTradeRepublic(t)) return "traderepublic-csv";
  return "generico-csv";
}

// ── 3 · Aplicar el adaptador ─────────────────────────────────────────────

export interface OpcionesLectura {
  /** Formato elegido a mano, cuando la detección no acierta */
  formato?: Formato;
  /** Columnas asignadas a mano, sólo para el genérico */
  mapa?: Mapa;
  ordenFecha?: OrdenFecha;
}

export function leer(e: Entrada, op: OpcionesLectura = {}): Lectura {
  const formato = op.formato ?? detectar(e);

  switch (formato) {
    case "myinvestor-json":
      return leerMyInvestorJson(e.json);
    case "generico-json":
      return leerGenericoJson(Array.isArray(e.json) ? e.json : []);
    case "revolut-csv":
      return leerRevolut(e.tabla!);
    case "myinvestor-tabla":
      return leerMyInvestorTabla(e.tabla!);
    case "traderepublic-csv":
      return leerTradeRepublic(e.tabla!);
    case "generico-csv":
      return leerGenerico(e.tabla!, op.mapa ?? adivinarMapa(e.tabla!), op.ordenFecha ?? "dmy");
    default:
      return { formato: "desconocido", broker: "", filas: [], descartes: [] };
  }
}

// ── 4 · Planificar ───────────────────────────────────────────────────────

/** Tasas por divisa y fecha, para convertir cada operación al cambio de SU
 *  día. Si falta el día exacto se coge el más cercano anterior. */
export type FxHistorico = Record<string, Record<string, number>>;

export interface Planeada {
  fila: FilaImportada;
  operacion: Partial<Operacion>;
  /** Activo existente con el que casa, si lo hay */
  activo?: Activo;
  /** Activo que habrá que crear */
  nuevoActivo?: Partial<Activo>;
  duplicada: boolean;
  aviso?: string;
}

export interface Plan {
  lectura: Lectura;
  planeadas: Planeada[];
  nuevas: Planeada[];
  duplicadas: Planeada[];
  activosNuevos: Partial<Activo>[];
  cuentaNueva?: Partial<Cuenta>;
  /** Suma de lo que entra y de lo que sale, para el resumen de la vista previa */
  totalCompras: number;
  totalVentas: number;
  totalCobros: number;
  /** El efectivo que implica el extracto y el activo de liquidez que lo
   *  representa. Sin esto el patrimonio sale corto: un extracto trae los
   *  ingresos y las retiradas, pero si nadie crea la cuenta de efectivo el
   *  dinero parado en el broker no aparece por ningun lado. */
  efectivo?: { saldo: number; activo: Partial<Activo>; existente?: Activo };
}

export interface OpcionesPlan {
  estado: EstadoCartera;
  fx: MapaFx;
  fxHistorico?: FxHistorico;
  catalogo?: EntradaCatalogo[];
  /** Cuenta destino ya elegida; si no, se propone una con el bróker detectado */
  cuentaId?: string;
  broker?: string;
}

/** Hasta cuántos días atrás vale un cambio anterior. Un fin de semana largo
 *  son tres días y un puente cuatro; más allá de diez, la serie sencillamente
 *  no cubre esa fecha y usar el último dato disponible sería peor que usar el
 *  de hoy: un cambio de hace un año no describe aquella operación. */
const DIAS_TOLERADOS = 10;

function tasaEn(divisa: string, fechaOp: string, fx: MapaFx, hist?: FxHistorico): number {
  const c = divisa.toUpperCase();
  if (c === "EUR") return 1;

  const serie = hist?.[c];
  if (serie) {
    if (serie[fechaOp] != null) return serie[fechaOp];
    // El día exacto puede caer en festivo o fin de semana: vale el anterior,
    // pero sólo si está cerca.
    const anterior = Object.keys(serie)
      .filter((d) => d <= fechaOp)
      .sort()
      .at(-1);
    if (anterior) {
      const dias = (Date.parse(fechaOp) - Date.parse(anterior)) / 86400e3;
      if (dias <= DIAS_TOLERADOS) return serie[anterior];
    }
  }
  return tasa(c, fx);
}

/** Categoría razonable para un activo que aún no existe en la cartera. */
function categoriaDe(fila: FilaImportada, cat?: EntradaCatalogo): string {
  // Lo que diga el broker manda: sabe si aquello era una cripto o un warrant,
  // y aqui solo se podria adivinar por la forma del ISIN.
  if (fila.categoria) return fila.categoria;
  if (cat?.cat) return cat.cat;
  // Un ISIN de fondo español o luxemburgués sin ticker suele ser fondo; con
  // ticker, un ETF o una acción. No es exacto, pero es el punto de partida
  // que menos veces hay que corregir a mano.
  if (fila.isin && !fila.ticker) return "fondo";
  return "accion";
}

export function planificar(lectura: Lectura, op: OpcionesPlan): Plan {
  const { estado, fx, fxHistorico, catalogo = [] } = op;

  // Índices para casar sin recorrer las listas en cada fila.
  const porIsin = new Map<string, Activo>();
  const porTicker = new Map<string, Activo>();
  for (const a of estado.activos) {
    if (a.isin) porIsin.set(a.isin.toUpperCase(), a);
    if (a.ticker) porTicker.set(a.ticker.toUpperCase(), a);
  }
  const catPorIsin = new Map<string, EntradaCatalogo>();
  const catPorTicker = new Map<string, EntradaCatalogo>();
  for (const c of catalogo) {
    if (c.isin) catPorIsin.set(c.isin.toUpperCase(), c);
    if (c.ticker) catPorTicker.set(c.ticker.toUpperCase(), c);
  }
  const yaImportadas = new Set(
    estado.operaciones.map((o) => o.import_hash).filter((h): h is string => Boolean(h)),
  );

  // Los activos nuevos se acumulan aquí para que dos compras del mismo fondo
  // en el mismo archivo no creen el activo dos veces.
  const nuevosPorClave = new Map<string, Partial<Activo>>();
  const planeadas: Planeada[] = [];
  const vistas = new Set<string>();

  // Solo estas tres tocan un valor. Un ingreso, unos intereses o una comision
  // mueven el saldo y nada mas: si se les deja crear activo, la cartera se
  // llena de fantasmas llamados «Interest payment for payout collection
  // 019a3d67-7887-7038-8c06-a7afa4e172f6». Paso de verdad con un extracto de
  // Trade Republic: 24 de los 41 activos creados eran conceptos bancarios.
  const TOCA_UN_VALOR = new Set(["buy", "sell", "dividend"]);

  for (const fila of lectura.filas) {
    const esValor = TOCA_UN_VALOR.has(fila.tipo);
    const clave = esValor ? (fila.isin || fila.ticker || fila.nombre || "").toUpperCase() : "";
    const existente =
      (fila.isin ? porIsin.get(fila.isin.toUpperCase()) : undefined) ??
      (fila.ticker ? porTicker.get(fila.ticker.toUpperCase()) : undefined);

    const entradaCat =
      (fila.isin ? catPorIsin.get(fila.isin.toUpperCase()) : undefined) ??
      (fila.ticker ? catPorTicker.get(fila.ticker.toUpperCase()) : undefined);

    let nuevoActivo: Partial<Activo> | undefined;
    let aviso: string | undefined;

    if (!existente && clave) {
      nuevoActivo = nuevosPorClave.get(clave);
      if (!nuevoActivo) {
        nuevoActivo = {
          name: fila.nombre || clave,
          isin: fila.isin ?? entradaCat?.isin ?? null,
          // El orden importa y costo que cuatro acciones entraran mudas: los
          // precios se buscan por `ticker` contra el mapa que llena el cron, y ese
          // mapa esta indexado por el simbolo de Yahoo. El campo `ticker` del
          // catalogo es el corto y bonito (CABK), el que cotiza es `yahoo`
          // (CABK.MC). Preferir el corto deja al activo sin precio para siempre.
          ticker: fila.ticker ?? entradaCat?.yahoo ?? entradaCat?.symbol ?? entradaCat?.ticker ?? null,
          cat: categoriaDe(fila, entradaCat),
          currency: fila.divisa || entradaCat?.currency || "EUR",
          underlying: entradaCat?.underlying ?? null,
          unit: "títulos",
          mode: "operations",
        };
        nuevosPorClave.set(clave, nuevoActivo);
      }
      if (!entradaCat) {
        aviso = "Activo nuevo y sin precio en el catálogo: habrá que apuntarlo a mano";
      }
    }

    const h = huella(fila);
    // Un archivo puede traer la misma línea dos veces; la segunda también es
    // duplicada aunque todavía no esté en la base de datos.
    const duplicada = yaImportadas.has(h) || vistas.has(h);
    vistas.add(h);

    const cambio = tasaEn(fila.divisa, fila.fecha, fx, fxHistorico);

    planeadas.push({
      fila,
      activo: existente,
      nuevoActivo,
      duplicada,
      aviso,
      operacion: {
        account_id: op.cuentaId ?? null,
        asset_id: existente?.id ?? null,
        type: fila.tipo,
        date: fila.fecha,
        quantity: fila.cantidad ?? null,
        price: fila.precio ?? null,
        total: fila.total,
        fees: fila.comision ?? 0,
        currency: fila.divisa,
        total_eur: fila.total * cambio,
        is_internal_transfer: fila.traspasoInterno ?? false,
        source: "import",
        source_format: lectura.formato,
        import_hash: h,
        notes: fila.nota ?? null,
      },
    });
  }

  const nuevas = planeadas.filter((p) => !p.duplicada);
  const suma = (tipos: string[]) =>
    nuevas.reduce((s, p) => (tipos.includes(p.fila.tipo) ? s + (p.operacion.total_eur ?? 0) : s), 0);

  const broker = op.broker ?? lectura.broker;
  const cuentaExiste = estado.cuentas.some((c) => c.broker === broker);

  // ── El efectivo ──────────────────────────────────────────────────────
  // Se calcula sobre TODAS las operaciones que van a existir despues de
  // importar, no solo sobre las nuevas: asi importar dos veces el mismo
  // extracto deja el mismo saldo, y no el doble.
  //
  // La comision se resta aparte porque el importe de una compra viene bruto:
  // el motor la suma al coste, pero del bolsillo sale igual.
  const efectivoDe = (ops: { type?: string; total_eur?: number | null; fees?: number | null }[]) =>
    ops.reduce((s, o) => {
      const v = o.total_eur ?? 0;
      // La comision se resta SIEMPRE, sea cual sea el tipo. Trade Republic
      // cobra 1 EUR por algunas transferencias de entrada, y restarla solo en
      // las compras y las ventas dejaba ese euro fuera del saldo.
      const s2 = s - (o.fees ?? 0);
      switch (o.type) {
        case "deposit": return s2 + v;
        case "withdrawal": return s2 - v;
        case "buy": return s2 - v;
        case "sell": return s2 + v;
        case "dividend":
        case "interest": return s2 + v;
        case "fee": return s2 - v;
        default: return s2;
      }
    }, 0);

  const cuentaDestino = op.cuentaId ?? estado.cuentas.find((c) => c.broker === broker)?.id;
  const yaHabia = estado.operaciones.filter((o) => o.account_id === cuentaDestino);
  const todas = [...yaHabia, ...nuevas.map((p) => p.operacion)];
  const saldo = efectivoDe(todas);

  // Solo si la cuenta habla de dinero en algun momento. Un archivo que solo
  // trae compras y ventas no dice nada del saldo, e inventarle uno seria peor
  // que no ponerlo.
  //
  // Se mira sobre TODAS y no solo sobre las nuevas: reimportar el mismo
  // extracto no trae ninguna fila nueva —el dedupe hace su trabajo— y aun asi
  // el saldo tiene que quedar puesto.
  const CAJA = ["deposit", "withdrawal", "interest", "dividend", "fee"];
  const hayMovimientoDeCaja = todas.some((o) => CAJA.includes(String(o.type)));

  const nombreEfectivo = `Efectivo · ${broker || "cuenta"}`;
  const efectivoExistente = estado.activos.find(
    (a) => a.cat === "liquidez" && a.name === nombreEfectivo,
  );

  const efectivo = hayMovimientoDeCaja
    ? {
        saldo,
        existente: efectivoExistente,
        activo: {
          ...(efectivoExistente ?? {}),
          name: nombreEfectivo,
          cat: "liquidez",
          currency: "EUR",
          unit: "€",
          // REGLA 1: en el efectivo el coste ES el saldo. Nunca un coste a 0,
          // que convertiria cada ingreso en una plusvalia inventada.
          mode: "manual" as const,
          manual_qty: saldo,
          manual_cost_unit: 1,
          manual_price: 1,
        },
      }
    : undefined;

  return {
    lectura,
    planeadas,
    nuevas,
    duplicadas: planeadas.filter((p) => p.duplicada),
    // Sólo se crean los activos que hacen falta para las operaciones nuevas.
    activosNuevos: [
      ...new Map(
        nuevas
          .filter((p) => p.nuevoActivo)
          .map((p) => [(p.fila.isin || p.fila.ticker || p.fila.nombre || "").toUpperCase(), p.nuevoActivo!]),
      ).values(),
    ],
    cuentaNueva:
      broker && !cuentaExiste && !op.cuentaId
        ? { name: broker, broker, currency: "EUR" }
        : undefined,
    totalCompras: suma(["buy"]),
    totalVentas: suma(["sell"]),
    totalCobros: suma(["dividend", "interest"]),
    efectivo,
  };
}
