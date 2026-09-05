// ── LEER ARCHIVOS DE BRÓKER ──────────────────────────────────────────────
// Un extracto real no es un CSV de manual: llega con punto y coma, con comas
// decimales, con campos entrecomillados que contienen el separador dentro, con
// BOM delante y con la fecha en tres formatos distintos según el país del
// bróker. Todo eso se resuelve aquí, una sola vez, para que cada adaptador se
// ocupe sólo de lo suyo: qué significa cada columna.

/** Quita el BOM y normaliza los saltos de línea. Sin el BOM fuera, la primera
 *  cabecera se lee con un carácter invisible delante y no casa con nada. */
export function limpiar(texto: string): string {
  return texto.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/** Adivina el separador contando cuál aparece el mismo número de veces en las
 *  primeras filas: el separador de verdad es regular, los demás no. */
export function separador(lineas: string[]): string {
  const candidatos = [";", ",", "\t", "|"];
  const muestra = lineas.slice(0, 8).filter((l) => l.trim());
  let mejor = ",";
  let mejorNota = -1;

  for (const sep of candidatos) {
    const cuentas = muestra.map((l) => partir(l, sep).length);
    if (cuentas.length === 0 || cuentas[0] < 2) continue;
    const regular = cuentas.every((c) => c === cuentas[0]);
    // Más columnas gana, pero sólo si el recuento es constante.
    const nota = (regular ? 100 : 0) + cuentas[0];
    if (nota > mejorNota) {
      mejorNota = nota;
      mejor = sep;
    }
  }
  return mejor;
}

/** Parte una línea respetando las comillas: `"Apple, Inc.";10` son 2 campos. */
export function partir(linea: string, sep: string): string[] {
  const campos: string[] = [];
  let actual = "";
  let comillas = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      // Dos comillas seguidas dentro de un campo son una comilla literal.
      if (comillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        comillas = !comillas;
      }
    } else if (c === sep && !comillas) {
      campos.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos.map((c) => c.trim());
}

export interface Tabla {
  cabeceras: string[];
  /** Cada fila ya emparejada con su cabecera, en minúsculas */
  filas: Record<string, string>[];
  /** Número de línea del archivo, para poder señalar el origen de un descarte */
  lineas: number[];
  separador: string;
}

/** Convierte el texto en filas con nombre. Las cabeceras se normalizan a
 *  minúsculas y sin comillas para que los adaptadores no tengan que repetir
 *  la misma limpieza. */
export function tabular(texto: string): Tabla {
  const lineas = limpiar(texto).split("\n");
  const sep = separador(lineas);
  const primera = lineas.findIndex((l) => l.trim());
  if (primera < 0) return { cabeceras: [], filas: [], lineas: [], separador: sep };

  const cabeceras = partir(lineas[primera], sep).map((c) =>
    c.replace(/^"|"$/g, "").toLowerCase().trim(),
  );

  const filas: Record<string, string>[] = [];
  const nums: number[] = [];
  for (let i = primera + 1; i < lineas.length; i++) {
    if (!lineas[i].trim()) continue;
    const campos = partir(lineas[i], sep);
    const fila: Record<string, string> = {};
    cabeceras.forEach((c, j) => {
      fila[c] = (campos[j] ?? "").replace(/^"|"$/g, "").trim();
    });
    filas.push(fila);
    nums.push(i + 1);
  }

  return { cabeceras, filas, lineas: nums, separador: sep };
}

// ── NÚMEROS ──────────────────────────────────────────────────────────────

/** Un importe tal y como lo escribe un bróker.
 *
 *  `1.234,56` (España), `1,234.56` (anglosajón), `1234.56`, `-12,50 €`,
 *  `(45,20)` para negativo contable y `1 234,56` con espacio fino de millares.
 *  La regla que lo desambigua: el ÚLTIMO separador que aparece es el decimal. */
export function num(v: unknown): number | undefined {
  if (typeof v === "number") return isFinite(v) ? v : undefined;
  if (v == null) return undefined;

  let t = String(v).trim();
  if (!t) return undefined;

  // Negativo contable
  let negativo = false;
  if (/^\(.*\)$/.test(t)) {
    negativo = true;
    t = t.slice(1, -1);
  }

  // Fuera símbolos de divisa, espacios de millares y el signo de porcentaje
  t = t.replace(/[\u20ac$\u00a3%\s\u00a0\u202f]/g, "").replace(/[A-Za-z]/g, "");
  if (!t || t === "-" || t === "+") return undefined;

  const ultimaComa = t.lastIndexOf(",");
  const ultimoPunto = t.lastIndexOf(".");

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    // El último manda: el otro es separador de millares.
    if (ultimaComa > ultimoPunto) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (ultimaComa >= 0) {
    // Una sola coma: decimal si deja 1 o 2 cifras detrás (`1,5` / `1,50`);
    // con tres detrás es un millar (`1,234`).
    const detras = t.length - ultimaComa - 1;
    t = detras === 3 ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (ultimoPunto >= 0) {
    const detras = t.length - ultimoPunto - 1;
    // `1.234` en un extracto español son mil doscientos treinta y cuatro.
    if (detras === 3 && (t.match(/\./g) ?? []).length >= 1 && t.length > 5) {
      t = t.replace(/\./g, "");
    }
  }

  const n = Number(t);
  if (!isFinite(n)) return undefined;
  return negativo ? -n : n;
}

// ── FECHAS ───────────────────────────────────────────────────────────────

export type OrdenFecha = "dmy" | "mdy" | "auto";

/** Normaliza cualquier fecha de extracto a `YYYY-MM-DD`.
 *
 *  `orden` desambigua `03/04/2026`: los brókeres españoles y alemanes escriben
 *  día primero; Revolut, mes primero. Cuando el primer número es mayor que 12
 *  no hay ambigüedad y se ignora la pista. */
export function fecha(v: unknown, orden: OrdenFecha = "dmy"): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date && isFinite(v.getTime())) return iso(v);

  const t = String(v).trim();
  if (!t) return undefined;

  // ISO, con o sin hora: 2026-09-05, 2026-09-05T14:32:00Z
  const m1 = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;

  // dd/mm/yyyy · dd.mm.yyyy · dd-mm-yy
  const m2 = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m2) {
    let a = Number(m2[1]);
    let b = Number(m2[2]);
    const anio = Number(m2[3].length === 2 ? "20" + m2[3] : m2[3]);
    const mesPrimero = a > 12 ? false : b > 12 ? true : orden === "mdy";
    if (mesPrimero) [a, b] = [b, a];
    if (a < 1 || a > 31 || b < 1 || b > 12) return undefined;
    return `${anio}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
  }

  // Último recurso: que lo intente el navegador (formatos con nombre de mes)
  const t2 = Date.parse(t);
  return isFinite(t2) ? iso(new Date(t2)) : undefined;
}

function iso(d: Date): string {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

// ── ACCESO TOLERANTE A COLUMNAS ──────────────────────────────────────────

/** Busca el primer alias que exista en la fila. La comparación ignora
 *  mayúsculas, acentos y espacios: «Fecha Valor» encuentra «fecha valor». */
export function campo(fila: Record<string, string>, ...alias: string[]): string | undefined {
  const claves = Object.keys(fila);
  for (const a of alias) {
    const objetivo = normaliza(a);
    const k = claves.find((c) => normaliza(c) === objetivo);
    if (k != null && fila[k] !== "") return fila[k];
  }
  // Segunda pasada, más laxa: la cabecera CONTIENE el alias.
  for (const a of alias) {
    const objetivo = normaliza(a);
    const k = claves.find((c) => normaliza(c).includes(objetivo));
    if (k != null && fila[k] !== "") return fila[k];
  }
  return undefined;
}

export function normaliza(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Un ISIN son 2 letras de país + 9 alfanuméricos + 1 dígito de control. */
export const ES_ISIN = (s: string | undefined): boolean =>
  s != null && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(s.trim().toUpperCase());
