// ── REVOLUT ──────────────────────────────────────────────────────────────
// El archivo: en la app o en la web, dentro de Inversiones → Documentos →
// «Extracto de cuenta» (Account statement), formato Excel/CSV.
//
// Ojo con cuál se descarga: el «Profit and Loss» y el «Cost & Charges» no
// traen los movimientos uno a uno, así que con esos no hay nada que importar.
//
// Dos particularidades que se pagan caras si se ignoran:
//   · Las fechas van en formato americano, mes primero. `03/04/2026` es el
//     4 de marzo, no el 3 de abril.
//   · El tipo viene en códigos («DIV», «DIVNRA», «CDEP»), no en palabras, así
//     que hay tabla propia antes de caer en el vocabulario general.

import { campo, fecha, num, type Tabla } from "./csv";
import type { TipoOperacion } from "../tipos";
import { clasificar, lecturaVacia, type Descarte, type FilaImportada, type Lectura } from "./tipos";

/** Códigos de «Activity Type» de Revolut Invest. */
const CODIGOS: Record<string, TipoOperacion | null> = {
  BUY: "buy",
  SELL: "sell",
  DIV: "dividend",
  // Retención en origen sobre el dividendo: sale dinero, no entra.
  DIVNRA: "fee",
  DIVFT: "fee",
  CDEP: "deposit",
  CSD: "deposit",
  TOPUP: "deposit",
  WITH: "withdrawal",
  CWITH: "withdrawal",
  // Splits y cambios de nombre no mueven dinero: se ignoran sin ruido.
  SSP: null,
  SSO: null,
  MAS: null,
  SC: null,
};

export function esRevolut(t: Tabla): boolean {
  const h = t.cabeceras.join(" ");
  if (h.includes("activity type")) return true;
  return h.includes("trade date") && h.includes("settle date");
}

export function leerRevolut(t: Tabla): Lectura {
  const out = lecturaVacia("revolut-csv", "Revolut");
  const filas: FilaImportada[] = [];
  const descartes: Descarte[] = [];

  t.filas.forEach((f, i) => {
    const linea = t.lineas[i] ?? i + 2;
    const crudo = Object.values(f).join(" · ");

    const d = fecha(campo(f, "trade date", "date", "fecha", "settle date"), "mdy");
    if (!d) {
      descartes.push({ linea, motivo: "Sin fecha reconocible", crudo });
      return;
    }

    const codigo = (campo(f, "activity type", "type", "tipo") ?? "").toUpperCase().trim();
    let tipo: TipoOperacion | undefined;
    if (codigo in CODIGOS) {
      const t2 = CODIGOS[codigo];
      if (t2 === null) return; // split o corporativa: ni se importa ni se descarta con ruido
      tipo = t2;
    } else {
      tipo = clasificar(codigo) ?? clasificar(campo(f, "description", "descripción"));
    }
    if (!tipo) {
      descartes.push({ linea, motivo: `Tipo «${codigo}» no reconocido`, crudo });
      return;
    }

    const ticker = campo(f, "symbol", "ticker", "símbolo")?.toUpperCase();
    const nombre = campo(f, "description", "symbol / description", "descripción", "name") ?? ticker;
    const cantidad = num(campo(f, "quantity", "cantidad", "shares"));
    const precio = num(campo(f, "price", "precio", "price per share"));
    const bruto = num(campo(f, "amount", "importe", "value", "total"));
    const divisa = (campo(f, "currency", "divisa", "ccy") ?? "EUR").toUpperCase();
    const comision = num(campo(f, "fees", "commission", "comisión"));

    let total = bruto != null ? Math.abs(bruto) : undefined;
    if (total == null && cantidad != null && precio != null) total = Math.abs(cantidad * precio);
    if (total == null || !isFinite(total) || total === 0) {
      descartes.push({ linea, motivo: "Sin importe", crudo });
      return;
    }

    if (!ticker && (tipo === "buy" || tipo === "sell")) {
      descartes.push({ linea, motivo: "Compra o venta sin símbolo", crudo });
      return;
    }

    filas.push({
      linea,
      fecha: d,
      tipo,
      ticker,
      nombre: nombre ?? undefined,
      cantidad: cantidad != null ? Math.abs(cantidad) : undefined,
      precio: precio != null ? Math.abs(precio) : undefined,
      total,
      comision: comision != null ? Math.abs(comision) : undefined,
      divisa,
      nota: codigo || undefined,
    });
  });

  return { ...out, filas, descartes };
}
