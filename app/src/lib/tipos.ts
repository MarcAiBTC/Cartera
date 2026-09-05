// ── TIPOS DEL DOMINIO ────────────────────────────────────────────────────
// Los nombres de campo son los de las tablas de Supabase, en inglés, para que
// una fila viaje del `select` a la pantalla sin traducciones por el camino.
// Lo que se traduce es la interfaz, no los datos.

/** Categorías conocidas. Es un tipo abierto a propósito: la app se rompió una
 *  vez al asumir que sólo existían estas cinco, y una categoría nueva tiene que
 *  poder llegar y mostrarse como «otro» en vez de reventar. */
export type Categoria = "fondo" | "cripto" | "metal" | "accion" | "liquidez" | (string & {});

export const CATEGORIAS: Categoria[] = ["fondo", "cripto", "metal", "accion", "liquidez"];

export const CAT_LBL: Record<string, string> = {
  fondo: "Fondos",
  cripto: "Cripto",
  metal: "Metales",
  accion: "Acciones y ETF",
  liquidez: "Efectivo",
  otro: "Otros",
};

/** Colores de GRÁFICO, que no son los mismos que los de la interfaz.
 *
 *  Los acentos de la app (lavanda, melocotón, oro, menta) son bonitos juntos
 *  pero no sirven para distinguir porciones de una tarta: al comprobarlos con
 *  un validador de daltonismo, el oro y el melocotón quedaban a ΔE 7,5 incluso
 *  con visión normal —indistinguibles— y el lila leía como gris.
 *
 *  Estos cinco están verificados par a par (no sólo entre vecinos, porque el
 *  orden de las porciones cambia con los importes) en claro y en oscuro:
 *  separación en deuteranopía, protanopía y tritanopía, y contraste contra
 *  ambos fondos. El mismo juego vale para los dos temas a propósito: así una
 *  categoría no cambia de color al cambiar de tema.
 *
 *  «otro» es gris a propósito: no es una identidad más, es el cajón de lo que
 *  no encaja, y darle un color propio lo haría competir con las categorías
 *  reales. */
export const CAT_COLOR: Record<string, string> = {
  fondo: "#3653cc",
  accion: "#9573ee",
  metal: "#d97706",
  cripto: "#be185d",
  liquidez: "#0e9e8c",
  otro: "#8b86a6",
};

/** Orden fijo para lo que no es una categoría (subyacentes, brókeres). Se
 *  reparte en este orden y nunca se cicla: a partir del sexto, todo cae en
 *  «otros» en vez de inventar tonos nuevos que ya no se distinguirían. */
export const SERIE_COLOR = [
  "#3653cc",
  "#d97706",
  "#0e9e8c",
  "#be185d",
  "#9573ee",
  "#8b86a6",
];

export type TipoOperacion =
  | "buy"
  | "sell"
  | "dividend"
  | "interest"
  | "deposit"
  | "withdrawal"
  | "fee"
  | "transfer";

export const OP_LBL: Record<TipoOperacion, string> = {
  buy: "Compra",
  sell: "Venta",
  dividend: "Dividendo",
  interest: "Intereses",
  deposit: "Ingreso",
  withdrawal: "Retirada",
  fee: "Comisión",
  transfer: "Traspaso",
};

export interface Cuenta {
  id: string;
  name: string;
  broker: string;
  currency: string;
}

export interface Activo {
  id: string;
  name: string;
  ticker: string | null;
  isin: string | null;
  cat: Categoria;
  unit: string;
  currency: string;
  underlying: string | null;
  /** `operations`: la posición sale del FIFO. `manual`: saldo declarado. */
  mode: "operations" | "manual";
  manual_qty: number | null;
  manual_cost_unit: number | null;
  manual_price: number | null;
  archived: boolean;
}

export interface Operacion {
  id: string;
  account_id: string | null;
  asset_id: string | null;
  type: TipoOperacion;
  /** ISO `YYYY-MM-DD` */
  date: string;
  quantity: number | null;
  price: number | null;
  /** Siempre positivo: el signo lo pone `type`. */
  total: number;
  fees: number;
  currency: string;
  /** Convertido al cambio del día de la operación, no al de hoy. */
  total_eur: number | null;
  is_internal_transfer: boolean;
  source: "manual" | "import";
  source_format: string | null;
  import_hash: string | null;
  notes: string | null;
}

export interface Snapshot {
  id: string;
  date: string;
  val: number;
  cost: number;
  cost_inv: number | null;
  liq: number | null;
  auto: boolean;
}

export interface Seguimiento {
  id: string;
  ticker: string;
  name: string | null;
  note: string | null;
  target_price: number | null;
}

export interface Objetivo {
  id: string;
  key: string;
  weight: number;
  extra: boolean;
  excluded: boolean;
}

export interface Ajustes {
  display_name: string | null;
  theme: "auto" | "light" | "dark";
  tg_base: "total" | "inv";
  tg_aporte: number;
  band_mode: string;
  expo_base: string;
  data: Record<string, unknown>;
}

export const AJUSTES_POR_DEFECTO: Ajustes = {
  display_name: null,
  theme: "auto",
  tg_base: "total",
  tg_aporte: 500,
  band_mode: "cat",
  expo_base: "total",
  data: {},
};

// ── Datos de mercado (compartidos, sólo lectura) ─────────────────────────

export interface Precio {
  symbol: string;
  eur: number;
  raw: number | null;
  currency: string;
  /** Cierre anterior ya filtrado por el cron: nunca un dato incoherente. */
  prev: number | null;
  name: string | null;
  source: string;
  updated_at: string;
}

export interface EntradaCatalogo {
  symbol: string;
  name: string | null;
  isin: string | null;
  ticker: string | null;
  yahoo: string | null;
  coingecko: string | null;
  currency: string | null;
  cat: string | null;
  underlying: string | null;
  retired: boolean;
}

/** Lo que la app tiene cargado en memoria. */
export interface EstadoCartera {
  cuentas: Cuenta[];
  activos: Activo[];
  operaciones: Operacion[];
  snapshots: Snapshot[];
  seguimiento: Seguimiento[];
  objetivos: Objetivo[];
  cashflow: Record<string, unknown>;
  ajustes: Ajustes;
}

export const ESTADO_VACIO: EstadoCartera = {
  cuentas: [],
  activos: [],
  operaciones: [],
  snapshots: [],
  seguimiento: [],
  objetivos: [],
  cashflow: {},
  ajustes: AJUSTES_POR_DEFECTO,
};
