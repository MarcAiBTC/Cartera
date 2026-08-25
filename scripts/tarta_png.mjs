// Gráfico circular (donut) como PNG, sin dependencias.
//
// Por qué un PNG y no un SVG o un canvas: el correo se lee en Gmail, y Gmail
// borra los <svg>, no ejecuta JavaScript y no entiende conic-gradient. Una
// imagen PNG incrustada en el propio mensaje (cid:) es lo único que se ve igual
// en Gmail web, Gmail móvil, Apple Mail y Outlook.
//
// El PNG se escribe a mano: cabecera, píxeles en RGBA y zlib de Node. Son 60
// líneas y evita meter una librería de gráficos (y un headless Chrome) en el
// workflow diario.

import { deflateSync } from 'node:zlib';

// ── PNG mínimo (color tipo 6 = RGBA, 8 bits) ─────────────────────────────────
const CRC_TABLA = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
const crc32 = buf => {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLA[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (~c) >>> 0;
};
const trozo = (tipo, datos) => {
  const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length, 0);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([largo, cuerpo, crc]);
};

export function png(ancho, alto, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // Cada fila lleva delante su byte de filtro (0 = sin filtro).
  const crudo = Buffer.alloc(alto * (1 + ancho * 4));
  for (let y = 0; y < alto; y++) {
    crudo[y * (1 + ancho * 4)] = 0;
    rgba.copy(crudo, y * (1 + ancho * 4) + 1, y * ancho * 4, (y + 1) * ancho * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

const rgb = hex => {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// ── Donut ────────────────────────────────────────────────────────────────────
// segmentos: [{ pct, col }] en el orden en que se quieren dibujar.
// El fondo va transparente para que la imagen se apoye sobre la tarjeta del
// correo sin recortes blancos si el cliente la oscurece en modo noche.
//
// El antialiasing es por supermuestreo (MUESTRA² puntos por píxel): sin él, el
// borde del círculo sale escalonado y en un móvil se nota muchísimo.
export function donutPNG(segmentos, { lado = 640, hueco = 0.60, hueso = 0.008, muestra = 3 } = {}) {
  const total = segmentos.reduce((s, x) => s + Math.max(0, x.pct || 0), 0);
  const px = Buffer.alloc(lado * lado * 4); // ya es transparente (todo a cero)
  if (!(total > 0)) return png(lado, lado, px);

  const c = lado / 2;
  const rExt = lado / 2 - 1;
  const rInt = rExt * hueco;
  const TAU = Math.PI * 2;

  // Ángulos acumulados, empezando arriba (12 en punto) y girando como el reloj.
  const tramos = [];
  let acc = 0;
  for (const s of segmentos) {
    const frac = Math.max(0, s.pct || 0) / total;
    if (frac <= 0) continue;
    tramos.push({ a0: acc * TAU, a1: (acc + frac) * TAU, col: rgb(s.col || '#9d97b8') });
    acc += frac;
  }
  // Con una sola porción no hay separación que dibujar: el hueso partiría el
  // anillo por la mitad sin ningún motivo.
  const sep = tramos.length > 1 ? hueso * TAU : 0;

  const paso = 1 / muestra, mitad = paso / 2, sub = muestra * muestra;
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < muestra; sy++) {
        for (let sx = 0; sx < muestra; sx++) {
          const dx = x + sx * paso + mitad - c;
          const dy = y + sy * paso + mitad - c;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > rExt || d < rInt) continue;
          // atan2 con el eje girado: 0 arriba, creciendo hacia la derecha.
          let ang = Math.atan2(dx, -dy);
          if (ang < 0) ang += TAU;
          const t = tramos.find(t => ang >= t.a0 && ang < t.a1) || tramos[tramos.length - 1];
          if (sep > 0 && (ang - t.a0 < sep / 2 || t.a1 - ang < sep / 2)) continue;
          r += t.col[0]; g += t.col[1]; b += t.col[2]; a += 255;
        }
      }
      if (!a) continue;
      const n = a / 255;
      const i = (y * lado + x) * 4;
      px[i] = Math.round(r / n); px[i + 1] = Math.round(g / n); px[i + 2] = Math.round(b / n);
      px[i + 3] = Math.round(a / sub);
    }
  }
  return png(lado, lado, px);
}
