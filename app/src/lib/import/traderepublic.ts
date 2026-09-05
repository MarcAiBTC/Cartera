// ── TRADE REPUBLIC ───────────────────────────────────────────────────────
// El archivo: en la app móvil, Perfil → Extractos → «Exportación de
// transacción», eliges el rango de fechas y descargas el CSV. Sólo está en la
// app; desde la web no se puede.
//
// Aviso que conviene repetir al usuario: NO abrir el CSV en Excel antes de
// subirlo. Excel reescribe las fechas y los decimales al guardarlo y lo que
// llega aquí ya no es lo que dio el bróker.
//
// El identificador del activo es el ISIN, no el ticker: Trade Republic no
// exporta símbolo. Por eso el catálogo ISIN → símbolo es lo que decide si la
// posición tendrá precio en vivo o se quedará en manual.

import { campo, fecha, num, type Tabla } from "./csv";
import { clasificar, lecturaVacia, type Descarte, type FilaImportada, type Lectura } from "./tipos";

export function esTradeRepublic(t: Tabla): boolean {
  const h = t.cabeceras.join(" ");
  if (!h.includes("isin")) return false;
  // Revolut también trae ISIN en algunos extractos, pero siempre con
  // «activity type»; si aparece, no es este adaptador.
  if (h.includes("activity type")) return false;
  const tieneFecha = /fecha|date|timestamp|zeitpunkt/.test(h);
  const tieneTipo = /tipo|type|art\b|transaccion|transaction/.test(h);
  return tieneFecha && tieneTipo;
}

export function leerTradeRepublic(t: Tabla): Lectura {
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

    // El importe llega con signo (negativo en las compras). El signo lo lleva
    // ya el tipo, así que aquí se guarda siempre en positivo.
    let total = bruto != null ? Math.abs(bruto) : undefined;
    if (total == null && cantidad != null && precio != null) total = Math.abs(cantidad * precio);

    if (total == null || !isFinite(total) || total === 0) {
      descartes.push({ linea, motivo: "Sin importe", crudo });
      return;
    }

    // Un movimiento de valores sin ISIN no se puede casar con ningún activo.
    if (!isin && (tipo === "buy" || tipo === "sell")) {
      descartes.push({ linea, motivo: "Compra o venta sin ISIN", crudo });
      return;
    }

    filas.push({
      linea,
      fecha: d,
      tipo,
      isin,
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
