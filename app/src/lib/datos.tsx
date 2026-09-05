// ── DATOS ────────────────────────────────────────────────────────────────
// Un único sitio donde vive la cartera cargada, y un único sitio donde se
// escribe. Las pantallas leen de aquí y llaman a estas acciones; ninguna
// habla con Supabase por su cuenta.
//
// El estado se recalcula entero en cada cambio en vez de parchear a mano las
// cifras derivadas: son unos cientos de operaciones, el coste es despreciable
// y así es imposible que una pantalla enseñe un total que ya no corresponde a
// las posiciones de al lado.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { almacenLocal, almacenNube, CLAVE_ESTADO, type Almacen, type Tabla } from "./almacen";
import { cargarMercado, MERCADO_VACIO, type DatosMercado } from "./precios";
import { useSesion } from "./sesion";
import { hoyISO } from "./formato";
import {
  calcularFifo,
  calcularPosiciones,
  calcularResumen,
  porCategoria,
  type Grupo,
  type Posicion,
  type Realizada,
  type Resumen,
} from "./cartera";
import type { Ajustes, EstadoCartera } from "./tipos";
import { ESTADO_VACIO } from "./tipos";

export interface EstadoDatos {
  cargando: boolean;
  error: string | null;
  estado: EstadoCartera;
  mercado: DatosMercado;
  posiciones: Posicion[];
  realizadas: Realizada[];
  resumen: Resumen;
  categorias: Grupo[];
  almacen: Almacen;
  recargar(): Promise<void>;
  refrescarPrecios(): Promise<void>;
  insertar<T extends { id: string }>(tabla: Tabla, filas: Partial<T>[]): Promise<T[]>;
  actualizar<T extends { id: string }>(tabla: Tabla, id: string, cambios: Partial<T>): Promise<T>;
  borrar(tabla: Tabla, id: string): Promise<void>;
  guardarCashflow(data: Record<string, unknown>): Promise<void>;
  guardarAjustes(cambios: Partial<Ajustes>): Promise<void>;
}

const Ctx = createContext<EstadoDatos | null>(null);

/** Cada cuánto se vuelven a pedir los precios con la pestaña abierta. El cron
 *  escribe cada 15 minutos; pedirlos más a menudo sólo gasta batería. */
const REFRESCO_MS = 5 * 60 * 1000;

export function ProveedorDatos({ children }: { children: ReactNode }) {
  const sesion = useSesion();
  const [estado, setEstado] = useState<EstadoCartera>(ESTADO_VACIO);
  const [mercado, setMercado] = useState<DatosMercado>(MERCADO_VACIO);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Con cuenta se va a Supabase; sin ella, a este dispositivo.
  const almacen = useMemo<Almacen>(
    () => (sesion.usuario ? almacenNube() : almacenLocal()),
    [sesion.usuario],
  );

  // Las acciones dependen del almacén en vez de leerlo de una ref durante el
  // render: al entrar o salir de la cuenta cambian de identidad, que es
  // exactamente lo que se quiere — una escritura pendiente no puede acabar en
  // el almacén de la sesión anterior.
  const recargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setEstado(await almacen.cargar());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar los datos");
    } finally {
      setCargando(false);
    }
  }, [almacen]);

  const refrescarPrecios = useCallback(async () => {
    try {
      setMercado(await cargarMercado());
    } catch (e) {
      console.warn("[precios] fallo al refrescar", e);
    }
  }, []);

  useEffect(() => {
    if (!sesion.activa) {
      setEstado(ESTADO_VACIO);
      setCargando(false);
      return;
    }
    void recargar();
  }, [sesion.activa, sesion.usuario, recargar]);

  useEffect(() => {
    void refrescarPrecios();
    const t = setInterval(() => void refrescarPrecios(), REFRESCO_MS);
    // Al volver a la pestaña, los precios pueden llevar horas parados.
    const alVolver = () => {
      if (document.visibilityState === "visible") void refrescarPrecios();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [refrescarPrecios]);

  // ── Escrituras ─────────────────────────────────────────────────────────
  // Se escribe primero y se refleja después con lo que devuelve el almacén:
  // así la fila lleva el id y las marcas de tiempo de verdad, no unas
  // inventadas que luego habría que reconciliar.

  const insertar = useCallback(async function <T extends { id: string }>(
    tabla: Tabla,
    filas: Partial<T>[],
  ): Promise<T[]> {
    const nuevas = await almacen.insertar<T>(tabla, filas);
    setEstado((e) => {
      const clave = CLAVE_ESTADO[tabla];
      return { ...e, [clave]: [...nuevas, ...(e[clave] as unknown as T[])] } as EstadoCartera;
    });
    return nuevas;
  }, [almacen]);

  const actualizar = useCallback(async function <T extends { id: string }>(
    tabla: Tabla,
    id: string,
    cambios: Partial<T>,
  ): Promise<T> {
    const fila = await almacen.actualizar<T>(tabla, id, cambios);
    setEstado((e) => {
      const clave = CLAVE_ESTADO[tabla];
      const lista = (e[clave] as unknown as T[]).map((x) => (x.id === id ? fila : x));
      return { ...e, [clave]: lista } as EstadoCartera;
    });
    return fila;
  }, [almacen]);

  const borrar = useCallback(async (tabla: Tabla, id: string) => {
    await almacen.borrar(tabla, id);
    setEstado((e) => {
      const clave = CLAVE_ESTADO[tabla];
      const lista = (e[clave] as unknown as { id: string }[]).filter((x) => x.id !== id);
      return { ...e, [clave]: lista } as EstadoCartera;
    });
  }, [almacen]);

  const guardarCashflow = useCallback(async (data: Record<string, unknown>) => {
    await almacen.guardarCashflow(data);
    setEstado((e) => ({ ...e, cashflow: data }));
  }, [almacen]);

  const guardarAjustes = useCallback(async (cambios: Partial<Ajustes>) => {
    await almacen.guardarAjustes(cambios);
    setEstado((e) => ({ ...e, ajustes: { ...e.ajustes, ...cambios } }));
  }, [almacen]);

  // ── Derivados ──────────────────────────────────────────────────────────

  const derivado = useMemo(() => {
    const posiciones = calcularPosiciones(estado, mercado.precios, mercado.fx);
    const { realizadas } = calcularFifo(estado.operaciones);
    const resumen = calcularResumen(posiciones, estado.operaciones, realizadas, hoyISO());
    return { posiciones, realizadas, resumen, categorias: porCategoria(posiciones) };
  }, [estado, mercado]);

  const valor = useMemo<EstadoDatos>(
    () => ({
      cargando,
      error,
      estado,
      mercado,
      almacen,
      recargar,
      refrescarPrecios,
      insertar,
      actualizar,
      borrar,
      guardarCashflow,
      guardarAjustes,
      ...derivado,
    }),
    [
      cargando,
      error,
      estado,
      mercado,
      almacen,
      recargar,
      refrescarPrecios,
      insertar,
      actualizar,
      borrar,
      guardarCashflow,
      guardarAjustes,
      derivado,
    ],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useDatos(): EstadoDatos {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDatos fuera de ProveedorDatos");
  return c;
}

