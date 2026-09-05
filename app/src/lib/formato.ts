// ── FORMATO ──────────────────────────────────────────────────────────────
// Portado tal cual de index.html:2523-2532. El guion largo «—» para el valor
// ausente es deliberado: un 0 € donde no hay dato se lee como un dato.

const SIM_DIVISA: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF" };

const nf = (d: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Importe en euros: `1.234,56 €` */
export function fe(n: number | null | undefined, d = 2): string {
  if (n == null || !isFinite(n)) return "—";
  return nf(d).format(n) + " €";
}

/** Importe en su propia divisa */
export function fcur(n: number | null | undefined, divisa = "EUR", d = 2): string {
  if (n == null || !isFinite(n)) return "—";
  const c = (divisa || "EUR").toUpperCase();
  return nf(d).format(n) + " " + (SIM_DIVISA[c] || c);
}

/** Porcentaje con signo siempre visible: `+3,20%` */
export function fp(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2).replace(".", ",") + "%";
}

/** Porcentaje sin signo, para pesos */
export function fpc(n: number | null | undefined, d = 1): string {
  if (n == null || !isFinite(n)) return "—";
  return nf(d).format(n) + "%";
}

/** Número con los decimales justos: quita los ceros de la derecha */
export function fn(n: number | null | undefined, d = 6): string {
  if (n == null || !isFinite(n)) return "—";
  return parseFloat(n.toFixed(d)).toLocaleString("es-ES", { maximumFractionDigits: d });
}

/** Fecha corta `05/09/26` a partir de un ISO `YYYY-MM-DD` */
export function fd(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  if (!a || !m || !d) return "—";
  return `${d}/${m}/${a.slice(2)}`;
}

/** Fecha larga `5 sept 2026` */
export function fdl(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso.slice(0, 10));
  if (!isFinite(t)) return "—";
  return new Date(t).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Hoy en ISO, en hora local (no UTC: a las 01:00 de Madrid `toISOString` da ayer). */
export function hoyISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/** Clase de color según el signo. Null no es ni verde ni rojo. */
export function signo(n: number | null | undefined): "up" | "dn" | "neutro" {
  if (n == null || !isFinite(n) || Math.abs(n) < 0.005) return "neutro";
  return n > 0 ? "up" : "dn";
}
