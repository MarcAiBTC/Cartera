// ── CUALQUIER OTRO BRÓKER ────────────────────────────────────────────────
// Un CSV, TSV o Excel de cualquier sitio. Primero se intenta adivinar qué
// columna es cada cosa por su nombre; lo que no se adivine, la pantalla de
// importación deja elegirlo a mano.
//
// Ese mapeo manual es la diferencia con la mayoría de importadores, que ante
// una cabecera rara se rinden y te mandan a editar el archivo.

import { campo, fecha, num, type OrdenFecha, type Tabla } from "./csv";
import { clasificar, lecturaVacia, type Descarte, type FilaImportada, type Lectura } from "./tipos";

export type CampoImport =
  | "fecha"
  | "tipo"
  | "isin"
  | "ticker"
  | "nombre"
  | "cantidad"
  | "precio"
  | "total"
  | "comision"
  | "divisa";

/** Alias por campo. El primero que aparezca en la cabecera gana. */
export const ALIAS: Record<CampoImport, string[]> = {
  fecha: ["fecha", "date", "trade date", "fecha valor", "timestamp", "fecha de la operación"],
  tipo: ["tipo", "type", "activity type", "transaction", "action", "operación", "concepto"],
  isin: ["isin"],
  ticker: ["ticker", "symbol", "símbolo", "product", "producto"],
  nombre: ["nombre", "name", "description", "descripción", "instrumento"],
  cantidad: ["cantidad", "quantity", "shares", "units", "participaciones", "títulos"],
  precio: ["precio", "price", "unit price", "valor liquidativo"],
  total: ["total", "amount", "importe", "value", "efectivo"],
  comision: ["comisión", "comision", "fees", "fee", "commission", "gastos"],
  divisa: ["divisa", "currency", "moneda", "ccy"],
};

export const ETIQUETA_CAMPO: Record<CampoImport, string> = {
  fecha: "Fecha",
  tipo: "Tipo de movimiento",
  isin: "ISIN",
  ticker: "Símbolo",
  nombre: "Nombre",
  cantidad: "Cantidad",
  precio: "Precio",
  total: "Importe",
  comision: "Comisión",
  divisa: "Divisa",
};

/** Columna elegida a mano para cada campo, cuando el nombre no basta. */
export type Mapa = Partial<Record<CampoImport, string>>;

/** Qué columna se usaría para cada campo con los alias. Es lo que la pantalla
 *  enseña ya rellenado para que el usuario sólo corrija lo que falle. */
export function adivinarMapa(t: Tabla): Mapa {
  const mapa: Mapa = {};
  for (const [c, alias] of Object.entries(ALIAS) as [CampoImport, string[]][]) {
    const col = t.cabeceras.find((h) => alias.some((a) => h === a));
    const laxa = t.cabeceras.find((h) => alias.some((a) => h.includes(a)));
    const elegida = col ?? laxa;
    if (elegida) mapa[c] = elegida;
  }
  return mapa;
}

const dame = (fila: Record<string, string>, mapa: Mapa, c: CampoImport): string | undefined => {
  const col = mapa[c];
  if (col != null && fila[col] !== undefined && fila[col] !== "") return fila[col];
  return campo(fila, ...ALIAS[c]);
};

export function leerGenerico(t: Tabla, mapa: Mapa = {}, orden: OrdenFecha = "dmy"): Lectura {
  const out = lecturaVacia("generico-csv");
  const filas: FilaImportada[] = [];
  const descartes: Descarte[] = [];

  t.filas.forEach((f, i) => {
    const linea = t.lineas[i] ?? i + 2;
    const crudo = Object.values(f).join(" · ");

    const d = fecha(dame(f, mapa, "fecha"), orden);
    if (!d) {
      descartes.push({ linea, motivo: "Sin fecha reconocible", crudo });
      return;
    }

    const textoTipo = dame(f, mapa, "tipo");
    // Sin columna de tipo, lo razonable en un extracto de valores es una
    // compra: es lo que asume cualquier importador. Se deja anotado para que
    // la vista previa lo enseñe y se pueda corregir.
    const tipo = clasificar(textoTipo) ?? (textoTipo ? undefined : "buy");
    if (!tipo) {
      descartes.push({ linea, motivo: `Tipo «${textoTipo}» no reconocido`, crudo });
      return;
    }

    const isin = dame(f, mapa, "isin")?.toUpperCase();
    const ticker = dame(f, mapa, "ticker")?.toUpperCase();
    const nombre = dame(f, mapa, "nombre") ?? ticker ?? isin;
    const cantidad = num(dame(f, mapa, "cantidad"));
    const precio = num(dame(f, mapa, "precio"));
    const bruto = num(dame(f, mapa, "total"));
    const comision = num(dame(f, mapa, "comision"));
    const divisa = (dame(f, mapa, "divisa") ?? "EUR").toUpperCase();

    let total = bruto != null ? Math.abs(bruto) : undefined;
    if (total == null && cantidad != null && precio != null) total = Math.abs(cantidad * precio);
    if (total == null || !isFinite(total) || total === 0) {
      descartes.push({ linea, motivo: "Sin importe ni cantidad × precio", crudo });
      return;
    }

    if (!isin && !ticker && (tipo === "buy" || tipo === "sell")) {
      descartes.push({ linea, motivo: "Compra o venta sin ISIN ni símbolo", crudo });
      return;
    }

    filas.push({
      linea,
      fecha: d,
      tipo,
      isin,
      ticker,
      nombre: nombre ?? undefined,
      cantidad: cantidad != null ? Math.abs(cantidad) : undefined,
      precio: precio != null ? Math.abs(precio) : undefined,
      total,
      comision: comision != null ? Math.abs(comision) : undefined,
      divisa,
      nota: textoTipo,
    });
  });

  return { ...out, filas, descartes };
}

/** Un JSON que ya viene como lista de objetos: se convierte a tabla y sigue
 *  el mismo camino que un CSV, así el mapeo manual también funciona. */
export function leerGenericoJson(datos: unknown[]): Lectura {
  const filas = datos
    .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === "object")
    .map((d) => {
      const fila: Record<string, string> = {};
      for (const [k, v] of Object.entries(d)) fila[k.toLowerCase().trim()] = v == null ? "" : String(v);
      return fila;
    });

  const cabeceras = [...new Set(filas.flatMap((f) => Object.keys(f)))];
  const tabla: Tabla = {
    cabeceras,
    filas,
    lineas: filas.map((_, i) => i + 1),
    separador: ",",
  };

  const lectura = leerGenerico(tabla, adivinarMapa(tabla));
  return { ...lectura, formato: "generico-json" };
}
