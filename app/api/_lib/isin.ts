// ── DE ISIN A SÍMBOLO DE YAHOO ───────────────────────────────────────────
// Casi todos los brókeres europeos exportan el ISIN y nada más: Trade
// Republic, MyInvestor, ING, Renta 4. Sin traducirlo, cada compra importada
// nace sin cotización y hay que emparejarla a mano.
//
// El catálogo trae ese alias para los símbolos que se curaron a mano, que son
// una minoría (24 de 528 cuando se escribió esto). Para el resto se pregunta
// al buscador de Yahoo, que sí acepta un ISIN como consulta — y que desde el
// navegador es inalcanzable, porque no manda cabeceras CORS. De ahí que esto
// viva en el servidor.
//
// Lo que se resuelve se guarda en el catálogo: la segunda vez que alguien
// importe ese ISIN, ya no hace falta preguntar.

import type { SupabaseClient } from "@supabase/supabase-js";

const BUSCADOR = "https://query2.finance.yahoo.com/v1/finance/search";

/** Un ISIN son 2 letras de país + 9 alfanuméricos + 1 dígito de control. */
export const ES_ISIN = (s: string): boolean => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(s.trim().toUpperCase());

interface Candidato {
  symbol: string;
  exchange?: string;
  quoteType?: string;
  shortname?: string;
  longname?: string;
}

/** Las bolsas donde un valor europeo cotiza en su divisa de casa y con
 *  histórico completo. El orden es el de preferencia.
 *
 *  Por qué hace falta elegir: Yahoo devuelve el mismo valor listado en cinco
 *  sitios, y las listas alemanas de Stuttgart o Múnich devuelven series con
 *  huecos y, peor, en una divisa distinta de la que el bróker te cobró. Ese
 *  es exactamente el fallo que hacía saltar sola la variación diaria. */
const BOLSAS = ["MCE", "EBS", "LSE", "AMS", "PAR", "GER", "MIL", "NMS", "NYQ", "NGM", "BUE"];

/** Sufijos que delatan una lista secundaria alemana. Devuelven el ISIN como
 *  «símbolo», que no sirve para pedir precios con garantías. */
const SECUNDARIAS = /\.(SG|MU|BE|DU|HM|HA)$/i;

function mejor(candidatos: Candidato[]): Candidato | undefined {
  const validos = candidatos.filter(
    (c) => c.symbol && !SECUNDARIAS.test(c.symbol) && c.quoteType !== "FUTURE",
  );
  if (validos.length === 0) return undefined;

  // Un símbolo que es el ISIN con un sufijo pegado no es un símbolo: es que
  // Yahoo no conoce el valor y está repitiendo la pregunta.
  const conNombre = validos.filter((c) => !/^[A-Z]{2}[A-Z0-9]{9}\d\./.test(c.symbol));
  const lista = conNombre.length ? conNombre : validos;

  return [...lista].sort((a, b) => {
    const ra = BOLSAS.indexOf(a.exchange ?? "");
    const rb = BOLSAS.indexOf(b.exchange ?? "");
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  })[0];
}

export interface Resuelto {
  /** Sólo se rellena si el alias no se ha podido guardar en el catálogo. */
  avisoCache?: string;
  isin: string;
  symbol: string | null;
  name: string | null;
  origen: "catalogo" | "yahoo" | "no-encontrado";
}

async function preguntarAYahoo(isin: string): Promise<Candidato | undefined> {
  const r = await fetch(`${BUSCADOR}?q=${encodeURIComponent(isin)}&quotesCount=8&newsCount=0`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!r.ok) throw new Error(`Yahoo ha contestado ${r.status}`);
  const j = (await r.json()) as { quotes?: Candidato[] };
  return mejor(j.quotes ?? []);
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Traduce una lista de ISIN. Mira primero el catálogo, pregunta a Yahoo sólo
 *  por los que falten, y aprende lo que averigua. */
export async function resolverIsines(sb: SupabaseClient, isines: string[]): Promise<Resuelto[]> {
  const limpios = [...new Set(isines.map((i) => i.trim().toUpperCase()).filter(ES_ISIN))];
  if (limpios.length === 0) return [];

  // ── 1 · El catálogo ────────────────────────────────────────────────────
  const { data: enCatalogo } = await sb
    .from("catalog")
    .select("symbol,name,isin,yahoo")
    .in("isin", limpios);

  const porIsin = new Map<string, Resuelto>();
  for (const c of enCatalogo ?? []) {
    const fila = c as { symbol: string; name: string | null; isin: string; yahoo: string | null };
    porIsin.set(fila.isin.toUpperCase(), {
      isin: fila.isin.toUpperCase(),
      symbol: fila.yahoo ?? fila.symbol,
      name: fila.name,
      origen: "catalogo",
    });
  }

  // ── 2 · Yahoo, uno a uno ───────────────────────────────────────────────
  // En serie y con pausa: el buscador corta en seco si se le hacen veinte
  // preguntas a la vez, y ahí perderíamos TODAS en vez de una.
  const pendientes = limpios.filter((i) => !porIsin.has(i));
  const aprendidos: { isin: string; symbol: string; name: string | null }[] = [];
  const fallosAlGuardar: string[] = [];

  for (const isin of pendientes) {
    try {
      const c = await preguntarAYahoo(isin);
      if (c) {
        const nombre = c.shortname ?? c.longname ?? null;
        porIsin.set(isin, { isin, symbol: c.symbol, name: nombre, origen: "yahoo" });
        aprendidos.push({ isin, symbol: c.symbol, name: nombre });
      } else {
        porIsin.set(isin, { isin, symbol: null, name: null, origen: "no-encontrado" });
      }
    } catch {
      // Un fallo de red no es un «no existe»: se deja sin resolver para que
      // el siguiente intento vuelva a probarlo en vez de grabar un hueco.
      porIsin.set(isin, { isin, symbol: null, name: null, origen: "no-encontrado" });
    }
    await dormir(250);
  }

  // ── 3 · Aprender ───────────────────────────────────────────────────────
  // El alias se guarda en la fila del símbolo. Si el símbolo ya estaba en el
  // catálogo sin ISIN —el caso normal: 504 de 528 lo estaban— se le añade;
  // si no estaba, se crea la entrada.
  if (aprendidos.length) {
    const { data: existentes } = await sb
      .from("catalog")
      .select("symbol,isin")
      .in("symbol", aprendidos.map((a) => a.symbol));
    const yaEstan = new Set((existentes ?? []).map((e) => (e as { symbol: string }).symbol));

    const filas = aprendidos.map((a) => ({
      symbol: a.symbol,
      isin: a.isin,
      ...(yaEstan.has(a.symbol) ? {} : { name: a.name, yahoo: a.symbol, retired: false }),
    }));
    // `upsert` sobre la clave del símbolo: añade el ISIN al que ya existe y
    // crea el que no. Fila a fila y no en lote: si una sola fila del lote es
    // inválida, PostgREST rechaza el INSERT entero y se pierden TODOS los
    // alias — que fue exactamente lo que pasó la primera vez, y en silencio
    // porque el error ni se miraba.
    for (const fila of filas) {
      const { error } = await sb.from("catalog").upsert(fila, { onConflict: "symbol" });
      // Un alias que no se puede guardar no invalida la respuesta: es caché.
      if (error) fallosAlGuardar.push(`${fila.symbol}: ${error.message}`);
    }
  }

  if (fallosAlGuardar.length) {
    console.warn("[isin] alias no guardados en el catálogo:", fallosAlGuardar.join("; "));
  }

  return limpios.map((i) => porIsin.get(i) ?? { isin: i, symbol: null, name: null, origen: "no-encontrado" });
}
