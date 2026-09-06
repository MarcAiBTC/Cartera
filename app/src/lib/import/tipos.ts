// ── LO QUE DEVUELVE UN ADAPTADOR ─────────────────────────────────────────

import type { TipoOperacion } from "../tipos";
import { normaliza } from "./csv";

export type Formato =
  | "traderepublic-csv"
  | "revolut-csv"
  | "myinvestor-json"
  | "myinvestor-tabla"
  | "generico-csv"
  | "generico-json"
  | "desconocido";

export const FORMATO_LBL: Record<Formato, string> = {
  "traderepublic-csv": "Trade Republic · CSV",
  "revolut-csv": "Revolut · extracto de cuenta",
  "myinvestor-json": "MyInvestor · JSON",
  "myinvestor-tabla": "MyInvestor · movimientos",
  "generico-csv": "Genérico · CSV/Excel",
  "generico-json": "Genérico · JSON",
  desconocido: "Formato no reconocido",
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
  cantidad?: number;
  precio?: number;
  total: number;
  comision?: number;
  divisa: string;
  /** Traspaso entre cuentas propias: no es dinero nuevo */
  traspasoInterno?: boolean;
  nota?: string;
}

export interface Descarte {
  linea: number;
  motivo: string;
  crudo: string;
}

export interface Lectura {
  formato: Formato;
  /** Bróker sugerido para la cuenta destino */
  broker: string;
  filas: FilaImportada[];
  descartes: Descarte[];
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
}): string {
  const clave = [
    f.fecha,
    f.tipo,
    (f.isin || f.ticker || "").toUpperCase(),
    f.cantidad != null ? f.cantidad.toFixed(6) : "",
    f.total.toFixed(2),
  ].join("|");

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
