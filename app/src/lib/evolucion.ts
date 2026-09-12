// ── EVOLUCIÓN ────────────────────────────────────────────────────────────
// La cartera reconstruida semana a semana desde la primera operación: lo que
// valía y lo que habías puesto. De aquí salen el gráfico «Patrimonio y dinero
// aportado» y la comparación con el S&P 500.
//
// Antes el gráfico dibujaba las «fotos» de la tabla `snapshots`, que no
// guardaba nadie: salía vacío siempre. Y la comparación sólo contaba como
// dinero tuyo los ingresos con fecha, así que los fondos comprados por
// órdenes —sin un ingreso al lado— no contaban, y la cartera parecía rentar
// el doble de lo que renta.
//
// Cómo se reconstruye cada fecha:
//   · Los títulos de cada activo, sumando compras y restando ventas.
//   · Su precio de ESA semana, de la serie de Yahoo (/api/historico). Si no
//     hay serie —un warrant, o sin conexión—, el de su última operación.
//   · El efectivo de cada cuenta, siguiendo el dinero. Una compra que deja la
//     cuenta en negativo es dinero que entró sin apunte —las órdenes de
//     MyInvestor, que no traen el ingreso—, y cuenta como aportado ese día.
//   · El último punto es el de hoy con los precios de ahora: el mismo
//     patrimonio y el mismo aportado que enseña el resumen.

import type { Activo, EstadoCartera, Operacion } from "./tipos";

/** Serie en euros, de la fecha más antigua a la más reciente. */
export type SerieEur = [string, number][];

/** Lo que devuelve /api/historico */
export interface Historico {
  desde: string | null;
  /** Por símbolo y por ISIN, igual que los precios */
  series: Record<string, SerieEur>;
  /** El S&P 500 en euros, día a día */
  sp500: SerieEur;
  /** El símbolo de `sp500`: «SXR8.DE», un ETF de acumulación en euros. Sin
   *  él, la serie es la del respaldo: el índice de precio. */
  indice?: string;
}

export interface PuntoEvolucion {
  fecha: string;
  valor: number;
  aportado: number;
  /** Lo que ha entrado desde el punto anterior (en negativo, lo que salió) */
  flujo: number;
  /** Sólo en el de hoy: lo que salía de las operaciones antes de cambiarlo
   *  por lo que dice el resumen. Si no cuadra, aquí se ve cuánto. */
  reconstruido?: { valor: number; aportado: number };
}

const DIA = 86400e3;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const eurDe = (o: Operacion) => Math.abs(o.total_eur ?? o.total ?? 0);

/** El valor de la serie en esa fecha o, si ese día no hubo cierre, el del
 *  anterior más cercano. Antes del primer dato, nada. */
export function valorEn(serie: SerieEur, fecha: string): number | null {
  let lo = 0;
  let hi = serie.length - 1;
  let r: number | null = null;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (serie[m][0] <= fecha) {
      r = serie[m][1];
      lo = m + 1;
    } else hi = m - 1;
  }
  return r;
}

/** Dentro de un mismo día, primero lo que entra: un ingreso y la compra que
 *  paga, el mismo día, no son dinero salido de la nada. */
const ORDEN: Record<string, number> = {
  deposit: 0,
  dividend: 1,
  interest: 1,
  sell: 2,
  transfer: 3,
  buy: 4,
  fee: 5,
  withdrawal: 6,
};

export function evolucion(
  estado: EstadoCartera,
  historico: Historico | null,
  hoy: { fecha: string; valor: number; aportado: number },
  paso = 7,
): PuntoEvolucion[] {
  const ops = estado.operaciones
    .filter((o) => o.date <= hoy.fecha)
    .sort(
      (a, b) => a.date.localeCompare(b.date) || (ORDEN[a.type] ?? 3) - (ORDEN[b.type] ?? 3),
    );
  if (ops.length === 0) return [];

  const activos = new Map(estado.activos.map((a) => [a.id, a]));

  // El efectivo de una cuenta vive en su activo «Efectivo · bróker». Una
  // cuenta sin él no tiene efectivo en la cartera, y lo que le sobra se da por
  // sacado: es lo que hace el resumen.
  const conEfectivo = new Set<string>();
  const usados = new Set<string>();
  for (const c of estado.cuentas) {
    const a = estado.activos.find(
      (x) =>
        x.cat === "liquidez" &&
        !x.archived &&
        (x.name === `Efectivo · ${c.broker}` || x.name === `Efectivo · ${c.name}`),
    );
    if (a) {
      conEfectivo.add(c.id);
      usados.add(a.id);
    }
  }

  // Lo que está a mano y no sale de operaciones —una cuenta de efectivo
  // suelta, un fondo apuntado a mano— vale lo mismo en todas las fechas: no
  // hay historia que contar de él.
  let fijosValor = 0;
  let fijosCoste = 0;
  for (const a of estado.activos) {
    if (a.archived || a.mode !== "manual" || usados.has(a.id)) continue;
    const q = a.manual_qty ?? 0;
    if (a.cat === "liquidez") {
      fijosValor += q * (a.manual_price ?? 1);
      fijosCoste += q * (a.manual_price ?? 1);
    } else {
      fijosValor += q * (a.manual_price ?? a.manual_cost_unit ?? 0);
      fijosCoste += q * (a.manual_cost_unit ?? 0);
    }
  }

  const cajas = new Map<string, number>();
  const titulos = new Map<string, number>();
  const ultimoPrecio = new Map<string, number>();
  let aportado = 0;

  const aplicar = (o: Operacion) => {
    const k = o.account_id ?? "";
    let caja = cajas.get(k) ?? 0;
    const v = eurDe(o);
    const comision = o.fees ?? 0;
    const a = o.asset_id ? activos.get(o.asset_id) : undefined;
    const q = Math.abs(o.quantity ?? 0);
    // Un activo a mano no se sigue por operaciones: ya está en los fijos.
    const sigue = a != null && a.mode === "operations" && q > 0;

    switch (o.type) {
      case "deposit":
        caja += v;
        aportado += v;
        break;
      case "withdrawal":
        caja -= v;
        aportado -= v;
        break;
      case "buy":
        if (sigue) {
          titulos.set(a.id, (titulos.get(a.id) ?? 0) + q);
          ultimoPrecio.set(a.id, v / q);
        }
        // Un traspaso entre fondos no pasa por la cuenta.
        if (!o.is_internal_transfer) caja -= v + comision;
        break;
      case "sell":
        if (sigue) {
          const r = (titulos.get(a.id) ?? 0) - q;
          titulos.set(a.id, r < 1e-9 ? 0 : r);
          ultimoPrecio.set(a.id, v / q);
        }
        if (!o.is_internal_transfer) caja += v - comision;
        break;
      case "dividend":
      case "interest":
        caja += v;
        break;
      case "fee":
        caja -= v;
        break;
    }

    // Dinero que entró sin apunte: la compra lo demuestra.
    if (caja < -0.005) {
      aportado -= caja;
      caja = 0;
    }
    if (!conEfectivo.has(k) && caja > 0.005) {
      aportado -= caja;
      caja = 0;
    }
    cajas.set(k, caja);
  };

  const serieDe = (a: Activo): SerieEur | undefined =>
    (a.ticker ? historico?.series[a.ticker.toUpperCase()] : undefined) ??
    (a.isin ? historico?.series[a.isin.toUpperCase()] : undefined);
  const series = new Map<string, SerieEur | undefined>();

  const fechas: string[] = [];
  for (let t = Date.parse(ops[0].date); iso(t) < hoy.fecha; t += paso * DIA) fechas.push(iso(t));
  fechas.push(hoy.fecha);

  const puntos: PuntoEvolucion[] = [];
  let i = 0;
  let anterior = 0;
  for (const fecha of fechas) {
    while (i < ops.length && ops[i].date <= fecha) aplicar(ops[i++]);

    let valor = fijosValor;
    for (const c of cajas.values()) valor += c;
    for (const [id, q] of titulos) {
      if (q <= 0) continue;
      if (!series.has(id)) series.set(id, serieDe(activos.get(id)!));
      const s = series.get(id);
      const p = (s ? valorEn(s, fecha) : null) ?? ultimoPrecio.get(id) ?? 0;
      valor += q * p;
    }

    const ap = aportado + fijosCoste;
    puntos.push({ fecha, valor, aportado: ap, flujo: ap - anterior });
    anterior = ap;
  }

  // Hoy, con los precios de ahora: tiene que decir lo mismo que el resumen.
  // La diferencia con lo reconstruido —un saldo tecleado a mano que ningún
  // movimiento explica— entra aquí, en las dos líneas a la vez.
  const previo = puntos.length > 1 ? puntos[puntos.length - 2].aportado : 0;
  const rehecho = puntos[puntos.length - 1];
  puntos[puntos.length - 1] = {
    fecha: hoy.fecha,
    valor: hoy.valor,
    aportado: hoy.aportado,
    flujo: hoy.aportado - previo,
    reconstruido: { valor: rehecho.valor, aportado: rehecho.aportado },
  };
  return puntos;
}

/** Rentabilidad por tiempo, en %: Dietz modificado semana a semana y
 *  encadenado. Mide cuánto rindió cada euro mientras estuvo dentro, sin que
 *  importe cuándo entró, que es lo que la hace comparable con un índice.
 *  Lo que se aporta a mitad de semana cuenta medio periodo. */
export function rentabilidadPorTiempo(puntos: PuntoEvolucion[]): number | null {
  if (puntos.length < 2) return null;
  let factor = 1;
  for (let i = 1; i < puntos.length; i++) {
    const v0 = puntos[i - 1].valor;
    const { valor: v1, flujo } = puntos[i];
    const base = v0 + flujo / 2;
    if (base <= 1) continue;
    const r = (v1 - v0 - flujo) / base;
    if (!isFinite(r) || r <= -1) continue;
    factor *= 1 + r;
  }
  return (factor - 1) * 100;
}

export interface FrenteAlIndice {
  /** Tu primera operación */
  desde: string;
  /** Desde dónde se ha medido el índice: `desde`, salvo que la serie empiece
   *  más tarde */
  desdeIndice: string;
  /** El último dato del índice */
  hasta: string;
  /** Tu rentabilidad por tiempo desde `desde` */
  tuyoPct: number | null;
  /** Lo que ha subido el índice desde `desdeIndice` */
  indicePct: number;
  tuyo: number;
  aportado: number;
  /** Lo que valdría hoy tu dinero si cada euro hubiera comprado índice el
   *  día que lo pusiste */
  indice: number | null;
  diferencia: number | null;
}

export function frenteAlIndice(puntos: PuntoEvolucion[], sp: SerieEur): FrenteAlIndice | null {
  if (puntos.length < 2 || sp.length < 2) return null;
  const desde = puntos[0].fecha;
  const alEmpezar = valorEn(sp, desde);
  const inicio = alEmpezar ?? sp[0][1];
  const [hasta, final] = sp[sp.length - 1];
  if (!(inicio > 0) || !(final > 0)) return null;

  // Cada euro que entra compra índice al precio de su semana; cada euro que
  // sale lo vende.
  let unidades = 0;
  for (const p of puntos) {
    if (Math.abs(p.flujo) < 0.005) continue;
    unidades += p.flujo / (valorEn(sp, p.fecha) ?? sp[0][1]);
  }
  const ultimo = puntos[puntos.length - 1];
  const indice = unidades > 0 ? unidades * final : null;

  return {
    desde,
    desdeIndice: alEmpezar != null ? desde : sp[0][0],
    hasta,
    tuyoPct: rentabilidadPorTiempo(puntos),
    indicePct: (final / inicio - 1) * 100,
    tuyo: ultimo.valor,
    aportado: ultimo.aportado,
    indice,
    diferencia: indice != null ? ultimo.valor - indice : null,
  };
}
