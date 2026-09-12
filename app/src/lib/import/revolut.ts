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

/** Con qué se cotiza cada metal: el contrato continuo de Yahoo, en dólares la
 *  onza, que el servidor pasa a euros con el cambio de cada día. */
const SIMBOLO_METAL: Record<string, string> = {
  XAU: "GC=F",
  XAG: "SI=F",
  XPT: "PL=F",
  XPD: "PA=F",
};

export function leerRevolut(t: Tabla): Lectura {
  const out = lecturaVacia("revolut-csv", "Revolut");
  const filas: FilaImportada[] = [];
  const descartes: Descarte[] = [];

  // ── El extracto de la cuenta corriente ────────────────────────────────
  // Es otro archivo distinto del de Inversiones. Cuando compras oro, la fila
  // dice cuántas onzas entraron pero NO cuántos euros salieron. Antes eso era
  // un aviso y el oro había que apuntarlo a mano; ahora entra como compra, y
  // el importe sale del cierre del oro ese día (`estimarImporte`), que es lo
  // que haría quien lo apuntase mirando el gráfico. La comisión viene en
  // onzas y ya va restada del saldo: entra lo recibido y cuesta lo pagado.
  const metales = new Set<number>();
  t.filas.forEach((f, i) => {
    const divisa = (campo(f, "divisa", "currency") ?? "").toUpperCase();
    if (!METALES[divisa]) return;
    metales.add(i);
    // Una conversión pendiente o revertida no ha movido nada.
    const estado = (campo(f, "state", "estado") ?? "").toUpperCase();
    if (estado && !estado.startsWith("COMPLET")) return;
    const linea = t.lineas[i] ?? i + 2;
    const d = fecha(
      campo(f, "fecha de finalización", "fecha de inicio", "completed date", "started date"),
    );
    const importe = num(campo(f, "importe", "amount"));
    const comision = Math.abs(num(campo(f, "comisión", "fee")) ?? 0);
    if (!d || importe == null || importe === 0) {
      descartes.push({
        linea,
        motivo: `${METALES[divisa]} sin fecha o sin cantidad`,
        crudo: Object.values(f).join(" · "),
      });
      return;
    }
    const onzas = Math.abs(importe);
    const compra = importe > 0;
    filas.push({
      linea,
      fecha: d,
      tipo: compra ? "buy" : "sell",
      ticker: SIMBOLO_METAL[divisa],
      nombre: `${METALES[divisa]} (Revolut)`,
      categoria: "metal",
      subyacente: METALES[divisa],
      unidad: "oz",
      // Compra: entra lo recibido y se paga lo bruto. Venta: sale lo bruto y
      // se cobra lo que queda después de la comisión.
      cantidad: compra ? onzas - comision : onzas,
      total: 0,
      estimarImporte: compra ? onzas : onzas - comision,
      divisa: "EUR",
      nota: campo(f, "descripción", "description") ?? undefined,
    });
    // El dinero del metal sale de la cuenta corriente de Revolut, que este
    // extracto no cubre. Sin esto cada compra se comía el efectivo de la
    // cuenta de inversión: con dos compras de oro quedaba en −149,77 €. Entra
    // de fuera lo que cuesta, y al vender sale lo que se cobra. Sin nombre ni
    // ticker a propósito: si no, el ingreso caería en el activo del metal.
    filas.push({
      linea,
      fecha: d,
      tipo: compra ? "deposit" : "withdrawal",
      total: 0,
      estimarImporte: compra ? onzas : onzas - comision,
      estimarCon: SIMBOLO_METAL[divisa],
      divisa: "EUR",
      nota: `${METALES[divisa]}: ${compra ? "pagado" : "cobrado"} en la cuenta corriente`,
    });
  });

  t.filas.forEach((f, i) => {
    if (metales.has(i)) return;
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
