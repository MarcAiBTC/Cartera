// ── ACCESO ───────────────────────────────────────────────────────────────
// La pantalla que hace que la cartera deje de vivir en un solo navegador.
// Estructura tomada de Fintrack: saludo enorme arriba, el formulario abajo al
// alcance del pulgar, y la salida sin cuenta al final del todo — visible, pero
// claramente la última opción.

import { useState } from "react";
import { useSesion } from "../lib/sesion";
import { Aviso, Boton, Campo } from "../components/base";

type Modo = "entrar" | "registrar" | "recuperar";

const TITULO: Record<Modo, [string, string]> = {
  entrar: ["Hola de", "nuevo."],
  registrar: ["Empieza", "aquí."],
  recuperar: ["¿Se te ha", "olvidado?"],
};

const SUBTITULO: Record<Modo, string> = {
  entrar: "Entra para gestionar tu cartera.",
  registrar: "Crea tu cuenta y ten la cartera en todos tus dispositivos.",
  recuperar: "Te mandamos un correo para elegir una contraseña nueva.",
};

export default function Acceso() {
  const sesion = useSesion();
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const [t1, t2] = TITULO[modo];

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setEnviando(true);
    try {
      if (modo === "entrar") {
        await sesion.entrar(email.trim(), clave);
      } else if (modo === "registrar") {
        await sesion.registrar(email.trim(), clave);
        setAviso("Cuenta creada. Revisa el correo para confirmarla y ya puedes entrar.");
        setModo("entrar");
      } else {
        await sesion.recuperar(email.trim());
        setAviso("Si ese correo tiene cuenta, ya está enviado el enlace.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido completar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-between px-6 pt-14 pb-8">
      <div>
        <p className="lbl mb-4">Cartera</p>
        <h1 className="hero-num text-fg0">
          {t1}
          <br />
          {t2}
        </h1>
        <p className="mt-4 text-[13px] text-fg2">{SUBTITULO[modo]}</p>
      </div>

      <div className="mt-10">
        {!sesion.hayNube ? (
          <Aviso tono="alerta">
            Este despliegue no tiene configurado Supabase, así que sólo se puede trabajar en este
            dispositivo. Añade <code className="font-mono">VITE_SUPABASE_URL</code> y{" "}
            <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> en Vercel para poder entrar
            con cuenta.
          </Aviso>
        ) : (
          <>
            <button
              onClick={() => void sesion.conGoogle()}
              className="flex w-full items-center justify-center gap-2.5 rounded-field border border-line2 bg-bg1 py-3 text-[14px] font-bold text-fg0 transition-colors hover:border-line3"
            >
              <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
                <path fill="#4285F4" d="M45 24c0-1.6-.1-2.7-.4-3.9H24v7.1h12c-.2 1.9-1.5 4.7-4.3 6.6l6.6 5.1C42.2 35.2 45 30.1 45 24z" />
                <path fill="#34A853" d="M24 46c5.8 0 10.6-1.9 14.2-5.2l-6.8-5.2c-1.8 1.3-4.3 2.2-7.4 2.2-5.6 0-10.4-3.7-12.1-8.9l-7 5.4C8.5 41.1 15.7 46 24 46z" />
                <path fill="#FBBC05" d="M11.9 28.9c-.4-1.3-.7-2.6-.7-3.9s.2-2.7.7-3.9l-7-5.4C3.7 18.4 3 21.1 3 24s.7 5.6 1.9 8.3l7-5.4z" />
                <path fill="#EA4335" d="M24 10.6c3.2 0 5.3 1.4 6.6 2.5l5.9-5.7C32.9 4 29.2 2 24 2 15.7 2 8.5 6.9 4.9 15.7l7 5.4c1.7-5.2 6.5-8.9 12.1-8.9z" />
              </svg>
              Continuar con Google
            </button>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-line2" />
              <span className="h-1 w-1 rounded-full bg-line3" />
              <span className="h-px flex-1 bg-line2" />
            </div>

            <form onSubmit={enviar} className="flex flex-col gap-3">
              <Campo
                etiqueta="Correo electrónico"
                tipo="email"
                valor={email}
                onChange={setEmail}
                placeholder="tucorreo@ejemplo.com"
              />
              {modo !== "recuperar" && (
                <Campo
                  etiqueta="Contraseña"
                  tipo="password"
                  valor={clave}
                  onChange={setClave}
                  placeholder="Al menos 6 caracteres"
                />
              )}

              {error && <Aviso tono="error">{error}</Aviso>}
              {aviso && <Aviso>{aviso}</Aviso>}

              <Boton submit tipo="principal" disabled={enviando || !email} className="mt-1 w-full py-3">
                {enviando
                  ? "Un momento…"
                  : modo === "entrar"
                    ? "Entrar"
                    : modo === "registrar"
                      ? "Crear cuenta"
                      : "Enviar el enlace"}
              </Boton>
            </form>

            <div className="mt-4 flex flex-col items-center gap-2 text-[12px]">
              {modo === "entrar" && (
                <>
                  <button onClick={() => setModo("recuperar")} className="text-fg2 hover:text-fg0">
                    ¿Has olvidado la contraseña?
                  </button>
                  <button onClick={() => setModo("registrar")} className="font-semibold text-fg1 hover:text-fg0">
                    ¿No tienes cuenta? Regístrate
                  </button>
                </>
              )}
              {modo !== "entrar" && (
                <button onClick={() => setModo("entrar")} className="font-semibold text-fg1 hover:text-fg0">
                  Volver a entrar
                </button>
              )}
            </div>
          </>
        )}

        <div className="mt-6 border-t border-line pt-4 text-center">
          <button
            onClick={sesion.usarLocal}
            className="text-[12px] text-fg2 underline-offset-4 hover:text-fg0 hover:underline"
          >
            Continuar sin cuenta (sólo en este dispositivo)
          </button>
        </div>
      </div>
    </div>
  );
}
