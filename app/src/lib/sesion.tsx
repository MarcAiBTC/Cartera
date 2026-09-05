// ── SESIÓN ───────────────────────────────────────────────────────────────
// Marc y Leti son dos usuarios de Supabase distintos, no dos sufijos en una
// clave de localStorage: el aislamiento lo hace la base de datos con RLS y no
// depende de que la app se acuerde de poner el sufijo.
//
// Además hay un tercer estado, «sólo en este dispositivo», que es el que
// permite probar la app sin registrarse y el que la mantiene en pie si el
// despliegue se queda sin credenciales.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { hayNube, supabase } from "./supabase";

const CLAVE_LOCAL = "cartera:modo-local";

export interface EstadoSesion {
  cargando: boolean;
  usuario: User | null;
  /** Trabajando sólo en este dispositivo, sin cuenta */
  local: boolean;
  hayNube: boolean;
  /** Hay con qué trabajar: o cuenta, o modo local */
  activa: boolean;
  entrar(email: string, clave: string): Promise<void>;
  registrar(email: string, clave: string): Promise<void>;
  conGoogle(): Promise<void>;
  recuperar(email: string): Promise<void>;
  salir(): Promise<void>;
  usarLocal(): void;
}

const Ctx = createContext<EstadoSesion | null>(null);

/** Traduce los errores de Supabase, que llegan en inglés y con jerga. */
function traduce(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes("invalid login")) return "El correo o la contraseña no son correctos.";
  if (m.includes("email not confirmed")) return "Confirma el correo antes de entrar.";
  if (m.includes("already registered")) return "Ya hay una cuenta con ese correo.";
  if (m.includes("password should be")) return "La contraseña debe tener al menos 6 caracteres.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Demasiados intentos seguidos. Espera un minuto.";
  if (m.includes("network") || m.includes("fetch")) return "Sin conexión con el servidor.";
  return mensaje;
}

/** Todas las llamadas de auth devuelven `{ data, error }`. Aquí sólo importa
 *  el error, y llega traducido para que la pantalla lo enseñe tal cual. */
async function lanza(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p;
  if (error) throw new Error(traduce(error.message));
}

export function ProveedorSesion({ children }: { children: ReactNode }) {
  // Sin credenciales no hay ninguna sesión que esperar: se arranca ya en modo
  // local y sin pantalla de carga. Se decide al construir el estado y no en un
  // efecto, que provocaría un render de más con la app en blanco.
  const [cargando, setCargando] = useState(hayNube);
  const [usuario, setUsuario] = useState<User | null>(null);
  const [local, setLocal] = useState(() => {
    if (!hayNube) return true;
    try {
      return localStorage.getItem(CLAVE_LOCAL) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!hayNube) return;
    let vivo = true;
    supabase!.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      setUsuario(data.session?.user ?? null);
      setCargando(false);
    });
    const { data: sub } = supabase!.auth.onAuthStateChange((_e, s: Session | null) => {
      setUsuario(s?.user ?? null);
    });
    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const usarLocal = useCallback(() => {
    try {
      localStorage.setItem(CLAVE_LOCAL, "1");
    } catch {
      /* almacenamiento bloqueado: el modo local dura lo que la pestaña */
    }
    setLocal(true);
  }, []);

  const valor = useMemo<EstadoSesion>(
    () => ({
      cargando,
      usuario,
      local,
      hayNube,
      activa: Boolean(usuario) || local,
      usarLocal,
      async entrar(email, clave) {
        await lanza(supabase!.auth.signInWithPassword({ email, password: clave }));
      },
      async registrar(email, clave) {
        await lanza(
          supabase!.auth.signUp({
            email,
            password: clave,
            options: { emailRedirectTo: window.location.origin },
          }),
        );
      },
      async conGoogle() {
        await lanza(
          supabase!.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: window.location.origin },
          }),
        );
      },
      async recuperar(email) {
        await lanza(
          supabase!.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
        );
      },
      async salir() {
        try {
          localStorage.removeItem(CLAVE_LOCAL);
        } catch {
          /* nada que limpiar */
        }
        setLocal(false);
        if (hayNube) await supabase!.auth.signOut();
      },
    }),
    [cargando, usuario, local, usarLocal],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSesion(): EstadoSesion {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSesion fuera de ProveedorSesion");
  return c;
}
