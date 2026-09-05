// ── SUPABASE DESDE EL SERVIDOR ───────────────────────────────────────────
// Con la clave de servicio, que salta la RLS y por eso NO puede salir nunca
// del servidor. Vive en las variables de entorno de Vercel y no lleva el
// prefijo VITE_, que es justo lo que impide que acabe en el paquete del
// navegador.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function clienteServicio(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) {
    throw new Error(
      "Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en las variables de entorno",
    );
  }
  return createClient(url, clave, { auth: { persistSession: false } });
}

/** Sólo Vercel Cron —o alguien con el secreto— puede disparar estas rutas.
 *
 *  Sin esto, cualquiera podría llamarlas en bucle: no expondría datos, pero
 *  gastaría la cuota de Yahoo y de CoinGecko hasta que nos bloquearan la IP. */
export function autorizada(req: Request): boolean {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return true; // sin secreto configurado, se deja pasar en local
  return req.headers.get("authorization") === `Bearer ${secreto}`;
}

export const respuesta = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo, null, 2), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
