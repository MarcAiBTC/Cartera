// ── PRUEBAS DEL BUZÓN ────────────────────────────────────────────────────
// El camino nuevo: el archivo no lo elige nadie en un selector, llega desde la
// hoja de compartir del móvil, duerme en la base de datos y se reconstruye
// después. Tres sitios donde puede estropearse sin que se note:
//
//   · el nombre, que viene de fuera y se pinta,
//   · el «esto es texto o son bytes», que decide si un Excel se guarda intacto,
//   · la vuelta atrás, que tiene que devolver EXACTAMENTE lo que entró.
//
// Un CSV que vuelve con un byte cambiado no da error: da unas cifras un poco
// distintas, que es mucho peor.

import { describe, expect, it } from "vitest";
import { esTexto, nombreLimpio } from "../api/entrada";
import { comoArchivo, type EntradaBuzon } from "../src/lib/buzon";
import { detectar, leer, leerArchivo } from "../src/lib/import";

const TRADE_REPUBLIC = `Fecha;Tipo;Estado;ISIN;Nombre;Cantidad;Precio;Importe;Divisa
04/11/2024;Compra;Ejecutada;JE00B8DFY052;WisdomTree Physical Gold;7;21,51;-150,57;EUR
30/06/2026;Dividendo;Ejecutada;JE00B8DFY052;WisdomTree Physical Gold;;;3,40;EUR`;

const entrada = (extra: Partial<EntradaBuzon>): EntradaBuzon => ({
  id: "1",
  filename: "extracto.csv",
  content: "",
  encoding: "text",
  bytes: 0,
  source: "atajo",
  status: "nuevo",
  ops: null,
  created_at: "2026-09-07T10:00:00Z",
  ...extra,
});

describe("el nombre del archivo", () => {
  it("se queda con el nombre y tira la ruta", () => {
    expect(nombreLimpio("/var/mobile/Containers/extracto.csv")).toBe("extracto.csv");
    expect(nombreLimpio("C:\\Users\\Marc\\Downloads\\Revolut.xlsx")).toBe("Revolut.xlsx");
  });

  it("quita los caracteres de control", () => {
    expect(nombreLimpio("extra\u0000cto\u001b.csv")).toBe("extracto.csv");
  });

  it("nunca se queda vacío", () => {
    expect(nombreLimpio("")).toBe("extracto.csv");
    expect(nombreLimpio(null)).toBe("extracto.csv");
    expect(nombreLimpio("   ")).toBe("extracto.csv");
  });

  it("no se pasa de largo", () => {
    expect(nombreLimpio("x".repeat(500)).length).toBe(120);
  });
});

describe("texto o bytes", () => {
  it("un CSV con acentos es texto", () => {
    const bytes = new TextEncoder().encode("fecha;concepto\n01/01/2026;Comisión de custodia ñ");
    expect(esTexto(bytes)).toBe(true);
  });

  it("un archivo con un byte nulo no lo es", () => {
    // La firma de un ZIP, que es lo que hay dentro de cualquier .xlsx.
    expect(esTexto(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x14]))).toBe(false);
  });

  it("una secuencia UTF-8 rota tampoco", () => {
    expect(esTexto(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(false);
  });

  it("no se cree binario un texto sólo porque el corte caiga en una eñe", () => {
    // El fallo que motivó mirar el archivo entero en vez de una cabecera fija:
    // partir por un byte suelto rompe un carácter de dos y el CSV se guardaba
    // en base64 «por si acaso».
    const largo = "á".repeat(5000);
    expect(esTexto(new TextEncoder().encode(largo))).toBe(true);
  });
});

describe("volver del buzón", () => {
  it("devuelve el CSV intacto y se sigue reconociendo el bróker", async () => {
    const item = entrada({ content: TRADE_REPUBLIC, encoding: "text", filename: "tr.csv" });
    const e = await leerArchivo(comoArchivo(item));

    expect(detectar(e)).toBe("traderepublic-csv");
    const lectura = leer(e);
    expect(lectura.filas.map((f) => f.tipo)).toEqual(["buy", "dividend"]);
    // El importe llega en negativo y el motor lo quiere siempre positivo.
    expect(lectura.filas[0].total).toBeCloseTo(150.57, 2);
  });

  it("un archivo binario vuelve byte a byte", () => {
    const original = new Uint8Array(1024);
    for (let i = 0; i < original.length; i++) original[i] = (i * 7) % 256;

    let bin = "";
    for (const b of original) bin += String.fromCharCode(b);
    const item = entrada({ content: btoa(bin), encoding: "base64", filename: "revolut.xlsx" });

    const archivo = comoArchivo(item);
    expect(archivo.name).toBe("revolut.xlsx");
    return archivo.arrayBuffer().then((buf) => {
      expect(new Uint8Array(buf)).toEqual(original);
    });
  });
});
