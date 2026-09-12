// ── PIEZAS DE LA LISTA DE POSICIONES ─────────────────────────────────────
// Lo que comparten Inicio y Historial: las píldoras de orden, la sigla de
// cada activo y el importe con su color.

import { CAT_COLOR, type Activo } from "../lib/tipos";
import { catConocida, esLiquidez, type OrdenPosiciones } from "../lib/cartera";
import { ORDENES } from "../lib/prefPosiciones";
import { fe, fp, signo } from "../lib/formato";

/** Los órdenes, en píldoras que se deslizan si no caben. */
export function Orden({
  orden,
  asc,
  onElegir,
}: {
  orden: OrdenPosiciones;
  asc: boolean;
  onElegir: (o: OrdenPosiciones) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Ordenar las posiciones"
      className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]"
    >
      {ORDENES.map((o) => {
        const activo = o.valor === orden;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={activo}
            aria-label={
              activo ? `${o.texto}, ${asc ? "de menor a mayor" : "de mayor a menor"}` : o.texto
            }
            onClick={() => onElegir(o.valor)}
            className={`shrink-0 rounded-full border px-3 py-1 text-[11.5px] font-bold transition-colors ${
              activo
                ? "border-transparent bg-fg0 text-bg1"
                : "border-line2 bg-bg1 text-fg2 hover:text-fg0"
            }`}
          >
            {o.texto}
            {activo && <span aria-hidden> {asc ? "↑" : "↓"}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Un importe con su porcentaje, en su color. Sin dato, un guion. Por
 *  debajo de 10 €, con céntimos: si no, 47 céntimos de pérdida se leen
 *  «−0 €». */
export function Cambio({
  v,
  pct,
  className = "text-[11px]",
}: {
  v: number | null | undefined;
  pct?: number | null;
  className?: string;
}) {
  if (v == null || !isFinite(v)) return <span className={`${className} font-bold text-fg3`}>—</span>;
  const s = signo(v);
  const color = s === "up" ? "text-up" : s === "dn" ? "text-dn" : "text-fg2";
  return (
    <span className={`${className} font-bold ${color}`}>
      {s === "up" ? "+" : ""}
      {fe(v, Math.abs(v) < 10 ? 2 : 0)}
      {pct != null && isFinite(pct) ? ` (${fp(pct)})` : ""}
    </span>
  );
}

/** Las letras del activo en un círculo de su color: lo que en getquin es el
 *  logo. El ticker si es legible; si es un código de Morningstar o un ISIN,
 *  las iniciales del nombre. */
function sigla(a: Activo): string {
  if (esLiquidez(a)) return "€";
  const t = a.ticker?.trim().toUpperCase() ?? "";
  if (t && !t.startsWith("0P") && !/^[A-Z]{2}[A-Z0-9]{9}\d/.test(t)) {
    return t.split(/[.\-=]/)[0].slice(0, 4);
  }
  const palabras = a.name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (
    palabras
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "·"
  );
}

export function Sigla({ a }: { a: Activo }) {
  const color = CAT_COLOR[catConocida(a.cat)] ?? CAT_COLOR.otro;
  const s = sigla(a);
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-disp font-bold tracking-tight"
      style={{
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        fontSize: s.length > 3 ? 8.5 : 10.5,
      }}
    >
      {s}
    </span>
  );
}
