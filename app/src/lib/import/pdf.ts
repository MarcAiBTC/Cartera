// ── LEER UN PDF ──────────────────────────────────────────────────────────
// Un extracto en PDF no es un documento de texto: es una lista de órdenes de
// dibujo. «Pon esta cadena en el punto (374, 455)». No hay filas, no hay
// columnas y no hay tablas — sólo texto suelto con coordenadas.
//
// Y aun así la tabla está ahí, escondida en los números: todas las celdas de
// una misma fila comparten la Y, y todas las de una misma columna comparten
// la X. Reconstruirla es agrupar por Y y ordenar por X, y eso es exactamente
// lo que hace este archivo. Lo que sale es la misma `Tabla` mental que da un
// CSV, y a partir de ahí cada adaptador se ocupa de lo suyo.
//
// POR QUÉ NO UNA LIBRERÍA. pdf.js son 1,2 MB y trae dentro un renderizador,
// tipografías y un lector de formularios. Aquí hace falta una cosa: sacar el
// texto colocado de un extracto de banco, que son PDF sencillos generados por
// una plantilla. Lo que sigue son 150 líneas y no añade ninguna dependencia.
//
// LO QUE NO HACE: PDF escaneados (son imágenes, no hay texto que sacar),
// tipografías con codificación propia y documentos cifrados. Cuando no
// encuentra texto lo dice, que es mejor que devolver una tabla vacía y dejar
// que el importador diga «formato no reconocido».

/** Una cadena tal y como el PDF la coloca en la página. */
export interface CeldaPdf {
  x: number;
  y: number;
  texto: string;
}

/** Las celdas que comparten renglón, ya ordenadas de izquierda a derecha.
 *
 *  Una celda de tabla que no cabe en su columna se parte en dos renglones muy
 *  juntos —«PICTET-CHINA IX P EUR @» arriba y «0.0381» debajo— y por eso una
 *  fila puede tener varias Y. Se guarda la del renglón principal. */
export interface FilaPdf {
  pagina: number;
  y: number;
  celdas: CeldaPdf[];
}

/** Separación vertical a partir de la cual dos renglones ya no son la misma
 *  fila. En los extractos de MyInvestor las filas van cada 30 puntos y el
 *  segundo renglón de una celda partida cae a 7: doce deja pasar el segundo
 *  renglón y corta antes de la fila siguiente. */
const ALTO_FILA = 12;

/** Cuánto se pueden separar dos X y seguir siendo la misma columna. */
const ANCHO_COLUMNA = 3;

// ── 1 · Sacar los flujos de contenido ────────────────────────────────────

/** Descomprime un flujo `FlateDecode`, que es como se guarda casi todo en un
 *  PDF. `DecompressionStream` viene en el navegador y en Node, así que no
 *  hace falta traerse zlib ni pako. */
async function inflar(datos: Uint8Array): Promise<string | null> {
  for (const formato of ["deflate", "deflate-raw"] as const) {
    try {
      const flujo = new Blob([datos as BlobPart]).stream().pipeThrough(
        new DecompressionStream(formato),
      );
      const bytes = new Uint8Array(await new Response(flujo).arrayBuffer());
      return latin1(bytes);
    } catch {
      // El siguiente formato, y si tampoco, es que no era un flujo comprimido
      // —una imagen JPEG, por ejemplo— y ése no nos interesa.
    }
  }
  return null;
}

/** Bytes a texto sin traducir nada: cada byte, un carácter. Es lo que hace
 *  falta para poder buscar `stream` y `endstream` dentro del archivo sin que
 *  un UTF-8 mal formado se coma un byte por el camino. */
function latin1(bytes: Uint8Array): string {
  let s = "";
  // De 32 KB en 32 KB: `String.fromCharCode` con un millón de argumentos
  // revienta la pila.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return s;
}

const ORDENES_DE_TEXTO = /\b(Tj|TJ)\b/;

/** Los flujos del PDF que contienen texto, ya descomprimidos. */
async function flujos(bytes: Uint8Array): Promise<string[]> {
  const crudo = latin1(bytes);
  const salida: string[] = [];
  let i = 0;

  while (true) {
    const abre = crudo.indexOf("stream", i);
    if (abre < 0) break;
    // `endstream` también contiene «stream»: hay que saltárselo.
    if (crudo.slice(abre - 3, abre) === "end") {
      i = abre + 6;
      continue;
    }
    let p = abre + 6;
    if (crudo.charCodeAt(p) === 13) p++;
    if (crudo.charCodeAt(p) === 10) p++;
    const cierra = crudo.indexOf("endstream", p);
    if (cierra < 0) break;

    // El salto de línea que separa el flujo de `endstream` no es del flujo:
    // dejarlo dentro hace que el descompresor se queje de basura al final y
    // tire toda la página. Con Node es un error duro, no un aviso.
    let fin = cierra;
    while (fin > p && (bytes[fin - 1] === 10 || bytes[fin - 1] === 13)) fin--;

    const texto = await inflar(bytes.subarray(p, fin));
    // Un flujo sin comprimir es legítimo y se lee tal cual.
    const contenido = texto ?? crudo.slice(p, fin);
    if (ORDENES_DE_TEXTO.test(contenido)) salida.push(contenido);
    i = cierra + 9;
  }
  return salida;
}

// ── 2 · Entender las órdenes de texto ────────────────────────────────────

/** Los 32 caracteres que WinAnsi pone donde Latin-1 no tiene nada. Sin esto
 *  un «€» sale como un cuadro y un apóstrofo tipográfico como basura. */
const WINANSI: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘",
  0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜",
  0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

const ESCAPES: Record<string, string> = {
  n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\",
};

/** Deshace los escapes de una cadena literal de PDF: `\(`, `\\`, `\351`. */
function cadena(crudo: string): string {
  let salida = "";
  for (let i = 0; i < crudo.length; i++) {
    const c = crudo[i];
    if (c !== "\\") {
      salida += WINANSI[c.charCodeAt(0)] ?? c;
      continue;
    }
    const sig = crudo[++i];
    if (sig == null) break;
    if (sig >= "0" && sig <= "7") {
      let oct = sig;
      while (oct.length < 3 && crudo[i + 1] >= "0" && crudo[i + 1] <= "7") oct += crudo[++i];
      const cod = parseInt(oct, 8);
      salida += WINANSI[cod] ?? String.fromCharCode(cod);
    } else if (sig === "\n") {
      // Barra al final de línea: la cadena sigue abajo, sin salto.
    } else {
      salida += ESCAPES[sig] ?? sig;
    }
  }
  return salida;
}

/** `<48656C6C6F>` es «Hello» escrito en hexadecimal. */
function hexadecimal(crudo: string): string {
  const limpio = crudo.replace(/[^0-9A-Fa-f]/g, "");
  let salida = "";
  for (let i = 0; i + 1 < limpio.length; i += 2) {
    const cod = parseInt(limpio.slice(i, i + 2), 16);
    salida += WINANSI[cod] ?? String.fromCharCode(cod);
  }
  return salida;
}

/** Un número, una cadena literal, una cadena hexadecimal, un array o un
 *  operador. Se recorre el flujo con esta expresión y no partiendo por
 *  espacios porque una cadena puede llevar espacios, paréntesis escapados y
 *  saltos de línea dentro. */
const TROZOS =
  /\((?:[^()\\]|\\[\s\S])*\)|<[0-9A-Fa-f\s]*>|\[(?:[^[\]\\]|\\[\s\S])*\]|-?\d*\.?\d+|[A-Za-z*'"]+/g;

/** Saca todas las cadenas colocadas de un flujo de contenido.
 *
 *  Sólo se sigue la pista de dónde se pone el texto, que es lo único que hace
 *  falta para reconstruir una tabla: `Tm` lo pone en un sitio absoluto y `Td`
 *  lo mueve desde el anterior. El tamaño de letra, el color y el resto de la
 *  máquina de dibujo no importan aquí. */
function celdas(flujo: string): CeldaPdf[] {
  const salida: CeldaPdf[] = [];
  const pila: string[] = [];
  let x = 0;
  let y = 0;
  let interlineado = 0;

  const suelta = (texto: string) => {
    if (texto.trim()) salida.push({ x, y, texto });
  };

  for (const t of flujo.match(TROZOS) ?? []) {
    const inicial = t[0];

    if (inicial === "(" || inicial === "<" || inicial === "[" || inicial === "-" || inicial === "." || (inicial >= "0" && inicial <= "9")) {
      pila.push(t);
      // La pila de operandos de un PDF nunca pasa de unos pocos; recortarla
      // evita que un flujo raro se coma la memoria.
      if (pila.length > 12) pila.shift();
      continue;
    }

    switch (t) {
      case "Tm": {
        // `a b c d e f Tm`: la posición son los dos últimos.
        const f = Number(pila.at(-1));
        const e = Number(pila.at(-2));
        if (isFinite(e) && isFinite(f)) {
          x = e;
          y = f;
        }
        break;
      }
      case "TD":
      case "Td": {
        // `TD` es `Td` y además fija el interlineado para los `T*` que vengan.
        if (t === "TD") interlineado = -Number(pila.at(-1) ?? 0);
        const ty = Number(pila.at(-1));
        const tx = Number(pila.at(-2));
        if (isFinite(tx) && isFinite(ty)) {
          x += tx;
          y += ty;
        }
        break;
      }
      case "TL":
        interlineado = Number(pila.at(-1) ?? 0);
        break;
      case "T*":
        y -= interlineado;
        break;
      case "Tj":
      case "'":
      case '"': {
        if (t !== "Tj") y -= interlineado;
        const s = pila.at(-1) ?? "";
        suelta(s[0] === "<" ? hexadecimal(s.slice(1, -1)) : cadena(s.slice(1, -1)));
        break;
      }
      case "TJ": {
        // `[(Ho) -20 (la)] TJ`: trozos de texto con ajustes de espaciado en
        // medio. Los ajustes son de cuartos de milésima de em: para colocar
        // una tabla no cambian nada y se ignoran.
        const bloque = pila.at(-1) ?? "";
        let junto = "";
        for (const parte of bloque.match(/\((?:[^()\\]|\\[\s\S])*\)|<[0-9A-Fa-f\s]*>/g) ?? []) {
          junto += parte[0] === "<" ? hexadecimal(parte.slice(1, -1)) : cadena(parte.slice(1, -1));
        }
        suelta(junto);
        break;
      }
      case "ET":
        break;
      default:
        break;
    }
    pila.length = 0;
  }

  return salida;
}

// ── 3 · De cadenas sueltas a filas ───────────────────────────────────────

/** Agrupa las celdas en filas por su altura, y dentro de cada fila junta las
 *  que comparten columna.
 *
 *  El caso que obliga a hacerlo así: una celda que no cabe se parte en dos
 *  renglones a la misma X. Si se tratara cada renglón como una fila, «AXA
 *  TRESOR COURT» y «TERME C EUR» serían dos posiciones distintas. */
export function enFilas(lista: CeldaPdf[], pagina: number): FilaPdf[] {
  const orden = [...lista].sort((a, b) => b.y - a.y || a.x - b.x);
  const grupos: CeldaPdf[][] = [];

  for (const c of orden) {
    const ultimo = grupos.at(-1);
    // Se compara con el renglón anterior y no con el primero del grupo: una
    // celda partida deja el primer trozo POR ENCIMA del resto de la fila
    // —«PICTET-CHINA IX P EUR @» a 462, las fechas a 455, «0.0381» a 448— y
    // medir desde arriba dejaba el segundo trozo fuera por dos décimas.
    //
    // El tope de altura impide lo contrario: que en un documento de renglones
    // muy juntos se vayan encadenando y acabe todo en una sola fila.
    const cabe =
      ultimo != null &&
      Math.abs(ultimo.at(-1)!.y - c.y) <= ALTO_FILA &&
      ultimo[0].y - c.y <= ALTO_FILA * 2.5;
    if (cabe) ultimo!.push(c);
    else grupos.push([c]);
  }

  return grupos.map((g) => {
    // Las que comparten columna se juntan de arriba abajo, que es el orden en
    // que se lee una celda partida en dos renglones.
    const columnas: CeldaPdf[][] = [];
    for (const c of [...g].sort((a, b) => a.x - b.x || b.y - a.y)) {
      const ultima = columnas.at(-1);
      if (ultima && Math.abs(ultima[0].x - c.x) <= ANCHO_COLUMNA) ultima.push(c);
      else columnas.push([c]);
    }
    return {
      pagina,
      y: Math.max(...g.map((c) => c.y)),
      celdas: columnas.map((col) => ({
        x: col[0].x,
        y: col[0].y,
        texto: col
          .map((c) => c.texto.trim())
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      })),
    };
  });
}

// ── 4 · La puerta de entrada ─────────────────────────────────────────────

export const ES_PDF = /^%PDF-/;

/** Lee un PDF y devuelve sus filas, página por página y de arriba abajo. */
export async function leerPdf(datos: ArrayBuffer | Uint8Array): Promise<FilaPdf[]> {
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const salida: FilaPdf[] = [];
  const paginas = await flujos(bytes);
  paginas.forEach((flujo, i) => salida.push(...enFilas(celdas(flujo), i + 1)));
  return salida;
}

// ── 5 · Ayudas para los adaptadores ──────────────────────────────────────

/** Toda la fila en una cadena, para buscar rótulos sin pensar en columnas. */
export const textoFila = (f: FilaPdf): string => f.celdas.map((c) => c.texto).join(" ");

/** Todo el documento en una cadena. Es lo que usan los detectores: para saber
 *  de qué banco es un extracto basta con buscar su nombre. */
export const textoPdf = (filas: FilaPdf[]): string => filas.map(textoFila).join("\n");

/** La celda que cae bajo una X, con el margen de una columna. Devuelve
 *  `undefined` cuando esa columna viene vacía en esta fila, que es justo lo
 *  que pasa con «Precio medio posición» en el extracto de MyInvestor. */
export function celdaEn(fila: FilaPdf, x: number, margen = 6): string | undefined {
  let mejor: CeldaPdf | undefined;
  let mejorDist = Infinity;
  for (const c of fila.celdas) {
    const d = Math.abs(c.x - x);
    if (d <= margen && d < mejorDist) {
      mejor = c;
      mejorDist = d;
    }
  }
  return mejor?.texto;
}
