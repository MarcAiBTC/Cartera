// ── MÁS ──────────────────────────────────────────────────────────────────
// Las pantallas que no caben en la barra de abajo. Cinco pestañas es el
// máximo que se puede tocar con el pulgar sin fallar; el resto vive aquí.

import { Link } from "react-router-dom";
import { Etiqueta } from "../components/base";

const ENLACES: { a: string; titulo: string; texto: string; icono: string }[] = [
  {
    a: "/objetivo",
    titulo: "Objetivo",
    texto: "Los pesos que quieres y dónde meter la próxima aportación",
    icono: "M12 2v20M2 12h20",
  },
  {
    a: "/fiscal",
    titulo: "Fiscal",
    texto: "Plusvalías, minusvalías y cobros por ejercicio",
    icono: "M6 3h9l4 4v14H6zM15 3v4h4",
  },
  {
    a: "/watchlist",
    titulo: "Watchlist",
    texto: "Activos que sigues sin tenerlos en cartera",
    icono: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z",
  },
  {
    a: "/cashflow",
    titulo: "Cashflow",
    texto: "Cuánto te sobra cada mes y en qué se convierte",
    icono: "M4 19V5m0 14h16M8 15l3-4 3 3 4-6",
  },
  {
    a: "/importar",
    titulo: "Importar",
    texto: "Cargar el archivo de movimientos de tu bróker",
    icono: "M12 16V4m0 0L8 8m4-4 4 4M4 18v2h16v-2",
  },
  {
    a: "/ajustes",
    titulo: "Ajustes",
    texto: "Tema, cuenta y datos",
    icono: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.06-.33.1-.66.1-1z",
  },
];

export default function Mas() {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <Etiqueta>Más</Etiqueta>
        <h1 className="hero-num mt-1 text-[2.1rem] text-fg0">El resto de la app.</h1>
      </section>

      <ul className="flex flex-col gap-2">
        {ENLACES.map((e) => (
          <li key={e.a}>
            <Link
              to={e.a}
              className="tile flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-bg2"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-tile bg-bg2 text-fg1">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d={e.icono} />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold text-fg0">{e.titulo}</span>
                <span className="block truncate text-[11.5px] text-fg2">{e.texto}</span>
              </span>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-fg3">
                <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
