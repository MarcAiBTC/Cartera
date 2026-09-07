// ── BUZÓN ────────────────────────────────────────────────────────────────
// Lo que ha llegado desde el móvil y todavía no has importado.
//
// El camino corto en el iPhone es éste: en la app del bróker, «Compartir →
// Enviar a Cartera». El Atajo manda el archivo a `/api/entrada`, que lo deja
// aquí, y la próxima vez que abres la cartera te está esperando. Sin
// descargar, sin buscar en Archivos, sin selector de archivos.
//
// Lo que NO hace: importar solo. El archivo se guarda crudo y pasa por la
// misma vista previa de siempre. Que subir sea fácil no cambia la regla de
// que nada se escribe sin que lo hayas visto.

import { supabase } from "./supabase";

export interface EntradaBuzon {
  id: string;
  filename: string;
  content: string;
  /** `text` para CSV y JSON; `base64` para los Excel */
  encoding: "text" | "base64";
  bytes: number;
  source: string;
  status: "nuevo" | "importado" | "descartado";
  ops: number | null;
  created_at: string;
}

/** Los archivos que esperan. Sin nube no hay buzón: en modo «este
 *  dispositivo» no existe ningún servidor al que mandarle nada, y devolver
 *  una lista vacía deja que la pantalla se dibuje igual sin condicionales. */
export async function cargarBuzon(): Promise<EntradaBuzon[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("inbox")
    .select("*")
    .eq("status", "nuevo")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EntradaBuzon[];
}

/** Deja de estar pendiente y queda anotado cuántas operaciones metió. No se
 *  borra: saber que ese archivo ya entró es justo lo que evita volver a
 *  abrirlo por costumbre dentro de dos semanas. */
export async function marcarImportada(id: string, ops: number): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("inbox")
    .update({ status: "importado", ops, imported_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Para el archivo que se mandó sin querer, o el que ya no hace falta. */
export async function descartar(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("inbox").update({ status: "descartado" }).eq("id", id);
  if (error) throw error;
}

/** Reconstruye el archivo tal y como llegó.
 *
 *  Se devuelve un `File` y no el texto pelado porque el lector de la app ya
 *  sabe qué hacer con un archivo —mira la extensión, decide si toca abrir el
 *  lector de Excel— y repetir esa decisión aquí sería tener dos sitios donde
 *  equivocarse. */
export function comoArchivo(item: EntradaBuzon): File {
  if (item.encoding === "base64") {
    const crudo = atob(item.content);
    const bytes = new Uint8Array(crudo.length);
    for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
    return new File([bytes], item.filename);
  }
  return new File([item.content], item.filename, { type: "text/plain" });
}

// ── La clave de subida ───────────────────────────────────────────────────
// Una credencial aparte de la sesión, con un solo permiso: dejar un archivo
// en el buzón. No lee la cartera ni escribe operaciones, y por eso puede
// vivir dentro de un Atajo del móvil sin que eso quite el sueño.

export interface ClaveSubida {
  token: string;
  created_at: string;
  last_used_at: string | null;
  uses: number;
}

export async function claveSubida(): Promise<ClaveSubida | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("upload_keys")
    .select("token, created_at, last_used_at, uses")
    .maybeSingle();
  if (error) throw error;
  return (data as ClaveSubida) ?? null;
}

/** 128 bits del generador del navegador. Se crea aquí y no en el servidor
 *  porque es la clave de quien la pide y no hay nada que negociar; el `upsert`
 *  sobre `user_id` hace que «cambiar la clave» sea esta misma llamada, y que
 *  la anterior deje de existir en el mismo instante. */
export async function crearClaveSubida(): Promise<ClaveSubida> {
  if (!supabase) throw new Error("Hace falta una cuenta para crear la clave de subida");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  const { data, error } = await supabase
    .from("upload_keys")
    .upsert({ token, uses: 0, last_used_at: null }, { onConflict: "user_id" })
    .select("token, created_at, last_used_at, uses")
    .single();
  if (error) throw error;
  return data as ClaveSubida;
}

/** El enlace entero, que es lo que se copia y se pega en el Atajo. */
export const enlaceSubida = (token: string): string =>
  `${window.location.origin}/api/entrada?k=${token}`;
