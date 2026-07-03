// Informe diario de cartera por correo — 100% gratuito, sin APIs de pago.
// - Posiciones: secret POSICIONES_JSON (formato del botón "Guardar cartera" / exportJSON()).
// - Precios: precios.json del repo (mismo feed que usa index.html).
// - Noticias: endpoint público de búsqueda de Yahoo Finance (sin clave).
// - Redacción: plantilla HTML en este script (sin IA).
// - Envío: Resend (plan gratuito), from onboarding@resend.dev.
// Ejecutar con Node >= 18 desde la raíz del repo: node scripts/informe_diario.mjs
// Vars: POSICIONES_JSON (oblig.), RESEND_API_KEY, FORCE=1 (salta el control horario), DRY_RUN=1 (no envía).

import { readFileSync, writeFileSync } from 'node:fs';

const DESTINO = 'mrmarcytthebest@gmail.com';
const REMITE  = 'Cartera <onboarding@resend.dev>';
const TZ      = 'Europe/Madrid';

const up = s => (s || '').toString().toUpperCase().trim();
const fe = (n, d = 2) => n == null || isNaN(n) ? '—'
  : new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n) + ' €';
const fp = n => n == null || !isFinite(n) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── 1. Control horario: el cron UTC no sabe de horario de verano ──────────────
const partes = new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, hour: '2-digit', hour12: false, weekday: 'long',
  day: '2-digit', month: 'long', year: 'numeric',
}).formatToParts(new Date());
const parte = t => partes.find(p => p.type === t)?.value || '';
const horaMadrid = parseInt(parte('hour'), 10);
const fechaLarga = `${parte('weekday')}, ${parte('day')} de ${parte('month')} de ${parte('year')}`;

if (process.env.FORCE !== '1' && horaMadrid !== 22) {
  console.log(`Son las ${horaMadrid}h en Madrid (no las 22h): este disparo del cron corresponde al otro horario (verano/invierno). No se envía nada.`);
  process.exit(0);
}

// ── 2. Posiciones (secret) y precios (repo) ───────────────────────────────────
if (!process.env.POSICIONES_JSON) {
  console.error('Falta el secret POSICIONES_JSON. Crea el secret con el JSON del botón "Guardar cartera" de la app.');
  process.exit(1);
}
let cartera;
try { cartera = JSON.parse(process.env.POSICIONES_JSON); }
catch (e) { console.error('POSICIONES_JSON no es JSON válido: ' + e.message); process.exit(1); }
const assets = Array.isArray(cartera) ? cartera : (cartera.assets || []);
if (!assets.length) { console.error('POSICIONES_JSON no contiene assets.'); process.exit(1); }

const feed = JSON.parse(readFileSync(new URL('../precios.json', import.meta.url), 'utf8'));
const alias = feed.alias || {};
const precios = feed.precios || {};
const feedTs = Date.parse(feed.generated_at) || Date.now();
const feedViejo = Date.now() - feedTs > 3 * 3600 * 1000; // >3 h sin actualizar

// Misma resolución de símbolo que keyOf() en index.html.
const keyOf = a => {
  if (a.yfSym && precios[a.yfSym]) return a.yfSym;
  const i = up(a.isin), t = up(a.ticker);
  return (alias[i] && precios[alias[i]]) ? alias[i]
       : precios[t] ? t
       : (alias[t] && precios[alias[t]]) ? alias[t] : null;
};
// px()/pxPrev() como en index.html (con el arreglo del spark para el cierre anterior).
const px = a => {
  if (a.cat === 'liquidez') return a.mp ?? 1;
  if (a.mode === 'auto') {
    const sym = keyOf(a);
    if (sym && precios[sym].eur > 0) return precios[sym].eur;
  }
  return a.mp ?? null;
};
const pxPrev = a => {
  if (a.cat === 'liquidez') return a.mp ?? 1;
  if (a.mode !== 'auto') return null;
  const sym = keyOf(a); if (!sym) return null;
  const pe = precios[sym];
  let prev = pe.prev > 0 ? pe.prev : null;
  // chartPreviousClose de Yahoo puede ser el cierre de hace un mes: manda el penúltimo del spark.
  if (pe.src !== 'coingecko' && Array.isArray(pe.spark) && pe.spark.length >= 2) {
    const sp2 = pe.spark[pe.spark.length - 2];
    if (sp2 > 0) prev = sp2;
  }
  return prev;
};

// ── 3. Cálculos ───────────────────────────────────────────────────────────────
const filas = assets.map(a => {
  const p = px(a), pv = pxPrev(a);
  const valor = p != null ? a.qty * p : null;
  const coste = a.qty * (a.costUnit || 0);
  const dia = (p != null && pv > 0 && a.cat !== 'liquidez')
    ? { abs: a.qty * (p - pv), pct: (p - pv) / pv * 100 } : null;
  return { a, valor, coste, dia };
});
const total = filas.reduce((s, f) => s + (f.valor || 0), 0);
const costeTotal = filas.reduce((s, f) => s + f.coste, 0);
let diaAbs = 0, diaBase = 0, hayDia = false;
for (const f of filas) if (f.dia) { diaAbs += f.dia.abs; diaBase += (f.valor || 0) - f.dia.abs; hayDia = true; }
const diaPct = hayDia && diaBase > 0 ? diaAbs / diaBase * 100 : null;
const ganTotal = total - costeTotal;

const conDia = filas.filter(f => f.dia && Math.abs(f.dia.abs) >= 0.01);
const subidas = conDia.filter(f => f.dia.abs > 0).sort((x, y) => y.dia.abs - x.dia.abs).slice(0, 3);
const bajadas = conDia.filter(f => f.dia.abs < 0).sort((x, y) => x.dia.abs - y.dia.abs).slice(0, 3);

// ── 4. Noticias (Yahoo Finance search, sin clave) ─────────────────────────────
const consultaDe = f => {
  const a = f.a, u = (a.underlying || a.name || '').toLowerCase();
  if (/bitcoin/.test(u)) return 'BTC-USD';
  if (/ethereum/.test(u)) return 'ETH-USD';
  if (/\boro\b|gold/.test(u)) return 'GC=F';
  if (/plata|silver/.test(u)) return 'SI=F';
  if (a.yfSym && !a.yfSym.startsWith('0P')) return a.yfSym;
  if (a.ticker && !up(a.ticker).startsWith('0P')) return up(a.ticker);
  return null;
};
const consultas = [];
for (const f of filas.slice().sort((x, y) => (y.valor || 0) - (x.valor || 0))) {
  if (f.a.cat === 'liquidez' || f.a.cat === 'fondo') continue;
  const q = consultaDe(f);
  if (q && !consultas.includes(q)) consultas.push(q);
  if (consultas.length >= 6) break;
}
async function noticiasDe(q) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=4&quotesCount=0&lang=es-ES&region=ES`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (informe-cartera)' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.news || []).map(n => ({
      titulo: n.title, medio: n.publisher, enlace: n.link,
      ts: (n.providerPublishTime || 0) * 1000, sobre: q,
    }));
  } catch { return []; }
}
const brutas = (await Promise.all(consultas.map(noticiasDe))).flat();
const vistas = new Set();
const noticias = brutas
  .filter(n => n.titulo && n.enlace && !vistas.has(n.titulo) && vistas.add(n.titulo))
  .filter(n => n.ts > Date.now() - 48 * 3600 * 1000)
  .sort((x, y) => y.ts - x.ts)
  .slice(0, 8);

// ── 5. Correo (plantilla, sin IA) ────────────────────────────────────────────
const col = n => n == null ? '#8b86a8' : n >= 0 ? '#1f9d55' : '#d64545';
const flecha = n => n == null ? '' : n >= 0 ? '▲' : '▼';
const signo = diaAbs >= 0 ? '+' : '';
const fechaCorta = new Date().toLocaleDateString('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const asunto = hayDia
  ? `📊 Cartera ${fechaCorta}: ${signo}${fe(diaAbs)} (${fp(diaPct)})`
  : `📊 Cartera ${fechaCorta}: sin datos intradía hoy`;

const filaHtml = f => {
  const d = f.dia;
  return `<tr>
    <td style="padding:7px 10px;border-bottom:1px solid #eee9f7">${esc(f.a.name)}</td>
    <td style="padding:7px 10px;border-bottom:1px solid #eee9f7;text-align:right;white-space:nowrap">${fe(f.valor)}</td>
    <td style="padding:7px 10px;border-bottom:1px solid #eee9f7;text-align:right;white-space:nowrap;color:${col(d?.abs)}">${d ? `${flecha(d.abs)} ${fe(d.abs)}` : '—'}</td>
    <td style="padding:7px 10px;border-bottom:1px solid #eee9f7;text-align:right;white-space:nowrap;color:${col(d?.pct)}">${d ? fp(d.pct) : '—'}</td>
  </tr>`;
};
const moverHtml = f =>
  `<li style="margin:4px 0">${esc(f.a.name)}: <b style="color:${col(f.dia.abs)}">${flecha(f.dia.abs)} ${fe(f.dia.abs)} (${fp(f.dia.pct)})</b></li>`;
const notiHtml = n =>
  `<li style="margin:8px 0"><a href="${esc(n.enlace)}" style="color:#5b4bc4;text-decoration:none;font-weight:600">${esc(n.titulo)}</a><br>
   <span style="color:#8b86a8;font-size:12px">${esc(n.medio || '')} · ${esc(n.sobre)} · ${new Date(n.ts).toLocaleString('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></li>`;

const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f4f2fb;font-family:'Segoe UI',Arial,sans-serif;color:#2c2846">
<div style="max-width:640px;margin:0 auto;padding:24px 14px">
  <div style="background:linear-gradient(135deg,#5b4bc4,#8e7cf0);border-radius:16px;padding:22px 24px;color:#fff">
    <div style="font-size:13px;opacity:.85">${esc(fechaLarga)} · 22:05 (Madrid)</div>
    <div style="font-size:15px;margin-top:10px;opacity:.9">Valor de la cartera</div>
    <div style="font-size:32px;font-weight:800">${fe(total)}</div>
    <div style="font-size:18px;font-weight:700;margin-top:6px;color:${diaAbs >= 0 ? '#b8f5c9' : '#ffc9c9'}">
      ${flecha(diaAbs)} Hoy: ${signo}${fe(diaAbs)} (${fp(diaPct)})
    </div>
    <div style="font-size:13px;margin-top:4px;opacity:.85">Desde compra: ${ganTotal >= 0 ? '+' : ''}${fe(ganTotal)} (${fp(costeTotal > 0 ? ganTotal / costeTotal * 100 : null)})</div>
    ${feedViejo ? `<div style="margin-top:8px;font-size:12px;background:rgba(0,0,0,.25);border-radius:8px;padding:6px 10px">⚠️ Ojo: el feed de precios lleva más de 3 h sin actualizarse (${new Date(feedTs).toLocaleString('es-ES', { timeZone: TZ })}).</div>` : ''}
  </div>

  <div style="background:#fff;border-radius:16px;padding:18px 22px;margin-top:14px">
    <h2 style="font-size:16px;margin:0 0 8px">🔎 Qué ha movido la cartera hoy</h2>
    ${subidas.length ? `<div style="font-size:13px;color:#8b86a8;margin-top:6px">Tiran hacia arriba</div><ul style="margin:4px 0;padding-left:18px;font-size:14px">${subidas.map(moverHtml).join('')}</ul>` : ''}
    ${bajadas.length ? `<div style="font-size:13px;color:#8b86a8;margin-top:6px">Pesan hacia abajo</div><ul style="margin:4px 0;padding-left:18px;font-size:14px">${bajadas.map(moverHtml).join('')}</ul>` : ''}
    ${!conDia.length ? '<p style="font-size:14px">Sin movimientos intradía relevantes (o sin datos de cierre anterior).</p>' : ''}
  </div>

  <div style="background:#fff;border-radius:16px;padding:18px 22px;margin-top:14px">
    <h2 style="font-size:16px;margin:0 0 10px">📋 Posiciones</h2>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr style="color:#8b86a8;text-align:right"><th style="text-align:left;padding:4px 10px">Activo</th><th style="padding:4px 10px">Valor</th><th style="padding:4px 10px">Hoy €</th><th style="padding:4px 10px">Hoy %</th></tr>
      ${filas.slice().sort((x, y) => (y.valor || 0) - (x.valor || 0)).map(filaHtml).join('')}
    </table>
  </div>

  ${noticias.length ? `<div style="background:#fff;border-radius:16px;padding:18px 22px;margin-top:14px">
    <h2 style="font-size:16px;margin:0 0 8px">📰 Noticias de tus posiciones (últimas 48 h)</h2>
    <ul style="margin:0;padding-left:18px;font-size:14px">${noticias.map(notiHtml).join('')}</ul>
  </div>` : ''}

  <div style="text-align:center;color:#8b86a8;font-size:11px;margin-top:16px">
    Informe automático (GitHub Actions) · precios del feed de ${new Date(feedTs).toLocaleTimeString('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })} · sin coste, sin IA
  </div>
</div></body></html>`;

writeFileSync('informe.html', html);
console.log(`Informe generado: total ${fe(total)}, día ${signo}${fe(diaAbs)} (${fp(diaPct)}), ${noticias.length} noticias de [${consultas.join(', ')}].`);

// ── 6. Envío con Resend ───────────────────────────────────────────────────────
if (process.env.DRY_RUN === '1') {
  console.log('DRY_RUN=1: no se envía. Revisa informe.html.');
} else if (!process.env.RESEND_API_KEY) {
  console.error('Falta el secret RESEND_API_KEY: informe generado pero NO enviado.');
  process.exitCode = 1;
} else {
  const rs = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: REMITE, to: [DESTINO], subject: asunto, html }),
  });
  const rsBody = await rs.text();
  if (!rs.ok) { console.error(`Resend devolvió ${rs.status}: ${rsBody}`); process.exitCode = 1; }
  else console.log(`Correo enviado a ${DESTINO}: ${rsBody}`);
}
