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

function buscaPrecio(a: Activo, precios: MapaPrecios): Precio | null {
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

/** Recorre las operaciones en orden y devuelve, por activo, la posición viva
 *  y la lista de ventas cerradas.
 *
 *  Método FIFO: se venden antes los lotes más antiguos. Es el que exige
 *  Hacienda en España para valores homogéneos, así que la pantalla Fiscal y
 *  la ganancia realizada salen del mismo sitio y no pueden discrepar. */
export function calcularFifo(operaciones: Operacion[]): {
  saldos: Map<string, SaldoFifo>;
  realizadas: Realizada[];
} {
  const saldos = new Map<string, SaldoFifo>();
  const realizadas: Realizada[] = [];

  // Orden estable: por fecha y, dentro del día, comprar antes que vender —
  // si no, una compra y una venta el mismo día dejarían la posición en
  // negativo y el coste sin lote del que tirar.
  const orden: Record<string, number> = { buy: 0, deposit: 0, transfer: 1, sell: 2 };
  const ops = [...operaciones].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (orden[a.type] ?? 1) - (orden[b.type] ?? 1);
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
      // La comisión de compra forma parte del coste de adquisición.
      const costeUnit = (eur + (o.fees || 0)) / qty;
      s.lotes.push({ fecha: o.date, qty, costeUnit });
      s.qty += qty;
      s.coste += qty * costeUnit;
    } else if (o.type === "sell") {
      const s = saldoDe(o.asset_id);
      let porVender = o.quantity ?? 0;
      if (porVender <= 0) continue;
      // La comisión de venta se resta de lo cobrado.
      const ingreso = eur - (o.fees || 0);
      const precioUnit = (o.quantity ?? 0) > 0 ? ingreso / (o.quantity as number) : 0;
      let costeConsumido = 0;
      let vendido = 0;
      let fechaCompra: string | null = null;

      while (porVender > 1e-9 && s.lotes.length > 0) {
        const lote = s.lotes[0];
        if (fechaCompra == null) fechaCompra = lote.fecha;
        const trozo = Math.min(lote.qty, porVender);
        costeConsumido += trozo * lote.costeUnit;
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

      realizadas.push({
        opId: o.id,
        assetId: o.asset_id,
        fecha: o.date,
        qty: o.quantity ?? vendido,
        ingreso,
        coste: costeConsumido,
        resultado: precioUnit * (o.quantity ?? vendido) - costeConsumido,
        fechaCompra,
      });
    }
  }

  return { saldos, realizadas };
}

// ── POSICIONES ───────────────────────────────────────────────────────────

export interface Posicion {
  activo: Activo;
  qty: number;
  /** Coste total en euros */
  coste: number;
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
  const { saldos } = calcularFifo(estado.operaciones);

  return estado.activos
    .filter((a) => !a.archived)
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

      return {
        activo: a,
        qty,
        coste,
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

/** Cuánto hay de cada COSA, que no es lo mismo que cuántos productos hay: el
 *  fondo del S&P 500 de un bróker y el ETF del S&P 500 de otro son la misma
 *  apuesta, y sumados pesan lo que de verdad pesa el índice en la cartera. */
export function porSubyacente(posiciones: Posicion[], conLiquidez = true): Grupo[] {
  const filtradas = conLiquidez ? posiciones : posiciones.filter((p) => enMercado(p.activo));
  return agrupar(
    filtradas,
    (p) => (esLiquidez(p.activo) ? "Efectivo" : p.activo.underlying || p.activo.name),
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

// ── CONTRA EL ÍNDICE ─────────────────────────────────────────────────────
// «¿Lo habría hecho mejor comprando el S&P 500 y olvidándome?»
//
// La comparación honesta NO es «tu rentabilidad contra la del índice entre
// dos fechas». Eso sólo valdría si hubieras metido todo el dinero el primer
// día. Aportando a plazos durante dos años, la fecha de cada euro importa
// tanto como el índice: el que entró en un techo lleva menos recorrido.
//
// Así que se replica tu comportamiento sobre el índice. Cada euro que
// ingresaste compra participaciones del índice al precio DE SU DÍA, y cada
// euro que sacaste las vende. Al final se comparan dos patrimonios que han
// vivido las mismas entradas y salidas en las mismas fechas, y la diferencia
// es lo que costó (o ganó) elegir en vez de comprar el índice.

export interface PuntoIndice {
  date: string;
  value: number;
}

export interface ContraIndice {
  /** Primer movimiento de dinero: desde aquí se compara */
  desde: string;
  /** Lo que has puesto de tu bolsillo, menos lo que has sacado */
  aportadoNeto: number;
  /** Tu patrimonio hoy */
  tuyo: number;
  /** Lo que tendrías si cada aportación hubiera comprado el índice */
  indice: number;
  /** tuyo − indice: positivo es que lo has hecho mejor */
  diferencia: number;
  tuyoPct: number | null;
  indicePct: number | null;
}

/** Valor del índice en una fecha, o el del día hábil anterior más cercano.
 *  Un ingreso puede caer en sábado; el índice, no. */
function valorEn(serie: PuntoIndice[], fecha: string): number | null {
  let elegido: number | null = null;
  for (const p of serie) {
    if (p.date > fecha) break;
    if (p.value > 0) elegido = p.value;
  }
  // Antes del primer dato de la serie no se puede simular nada.
  return elegido;
}

export function contraIndice(
  operaciones: Operacion[],
  serie: PuntoIndice[],
  patrimonioHoy: number,
): ContraIndice | null {
  if (serie.length < 2) return null;

  const ordenada = [...serie].sort((a, b) => a.date.localeCompare(b.date));
  const ultimo = ordenada[ordenada.length - 1];
  if (!ultimo || ultimo.value <= 0) return null;

  // Sólo el dinero que entra y sale de FUERA. Una compra no es una
  // aportación: es mover a acciones un dinero que ya estaba dentro, y
  // contarla aquí sería aportar dos veces.
  const flujos = operaciones
    .filter((o) => o.type === "deposit" || o.type === "withdrawal")
    .map((o) => ({
      fecha: o.date,
      importe: (o.type === "deposit" ? 1 : -1) * Math.abs(o.total_eur ?? o.total ?? 0),
    }))
    .filter((f) => f.importe !== 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  if (flujos.length === 0) return null;

  let participaciones = 0;
  let aportadoNeto = 0;
  for (const f of flujos) {
    const v = valorEn(ordenada, f.fecha);
    if (v == null) continue; // el índice no llega tan atrás: se ignora ese flujo
    aportadoNeto += f.importe;
    participaciones += f.importe / v;
  }

  // Sacar más de lo que se metió deja participaciones negativas y la
  // comparación deja de significar nada.
  if (participaciones <= 0 || aportadoNeto <= 0) return null;

  const indice = participaciones * ultimo.value;

  return {
    desde: flujos[0].fecha,
    aportadoNeto,
    tuyo: patrimonioHoy,
    indice,
    diferencia: patrimonioHoy - indice,
    tuyoPct: aportadoNeto > 0 ? ((patrimonioHoy - aportadoNeto) / aportadoNeto) * 100 : null,
    indicePct: aportadoNeto > 0 ? ((indice - aportadoNeto) / aportadoNeto) * 100 : null,
  };
}
