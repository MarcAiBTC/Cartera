// ── TRADUCIR ISIN A SÍMBOLO ──────────────────────────────────────────────
// La llama la pantalla Importar cuando un archivo trae ISIN que el catálogo
// todavía no conoce. Vive en el servidor porque el buscador de Yahoo no manda
// cabeceras CORS y desde el navegador es inalcanzable.
//
//   GET  /api/isin?isin=US0231351067,ES0140609019
//   POST /api/isin   {"isines": ["US0231351067", …]}
//
// No lleva el secreto de los crons: la usa el navegador de un usuario que ha
// entrado. Lo que sí lleva es un tope de ISIN por llamada, que es lo que
// impide convertirla en un ariete contra Yahoo.

import { clienteServicio, respuesta } from "./_lib/supabase";
import { resolverIsines } from "./_lib/isin";

export const config = { maxDuration: 60 };

/** Un extracto de cinco años trae decenas de valores distintos, pero no
 *  cientos. Con 40 por llamada cabe cualquier archivo real y la pantalla
 *  puede trocear si algún día hiciera falta. */
const TOPE = 40;

export default async function handler(req: Request): Promise<Response> {
  let isines: string[] = [];

  if (req.method === "POST") {
    try {
      const cuerpo = (await req.json()) as { isines?: unknown };
      if (Array.isArray(cuerpo.isines)) isines = cuerpo.isines.map(String);
    } catch {
      return respuesta({ error: "el cuerpo no es JSON" }, 400);
    }
  } else {
    const p = new URL(req.url).searchParams.get("isin") ?? "";
    isines = p.split(",").filter(Boolean);
  }

  if (isines.length === 0) return respuesta({ resultados: [] });
  if (isines.length > TOPE) return respuesta({ error: `máximo ${TOPE} ISIN por llamada` }, 413);

  try {
    const resultados = await resolverIsines(clienteServicio(), isines);
    return respuesta({ resultados });
  } catch (e) {
    return respuesta({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
