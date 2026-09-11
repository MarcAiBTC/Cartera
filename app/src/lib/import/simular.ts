// ── LA CARTERA QUE SALDRÍA ───────────────────────────────────────────────
// Aplica un plan de importación EN MEMORIA, sin tocar la base de datos: lo
// mismo que hace `confirmar()` en la pantalla Importar, pero sobre una copia.
//
// Sirve para contestar ANTES de guardar la única pregunta que importa —«¿cuadra
// con lo que dice el banco?»— y lo usan las dos puntas: la pantalla, para
// enseñar cómo queda la cuenta y su total, y `scripts/simular-import.mjs`.
// Tenerlo en un solo sitio es lo que impide que las dos acaben contando
// distinto: si esto y `confirmar()` no hacen lo mismo, la vista previa miente.

import type { Activo, Cuenta, EstadoCartera, Operacion } from "../tipos";
import type { Plan } from "./index";

export interface Simulacion {
  estado: EstadoCartera;
  /** Los activos de la cuenta que se importa: los de sus operaciones, los de
   *  las posiciones del extracto, su efectivo y lo añadido a mano. Es lo que
   *  hay que sumar para comparar con el total que da el banco. */
  delBroker: Set<string>;
  /** La cuenta a la que va todo, o «cuenta-nueva» si la crea la importación */
  cuentaId: string;
}

export function simular(plan: Plan, estado: EstadoCartera, cuentaElegida?: string): Simulacion {
  const despues = structuredClone(estado);
  const cuentaId =
    cuentaElegida ||
    estado.cuentas.find((c) => c.broker === plan.lectura.broker)?.id ||
    "cuenta-nueva";
  if (!despues.cuentas.some((c) => c.id === cuentaId) && plan.cuentaNueva) {
    despues.cuentas.push({ id: cuentaId, ...plan.cuentaNueva } as Cuenta);
  }
  const buscar = (id: string) => despues.activos.find((a) => a.id === id);
  const delBroker = new Set<string>();

  // ── Los activos que crean las operaciones ────────────────────────────
  const porClave = new Map<string, string>();
  let n = 0;
  for (const a of plan.activosNuevos) {
    const id = `nuevo-${++n}`;
    despues.activos.push({ id, archived: false, underlying: null, ...a } as Activo);
    for (const k of [a.isin, a.ticker, a.name]) if (k) porClave.set(k.toUpperCase(), id);
  }
  // Un ETC encontrado en el catálogo por su nombre se llama como allí, y sus
  // compras llegan con el nombre cortado del archivo. Igual que `confirmar()`.
  for (const { clave, activo } of plan.porCrear) {
    const id = [activo.isin, activo.ticker, activo.name]
      .map((k) => (k ? porClave.get(k.toUpperCase()) : undefined))
      .find(Boolean);
    if (id && !porClave.has(clave)) porClave.set(clave, id);
  }
  // El mismo fondo con dos nombres se ha creado una vez: las compras del otro
  // nombre no encontrarían su clave si no se les enseña el camino.
  for (const [de, a] of Object.entries(plan.mismos)) {
    const id = porClave.get(a);
    if (id) porClave.set(de, id);
  }

  // ── Las posiciones del extracto ──────────────────────────────────────
  // Van antes que las operaciones, igual que en la pantalla: son las que fijan
  // a qué activo caen las compras.
  const redirigir = new Map<string, string>();
  for (const p of plan.posiciones) {
    if (p.aldia) {
      if (p.activo) {
        for (const k of p.claves) porClave.set(k, p.activo.id);
        delBroker.add(p.activo.id);
      }
      continue;
    }
    let id: string;
    if (p.activo) {
      Object.assign(buscar(p.activo.id)!, p.campos);
      id = p.activo.id;
    } else {
      id = `posicion-${p.posicion.isin}`;
      despues.activos.push({ id, archived: false, ...p.campos } as Activo);
    }
    delBroker.add(id);
    for (const k of p.claves) porClave.set(k, id);
    for (const o of p.reasignar) {
      const x = despues.operaciones.find((y) => y.id === o.id);
      if (x) x.asset_id = id;
    }
    for (const a of p.absorbidos) {
      redirigir.set(a.id, id);
      const x = buscar(a.id);
      if (x) x.archived = true;
    }
  }

  // ── Lo que ya estaba y se arregla ────────────────────────────────────
  for (const r of plan.renombrar) {
    const x = buscar(r.activo.id);
    if (x) Object.assign(x, r.campos);
  }
  for (const p of plan.corregidas) {
    const x = despues.operaciones.find((o) => o.id === p.corrige!.id);
    if (x) Object.assign(x, p.cambios, { account_id: x.account_id ?? cuentaId });
  }

  // ── Las operaciones nuevas ───────────────────────────────────────────
  let m = 0;
  for (const p of plan.nuevas) {
    const clave = (p.fila.isin || p.fila.ticker || p.fila.nombre || "").toUpperCase();
    const suyo = p.activo ? (redirigir.get(p.activo.id) ?? p.activo.id) : undefined;
    despues.operaciones.push({
      ...p.operacion,
      id: `op-${++m}`,
      account_id: cuentaId,
      asset_id: porClave.get(clave) ?? suyo ?? null,
    } as Operacion);
  }

  // ── Lo añadido a mano ────────────────────────────────────────────────
  n = 0;
  for (const a of plan.extras) {
    const id = `extra-${++n}`;
    despues.activos.push({ id, archived: false, ...a } as Activo);
    delBroker.add(id);
  }

  // ── El efectivo ──────────────────────────────────────────────────────
  if (plan.efectivo) {
    const campos: Partial<Activo> = {
      name: plan.efectivo.activo.name,
      cat: "liquidez",
      currency: "EUR",
      unit: "€",
      mode: "manual",
      manual_qty: plan.efectivo.saldo,
      manual_cost_unit: 1,
      manual_price: 1,
    };
    const existe = plan.efectivo.existente ? buscar(plan.efectivo.existente.id) : undefined;
    if (existe) {
      Object.assign(existe, campos);
      delBroker.add(existe.id);
    } else {
      despues.activos.push({
        id: "efectivo",
        archived: false,
        isin: null,
        ticker: null,
        underlying: null,
        ...campos,
      } as Activo);
      delBroker.add("efectivo");
    }
  } else if (plan.liquidez?.existente) {
    // Nadie ha tocado el saldo: el que ya había sigue contando en el total.
    delBroker.add(plan.liquidez.existente.id);
  }

  for (const o of despues.operaciones) {
    if (o.account_id === cuentaId && o.asset_id) delBroker.add(o.asset_id);
  }
  return { estado: despues, delBroker, cuentaId };
}
