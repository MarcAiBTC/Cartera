// ── CÓMO SE ORDENAN LAS POSICIONES ───────────────────────────────────────
// El orden elegido se recuerda en este dispositivo y es el mismo en Inicio y
// en Historial: ordenar por rentabilidad en una pantalla y encontrarse la
// otra por tamaño obligaría a ordenar dos veces.

import { useState } from "react";
import type { OrdenPosiciones } from "./cartera";

export type Vista = "tipo" | "todas";

export interface PrefPosiciones {
  vista: Vista;
  orden: OrdenPosiciones;
  asc: boolean;
}

export const ORDENES: { valor: OrdenPosiciones; texto: string }[] = [
  { valor: "valor", texto: "Tamaño" },
  { valor: "peso", texto: "Peso" },
  { valor: "rentabilidad", texto: "Rentabilidad" },
  { valor: "ganancia", texto: "Ganancia" },
  { valor: "hoy", texto: "Hoy" },
  { valor: "nombre", texto: "Nombre" },
];

const CLAVE = "cartera:posiciones";
const POR_DEFECTO: PrefPosiciones = { vista: "tipo", orden: "valor", asc: false };

// Si no se puede leer —una ventana privada—, la de siempre.
function leer(): PrefPosiciones {
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as Partial<PrefPosiciones> | null;
    if (!p) return POR_DEFECTO;
    return {
      vista: p.vista === "todas" ? "todas" : "tipo",
      orden: ORDENES.find((o) => o.valor === p.orden)?.valor ?? "valor",
      asc: p.asc === true,
    };
  } catch {
    return POR_DEFECTO;
  }
}

export function usePrefPosiciones() {
  const [pref, setEstado] = useState(leer);

  const cambiar = (cambios: Partial<PrefPosiciones>) =>
    setEstado((p) => {
      const n = { ...p, ...cambios };
      try {
        localStorage.setItem(CLAVE, JSON.stringify(n));
      } catch {
        /* sin almacenamiento: se olvida al cerrar, nada más */
      }
      return n;
    });

  // Pulsar el orden que ya está le da la vuelta; uno nuevo empieza por lo
  // más grande, salvo el nombre, que empieza por la A.
  const elegirOrden = (o: OrdenPosiciones) =>
    o === pref.orden ? cambiar({ asc: !pref.asc }) : cambiar({ orden: o, asc: o === "nombre" });

  return { pref, cambiar, elegirOrden };
}
