// ── ALMACÉN ──────────────────────────────────────────────────────────────
// Una sola interfaz con dos implementaciones: Supabase y este dispositivo.
// El resto de la app no sabe cuál está usando, y por eso se puede entrar «sin
// cuenta» para probar y migrar después sin tocar ni una pantalla.

import { supabase } from "./supabase";
import type { EstadoCartera } from "./tipos";
import { AJUSTES_POR_DEFECTO, ESTADO_VACIO } from "./tipos";

export type Tabla =
  | "accounts"
  | "assets"
  | "operations"
  | "snapshots"
  | "watchlist"
  | "targets";

/** Qué campo de `EstadoCartera` alimenta cada tabla. */
export const CLAVE_ESTADO: Record<Tabla, keyof EstadoCartera> = {
  accounts: "cuentas",
  assets: "activos",
  operations: "operaciones",
  snapshots: "snapshots",
  watchlist: "seguimiento",
  targets: "objetivos",
};

/** Hasta donde llega un borrado.
 *
 *  Separarlos importa: quien quiere reimportar sus extractos desde cero no
 *  quiere perder tambien sus objetivos de reparto y su lista de seguimiento,
 *  que le costo montar y que no vienen en ningun extracto. */
export type Alcance = "cartera" | "todo";

/** Lo que se lleva cada alcance. El orden importa: las operaciones antes que
 *  los activos y las cuentas, porque cuelgan de ellos. */
export const TABLAS_ALCANCE: Record<Alcance, Tabla[]> = {
  cartera: ["operations", "assets", "accounts", "snapshots"],
  todo: ["operations", "assets", "accounts", "snapshots", "watchlist", "targets"],
};

export interface Almacen {
  readonly tipo: "nube" | "local";
  cargar(): Promise<EstadoCartera>;
  insertar<T extends { id: string }>(tabla: Tabla, filas: Partial<T>[]): Promise<T[]>;
  actualizar<T extends { id: string }>(tabla: Tabla, id: string, cambios: Partial<T>): Promise<T>;
  borrar(tabla: Tabla, id: string): Promise<void>;
  /** Borra varias filas de golpe. Una llamada por fila tarda una eternidad
   *  con doscientos movimientos, y deja la cartera a medio borrar si falla
   *  por el camino. */
  borrarVarios(tabla: Tabla, ids: string[]): Promise<void>;
  /** Vacia las tablas que se le digan. `alcance` decide hasta donde llega:
   *  «cartera» se lleva lo que has invertido; «todo» tambien lo que has
   *  configurado. No hay vuelta atras, asi que quien llame a esto tiene que
   *  haber preguntado antes. */
  vaciar(alcance: Alcance): Promise<void>;
  guardarCashflow(data: Record<string, unknown>): Promise<void>;
  guardarAjustes(data: Partial<EstadoCartera["ajustes"]>): Promise<void>;
}

const nuevoId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);

// ════════════════════════════════════════════════════════════════════════
//  Supabase
// ════════════════════════════════════════════════════════════════════════

class AlmacenNube implements Almacen {
  readonly tipo = "nube" as const;

  async cargar(): Promise<EstadoCartera> {
    const sb = supabase!;
    // Una sola tanda en paralelo: son seis consultas cortas y esperar a la
    // anterior para lanzar la siguiente multiplicaría por seis la latencia.
    const [cuentas, activos, operaciones, snapshots, seguimiento, objetivos, cf, aj] =
      await Promise.all([
        sb.from("accounts").select("*").order("broker"),
        sb.from("assets").select("*").order("name"),
        sb.from("operations").select("*").order("date", { ascending: false }),
        sb.from("snapshots").select("*").order("date"),
        sb.from("watchlist").select("*").order("ticker"),
        sb.from("targets").select("*"),
        sb.from("cashflow").select("data").maybeSingle(),
        sb.from("settings").select("*").maybeSingle(),
      ]);

    const error = [cuentas, activos, operaciones, snapshots, seguimiento, objetivos].find(
      (r) => r.error,
    )?.error;
    if (error) throw error;

    return {
      cuentas: cuentas.data ?? [],
      activos: activos.data ?? [],
      operaciones: operaciones.data ?? [],
      snapshots: snapshots.data ?? [],
      seguimiento: seguimiento.data ?? [],
      objetivos: objetivos.data ?? [],
      cashflow: (cf.data?.data as Record<string, unknown>) ?? {},
      ajustes: { ...AJUSTES_POR_DEFECTO, ...(aj.data ?? {}) },
    };
  }

  // Los tipos generados de Supabase esperan la fila completa; aquí se envían
  // sólo los campos que el usuario ha tocado y el resto lo pone la base con
  // sus valores por defecto (id, user_id, marcas de tiempo). El `as never` es
  // para eso y sólo para eso: la validación de lo que se manda la hace el
  // esquema, que es quien puede hacerla de verdad.
  async insertar<T extends { id: string }>(tabla: Tabla, filas: Partial<T>[]): Promise<T[]> {
    if (filas.length === 0) return [];
    const { data, error } = await supabase!
      .from(tabla)
      .insert(filas as never)
      .select();
    if (error) throw error;
    return (data ?? []) as T[];
  }

  async actualizar<T extends { id: string }>(
    tabla: Tabla,
    id: string,
    cambios: Partial<T>,
  ): Promise<T> {
    const { data, error } = await supabase!
      .from(tabla)
      .update(cambios as never)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as T;
  }

  async borrar(tabla: Tabla, id: string): Promise<void> {
    const { error } = await supabase!.from(tabla).delete().eq("id", id);
    if (error) throw error;
  }

  async borrarVarios(tabla: Tabla, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    // De cien en cien: la lista de ids viaja en la URL y una peticion con
    // doscientos uuid se pasa de largo del limite del servidor.
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await supabase!.from(tabla).delete().in("id", ids.slice(i, i + 100));
      if (error) throw error;
    }
  }

  async vaciar(alcance: Alcance): Promise<void> {
    // La RLS ya limita el borrado a lo tuyo: aunque aqui no haya filtro de
    // usuario, la base solo deja tocar tus filas. El filtro que si hace falta
    // es uno cualquiera, porque PostgREST se niega a borrar sin condicion —y
    // menos mal.
    for (const tabla of TABLAS_ALCANCE[alcance]) {
      const { error } = await supabase!.from(tabla).delete().not("id", "is", null);
      if (error) throw error;
    }
    if (alcance === "todo") {
      // Estas dos tienen una fila por usuario y su clave es el user_id, asi
      // que se borran por separado.
      for (const tabla of ["cashflow", "settings"] as const) {
        const { error } = await supabase!.from(tabla).delete().not("user_id", "is", null);
        if (error) throw error;
      }
    }
  }

  async guardarCashflow(data: Record<string, unknown>): Promise<void> {
    const { error } = await supabase!.from("cashflow").upsert({ data }, { onConflict: "user_id" });
    if (error) throw error;
  }

  async guardarAjustes(data: Partial<EstadoCartera["ajustes"]>): Promise<void> {
    const { error } = await supabase!.from("settings").upsert(data, { onConflict: "user_id" });
    if (error) throw error;
  }
}

// ════════════════════════════════════════════════════════════════════════
//  Este dispositivo
// ════════════════════════════════════════════════════════════════════════

const CLAVE_LOCAL = "cartera:local";

class AlmacenLocal implements Almacen {
  readonly tipo = "local" as const;

  private leer(): EstadoCartera {
    try {
      const crudo = localStorage.getItem(CLAVE_LOCAL);
      if (!crudo) return structuredClone(ESTADO_VACIO);
      const d = JSON.parse(crudo) as Partial<EstadoCartera>;
      // Mezcla con el vacío: un backup de una versión anterior a la que le
      // falte una colección no puede dejar la app sin arrancar.
      return { ...structuredClone(ESTADO_VACIO), ...d };
    } catch {
      return structuredClone(ESTADO_VACIO);
    }
  }

  private escribir(e: EstadoCartera) {
    try {
      localStorage.setItem(CLAVE_LOCAL, JSON.stringify(e));
    } catch {
      // Cuota llena o almacenamiento bloqueado. Se avisa arriba, aquí no se
      // puede hacer más que no romper la interacción en curso.
      console.warn("[cartera] no se ha podido guardar en este dispositivo");
    }
  }

  async cargar(): Promise<EstadoCartera> {
    return this.leer();
  }

  async insertar<T extends { id: string }>(tabla: Tabla, filas: Partial<T>[]): Promise<T[]> {
    const e = this.leer();
    const clave = CLAVE_ESTADO[tabla];
    const lista = e[clave] as unknown as T[];
    const nuevas = filas.map((f) => ({ ...f, id: f.id ?? nuevoId() }) as T);
    (e[clave] as unknown as T[]) = [...nuevas, ...lista];
    this.escribir(e);
    return nuevas;
  }

  async actualizar<T extends { id: string }>(
    tabla: Tabla,
    id: string,
    cambios: Partial<T>,
  ): Promise<T> {
    const e = this.leer();
    const clave = CLAVE_ESTADO[tabla];
    const lista = e[clave] as unknown as T[];
    const i = lista.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`No existe ${tabla}/${id}`);
    lista[i] = { ...lista[i], ...cambios };
    this.escribir(e);
    return lista[i];
  }

  async borrar(tabla: Tabla, id: string): Promise<void> {
    const e = this.leer();
    const clave = CLAVE_ESTADO[tabla];
    const lista = e[clave] as unknown as { id: string }[];
    (e[clave] as unknown as { id: string }[]) = lista.filter((x) => x.id !== id);
    this.escribir(e);
  }

  async borrarVarios(tabla: Tabla, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const fuera = new Set(ids);
    const e = this.leer();
    const clave = CLAVE_ESTADO[tabla];
    const lista = e[clave] as unknown as { id: string }[];
    (e[clave] as unknown as { id: string }[]) = lista.filter((x) => !fuera.has(x.id));
    this.escribir(e);
  }

  async vaciar(alcance: Alcance): Promise<void> {
    const e = this.leer();
    for (const tabla of TABLAS_ALCANCE[alcance]) {
      (e[CLAVE_ESTADO[tabla]] as unknown as unknown[]) = [];
    }
    if (alcance === "todo") {
      e.cashflow = {};
      e.ajustes = { ...AJUSTES_POR_DEFECTO };
    }
    this.escribir(e);
  }

  async guardarCashflow(data: Record<string, unknown>): Promise<void> {
    const e = this.leer();
    e.cashflow = data;
    this.escribir(e);
  }

  async guardarAjustes(data: Partial<EstadoCartera["ajustes"]>): Promise<void> {
    const e = this.leer();
    e.ajustes = { ...e.ajustes, ...data };
    this.escribir(e);
  }
}

export const almacenNube = (): Almacen => new AlmacenNube();
export const almacenLocal = (): Almacen => new AlmacenLocal();
