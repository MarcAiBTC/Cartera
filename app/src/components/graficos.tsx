// ── GRÁFICOS ─────────────────────────────────────────────────────────────
// SVG a mano, sin librería. Son tres formas y ninguna necesita 200 KB de
// dependencia; además así heredan los colores del tema sin configurar nada.
//
// Reglas que se siguen en las tres:
//   · La leyenda existe siempre que haya más de una serie, y lleva el nombre
//     y la cifra al lado. La identidad nunca depende sólo del color.
//   · Trazos finos y rejilla discreta: los datos por delante, los ejes detrás.
//   · Separación de 2px entre porciones y barras contiguas, para que dos
//     colores parecidos no se toquen nunca.

import { useId, useState } from "react";
import { fe, fpc } from "../lib/formato";

// ── TARTA ────────────────────────────────────────────────────────────────

export interface Porcion {
  clave: string;
  etiqueta: string;
  valor: number;
  color: string;
  /** Segunda línea de la leyenda: ganancia, peso objetivo… */
  detalle?: string;
}

export function Tarta({
  porciones,
  total,
  titulo,
  subtitulo,
}: {
  porciones: Porcion[];
  total: number;
  /** Qué se lee en el centro cuando no hay ninguna porción señalada */
  titulo: string;
  subtitulo?: string;
}) {
  const [activa, setActiva] = useState<string | null>(null);
  const idGrad = useId();

  const R = 54;
  const GROSOR = 15;
  const CIRC = 2 * Math.PI * R;
  // 2px de hueco entre porciones: es lo que impide que dos colores contiguos
  // se lean como uno solo.
  const HUECO = 2;

  // El desplazamiento de cada arco es la suma de los anteriores. Se acumula
  // con reduce en vez de con una variable suelta: así el cálculo no depende
  // de que el render ocurra una sola vez.
  const arcos = porciones
    .filter((p) => p.valor > 0)
    .reduce<(Porcion & { frac: number; largo: number; offset: number })[]>((lista, p) => {
      const frac = total > 0 ? p.valor / total : 0;
      const anterior = lista.at(-1);
      const offset = anterior ? anterior.offset + anterior.frac * CIRC : 0;
      lista.push({ ...p, frac, largo: Math.max(frac * CIRC - HUECO, 0.5), offset });
      return lista;
    }, []);

  const señalada = arcos.find((a) => a.clave === activa);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-5">
      <div className="relative shrink-0">
        <svg viewBox="0 0 140 140" className="h-[150px] w-[150px] -rotate-90">
          <defs>
            <filter id={idGrad} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.12" />
            </filter>
          </defs>
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--bg3)" strokeWidth={GROSOR} />
          {arcos.map((a) => (
            <circle
              key={a.clave}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={a.color}
              strokeWidth={activa === a.clave ? GROSOR + 4 : GROSOR}
              strokeDasharray={`${a.largo} ${CIRC - a.largo}`}
              strokeDashoffset={-a.offset}
              strokeLinecap="butt"
              filter={activa === a.clave ? `url(#${idGrad})` : undefined}
              className="cursor-pointer transition-[stroke-width,opacity] duration-200"
              opacity={activa && activa !== a.clave ? 0.35 : 1}
              onMouseEnter={() => setActiva(a.clave)}
              onMouseLeave={() => setActiva(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {señalada ? (
            <>
              <span className="max-w-[92px] truncate text-[10px] font-bold text-fg2">
                {señalada.etiqueta}
              </span>
              <span className="font-disp text-[17px] font-bold text-fg0">
                {fpc(señalada.frac * 100)}
              </span>
              <span className="text-[10px] text-fg2">{fe(señalada.valor, 0)}</span>
            </>
          ) : (
            <>
              <span className="text-[10px] font-bold tracking-wide text-fg3 uppercase">
                {subtitulo ?? "Total"}
              </span>
              <span className="font-disp text-[17px] font-bold text-fg0">{titulo}</span>
            </>
          )}
        </div>
      </div>

      <ul className="flex w-full flex-col gap-1.5">
        {arcos.map((a) => (
          <li key={a.clave}>
            <button
              onMouseEnter={() => setActiva(a.clave)}
              onMouseLeave={() => setActiva(null)}
              onFocus={() => setActiva(a.clave)}
              onBlur={() => setActiva(null)}
              className={`flex w-full items-center gap-2 rounded-[10px] px-1.5 py-1 text-left transition-colors ${
                activa === a.clave ? "bg-bg2" : ""
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: a.color }}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg1">
                {a.etiqueta}
              </span>
              <span className="shrink-0 text-[12px] font-bold text-fg0">
                {fpc(a.frac * 100)}
              </span>
              <span className="w-[74px] shrink-0 text-right text-[11px] text-fg2">
                {a.detalle ?? fe(a.valor, 0)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── BARRAS APILADAS EN UNA LÍNEA ─────────────────────────────────────────

/** El reparto de la cartera en una sola tira. Ocupa poco y contesta «¿en qué
 *  está el dinero?» sin obligar a leer una tarta. */
export function Tira({ porciones, total }: { porciones: Porcion[]; total: number }) {
  return (
    <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full">
      {porciones
        .filter((p) => p.valor > 0)
        .map((p) => (
          <span
            key={p.clave}
            title={`${p.etiqueta} · ${fpc(total > 0 ? (p.valor / total) * 100 : 0)}`}
            style={{
              background: p.color,
              width: `${total > 0 ? (p.valor / total) * 100 : 0}%`,
            }}
          />
        ))}
    </div>
  );
}

// ── BARRA DE OBJETIVO ────────────────────────────────────────────────────

/** Peso actual contra peso objetivo. La marca vertical es el objetivo; la
 *  barra, lo que hay. Se ve de un vistazo por qué lado te has desviado. */
export function BarraObjetivo({
  actual,
  objetivo,
  color,
}: {
  actual: number;
  objetivo: number;
  color: string;
}) {
  const tope = Math.max(actual, objetivo, 1) * 1.15;
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-bg3">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.min((actual / tope) * 100, 100)}%`, background: color }}
      />
      <span
        className="absolute top-[-2px] h-[14px] w-[2px] rounded-full bg-fg0 opacity-70"
        style={{ left: `calc(${Math.min((objetivo / tope) * 100, 100)}% - 1px)` }}
        title={`Objetivo ${fpc(objetivo)}`}
      />
    </div>
  );
}

// ── SERIE TEMPORAL ───────────────────────────────────────────────────────

export interface PuntoSerie {
  fecha: string;
  valor: number;
  /** Segunda línea: el dinero aportado */
  base?: number;
}

/** Patrimonio contra dinero aportado. Dos líneas y un relleno entre ellas:
 *  el hueco ES la ganancia, que es justo lo que se quiere ver.
 *
 *  Un solo eje, siempre. Dos escalas distintas en el mismo gráfico es la
 *  manera más rápida de contar una mentira sin querer. */
export function Serie({
  puntos,
  alto = 150,
}: {
  puntos: PuntoSerie[];
  alto?: number;
}) {
  const idFill = useId();
  const [señalado, setSeñalado] = useState<number | null>(null);

  if (puntos.length < 2) {
    return (
      <div className="flex h-[120px] items-center justify-center text-[12px] text-fg2">
        Aún no hay días suficientes para dibujar la evolución.
      </div>
    );
  }

  const A = 320;
  const B = alto;
  const M = { arriba: 8, abajo: 18, izq: 4, der: 4 };

  const valores = puntos.flatMap((p) => [p.valor, p.base ?? p.valor]);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const rango = max - min || 1;

  const x = (i: number) => M.izq + (i / (puntos.length - 1)) * (A - M.izq - M.der);
  const y = (v: number) => M.arriba + (1 - (v - min) / rango) * (B - M.arriba - M.abajo);

  const linea = (sel: (p: PuntoSerie) => number) =>
    puntos.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(" ");

  const hayBase = puntos.some((p) => p.base != null);
  const area =
    hayBase
      ? `${linea((p) => p.valor)} ` +
        puntos
          .map(
            (_, i) =>
              `L${x(puntos.length - 1 - i).toFixed(1)},${y(puntos[puntos.length - 1 - i].base ?? 0).toFixed(1)}`,
          )
          .join(" ") +
        " Z"
      : "";

  const p = señalado != null ? puntos[señalado] : puntos[puntos.length - 1];
  const ganancia = p.base != null ? p.valor - p.base : null;

  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-fg2">{p.fecha}</span>
        <span className="flex items-center gap-2">
          <span className="font-bold text-fg0">{fe(p.valor, 0)}</span>
          {ganancia != null && (
            <span className={ganancia >= 0 ? "font-bold text-up" : "font-bold text-dn"}>
              {ganancia >= 0 ? "+" : ""}
              {fe(ganancia, 0)}
            </span>
          )}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${A} ${B}`}
        className="w-full"
        style={{ height: alto }}
        onMouseLeave={() => setSeñalado(null)}
        onMouseMove={(e) => {
          const caja = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - caja.left) / caja.width) * A;
          const i = Math.round(((rel - M.izq) / (A - M.izq - M.der)) * (puntos.length - 1));
          setSeñalado(Math.max(0, Math.min(puntos.length - 1, i)));
        }}
      >
        <defs>
          <linearGradient id={idFill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--blue)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {hayBase && <path d={area} fill={`url(#${idFill})`} />}
        {hayBase && (
          <path
            d={linea((q) => q.base ?? q.valor)}
            fill="none"
            stroke="var(--fg3)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        )}
        <path d={linea((q) => q.valor)} fill="none" stroke="var(--blue)" strokeWidth="2" />

        {señalado != null && (
          <>
            <line
              x1={x(señalado)}
              y1={M.arriba}
              x2={x(señalado)}
              y2={B - M.abajo}
              stroke="var(--line3)"
              strokeWidth="1"
            />
            {/* Anillo del color del fondo: separa el punto de la línea */}
            <circle
              cx={x(señalado)}
              cy={y(puntos[señalado].valor)}
              r="4.5"
              fill="var(--blue)"
              stroke="var(--bg1)"
              strokeWidth="2"
            />
          </>
        )}
      </svg>

      <div className="flex items-center gap-4 text-[11px] text-fg2">
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-4 rounded-full bg-blue" /> Patrimonio
        </span>
        {hayBase && (
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 rounded-full border-t-2 border-dashed border-fg3" />
            Dinero aportado
          </span>
        )}
      </div>
    </div>
  );
}
