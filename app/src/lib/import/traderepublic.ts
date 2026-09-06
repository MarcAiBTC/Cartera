// ── TRADE REPUBLIC ───────────────────────────────────────────────────────
// El archivo: app móvil → Perfil → Extractos → «Exportación de transacción»,
// eliges el rango de fechas y descargas el CSV. Desde la web no se puede.
//
// Aviso que conviene repetir al usuario: NO abrir el CSV en Excel antes de
// subirlo. Excel reescribe las fechas y los decimales al guardarlo y lo que
// llega aquí ya no es lo que dio el bróker.
//
// Hay DOS formatos, porque Trade Republic cambió la exportación por el
// camino, y el nuevo no se parece en nada al viejo.
//
// ── EL NUEVO ─────────────────────────────────────────────────────────────
//
//   datetime,date,account_type,category,type,asset_class,name,symbol,
//   shares,price,amount,fee,tax,currency,original_amount,original_currency,
//   fx_rate,description,transaction_id,counterparty_name,counterparty_iban,
//   payment_reference,mcc_code
//
// Tres cosas de este formato hay que saberlas, y las tres costaron una
// importación entera que hubo que deshacer:
//
//  1. NO existe la columna `isin`. El ISIN viaja dentro de `symbol` para los
//     valores (US0231351067) y en esa misma columna viaja el TICKER para las
//     criptomonedas (BTC, ETH, ADA). Guardar el ISIN en el campo del ticker
//     deja al activo sin cotización para siempre: Yahoo no sabe qué es
//     «US0231351067», y así es como cuatro acciones entraron mudas.
//
//  2. El tipo no es texto libre, es un enum en mayúsculas con guiones bajos.
//     «CUSTOMER_INBOUND» no contiene «ingreso» ni «deposit», así que el
//     vocabulario común de `tipos.ts` no reconoce ni uno: hace falta tabla.
//
//  3. Los movimientos de efectivo traen en `name` el concepto del banco
//     —«Interest payment for payout collection 019a3d67…»—. Eso NO es un
//     activo. Por eso aquí el nombre sólo se rellena cuando la fila es de
//     verdad de un valor.
//
// ── EL ANTIGUO ───────────────────────────────────────────────────────────
// Cabeceras en español o alemán y una columna `isin` de verdad. Se conserva
// porque quien exportó hace un año tiene ese archivo guardado.

import { campo, ES_ISIN, fecha, normaliza, num, type Tabla } from "./csv";
import { clasificar, lecturaVacia, type Descarte, type FilaImportada, type Lectura } from "./tipos";
import type { TipoOperacion } from "../tipos";

// ── DETECCIÓN ────────────────────────────────────────────────────────────

/** Las tres columnas que sólo trae el formato nuevo. `transaction_id` es la
 *  más discriminante: ningún otro bróker de los soportados la exporta. */
const COLUMNAS_NUEVAS = ["category", "asset_class", "transaction_id"];

function esFormatoNuevo(t: Tabla): boolean {
  const h = t.cabeceras.map(normaliza);
  return COLUMNAS_NUEVAS.every((c) => h.includes(normaliza(c)));
}

export function esTradeRepublic(t: Tabla): boolean {
  if (esFormatoNuevo(t)) return true;

  const h = t.cabeceras.join(" ");
  if (!h.includes("isin")) return false;
  // Revolut también trae ISIN en algunos extractos, pero siempre con
  // «activity type»; si aparece, no es este adaptador.
  if (h.includes("activity type")) return false;
  const tieneFecha = /fecha|date|timestamp|zeitpunkt/.test(h);
  const tieneTipo = /tipo|type|art\b|transaccion|transaction/.test(h);
  return tieneFecha && tieneTipo;
}

// ── VOCABULARIO DEL FORMATO NUEVO ────────────────────────────────────────

/** `ignorar` no es un descarte: son filas que se entienden perfectamente y
 *  que a propósito no generan operación, porque ya están contadas en otra
 *  fila o porque no mueven ni dinero ni títulos. */
type Destino = TipoOperacion | "ignorar";

const TIPOS: Record<string, Destino> = {
  // Valores
  BUY: "buy",
  SELL: "sell",
  // Cobros
  DIVIDEND: "dividend",
  INTEREST_PAYMENT: "interest",
  // Entra dinero
  CUSTOMER_INPAYMENT: "deposit",
  CUSTOMER_INBOUND: "deposit",
  TRANSFER_INSTANT_INBOUND: "deposit",
  // Sale dinero
  CUSTOMER_OUTBOUND: "withdrawal",
  CUSTOMER_OUTBOUND_REQUEST: "withdrawal",
  TRANSFER_INSTANT_OUTBOUND: "withdrawal",
  TRANSFER_OUTBOUND: "withdrawal",
  // Gastos e impuestos
  FEE: "fee",
  TAX_OPTIMIZATION: "fee",
  // Amortización de un derivado: el dinero que devuelve el emisor cuando el
  // producto vence. Los títulos salen en su WARRANT_EXERCISE gemelo.
  TILG: "sell",
  // El signo decide si suma o resta.
  MANUAL_CASH_TRANSFER: "deposit",

  // ── Las que no generan operación ──
  // Los títulos que se van cuando vence un derivado. El importe llega en la
  // fila TILG del mismo día; emitir las dos sería contar la venta dos veces.
  WARRANT_EXERCISE: "ignorar",
  // Cambio de custodia interno: llega en pares (−x y +x el mismo día, mismo
  // ISIN) y en neto no pasa nada.
  MIGRATION: "ignorar",
  // Entrega de títulos sin contrapartida en efectivo (sacar cripto a una
  // cartera propia). Se avisa aparte, más abajo: no es una venta.
  FREE_DELIVERY: "ignorar",
};

/** `asset_class` del bróker → categoría de la cartera. */
function categoriaTR(clase: string, nombre: string): string | undefined {
  switch (clase.toUpperCase()) {
    case "CRYPTO":
      return "cripto";
    case "STOCK":
      return "accion";
    case "DERIVATIVE":
      // Warrants y turbos. No son acciones ni fondos, y meterlos con las
      // acciones falsearía el reparto de la cartera.
      return "otro";
    case "FUND":
      // Los ETC de metal se exportan como FUND y son lo que son.
      return /\b(gold|silver|platinum|palladium|oro|plata)\b/i.test(nombre) ? "metal" : "fondo";
    default:
      return undefined;
  }
}

// ── LECTURA DEL FORMATO NUEVO ────────────────────────────────────────────

/** Clave para emparejar dos filas que hablan del mismo hecho. */
const par = (simbolo: string, dia: string) => `${simbolo}|${dia}`;

export function leerTradeRepublicNuevo(t: Tabla): Lectura {
  const out = lecturaVacia("traderepublic-csv", "Trade Republic");
  const filas: FilaImportada[] = [];
  const descartes: Descarte[] = [];

  // ── Pasada previa ──────────────────────────────────────────────────────
  // Dos emparejamientos que sólo se pueden resolver mirando el archivo
  // entero, no fila a fila.

  // 1. El dinero que devuelve un derivado al vencer, indexado por ISIN y día,
  //    para poder pegárselo a su WARRANT_EXERCISE.
  const amortizaciones = new Map<string, number>();
  // 2. Los MIGRATION que se anulan entre sí. Si un −x no encuentra su +x, es
  //    una entrega de verdad y hay que decirlo en vez de tragársela.
  const migraciones = new Map<string, number>();

  for (const f of t.filas) {
    const tipo = (f.type ?? "").toUpperCase();
    const simbolo = (f.symbol ?? "").toUpperCase();
    const dia = fecha(f.date || f.datetime) ?? "";
    if (!simbolo || !dia) continue;

    if (tipo === "TILG") {
      const importe = num(f.amount);
      if (importe != null) {
        const k = par(simbolo, dia);
        amortizaciones.set(k, (amortizaciones.get(k) ?? 0) + importe);
      }
    } else if (tipo === "MIGRATION") {
      const q = num(f.shares);
      if (q != null) {
        const k = par(simbolo, dia);
        migraciones.set(k, (migraciones.get(k) ?? 0) + q);
      }
    }
  }

  // Las amortizaciones ya consumidas por su warrant, para no emitirlas
  // además como venta suelta.
  const consumidas = new Set<string>();

  t.filas.forEach((f, i) => {
    const linea = t.lineas[i] ?? i + 2;
    const crudo = [f.date, f.category, f.type, f.name, f.symbol, f.shares, f.amount]
      .filter(Boolean)
      .join(" · ");

    const d = fecha(f.date || f.datetime);
    if (!d) {
      descartes.push({ linea, motivo: "Sin fecha reconocible", crudo });
      return;
    }

    const bruto = (f.type ?? "").toUpperCase();
    const clase = (f.asset_class ?? "").toUpperCase();
    const simbolo = (f.symbol ?? "").trim().toUpperCase();
    const nombre = (f.name ?? "").trim();

    // El símbolo es ISIN para valores y ticker para cripto. Distinguirlos por
    // la forma es lo único fiable: la columna no lo dice.
    const isin = ES_ISIN(simbolo) ? simbolo : undefined;
    const ticker = !isin && simbolo ? simbolo : undefined;

    const cantidad = num(f.shares);
    const precio = num(f.price);
    const importe = num(f.amount);
    const comision = num(f.fee);
    const impuesto = num(f.tax);
    const divisa = (f.currency || "EUR").toUpperCase();

    let destino: Destino | undefined = TIPOS[bruto];
    // Un tipo que no esté en la tabla todavía puede caer en el vocabulario
    // común: mejor eso que perder la fila por una palabra nueva del bróker.
    if (destino === undefined) destino = clasificar(bruto) ?? clasificar(f.description);

    if (destino === undefined) {
      descartes.push({ linea, motivo: `Tipo de movimiento no reconocido: «${bruto}»`, crudo });
      return;
    }

    // ── Las que no generan operación ────────────────────────────────────

    if (bruto === "MIGRATION") {
      const neto = migraciones.get(par(simbolo, d)) ?? 0;
      if (Math.abs(neto) < 1e-9) return; // par que se anula: silencio
      descartes.push({
        linea,
        motivo: "Traspaso de custodia sin pareja que lo compense: revísalo a mano",
        crudo,
      });
      return;
    }

    if (bruto === "FREE_DELIVERY") {
      descartes.push({
        linea,
        motivo:
          `Entrega de ${Math.abs(cantidad ?? 0)} ${nombre || simbolo} sin dinero de por medio ` +
          `(salida hacia una cartera externa). No es una venta: si quieres que deje de contar, ` +
          `ajusta la posición a mano`,
        crudo,
      });
      return;
    }

    if (bruto === "WARRANT_EXERCISE") {
      // El derivado vence. Los títulos salen aquí y el dinero, si lo hay,
      // está en el TILG del mismo día. Se emite UNA venta con las dos mitades.
      const clave = par(simbolo, d);
      const cobrado = amortizaciones.get(clave) ?? 0;
      consumidas.add(clave);
      const q = Math.abs(cantidad ?? 0);
      if (q === 0) {
        descartes.push({ linea, motivo: "Vencimiento sin cantidad", crudo });
        return;
      }
      filas.push({
        linea,
        fecha: d,
        tipo: "sell",
        isin,
        ticker,
        nombre: nombre || simbolo,
        categoria: categoriaTR(clase, nombre),
        cantidad: q,
        precio: cobrado > 0 ? Math.abs(cobrado) / q : 0,
        total: Math.abs(cobrado),
        divisa,
        // Un vencimiento sin TILG es un producto que expiró sin valor. La
        // venta a cero es exactamente eso, y realiza la pérdida entera.
        nota:
          cobrado > 0
            ? "Vencimiento del derivado (amortizado)"
            : "Vencimiento del derivado sin valor de amortización",
      });
      return;
    }

    if (destino === "ignorar") return;

    // El TILG que ya se ha contado dentro de su warrant no vuelve a salir.
    if (bruto === "TILG" && consumidas.has(par(simbolo, d))) return;

    // ── Importe ─────────────────────────────────────────────────────────
    // `amount` viene con signo (negativo cuando sale dinero) y el signo ya lo
    // lleva el tipo, así que aquí se guarda siempre en positivo.
    let total = importe != null ? Math.abs(importe) : undefined;
    if (total == null && cantidad != null && precio != null) total = Math.abs(cantidad * precio);

    // Las comisiones y los ajustes fiscales llegan con `amount` a cero y la
    // cifra en su propia columna.
    if ((total == null || total === 0) && destino === "fee") {
      total = Math.abs(comision ?? 0) || Math.abs(impuesto ?? 0);
    }

    if (total == null || !isFinite(total) || total === 0) {
      descartes.push({ linea, motivo: "Sin importe", crudo });
      return;
    }

    // Un movimiento de efectivo con el importe al revés de lo que dice su
    // tipo: manda el signo, que es el que mueve el saldo de verdad.
    if (destino === "deposit" && importe != null && importe < 0) destino = "withdrawal";
    else if (destino === "withdrawal" && importe != null && importe > 0) destino = "deposit";

    const esValor = destino === "buy" || destino === "sell" || destino === "dividend";

    if (esValor && !simbolo) {
      descartes.push({ linea, motivo: "Movimiento de valores sin ISIN ni ticker", crudo });
      return;
    }

    filas.push({
      linea,
      fecha: d,
      tipo: destino,
      // Un ingreso o unos intereses no pertenecen a ningún valor: dejar aquí
      // el ISIN o el nombre haría que la cartera se inventara un activo
      // llamado «Interest payment for payout collection 019a3d67…».
      isin: esValor ? isin : undefined,
      ticker: esValor ? ticker : undefined,
      nombre: esValor ? nombre || simbolo : undefined,
      categoria: esValor ? categoriaTR(clase, nombre) : undefined,
      cantidad: cantidad != null ? Math.abs(cantidad) : undefined,
      precio: precio != null ? Math.abs(precio) : undefined,
      total,
      comision: comision != null ? Math.abs(comision) : undefined,
      divisa,
      nota: nombre && !esValor ? `${bruto} · ${nombre}` : bruto,
    });
  });

  return { ...out, filas, descartes };
}

// ── LECTURA DEL FORMATO ANTIGUO ──────────────────────────────────────────

export function leerTradeRepublicAntiguo(t: Tabla): Lectura {
  const out = lecturaVacia("traderepublic-csv", "Trade Republic");
  const filas: FilaImportada[] = [];
  const descartes: Descarte[] = [];

  t.filas.forEach((f, i) => {
    const linea = t.lineas[i] ?? i + 2;
    const crudo = Object.values(f).join(" · ");

    const d = fecha(
      campo(f, "fecha", "date", "timestamp", "fecha de la operación", "zeitpunkt", "fecha valor"),
      "dmy",
    );
    if (!d) {
      descartes.push({ linea, motivo: "Sin fecha reconocible", crudo });
      return;
    }

    const textoTipo = campo(
      f,
      "tipo",
      "type",
      "transaction type",
      "tipo de transacción",
      "tipo de operación",
      "art",
      "concepto",
      "descripción",
      "description",
    );
    const tipo = clasificar(textoTipo);
    if (!tipo) {
      descartes.push({
        linea,
        motivo: `Tipo de movimiento no reconocido${textoTipo ? `: «${textoTipo}»` : ""}`,
        crudo,
      });
      return;
    }

    const isin = campo(f, "isin")?.toUpperCase();
    const nombre =
      campo(f, "nombre", "name", "título", "wertpapier", "instrumento", "producto", "description") ??
      isin;

    const cantidad = num(campo(f, "cantidad", "quantity", "shares", "stück", "anzahl", "títulos"));
    const precio = num(campo(f, "precio", "price", "kurs", "precio por acción", "unit price"));
    const bruto = num(campo(f, "importe", "amount", "total", "valor", "betrag", "value"));
    const comision = num(campo(f, "comisión", "comision", "fee", "gebühr", "tasas", "costes"));
    const divisa = (campo(f, "divisa", "currency", "moneda", "währung") ?? "EUR").toUpperCase();

    let total = bruto != null ? Math.abs(bruto) : undefined;
    if (total == null && cantidad != null && precio != null) total = Math.abs(cantidad * precio);

    if (total == null || !isFinite(total) || total === 0) {
      descartes.push({ linea, motivo: "Sin importe", crudo });
      return;
    }

    if (!isin && (tipo === "buy" || tipo === "sell")) {
      descartes.push({ linea, motivo: "Compra o venta sin ISIN", crudo });
      return;
    }

    const esValor = tipo === "buy" || tipo === "sell" || tipo === "dividend";

    filas.push({
      linea,
      fecha: d,
      tipo,
      isin: esValor ? isin : undefined,
      nombre: esValor ? (nombre ?? undefined) : undefined,
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

export function leerTradeRepublic(t: Tabla): Lectura {
  return esFormatoNuevo(t) ? leerTradeRepublicNuevo(t) : leerTradeRepublicAntiguo(t);
}
