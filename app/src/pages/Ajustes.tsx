// ── AJUSTES ──────────────────────────────────────────────────────────────
// Tema, cuenta y datos. La exportación no es un adorno: es la garantía de que
// los datos son tuyos y de que puedes salirte de aquí cuando quieras.

import { useState } from "react";
import { useSesion } from "../lib/sesion";
import { useDatos } from "../lib/datos";
import { hoyISO } from "../lib/formato";
import {
  Aviso,
  Boton,
  Etiqueta,
  Segmentos,
  Tarjeta,
  TituloSeccion,
} from "../components/base";

type Tema = "auto" | "light" | "dark";

function temaGuardado(): Tema {
  try {
    const t = localStorage.getItem("tema");
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
}

function aplicarTema(t: Tema) {
  try {
    if (t === "auto") {
      localStorage.removeItem("tema");
      const oscuro = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.setAttribute("data-theme", oscuro ? "dark" : "light");
    } else {
      localStorage.setItem("tema", t);
      document.documentElement.setAttribute("data-theme", t);
    }
  } catch {
    /* almacenamiento bloqueado: el tema dura lo que la pestaña */
  }
}

export default function Ajustes() {
  const sesion = useSesion();
  const { estado, mercado, almacen, recargar, refrescarPrecios } = useDatos();
  const [tema, setTema] = useState<Tema>(temaGuardado());

  function exportar() {
    const blob = new Blob([JSON.stringify(estado, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cartera-${hoyISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <Etiqueta>Ajustes</Etiqueta>
        <h1 className="hero-num mt-1 text-[2.1rem] text-fg0">Cómo funciona todo.</h1>
      </section>

      <Tarjeta>
        <TituloSeccion>Tema</TituloSeccion>
        <Segmentos
          valor={tema}
          onChange={(t) => {
            setTema(t);
            aplicarTema(t);
          }}
          opciones={[
            { valor: "auto", texto: "El del sistema" },
            { valor: "light", texto: "Claro" },
            { valor: "dark", texto: "Oscuro" },
          ]}
        />
      </Tarjeta>

      <Tarjeta>
        <TituloSeccion>Dónde están tus datos</TituloSeccion>
        {almacen.tipo === "nube" ? (
          <p className="text-[12.5px] leading-relaxed text-fg1">
            En tu cuenta de Supabase, como <strong>{sesion.usuario?.email}</strong>. Se ven desde
            cualquier dispositivo en el que entres, y nadie más puede leerlos.
          </p>
        ) : (
          <>
            <p className="text-[12.5px] leading-relaxed text-fg1">
              Sólo en este navegador. Si borras los datos del sitio o cambias de dispositivo, se
              pierden.
            </p>
            <div className="mt-3">
              <Aviso tono="alerta">
                Exporta de vez en cuando, o crea una cuenta para tenerlos guardados de verdad.
              </Aviso>
            </div>
          </>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Boton tipo="suave" onClick={exportar}>
            Exportar a JSON
          </Boton>
          <Boton tipo="suave" onClick={() => void recargar()}>
            Recargar
          </Boton>
        </div>
      </Tarjeta>

      <Tarjeta>
        <TituloSeccion nota="Los precios los escribe un proceso del servidor: el navegador no puede pedírselos a Yahoo por sus reglas de CORS.">
          Precios
        </TituloSeccion>
        <ul className="flex flex-col gap-1.5 text-[12.5px] text-fg1">
          <li className="flex justify-between gap-3">
            <span>Origen</span>
            <span className="font-semibold text-fg0">
              {mercado.origen === "nube"
                ? "Supabase"
                : mercado.origen === "feed"
                  ? "Feed del repositorio"
                  : "sin datos"}
            </span>
          </li>
          <li className="flex justify-between gap-3">
            <span>Símbolos con precio</span>
            <span className="font-semibold text-fg0">{Object.keys(mercado.precios).length}</span>
          </li>
          <li className="flex justify-between gap-3">
            <span>Última actualización</span>
            <span className="font-semibold text-fg0">
              {mercado.actualizado
                ? new Date(mercado.actualizado).toLocaleString("es-ES")
                : "—"}
            </span>
          </li>
        </ul>
        <div className="mt-3">
          <Boton tipo="suave" onClick={() => void refrescarPrecios()}>
            Actualizar ahora
          </Boton>
        </div>
      </Tarjeta>

      <Tarjeta>
        <TituloSeccion>Cuenta</TituloSeccion>
        <Boton tipo="peligro" onClick={() => void sesion.salir()}>
          {almacen.tipo === "nube" ? "Cerrar sesión" : "Salir del modo local"}
        </Boton>
      </Tarjeta>
    </div>
  );
}
