// ── ARMAZÓN ──────────────────────────────────────────────────────────────
// Móvil primero, como Fintrack: una columna estrecha centrada y la navegación
// abajo, al alcance del pulgar. En pantalla grande la columna se queda
// centrada en vez de estirarse — una tabla de posiciones de 1.400 px de ancho
// no se lee mejor, se lee peor.

import { lazy, Suspense, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSesion } from "./lib/sesion";
import { useDatos } from "./lib/datos";
import { buscaPrecio } from "./lib/cartera";
import { Cargando } from "./components/base";
import Acceso from "./pages/Acceso";
import Inicio from "./pages/Inicio";

// Las pantallas que no se abren en el primer segundo se cargan aparte: el
// arranque en móvil es lo que más se nota.
const Analisis = lazy(() => import("./pages/Analisis"));
const Historial = lazy(() => import("./pages/Historial"));
const Objetivo = lazy(() => import("./pages/Objetivo"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const Cashflow = lazy(() => import("./pages/Cashflow"));
const Fiscal = lazy(() => import("./pages/Fiscal"));
const Importar = lazy(() => import("./pages/Importar"));
const Ajustes = lazy(() => import("./pages/Ajustes"));
const Mas = lazy(() => import("./pages/Mas"));

interface Pestana {
  a: string;
  texto: string;
  icono: ReactNode;
}

const I = (d: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const PESTANAS: Pestana[] = [
  { a: "/", texto: "Inicio", icono: I("M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z") },
  { a: "/analisis", texto: "Análisis", icono: I("M4 19V5m0 14h16M8 16V10m4 6V7m4 9v-4") },
  { a: "/importar", texto: "Añadir", icono: I("M12 5v14M5 12h14") },
  { a: "/historial", texto: "Historial", icono: I("M4 6h16M4 12h16M4 18h10") },
  { a: "/mas", texto: "Más", icono: I("M5 12h.01M12 12h.01M19 12h.01") },
];

function Navegacion() {
  const { buzon } = useDatos();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(10px,env(safe-area-inset-bottom))]">
      <ul className="flex w-[min(100%-16px,520px)] items-stretch gap-1 rounded-sheet border border-line bg-[color-mix(in_srgb,var(--bg1)_88%,transparent)] p-1.5 shadow-e2 backdrop-blur-xl">
        {PESTANAS.map((p) => (
          <li key={p.a} className="flex-1">
            <NavLink
              to={p.a}
              end={p.a === "/"}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-0.5 rounded-tile py-1.5 text-[10px] font-bold transition-colors ${
                  isActive ? "bg-bg2 text-blue" : "text-fg2 hover:text-fg0"
                }`
              }
            >
              {p.icono}
              {p.texto}
              {/* Lo que has compartido desde la app del bróker y todavía no has
                  mirado. Sin esta marca, el buzón sería un sitio al que hay
                  que acordarse de entrar, y entonces no sirve de nada. */}
              {p.a === "/importar" && buzon.length > 0 && (
                <span
                  aria-label={`${buzon.length} ${buzon.length === 1 ? "archivo esperando" : "archivos esperando"}`}
                  className="absolute top-0.5 right-[22%] flex h-4 min-w-4 items-center justify-center rounded-full bg-blue px-1 text-[9px] leading-none font-bold text-white"
                >
                  {buzon.length}
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** La hora de ahora, puesta al día cada `cada` ms: lo justo para que «hace
 *  3 min» no se quede congelado con la pestaña abierta. */
function useAhora(cada: number): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), cada);
    return () => clearInterval(i);
  }, [cada]);
  return t;
}

const hora = (d: Date) => d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

/** «hace 3 min» mientras es reciente; después, la hora: «hoy 09:43»,
 *  «ayer 21:30», «9 sep 15:31». Un «hace 14 h» obliga a hacer la cuenta. */
function cuandoFue(iso: string, ahora: number): string {
  const d = new Date(iso);
  const min = Math.floor((ahora - d.getTime()) / 60e3);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const hoy = new Date(ahora);
  const ayer = new Date(ahora - 86400e3);
  if (d.toDateString() === hoy.toDateString()) return `hoy ${hora(d)}`;
  if (d.toDateString() === ayer.toDateString()) return `ayer ${hora(d)}`;
  return `${d.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} ${hora(d)}`;
}

function BarraSuperior() {
  const { mercado, posiciones, actualizando, actualizarPrecios } = useDatos();
  const ahora = useAhora(30e3);
  const [aviso, setAviso] = useState<{ texto: string; detalle?: string; malo: boolean } | null>(
    null,
  );
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(temporizador.current), []);

  // La hora que importa es la de los precios de LO QUE TIENES, no la del
  // catálogo entero: quinientos símbolos de hace diez minutos no dicen nada
  // si el tuyo es de ayer. Se toma la más reciente de tus posiciones.
  const cuando = useMemo(() => {
    const fechas = posiciones
      .filter((p) => p.activo.cat !== "liquidez" && Math.abs(p.qty) > 1e-9)
      .map((p) => buscaPrecio(p.activo, mercado.precios)?.updated_at)
      .filter((f): f is string => Boolean(f) && isFinite(Date.parse(f!)))
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    return fechas.at(-1) ?? mercado.actualizado;
  }, [posiciones, mercado]);
  const edad = cuando ? ahora - Date.parse(cuando) : null;

  const pulsar = async () => {
    if (actualizando) return;
    clearTimeout(temporizador.current);
    setAviso(null);
    const r = await actualizarPrecios();
    if (!r.ok) setAviso({ texto: "sin conexión", detalle: r.error, malo: true });
    else if (r.fallos.length > 0) {
      setAviso({
        texto: `${r.fallos.length} sin actualizar`,
        detalle: `No han llegado:\n${r.fallos.join("\n")}`,
        malo: true,
      });
    }
    temporizador.current = setTimeout(() => setAviso(null), 8000);
  };

  const etiqueta = actualizando
    ? "actualizando…"
    : (aviso?.texto ?? (cuando ? cuandoFue(cuando, ahora) : "sin precios"));
  const titulo = [
    cuando
      ? `Precios actualizados el ${new Date(cuando).toLocaleString("es-ES", {
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        })}.`
      : "Todavía no hay precios.",
    aviso?.detalle,
    actualizando ? "Pidiendo precios nuevos…" : "Pulsa para pedir precios nuevos.",
  ]
    .filter(Boolean)
    .join("\n");
  const rojo = aviso?.malo || (edad != null && edad >= 30 * 3600e3);

  return (
    <header className="sticky top-0 z-30 mb-3 flex items-center justify-between gap-3 border-b border-line bg-[color-mix(in_srgb,var(--bg0)_82%,transparent)] px-4 py-2.5 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-[8px] bg-gradient-to-br from-[#6d7df6] via-[#9b7bf3] to-[#f783ac] shadow-[0_3px_10px_var(--blue-glow)]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 17 L10 10 L14 14 L20 6" />
          </svg>
        </span>
        <span className="font-disp text-[14px] font-bold tracking-tight">Cartera</span>
      </div>

      <div className="flex items-center gap-2 text-[10px] font-semibold text-fg2">
        {/* Visible también en el móvil, que es donde se usa la app: es la
            única señal de que los precios que estás mirando son de hace días,
            y el único sitio desde el que pedir unos nuevos. */}
        <button
          type="button"
          onClick={() => void pulsar()}
          disabled={actualizando}
          title={titulo}
          aria-label={`Actualizar precios. ${titulo}`}
          aria-busy={actualizando}
          className={`flex items-center gap-1 rounded-full bg-bg2 px-2 py-0.5 transition-colors hover:bg-bg3 hover:text-fg1 disabled:cursor-wait ${rojo ? "text-dn" : ""}`}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={actualizando ? "animate-spin" : undefined}
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          <span className="tabular-nums">{etiqueta}</span>
        </button>
        <MenuCuenta />
      </div>
    </header>
  );
}

/** El nombre de la cuenta, y detras la unica forma de salir de ella.
 *
 *  Antes esto era una etiqueta muerta y «Cerrar sesion» vivia en Ajustes,
 *  al final del todo. Cambiar de cuenta —o pasar del modo local a la cuenta
 *  de verdad— era imposible de encontrar. */
function MenuCuenta() {
  const { usuario, local, salir } = useSesion();
  const [abierto, setAbierto] = useState(false);

  const nombre = local ? "este dispositivo" : (usuario?.email?.split("@")[0] ?? "cuenta");

  return (
    <div className="relative">
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="menu"
        className="rounded-full bg-bg2 px-2 py-0.5 text-[10px] font-semibold text-fg2 transition-colors hover:bg-bg3 hover:text-fg1"
      >
        {nombre} ▾
      </button>

      {abierto && (
        <>
          {/* Una capa que cubre la pantalla: tocar fuera cierra el menu, que
              en el movil es como se espera que funcione. */}
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Cerrar el menu"
            onClick={() => setAbierto(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-1.5 w-60 overflow-hidden rounded-[14px] border border-line2 bg-bg1 shadow-[0_12px_32px_rgba(39,33,74,0.16)]"
          >
            <div className="border-b border-line px-3.5 py-2.5">
              <p className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-fg3">
                {local ? "Sin cuenta" : "Has entrado como"}
              </p>
              <p className="truncate text-[12.5px] font-semibold text-fg0">
                {local ? "Los datos solo estan en este dispositivo" : (usuario?.email ?? "")}
              </p>
            </div>
            <button
              role="menuitem"
              onClick={() => {
                setAbierto(false);
                void salir();
              }}
              className="block w-full px-3.5 py-2.5 text-left text-[12.5px] font-semibold text-dn transition-colors hover:bg-bg2"
            >
              {local ? "Salir y entrar con una cuenta" : "Cerrar sesion"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const sesion = useSesion();
  const { cargando } = useDatos();
  const donde = useLocation();

  if (sesion.cargando) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Cargando texto="Abriendo la cartera…" />
      </div>
    );
  }

  if (!sesion.activa) return <Acceso />;

  // El relleno lateral vive en la cabecera y en <main>, no en el contenedor:
  // ponerlo fuera y compensarlo con `-mx-4` en la cabecera la hacía 32 px más
  // ancha que la ventana, y con `overflow-x:hidden` eso no daba scroll sino
  // que recortaba TODAS las pantallas por la derecha.
  return (
    <div className="mx-auto w-full max-w-[560px] pb-32">
      <BarraSuperior />
      <main className="px-4">
        <Suspense fallback={<Cargando />}>
          {cargando && donde.pathname === "/" ? (
            <Cargando texto="Cargando la cartera…" />
          ) : (
            <Routes>
              <Route path="/" element={<Inicio />} />
              <Route path="/analisis" element={<Analisis />} />
              <Route path="/historial" element={<Historial />} />
              <Route path="/objetivo" element={<Objetivo />} />
              <Route path="/watchlist" element={<Watchlist />} />
              <Route path="/cashflow" element={<Cashflow />} />
              <Route path="/fiscal" element={<Fiscal />} />
              <Route path="/importar" element={<Importar />} />
              <Route path="/ajustes" element={<Ajustes />} />
              <Route path="/mas" element={<Mas />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </Suspense>
      </main>
      <Navegacion />
    </div>
  );
}
