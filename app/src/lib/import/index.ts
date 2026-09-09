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
  esMyInvestorExtracto,
  esMyInvestorJson,
  esMyInvestorMovimientos,
  esMyInvestorTabla,
  leerMyInvestorExtracto,
  leerMyInvestorJson,
  leerMyInvestorMovimientos,
  leerMyInvestorTabla,
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
  if (esMyInvestorTabla(t)) return "myinvestor-tabla";
  if (esMyInvestorMovimientos(t)) return "myinvestor-cuenta";
  if (esTradeRepublic(t)) return "traderepublic-csv";
  return "generico-csv";
}

// ── 3 · Aplicar el adaptador ─────────────────────────────────────────────

/** Los formatos que se leen de una tabla. Un PDF y un JSON no la tienen. */
const NECESITA_TABLA: Formato[] = [
  "revolut-csv",
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
  activosNuevos: Partial<Activo>[];
  /** Los avisos de los archivos, menos los que otro archivo de esta misma
   *  importación ya ha resuelto. Es lo que hay que enseñar; `lectura.descartes`
   *  es la lista cruda de cada archivo por separado. */
  descartes: Descarte[];
  /** Lo que el extracto dice que tienes hoy. Vacío en los archivos que sólo
   *  cuentan movimientos, que son casi todos. */
  posiciones: PosicionPlaneada[];
  /** Valores que salen en las compras y NO en la lista de posiciones, cuando
   *  el extracto ha demostrado que su lista está completa: o los vendiste, o
   *  los traspasaste, o se los llevó otro bróker. Se crean archivados —con su
   *  historial, fuera de la cartera— porque dejarlos vivos sin participaciones
   *  los deja como una fila a cero euros que no dice nada.
   *
   *  Vacío mientras el extracto no pruebe que lo cuenta todo: ahí un valor que
   *  no sale en la lista puede seguir siendo tuyo. */
  cerrados: { clave: string; nombre: string; euros: number; ops: number }[];
  /** El extracto declara un total y cuadra con lo que trae dentro, así que su
   *  lista de posiciones lo cuenta todo. Es lo que autoriza a archivar. */
  extractoCompleto: boolean;
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
  };
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
  const { estado, cuentaDestino, nuevas, nuevosActivos } = ctx;

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
    const suyas = nuevas.filter((p) => !p.activo && claveDe(p.fila) === clave);
    if (suyas.length === 0) continue;
    lista.push({
      clave: "nuevo:" + clave,
      nombre: activo.name ?? clave,
      claves: [clave],
      coste: suyas.reduce((s, p) => s + dineroDe(p.operacion), 0),
      peso: suyas.length,
      ops: [],
    });
  }

  return lista;
}

function casarPosiciones(lectura: Lectura, ctx: ContextoPosiciones): PosicionPlaneada[] {
  const { catPorIsin, emparejamientos, fx } = ctx;
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
      name: p.nombre,
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
      (fila.ticker ? porTicker.get(fila.ticker.toUpperCase()) : undefined) ??
      (esValor && !fila.isin && !fila.ticker ? porPrefijo(fila.nombre) : undefined);

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

    // El cambio que venga en el extracto gana: es el que el broker aplico
    // de verdad ese dia, margen incluido. El historico es una aproximacion.
    const cambio =
      fila.cambio != null && isFinite(fila.cambio) && fila.cambio > 0
        ? fila.cambio
        : tasaEn(fila.divisa, fila.fecha, fx, fxHistorico);

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
        // El formato de SU archivo, no el del conjunto: con varios archivos a
        // la vez, deshacer una importación tiene que poder distinguirlos.
        source_format: fila.formato ?? lectura.formato,
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
  const calculado = efectivoDe(todas);
  // El saldo que declara el archivo gana siempre. Un extracto es una ventana:
  // el Excel de MyInvestor empieza el día que le pides y el dinero que ya
  // había antes no está en ninguna fila. Sumando sólo movimientos, la cuenta
  // salía en −173,39 € cuando en el banco había 218,32.
  const saldo = lectura.saldo ?? calculado;

  // ── Las posiciones ───────────────────────────────────────────────────
  const posiciones = casarPosiciones(lectura, {
    estado,
    cuentaDestino,
    catPorIsin,
    emparejamientos: op.emparejamientos ?? {},
    fx,
    nuevas,
    nuevosActivos: nuevosPorClave,
  });
  /** Claves de operación que ya tienen dueño: se las ha quedado una posición. */
  const reclamadas = new Set(posiciones.flatMap((p) => p.claves));

  // ── ¿El extracto lo cuenta todo? ─────────────────────────────────────
  // Un extracto de posición trae su propio total, y ese total es la prueba: si
  // el efectivo más las posiciones de la tabla suman lo que el banco dice que
  // tienes, la tabla no se deja nada fuera. Y entonces —y sólo entonces— un
  // fondo que aparece en las compras y no en la tabla es un fondo que ya no
  // tienes.
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
  const extractoCompleto =
    posiciones.length > 0 &&
    totalDeclarado != null &&
    Math.abs(saldo + sumaPos - totalDeclarado) <= 1 + 0.02 * enOtraDivisa;

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

  const efectivo = hayMovimientoDeCaja
    ? {
        saldo,
        calculado,
        declarado: lectura.saldo != null,
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
  const porCrear = [
    ...new Map(
      nuevas
        .filter((p) => p.nuevoActivo)
        .map((p) => [claveDe(p.fila), p.nuevoActivo!] as const)
        .filter(([k]) => !reclamadas.has(k)),
    ),
  ];

  // De los que quedan, los que el extracto completo no menciona ya no son
  // tuyos. Nacen archivados: la compra queda en el historial y en el IRPF, pero
  // no aparece en la cartera valiendo cero euros y sin precio, que es lo que
  // pasaba con los tres ETC de cripto y oro de esta cuenta.
  const cerrados: Plan["cerrados"] = [];
  /** Claves que el extracto da por cerradas: ya no hay nada que arreglarles. */
  const resueltos = new Set<string>();
  if (extractoCompleto) {
    for (const [clave, activo] of porCrear) {
      const suyas = nuevas.filter((p) => claveDe(p.fila) === clave);
      cerrados.push({
        clave,
        nombre: activo.name ?? clave,
        euros: suyas.reduce((s, p) => s + dineroDe(p.operacion), 0),
        ops: suyas.length,
      });
      activo.archived = true;
      resueltos.add(clave);
    }
  }

  return {
    lectura,
    planeadas,
    nuevas,
    duplicadas: planeadas.filter((p) => p.duplicada),
    activosNuevos: porCrear.map(([, a]) => a),
    // «Este fondo entra sin participaciones, sube también el PDF» sobra en
    // cuanto el PDF está delante: la posición ya le ha puesto los títulos. Y
    // sobra igual si el extracto dice que ese valor ya no es tuyo. Dejarlo
    // puesto era pedir dos veces el archivo que se acaba de subir.
    descartes: lectura.descartes.filter(
      (d) => !d.clave || !(reclamadas.has(d.clave) || resueltos.has(d.clave)),
    ),
    posiciones,
    cerrados,
    extractoCompleto,
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
