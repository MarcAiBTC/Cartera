// ── PIEZAS COMUNES ───────────────────────────────────────────────────────
// Lo que se repite en todas las pantallas. Nada de esto sabe de cartera: son
// formas, no datos.

import type { ReactNode } from "react";
import { fe, fp, signo } from "../lib/formato";

export function Tarjeta({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <Tag className={`card p-4 ${className}`}>{children}</Tag>;
}

/** El rótulo pequeño en versalitas que abre cada bloque. */
export function Etiqueta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`lbl ${className}`}>{children}</div>;
}

export function TituloSeccion({
  children,
  extra,
  nota,
}: {
  children: ReactNode;
  extra?: ReactNode;
  nota?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <div>
        <h2 className="font-disp text-[15px] font-bold tracking-tight text-fg0">{children}</h2>
        {nota && <p className="mt-0.5 text-[11px] leading-snug text-fg2">{nota}</p>}
      </div>
      {extra}
    </div>
  );
}

/** Un importe con su color según el signo. El neutro no se pinta de verde: un
 *  0,00 € en verde se lee como una ganancia que no existe. */
export function Delta({
  valor,
  pct,
  className = "",
  tamano = "sm",
}: {
  valor: number | null | undefined;
  pct?: number | null;
  className?: string;
  tamano?: "sm" | "md";
}) {
  const s = signo(valor);
  const color = s === "up" ? "text-up" : s === "dn" ? "text-dn" : "text-fg2";
  const signoTexto = valor != null && valor > 0 ? "+" : "";
  return (
    <span
      className={`${color} ${tamano === "md" ? "text-base" : "text-[13px]"} font-bold ${className}`}
    >
      {valor == null ? "—" : signoTexto + fe(valor)}
      {pct != null && isFinite(pct) && (
        <span className="ml-1.5 opacity-70">({fp(pct)})</span>
      )}
    </span>
  );
}

/** Pastilla de porcentaje, para las tablas donde no cabe el importe. */
export function Pastilla({ pct }: { pct: number | null | undefined }) {
  const s = signo(pct);
  const clase =
    s === "up"
      ? "bg-up-bg text-up"
      : s === "dn"
        ? "bg-dn-bg text-dn"
        : "bg-bg2 text-fg2";
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${clase}`}>{fp(pct)}</span>
  );
}

export function Boton({
  children,
  onClick,
  tipo = "normal",
  disabled,
  submit,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  tipo?: "normal" | "principal" | "suave" | "peligro";
  disabled?: boolean;
  submit?: boolean;
  className?: string;
}) {
  const estilos = {
    principal: "bg-fg0 text-bg1 hover:opacity-90",
    normal: "bg-bg1 text-fg0 border border-line2 hover:border-line3",
    suave: "bg-bg2 text-fg1 hover:bg-bg3",
    peligro: "bg-dn-bg text-dn hover:brightness-95",
  }[tipo];

  return (
    <button
      type={submit ? "submit" : "button"}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-field px-4 py-2.5 text-[13px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-45 ${estilos} ${className}`}
    >
      {children}
    </button>
  );
}

export function Campo({
  etiqueta,
  valor,
  onChange,
  tipo = "text",
  placeholder,
  sufijo,
  autoFocus,
  paso,
  nota,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  tipo?: "text" | "number" | "date" | "email" | "password";
  placeholder?: string;
  sufijo?: string;
  autoFocus?: boolean;
  paso?: string;
  nota?: string;
}) {
  return (
    <label className="block">
      <span className="lbl mb-1 block">{etiqueta}</span>
      <span className="relative flex items-center">
        <input
          type={tipo}
          value={valor}
          step={paso}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          // `inputMode` decimal saca el teclado numérico en el móvil, que es
          // donde de verdad se apunta una compra.
          inputMode={tipo === "number" ? "decimal" : undefined}
          className="w-full rounded-field border border-line2 bg-bg1 px-3 py-2.5 text-[14px] text-fg0 outline-none transition-colors placeholder:text-fg3 focus:border-blue"
        />
        {sufijo && (
          <span className="pointer-events-none absolute right-3 text-[12px] font-semibold text-fg3">
            {sufijo}
          </span>
        )}
      </span>
      {nota && <span className="mt-1 block text-[11px] text-fg2">{nota}</span>}
    </label>
  );
}

export function Selector<T extends string>({
  etiqueta,
  valor,
  opciones,
  onChange,
}: {
  etiqueta?: string;
  valor: T;
  opciones: { valor: T; texto: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="block">
      {etiqueta && <span className="lbl mb-1 block">{etiqueta}</span>}
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full appearance-none rounded-field border border-line2 bg-bg1 px-3 py-2.5 text-[14px] text-fg0 outline-none focus:border-blue"
      >
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Selector en segmentos, para elegir entre dos o tres vistas de lo mismo. */
export function Segmentos<T extends string>({
  valor,
  opciones,
  onChange,
}: {
  valor: T;
  opciones: { valor: T; texto: string; titulo?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-field border border-line2 bg-bg2 p-0.5">
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          title={o.titulo}
          aria-pressed={o.valor === valor}
          onClick={() => onChange(o.valor)}
          className={`flex-1 rounded-[9px] px-2.5 py-1.5 text-[11px] font-bold transition-all ${
            o.valor === valor
              ? "bg-bg1 text-blue shadow-e1"
              : "text-fg2 hover:text-fg0"
          }`}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

export function Vacio({
  titulo,
  texto,
  accion,
}: {
  titulo: string;
  texto?: string;
  accion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line2 px-6 py-10 text-center">
      <p className="font-disp text-[15px] font-bold text-fg1">{titulo}</p>
      {texto && <p className="max-w-[38ch] text-[12px] leading-relaxed text-fg2">{texto}</p>}
      {accion && <div className="mt-2">{accion}</div>}
    </div>
  );
}

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-[12px] text-fg2">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-line3 border-t-blue" />
      {texto}
    </div>
  );
}

/** Hoja que sube desde abajo. En el móvil es el gesto natural para un
 *  formulario corto; en el escritorio se queda centrada como un diálogo. */
export function Hoja({
  abierta,
  titulo,
  onCerrar,
  children,
  pie,
}: {
  abierta: boolean;
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
  pie?: ReactNode;
}) {
  if (!abierta) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        aria-label="Cerrar"
        onClick={onCerrar}
        className="absolute inset-0 bg-[rgba(20,16,40,.45)] backdrop-blur-[2px]"
      />
      <div className="relative flex max-h-[92dvh] w-full max-w-[520px] flex-col rounded-t-sheet border border-line bg-bg1 shadow-e3 sm:rounded-sheet">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-disp text-[15px] font-bold text-fg0">{titulo}</h3>
          <button
            onClick={onCerrar}
            className="rounded-full p-1.5 text-fg2 transition-colors hover:bg-bg2 hover:text-fg0"
            aria-label="Cerrar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
              <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {pie && <footer className="border-t border-line px-5 py-3">{pie}</footer>}
      </div>
    </div>
  );
}

/** Aviso corto. Se usa para lo que el usuario tiene que saber pero no puede
 *  arreglar ahora mismo (precios viejos, importación parcial…). */
export function Aviso({
  children,
  tono = "info",
}: {
  children: ReactNode;
  tono?: "info" | "alerta" | "error";
}) {
  const clase = {
    info: "border-line2 bg-bg2 text-fg1",
    alerta: "border-[color:var(--gold)] bg-[color-mix(in_srgb,var(--gold)_12%,transparent)] text-fg0",
    error: "border-dn bg-dn-bg text-fg0",
  }[tono];
  return (
    <div className={`rounded-tile border px-3 py-2 text-[12px] leading-relaxed ${clase}`}>
      {children}
    </div>
  );
}
