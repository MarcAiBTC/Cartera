// ── AJUSTES ──────────────────────────────────────────────────────────────
// Tema, cuenta y datos. La exportación no es un adorno: es la garantía de que
// los datos son tuyos y de que puedes salirte de aquí cuando quieras.

import { useState } from "react";
import { useSesion } from "../lib/sesion";
import { useDatos } from "../lib/datos";
import type { Alcance } from "../lib/almacen";
import { hoyISO } from "../lib/formato";
import {
  Aviso,
  Boton,
  Campo,
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

      <ZonaPeligrosa onExportar={exportar} />
    </div>
  );
}

// ── BORRAR ────────────────────────────────────────────────────────────────
// Lo unico de la app que no tiene deshacer. Por eso: la cifra de lo que se va
// por delante, la copia de seguridad a un toque, y una palabra que hay que
// escribir. Un boton rojo con un «¿seguro?» se pulsa dos veces sin leerlo.

const PALABRA = "BORRAR";

function ZonaPeligrosa({ onExportar }: { onExportar: () => void }) {
  const { estado, vaciar } = useDatos();
  const [alcance, setAlcance] = useState<Alcance | null>(null);
  const [escrito, setEscrito] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cuentas = estado.cuentas.length;
  const activos = estado.activos.length;
  const operaciones = estado.operaciones.length;
  const extras = estado.seguimiento.length + estado.objetivos.length;
  const vacia = cuentas + activos + operaciones + extras === 0;

  async function confirmar() {
    if (!alcance || escrito.trim().toUpperCase() !== PALABRA) return;
    setBorrando(true);
    setError(null);
    try {
      await vaciar(alcance);
      setAlcance(null);
      setEscrito("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido borrar");
    } finally {
      setBorrando(false);
    }
  }

  return (
    <Tarjeta>
      <TituloSeccion nota="Esto no se puede deshacer. Exporta antes si tienes dudas.">
        Borrar datos
      </TituloSeccion>

      {vacia ? (
        <p className="text-[12px] text-fg2">No hay nada que borrar.</p>
      ) : !alcance ? (
        <div className="flex flex-col gap-2">
          <Boton tipo="suave" onClick={() => setAlcance("cartera")}>
            Vaciar la cartera
          </Boton>
          <p className="text-[11.5px] leading-relaxed text-fg2">
            Se van {operaciones} movimientos, {activos} activos y {cuentas}{" "}
            {cuentas === 1 ? "cuenta" : "cuentas"}. Se quedan tus objetivos, tu lista de
            seguimiento y los ajustes: eso no viene en ningun extracto y volver a montarlo
            cuesta.
          </p>

          <Boton tipo="peligro" onClick={() => setAlcance("todo")} className="mt-1">
            Borrarlo todo y empezar de cero
          </Boton>
          <p className="text-[11.5px] leading-relaxed text-fg2">
            Todo lo anterior y ademas el seguimiento, los objetivos y el cashflow. La cuenta
            sigue existiendo: lo que se vacia son los datos.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Aviso tono="error">
            {alcance === "cartera"
              ? `Vas a borrar ${operaciones} movimientos, ${activos} activos y ${cuentas} ${cuentas === 1 ? "cuenta" : "cuentas"}.`
              : `Vas a borrar TODO: ${operaciones} movimientos, ${activos} activos, ${cuentas} ${cuentas === 1 ? "cuenta" : "cuentas"} y ${extras} entradas de seguimiento y objetivos.`}{" "}
            No hay vuelta atras.
          </Aviso>

          <Boton tipo="suave" onClick={onExportar}>
            Descargar una copia antes
          </Boton>

          <Campo
            etiqueta={`Escribe ${PALABRA} para confirmar`}
            valor={escrito}
            onChange={setEscrito}
            placeholder={PALABRA}
          />

          {error && <Aviso tono="error">{error}</Aviso>}

          <div className="flex gap-2">
            <Boton
              tipo="suave"
              onClick={() => {
                setAlcance(null);
                setEscrito("");
                setError(null);
              }}
            >
              Cancelar
            </Boton>
            <Boton
              tipo="peligro"
              className="flex-1"
              disabled={borrando || escrito.trim().toUpperCase() !== PALABRA}
              onClick={() => void confirmar()}
            >
              {borrando ? "Borrando…" : "Borrar definitivamente"}
            </Boton>
          </div>
        </div>
      )}
    </Tarjeta>
  );
}
