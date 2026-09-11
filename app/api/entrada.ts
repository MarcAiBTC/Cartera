// ── BUZÓN DE ENTRADA ─────────────────────────────────────────────────────
// Recibe un archivo de bróker y lo deja esperando en la cartera. La usa el
// Atajo de iOS que aparece en la hoja de compartir: dentro de la app de Trade
// Republic, «Compartir → Enviar a Cartera», y el CSV llega aquí sin pasar por
// Archivos, ni por Safari, ni por el selector de archivos.
//
//   POST /api/entrada?k=CLAVE      multipart (campo «archivo») o cuerpo crudo
//   GET  /api/entrada?k=CLAVE      cuántos archivos hay esperando (para probar
//                                  el enlace desde el navegador)
//
// La clave NO es la sesión del usuario. Es una credencial aparte, de un solo
// permiso: dejar un archivo en el buzón. Con ella no se lee la cartera, no se
// escriben operaciones y no se borra nada. Es lo que permite que viaje dentro
// de un Atajo del móvil sin que eso sea un problema — y lo que hace que
// cambiarla, si alguna vez hiciera falta, salga gratis.
//
// Y no importa nada por su cuenta: el archivo se guarda CRUDO y la app sigue
// enseñando la vista previa antes de escribir. Que subir sea fácil no es
// excusa para que la cartera se llene de operaciones que nadie ha mirado.

import { clienteServicio, respuesta } from "./_lib/supabase.js";

export const config = { maxDuration: 30 };

/** Un extracto de diez años de Trade Republic no llega a 500 KB. Cuatro megas
 *  dejan sitio de sobra para un Excel de Revolut y siguen impidiendo que
 *  alguien use el buzón como disco duro. */
const TOPE_BYTES = 4 * 1024 * 1024;

/** Archivos sin importar antes de decir que ya está bien. Si hay treinta
 *  esperando es que algo va mal —un Atajo en bucle, casi siempre—, y seguir
 *  aceptando sólo empeora el desorden. */
const TOPE_PENDIENTES = 30;

/** Una clave nuestra son 32 hex. Se comprueba la forma antes de ir a la base:
 *  así una llamada con basura no gasta una consulta. */
const ES_CLAVE = (s: string) => /^[a-f0-9]{32}$/i.test(s);

/** Caracteres de control. No aportan nada a un nombre de archivo y sí ensucian
 *  cualquier sitio donde luego se pinte. */
// oxlint-disable-next-line no-control-regex -- es justo lo que se quiere quitar
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** El nombre sólo se usa para enseñarlo y para elegir el lector por su
 *  extensión, pero llega de fuera: fuera rutas y fuera caracteres de control.
 *
 *  Exportada, igual que `esTexto`, para poder probarlas: son las dos
 *  decisiones de esta ruta que no se ven desde ninguna pantalla, y las dos que
 *  estropean el archivo en silencio cuando se equivocan. */
export function nombreLimpio(n: string | undefined | null): string {
  const base = (n ?? "").split(/[/\\]/).pop() ?? "";
  const limpio = base.replace(CONTROL, "").trim().slice(0, 120);
  return limpio || "extracto.csv";
}

/** ¿Esto es texto o son bytes?
 *
 *  Importa porque un CSV se guarda tal cual y un Excel tiene que ir en base64.
 *  El criterio: un archivo de texto no lleva bytes nulos y decodifica entero
 *  como UTF-8. Un .xlsx es un ZIP y falla las dos pruebas en el primer kilo.
 *
 *  Se mira el archivo COMPLETO y no una cabecera: cortar por un byte fijo
 *  parte un carácter de varios bytes por la mitad, y un CSV con una eñe en el
 *  sitio justo acabaría guardado en base64. */
export function esTexto(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function aBase64(bytes: Uint8Array): string {
  // De 8 KB en 8 KB: `String.fromCharCode(...bytes)` con un archivo de cuatro
  // megas revienta la pila de argumentos.
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(s);
}

/** La clave puede venir en la URL —que es lo cómodo de configurar en el
 *  Atajo— o en la cabecera, para quien prefiera no tenerla en el historial. */
function claveDe(req: Request): string {
  const url = new URL(req.url);
  const enUrl = url.searchParams.get("k") ?? url.searchParams.get("clave") ?? "";
  if (enUrl) return enUrl.trim();
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

// Esta ruta atiende GET y POST, asi que se exportan los dos apuntando al
// mismo sitio. Por nombre de metodo, nunca `export default`: ver la nota en
// _lib/supabase.ts.
export const GET = manejar;
export const POST = manejar;

async function manejar(req: Request): Promise<Response> {
  const clave = claveDe(req);
  if (!ES_CLAVE(clave)) {
    return respuesta({ error: "falta la clave de subida, o no tiene la forma esperada" }, 401);
  }

  let sb;
  try {
    sb = clienteServicio();
  } catch (e) {
    return respuesta({ error: e instanceof Error ? e.message : String(e) }, 500);
  }

  const { data: duenio } = await sb
    .from("upload_keys")
    .select("user_id, uses")
    .eq("token", clave)
    .maybeSingle();

  // El mismo mensaje para «no existe» y para «no vale»: no hay nada que ganar
  // diciéndole a quien prueba claves cuál de las dos cosas ha pasado.
  if (!duenio) return respuesta({ error: "clave de subida desconocida" }, 401);
  const userId = duenio.user_id as string;

  const { count } = await sb
    .from("inbox")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "nuevo");
  const pendientes = count ?? 0;

  // ── Sólo mirar ─────────────────────────────────────────────────────────
  // Abrir el enlace en Safari tiene que decir algo útil: es como se comprueba
  // que el Atajo está bien configurado sin tener que mandar un archivo.
  if (req.method === "GET") {
    return respuesta({
      ok: true,
      mensaje:
        pendientes === 0
          ? "La clave funciona. No hay ningún archivo esperando."
          : `La clave funciona. Hay ${pendientes} ${pendientes === 1 ? "archivo" : "archivos"} esperando en la cartera.`,
      pendientes,
    });
  }

  if (req.method !== "POST") return respuesta({ error: "usa POST" }, 405);

  if (pendientes >= TOPE_PENDIENTES) {
    return respuesta(
      {
        error: `ya hay ${pendientes} archivos esperando sin importar. Abre la cartera, impórtalos o descártalos, y vuelve a mandar éste.`,
      },
      409,
    );
  }

  // ── El archivo ─────────────────────────────────────────────────────────
  // Dos formas de mandarlo, porque los Atajos de iOS hacen las dos según cómo
  // se rellene «Solicitar contenido de URL»: como formulario con un campo de
  // archivo, o como cuerpo crudo. Aceptar sólo una obligaría a explicar cuál,
  // y explicar cuál es exactamente lo que no queremos.
  let nombre = nombreLimpio(new URL(req.url).searchParams.get("nombre"));
  let bytes: Uint8Array;

  const tipo = req.headers.get("content-type") ?? "";
  try {
    if (tipo.includes("multipart/form-data")) {
      const form = await req.formData();
      const parte =
        form.get("archivo") ?? form.get("file") ?? [...form.values()].find((v) => v instanceof File);
      if (!(parte instanceof File)) {
        return respuesta({ error: "el formulario no traía ningún archivo" }, 400);
      }
      nombre = nombreLimpio(parte.name || nombre);
      bytes = new Uint8Array(await parte.arrayBuffer());
    } else {
      bytes = new Uint8Array(await req.arrayBuffer());
    }
  } catch {
    return respuesta({ error: "no se ha podido leer el archivo" }, 400);
  }

  if (bytes.length === 0) return respuesta({ error: "el archivo venía vacío" }, 400);
  if (bytes.length > TOPE_BYTES) {
    return respuesta(
      { error: `el archivo pesa ${Math.round(bytes.length / 1024)} KB y el tope son 4 MB` },
      413,
    );
  }

  const texto = esTexto(bytes);
  const { error } = await sb.from("inbox").insert({
    user_id: userId,
    filename: nombre,
    content: texto ? new TextDecoder().decode(bytes) : aBase64(bytes),
    encoding: texto ? "text" : "base64",
    bytes: bytes.length,
    source: "atajo",
  });
  if (error) return respuesta({ error: error.message }, 500);

  // Contar los usos no es telemetría: es lo que deja ver en Ajustes si el
  // Atajo llegó a funcionar alguna vez, que es la primera pregunta cuando
  // alguien dice «lo he compartido y no aparece».
  await sb
    .from("upload_keys")
    .update({
      last_used_at: new Date().toISOString(),
      uses: (typeof duenio.uses === "number" ? duenio.uses : 0) + 1,
    })
    .eq("token", clave);

  return respuesta({
    ok: true,
    // Los Atajos enseñan este texto en la notificación, así que tiene que
    // leerse solo y decir qué hay que hacer después.
    mensaje: `«${nombre}» está esperando en la cartera. Ábrela para revisarlo e importarlo.`,
    nombre,
    bytes: bytes.length,
  });
}
