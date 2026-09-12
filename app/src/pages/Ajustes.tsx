// ── AJUSTES ──────────────────────────────────────────────────────────────
// Tema, cuenta y datos. La exportación no es un adorno: es la garantía de que
// los datos son tuyos y de que puedes salirte de aquí cuando quieras.

import { useEffect, useState } from "react";
import { useSesion } from "../lib/sesion";
import { useDatos } from "../lib/datos";
import type { Alcance } from "../lib/almacen";
import { loDeLaCuenta } from "../lib/cartera";
import { claveSubida, crearClaveSubida, enlaceSubida, type ClaveSubida } from "../lib/buzon";
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

      {almacen.tipo === "nube" && <EnviarDesdeElMovil />}

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

      <BorrarBanco onExportar={exportar} />

      <ZonaPeligrosa onExportar={exportar} />
    </div>
  );
}

// ── ENVIAR DESDE EL MÓVIL ─────────────────────────────────────────────────
// El camino corto para el iPhone. iOS no admite el «share target» de la web
// —Android sí, y ahí bastaría el manifiesto—, así que el sitio de la hoja de
// compartir se gana con un Atajo: recibe el archivo, lo manda a /api/entrada y
// ya está esperando en la cartera cuando la abres.
//
// Son dos minutos de configuración, una sola vez, y a cambio se ahorran cinco
// pasos cada mes. Las instrucciones van aquí dentro y no en un README: quien
// las necesita está en el móvil, no delante del repositorio.

function EnviarDesdeElMovil() {
  const { recargarBuzon } = useDatos();
  const [clave, setClave] = useState<ClaveSubida | null>(null);
  const [cargando, setCargando] = useState(true);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setClave(await claveSubida());
      } catch {
        setError("No se ha podido leer la clave de subida.");
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  async function generar() {
    setError(null);
    try {
      setClave(await crearClaveSubida());
      setCambiando(false);
      // La clave anterior deja de valer en el mismo instante: si había algo a
      // medio camino, mejor enterarse ahora.
      await recargarBuzon();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido crear la clave.");
    }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Safari sin permiso de portapapeles: el enlace está a la vista y se
      // puede seleccionar a mano, que es peor pero no deja a nadie tirado.
      setError("Este navegador no deja copiar solo. Selecciona el enlace y cópialo a mano.");
    }
  }

  const enlace = clave ? enlaceSubida(clave.token) : "";

  return (
    <Tarjeta>
      <TituloSeccion nota="Para no tener que descargar el extracto, buscarlo en Archivos y subirlo.">
        Enviar desde el móvil
      </TituloSeccion>

      {cargando ? (
        <p className="text-[12.5px] text-fg2">…</p>
      ) : !clave ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-fg1">
            Crea un enlace privado y añádelo a un Atajo del iPhone. Después, dentro de la app de
            Trade Republic o de Revolut, compartir el extracto y elegir «Enviar a Cartera» lo deja
            esperando aquí.
          </p>
          <div className="mt-3">
            <Boton tipo="principal" onClick={() => void generar()}>
              Crear el enlace
            </Boton>
          </div>
        </>
      ) : (
        <>
          <p className="text-[12.5px] leading-relaxed text-fg1">
            Éste es tu enlace privado. Con él sólo se pueden <strong>dejar archivos</strong> en el
            buzón: no lee tu cartera, no escribe operaciones y no borra nada.
          </p>

          <p className="mt-2.5 rounded-field border border-line2 bg-bg2 p-2.5 font-mono text-[10.5px] break-all text-fg1 select-all">
            {enlace}
          </p>

          <div className="mt-2.5 flex flex-wrap gap-2">
            <Boton tipo="principal" onClick={() => void copiar(enlace)}>
              {copiado ? "Copiado ✓" : "Copiar el enlace"}
            </Boton>
            {/* Las clases son las de `Boton tipo="suave"` copiadas a mano: esto
                tiene que ser un enlace de verdad para que abra en otra pestaña,
                y `Boton` sólo pinta botones. */}
            <a
              href={enlace}
              target="_blank"
              rel="noreferrer"
              className="rounded-field bg-bg2 px-4 py-2.5 text-[13px] font-bold text-fg1 transition-all hover:bg-bg3"
            >
              Probarlo
            </a>
          </div>

          <p className="mt-2 text-[11px] text-fg2">
            {clave.last_used_at
              ? `Usado ${clave.uses} ${clave.uses === 1 ? "vez" : "veces"}; la última, el ${new Date(clave.last_used_at).toLocaleDateString("es-ES")}.`
              : "Todavía no se ha usado."}
          </p>

          <details className="mt-3 rounded-tile bg-bg2 px-3.5 py-3">
            <summary className="cursor-pointer list-none text-[12.5px] font-bold text-fg0">
              Cómo montar el Atajo en el iPhone
            </summary>
            <ol className="mt-2.5 flex list-decimal flex-col gap-1.5 pl-4 text-[12px] leading-relaxed text-fg1">
              <li>Copia el enlace de arriba.</li>
              <li>
                Abre <strong>Atajos</strong> y toca <strong>+</strong> para crear uno nuevo.
              </li>
              <li>
                Arriba, en la <strong>ⓘ</strong> de la barra inferior, activa{" "}
                <strong>«Mostrar en la hoja de compartir»</strong> y deja marcado sólo{" "}
                <strong>Archivos</strong> como tipo de entrada.
              </li>
              <li>
                Añade la acción <strong>«Obtener contenido de la URL»</strong> y pega el enlace.
              </li>
              <li>
                Despliega esa acción: <strong>Método → POST</strong>,{" "}
                <strong>Cuerpo de la solicitud → Archivo</strong>, y en el campo del archivo elige{" "}
                <strong>«Entrada del atajo»</strong>.
              </li>
              <li>
                Ponle de nombre <strong>Enviar a Cartera</strong> y guarda.
              </li>
            </ol>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-fg2">
              Ya está. En Trade Republic: Perfil → Extractos → exportar, y cuando salga la hoja de
              compartir, «Enviar a Cartera». El archivo aparece en la pestaña Añadir la próxima vez
              que abras la app.
            </p>
          </details>

          <div className="mt-3 border-t border-line pt-3">
            {cambiando ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11.5px] leading-relaxed text-fg2">
                  El enlace de ahora dejará de funcionar y tendrás que pegar el nuevo en el Atajo.
                  Los archivos que ya estén en el buzón se quedan.
                </p>
                <div className="flex gap-2">
                  <Boton tipo="peligro" onClick={() => void generar()}>
                    Sí, cambiar la clave
                  </Boton>
                  <Boton tipo="suave" onClick={() => setCambiando(false)}>
                    Dejarlo
                  </Boton>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCambiando(true)}
                className="text-[11.5px] font-semibold text-fg2 underline-offset-4 hover:text-fg0 hover:underline"
              >
                Cambiar la clave
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="mt-3">
          <Aviso tono="error">{error}</Aviso>
        </div>
      )}
    </Tarjeta>
  );
}

// ── BORRAR ────────────────────────────────────────────────────────────────
// Lo unico de la app que no tiene deshacer. Por eso: la cifra de lo que se va
// por delante, la copia de seguridad a un toque, y una palabra que hay que
// escribir. Un boton rojo con un «¿seguro?» se pulsa dos veces sin leerlo.

const PALABRA = "BORRAR";

// ── BORRAR UN BANCO ───────────────────────────────────────────────────────
// Para rehacer una importación que entró mal sin tocar lo demás: se va lo de
// ese banco —sus movimientos, lo que sólo existe por ellos y su efectivo— y
// los otros se quedan como estaban. Es igual de irreversible que vaciarlo
// todo, así que pide la misma palabra.

function BorrarBanco({ onExportar }: { onExportar: () => void }) {
  const { estado, borrarVarios } = useDatos();
  const [cuentaId, setCuentaId] = useState<string | null>(null);
  const [escrito, setEscrito] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (estado.cuentas.length === 0) return null;
  const cuenta = estado.cuentas.find((c) => c.id === cuentaId) ?? null;
  const lo = cuenta ? loDeLaCuenta(estado, cuenta.id) : null;

  const cerrar = () => {
    setCuentaId(null);
    setEscrito("");
    setError(null);
  };

  async function confirmar() {
    if (!cuenta || !lo || escrito.trim().toUpperCase() !== PALABRA) return;
    setBorrando(true);
    setError(null);
    try {
      // Las operaciones primero: cuelgan de los activos y de la cuenta.
      await borrarVarios("operations", lo.operaciones);
      await borrarVarios(
        "assets",
        lo.activos.map((a) => a.id),
      );
      await borrarVarios("accounts", [cuenta.id]);
      cerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido borrar");
    } finally {
      setBorrando(false);
    }
  }

  return (
    <Tarjeta>
      <TituloSeccion nota="Para volver a importar un banco desde cero sin tocar los demás.">
        Borrar un banco
      </TituloSeccion>

      {!cuenta || !lo ? (
        <ul className="flex flex-col gap-2">
          {estado.cuentas.map((c) => {
            const l = loDeLaCuenta(estado, c.id);
            return (
              <li key={c.id} className="tile flex items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-fg0">{c.name}</span>
                  <span className="text-[11px] text-fg2">
                    {l.operaciones.length} movimientos · {l.activos.length}{" "}
                    {l.activos.length === 1 ? "activo" : "activos"}
                  </span>
                </span>
                <Boton
                  tipo="peligro"
                  onClick={() => {
                    cerrar();
                    setCuentaId(c.id);
                  }}
                >
                  Borrar
                </Boton>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          <Aviso tono="error">
            Vas a borrar <strong>{cuenta.name}</strong>: {lo.operaciones.length} movimientos y{" "}
            {lo.activos.length} {lo.activos.length === 1 ? "activo" : "activos"}
            {lo.activos.length > 0 && <> ({lo.activos.map((a) => a.name).join(", ")})</>}.{" "}
            {lo.compartidos.length > 0 && (
              <>
                Se quedan {lo.compartidos.map((a) => a.name).join(", ")}, que también tienen
                movimientos en otro banco.{" "}
              </>
            )}
            Los demás bancos no se tocan. No hay vuelta atrás.
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
            <Boton tipo="suave" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton
              tipo="peligro"
              className="flex-1"
              disabled={borrando || escrito.trim().toUpperCase() !== PALABRA}
              onClick={() => void confirmar()}
            >
              {borrando ? "Borrando…" : `Borrar ${cuenta.name}`}
            </Boton>
          </div>
        </div>
      )}
    </Tarjeta>
  );
}

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
