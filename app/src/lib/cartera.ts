// ════════════════════════════════════════════════════════════════════════
//  CÁLCULO DE LA CARTERA
//
//  Todo el dinero se calcula aquí y en ningún otro sitio: las pantallas sólo
//  pintan. Son funciones puras sobre los datos que ya están en memoria, así
//  que se pueden probar sin navegador ni base de datos.
//
//  Tres reglas que costaron caras y que no se pueden perder al reescribir:
//
//  1. EN LA LIQUIDEZ, EL COSTE ES SIEMPRE EL SALDO. El efectivo ni gana ni
//     pierde. Cuando el coste de una cuenta se guardaba a 0, meter 730 € los
//     contaba como plusvalía: la ganancia subía sola y el aportado bajaba en
//     la misma cantidad, mal por los dos lados a la vez.
//
//  2. APORTADO ≠ COSTE. Al cerrar una venta con beneficio, el importe entra
//     en la liquidez y el coste total sube sin que haya entrado un euro de
//     fuera. Lo mismo hacen los dividendos y los intereses. Por eso hay que
//     restar lo realizado y lo cobrado.
//
//  3. LAS CATEGORÍAS DESCONOCIDAS NO REVIENTAN. Cualquier `cat` que no sea
//     de las cinco de siempre se agrupa como «otro» en vez de romper.
// ════════════════════════════════════════════════════════════════════════

import type {
  Activo,
  EntradaCatalogo,
  EstadoCartera,
  Operacion,
  Precio,
  TipoOperacion,
} from "./tipos";
import { CATEGORIAS } from "./tipos";

export type MapaPrecios = Record<string, Precio>;
export type MapaFx = Record<string, number>;

/** Euros por 1 unidad de esa divisa. Si no hay dato, 1: mejor un importe sin
 *  convertir que un NaN propagándose por toda la pantalla. */
export function tasa(divisa: string | null | undefined, fx: MapaFx): number {
  const c = (divisa || "EUR").toUpperCase();
  if (c === "EUR") return 1;
  const r = fx[c];
  return r != null && r > 0 ? r : 1;
}

/** Normaliza una categoría desconocida a «otro» sólo para agrupar y colorear.
 *  El valor original nunca se toca. */
export function catConocida(cat: string): string {
  return CATEGORIAS.includes(cat) ? cat : "otro";
}

export const esLiquidez = (a: Activo) => a.cat === "liquidez";
export const enMercado = (a: Activo) => a.cat !== "liquidez";

// ── PRECIOS ──────────────────────────────────────────────────────────────

export type EstadoPrecio = "fijo" | "manual" | "vivo" | "cierre" | "viejo" | "sin-precio";

export function buscaPrecio(a: Activo, precios: MapaPrecios): Precio | null {
  if (a.ticker && precios[a.ticker.toUpperCase()]) return precios[a.ticker.toUpperCase()];
  if (a.isin && precios[a.isin.toUpperCase()]) return precios[a.isin.toUpperCase()];
  return null;
}

/** Precio de una unidad, en euros. */
export function precioEur(a: Activo, precios: MapaPrecios, fx: MapaFx): number | null {
  // El efectivo vale su nominal. `manual_price` sólo existe para cuentas en
  // divisa donde 1 unidad ≠ 1 €.
  if (esLiquidez(a)) return (a.manual_price ?? 1) * tasa(a.currency, fx);
  const p = buscaPrecio(a, precios);
  if (p && isFinite(p.eur)) return p.eur;
  if (a.manual_price != null) return a.manual_price * tasa(a.currency, fx);
  return null;
}

/** Cierre anterior en euros, sólo si es fiable.
 *
 *  El cron ya descarta los cierres incoherentes (Yahoo mezcla clases de
 *  distinta divisa y devuelve la vela de hoy con close nulo en sesión
 *  abierta), pero aquí se vuelve a comprobar: un cierre que se aleja más de
 *  un 60% del precio actual no es el cierre de ayer, es otro activo. Sin
 *  este filtro la variación diaria saltaba de 36 a 56 y volvía a 36. */
export function cierreFiable(precio: number | null, prev: number | null | undefined): number | null {
  if (prev == null || !isFinite(prev) || prev <= 0) return null;
  if (precio == null || !isFinite(precio) || precio <= 0) return null;
  const salto = Math.abs(precio - prev) / prev;
  return salto > 0.6 ? null : prev;
}

export function estadoPrecio(a: Activo, precios: MapaPrecios): EstadoPrecio {
  if (esLiquidez(a)) return "fijo";
  if (a.mode === "manual" && !a.ticker && !a.isin) return "manual";
  const p = buscaPrecio(a, precios);
  if (p) {
    const edad = Date.now() - Date.parse(p.updated_at);
    if (!isFinite(edad)) return "vivo";
    if (edad > 36 * 3600e3) return "viejo";
    if (edad > 3 * 3600e3) return "cierre";
    return "vivo";
  }
  return a.manual_price != null ? "manual" : "sin-precio";
}

// ── FIFO ─────────────────────────────────────────────────────────────────

/** Una venta ya cerrada, con el coste del lote que se consumió. Es lo que
 *  alimenta tanto la ganancia realizada como la pantalla Fiscal. */
export interface Realizada {
  /** La venta que la genero. Emparejar por activo+fecha se rompe con dos
   *  ventas del mismo valor el mismo dia, que es justo lo que hace un
   *  extracto cuando la orden se ejecuta en varios trozos. */
  opId: string;
  assetId: string;
  fecha: string;
  qty: number;
  /** Lo cobrado, ya descontada la comisión de venta */
  ingreso: number;
  /** Lo que costó ese lote, comisiones de compra incluidas */
  coste: number;
  resultado: number;
  /** Fecha de la compra más antigua consumida: para saber la antigüedad */
  fechaCompra: string | null;
  /** Sólo en la vista de rentabilidad: el reembolso de un traspaso, que se
   *  cuenta como venta para medir cada fondo por separado pero NO tributa. */
  traspaso?: boolean;
}

export interface Lote {
  fecha: string;
  qty: number;
  /** Coste unitario en euros, comisión de compra incluida */
  costeUnit: number;
}

export interface SaldoFifo {
  qty: number;
  /** Coste remanente en euros */
  coste: number;
  lotes: Lote[];
}

const importeEur = (o: Operacion) => (o.total_eur != null ? o.total_eur : o.total);

// ── TRASPASOS ────────────────────────────────────────────────────────────
// Un traspaso entre fondos son dos operaciones —se reembolsa uno y el dinero
// entra en otro— pero para Hacienda no es una venta: la ganancia NO tributa
// entonces, se difiere. El fondo de destino hereda el coste de adquisición y
// la antigüedad de las participaciones que salieron del de origen, y la
// ganancia sólo aparece cuando se reembolsa de verdad, a dinero.
//
// Tratado como una venta más, la pantalla Fiscal pedía declarar cada traspaso
// y el fondo de destino entraba con coste de mercado, así que su ganancia
// salía casi a cero aunque llevara años ganando. El total no cambiaba —lo que
// faltaba en lo latente sobraba en lo realizado— pero todo lo que se ve por
// fondo y por ejercicio estaba mal repartido.

/** Días que puede tardar el dinero de un reembolso en entrar en el fondo de
 *  destino: uno o dos, y con un fin de semana o un puente por medio, más. */
const DIAS_TRASPASO = 7;

/** Cuánto pueden diferir las dos patas. El reembolso se apunta a veces con un
 *  importe ESTIMADO y la suscripción con lo que de verdad llegó. */
const HOLGURA_TRASPASO = 0.1;

/** Cada reembolso de un traspaso, con la suscripción que le corresponde:
 *  `id del reembolso → id de la suscripción`. Las dos vienen marcadas como
 *  traspaso interno; se casan por fecha y dinero, de fondos distintos. */
export function paresDeTraspaso(operaciones: Operacion[]): Map<string, string> {
  const dias = (de: string, a: string) => (Date.parse(a) - Date.parse(de)) / 86400e3;
  const porFecha = (a: Operacion, b: Operacion) => a.date.localeCompare(b.date);
  const entradas = operaciones.filter((o) => o.is_internal_transfer && o.type === "buy" && o.asset_id);
  const salidas = operaciones
    .filter((o) => o.is_internal_transfer && o.type === "sell" && o.asset_id)
    .sort(porFecha);

  const usadas = new Set<string>();
  const pares = new Map<string, string>();
  for (const s of salidas) {
    const eur = importeEur(s);
    const candidata = entradas
      .filter((e) => {
        if (usadas.has(e.id) || e.asset_id === s.asset_id) return false;
        const d = dias(s.date, e.date);
        const otro = importeEur(e);
        return d >= 0 && d <= DIAS_TRASPASO && Math.abs(otro - eur) <= HOLGURA_TRASPASO * Math.max(otro, eur);
      })
      .sort((a, b) => Math.abs(importeEur(a) - eur) - Math.abs(importeEur(b) - eur) || porFecha(a, b))[0];
    if (candidata) {
      pares.set(s.id, candidata.id);
      usadas.add(candidata.id);
    }
  }
  return pares;
}

/** Recorre las operaciones en orden y devuelve, por activo, la posición viva
 *  y la lista de ventas cerradas.
 *
 *  Método FIFO: se venden antes los lotes más antiguos. Es el que exige
 *  Hacienda en España para valores homogéneos, así que la pantalla Fiscal y
 *  la ganancia realizada salen del mismo sitio y no pueden discrepar.
 *
 *  Los traspasos entre fondos no cierran nada: ver `paresDeTraspaso`. Salvo
 *  con `traspasos: false`, que es la vista de RENTABILIDAD: ver abajo. */
export function calcularFifo(
  operaciones: Operacion[],
  opciones: { traspasos?: boolean } = {},
): {
  saldos: Map<string, SaldoFifo>;
  realizadas: Realizada[];
  /** Reembolsos que fueron un traspaso, con el coste que se llevaron al
   *  fondo de destino. No están en `realizadas`: no tributan. */
  traspasos: Map<string, { coste: number; destino: string }>;
} {
  const saldos = new Map<string, SaldoFifo>();
  const realizadas: Realizada[] = [];
  const pares = paresDeTraspaso(operaciones);
  const destinos = new Set(pares.values());
  // Dos maneras de contar un traspaso, y hacen falta las dos:
  //   · La FISCAL, la de siempre: no es una venta, y el fondo de destino
  //     hereda el coste y la antigüedad. Es la de Fiscal y la de Hacienda.
  //   · La de RENTABILIDAD (`traspasos: false`): el de origen se vende y el
  //     de destino se compra a lo que valía ese día, así que cada fondo
  //     enseña lo que ha rendido ÉL. Con la fiscal, un monetario que recibió
  //     un traspaso del S&P 500 enseñaba un +33 % que era del S&P 500.
  const fiscal = opciones.traspasos !== false;
  const porId = new Map(operaciones.map((o) => [o.id, o]));
  /** Lo que un reembolso deja pendiente para su suscripción: los trozos de
   *  lote que salieron, cada uno con su fecha de compra y su coste. */
  const arrastre = new Map<string, { fecha: string; qty: number; coste: number }[]>();
  const traspasos = new Map<string, { coste: number; destino: string }>();

  // Orden estable: por fecha y, dentro del día, comprar antes que vender —
  // si no, una compra y una venta el mismo día dejarían la posición en
  // negativo y el coste sin lote del que tirar. Salvo la suscripción de un
  // traspaso, que va DESPUÉS de su reembolso: hereda lo que éste se lleva.
  const orden: Record<string, number> = { buy: 0, deposit: 0, transfer: 1, sell: 2 };
  const rango = (o: Operacion) => (destinos.has(o.id) ? 3 : (orden[o.type] ?? 1));
  const ops = [...operaciones].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return rango(a) - rango(b);
  });

  const saldoDe = (id: string): SaldoFifo => {
    let s = saldos.get(id);
    if (!s) {
      s = { qty: 0, coste: 0, lotes: [] };
      saldos.set(id, s);
    }
    return s;
  };

  for (const o of ops) {
    if (!o.asset_id) continue;
    const eur = importeEur(o);
    if (!isFinite(eur)) continue;

    if (o.type === "buy") {
      const qty = o.quantity ?? 0;
      if (qty <= 0) continue;
      const s = saldoDe(o.asset_id);

      // La suscripción de un traspaso no compra a precio de hoy: hereda los
      // lotes que salieron del fondo de origen, con su fecha y su coste,
      // repartidos entre las participaciones nuevas en la misma proporción.
      const heredado = arrastre.get(o.id);
      const salieron = heredado?.reduce((acc, t) => acc + t.qty, 0) ?? 0;
      if (heredado && salieron > 1e-12) {
        const costeHeredado = heredado.reduce((acc, t) => acc + t.coste, 0);
        for (const t of heredado) {
          const parte = (qty * t.qty) / salieron;
          const coste = t.coste + (o.fees || 0) * (t.qty / salieron);
          s.lotes.push({ fecha: t.fecha, qty: parte, costeUnit: coste / parte });
        }
        // Los heredados son más antiguos que lo que ya había: el FIFO tiene
        // que seguir vendiendo primero lo más viejo.
        s.lotes.sort((a, b) => a.fecha.localeCompare(b.fecha));
        s.qty += qty;
        s.coste += costeHeredado + (o.fees || 0);
        continue;
      }

      // La comisión de compra forma parte del coste de adquisición.
      const costeUnit = (eur + (o.fees || 0)) / qty;
      s.lotes.push({ fecha: o.date, qty, costeUnit });
      s.qty += qty;
      s.coste += qty * costeUnit;
    } else if (o.type === "sell") {
      const s = saldoDe(o.asset_id);
      let porVender = o.quantity ?? 0;
      if (porVender <= 0) continue;
      // La comisión de venta se resta de lo cobrado. En la vista de
      // rentabilidad, el reembolso de un traspaso cobra lo que LLEGÓ al fondo
      // de destino: el reembolso se apunta a veces con un importe estimado, y
      // con él la diferencia parecería dinero nuevo que nadie ha puesto.
      const destinoEco = !fiscal && pares.has(o.id) ? porId.get(pares.get(o.id)!) : undefined;
      const ingreso = destinoEco ? importeEur(destinoEco) : eur - (o.fees || 0);
      const precioUnit = (o.quantity ?? 0) > 0 ? ingreso / (o.quantity as number) : 0;
      let costeConsumido = 0;
      let vendido = 0;
      let fechaCompra: string | null = null;
      const trozos: { fecha: string; qty: number; coste: number }[] = [];

      while (porVender > 1e-9 && s.lotes.length > 0) {
        const lote = s.lotes[0];
        if (fechaCompra == null) fechaCompra = lote.fecha;
        const trozo = Math.min(lote.qty, porVender);
        costeConsumido += trozo * lote.costeUnit;
        trozos.push({ fecha: lote.fecha, qty: trozo, coste: trozo * lote.costeUnit });
        lote.qty -= trozo;
        porVender -= trozo;
        vendido += trozo;
        if (lote.qty <= 1e-9) s.lotes.shift();
      }

      // Vender más de lo que consta comprado pasa cuando sólo se importó
      // parte del histórico. Se registra lo que se ha podido casar y el resto
      // se da por coste cero, que es lo conservador para Hacienda.
      s.qty = Math.max(0, s.qty - (o.quantity ?? 0));
      s.coste = Math.max(0, s.coste - costeConsumido);
      // Restos de coma flotante: 0,1 + 0,2 − 0,3 no da cero. El Gold 3x de
      // Trade Republic, vendido entero, se quedaba «abierto» con
      // 0,0000000000000000555 títulos y salía en la cartera valiendo cero.
      if (s.qty < 1e-9) {
        s.qty = 0;
        s.coste = 0;
        s.lotes = [];
      }

      // El reembolso de un traspaso no cierra nada: su coste viaja al fondo
      // de destino. Sólo si había lotes que llevarse — sin histórico del
      // fondo de origen no hay coste que heredar, y entonces se queda como
      // una venta normal para no hacer desaparecer la ganancia.
      const destino = pares.get(o.id);
      if (fiscal && destino && trozos.length > 0) {
        arrastre.set(destino, trozos);
        traspasos.set(o.id, { coste: costeConsumido, destino });
        continue;
      }

      realizadas.push({
        opId: o.id,
        assetId: o.asset_id,
        fecha: o.date,
        qty: o.quantity ?? vendido,
        ingreso,
        coste: costeConsumido,
        resultado: precioUnit * (o.quantity ?? vendido) - costeConsumido,
        fechaCompra,
        ...(destinoEco ? { traspaso: true } : {}),
      });
    }
  }

  return { saldos, realizadas, traspasos };
}

// ── POSICIONES ───────────────────────────────────────────────────────────

export interface Posicion {
  activo: Activo;
  qty: number;
  /** Coste total en euros, a lo que valía cada cosa el día que entró */
  coste: number;
  /** El coste para Hacienda: igual que `coste` salvo en un fondo que recibió
   *  un traspaso, que hereda el del fondo de origen —y con él la plusvalía
   *  pendiente de tributar—. */
  costeFiscal: number;
  costeUnit: number;
  precio: number | null;
  valor: number | null;
  ganancia: number | null;
  gananciaPct: number | null;
  /** Variación de hoy en euros, o null si el cierre anterior no es fiable */
  dia: number | null;
  diaPct: number | null;
  estado: EstadoPrecio;
}

export function calcularPosiciones(
  estado: EstadoCartera,
  precios: MapaPrecios,
  fx: MapaFx,
): Posicion[] {
  // El coste de cada posición, a lo que valía cuando entró: un fondo que
  // recibe un traspaso enseña lo que ha rendido él, no lo que traía el de
  // origen. El fiscal, heredado, va aparte.
  const { saldos } = calcularFifo(estado.operaciones, { traspasos: false });
  const fiscales = calcularFifo(estado.operaciones).saldos;

  return estado.activos
    // Lo que está a cero no es algo que tengas: una posición vendida entera,
    // una cuenta vaciada, un activo creado sin compras todavía. Sus ventas
    // siguen contando en lo realizado y en Fiscal, y en Historial →
    // Posiciones se ven aparte, para editarlos o borrarlos. Un saldo negativo
    // sí se lista: es un error que tiene que verse.
    .filter((a) => {
      if (a.archived) return false;
      const s = saldos.get(a.id);
      const qty = a.mode === "operations" && s != null ? s.qty : (a.manual_qty ?? 0);
      return Math.abs(qty) > 1e-9;
    })
    .map((a): Posicion => {
      const s = saldos.get(a.id);
      const desdeOps = a.mode === "operations" && s != null;

      const qty = desdeOps ? s!.qty : (a.manual_qty ?? 0);
      const precio = precioEur(a, precios, fx);
      const valor = precio != null ? qty * precio : null;

      // REGLA 1: en efectivo el coste ES el saldo, siempre. Ni el FIFO ni un
      // coste guardado a mano pueden inventar aquí una plusvalía.
      let coste: number;
      if (esLiquidez(a)) {
        coste = valor ?? qty;
      } else if (desdeOps) {
        coste = s!.coste;
      } else {
        coste = qty * (a.manual_cost_unit ?? 0) * tasa(a.currency, fx);
      }

      const p = buscaPrecio(a, precios);
      const prev = cierreFiable(precio, p?.prev ?? null);
      const dia = prev != null && precio != null ? qty * (precio - prev) : null;
      const sf = fiscales.get(a.id);
      const costeFiscal = desdeOps && !esLiquidez(a) && sf ? sf.coste : coste;

      return {
        activo: a,
        qty,
        coste,
        costeFiscal,
        costeUnit: qty > 0 ? coste / qty : 0,
        precio,
        valor,
        ganancia: valor != null ? valor - coste : null,
        gananciaPct: valor != null && coste > 0 ? ((valor - coste) / coste) * 100 : null,
        dia,
        diaPct: prev != null && precio != null && prev > 0 ? ((precio - prev) / prev) * 100 : null,
        estado: estadoPrecio(a, precios),
      };
    });
}

// ── TOTALES ──────────────────────────────────────────────────────────────

const COBROS: TipoOperacion[] = ["dividend", "interest"];

/** Cobros en efectivo acumulados hasta una fecha.
 *  Con `soloInversiones` deja fuera los intereses de la cuenta corriente: para
 *  medir cómo van LAS INVERSIONES, lo que paga el banco por el saldo no es
 *  mérito suyo. */
export function cobradoHasta(
  operaciones: Operacion[],
  hasta: string,
  soloInversiones = false,
): number {
  let s = 0;
  for (const o of operaciones) {
    if (!COBROS.includes(o.type)) continue;
    if (o.date > hasta) continue;
    if (soloInversiones && o.type === "interest") continue;
    s += importeEur(o);
  }
  return s;
}

export function realizadoHasta(realizadas: Realizada[], hasta: string): number {
  return realizadas.reduce((s, r) => (r.fecha <= hasta ? s + r.resultado : s), 0);
}

export interface Resumen {
  /** Patrimonio total a precio de mercado */
  valor: number;
  /** Coste total */
  coste: number;
  /** Igual que los dos anteriores pero sin el efectivo */
  valorInv: number;
  costeInv: number;
  liquidez: number;
  /** REGLA 2: coste − realizado − cobrado */
  aportado: number;
  /** No realizada: lo que ganarías vendiendo hoy */
  latente: number;
  realizado: number;
  cobrado: number;
  /** Todo junto: lo latente + lo embolsado + lo cobrado */
  ganancia: number;
  gananciaPct: number | null;
  /** Movimiento de hoy */
  dia: number;
  diaPct: number | null;
}

export function calcularResumen(
  posiciones: Posicion[],
  operaciones: Operacion[],
  realizadas: Realizada[],
  hasta: string,
): Resumen {
  let valor = 0;
  let coste = 0;
  let valorInv = 0;
  let costeInv = 0;
  let liquidez = 0;
  let dia = 0;
  let baseDia = 0;

  for (const p of posiciones) {
    const v = p.valor ?? 0;
    valor += v;
    coste += p.coste;
    if (esLiquidez(p.activo)) {
      liquidez += v;
    } else {
      valorInv += v;
      costeInv += p.coste;
    }
    if (p.dia != null) {
      dia += p.dia;
      baseDia += v - p.dia;
    }
  }

  const realizado = realizadoHasta(realizadas, hasta);
  const cobrado = cobradoHasta(operaciones, hasta);
  const latente = valor - coste;
  const aportado = coste - realizado - cobrado;
  const ganancia = latente + realizado + cobrado;

  return {
    valor,
    coste,
    valorInv,
    costeInv,
    liquidez,
    aportado,
    latente,
    realizado,
    cobrado,
    ganancia,
    gananciaPct: aportado > 0 ? (ganancia / aportado) * 100 : null,
    dia,
    diaPct: baseDia > 0 ? (dia / baseDia) * 100 : null,
  };
}

/** Lo que enseña la app, calculado de una vez y igual en todas partes: las
 *  posiciones, las ventas cerradas FISCALES —las de Fiscal e Historial— y el
 *  resumen, que cuenta como realizado lo que cada fondo ganó hasta que se
 *  traspasó. Así el total no cambia: lo que el fondo de destino ya no lleva
 *  en su coste está en lo realizado. */
export function calcularCartera(
  estado: EstadoCartera,
  precios: MapaPrecios,
  fx: MapaFx,
  hasta: string,
): { posiciones: Posicion[]; realizadas: Realizada[]; resumen: Resumen } {
  const posiciones = calcularPosiciones(estado, precios, fx);
  const { realizadas } = calcularFifo(estado.operaciones);
  const rendidas = calcularFifo(estado.operaciones, { traspasos: false }).realizadas;
  const resumen = calcularResumen(posiciones, estado.operaciones, rendidas, hasta);
  return { posiciones, realizadas, resumen };
}

// ── LO DE UN BANCO ───────────────────────────────────────────────────────

export interface LoDeUnaCuenta {
  operaciones: string[];
  /** Activos que sólo existen por esta cuenta: se van con ella */
  activos: Activo[];
  /** Activos con operaciones también en otra cuenta: se quedan, con las de
   *  la otra */
  compartidos: Activo[];
}

/** Qué se va al borrar una cuenta, y nada más: sus operaciones, los activos
 *  que sólo tienen operaciones suyas y su efectivo. Un activo comprado
 *  también en otro banco se queda con las operaciones de allí, y lo puesto a
 *  mano sin ningún movimiento no se sabe de qué banco es: tampoco se toca. */
export function loDeLaCuenta(estado: EstadoCartera, cuentaId: string): LoDeUnaCuenta {
  const cuenta = estado.cuentas.find((c) => c.id === cuentaId);
  const cuentasPorActivo = new Map<string, Set<string | null>>();
  for (const o of estado.operaciones) {
    if (!o.asset_id) continue;
    let s = cuentasPorActivo.get(o.asset_id);
    if (!s) cuentasPorActivo.set(o.asset_id, (s = new Set()));
    s.add(o.account_id);
  }
  const efectivo = new Set(
    cuenta ? [`Efectivo · ${cuenta.broker}`, `Efectivo · ${cuenta.name}`] : [],
  );
  const activos: Activo[] = [];
  const compartidos: Activo[] = [];
  for (const a of estado.activos) {
    const c = cuentasPorActivo.get(a.id);
    if (c) {
      if (!c.has(cuentaId)) continue;
      if (c.size === 1) activos.push(a);
      else compartidos.push(a);
    } else if (a.cat === "liquidez" && efectivo.has(a.name)) {
      activos.push(a);
    }
  }
  return {
    operaciones: estado.operaciones.filter((o) => o.account_id === cuentaId).map((o) => o.id),
    activos,
    compartidos,
  };
}

// ── AGRUPACIONES ─────────────────────────────────────────────────────────

export interface Grupo {
  clave: string;
  etiqueta: string;
  valor: number;
  coste: number;
  ganancia: number;
  gananciaPct: number | null;
  peso: number;
  dia: number;
  posiciones: Posicion[];
}

function agrupar(
  posiciones: Posicion[],
  clave: (p: Posicion) => string,
  etiqueta: (k: string) => string,
): Grupo[] {
  const mapa = new Map<string, Grupo>();
  let total = 0;

  for (const p of posiciones) {
    const v = p.valor ?? 0;
    if (v <= 0) continue;
    const k = clave(p);
    let g = mapa.get(k);
    if (!g) {
      g = {
        clave: k,
        etiqueta: etiqueta(k),
        valor: 0,
        coste: 0,
        ganancia: 0,
        gananciaPct: null,
        peso: 0,
        dia: 0,
        posiciones: [],
      };
      mapa.set(k, g);
    }
    g.valor += v;
    g.coste += p.coste;
    g.dia += p.dia ?? 0;
    g.posiciones.push(p);
    total += v;
  }

  return [...mapa.values()]
    .map((g) => ({
      ...g,
      ganancia: g.valor - g.coste,
      gananciaPct: g.coste > 0 ? ((g.valor - g.coste) / g.coste) * 100 : null,
      peso: total > 0 ? (g.valor / total) * 100 : 0,
      posiciones: g.posiciones.sort((x, y) => (y.valor ?? 0) - (x.valor ?? 0)),
    }))
    .sort((a, b) => b.valor - a.valor);
}

export function porCategoria(posiciones: Posicion[]): Grupo[] {
  return agrupar(
    posiciones,
    (p) => catConocida(p.activo.cat),
    (k) => k,
  );
}

/** La ficha del catálogo de un activo: por su ticker —como símbolo, como
 *  símbolo de Yahoo o como ticker pelado— o por su ISIN. */
export function entradaCatalogo(
  a: Activo,
  catalogo: EntradaCatalogo[],
): EntradaCatalogo | undefined {
  const t = a.ticker?.trim().toUpperCase() || undefined;
  const i = a.isin?.trim().toUpperCase() || undefined;
  const por = (campo: (c: EntradaCatalogo) => string | null, v: string | undefined) =>
    v ? catalogo.find((c) => campo(c)?.toUpperCase() === v) : undefined;
  return (
    por((c) => c.symbol, t) ??
    por((c) => c.yahoo, t) ??
    por((c) => c.ticker, t) ??
    por((c) => c.isin, i) ??
    por((c) => c.symbol, i)
  );
}

/** Los índices de siempre, reconocidos por el nombre del producto. Es el
 *  último recurso, para lo que llega sin subyacente ni en el activo ni en el
 *  catálogo: el «Vanguard US 500 Stock Index EUR» de MyInvestor entró así, y
 *  en la tarta salía aparte del otro Vanguard siendo el mismo S&P 500. */
const INDICES: [RegExp, string][] = [
  [/S\s*&\s*P\s*500|\bSP\s?500\b|\bUS\s?500\b/i, "S&P 500"],
  [/NASDAQ[\s-]*100/i, "Nasdaq 100"],
  [/MSCI\s+WORLD/i, "MSCI World"],
  [/ALL[\s-]*WORLD/i, "Global All-World"],
  // Con límite de palabra: «Goldman Sachs» no es oro.
  [/\bGOLD\b|\bORO\b/i, "Oro"],
  [/\bSILVER\b|\bPLATA\b/i, "Plata"],
];

/** Qué hay debajo de un activo: lo que diga el activo —se puede corregir a
 *  mano en Historial—, si no el catálogo, si no el nombre, y si nada de eso,
 *  el activo es su propia cosa. */
export function subyacenteDe(a: Activo, catalogo: EntradaCatalogo[] = []): string {
  if (esLiquidez(a)) return "Efectivo";
  if (a.underlying?.trim()) return a.underlying.trim();
  const c = entradaCatalogo(a, catalogo);
  if (c?.underlying) return c.underlying;
  for (const [re, nombre] of INDICES) {
    if (re.test(a.name) || (c?.name != null && re.test(c.name))) return nombre;
  }
  return a.name;
}

/** Cuánto hay de cada COSA, que no es lo mismo que cuántos productos hay: el
 *  fondo del S&P 500 de un bróker y el ETF del S&P 500 de otro son la misma
 *  apuesta, y sumados pesan lo que de verdad pesa el índice en la cartera. */
export function porSubyacente(
  posiciones: Posicion[],
  conLiquidez = true,
  catalogo: EntradaCatalogo[] = [],
): Grupo[] {
  const filtradas = conLiquidez ? posiciones : posiciones.filter((p) => enMercado(p.activo));
  return agrupar(
    filtradas,
    (p) => subyacenteDe(p.activo, catalogo),
    (k) => k,
  );
}

export function porCuenta(posiciones: Posicion[]): Grupo[] {
  return agrupar(
    posiciones,
    (p) => p.activo.currency, // sustituido por el bróker en la vista
    (k) => k,
  );
}

/** Qué mueve hoy la cartera. Ordenado por EUROS, no por porcentaje: un +9%
 *  sobre 30 € no explica nada y un +0,4% sobre 12.000 € sí. */
export function movimientoDelDia(posiciones: Posicion[]): Posicion[] {
  return posiciones
    .filter((p) => p.dia != null && Math.abs(p.dia) >= 0.005)
    .sort((a, b) => Math.abs(b.dia!) - Math.abs(a.dia!));
}

// ── ORDEN ────────────────────────────────────────────────────────────────
// Las posiciones y las bandas se ordenan por lo mismo. «Hoy» va en euros,
// como «Qué la mueve hoy»: un +9 % sobre 30 € no es lo que más se ha movido.

/** «peso» ordena igual que «valor»; lo que cambia es la cifra que se enseña
 *  al lado: el porcentaje de la cartera en vez de los euros. */
export type OrdenPosiciones = "valor" | "peso" | "rentabilidad" | "ganancia" | "hoy" | "nombre";

interface Medidas {
  nombre: string;
  valor: number;
  ganancia: number | null;
  pct: number | null;
  dia: number | null;
}

const COTEJO = new Intl.Collator("es", { sensitivity: "base", numeric: true });

function ordenar<T>(xs: T[], medir: (x: T) => Medidas, orden: OrdenPosiciones, asc: boolean): T[] {
  const clave = (m: Medidas): number | string | null =>
    orden === "valor" || orden === "peso"
      ? m.valor
      : orden === "rentabilidad"
        ? m.pct
        : orden === "ganancia"
          ? m.ganancia
          : orden === "hoy"
            ? m.dia
            : m.nombre;
  return xs
    .map((x) => ({ x, k: clave(medir(x)) }))
    .sort((a, b) => {
      // Sin dato —el efectivo no tiene rentabilidad; lo que no tiene cierre
      // de ayer no tiene «hoy»— va al final en los dos sentidos: arriba del
      // todo, un «—» no dice nada.
      if (a.k == null || b.k == null) return a.k == null ? (b.k == null ? 0 : 1) : -1;
      const c =
        typeof a.k === "string" ? COTEJO.compare(a.k, String(b.k)) : a.k - (b.k as number);
      return asc ? c : -c;
    })
    .map((e) => e.x);
}

export function ordenarPosiciones(
  posiciones: Posicion[],
  orden: OrdenPosiciones,
  asc = false,
): Posicion[] {
  return ordenar(
    posiciones,
    (p) => {
      const liq = esLiquidez(p.activo);
      return {
        nombre: p.activo.name,
        valor: p.valor ?? 0,
        ganancia: liq ? null : p.ganancia,
        pct: liq ? null : p.gananciaPct,
        dia: liq ? null : p.dia,
      };
    },
    orden,
    asc,
  );
}

export function ordenarGrupos(
  grupos: Grupo[],
  orden: OrdenPosiciones,
  asc = false,
  etiqueta: (clave: string) => string = (k) => k,
): Grupo[] {
  return ordenar(
    grupos,
    (g) => {
      const liq = g.clave === "liquidez";
      return {
        nombre: etiqueta(g.clave),
        valor: g.valor,
        ganancia: liq ? null : g.ganancia,
        pct: liq ? null : g.gananciaPct,
        dia: liq ? null : g.dia,
      };
    },
    orden,
    asc,
  );
}

// ── FISCAL ───────────────────────────────────────────────────────────────

export interface Ejercicio {
  anio: number;
  ganancias: number;
  perdidas: number;
  neto: number;
  dividendos: number;
  intereses: number;
  ventas: Realizada[];
}

/** Plusvalías y minusvalías por año natural, más lo cobrado en cada uno.
 *  En España las pérdidas patrimoniales se compensan con ganancias del mismo
 *  tipo durante los cuatro ejercicios siguientes: de ahí `caducaEn`. */
export function porEjercicio(realizadas: Realizada[], operaciones: Operacion[]): Ejercicio[] {
  const mapa = new Map<number, Ejercicio>();

  const dame = (anio: number): Ejercicio => {
    let e = mapa.get(anio);
    if (!e) {
      e = { anio, ganancias: 0, perdidas: 0, neto: 0, dividendos: 0, intereses: 0, ventas: [] };
      mapa.set(anio, e);
    }
    return e;
  };

  for (const r of realizadas) {
    const e = dame(Number(r.fecha.slice(0, 4)));
    if (r.resultado >= 0) e.ganancias += r.resultado;
    else e.perdidas += -r.resultado;
    e.neto += r.resultado;
    e.ventas.push(r);
  }

  for (const o of operaciones) {
    if (o.type !== "dividend" && o.type !== "interest") continue;
    const e = dame(Number(o.date.slice(0, 4)));
    if (o.type === "dividend") e.dividendos += importeEur(o);
    else e.intereses += importeEur(o);
  }

  return [...mapa.values()].sort((a, b) => b.anio - a.anio);
}

export const caducaEn = (anio: number) => anio + 4;
