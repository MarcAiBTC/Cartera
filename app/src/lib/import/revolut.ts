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

  // ── Formato nuevo, con el tipo escrito entero ──
  "BUY - MARKET": "buy",
  "BUY - LIMIT": "buy",
  "BUY - STOP": "buy",
  "SELL - MARKET": "sell",
  "SELL - LIMIT": "sell",
  "SELL - STOP": "sell",
  "CASH TOP-UP": "deposit",
  "CASH WITHDRAWAL": "withdrawal",
  DIVIDEND: "dividend",
  "CUSTODY FEE": "fee",
  "STOCK SPLIT": null,
  "MERGER - STOCK": null,
};

export function esRevolut(t: Tabla): boolean {
  const h = t.cabeceras.join(" ");
  // El formato antiguo, con codigos en «Activity Type».
  if (h.includes("activity type")) return true;
  if (h.includes("trade date") && h.includes("settle date")) return true;

  // El formato NUEVO de Revolut Invest:
  //   Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
  // No trae ni «activity type» ni «trade date», asi que antes no lo reconocia
  // nadie y el archivo acababa en el importador generico.
  if (h.includes("price per share") && h.includes("total amount")) return true;

  // Y el extracto de la cuenta corriente en espanol, que es otro archivo
  // distinto: «Tipo,Producto,Fecha de inicio,…,Saldo».
  if (h.includes("fecha de inicio") && h.includes("saldo") && h.includes("producto")) return true;

  return false;
}

/** Divisas que en realidad son metal: Revolut deja comprar oro y plata como
 *  si fueran moneda, y en el extracto salen con su codigo ISO. */
const METALES: Record<string, string> = {
  XAU: "Oro",
  XAG: "Plata",
  XPT: "Platino",
  XPD: "Paladio",
};

export function leerRevolut(t: Tabla): Lectura {
  const out = lecturaVacia("revolut-csv", "Revolut");
  const filas: FilaImportada[] = [];
  const descartes: Descarte[] = [];

  // ── El extracto de la cuenta corriente ────────────────────────────────
  // Es otro archivo distinto del de Inversiones, y tiene un problema que no
  // se puede arreglar leyendolo mejor: cuando compras oro, la fila dice
  // cuantas onzas entraron pero NO cuantos euros salieron. Sin ese dato no
  // hay coste, y sin coste no hay ni ganancia ni aportado.
  //
  // Lo unico util que se puede hacer es decir exactamente cuanto metal hay
  // —la columna Saldo lleva el acumulado— para poder apuntarlo a mano.
  const saldos = new Map<string, { cantidad: number; veces: number; linea: number }>();
  for (let i = 0; i < t.filas.length; i++) {
    const f = t.filas[i];
    const divisa = (campo(f, "divisa", "currency") ?? "").toUpperCase();
    if (!METALES[divisa]) continue;
    const saldo = num(campo(f, "saldo", "balance"));
    if (saldo == null) continue;
    // El ultimo saldo de cada metal es el que vale: es acumulado.
    saldos.set(divisa, { cantidad: saldo, veces: (saldos.get(divisa)?.veces ?? 0) + 1, linea: t.lineas[i] ?? i + 2 });
  }
  for (const [divisa, s] of saldos) {
    descartes.push({
      linea: s.linea,
      motivo:
        `${s.veces} compras de ${METALES[divisa]} (${divisa}). Este extracto dice cuanto ` +
        `metal entro —te quedan ${s.cantidad} onzas— pero NO cuantos euros pagaste, asi que ` +
        `no se puede calcular ni el coste ni la ganancia. Anade la posicion en ` +
        `Historial → Posiciones con esas ${s.cantidad} onzas y lo que te costo`,
      crudo: `${divisa} · saldo ${s.cantidad}`,
    });
  }

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
      // Las de metal ya se han contado arriba, en una sola linea por metal.
      const divisaFila = (campo(f, "divisa", "currency") ?? "").toUpperCase();
      if (METALES[divisaFila]) return;
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

    // Revolut opera en dolares y dice a que cambio lo hizo. Ese numero vale
    // mas que el historico de divisas: es el que te aplico de verdad, con su
    // margen dentro. Viene como «cuantos USD por euro», asi que para pasar a
    // euros hay que dividir.
    const fxFila = num(campo(f, "fx rate", "tipo de cambio", "exchange rate"));
    const cambio = fxFila != null && fxFila > 0 ? 1 / fxFila : undefined;

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
      cambio,
      nota: codigo || undefined,
    });
  });

  return { ...out, filas, descartes };
}
