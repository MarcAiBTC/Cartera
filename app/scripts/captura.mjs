// ── CAPTURAS ─────────────────────────────────────────────────────────────
// Herramienta de desarrollo para mirar la app a tamaño de móvil de verdad.
//
// Por qué no basta con `chrome --headless --screenshot --window-size=430,932`:
// en Windows la ventana tiene una anchura mínima de unos 500 px, así que la
// página se maqueta a 500 y la captura se recorta a 430. El resultado parece
// un desbordamiento horizontal que no existe, y se va detrás de un bug
// inventado.
//
// La solución es hablar con el navegador por su protocolo de depuración y
// forzar las medidas del dispositivo, que sí admiten cualquier anchura.
//
//   node scripts/captura.mjs http://localhost:4173/ salida.png [ancho] [alto]
//
// Con alto 0 hace la captura de la página entera.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, salida, anchoArg = "430", altoArg = "932"] = process.argv.slice(2);
if (!url || !salida) {
  console.error("uso: node scripts/captura.mjs <url> <salida.png> [ancho] [alto]");
  process.exit(1);
}

const ancho = Number(anchoArg);
const alto = Number(altoArg);
const completa = alto === 0;

const CHROME =
  process.env.CHROME_PATH ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const puerto = 9222 + Math.floor(Math.random() * 500);
const perfil = mkdtempSync(join(tmpdir(), "captura-"));

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${puerto}`,
    `--user-data-dir=${perfil}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function objetivo() {
  // El puerto tarda un instante en abrirse; se reintenta en vez de dormir a ojo.
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${puerto}/json/new?about:blank`, {
        method: "PUT",
      });
      if (r.ok) return await r.json();
    } catch {
      /* todavía no escucha */
    }
    await esperar(150);
  }
  throw new Error("El navegador no ha abierto el puerto de depuración");
}

const t = await objetivo();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let n = 0;
const pendientes = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pendientes.has(m.id)) {
    pendientes.get(m.id)(m.result);
    pendientes.delete(m.id);
  }
};
const cmd = (method, params = {}) =>
  new Promise((r) => {
    const id = ++n;
    pendientes.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });

await cmd("Page.enable");
await cmd("Emulation.setDeviceMetricsOverride", {
  width: ancho,
  height: completa ? 932 : alto,
  deviceScaleFactor: 2,
  mobile: ancho < 700,
});
// Cada captura arranca con un perfil limpio, así que el almacenamiento está
// vacío. Con SEMBRAR se visita antes la página que deja los datos de prueba —
// mismo origen, mismo localStorage — y sólo después se va a la pantalla que
// interesa. Sin esto, todas las pantallas salen con su mensaje de «aún no hay
// nada».
if (process.env.SEMBRAR) {
  await cmd("Page.navigate", { url: process.env.SEMBRAR });
  await esperar(1500);
}

await cmd("Page.navigate", { url });
// Sin espera fija no da tiempo ni a los datos ni a las fuentes de Google.
await esperar(3500);

const { data } = await cmd("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: completa,
});
writeFileSync(salida, Buffer.from(data, "base64"));

ws.close();
chrome.kill();
console.log(`${salida} · ${ancho}px${completa ? " (página entera)" : ` × ${alto}px`}`);
process.exit(0);
