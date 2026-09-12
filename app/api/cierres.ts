// ── LOS CIERRES DE UNOS SÍMBOLOS, DÍA A DÍA ──────────────────────────────
// Para lo que un extracto no trae y el precio de ese día sí sabe: los títulos
// de una compra de ETC en MyInvestor, cuyo concepto viene cortado a 30
// caracteres y sin participaciones, y los euros de una compra de oro en
// Revolut, que sólo dice las onzas.
//
//   POST /api/cierres    Authorization: Bearer <token de la sesión>
//   { "simbolos": ["FBTC.L", "GC=F"], "desde": "2024-03-01" }
//   → { "series": { "FBTC.L": [["2024-02-26", 12.34], …] }, "fallos": [] }
//
// Con cuenta y nada más: es Yahoo a cuenta nuestra, y sin sesión cualquiera
// podría usarlo de pasarela.

import { clienteServicio, respuesta } from "./_lib/supabase.js";
import { cierresDe } from "./_lib/series.js";

export const config = { maxDuration: 60 };

/** Símbolos como mucho por llamada: una importación trae unos pocos. */
const TOPE = 30;

// Por nombre de método, nunca `export default`: ver la nota en _lib/supabase.ts.
export async function POST(req: Request): Promise<Response> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return respuesta({ error: "Hace falta entrar con tu cuenta" }, 401);

  const sb = clienteServicio();
  const { data: quien, error: sinSesion } = await sb.auth.getUser(token);
  if (sinSesion || !quien.user) {
    return respuesta({ error: "La sesión ha caducado: vuelve a entrar" }, 401);
  }

  let cuerpo: { simbolos?: unknown; desde?: unknown };
  try {
    cuerpo = (await req.json()) as typeof cuerpo;
  } catch {
    return respuesta({ error: "Hace falta un JSON con «simbolos» y «desde»" }, 400);
  }
  const simbolos = Array.isArray(cuerpo.simbolos)
    ? [
        ...new Set(
          cuerpo.simbolos
            .filter((s): s is string => typeof s === "string" && s.trim().length > 0 && s.length < 40)
            .map((s) => s.trim().toUpperCase()),
        ),
      ].slice(0, TOPE)
    : [];
  const desde =
    typeof cuerpo.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.desde)
      ? cuerpo.desde
      : null;
  if (simbolos.length === 0 || !desde) {
    return respuesta({ error: "Faltan los símbolos o la fecha" }, 400);
  }

  const r = await cierresDe(sb, simbolos, desde);
  return new Response(JSON.stringify(r), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
