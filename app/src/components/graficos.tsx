// ── GRÁFICOS ─────────────────────────────────────────────────────────────
// SVG a mano, sin librería. Son pocas formas y ninguna necesita 200 KB de
// dependencia; además así heredan los colores del tema sin configurar nada.
//
// Reglas que se siguen en todos:
//   · La leyenda existe siempre que haya más de una serie, y lleva el nombre
//     y la cifra al lado. La identidad nunca depende sólo del color.
//   · Trazos finos y rejilla discreta: los datos por delante, los ejes detrás.
//   · Separación de 2px entre porciones y barras contiguas, para que dos
//     colores parecidos no se toquen nunca.
//   · Se dibujan al ancho de VERDAD de su caja, un píxel por unidad
//     (`useAncho`). Con un viewBox fijo de 320 estirado a una tarjeta de 500,
//     el dibujo quedaba centrado en medio y el ratón señalaba otra semana.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { fd, fdl, fe, fp, fpc } from "../lib/formato";
import { SERIE_COLOR } from "../lib/tipos";
import { Segmentos } from "./base";

// ── Utilidades comunes ───────────────────────────────────────────────────

/** El ancho de la caja en píxeles, al día con cada cambio de tamaño. Con
 *  el elemento por estado y no por ref: si la primera vez no había gráfico
 *  —aún sin datos— la medida tiene que empezar cuando aparezca. */
function useAncho(el: HTMLElement | null): number {
  const [ancho, setAncho] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const medir = () => setAncho(Math.round(el.getBoundingClientRect().width));
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return ancho;
}

/** Un paso de rejilla redondo —1, 2, 2,5 o 5 por una potencia de diez— para
 *  que quepan unas `n` rayas. */
function pasoBonito(rango: number, n = 4): number {
  const bruto = rango / n || 1;
  const p = 10 ** Math.floor(Math.log10(bruto));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => bruto <= s) ?? 10 * p;
}

/** «6,4 k€», «850 €»: lo que cabe en el margen de un eje. */
function eurCorto(v: number): string {
  if (Math.abs(v) < 1000) return `${Math.round(v)} €`;
  const d = Math.abs(v) >= 10000 ? 0 : 1;
  return `${(v / 1000).toLocaleString("es-ES", { maximumFractionDigits: d })} k€`;
}

/** «sept 25», o «12 sept» cuando lo que se ve son pocas semanas. */
function fechaEje(f: string, corto: boolean): string {
  return new Date(`${f}T12:00:00`).toLocaleDateString(
    "es-ES",
    corto ? { day: "numeric", month: "short" } : { month: "short", year: "2-digit" },
  );
}

/** Con signo siempre: «+120 €», «−40 €». */
const feSigno = (v: number) => `${v >= 0 ? "+" : ""}${fe(v, 0)}`;

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

// ── DOS RENTABILIDADES ───────────────────────────────────────────────────

export interface PuntoComparativa {
  fecha: string;
  /** % acumulado de la primera serie */
  a: number;
  /** % acumulado de la segunda; null donde todavía no hay dato */
  b: number | null;
}

// Los dos primeros del juego de series, ya comprobados par a par para
// daltonismo en claro y en oscuro. La segunda va además a trazos —o rayada
// en las barras—: quién es quién no depende sólo del color.
const COLOR_A = SERIE_COLOR[0];
const COLOR_B = SERIE_COLOR[1];

/** Dos rentabilidades acumuladas desde el mismo día. Un solo eje —las dos
 *  son un porcentaje sobre la misma fecha— y la línea del cero marcada, que
 *  es la que dice si se gana o se pierde. Al pasar el dedo, las dos cifras de
 *  esa semana arriba. */
export function Comparativa({
  puntos,
  nombreA,
  nombreB,
  alto = 180,
}: {
  puntos: PuntoComparativa[];
  nombreA: string;
  nombreB: string;
  alto?: number;
}) {
  const [caja, setCaja] = useState<HTMLDivElement | null>(null);
  const ancho = useAncho(caja) || 320;
  const [marcado, setSeñalado] = useState<number | null>(null);
  if (puntos.length < 2) return null;
  const señalado = marcado != null && marcado < puntos.length ? marcado : null;

  const A = ancho;
  const B = alto;
  const M = { arriba: 10, abajo: 18, izq: 4, der: 4 };

  const valores = puntos.flatMap((p) => (p.b == null ? [p.a] : [p.a, p.b]));
  const min = Math.min(0, ...valores);
  const max = Math.max(0, ...valores);
  const rango = max - min || 1;
  const x = (i: number) => M.izq + (i / (puntos.length - 1)) * (A - M.izq - M.der);
  const y = (v: number) => M.arriba + (1 - (v - min) / rango) * (B - M.arriba - M.abajo);

  // Rejilla en cifras redondas, tres o cuatro rayas como mucho.
  const paso = [5, 10, 20, 25, 50, 100, 200].find((s) => rango / s <= 4) ?? 500;
  const marcas: number[] = [];
  for (let v = Math.ceil(min / paso) * paso; v <= max; v += paso) marcas.push(v);

  // Una línea que se corta donde no hay dato, en vez de inventarlo.
  const linea = (sel: (p: PuntoComparativa) => number | null) => {
    let d = "";
    let dentro = false;
    puntos.forEach((p, i) => {
      const v = sel(p);
      if (v == null) {
        dentro = false;
        return;
      }
      d += `${dentro ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      dentro = true;
    });
    return d.trim();
  };

  const señalar = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * A;
    const k = Math.round(((rel - M.izq) / (A - M.izq - M.der)) * (puntos.length - 1));
    setSeñalado(Math.max(0, Math.min(puntos.length - 1, k)));
  };

  const ultimo = puntos[puntos.length - 1];
  const p = puntos[señalado ?? puntos.length - 1];
  // Para la tabla: una fila cada cuatro semanas, y la de hoy.
  const cada = Math.max(1, Math.ceil(puntos.length / 14));
  const filas = puntos.filter((_, i) => i % cada === 0 || i === puntos.length - 1);

  return (
    <div ref={setCaja} className="w-full">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px]">
        <span className="text-fg2">{señalado == null ? "Hoy" : fd(p.fecha)}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <Leyenda color={COLOR_A} texto={nombreA} v={p.a} />
          <Leyenda color={COLOR_B} texto={nombreB} v={p.b} trazos />
        </span>
      </div>

      <svg
        width={A}
        height={B}
        viewBox={`0 0 ${A} ${B}`}
        className="block touch-pan-y select-none"
        role="img"
        aria-label={`Desde el ${fd(puntos[0].fecha)}: ${nombreA} ${fp(ultimo.a)}, ${nombreB} ${fp(ultimo.b)}`}
        onPointerMove={señalar}
        onPointerDown={señalar}
        onPointerLeave={() => setSeñalado(null)}
      >
        {marcas.map((v) => (
          <line
            key={v}
            x1={M.izq}
            x2={A - M.der}
            y1={y(v)}
            y2={y(v)}
            stroke={v === 0 ? "var(--line3)" : "var(--line)"}
            strokeWidth="1"
          />
        ))}

        <path
          d={linea((q) => q.b)}
          fill="none"
          stroke={COLOR_B}
          strokeWidth="2"
          strokeDasharray="4 3"
          strokeLinejoin="round"
        />
        <path
          d={linea((q) => q.a)}
          fill="none"
          stroke={COLOR_A}
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* Las cifras del eje, encima de las líneas y con un halo del color
            del fondo: el «0 %» quedaba tapado por el arranque de las dos. */}
        {marcas.map((v) => (
          <text
            key={`t${v}`}
            x={M.izq}
            y={y(v) - 3}
            fontSize="10"
            fill="var(--fg3)"
            stroke="var(--bg1)"
            strokeWidth="3"
            paintOrder="stroke"
          >
            {v > 0 ? "+" : ""}
            {v} %
          </text>
        ))}

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
            {p.b != null && (
              <circle
                cx={x(señalado)}
                cy={y(p.b)}
                r="4.5"
                fill={COLOR_B}
                stroke="var(--bg1)"
                strokeWidth="2"
              />
            )}
            <circle
              cx={x(señalado)}
              cy={y(p.a)}
              r="4.5"
              fill={COLOR_A}
              stroke="var(--bg1)"
              strokeWidth="2"
            />
          </>
        )}

        <text x={M.izq} y={B - 3} fontSize="10" fill="var(--fg3)">
          {fechaEje(puntos[0].fecha, false)}
        </text>
        <text x={A - M.der} y={B - 3} fontSize="10" fill="var(--fg3)" textAnchor="end">
          hoy
        </text>
      </svg>

      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] font-semibold text-fg2">Ver en tabla</summary>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr className="text-left text-fg3">
                <th className="py-1 font-semibold">Semana</th>
                <th className="py-1 text-right font-semibold">{nombreA}</th>
                <th className="py-1 text-right font-semibold">{nombreB}</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.fecha} className="border-t border-line text-fg1">
                  <td className="py-1">{fd(f.fecha)}</td>
                  <td className="py-1 text-right">{fp(f.a)}</td>
                  <td className="py-1 text-right">{fp(f.b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** El nombre de la serie con su trazo al lado y su cifra en tinta normal: el
 *  color identifica, no se usa para escribir. */
function Leyenda({
  color,
  texto,
  v,
  trazos,
}: {
  color: string;
  texto: string;
  v: number | null;
  trazos?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 text-fg1">
      <svg width="16" height="4" aria-hidden className="shrink-0">
        <line
          x1="0"
          y1="2"
          x2="16"
          y2="2"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={trazos ? "4 3" : undefined}
        />
      </svg>
      {texto} <strong className="text-fg0">{fp(v)}</strong>
    </span>
  );
}

// ── RENTABILIDAD POR PERIODOS ────────────────────────────────────────────

export interface PuntoPeriodo {
  clave: string;
  /** «2025», «T3 2025» */
  etiqueta: string;
  /** «desde el 25/09/23», «en curso» */
  detalle?: string;
  a: number | null;
  b: number | null;
}

/** Relleno rayado de la segunda serie, también en la leyenda: la barra del
 *  índice se distingue de la tuya aunque no se vean los colores. */
const RAYADO_B = `repeating-linear-gradient(45deg, ${COLOR_B} 0 2px, ${COLOR_B}55 2px 4px)`;

/** Cada periodo, dos barras: la tuya y la del índice, desde la línea del
 *  cero. Es la vista que contesta «¿qué año le gané y cuál no?», que en la
 *  curva acumulada no se ve: un año malo después de dos buenos sigue
 *  pareciendo una línea por encima. */
export function BarrasPeriodos({
  periodos,
  nombreA,
  nombreB,
  alto = 190,
}: {
  periodos: PuntoPeriodo[];
  nombreA: string;
  nombreB: string;
  alto?: number;
}) {
  const idTrama = useId();
  const [caja, setCaja] = useState<HTMLDivElement | null>(null);
  const ancho = useAncho(caja) || 320;
  const [marcado, setSeñalado] = useState<number | null>(null);
  if (periodos.length === 0) return null;
  // De trimestres a años hay menos barras: la señalada puede no existir ya.
  const señalado = marcado != null && marcado < periodos.length ? marcado : null;

  const A = ancho;
  const B = alto;
  const M = { arriba: 12, abajo: 20, izq: 4, der: 4 };

  const vals = periodos.flatMap((p) => [p.a, p.b]).filter((v): v is number => v != null);
  const bajo = Math.min(0, ...vals);
  const alto0 = Math.max(0, ...vals);
  const holgura = (alto0 - bajo || 1) * 0.12;
  const min = bajo < 0 ? bajo - holgura : 0;
  const max = alto0 > 0 ? alto0 + holgura : bajo < 0 ? 0 : 1;
  const rango = max - min || 1;
  const y = (v: number) => M.arriba + (1 - (v - min) / rango) * (B - M.arriba - M.abajo);

  const paso = pasoBonito(rango, 4);
  const marcas: number[] = [];
  for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9; v += paso) marcas.push(+v.toFixed(6));

  const grupo = (A - M.izq - M.der) / periodos.length;
  const barra = Math.max(3, Math.min(26, (grupo - 10) / 2));
  const x0 = (i: number) => M.izq + i * grupo + (grupo - (2 * barra + 2)) / 2;
  // Una etiqueta cada tantos grupos como hagan falta para que no se pisen.
  const cadaEtq = Math.max(1, Math.ceil(48 / grupo));

  const barraDe = (v: number | null, x: number, relleno: string) =>
    v == null ? null : (
      <rect
        x={x}
        y={Math.min(y(v), y(0))}
        width={barra}
        height={Math.max(1, Math.abs(y(v) - y(0)))}
        rx={2}
        fill={relleno}
      />
    );

  const señalar = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * A;
    const i = Math.floor((px - M.izq) / grupo);
    setSeñalado(Math.max(0, Math.min(periodos.length - 1, i)));
  };

  const p = periodos[señalado ?? periodos.length - 1];
  const dif = p.a != null && p.b != null ? p.a - p.b : null;

  return (
    <div ref={setCaja} className="w-full">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px]">
        <span className="text-fg2">
          <strong className="text-fg0">{p.etiqueta}</strong>
          {p.detalle && <> · {p.detalle}</>}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <LeyendaBarra fondo={COLOR_A} texto={nombreA} v={p.a} />
          <LeyendaBarra fondo={RAYADO_B} texto={nombreB} v={p.b} />
          {dif != null && (
            <strong className={dif >= 0 ? "text-up" : "text-dn"}>
              {dif >= 0 ? "+" : "−"}
              {Math.abs(dif).toFixed(1).replace(".", ",")} pts
            </strong>
          )}
        </span>
      </div>

      <svg
        width={A}
        height={B}
        viewBox={`0 0 ${A} ${B}`}
        className="block touch-pan-y select-none"
        role="img"
        aria-label={`${nombreA} contra ${nombreB} por periodos`}
        onPointerMove={señalar}
        onPointerDown={señalar}
        onPointerLeave={() => setSeñalado(null)}
      >
        <defs>
          <pattern
            id={idTrama}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="4" height="4" fill={COLOR_B} fillOpacity="0.33" />
            <rect width="2" height="4" fill={COLOR_B} />
          </pattern>
        </defs>

        {marcas.map((v) => (
          <line
            key={v}
            x1={M.izq}
            x2={A - M.der}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--line)"
            strokeWidth="1"
          />
        ))}

        {señalado != null && (
          <rect
            x={M.izq + señalado * grupo + 1}
            y={M.arriba - 4}
            width={Math.max(0, grupo - 2)}
            height={B - M.arriba - M.abajo + 8}
            rx={6}
            fill="var(--bg2)"
          />
        )}

        {periodos.map((q, i) => (
          <g key={q.clave}>
            {barraDe(q.a, x0(i), COLOR_A)}
            {barraDe(q.b, x0(i) + barra + 2, `url(#${idTrama})`)}
          </g>
        ))}

        <line
          x1={M.izq}
          x2={A - M.der}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--line3)"
          strokeWidth="1"
        />

        {marcas.map((v) => (
          <text
            key={`t${v}`}
            x={M.izq}
            y={y(v) - 3}
            fontSize="10"
            fill="var(--fg3)"
            stroke="var(--bg1)"
            strokeWidth="3"
            paintOrder="stroke"
          >
            {v > 0 ? "+" : ""}
            {String(v).replace(".", ",")} %
          </text>
        ))}

        {periodos.map((q, i) => {
          const ultimo = periodos.length - 1;
          // La última siempre; las demás, salteadas y sin pisarse con ella.
          if (i !== ultimo && (i % cadaEtq !== 0 || ultimo - i < cadaEtq)) return null;
          // Media etiqueta son unos 26 px: la del borde se ancla a su lado, o
          // en el móvil «T3 2026» se salía por la derecha.
          const centro = M.izq + (i + 0.5) * grupo;
          const izq = centro - 26 < M.izq;
          const der = centro + 26 > A - M.der;
          return (
            <text
              key={`e${q.clave}`}
              x={izq ? M.izq : der ? A - M.der : centro}
              y={B - 5}
              fontSize="10"
              fill={i === señalado ? "var(--fg0)" : "var(--fg3)"}
              textAnchor={izq ? "start" : der ? "end" : "middle"}
            >
              {q.etiqueta}
            </text>
          );
        })}
      </svg>

      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] font-semibold text-fg2">Ver en tabla</summary>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr className="text-left text-fg3">
                <th className="py-1 font-semibold">Periodo</th>
                <th className="py-1 text-right font-semibold">{nombreA}</th>
                <th className="py-1 text-right font-semibold">{nombreB}</th>
                <th className="py-1 text-right font-semibold">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {periodos.map((q) => {
                const d = q.a != null && q.b != null ? q.a - q.b : null;
                return (
                  <tr key={q.clave} className="border-t border-line text-fg1">
                    <td className="py-1">
                      {q.etiqueta}
                      {q.detalle && <span className="text-fg3"> · {q.detalle}</span>}
                    </td>
                    <td className="py-1 text-right">{fp(q.a)}</td>
                    <td className="py-1 text-right">{fp(q.b)}</td>
                    <td
                      className={`py-1 text-right font-bold ${
                        d == null ? "text-fg3" : d >= 0 ? "text-up" : "text-dn"
                      }`}
                    >
                      {d == null ? "—" : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1).replace(".", ",")} pts`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function LeyendaBarra({ fondo, texto, v }: { fondo: string; texto: string; v: number | null }) {
  return (
    <span className="flex items-center gap-1.5 text-fg1">
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: fondo }} />
      {texto} <strong className="text-fg0">{fp(v)}</strong>
    </span>
  );
}

// ── SERIE TEMPORAL ───────────────────────────────────────────────────────

export interface PuntoSerie {
  /** ISO `YYYY-MM-DD` */
  fecha: string;
  valor: number;
  /** Segunda línea: el dinero aportado */
  base?: number;
}

/** Patrimonio contra dinero aportado. Dos líneas y un relleno entre ellas:
 *  el hueco ES la ganancia, que es justo lo que se quiere ver.
 *
 *  Un solo eje, siempre. Dos escalas distintas en el mismo gráfico es la
 *  manera más rápida de contar una mentira sin querer.
 *
 *  Al pasar el ratón —o el dedo, o las flechas del teclado— un recuadro al
 *  lado del cursor con las tres cifras de esa semana. Con `onSeleccion`,
 *  arrastrar elige un tramo para acercarlo. */
export function Serie({
  puntos,
  alto = 170,
  onDobleClic,
  onSeleccion,
  pista,
}: {
  puntos: PuntoSerie[];
  alto?: number;
  onDobleClic?: () => void;
  /** Tramo elegido arrastrando con el ratón: índices de `puntos` */
  onSeleccion?: (desde: number, hasta: number) => void;
  /** Lo que se puede hacer con él, al pie */
  pista?: string;
}) {
  const idFill = useId();
  const [caja, setCaja] = useState<HTMLDivElement | null>(null);
  const ancho = useAncho(caja) || 320;
  const [marcado, setSeñalado] = useState<number | null>(null);
  const [arrastre, setArrastre] = useState<{ desde: number; hasta: number } | null>(null);

  if (puntos.length < 2) {
    return (
      <div className="flex h-[120px] items-center justify-center text-[12px] text-fg2">
        Aún no hay días suficientes para dibujar la evolución.
      </div>
    );
  }

  const n = puntos.length;
  // La semana señalada es un índice: al acercar un tramo la serie se queda
  // más corta, y la que estaba señalada puede no existir ya.
  const señalado = marcado != null && marcado < n ? marcado : null;
  const A = ancho;
  const B = alto;
  const M = { arriba: 10, abajo: 20, izq: 4, der: 4 };

  const valores = puntos.flatMap((p) => (p.base != null ? [p.valor, p.base] : [p.valor]));
  const bajo = Math.min(...valores);
  const alto0 = Math.max(...valores);
  const holgura = (alto0 - bajo || Math.abs(alto0) || 1) * 0.08;
  const min = bajo >= 0 ? Math.max(0, bajo - holgura) : bajo - holgura;
  const max = alto0 + holgura;
  const rango = max - min || 1;

  const x = (i: number) => M.izq + (i / (n - 1)) * (A - M.izq - M.der);
  const y = (v: number) => M.arriba + (1 - (v - min) / rango) * (B - M.arriba - M.abajo);

  const paso = pasoBonito(rango, 4);
  const marcas: number[] = [];
  for (let v = Math.ceil(min / paso) * paso; v <= max; v += paso) marcas.push(v);

  const linea = (sel: (p: PuntoSerie) => number) =>
    puntos.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(" ");

  const hayBase = puntos.some((p) => p.base != null);
  const area = hayBase
    ? `${linea((p) => p.valor)} ` +
      puntos
        .map(
          (_, i) =>
            `L${x(n - 1 - i).toFixed(1)},${y(puntos[n - 1 - i].base ?? 0).toFixed(1)}`,
        )
        .join(" ") +
      " Z"
    : "";

  // Las fechas del eje: tres en el móvil, cinco con sitio.
  const dias = (Date.parse(puntos[n - 1].fecha) - Date.parse(puntos[0].fecha)) / 86400e3;
  const corto = dias < 120;
  const nEtq = A < 420 ? 3 : 5;
  const etiquetasX = [
    ...new Set(Array.from({ length: nEtq }, (_, k) => Math.round((k / (nEtq - 1)) * (n - 1)))),
  ];

  const indice = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * A;
    const i = Math.round(((px - M.izq) / (A - M.izq - M.der)) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  };

  const tecla = (e: KeyboardEvent<HTMLDivElement>) => {
    const s = señalado ?? n - 1;
    const nuevo =
      e.key === "ArrowLeft"
        ? Math.max(0, s - 1)
        : e.key === "ArrowRight"
          ? Math.min(n - 1, s + 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : undefined;
    if (nuevo != null) {
      e.preventDefault();
      setSeñalado(nuevo);
    } else if (e.key === "Escape") {
      setSeñalado(null);
    } else if (e.key === "Enter" && onDobleClic) {
      onDobleClic();
    }
  };

  const p = puntos[señalado ?? n - 1];
  const ganancia = p.base != null ? p.valor - p.base : null;
  const gananciaPct = ganancia != null && p.base != null && p.base > 0 ? (ganancia / p.base) * 100 : null;

  // El recuadro va al lado del cursor, hacia donde haya sitio.
  const xs = señalado != null ? x(señalado) : 0;
  const aLaDerecha = xs < A * 0.58;
  const tramo = arrastre
    ? [Math.min(arrastre.desde, arrastre.hasta), Math.max(arrastre.desde, arrastre.hasta)]
    : null;

  return (
    <div
      ref={setCaja}
      tabIndex={0}
      onKeyDown={tecla}
      aria-label={`Patrimonio ${fe(puntos[n - 1].valor, 0)}${
        puntos[n - 1].base != null ? `, aportado ${fe(puntos[n - 1].base, 0)}` : ""
      }. Flechas para recorrer las semanas${onDobleClic ? ", Intro para ampliar" : ""}.`}
      className="w-full rounded-tile outline-none focus-visible:ring-2 focus-visible:ring-blue/40"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-fg2">{señalado == null ? "Hoy" : fdl(p.fecha)}</span>
        <span className="flex items-center gap-2">
          <span className="font-bold text-fg0">{fe(p.valor, 0)}</span>
          {ganancia != null && (
            <span className={ganancia >= 0 ? "font-bold text-up" : "font-bold text-dn"}>
              {feSigno(ganancia)}
            </span>
          )}
        </span>
      </div>

      <div className="relative">
        <svg
          width={A}
          height={B}
          viewBox={`0 0 ${A} ${B}`}
          className={`block touch-pan-y select-none ${onSeleccion ? "cursor-crosshair" : ""}`}
          onPointerDown={(e) => {
            const i = indice(e);
            setSeñalado(i);
            if (onSeleccion && e.pointerType === "mouse" && e.button === 0) {
              e.currentTarget.setPointerCapture(e.pointerId);
              setArrastre({ desde: i, hasta: i });
            }
          }}
          onPointerMove={(e) => {
            const i = indice(e);
            setSeñalado(i);
            if (arrastre) setArrastre({ desde: arrastre.desde, hasta: i });
          }}
          onPointerUp={() => {
            if (tramo && onSeleccion && tramo[1] - tramo[0] >= 2) onSeleccion(tramo[0], tramo[1]);
            setArrastre(null);
          }}
          onPointerCancel={() => setArrastre(null)}
          onPointerLeave={() => {
            if (!arrastre) setSeñalado(null);
          }}
          onDoubleClick={onDobleClic}
        >
          <defs>
            <linearGradient id={idFill} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--blue)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {marcas.map((v) => (
            <line
              key={v}
              x1={M.izq}
              x2={A - M.der}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--line)"
              strokeWidth="1"
            />
          ))}

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
          <path
            d={linea((q) => q.valor)}
            fill="none"
            stroke="var(--blue)"
            strokeWidth="2"
            strokeLinejoin="round"
          />

          {marcas.map((v) => (
            <text
              key={`t${v}`}
              x={M.izq}
              y={y(v) - 3}
              fontSize="10"
              fill="var(--fg3)"
              stroke="var(--bg1)"
              strokeWidth="3"
              paintOrder="stroke"
            >
              {eurCorto(v)}
            </text>
          ))}

          {etiquetasX.map((i, k) => (
            <text
              key={`x${i}`}
              x={x(i)}
              y={B - 5}
              fontSize="10"
              fill="var(--fg3)"
              textAnchor={k === 0 ? "start" : k === etiquetasX.length - 1 ? "end" : "middle"}
            >
              {i === n - 1 && !corto ? "hoy" : fechaEje(puntos[i].fecha, corto)}
            </text>
          ))}

          {tramo && (
            <rect
              x={x(tramo[0])}
              y={M.arriba}
              width={Math.max(1, x(tramo[1]) - x(tramo[0]))}
              height={B - M.arriba - M.abajo}
              fill="var(--blue)"
              fillOpacity="0.1"
              stroke="var(--blue)"
              strokeOpacity="0.5"
            />
          )}

          {señalado != null && (
            <>
              <line
                x1={xs}
                y1={M.arriba}
                x2={xs}
                y2={B - M.abajo}
                stroke="var(--line3)"
                strokeWidth="1"
              />
              {p.base != null && (
                <circle
                  cx={xs}
                  cy={y(p.base)}
                  r="3.5"
                  fill="var(--fg3)"
                  stroke="var(--bg1)"
                  strokeWidth="2"
                />
              )}
              {/* Anillo del color del fondo: separa el punto de la línea */}
              <circle
                cx={xs}
                cy={y(p.valor)}
                r="4.5"
                fill="var(--blue)"
                stroke="var(--bg1)"
                strokeWidth="2"
              />
            </>
          )}
        </svg>

        {señalado != null && (
          <div
            className="pointer-events-none absolute z-10 min-w-[150px] rounded-tile border border-line bg-bg1 px-3 py-2 text-[11px] shadow-e2"
            style={{
              top: M.arriba,
              ...(aLaDerecha ? { left: xs + 12 } : { right: A - xs + 12 }),
            }}
          >
            <p className="mb-1 font-bold text-fg0">{fdl(p.fecha)}</p>
            <p className="flex justify-between gap-3 text-fg1">
              <span className="flex items-center gap-1.5">
                <span className="h-[2px] w-3 rounded-full bg-blue" /> Patrimonio
              </span>
              <strong className="text-fg0">{fe(p.valor, 0)}</strong>
            </p>
            {p.base != null && (
              <p className="flex justify-between gap-3 text-fg1">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 border-t-2 border-dashed border-fg3" /> Aportado
                </span>
                <strong className="text-fg0">{fe(p.base, 0)}</strong>
              </p>
            )}
            {ganancia != null && (
              <p className="mt-1 flex justify-between gap-3 border-t border-line pt-1 text-fg1">
                Ganancia
                <strong className={ganancia >= 0 ? "text-up" : "text-dn"}>
                  {feSigno(ganancia)}
                  {gananciaPct != null && ` · ${fp(gananciaPct)}`}
                </strong>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg2">
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-4 rounded-full bg-blue" /> Patrimonio
        </span>
        {hayBase && (
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-fg3" />
            Dinero aportado
          </span>
        )}
        {/* Pistas de ratón: en el móvil no hay doble clic ni arrastre, y
            para ampliar ya está el botón. */}
        {pista && <span className="ml-auto hidden text-fg3 sm:inline">{pista}</span>}
      </div>
    </div>
  );
}

// ── LA SERIE, AMPLIADA ───────────────────────────────────────────────────

type Tramo = "1m" | "3m" | "6m" | "1a" | "todo";
const DIAS_TRAMO: Record<Exclude<Tramo, "todo">, number> = {
  "1m": 31,
  "3m": 92,
  "6m": 183,
  "1a": 366,
};

const altoAmpliado = () =>
  Math.round(Math.max(220, Math.min(480, (typeof window === "undefined" ? 760 : window.innerHeight) - 290)));

/** El mismo gráfico a pantalla completa. Un tramo por botones —el último
 *  mes, el último año…— y, con ratón, el que se quiera arrastrando sobre él;
 *  doble clic lo devuelve entero. Arriba, lo que ha pasado en ese tramo: lo
 *  que ha crecido, lo que pusiste y lo que ganaste. */
export function SerieAmpliada({
  puntos,
  titulo,
  onCerrar,
}: {
  puntos: PuntoSerie[];
  titulo: string;
  onCerrar: () => void;
}) {
  const [tramo, setTramo] = useState<Tramo>("todo");
  /** Índices dentro del tramo, [desde, hasta] */
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [alto, setAlto] = useState(altoAmpliado);

  useEffect(() => {
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    const medir = () => setAlto(altoAmpliado());
    window.addEventListener("keydown", tecla);
    window.addEventListener("resize", medir);
    // Que la página de detrás no se desplace con la rueda.
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", medir);
      document.body.style.overflow = antes;
    };
  }, [onCerrar]);

  const base = useMemo(() => {
    if (tramo === "todo" || puntos.length === 0) return puntos;
    const fin = Date.parse(puntos[puntos.length - 1].fecha);
    const corte = new Date(fin - DIAS_TRAMO[tramo] * 86400e3).toISOString().slice(0, 10);
    // Con el punto de antes del corte: si no, la línea empezaría en el aire.
    const i = puntos.findIndex((p) => p.fecha >= corte);
    return i < 0 ? puntos : puntos.slice(Math.max(0, i - 1));
  }, [puntos, tramo]);
  const vista = zoom ? base.slice(zoom[0], zoom[1] + 1) : base;

  const primero = vista[0];
  const ultimo = vista[vista.length - 1];
  const dValor = ultimo && primero ? ultimo.valor - primero.valor : 0;
  const dAportado = ultimo && primero ? (ultimo.base ?? 0) - (primero.base ?? 0) : 0;
  const dGanancia = dValor - dAportado;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onCerrar}
        className="absolute inset-0 bg-[rgba(20,16,40,.45)] backdrop-blur-[2px]"
      />
      <div className="relative flex w-full max-w-[1000px] flex-col gap-3 overflow-y-auto bg-bg1 px-4 py-4 shadow-e3 sm:rounded-sheet sm:border sm:border-line sm:px-6 sm:py-5">
        <header className="flex items-center justify-between gap-3">
          <h3 className="font-disp text-[15px] font-bold text-fg0">{titulo}</h3>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-full p-1.5 text-fg2 transition-colors hover:bg-bg2 hover:text-fg0"
            aria-label="Cerrar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
              <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmentos
            valor={tramo}
            onChange={(t) => {
              setTramo(t);
              setZoom(null);
            }}
            opciones={[
              { valor: "1m", texto: "1M" },
              { valor: "3m", texto: "3M" },
              { valor: "6m", texto: "6M" },
              { valor: "1a", texto: "1A" },
              { valor: "todo", texto: "Todo" },
            ]}
          />
          {zoom && (
            <button
              type="button"
              onClick={() => setZoom(null)}
              className="text-[12px] font-semibold text-blue"
            >
              Ver el tramo entero
            </button>
          )}
        </div>

        {primero && ultimo && vista.length > 1 && (
          <p className="text-[12px] leading-relaxed text-fg1">
            Del {fdl(primero.fecha)} al {fdl(ultimo.fecha)}: el patrimonio{" "}
            <strong className="text-fg0">{feSigno(dValor)}</strong>, de lo que aportaste{" "}
            <strong className="text-fg0">{feSigno(dAportado)}</strong>. Ganancia en el tramo:{" "}
            <strong className={dGanancia >= 0 ? "text-up" : "text-dn"}>{feSigno(dGanancia)}</strong>.
          </p>
        )}

        <Serie
          puntos={vista}
          alto={alto}
          onSeleccion={(a, b) =>
            setZoom((z) => {
              const z0 = z ? z[0] : 0;
              return [z0 + a, z0 + b];
            })
          }
          onDobleClic={() => setZoom(null)}
          pista="Arrastra para acercar un tramo · doble clic para verlo entero"
        />
      </div>
    </div>
  );
}
