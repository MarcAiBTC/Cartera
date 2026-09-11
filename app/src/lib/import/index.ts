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

import {
  ES_ISIN,
  filaCabecera,
  nombrarColumnas,
  normaliza,
  tabular,
  type OrdenFecha,
  type Tabla,
} from "./csv";
import { esRevolut, leerRevolut } from "./revolut";
import { esTradeRepublic, leerTradeRepublic } from "./traderepublic";
import {
  cruzarConOrdenes,
  esMyInvestorExtracto,
  esMyInvestorJson,
  esMyInvestorMovimientos,
  esMyInvestorOrdenes,
  esMyInvestorTabla,
  leerMyInvestorExtracto,
  leerMyInvestorJson,
  leerMyInvestorMovimientos,
  leerMyInvestorOrdenes,
  leerMyInvestorTabla,
  queEs,
} from "./myinvestor";
import { ES_PDF, leerPdf, type FilaPdf } from "./pdf";
import { adivinarMapa, leerGenerico, leerGenericoJson, type Mapa } from "./generico";
import {
  huella,
  type Descarte,
  type FilaImportada,
  type Formato,
  type Lectura,
  type PosicionImportada,
} from "./tipos";
import type { Activo, Cuenta, EntradaCatalogo, EstadoCartera, Operacion } from "../tipos";
import type { MapaFx, MapaPrecios } from "../cartera";
import { precioEur, tasa } from "../cartera";

export * from "./tipos";
export * from "./generico";
export { tabular } from "./csv";

// ── 1 · Leer el archivo ──────────────────────────────────────────────────

export interface Entrada {
  nombre: string;
  texto?: string;
  json?: unknown;
  tabla?: Tabla;
  /** Un PDF no da una tabla sino texto con coordenadas. Ver `pdf.ts`. */
  pdf?: FilaPdf[];
}

const EXT_EXCEL = /\.(xlsx|xls|xlsm|ods)$/i;

export async function leerArchivo(file: File): Promise<Entrada> {
  // Un PDF se reconoce por sus cinco primeros bytes y no por la extensión:
  // lo que llega compartido desde el móvil viene a veces sin nombre que valga.
  if (ES_PDF.test(await file.slice(0, 5).text())) {
    return { nombre: file.name, pdf: await leerPdf(await file.arrayBuffer()) };
  }

  if (EXT_EXCEL.test(file.name)) {
    // La librería de Excel son 380 KB y la mayoría de los brókeres dan CSV.
    // Se carga sólo cuando de verdad llega un .xlsx.
    const XLSX = await import("xlsx");
    const libro = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    // `raw:false` deja las fechas y los números ya formateados como los ve el
    // usuario en Excel; el parser de `csv.ts` sabe deshacer ese formato.
    //
    // `header:1` devuelve la hoja tal cual, en filas de celdas, en vez de dar
    // por hecho que la cabecera es la primera fila. El Excel de MyInvestor
    // empieza por el titular, el número de cuenta y el saldo: leído «como
    // objetos» salían columnas llamadas «TITULAR:» y no se reconocía nada.
    const matriz = XLSX.utils.sheet_to_json<unknown[]>(hoja, {
      header: 1,
      raw: false,
      defval: "",
    });
    return { nombre: file.name, tabla: desdeMatriz(matriz) };
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

/** Una hoja de Excel ya leída como filas de celdas, convertida en la misma
 *  `Tabla` que sale de un CSV: misma cabecera, mismos números de línea y, por
 *  tanto, los mismos adaptadores para los dos. */
export function desdeMatriz(matriz: unknown[][]): Tabla {
  const celdas = matriz.map((f) => (f ?? []).map((c) => (c == null ? "" : String(c).trim())));
  if (celdas.length === 0) return { cabeceras: [], filas: [], lineas: [], separador: "," };

  const cabecera = filaCabecera(celdas);
  const cabeceras = nombrarColumnas(celdas[cabecera]);

  const filas: Record<string, string>[] = [];
  const lineas: number[] = [];
  for (let i = cabecera + 1; i < celdas.length; i++) {
    // Las hojas de un banco acaban en filas vacías y en líneas de total.
    if (celdas[i].every((c) => c === "")) continue;
    const fila: Record<string, string> = {};
    cabeceras.forEach((c, j) => {
      fila[c] = celdas[i][j] ?? "";
    });
    filas.push(fila);
    // La fila de Excel que ve el usuario, para poder señalarla en un descarte.
    lineas.push(i + 1);
  }

  return { cabeceras, filas, lineas, separador: "," };
}

// ── 2 · Detectar el formato ──────────────────────────────────────────────

export function detectar(e: Entrada): Formato {
  if (e.pdf) {
    if (esMyInvestorExtracto(e.pdf)) return "myinvestor-extracto";
    return "desconocido";
  }
  if (e.json !== undefined) {
    if (esMyInvestorJson(e.json)) return "myinvestor-json";
    if (Array.isArray(e.json)) return "generico-json";
    return "desconocido";
  }
  const t = e.tabla;
  if (!t || t.filas.length === 0) return "desconocido";
  if (esRevolut(t)) return "revolut-csv";
  // Antes que el extracto de fondos: los dos traen ISIN y participaciones, y
  // lo que separa a éste es la columna de tipo que NO tiene.
  if (esMyInvestorOrdenes(t)) return "myinvestor-ordenes";
  if (esMyInvestorTabla(t)) return "myinvestor-tabla";
  if (esMyInvestorMovimientos(t)) return "myinvestor-cuenta";
  if (esTradeRepublic(t)) return "traderepublic-csv";
  return "generico-csv";
}

// ── 3 · Aplicar el adaptador ─────────────────────────────────────────────

/** Los formatos que se leen de una tabla. Un PDF y un JSON no la tienen. */
const NECESITA_TABLA: Formato[] = [
  "revolut-csv",
  "myinvestor-ordenes",
  "myinvestor-tabla",
  "myinvestor-cuenta",
  "myinvestor-efectivo",
  "traderepublic-csv",
  "generico-csv",
];

export interface OpcionesLectura {
  /** Formato elegido a mano, cuando la detección no acierta */
  formato?: Formato;
  /** Columnas asignadas a mano, sólo para el genérico */
  mapa?: Mapa;
  ordenFecha?: OrdenFecha;
}

export function leer(e: Entrada, op: OpcionesLectura = {}): Lectura {
  const formato = op.formato ?? detectar(e);

  // El formato se puede elegir a mano, y a mano se puede elegir mal: pedir el
  // lector de Trade Republic para un PDF dejaba a los adaptadores con una
  // tabla que no existe. Vale más una lectura vacía —que la pantalla enseña
  // como «no se ha reconocido nada»— que una pantalla en blanco.
  const falta =
    (NECESITA_TABLA.includes(formato) && !e.tabla) ||
    (formato === "myinvestor-extracto" && !e.pdf);
  if (falta) return { formato, broker: "", filas: [], descartes: [] };

  switch (formato) {
    case "myinvestor-json":
      return leerMyInvestorJson(e.json);
    case "generico-json":
      return leerGenericoJson(Array.isArray(e.json) ? e.json : []);
    case "revolut-csv":
      return leerRevolut(e.tabla!);
    case "myinvestor-ordenes":
      return leerMyInvestorOrdenes(e.tabla!);
    case "myinvestor-tabla":
      return leerMyInvestorTabla(e.tabla!);
    case "myinvestor-cuenta":
      return leerMyInvestorMovimientos(e.tabla!);
    case "myinvestor-efectivo":
      return leerMyInvestorMovimientos(e.tabla!, { soloEfectivo: true });
    case "myinvestor-extracto":
      return leerMyInvestorExtracto(e.pdf ?? []);
    case "traderepublic-csv":
      return leerTradeRepublic(e.tabla!);
    case "generico-csv":
      return leerGenerico(e.tabla!, op.mapa ?? adivinarMapa(e.tabla!), op.ordenFecha ?? "dmy");
    default:
      return { formato: "desconocido", broker: "", filas: [], descartes: [] };
  }
}

// ── 3 bis · Juntar varios archivos ───────────────────────────────────────
// Con MyInvestor no hay un archivo que lo cuente todo: el Excel de la cuenta
// trae las compras y lo que costaron; el PDF, las participaciones que tienes y
// el saldo. Importarlos por separado obliga a un orden concreto —el PDF
// primero no sabe todavía lo que costó nada— y a confirmar dos veces.
//
// Juntos son una sola importación: las operaciones de uno, las posiciones del
// otro, y el coste de cada fondo salido de las compras que entran en el mismo
// viaje. Cada fila se queda con el formato de SU archivo para que deshacer una
// importación siga pudiendo distinguirlas.

export function combinar(lecturas: Lectura[]): Lectura {
  const vivas = lecturas.filter((l) => l.formato !== "desconocido");
  if (vivas.length === 0) return { formato: "desconocido", broker: "", filas: [], descartes: [] };
  if (vivas.length === 1) return vivas[0];

  // Las órdenes de fondos y la cuenta corriente cuentan las mismas
  // suscripciones: de la cuenta se quedan el dinero y lo que no son fondos.
  const iOrdenes = vivas.findIndex(
    (l) => l.formato === "myinvestor-ordenes" || l.formato === "myinvestor-tabla",
  );
  // Puede haber más de un extracto de cuenta: el Excel trae el saldo pero sólo
  // un año, y el CSV toda la historia. Cada uno se cruza con las órdenes; lo
  // que se repita entre ellos lo quita la huella al planificar.
  if (iOrdenes >= 0) {
    vivas.forEach((l, i) => {
      if (l.formato !== "myinvestor-cuenta") return;
      const { cuenta, ordenes } = cruzarConOrdenes(l, vivas[iOrdenes]);
      vivas[i] = cuenta;
      vivas[iOrdenes] = ordenes;
    });
  }

  // Y con las órdenes delante, del PDF de posición sólo vale el saldo. Las
  // órdenes cuentan cada participación desde el primer día; el PDF es una
  // foto de hace unos días, y ponerlo encima dejaba los fondos sin las
  // últimas compras —el Vanguard en 14,45 en vez de 15,07— y duplicaba los
  // que el parecido de nombres no sabía casar.
  const iPdf = vivas.findIndex((l) => l.formato === "myinvestor-extracto" && l.posiciones?.length);
  if (iOrdenes >= 0 && iPdf >= 0) {
    const pdf = vivas[iPdf];
    vivas[iPdf] = {
      ...pdf,
      posiciones: undefined,
      declarado: undefined,
      descartes: [
        ...pdf.descartes,
        {
          linea: 1,
          motivo:
            `Las ${pdf.posiciones!.length} posiciones del PDF no se usan: las participaciones ` +
            `salen de las órdenes, que llegan hasta hoy. Del PDF se toma el saldo de efectivo`,
          crudo: pdf.posiciones!.map((p) => p.isin).join(" · "),
        },
      ],
    };
  }

  const filas = vivas.flatMap((l) => l.filas.map((f) => ({ ...f, formato: f.formato ?? l.formato })));
  const posiciones = vivas.flatMap((l) => l.posiciones ?? []);
  // Si dos archivos declaran saldo gana el del que lo diga más «de frente»:
  // el extracto de posición lo imprime como saldo a día de hoy, y el de
  // movimientos lo deduce de su última línea.
  const conSaldo = vivas.find((l) => l.formato === "myinvestor-extracto" && l.saldo != null)
    ?? vivas.find((l) => l.saldo != null);

  return {
    formato: "varios",
    // Mezclar brókeres en una sola importación no tendría sentido —cada uno va
    // a su cuenta— así que el bróker es el del primero que lo diga.
    broker: vivas.find((l) => l.broker)?.broker ?? "",
    filas,
    descartes: vivas.flatMap((l) => l.descartes),
    posiciones: posiciones.length ? posiciones : undefined,
    saldo: conSaldo?.saldo,
    // Los totales van con las posiciones, no con el saldo: son la prueba de
    // que ESA lista está completa y no valen para otra.
    declarado: vivas.find((l) => l.posiciones?.length && l.declarado)?.declarado,
  };
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
  /** La operación ya guardada que es ESTA misma pero escrita mal, cuando lo
   *  es. En vez de insertar otra al lado se corrige: ver `diferencias`. */
  corrige?: Operacion;
  /** Lo que hay que cambiarle a `corrige` */
  cambios?: Partial<Operacion>;
}

/** Una posición del extracto, ya casada con la cartera.
 *
 *  Es lo que convierte «tienes 27,415 participaciones de IE00BYX5NX33» en
 *  «este activo tuyo, el que se llama FIDELITY MSCI WORLD INDEX P AC porque el
 *  banco te cortó el nombre, es ése; ponle el ISIN y sus títulos». */
export interface PosicionPlaneada {
  posicion: PosicionImportada;
  /** El activo de la cartera que es este fondo, si ya existe */
  activo?: Activo;
  /** No existe todavía: se creará con los datos del extracto */
  crea: boolean;
  /** Otros activos que resultaron ser el mismo fondo con el nombre cortado de
   *  otra manera. Se archivan y su dinero cuenta en el coste de éste. */
  absorbidos: Activo[];
  /** Operaciones ya guardadas que hay que mudar al activo que se queda. Sin
   *  esto, al archivar el gemelo su dinero se perdería en la siguiente
   *  importación, cuando ya no salga como candidato. */
  reasignar: Operacion[];
  /** Con qué claves entran las operaciones de este fondo. Es lo que permite
   *  que las compras del Excel caigan en el activo que crea el PDF, en la
   *  misma importación y sin que exista todavía ningún id. */
  claves: string[];
  /** Lo que costaron las participaciones, sumando las compras de todos ellos */
  coste: number;
  /** Nombre parecido a más de una posición: mejor que lo mire una persona */
  dudoso: boolean;
  /** Ya está tal cual en la cartera: no hay nada que escribir */
  aldia: boolean;
  /** Lo que se escribirá en el activo */
  campos: Partial<Activo>;
}

export interface Plan {
  lectura: Lectura;
  planeadas: Planeada[];
  nuevas: Planeada[];
  duplicadas: Planeada[];
  /** Ya estaban guardadas, pero el archivo dice otra cosa de ellas: se
   *  corrigen en su sitio en vez de insertarlas otra vez. Es lo que arregla
   *  una importación hecha con el lector equivocado —las órdenes de fondos de
   *  MyInvestor leídas como «otro bróker» entraron todas como compras, con
   *  0,707 participaciones convertidas en 707— sin tener que borrar nada. */
  corregidas: Planeada[];
  activosNuevos: Partial<Activo>[];
  /** Los mismos, con la clave con la que entran sus operaciones. Es lo que
   *  necesita la pantalla para preguntar «¿éste y ése son el mismo fondo?»:
   *  `activosNuevos` sólo lleva las columnas que van a la base de datos. */
  porCrear: { clave: string; activo: Partial<Activo> }[];
  /** Las uniones que ha pedido una persona, ya resueltas —si A es B y B es C,
   *  aquí A es C—. Quien escriba las operaciones tiene que mirarlo: las compras
   *  que entran con la clave de la izquierda van al activo de la derecha, que
   *  es el único que se crea. */
  mismos: Record<string, string>;
  /** Los avisos de los archivos, menos los que otro archivo de esta misma
   *  importación ya ha resuelto. Es lo que hay que enseñar; `lectura.descartes`
   *  es la lista cruda de cada archivo por separado. */
  descartes: Descarte[];
  /** Lo que el extracto dice que tienes hoy. Vacío en los archivos que sólo
   *  cuentan movimientos, que son casi todos. */
  posiciones: PosicionPlaneada[];
  /** Los que van a entrar VALIENDO CERO: hay dinero dentro y no hay manera de
   *  saber cuánto vale hoy, porque falta el precio, o los títulos, o los dos.
   *
   *  El caso extremo es el extracto de la cuenta corriente de MyInvestor: sin
   *  ISIN no hay precio, y con el concepto cortado a 30 caracteres la mitad de
   *  las compras vienen sin participaciones. El PDF de posición arregla los
   *  fondos que lista, pero los ETC y los ETF viven en la cuenta de valores y
   *  no salen en él, así que ni con los dos archivos se cubre todo.
   *
   *  Por eso lleva dentro lo que hace falta para preguntarlo: cuánto te
   *  costaron y cuántos títulos se han podido leer. Lo que conteste una
   *  persona entra por `valores`.
   *
   *  No entra aquí lo que se calcula solo —títulos y un sitio donde mirar el
   *  precio— ni lo que ya no tienes: una posición vendida entera es una
   *  pérdida realizada, no un activo a cero. */
  sinCubrir: {
    clave: string;
    nombre: string;
    /** Lo que suman sus compras, en euros */
    euros: number;
    ops: number;
    /** Títulos, sólo si TODAS sus compras traen cantidad. Con el nombre
     *  cortado a 30 caracteres la mitad de los fondos las pierden. */
    titulos?: number;
    /** Lo que ha dicho una persona que vale hoy, si lo ha dicho */
    valor?: number;
  }[];
  /** El extracto declara un total y cuadra con lo que trae dentro. Dicho de
   *  otra manera: su alcance es exactamente el efectivo más esas posiciones y
   *  no llega a nada más, así que lo que falte no es que se le haya escapado —
   *  es que no es de este extracto. */
  extractoCuadra: boolean;
  cuentaNueva?: Partial<Cuenta>;
  /** Suma de lo que entra y de lo que sale, para el resumen de la vista previa */
  totalCompras: number;
  totalVentas: number;
  totalCobros: number;
  /** El efectivo que implica el extracto y el activo de liquidez que lo
   *  representa. Sin esto el patrimonio sale corto: un extracto trae los
   *  ingresos y las retiradas, pero si nadie crea la cuenta de efectivo el
   *  dinero parado en el broker no aparece por ningun lado. */
  efectivo?: {
    saldo: number;
    activo: Partial<Activo>;
    existente?: Activo;
    /** El saldo lo dice el archivo, no lo hemos sumado nosotros */
    declarado: boolean;
    /** Lo que saldría de sumar los movimientos, cuando difiere del declarado */
    calculado: number;
    /** De dónde sale el saldo: lo dice el archivo, lo ha dicho una persona o
     *  es la suma de los movimientos. */
    origen: "archivo" | "persona" | "calculado";
  };
  /** La cuenta de efectivo de este bróker, exista o no, y el saldo que da el
   *  archivo si da alguno. Es lo que necesita la pantalla para PREGUNTAR
   *  cuánto dinero hay: un archivo de órdenes de fondos no dice nada del
   *  dinero parado y sin preguntarlo el total no cuadra nunca con el banco. */
  liquidez?: { nombre: string; existente?: Activo; delArchivo?: number };
  /** Activos que ya existen y a los que les falta lo que el catálogo sí sabe:
   *  un nombre que se entienda —los que entraron llamándose como su ISIN—, el
   *  símbolo de cotización o la divisa. */
  renombrar: { activo: Activo; campos: Partial<Activo> }[];
  /** Lo que una persona ha añadido a mano porque no está en ningún archivo:
   *  los ETC y los ETF de la cuenta de valores de MyInvestor, por ejemplo. */
  extras: Partial<Activo>[];
  /** El nombre legible de cada clave de fila —ISIN, ticker o nombre—, ya con
   *  lo que vaya a renombrarse. Sin esto la vista previa enseñaba ISIN. */
  nombres: Record<string, string>;
}

/** ¿Queda saldo de efectivo por escribir?
 *
 *  Un archivo repetido no trae ninguna operación nueva, pero eso no quiere
 *  decir que no haya nada que hacer: si la cuenta de efectivo no llegó a
 *  crearse —falló la escritura, se cerró la pestaña— nunca se creará sola,
 *  porque el mismo archivo ya no traerá nada nuevo. Reimportar tiene que
 *  poder arreglarlo. */
export function efectivoPendiente(plan: Plan): boolean {
  const e = plan.efectivo;
  if (!e) return false;
  if (!e.existente) return true;
  // Un céntimo de diferencia es ruido de coma flotante, no un saldo distinto.
  return Math.abs((e.existente.manual_qty ?? 0) - e.saldo) > 0.005;
}

export interface OpcionesPlan {
  estado: EstadoCartera;
  fx: MapaFx;
  fxHistorico?: FxHistorico;
  catalogo?: EntradaCatalogo[];
  /** Cuenta destino ya elegida; si no, se propone una con el bróker detectado */
  cuentaId?: string;
  broker?: string;
  /** Emparejado a mano de una posición del extracto con un activo de la
   *  cartera: `ISIN → id del activo`, o cadena vacía para «ninguno, créalo
   *  nuevo». Manda sobre lo que adivine el parecido de nombres, que con dos
   *  clases del mismo fondo no puede acertar. */
  emparejamientos?: Record<string, string>;
  /** Lo que vale hoy, en euros, un valor del que el extracto no dice nada:
   *  `clave del activo → euros`. Es la respuesta a `Plan.sinCubrir`.
   *
   *  Hace falta porque hay dinero que NINGÚN archivo de MyInvestor sabe contar:
   *  el «Extracto de cuenta» sólo cuadra la cuenta de efectivo, y el Excel de
   *  movimientos trae los euros de cada compra pero no las participaciones,
   *  porque el concepto viene cortado a 30 caracteres. Sin preguntarlo, esos
   *  valores entran a cero y no hay manera de que la cartera cuadre. */
  valores?: Record<string, number>;
  /** «Este activo y ése son el mismo»: `clave → clave del que se queda`.
   *
   *  MyInvestor escribe el mismo fondo de tres maneras —«VANGUARD US 500 STOCK
   *  INDEX EU», «VANGUARD US 500 STOCK EUR», «VANGUARD US 500 STOCK EUR INS»—
   *  porque cambió el rótulo por el camino y el corte a 30 caracteres hizo el
   *  resto. Con el PDF delante los une el ISIN; sin él no hay nada que mirar, y
   *  el parecido de los nombres no sirve: «MSCI EUROPE INDEX P ACC EUR» se
   *  parece un 83 % a «MSCI WORLD INDEX P ACC EUR» y son fondos distintos. Así
   *  que lo dice una persona. */
  mismos?: Record<string, string>;
  /** El dinero sin invertir que hay HOY en la cuenta, dicho por una persona.
   *  Manda sobre el que dé el archivo: es lo único que sabe lo que hay ahora,
   *  y hay archivos —las órdenes de fondos— que no dicen nada del dinero. */
  saldo?: number;
  /** Valores que no están en ningún archivo, con lo que valen hoy en euros. */
  extras?: { nombre: string; valor: number }[];
  /** Los precios de hoy. Con ellos, un valor que se sabe cuánto vale pero no
   *  cuántos títulos tiene —un ETC comprado con el nombre cortado— sale con
   *  sus títulos, y a partir de ahí se pone al día solo. */
  precios?: MapaPrecios;
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

// ── UN ETC POR SU NOMBRE ─────────────────────────────────────────────────
// La cuenta corriente de MyInvestor escribe los ETC de la cuenta de valores
// como le caben en 30 caracteres: «FIDELITY PHYSICAL BITCOIN ET», «WT PHYSICAL
// GOLD-EUR DLY HDG», «X GALAXY PHY ETHEREUM ETC». Sin ISIN no tienen precio, y
// entraban valiendo cero. El catálogo los conoce con el nombre entero, y
// comparten lo que los distingue: la marca, el metal o la cripto, la
// cobertura.
//
// Sólo para ETC y cripto, nunca para fondos: «VANGUARD US 500 STOCK EUR»
// casa igual de bien con dos clases distintas del mismo fondo, y ahí
// equivocarse es ponerle el precio de otro.

const ABREVIATURAS: Record<string, string> = {
  WT: "WISDOMTREE",
  X: "XTRACKERS",
  PHY: "PHYSICAL",
  DLY: "DAILY",
  HDG: "HEDGED",
};
/** Lo que no distingue un producto de otro: el envoltorio, y el «ET» que deja
 *  el corte de «ETP». */
const SIN_SENTIDO = new Set(["ETC", "ETP", "ET", "ETF", "ETN", "C", "ACC", "UCITS", "THE"]);

function palabrasDe(nombre: string): string[] {
  return nombre
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((w) => ABREVIATURAS[w] ?? w)
    .filter((w) => !SIN_SENTIDO.has(w));
}

/** La entrada del catálogo que es este nombre cortado, si es UNA y se parece
 *  de verdad: la misma marca y tres cuartas partes de las palabras. Con dos
 *  candidatos igual de buenos, ninguno. */
export function entradaPorNombre(
  nombre: string,
  catalogo: EntradaCatalogo[],
): EntradaCatalogo | undefined {
  const mias = new Set(palabrasDe(nombre));
  if (mias.size < 2) return undefined;
  let mejor: EntradaCatalogo | undefined;
  let nota = 0;
  let empate = false;
  for (const c of catalogo) {
    if (!c.name || c.retired) continue;
    const suyas = palabrasDe(c.name);
    // La marca manda: el oro de iShares no es el de WisdomTree.
    if (suyas.length === 0 || !mias.has(suyas[0])) continue;
    const n = suyas.filter((w) => mias.has(w)).length / Math.max(mias.size, suyas.length);
    const mismo = mejor != null && (mejor.yahoo ?? mejor.symbol) === (c.yahoo ?? c.symbol);
    if (n > nota + 1e-9) {
      mejor = c;
      nota = n;
      empate = false;
    } else if (Math.abs(n - nota) < 1e-9 && !mismo) {
      empate = true;
    }
  }
  return mejor && nota >= 0.75 && !empate ? mejor : undefined;
}

// ── CASAR POSICIONES CON ACTIVOS ─────────────────────────────────────────
// El extracto dice «IE00BYX5NX33, MSCI WORLD INDEX P ACC EUR». La cartera
// tiene un activo llamado «FIDELITY MSCI WORLD INDEX P AC», que es como lo
// escribe el extracto de la cuenta corriente antes de cortarlo a 30
// caracteres. Son el mismo fondo y no hay ni un campo que lo diga: el activo
// no tiene ISIN —por eso estamos aquí— y los nombres no coinciden.
//
// Lo único que queda es el parecido de los nombres, y con eso hay que ser
// honesto: acierta casi siempre y falla justo donde más duele, con dos clases
// del mismo fondo. «VANGUARD US 500 STOCK EUR» y «VANGUARD US 500 STOCK IND
// USD» se parecen lo mismo a «VANGUARD US 500 STOCK INDEX EU», que es lo que
// hay guardado. Por eso cuando dos posiciones empatan no se elige ninguna: se
// marca como dudosa y la pantalla lo pregunta.

/** Las palabras de un nombre, sin acentos ni puntuación. */
const fichas = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Cuánto se parecen dos nombres, de 0 a 1.
 *
 *  Cuenta cuántas palabras de uno están en el otro, admitiendo que una sea el
 *  principio de la otra: el corte a 30 caracteres deja «AC» donde ponía «ACC»
 *  y «EU» donde ponía «EUR», y exigir la palabra entera tiraba justo los
 *  emparejamientos que importan. */
export function parecido(a: string, b: string): number {
  const x = fichas(a);
  const y = fichas(b);
  if (x.length === 0 || y.length === 0) return 0;

  const casa = (p: string, q: string) =>
    p === q || (p.length >= 2 && q.startsWith(p)) || (q.length >= 2 && p.startsWith(q));

  const libres = [...y];
  let aciertos = 0;
  for (const p of x) {
    const i = libres.findIndex((q) => casa(p, q));
    if (i >= 0) {
      aciertos++;
      libres.splice(i, 1);
    }
  }
  return aciertos / Math.max(x.length, y.length);
}

/** Por debajo de esto no es el mismo fondo, es otro fondo de la misma casa. */
const PARECIDO_MINIMO = 0.5;

/** Diferencia por debajo de la cual dos posiciones se parecen igual al mismo
 *  activo y elegir una sería jugársela a cara o cruz. */
const EMPATE = 0.1;

/** La divisa que el nombre de un fondo lleva pegada al final, que es donde la
 *  ponen todas las gestoras: «… P ACC EUR», «… IND USD».
 *
 *  Es lo que deshace el único empate que se da de verdad: las dos clases del
 *  mismo fondo. «VANGUARD US 500 STOCK INDEX EU» se parece exactamente igual a
 *  la clase en euros y a la de dólares —una comparte «INDEX/IND» y la otra
 *  «EU/EUR»— y sin mirar la divisa no hay manera de elegir. Vale con el
 *  principio de la palabra porque el corte a 30 caracteres deja «EU» donde
 *  ponía «EUR». */
const DIVISAS = ["EUR", "USD", "GBP", "CHF", "JPY", "SEK", "NOK"];

export function divisaDelNombre(nombre: string): string | undefined {
  const t = fichas(nombre);
  // Sólo las dos últimas: un «US» en «VANGUARD US 500» no es una divisa.
  for (let i = t.length - 1; i >= Math.max(0, t.length - 2); i--) {
    const f = t[i].toUpperCase();
    if (f.length < 2) continue;
    const d = DIVISAS.find((x) => x.startsWith(f));
    if (d) return d;
  }
  return undefined;
}

interface ContextoPosiciones {
  estado: EstadoCartera;
  cuentaDestino?: string;
  catPorIsin: Map<string, EntradaCatalogo>;
  emparejamientos: Record<string, string>;
  fx: MapaFx;
  /** Las operaciones que entran en esta misma importación. Cuentan para el
   *  coste: si no, importar el Excel y el PDF a la vez dejaba todos los fondos
   *  con coste cero, porque en ese momento no había ninguna compra guardada. */
  nuevas: Planeada[];
  /** Activos que las operaciones nuevas van a crear, por su clave. Una
   *  posición puede quedárselos en vez de dejar que nazcan mudos. */
  nuevosActivos: Map<string, Partial<Activo>>;
  /** Claves que una persona ha dicho que son el mismo activo, ya resueltas.
   *  Los activos nuevos están guardados por la clave de la derecha, así que
   *  hay que pasar por aquí para juntar las operaciones de las dos. */
  alias: Record<string, string>;
  /** El nombre que se entiende de cada ISIN, del catálogo. */
  nombrePorIsin: Map<string, string>;
}

/** Un activo con el que una posición puede casar: o ya existe en la cartera, o
 *  lo van a crear las operaciones de este mismo archivo. Las dos cosas se
 *  tratan igual porque para el usuario son lo mismo —«mi fondo del MSCI
 *  World»— y separarlas obligaría a importar en un orden concreto. */
interface Candidato {
  clave: string;
  nombre: string;
  activo?: Activo;
  /** Con qué claves entran sus operaciones */
  claves: string[];
  /** Compras menos ventas, en euros */
  coste: number;
  /** Cuánta historia tiene: decide cuál se queda cuando hay gemelos */
  peso: number;
  /** Las que ya están guardadas, por si hay que mudarlas */
  ops: Operacion[];
}

/** Lo que costó una operación, con su comisión, en euros. */
const dineroDe = (o: { type?: string; total_eur?: number | null; total?: number; fees?: number | null }) => {
  const v = o.total_eur ?? o.total ?? 0;
  if (o.type === "buy") return v + (o.fees || 0);
  if (o.type === "sell") return -v + (o.fees || 0);
  return 0;
};

const claveDe = (f: { isin?: string; ticker?: string; nombre?: string }) =>
  (f.isin || f.ticker || f.nombre || "").toUpperCase();

function candidatos(ctx: ContextoPosiciones): Candidato[] {
  const { estado, cuentaDestino, nuevas, nuevosActivos, alias } = ctx;
  /** La clave con la que se ha guardado el activo, que no es la de la fila
   *  cuando el mismo fondo llega con dos nombres. */
  const canon = (f: FilaImportada) => {
    const k = claveDe(f);
    return alias[k] ?? k;
  };

  // Los candidatos son los activos que han tenido movimiento en esta cuenta:
  // un extracto de MyInvestor no puede estar hablando de una acción que
  // compraste en Trade Republic.
  const deLaCuenta = new Set(
    estado.operaciones
      .filter((o) => o.account_id === cuentaDestino && o.asset_id)
      .map((o) => o.asset_id!),
  );
  const opsDe = new Map<string, Operacion[]>();
  for (const o of estado.operaciones) {
    if (!o.asset_id) continue;
    const l = opsDe.get(o.asset_id);
    if (l) l.push(o);
    else opsDe.set(o.asset_id, [o]);
  }

  const lista: Candidato[] = [];

  for (const a of estado.activos) {
    if (a.archived || a.cat === "liquidez") continue;
    if (cuentaDestino != null && !deLaCuenta.has(a.id)) continue;
    const ops = opsDe.get(a.id) ?? [];
    const suyas = nuevas.filter((p) => p.activo?.id === a.id);
    lista.push({
      clave: a.id,
      nombre: a.name,
      activo: a,
      claves: [...new Set(suyas.map((p) => claveDe(p.fila)))],
      coste: ops.reduce((s, o) => s + dineroDe(o), 0) + suyas.reduce((s, p) => s + dineroDe(p.operacion), 0),
      peso: ops.length + suyas.length,
      ops,
    });
  }

  for (const [clave, activo] of nuevosActivos) {
    const suyas = nuevas.filter((p) => !p.activo && canon(p.fila) === clave);
    if (suyas.length === 0) continue;
    lista.push({
      clave: "nuevo:" + clave,
      nombre: activo.name ?? clave,
      // Las de VERDAD, no la canónica: quien escriba las operaciones las busca
      // por la clave de su fila, que es la del nombre con el que vino.
      claves: [...new Set(suyas.map((p) => claveDe(p.fila)))],
      coste: suyas.reduce((s, p) => s + dineroDe(p.operacion), 0),
      peso: suyas.length,
      ops: [],
    });
  }

  return lista;
}

function casarPosiciones(lectura: Lectura, ctx: ContextoPosiciones): PosicionPlaneada[] {
  const { catPorIsin, emparejamientos, fx, nombrePorIsin } = ctx;
  const posiciones = lectura.posiciones ?? [];
  if (posiciones.length === 0) return [];

  const lista = candidatos(ctx);
  const porClaveCand = new Map(lista.map((c) => [c.clave, c]));
  const porIsinPos = new Map(posiciones.map((p) => [p.isin, p]));

  /** Qué posición se lleva cada candidato. Uno, una: si no, el mismo dinero
   *  contaría dos veces. */
  const asignado = new Map<string, string>();
  const canonico = new Map<string, Candidato | undefined>();
  const aMano = new Set<string>();
  const dudosas = new Set<string>();

  // ── 1 · Lo que haya dicho una persona ────────────────────────────────
  for (const p of posiciones) {
    const forzado = emparejamientos[p.isin];
    if (forzado == null) continue;
    aMano.add(p.isin);
    const c = forzado ? porClaveCand.get(forzado) : undefined;
    canonico.set(p.isin, c);
    if (c) asignado.set(c.clave, p.isin);
  }

  // ── 2 · El ISIN, que no admite discusión ─────────────────────────────
  for (const p of posiciones) {
    if (aMano.has(p.isin)) continue;
    const c = lista.find(
      (x) => (x.activo?.isin ?? "").toUpperCase() === p.isin && !asignado.has(x.clave),
    );
    if (c) {
      canonico.set(p.isin, c);
      asignado.set(c.clave, p.isin);
    }
  }

  // ── 3 · El parecido de los nombres, para los que no tienen ISIN ──────
  const pares: { candidato: Candidato; isin: string; nota: number }[] = [];
  for (const c of lista) {
    if (asignado.has(c.clave) || c.activo?.isin) continue;
    const notas = posiciones
      .map((p) => ({ isin: p.isin, nota: parecido(c.nombre, p.nombre) }))
      .filter((x) => x.nota >= PARECIDO_MINIMO)
      .sort((x, y) => y.nota - x.nota);
    if (notas.length === 0) continue;

    // Dos clases del mismo fondo se parecen igual a un nombre cortado:
    // «VANGUARD US 500 STOCK INDEX EU» comparte «INDEX/IND» con la clase en
    // dólares y «EU/EUR» con la de euros, y el recuento de palabras da lo
    // mismo. Lo que las separa es la divisa, que va pegada al final del nombre
    // y que el extracto declara en su propia columna: si sólo una de las
    // empatadas está en la divisa que dice el nombre, ésa es.
    const empatadas = notas.filter((x) => notas[0].nota - x.nota < EMPATE);
    if (empatadas.length > 1) {
      const divisa = divisaDelNombre(c.nombre);
      const porDivisa = divisa
        ? empatadas.filter((x) => porIsinPos.get(x.isin)?.divisa === divisa)
        : [];
      // Y si ni con la divisa se deshace el empate, no se elige: se marcan y
      // que lo diga una persona. Jugárselo a cara o cruz aquí es mudar el
      // dinero de un fondo al de al lado.
      if (porDivisa.length !== 1) {
        for (const x of empatadas) dudosas.add(x.isin);
        continue;
      }
      pares.push({ candidato: c, isin: porDivisa[0].isin, nota: porDivisa[0].nota });
      continue;
    }

    pares.push({ candidato: c, isin: notas[0].isin, nota: notas[0].nota });
  }
  pares.sort((x, y) => y.nota - x.nota);
  for (const par of pares) {
    if (asignado.has(par.candidato.clave)) continue;
    // Si alguien ha dicho «ninguno» para esta posición, es que no quiere que
    // se toque nada suyo.
    if (aMano.has(par.isin) && !canonico.get(par.isin)) continue;
    asignado.set(par.candidato.clave, par.isin);
  }

  // ── 4 · Qué se va a escribir ─────────────────────────────────────────
  return posiciones.map((p): PosicionPlaneada => {
    const suyos = lista.filter((c) => asignado.get(c.clave) === p.isin);
    // Manda el elegido a mano. Si no, uno que ya exista antes que uno por
    // crear —crear un gemelo al lado del bueno es justo lo que hay que evitar—
    // y entre iguales, el que más historia tenga.
    const orden = [...suyos].sort(
      (a, b) => Number(Boolean(b.activo)) - Number(Boolean(a.activo)) || b.peso - a.peso,
    );
    const elegido = canonico.get(p.isin) ?? orden[0];
    const resto = suyos.filter((c) => c.clave !== elegido?.clave);

    const activo = elegido?.activo;
    const absorbidos = resto.map((c) => c.activo).filter((a): a is Activo => a != null);
    const coste = suyos.reduce((s, c) => s + c.coste, 0);
    const claves = [...new Set(suyos.flatMap((c) => c.claves))];
    const reasignar = resto.flatMap((c) => c.ops);

    const precio = p.valor / p.titulos;
    const cambio = tasa(p.divisa, fx);
    // `manual_cost_unit` va en la divisa del activo: el motor lo multiplica
    // luego por el cambio. Con el coste en euros de una posición en dólares,
    // olvidarlo la inflaba un 16%.
    const costeUnit = coste > 0 ? coste / cambio / p.titulos : precio;
    const cat = catPorIsin.get(p.isin)?.cat ?? activo?.cat ?? "fondo";
    const ticker =
      catPorIsin.get(p.isin)?.yahoo ?? catPorIsin.get(p.isin)?.symbol ?? activo?.ticker ?? null;

    const campos: Partial<Activo> = {
      // El del catálogo antes que el del PDF, que es el rótulo del banco en
      // mayúsculas —«VANGUARD US 500 STOCK EUR»— y a veces cortado.
      name: nombrePorIsin.get(p.isin) ?? p.nombre,
      isin: p.isin,
      ticker,
      cat,
      currency: p.divisa,
      unit: activo?.unit || "títulos",
      underlying: activo?.underlying ?? null,
      // La posición la declara el banco. Que salga del FIFO sería mejor, pero
      // el FIFO necesita las participaciones de cada compra y MyInvestor no
      // las da: con `operations` estos fondos valían cero.
      mode: "manual",
      manual_qty: p.titulos,
      manual_price: precio,
      manual_cost_unit: costeUnit,
    };

    const igual = (a: number | null | undefined, b: number, margen: number) =>
      a != null && Math.abs(a - b) <= margen;
    const aldia =
      activo != null &&
      absorbidos.length === 0 &&
      reasignar.length === 0 &&
      claves.length === 0 &&
      (activo.isin ?? "").toUpperCase() === p.isin &&
      activo.mode === "manual" &&
      igual(activo.manual_qty, p.titulos, 1e-6) &&
      igual(activo.manual_price, precio, 0.005) &&
      igual(activo.manual_cost_unit, costeUnit, 0.005);

    return {
      posicion: p,
      activo,
      crea: elegido == null || activo == null,
      absorbidos,
      reasignar,
      claves,
      coste,
      dudoso: dudosas.has(p.isin) && !aMano.has(p.isin),
      aldia,
      campos,
    };
  });
}

/** ¿Queda alguna posición del extracto por escribir? */
export const posicionesPendientes = (plan: Plan): boolean =>
  plan.posiciones.some((p) => !p.aldia);

/** ¿Hay algo que escribir? Un archivo repetido no trae operaciones nuevas y
 *  aun así puede traer trabajo: corregir las que entraron mal, ponerles
 *  nombre, el saldo del efectivo. */
export const hayTrabajo = (plan: Plan): boolean =>
  plan.nuevas.length > 0 ||
  plan.corregidas.length > 0 ||
  plan.renombrar.length > 0 ||
  plan.extras.length > 0 ||
  efectivoPendiente(plan) ||
  posicionesPendientes(plan);

/** El nombre que se entiende de cada ISIN, sacado del catálogo.
 *
 *  Un archivo que sólo trae el ISIN —las órdenes de fondos de MyInvestor no
 *  tienen ni una columna de nombre— dejaba los activos llamándose
 *  «IE0032126645». El catálogo sabe cómo se llaman, pero guarda el nombre en
 *  la fila del símbolo y no siempre en la del alias ISIN → símbolo, así que se
 *  miran las dos. */
export function nombresDelCatalogo(catalogo: EntradaCatalogo[]): Map<string, string> {
  const porSimbolo = new Map<string, string>();
  for (const c of catalogo) {
    if (!c.name) continue;
    for (const s of [c.symbol, c.yahoo]) {
      if (s && !porSimbolo.has(s.toUpperCase())) porSimbolo.set(s.toUpperCase(), c.name);
    }
  }
  const out = new Map<string, string>();
  for (const c of catalogo) {
    if (!c.isin) continue;
    const k = c.isin.toUpperCase();
    const n = c.name ?? porSimbolo.get((c.yahoo ?? "").toUpperCase());
    if (n && !out.has(k)) out.set(k, n);
  }
  return out;
}

/** Un activo sin nombre de verdad: vacío, o llamado como su propio ISIN. */
const sinNombre = (a: Activo) =>
  !a.name?.trim() ||
  ES_ISIN(a.name) ||
  (a.isin != null && a.name.trim().toUpperCase() === a.isin.toUpperCase());

/** Dos operaciones son la misma orden si son del mismo activo, el mismo día y
 *  por el mismo dinero. El tipo y las participaciones NO entran: son justo lo
 *  que un lector equivocado lee mal. */
const claveGemela = (fecha: string, assetId: string, total: number) =>
  `${fecha}|${assetId}|${Number(total).toFixed(2)}`;

/** Lo que hay que cambiarle a una operación guardada para que diga lo que
 *  dice el archivo, o `undefined` si ya lo dice.
 *
 *  Sólo cuenta lo que cambia la cartera: el tipo, las participaciones, la
 *  divisa, si es un traspaso y —si esta importación va a una cuenta— que la
 *  guardada no tenga ninguna. El cambio a euros NO: sin histórico de divisas
 *  se usa el de hoy, y reimportar un archivo en dólares al día siguiente
 *  «corregiría» todas sus operaciones por lo que se ha movido el dólar. */
function diferencias(
  o: Operacion,
  nueva: Partial<Operacion>,
  conCuenta: boolean,
): Partial<Operacion> | undefined {
  const a = o.quantity;
  const b = nueva.quantity ?? null;
  const otraCantidad =
    a == null || b == null ? a !== b : Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b));
  const otraDivisa = (o.currency || "EUR").toUpperCase() !== (nueva.currency || "EUR").toUpperCase();
  const material =
    o.type !== nueva.type ||
    otraCantidad ||
    otraDivisa ||
    Boolean(o.is_internal_transfer) !== Boolean(nueva.is_internal_transfer) ||
    (conCuenta && o.account_id == null);
  if (!material) return undefined;

  return {
    type: nueva.type,
    quantity: b,
    price: nueva.price ?? null,
    total: nueva.total,
    currency: nueva.currency,
    ...(otraDivisa ? { total_eur: nueva.total_eur } : {}),
    is_internal_transfer: nueva.is_internal_transfer ?? false,
    source_format: nueva.source_format,
    import_hash: nueva.import_hash,
    notes: nueva.notes ?? null,
  };
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

  /** El extracto de una cuenta corriente no trae ISIN, y encima corta el
   *  nombre del fondo: «FIDELITY MSCI WORLD INDEX P AC». Si ese fondo ya está
   *  en la cartera con su nombre entero, la compra tiene que caer ahí y no
   *  crear un activo gemelo y mudo al lado.
   *
   *  Sólo vale cuando el trozo casa con UN activo: «VANGUARD US 500 STOCK»
   *  encaja con dos clases distintas del mismo fondo, y elegir una a cara o
   *  cruz es peor que dejarlo sin casar y que se vea en la vista previa. */
  const porPrefijo = (nombre: string | undefined): Activo | undefined => {
    if (!nombre) return undefined;
    const trozo = normaliza(nombre);
    if (trozo.length < 8) return undefined;
    const casan = estado.activos.filter((a) => a.name && normaliza(a.name).startsWith(trozo));
    return casan.length === 1 ? casan[0] : undefined;
  };
  const catPorIsin = new Map<string, EntradaCatalogo>();
  const catPorTicker = new Map<string, EntradaCatalogo>();
  for (const c of catalogo) {
    // Cada ISIN sale dos veces en el catálogo: en la fila del símbolo, con su
    // nombre, su categoría y su subyacente, y en la del alias ISIN → símbolo,
    // que no trae nada más. Gana la que sabe algo.
    if (c.isin) {
      const k = c.isin.toUpperCase();
      const previa = catPorIsin.get(k);
      if (!previa || (!previa.name && c.name)) catPorIsin.set(k, c);
    }
    if (c.ticker) catPorTicker.set(c.ticker.toUpperCase(), c);
  }
  const nombrePorIsin = nombresDelCatalogo(catalogo);
  /** El ISIN de cada símbolo: en el catálogo va en la fila del alias. */
  const isinPorYahoo = new Map<string, string>();
  for (const c of catalogo) {
    const s = (c.yahoo ?? c.symbol).toUpperCase();
    if (c.isin && !isinPorYahoo.has(s)) isinPorYahoo.set(s, c.isin.toUpperCase());
  }
  const isinDe = (c: EntradaCatalogo) =>
    c.isin?.toUpperCase() ?? isinPorYahoo.get((c.yahoo ?? c.symbol).toUpperCase());
  const yaImportadas = new Set(
    estado.operaciones.map((o) => o.import_hash).filter((h): h is string => Boolean(h)),
  );

  const broker = op.broker ?? lectura.broker;
  /** Esta importación va a una cuenta, exista ya o la cree ella. */
  const hayDestino = Boolean(op.cuentaId || broker);

  // ── Lo que ya se importó, pero mal ───────────────────────────────────
  // Las órdenes guardadas de cada activo, por día y dinero. Una fila del
  // archivo que casa con una de éstas ES esa orden aunque el tipo o las
  // participaciones no coincidan —eso es justo lo que un lector equivocado
  // lee mal—, y entonces se corrige en vez de insertarla otra vez al lado.
  const gemelas = new Map<string, Operacion[]>();
  for (const o of estado.operaciones) {
    if (o.source !== "import" || !o.asset_id) continue;
    const k = claveGemela(o.date, o.asset_id, o.total);
    const l = gemelas.get(k);
    if (l) l.push(o);
    else gemelas.set(k, [o]);
  }
  /** Se la queda una sola fila: dos órdenes iguales el mismo día son dos. */
  const tomarGemela = (assetId: string, fila: FilaImportada, h: string) => {
    const l = gemelas.get(claveGemela(fila.fecha, assetId, fila.total));
    if (!l?.length) return undefined;
    // Mejor la que ya tiene esta misma huella: así no se cruzan dos gemelas.
    const i = Math.max(0, l.findIndex((o) => o.import_hash === h));
    return l.splice(i, 1)[0];
  };

  // ── Los mismos con dos nombres ───────────────────────────────────────
  // «VANGUARD US 500 STOCK INDEX EU», «VANGUARD US 500 STOCK EUR» y «VANGUARD
  // US 500 STOCK EUR INS» son un solo fondo: MyInvestor cambió cómo lo escribe
  // y el corte a 30 caracteres hizo el resto. Con el PDF delante los une el
  // ISIN; sin él no hay nada que mirar, y el parecido de los nombres no vale
  // —«MSCI EUROPE INDEX P ACC EUR» se parece un 83% a «MSCI WORLD INDEX P ACC
  // EUR» y son fondos distintos—. Así que lo dice una persona.
  //
  // Se resuelven las cadenas (A→B, B→C queda A→C) y se ignora lo que se muerda
  // la cola, que si no un ciclo cuelga el bucle.
  const alias: Record<string, string> = {};
  for (const [de, a] of Object.entries(op.mismos ?? {})) {
    let destino = a;
    const vistos = new Set([de]);
    while (op.mismos?.[destino] && !vistos.has(destino)) {
      vistos.add(destino);
      destino = op.mismos[destino];
    }
    if (destino && destino !== de) alias[de] = destino;
  }
  /** La clave con la que se guarda el activo de esta fila. */
  const canon = (f: FilaImportada) => {
    const k = claveDe(f);
    return alias[k] ?? k;
  };
  /** Todas las maneras de llamar a un activo: la suya y las que se le han
   *  unido. Hace falta para los avisos, que vienen con la clave cruda. */
  const comoSeLlama = (clave: string) => [
    clave,
    ...Object.keys(alias).filter((k) => alias[k] === clave),
  ];

  // Los activos nuevos se acumulan aquí para que dos compras del mismo fondo
  // en el mismo archivo no creen el activo dos veces.
  const nuevosPorClave = new Map<string, Partial<Activo>>();
  /** Los que se llaman como en el catálogo porque el archivo sólo traía un
   *  trozo del nombre: ése no se les vuelve a poner encima. */
  const nombreDelCatalogo = new Set<string>();
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
    // Un ETC que llega sólo con el nombre, y cortado: se busca en el catálogo
    // por sus palabras. Los fondos no —ver `entradaPorNombre`—.
    const delNombre =
      esValor && !fila.isin && !fila.ticker && fila.nombre && fila.categoria && fila.categoria !== "fondo"
        ? entradaPorNombre(fila.nombre, catalogo)
        : undefined;
    const isinDelNombre = delNombre ? isinDe(delNombre) : undefined;
    const existente =
      (fila.isin ? porIsin.get(fila.isin.toUpperCase()) : undefined) ??
      (fila.ticker ? porTicker.get(fila.ticker.toUpperCase()) : undefined) ??
      (isinDelNombre ? porIsin.get(isinDelNombre) : undefined) ??
      (esValor && !fila.isin && !fila.ticker ? porPrefijo(fila.nombre) : undefined);

    const entradaCat =
      (fila.isin ? catPorIsin.get(fila.isin.toUpperCase()) : undefined) ??
      (fila.ticker ? catPorTicker.get(fila.ticker.toUpperCase()) : undefined) ??
      delNombre;

    let nuevoActivo: Partial<Activo> | undefined;
    let aviso: string | undefined;

    if (!existente && clave) {
      // El mismo fondo puede llegar con dos nombres distintos: MyInvestor
      // cambió cómo lo escribe y el corte a 30 caracteres hace el resto. Sin
      // ISIN no hay forma de saberlo, así que lo dice una persona (`mismos`) y
      // aquí las dos claves acaban en el MISMO activo.
      const suya = alias[clave] ?? clave;
      nuevoActivo = nuevosPorClave.get(suya);
      if (!nuevoActivo) {
        nuevoActivo = {
          // Un archivo que sólo trae el ISIN dejaba el activo llamándose
          // «IE0032126645». El catálogo sabe cómo se llama.
          name:
            // El del catálogo, entero, antes que «FIDELITY PHYSICAL BITCOIN ET».
            delNombre?.name ||
            fila.nombre ||
            (fila.isin ? nombrePorIsin.get(fila.isin.toUpperCase()) : undefined) ||
            entradaCat?.name ||
            clave,
          isin: fila.isin ?? entradaCat?.isin ?? isinDelNombre ?? null,
          // El orden importa y costo que cuatro acciones entraran mudas: los
          // precios se buscan por `ticker` contra el mapa que llena el cron, y ese
          // mapa esta indexado por el simbolo de Yahoo. El campo `ticker` del
          // catalogo es el corto y bonito (CABK), el que cotiza es `yahoo`
          // (CABK.MC). Preferir el corto deja al activo sin precio para siempre.
          ticker: fila.ticker ?? entradaCat?.yahoo ?? entradaCat?.symbol ?? entradaCat?.ticker ?? null,
          cat: categoriaDe(fila, entradaCat),
          currency: fila.divisa || entradaCat?.currency || "EUR",
          underlying: entradaCat?.underlying ?? fila.subyacente ?? null,
          unit: "títulos",
          mode: "operations",
        };
        nuevosPorClave.set(suya, nuevoActivo);
        if (delNombre) nombreDelCatalogo.add(suya);
      }
      if (!entradaCat) {
        aviso = "Activo nuevo y sin precio en el catálogo: habrá que apuntarlo a mano";
      }
    }

    const h = huella(fila);

    // El cambio que venga en el extracto gana: es el que el broker aplico
    // de verdad ese dia, margen incluido. El historico es una aproximacion.
    const cambio =
      fila.cambio != null && isFinite(fila.cambio) && fila.cambio > 0
        ? fila.cambio
        : tasaEn(fila.divisa, fila.fecha, fx, fxHistorico);

    const operacion: Partial<Operacion> = {
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
      // El formato de SU archivo, no el del conjunto: con varios archivos a
      // la vez, deshacer una importación tiene que poder distinguirlos.
      source_format: fila.formato ?? lectura.formato,
      import_hash: h,
      notes: fila.nota ?? null,
    };

    // ¿Ya estaba, aunque sea mal escrita? Entonces se corrige, o no se toca si
    // ya dice lo mismo que el archivo.
    const gemela = existente && esValor ? tomarGemela(existente.id, fila, h) : undefined;
    const cambios = gemela ? diferencias(gemela, operacion, hayDestino) : undefined;
    // La huella es única por usuario: si la nueva ya la lleva OTRA operación,
    // ésta se queda con la suya.
    if (cambios?.import_hash && cambios.import_hash !== gemela?.import_hash && yaImportadas.has(h)) {
      delete cambios.import_hash;
    }
    // Un archivo puede traer la misma línea dos veces; la segunda también es
    // duplicada aunque todavía no esté en la base de datos.
    const duplicada = gemela ? cambios == null : yaImportadas.has(h) || vistas.has(h);
    vistas.add(h);

    planeadas.push({
      fila,
      activo: existente,
      nuevoActivo,
      duplicada,
      aviso,
      operacion,
      corrige: cambios ? gemela : undefined,
      cambios,
    });
  }

  // El activo unido se llama como el que se queda, no como el primero que
  // llegó: las filas vienen por fecha, y la primera compra puede ser la del
  // nombre viejo. Sin esto, unir «PICTET CHINA INDEX P ACC» a «PICTET-CHINA IX
  // P EUR» dejaba el activo llamándose como el que se acaba de unir.
  const nombreDeClave = new Map<string, string>();
  for (const f of lectura.filas) {
    const k = claveDe(f);
    if (k && f.nombre && !nombreDeClave.has(k)) nombreDeClave.set(k, f.nombre);
  }
  for (const [clave, activo] of nuevosPorClave) {
    const nombre = nombreDeClave.get(clave);
    if (nombre && !nombreDelCatalogo.has(clave)) activo.name = nombre;
  }

  const nuevas = planeadas.filter((p) => !p.duplicada && !p.corrige);
  const corregidas = planeadas.filter((p) => p.corrige != null);
  // Lo que el archivo trae y cuenta: lo nuevo y lo que se corrige. Con una
  // importación que sólo corrige, el resumen de compras salía a cero.
  const vivas = [...nuevas, ...corregidas];
  const suma = (tipos: string[]) =>
    vivas.reduce((s, p) => (tipos.includes(p.fila.tipo) ? s + (p.operacion.total_eur ?? 0) : s), 0);

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
  // Las corregidas cuentan como quedarán, no como estaban.
  const corregidaPorId = new Map(
    corregidas.map((p) => [
      p.corrige!.id,
      { ...p.corrige!, ...p.cambios, account_id: p.corrige!.account_id ?? cuentaDestino ?? null },
    ]),
  );
  const yaHabia = estado.operaciones.filter(
    (o) => o.account_id === cuentaDestino && !corregidaPorId.has(o.id),
  );
  const todas = [...yaHabia, ...corregidaPorId.values(), ...nuevas.map((p) => p.operacion)];
  const calculado = efectivoDe(todas);
  // El saldo que declara el archivo gana a la suma. Un extracto es una
  // ventana: el Excel de MyInvestor empieza el día que le pides y el dinero
  // que ya había antes no está en ninguna fila. Sumando sólo movimientos, la
  // cuenta salía en −173,39 € cuando en el banco había 218,32.
  const saldoDelArchivo = lectura.saldo ?? calculado;
  // Y lo que diga una persona gana a los dos: es la única que sabe lo que hay
  // HOY. Un archivo de órdenes de fondos no dice nada del dinero parado, y el
  // extracto de la cuenta es de hace días.
  const saldoAMano =
    op.saldo != null && isFinite(op.saldo) && op.saldo >= 0 ? op.saldo : undefined;
  const saldo = saldoAMano ?? saldoDelArchivo;

  // ── Las posiciones ───────────────────────────────────────────────────
  const estadoCorregido: EstadoCartera = corregidaPorId.size
    ? { ...estado, operaciones: estado.operaciones.map((o) => corregidaPorId.get(o.id) ?? o) }
    : estado;
  const posiciones = casarPosiciones(lectura, {
    estado: estadoCorregido,
    nombrePorIsin,
    cuentaDestino,
    catPorIsin,
    emparejamientos: op.emparejamientos ?? {},
    fx,
    nuevas,
    nuevosActivos: nuevosPorClave,
    alias,
  });
  /** Claves de operación que ya tienen dueño: se las ha quedado una posición. */
  const reclamadas = new Set(posiciones.flatMap((p) => p.claves));

  // ── ¿Hasta dónde llega el extracto? ──────────────────────────────────
  // Un extracto de posición trae su propio total, y comparado con lo que trae
  // dentro dice hasta dónde llega. Si el efectivo más las posiciones de la
  // tabla suman ese total, el alcance del archivo es exactamente eso.
  //
  // OJO CON LO QUE NO SIGNIFICA. Que cuadre NO quiere decir que sea todo lo que
  // tienes en el banco. El «Extracto de cuenta» de MyInvestor cuadra su
  // «Posición Integrada» con el efectivo y los fondos de la cuenta de efectivo,
  // y la cuenta de valores —donde están los ETC y los ETF— no aparece en él ni
  // suma en el total. Dar por cerrado un valor porque no salga en la lista era
  // borrar de la cartera 423 € que sí estaban ahí.
  //
  // El margen no es un número redondo por gusto: las posiciones en otra divisa
  // se convierten con el cambio de HOY y el banco usó el de su cierre, así que
  // la holgura tiene que crecer con lo que haya fuera del euro y quedarse en un
  // euro cuando toda la cartera es en euros.
  const posEnEuros = (lectura.posiciones ?? []).map((p) => ({
    eur: p.valor * tasa(p.divisa, fx),
    fuera: p.divisa.toUpperCase() !== "EUR",
  }));
  const totalDeclarado = lectura.declarado?.total;
  const sumaPos = posEnEuros.reduce((s, p) => s + p.eur, 0);
  const enOtraDivisa = posEnEuros.reduce((s, p) => s + (p.fuera ? p.eur : 0), 0);
  const extractoCuadra =
    posiciones.length > 0 &&
    totalDeclarado != null &&
    // Con el saldo del ARCHIVO: se está midiendo el alcance del extracto, y el
    // saldo que teclee una persona es de otro día.
    Math.abs(saldoDelArchivo + sumaPos - totalDeclarado) <= 1 + 0.02 * enOtraDivisa;

  // Solo si la cuenta habla de dinero en algun momento. Un archivo que solo
  // trae compras y ventas no dice nada del saldo, e inventarle uno seria peor
  // que no ponerlo.
  //
  // Se mira sobre TODAS y no solo sobre las nuevas: reimportar el mismo
  // extracto no trae ninguna fila nueva —el dedupe hace su trabajo— y aun asi
  // el saldo tiene que quedar puesto.
  const CAJA = ["deposit", "withdrawal", "interest", "dividend", "fee"];
  const hayMovimientoDeCaja =
    lectura.saldo != null || todas.some((o) => CAJA.includes(String(o.type)));

  const nombreEfectivo = `Efectivo · ${broker || "cuenta"}`;
  const efectivoExistente = estado.activos.find(
    (a) => a.cat === "liquidez" && a.name === nombreEfectivo,
  );

  const efectivo = hayMovimientoDeCaja || saldoAMano != null
    ? {
        saldo,
        calculado,
        declarado: saldoAMano == null && lectura.saldo != null,
        origen:
          saldoAMano != null
            ? ("persona" as const)
            : lectura.saldo != null
              ? ("archivo" as const)
              : ("calculado" as const),
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

  // ── Los activos que hay que crear ────────────────────────────────────
  // Sólo los que hacen falta para las operaciones nuevas, y que no se haya
  // quedado ya una posición del extracto: si no, la compra del Excel crearía un
  // activo mudo justo al lado del que el PDF crea con su ISIN y sus
  // participaciones.
  //
  // La clave es la canónica: si una persona ha dicho que dos nombres son el
  // mismo fondo, las dos filas traen el mismo `nuevoActivo` y aquí tiene que
  // quedar UNA entrada, o se insertaría el activo dos veces.
  const porCrear = [
    ...new Map(
      nuevas
        .filter((p) => p.nuevoActivo)
        .map((p) => [canon(p.fila), p.nuevoActivo!] as const)
        .filter(([k]) => !comoSeLlama(k).some((x) => reclamadas.has(x))),
    ),
  ];

  // ── Lo que va a entrar valiendo cero ─────────────────────────────────
  // Un activo vale «títulos × precio», y hay archivos que no dan ninguna de
  // las dos cosas. El extracto de la cuenta corriente de MyInvestor es el caso
  // extremo: sin ISIN no hay precio, y con el concepto cortado a 30 caracteres
  // la mitad de las compras vienen sin participaciones. Todo lo que compraste
  // entra a cero euros.
  //
  // El PDF de posición arregla los fondos que lista —les pone ISIN y títulos—
  // pero no llega a todo: los ETC y los ETF viven en la cuenta de valores y no
  // salen en él. Y si no hay PDF, no se arregla ninguno.
  //
  // Así que la condición no es «el extracto no lo menciona» sino la de verdad:
  // este activo va a entrar SIN VALOR y con dinero dentro. Eso hay que
  // preguntarlo, con PDF o sin él. La respuesta llega por `valores`.
  const valores = op.valores ?? {};
  const sinCubrir: Plan["sinCubrir"] = [];
  /** Claves que ya no hace falta avisar: alguien ha dicho lo que valen. */
  const resueltos = new Set<string>();
  {
    for (const [clave, activo] of porCrear) {
      const suyas = nuevas.filter((p) => canon(p.fila) === clave);
      const euros = suyas.reduce((s, p) => s + dineroDe(p.operacion), 0);
      // Los títulos sólo valen si están TODOS: sumar la mitad de las compras
      // da una posición a medias, que es peor que no dar ninguna.
      const compras = suyas.filter((p) => p.fila.tipo === "buy");
      const todas = compras.length > 0 && compras.every((p) => p.fila.cantidad != null);
      const titulos = todas
        ? suyas.reduce(
            (s, p) => s + (p.fila.cantidad ?? 0) * (p.fila.tipo === "sell" ? -1 : 1),
            0,
          )
        : undefined;
      const valor = valores[clave];

      // Nada que preguntar en dos casos, y la diferencia entre ellos es qué se
      // sabe de los TÍTULOS, no del dinero:
      //
      //   · La posición está cerrada —vendida entera, o un warrant que
      //     venció—. Da igual que las compras sumen más que las ventas: eso es
      //     una pérdida realizada, no un activo a cero. Mirando el dinero en
      //     vez de los títulos, el importador de Trade Republic preguntaba por
      //     seis posiciones cerradas hace meses.
      //   · O se calcula solo: títulos y un sitio donde mirar el precio.
      const cerrada = titulos != null && titulos <= 0;
      const seCalculaSolo = titulos != null && titulos > 0 && activo.ticker != null;
      if (cerrada || seCalculaSolo || euros <= 0.005) continue;

      sinCubrir.push({ clave, nombre: activo.name ?? clave, euros, ops: suyas.length, titulos, valor });

      if (valor != null && valor >= 0) {
        // Con un valor a mano el activo pasa a `manual`, igual que las
        // posiciones del PDF: los títulos si se saben, y si no una posición
        // entera, que es como lo cuenta quien mira la app del banco.
        //
        // OJO con la posición entera: `precioEur` prefiere el precio de
        // mercado y sólo cae a `manual_price` si no hay ninguno, así que un
        // ticker puesto encima de esto valdría «1 × lo que cuesta una unidad».
        // Por eso, sin títulos, un activo que sí tiene cotización —un ETC
        // encontrado en el catálogo por su nombre— saca los títulos del
        // valor: 180 € a 7,50 € son 24, y desde ahí se pone al día solo. Si
        // no hay precio para hacer la cuenta, se le quita el símbolo: mejor
        // un valor fijo que «1 × lo que cuesta una unidad».
        let qty = titulos && titulos > 0 ? titulos : undefined;
        if (qty == null && (activo.ticker || activo.isin)) {
          const p = op.precios
            ? precioEur({ ...activo, mode: "manual", manual_price: null } as Activo, op.precios, fx)
            : null;
          if (p != null && p > 0 && valor > 0) qty = valor / p;
          else Object.assign(activo, { ticker: null, isin: null });
        }
        const conTitulos = qty != null;
        qty ??= 1;
        Object.assign(activo, {
          mode: "manual",
          currency: "EUR",
          unit: conTitulos ? (activo.unit ?? "títulos") : "posición",
          manual_qty: qty,
          manual_price: valor / qty,
          // El coste sale de las compras, no del valor: si no, cada valor que
          // se teclea entraría sin ganancia ni pérdida.
          manual_cost_unit: euros > 0 ? euros / qty : valor / qty,
        });
        for (const k of comoSeLlama(clave)) resueltos.add(k);
      }
    }
  }

  // ── Los que ya estaban, pero sin nombre ──────────────────────────────
  // Un activo que entró llamándose «IE0032126645» sigue llamándose así para
  // siempre si nadie lo arregla, porque las importaciones siguientes casan
  // con él por el ISIN y no crean nada. Aquí se le pone el nombre del
  // catálogo, el símbolo con el que cotiza si no tenía y la divisa de sus
  // órdenes: el Vanguard en dólares había quedado apuntado en euros.
  //
  // Los que tienen posición en el extracto no: ésos los pone al día ella.
  const conPosicion = new Set(posiciones.map((p) => p.activo?.id).filter(Boolean));
  const divisasDe = new Map<string, Set<string>>();
  for (const p of planeadas) {
    if (!p.activo || (p.fila.tipo !== "buy" && p.fila.tipo !== "sell")) continue;
    const s = divisasDe.get(p.activo.id) ?? new Set<string>();
    s.add((p.fila.divisa || "EUR").toUpperCase());
    divisasDe.set(p.activo.id, s);
  }
  const renombrar: Plan["renombrar"] = [];
  for (const a of estado.activos) {
    if (!divisasDe.has(a.id) || conPosicion.has(a.id) || !a.isin) continue;
    const isin = a.isin.toUpperCase();
    const cat = catPorIsin.get(isin);
    const campos: Partial<Activo> = {};
    const bonito = nombrePorIsin.get(isin);
    if (bonito && sinNombre(a) && bonito !== a.name) campos.name = bonito;
    // El `yahoo` y no el `symbol`: en la fila del alias el símbolo ES el ISIN.
    const ticker = cat?.yahoo ?? null;
    if (!a.ticker && ticker && ticker.toUpperCase() !== isin) campos.ticker = ticker;
    if (!a.underlying && cat?.underlying) campos.underlying = cat.underlying;
    const divisas = divisasDe.get(a.id)!;
    if (divisas.size === 1) {
      const d = [...divisas][0];
      if (d !== (a.currency || "EUR").toUpperCase()) campos.currency = d;
    }
    if (Object.keys(campos).length) renombrar.push({ activo: a, campos });
  }

  // ── Lo que no está en ningún archivo ─────────────────────────────────
  // Entra con el valor que diga una persona y SIN ganancia ni pérdida —el
  // coste es ese mismo valor—, porque no hay compras de las que sacarlo.
  const extras: Partial<Activo>[] = (op.extras ?? [])
    .filter((e) => e.nombre.trim() && isFinite(e.valor) && e.valor >= 0)
    .map((e) => {
      const q = queEs(e.nombre);
      return {
        name: e.nombre.trim(),
        isin: null,
        ticker: null,
        cat: q.cat,
        underlying: q.underlying ?? null,
        currency: "EUR",
        unit: "posición",
        mode: "manual" as const,
        manual_qty: 1,
        manual_price: e.valor,
        manual_cost_unit: e.valor,
      };
    });

  // ── Cómo se llama cada cosa, para la vista previa ────────────────────
  const nuevoNombre = new Map(renombrar.map((r) => [r.activo.id, r.campos.name]));
  const nombres: Record<string, string> = {};
  for (const p of planeadas) {
    const k = claveDe(p.fila);
    if (!k || nombres[k]) continue;
    nombres[k] =
      (p.activo ? (nuevoNombre.get(p.activo.id) ?? p.activo.name) : undefined) ||
      p.nuevoActivo?.name ||
      p.fila.nombre ||
      k;
  }

  return {
    lectura,
    planeadas,
    nuevas,
    duplicadas: planeadas.filter((p) => p.duplicada),
    corregidas,
    renombrar,
    extras,
    nombres,
    liquidez: broker
      ? {
          nombre: nombreEfectivo,
          existente: efectivoExistente,
          delArchivo: hayMovimientoDeCaja ? saldoDelArchivo : undefined,
        }
      : undefined,
    activosNuevos: porCrear.map(([, a]) => a),
    porCrear: porCrear.map(([clave, activo]) => ({ clave, activo })),
    mismos: alias,
    // «Este fondo entra sin participaciones, sube también el PDF» sobra en
    // cuanto el PDF está delante: la posición ya le ha puesto los títulos. Y
    // sobra igual cuando alguien ha dicho a mano lo que vale. Dejarlo puesto
    // era pedir dos veces el archivo que se acaba de subir.
    descartes: lectura.descartes.filter(
      (d) => !d.clave || !(reclamadas.has(d.clave) || resueltos.has(d.clave)),
    ),
    posiciones,
    sinCubrir,
    extractoCuadra,
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
