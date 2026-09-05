import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Si el despliegue no trae credenciales, la app arranca igual y trabaja sólo
 *  en este dispositivo. Es lo que permite probarla antes de crear el proyecto
 *  de Supabase, y lo que hace que un fallo de configuración no deje una
 *  pantalla en blanco. */
export const hayNube = Boolean(url && anon);

export const supabase: SupabaseClient | null = hayNube
  ? createClient(url!, anon!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
