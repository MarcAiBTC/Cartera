// ── LO QUE DEVUELVE UN ADAPTADOR ─────────────────────────────────────────

import type { TipoOperacion } from "../tipos";
import { normaliza } from "./csv";

export type Formato =
  | "traderepublic-csv"
  | "revolut-csv"
  | "myinvestor-json"
  | "myinvestor-ordenes"
  | "myinvestor-tabla"
  | "myinvestor-cuenta"
  | "myinvestor-efectivo"
  | "myinvestor-extracto"
  | "generico-csv"
  | "generico-json"
  | "varios"
  | "desconocido";

/** El nombre del formato, y debajo qué aporta. Lo segundo importa tanto como
 *  lo primero: con MyInvestor hacen falta dos archivos y ninguno de los dos
 *  vale solo, así que el desplegable tiene que decir para qué sirve cada uno
 *  en vez de limitarse a nombrarlo. */
export const FORMATO_LBL: Record<Formato, string> = {
  "traderepublic-csv": "Trade Republic · movimientos",
  "revolut-csv": "Revolut · extracto de cuenta",
  "myinvestor-extracto": "MyInvestor · extracto de posición (PDF)",
  "myinvestor-cuenta": "MyInvestor · cuenta corriente",
  "myinvestor-efectivo": "MyInvestor · cuenta corriente, sólo el dinero",
  "myinvestor-ordenes": "MyInvestor · órdenes de fondos",
  "myinvestor-tabla": "MyInvestor · operaciones de fondos",
  "myinvestor-json": "MyInvestor · JSON de la web",
  "generico-csv": "Otro bróker · CSV o Excel",
  "generico-json": "Otro bróker · JSON",
  varios: "Varios archivos juntos",
  desconocido: "No reconocido",
};

export const FORMATO_NOTA: Record<Formato, string> = {
  "traderepublic-csv": "Compras, ventas, dividendos e ingresos, con ISIN.",
  "revolut-csv": "Compras, ventas, dividendos e ingresos.",
  "myinvestor-extracto":
    "Qué fondos tienes hoy, con ISIN y participaciones, y el saldo real de la cuenta.",
  "myinvestor-cuenta": "El dinero y las compras de fondos, pero sin ISIN ni participaciones.",
  "myinvestor-efectivo": "Sólo ingresos, retiradas e intereses. Deja fuera las compras.",
  "myinvestor-ordenes":
    "Cada orden de fondos desde el primer día, con su ISIN y sus participaciones. Los traspasos entre fondos se reconocen solos.",
  "myinvestor-tabla": "Cada orden con su ISIN, sus participaciones y su valor liquidativo.",
  "myinvestor-json": "Como el anterior, y además distingue los traspasos internos.",
  "generico-csv": "Una fila por movimiento. Las columnas se eligen a mano.",
  "generico-json": "Una lista de movimientos en JSON.",
  varios: "",
  desconocido: "No se ha reconocido el contenido de este archivo.",
};

/** Una operación tal y como sale del archivo, antes de casarla con un activo
 *  de la cartera. `total` va siempre en positivo. */
export interface FilaImportada {
  /** Línea del archivo, para poder señalarla en la vista previa */
  linea: number;
  fecha: string;
  tipo: TipoOperacion;
  isin?: string;
  ticker?: string;
  nombre?: string;
  /** Categoría que el bróker ya sabe («CRYPTO», «STOCK»…). Cuando viene, vale
   *  más que adivinarla por la forma del ISIN. */
  categoria?: string;
  /** Qué hay debajo: «Bitcoin», «Oro». Dos ETC distintos del mismo metal son
   *  la misma apuesta, y la pantalla de reparto los agrupa por aquí. */
  subyacente?: string;
  cantidad?: number;
  precio?: number;
  total: number;
  comision?: number;
  divisa: string;
  /** Cambio a euros que trae el PROPIO extracto, si lo trae. Vale mas que el
   *  historico de divisas: es el que el broker te aplico de verdad ese dia,
   *  con su margen incluido. Multiplica: importe * cambio = euros. */
  cambio?: number;
  /** Traspaso entre cuentas propias: no es dinero nuevo */
  traspasoInterno?: boolean;
  nota?: string;
  /** Qué vez es que aparece esta MISMA orden en el archivo: 2 para la segunda.
   *
   *  Dos órdenes idénticas el mismo día existen —el 1 de septiembre de 2025
   *  salieron del Vanguard dos reembolsos de 49,50 € con 0,74 participaciones
   *  cada uno— y sin esto la segunda tenía la misma huella que la primera y se
   *  quedaba fuera como «duplicada». Sólo lo pone quien sabe que en su formato
   *  dos líneas iguales son dos operaciones. */
  ocurrencia?: number;
  /** De qué archivo salió, cuando se importan varios de una vez. Se guarda en
   *  la operación para poder deshacer una importación concreta. */
  formato?: Formato;
}

export interface Descarte {
  linea: number;
  motivo: string;
  crudo: string;
  /** Qué valor es el que va cojo, cuando el aviso habla de uno concreto.
   *
   *  Está para poder RETIRAR el aviso: «este fondo entra sin participaciones,
   *  sube también el PDF» deja de ser verdad en cuanto el PDF está delante, y
   *  seguir enseñándolo después de haberlo subido es la manera de que nadie se
   *  crea ninguno de los avisos. */
  clave?: string;
}

/** UNA POSICIÓN, NO UNA OPERACIÓN.
 *
 *  Casi todos los archivos de bróker cuentan lo que has HECHO —compraste,
 *  vendiste, cobraste— y la posición sale de sumarlo. Un extracto de posición
 *  hace lo contrario: dice lo que TIENES hoy, sin explicar cómo llegaste ahí.
 *
 *  Las dos cosas se necesitan y ninguna sustituye a la otra: de las
 *  operaciones sale lo que te costó, y de aquí, cuántas participaciones tienes
 *  de verdad. En MyInvestor esto no es un lujo, es la única manera: el
 *  extracto de la cuenta corta el nombre del fondo a 30 caracteres y se come
 *  el ISIN y las participaciones. */
export interface PosicionImportada {
  isin: string;
  nombre: string;
  divisa: string;
  /** Participaciones o títulos, tal y como los cuenta el bróker */
  titulos: number;
  /** Valor de mercado EN SU DIVISA, no en euros */
  valor: number;
}

export interface Lectura {
  formato: Formato;
  /** Bróker sugerido para la cuenta destino */
  broker: string;
  filas: FilaImportada[];
  descartes: Descarte[];
  /** Lo que el archivo dice que tienes, cuando lo dice */
  posiciones?: PosicionImportada[];
  /** El saldo de efectivo que declara el archivo. Vale más que la suma de los
   *  movimientos: un extracto es una ventana y el dinero que ya había antes
   *  de la primera línea no aparece en ninguna de ellas. */
  saldo?: number;
  /** Lo que el propio extracto declara como total, en euros, cuando lo dice:
   *  el efectivo, lo invertido y la suma de los dos.
   *
   *  No es adorno. Es lo que permite saber si la lista de posiciones está
   *  COMPLETA: si el saldo más las posiciones suman el total que dice el
   *  banco, el extracto lo cuenta todo, y entonces un fondo que aparece en las
   *  compras y no en la lista es un fondo que YA NO TIENES. Sin esta prueba
   *  hay que suponer que la lista puede estar parcial y no se puede archivar
   *  nada. */
  declarado?: { efectivo?: number; invertido?: number; total?: number };
}

export const lecturaVacia = (formato: Formato, broker = ""): Lectura => ({
  formato,
  broker,
  filas: [],
  descartes: [],
});

// ── VOCABULARIO ──────────────────────────────────────────────────────────
// Cada bróker llama a lo mismo de una manera, y a veces en dos idiomas dentro
// del mismo archivo. En vez de una tabla por bróker, una sola lista de
// fragmentos: si el texto contiene el fragmento, es de ese tipo. El orden
// importa — «reinversión de dividendo» tiene que caer en dividendo, no en
// compra, así que los términos más específicos van primero.

const REGLAS: [TipoOperacion, string[]][] = [
  ["dividend", ["dividend", "dividendo", "cupon", "coupon", "reparto", "distribution"]],
  ["interest", ["interes", "interest", "zinsen", "remuneracion", "juros", "saveback", "rendimento"]],
  ["fee", ["comision", "fee", "gebuhr", "coste", "charge", "custodia"]],
  [
    "sell",
    ["venta", "sell", "sale", "verkauf", "reembolso", "reimbursement", "redemption", "vender"],
  ],
  [
    "buy",
    [
      "compra",
      "buy",
      "purchase",
      "kauf",
      "suscripcion",
      "subscription",
      "aportacion",
      "savingsplan",
      "planahorro",
    ],
  ],
  ["withdrawal", ["retirada", "withdraw", "payout", "auszahlung", "reintegro", "salida"]],
  ["deposit", ["ingreso", "deposit", "einzahlung", "abono", "aportedeefectivo", "topup"]],
  ["transfer", ["traspaso", "transfer", "traslado", "ubertrag"]],
];

/** Clasifica el texto que el bróker pone en la columna de tipo. Devuelve
 *  `undefined` cuando no reconoce nada: preferimos descartar la línea y
 *  decirlo en la vista previa antes que colarla como compra. */
export function clasificar(texto: string | undefined): TipoOperacion | undefined {
  if (!texto) return undefined;
  const t = normaliza(texto);
  if (!t) return undefined;
  for (const [tipo, fragmentos] of REGLAS) {
    if (fragmentos.some((f) => t.includes(f))) return tipo;
  }
  return undefined;
}

/** Hash estable de una operación: es lo que impide que reimportar el mismo
 *  archivo duplique el histórico. No incluye el formato de origen a propósito
 *  — la misma compra bajada dos veces en dos formatos sigue siendo una. */
export function huella(f: {
  fecha: string;
  tipo: string;
  isin?: string;
  ticker?: string;
  cantidad?: number;
  total: number;
  ocurrencia?: number;
}): string {
  const clave =
    [
      f.fecha,
      f.tipo,
      (f.isin || f.ticker || "").toUpperCase(),
      f.cantidad != null ? f.cantidad.toFixed(6) : "",
      f.total.toFixed(2),
    ].join("|") +
    // Sólo a partir de la segunda: la primera conserva la huella de siempre y
    // lo ya importado sigue reconociéndose como tal.
    (f.ocurrencia != null && f.ocurrencia > 1 ? `#${f.ocurrencia}` : "");

  // FNV-1a de 64 bits en dos mitades: suficiente para distinguir operaciones y
  // sin necesidad de crypto.subtle, que es asíncrono y obligaría a esperar.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < clave.length; i++) {
    const c = clave.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
