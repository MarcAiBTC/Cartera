// ── FUENTES DE MERCADO ───────────────────────────────────────────────────
// Portado de `update_precios.py`, que llevaba meses funcionando. Lo que se
// conserva literalmente son las decisiones que costaron un fallo real:
//
//   · Dos hosts de Yahoo con reintentos: query1 falla solo cada pocas horas.
//   · El cierre anterior sale del PENÚLTIMO cierre de la serie diaria, no de
//     `chartPreviousClose`: con range=1mo ese campo es el cierre de hace un
//     mes y rompía la variación diaria de toda la cartera.
//   · Se filtran las velas con `close: null`, que es lo que devuelve Yahoo
//     para el día en curso mientras la sesión está abierta. Sin filtrarlas, el
//     cierre anterior se corría un día y el «hoy» saltaba de 36 a 56 y volvía.
//   · En los fondos (símbolos 0P…) `regularMarketPrice` se queda rezagado un
//     día y el valor liquidativo nuevo sólo aparece en la serie de cierres.
//   · GBp son peniques, no libras. Sin dividir entre 100, una posición en
//     Londres vale cien veces de más.
//
// Esto corre en el servidor, que es la única razón por la que funciona: desde
// el navegador, Yahoo no manda cabeceras CORS y la petición ni sale.

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
};

const YF_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

export const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pedirJson<T>(url: string, intentos = 3): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      ultimo = e;
      await dormir(1500 * (i + 1));
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error(String(ultimo));
}

export interface Cotizacion {
  precio: number;
  divisa: string;
  /** Cierre anterior fiable, en la divisa del activo */
  previo: number | null;
  cierres: number[];
}

export async function yahoo(simbolo: string): Promise<Cotizacion> {
  const ruta = `/v8/finance/chart/${encodeURIComponent(simbolo)}?range=1mo&interval=1d`;
  let ultimo: unknown;

  for (const host of YF_HOSTS) {
    try {
      const d = await pedirJson<{
        chart: {
          result: [
            {
              meta: {
                regularMarketPrice: number;
                currency?: string;
                regularMarketPreviousClose?: number;
                regularMarketTime?: number;
              };
              timestamp?: number[];
              indicators: { quote: [{ close: (number | null)[] }] };
            },
          ];
        };
      }>(`https://${host}${ruta}`, 2);

      const res = d.chart.result[0];
      const m = res.meta;
      let precio = Number(m.regularMarketPrice);
      const divisa = m.currency || "USD";

      // Fuera los nulos: son el día en curso sin cerrar.
      const cierres = (res.indicators.quote[0].close ?? []).filter(
        (c): c is number => c != null && isFinite(c),
      );

      // Fondos rezagados: si el gráfico trae un cierre posterior a la hora del
      // precio, ese cierre es el valor liquidativo bueno.
      const stamps = res.timestamp ?? [];
      const horaPrecio = m.regularMarketTime ?? 0;
      if (cierres.length > 0 && stamps.length > 0 && horaPrecio && stamps.at(-1)! > horaPrecio) {
        precio = cierres.at(-1)!;
      }

      // El penúltimo cierre es el de ayer; el último es la sesión en curso.
      let previo = m.regularMarketPreviousClose ?? null;
      if (cierres.length >= 2) previo = cierres[cierres.length - 2];

      if (!isFinite(precio) || precio <= 0) throw new Error("precio no válido");
      return { precio, divisa, previo: previo && isFinite(previo) ? previo : null, cierres };
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error(`sin datos para ${simbolo}`);
}

// ── DIVISAS ──────────────────────────────────────────────────────────────

export class Cambios {
  private tasas: Record<string, number> = { EUR: 1 };

  /** Euros por 1 unidad de esa divisa. */
  async aEuros(divisa: string): Promise<number> {
    // GBp / GBX son PENIQUES. Yahoo cotiza así casi todo Londres.
    if (divisa === "GBp" || divisa === "GBX") return (await this.aEuros("GBP")) / 100;
    if (this.tasas[divisa] != null) return this.tasas[divisa];

    try {
      const d = await pedirJson<{ rates: { EUR: number } }>(
        `https://api.frankfurter.dev/v1/latest?base=${divisa}&symbols=EUR`,
      );
      this.tasas[divisa] = Number(d.rates.EUR);
    } catch {
      // Respaldo: el cruce de Yahoo da divisa por 1 EUR, así que se invierte.
      const q = await yahoo(`EUR${divisa}=X`);
      this.tasas[divisa] = 1 / q.precio;
    }
    return this.tasas[divisa];
  }

  todas(): Record<string, number> {
    return { ...this.tasas };
  }
}

// ── CRIPTO ───────────────────────────────────────────────────────────────

export interface PrecioCripto {
  eur: number;
  previo: number | null;
}

/** CoinGecko, en euros directamente. El cambio de 24 h sirve para deducir el
 *  cierre anterior sin una segunda llamada. */
export async function coingecko(ids: string[]): Promise<Record<string, PrecioCripto>> {
  if (ids.length === 0) return {};
  const d = await pedirJson<
    Record<string, { eur?: number; eur_24h_change?: number }>
  >(
    `https://api.coingecko.com/api/v3/simple/price?ids=${[...new Set(ids)].sort().join(",")}` +
      `&vs_currencies=eur&include_24hr_change=true`,
  );

  const out: Record<string, PrecioCripto> = {};
  for (const [id, info] of Object.entries(d)) {
    if (!info.eur) continue;
    const cambio = info.eur_24h_change;
    out[id] = {
      eur: info.eur,
      previo: cambio != null ? info.eur / (1 + cambio / 100) : null,
    };
  }
  return out;
}

// ── SERIES HISTÓRICAS ────────────────────────────────────────────────────

export async function historicoYahoo(
  simbolo: string,
  rango = "2y",
): Promise<Record<string, number>> {
  const ruta = `/v8/finance/chart/${encodeURIComponent(simbolo)}?range=${rango}&interval=1d`;
  let ultimo: unknown;

  for (const host of YF_HOSTS) {
    try {
      const d = await pedirJson<{
        chart: {
          result: [{ timestamp?: number[]; indicators: { quote: [{ close: (number | null)[] }] } }];
        };
      }>(`https://${host}${ruta}`, 2);

      const res = d.chart.result[0];
      const stamps = res.timestamp ?? [];
      const cierres = res.indicators.quote[0].close ?? [];
      const serie: Record<string, number> = {};
      stamps.forEach((ts, i) => {
        const c = cierres[i];
        if (c == null || !isFinite(c)) return;
        serie[new Date(ts * 1000).toISOString().slice(0, 10)] = c;
      });
      if (Object.keys(serie).length > 0) return serie;
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error(`sin histórico para ${simbolo}`);
}

/** Serie diaria del BCE vía Frankfurter: `{ fecha: tipo }`. */
export async function serieCambios(
  base: string,
  destino = "EUR",
  dias = 760,
): Promise<Record<string, number>> {
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - dias * 86400e3);
  const d = await pedirJson<{ rates: Record<string, Record<string, number>> }>(
    `https://api.frankfurter.dev/v1/${desde.toISOString().slice(0, 10)}..${hoy
      .toISOString()
      .slice(0, 10)}?base=${base}&symbols=${destino}`,
  );
  const out: Record<string, number> = {};
  for (const [fecha, r] of Object.entries(d.rates ?? {})) {
    const v = r[destino];
    if (v != null && isFinite(v)) out[fecha] = v;
  }
  return out;
}
