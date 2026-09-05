// ── MYINVESTOR ───────────────────────────────────────────────────────────
// Dos caminos, porque MyInvestor da los datos de dos maneras:
//
//   1. El Excel de movimientos de la web (Mi cartera → Movimientos →
//      Descargar). Es una tabla normal y lo lee `leerMyInvestorTabla`.
//   2. El JSON de la propia web, con la forma `{ payload: { data: [...] } }`.
//      Es el que trae los campos completos —incluido el valor liquidativo de
//      la operación— y el que distingue los traspasos internos.
//
// El traspaso interno es la razón de tener adaptador propio: un
// INTERNAL_TRANSFER_SUBSCRIPTION mueve dinero entre dos fondos tuyos. Si se
// importa como una compra normal, el «dinero aportado» sube sin que hayas
// puesto un euro, y toda la rentabilidad sale mal.

import { campo, fecha, num, type Tabla } from "./csv";
import type { TipoOperacion } from "../tipos";
import { clasificar, lecturaVacia, type Descarte, type FilaImportada, type Lectura } from "./tipos";

interface OperacionMI {
  operationType?: string;
  status?: string;
  isin?: string;
  fundName?: string;
  shares?: number | string;
  amountBuyVL?: number | string;
  cash?: number | string;
  orderDate?: string;
}

const TIPOS_MI: Record<string, { tipo: TipoOperacion; traspaso: boolean }> = {
  INVESTMENT_FUNDS_SUBSCRIPTION: { tipo: "buy", traspaso: false },
  INVESTMENT_FUNDS_REIMBURSEMENT: { tipo: "sell", traspaso: false },
  INTERNAL_TRANSFER_SUBSCRIPTION: { tipo: "buy", traspaso: true },
  INTERNAL_TRANSFER_REIMBURSEMENT: { tipo: "sell", traspaso: true },
};

export function esMyInvestorJson(valor: unknown): boolean {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
  const p = (valor as { payload?: { data?: unknown } }).payload;
  return Boolean(p && Array.isArray(p.data));
}

export function leerMyInvestorJson(valor: unknown): Lectura {
  const out = lecturaVacia("myinvestor-json", "MyInvestor");
  const filas: FilaImportada[] = [];
  const descartes: Descarte[] = [];
  const datos = ((valor as { payload: { data: OperacionMI[] } }).payload.data ?? []) as OperacionMI[];

  datos.forEach((o, i) => {
    const linea = i + 1;
    const crudo = JSON.stringify(o);

    // Una orden rechazada no llegó a ejecutarse: no es una operación.
    if ((o.status ?? "").toUpperCase() === "REJECTED") {
      descartes.push({ linea, motivo: "Orden rechazada", crudo });
      return;
    }

    const codigo = (o.operationType ?? "").toUpperCase();
    const conocido = TIPOS_MI[codigo];
    let traspaso = conocido?.traspaso ?? false;
    let tipo: TipoOperacion | undefined = conocido?.tipo;
    if (!tipo) {
      tipo = clasificar(codigo);
      // Cualquier variante nueva que lleve TRANSFER/TRASPASO en el nombre se
      // trata como traspaso aunque el código exacto no esté en la tabla.
      traspaso = /TRANSFER|TRASPASO/.test(codigo);
    }
    if (!tipo) {
      descartes.push({ linea, motivo: `Tipo «${o.operationType ?? "?"}» no reconocido`, crudo });
      return;
    }

    const isin = (o.isin ?? "").toUpperCase();
    if (!isin) {
      descartes.push({ linea, motivo: "Sin ISIN", crudo });
      return;
    }

    const cantidad = num(o.shares);
    const precio = num(o.amountBuyVL);
    const efectivo = num(o.cash);
    const total =
      efectivo != null
        ? Math.abs(efectivo)
        : cantidad != null && precio != null
          ? Math.abs(cantidad * precio)
          : undefined;

    if (total == null || total === 0) {
      descartes.push({ linea, motivo: "Sin importe", crudo });
      return;
    }

    const d = fecha(o.orderDate, "dmy");
    if (!d) {
      descartes.push({ linea, motivo: "Sin fecha reconocible", crudo });
      return;
    }

    filas.push({
      linea,
      fecha: d,
      tipo,
      isin,
      nombre: o.fundName || isin,
      cantidad: cantidad != null ? Math.abs(cantidad) : undefined,
      precio: precio != null ? Math.abs(precio) : undefined,
      total,
      divisa: "EUR",
      traspasoInterno: traspaso,
      nota: o.operationType,
    });
  });

  return { ...out, filas, descartes };
}

// ── El Excel de movimientos ──────────────────────────────────────────────

export function esMyInvestorTabla(t: Tabla): boolean {
  const h = t.cabeceras.join(" ");
  if (!h.includes("isin")) return false;
  return /participaciones|valor liquidativo|fondo/.test(h);
}

export function leerMyInvestorTabla(t: Tabla): Lectura {
  const out = lecturaVacia("myinvestor-tabla", "MyInvestor");
  const filas: FilaImportada[] = [];
  const descartes: Descarte[] = [];

  t.filas.forEach((f, i) => {
    const linea = t.lineas[i] ?? i + 2;
    const crudo = Object.values(f).join(" · ");

    const d = fecha(campo(f, "fecha", "fecha de la orden", "fecha valor", "date"), "dmy");
    if (!d) {
      descartes.push({ linea, motivo: "Sin fecha reconocible", crudo });
      return;
    }

    const textoTipo = campo(f, "tipo de operación", "operación", "tipo", "concepto", "movimiento");
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
    const nombre = campo(f, "fondo", "nombre", "producto", "descripción") ?? isin;
    const cantidad = num(campo(f, "participaciones", "cantidad", "títulos"));
    const precio = num(campo(f, "valor liquidativo", "precio", "vl"));
    const bruto = num(campo(f, "importe", "efectivo", "total", "importe bruto"));

    let total = bruto != null ? Math.abs(bruto) : undefined;
    if (total == null && cantidad != null && precio != null) total = Math.abs(cantidad * precio);
    if (total == null || total === 0) {
      descartes.push({ linea, motivo: "Sin importe", crudo });
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
      divisa: (campo(f, "divisa", "moneda", "currency") ?? "EUR").toUpperCase(),
      traspasoInterno: /traspaso/i.test(textoTipo ?? ""),
      nota: textoTipo,
    });
  });

  return { ...out, filas, descartes };
}
