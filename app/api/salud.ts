// ── ¿ESTÁ VIVO EL SERVIDOR? ──────────────────────────────────────────────
// Existe por una tarde entera perdida: las cinco rutas de /api contestaban
// «FUNCTION_INVOCATION_FAILED», que es Vercel diciendo «algo ha petado» y
// nada más. Sin poder ver los logs no había manera de saber si faltaba una
// variable de entorno, si el runtime no entendía las funciones o si el
// despliegue era viejo. Y mientras tanto no había precios, ni traducción de
// ISIN, ni buzón: los tres cuelgan de aquí.
//
//   GET /api/salud
//
// A propósito NO importa nada. Si esta ruta contesta y las demás no, el
// problema son las variables; si tampoco contesta ésta, el problema es el
// despliegue entero y no hay que buscar en otro sitio.
//
// Devuelve si cada variable ESTÁ, nunca lo que vale. Saber que existe
// `SUPABASE_SERVICE_ROLE_KEY` no se lo pone fácil a nadie; enseñarla, sí.

export const config = { maxDuration: 10 };

const hay = (n: string): boolean => Boolean((process.env[n] ?? "").trim());

// `export function GET`, no `export default`: es la diferencia entre que esto
// funcione y que no. Vercel ejecuta un `export default` como handler clásico
// de Node —`(req, res)`— y entonces el `Response` que devolvemos no lo mira
// nadie: la peticion se queda colgada hasta el timeout. Con el nombre del
// metodo, Vercel usa la firma web y todo encaja.
export function GET(req: Request): Response {
  const variables = {
    SUPABASE_URL: hay("SUPABASE_URL"),
    VITE_SUPABASE_URL: hay("VITE_SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: hay("SUPABASE_SERVICE_ROLE_KEY"),
    VITE_SUPABASE_ANON_KEY: hay("VITE_SUPABASE_ANON_KEY"),
    CRON_SECRET: hay("CRON_SECRET"),
  };

  // Lo que de verdad hace falta para que las rutas de cron funcionen.
  const puedeEscribir =
    (variables.SUPABASE_URL || variables.VITE_SUPABASE_URL) &&
    variables.SUPABASE_SERVICE_ROLE_KEY;

  const faltan = Object.entries(variables)
    .filter(([n, v]) => !v && n !== "SUPABASE_URL" && n !== "CRON_SECRET")
    .map(([n]) => n);

  return new Response(
    JSON.stringify(
      {
        ok: true,
        momento: new Date().toISOString(),
        metodo: req.method,
        runtime: typeof process !== "undefined" ? process.version : "desconocido",
        variables,
        puedeEscribir,
        faltan,
        // Sin CRON_SECRET las rutas de cron quedan abiertas a cualquiera:
        // `autorizada()` deja pasar cuando no hay secreto, que es lo cómodo
        // en local y lo que no toca en producción.
        avisoCron: variables.CRON_SECRET
          ? null
          : "CRON_SECRET no está puesto: las rutas de cron aceptan a cualquiera y la GitHub Action no puede autenticarse.",
      },
      null,
      2,
    ),
    { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}
