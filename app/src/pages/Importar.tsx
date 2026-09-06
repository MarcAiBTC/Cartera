// ── IMPORTAR ─────────────────────────────────────────────────────────────
// La pantalla que quita el trabajo de teclear cada compra: arrastras el
// archivo que te da el bróker y la cartera se rellena sola.
//
// Tres pasos y ninguna sorpresa: se detecta el formato, se enseña TODO lo que
// va a entrar —incluido lo que se va a descartar y por qué— y sólo entonces se
// escribe. Importar a ciegas un extracto de cinco años es la mejor manera de
// meter cien líneas mal y no enterarse hasta meses después.

import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDatos } from "../lib/datos";
import {
  adivinarMapa,
  desdeTexto,
  detectar,
  ETIQUETA_CAMPO,
  FORMATO_LBL,
  leer,
  leerArchivo,
  planificar,
  type CampoImport,
  type Entrada,
  type Formato,
  type Mapa,
  type Plan,
} from "../lib/import";
import type { Activo, Cuenta, EntradaCatalogo, Operacion } from "../lib/tipos";
import { OP_LBL } from "../lib/tipos";
import { fd, fe, fn } from "../lib/formato";
import {
  Aviso,
  Boton,
  Cargando,
  Etiqueta,
  Hoja,
  Selector,
  Tarjeta,
  TituloSeccion,
} from "../components/base";

const AYUDA: { broker: string; pasos: string; ojo?: string }[] = [
  {
    broker: "Trade Republic",
    pasos: "En la app: Perfil → Extractos → «Exportación de transacción», eliges las fechas y descargas el CSV.",
    ojo: "Sólo está en la app del móvil, y no lo abras en Excel antes de subirlo: al guardarlo cambia las fechas y los decimales.",
  },
  {
    broker: "Revolut",
    pasos: "En Inversiones → Documentos → «Extracto de cuenta», en formato Excel o CSV.",
    ojo: "Tiene que ser el extracto de cuenta, no el de pérdidas y ganancias ni el de costes: esos no traen los movimientos.",
  },
  {
    broker: "MyInvestor",
    pasos: "En la web: Mi cartera → Movimientos → Descargar. También vale el JSON de la propia web.",
    ojo: "Los traspasos entre fondos tuyos se marcan aparte para que no cuenten como dinero nuevo aportado.",
  },
  {
    broker: "Cualquier otro",
    pasos: "Un CSV, TSV o Excel con una fila por movimiento. Si alguna columna no se reconoce, la eliges a mano.",
  },
];

const FORMATOS: Formato[] = [
  "traderepublic-csv",
  "revolut-csv",
  "myinvestor-tabla",
  "myinvestor-json",
  "generico-csv",
  "generico-json",
];

export default function Importar() {
  const { estado, mercado, insertar, recargar } = useDatos();
  const navegar = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [entrada, setEntrada] = useState<Entrada | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [formato, setFormato] = useState<Formato | null>(null);
  const [mapa, setMapa] = useState<Mapa>({});
  const [cuentaId, setCuentaId] = useState<string>("");
  const [sobre, setSobre] = useState(false);
  const [pegando, setPegando] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState<{ ops: number; activos: number } | null>(null);
  // Alias ISIN -> simbolo que ha resuelto el servidor para ESTE archivo. El
  // catalogo solo trae el alias de los simbolos curados a mano, y todos los
  // brokers europeos exportan ISIN: sin esto, cada valor importado nace sin
  // cotizacion. Yahoo no se puede consultar desde aqui (no manda CORS), asi
  // que lo hace /api/isin.
  const [resueltos, setResueltos] = useState<EntradaCatalogo[]>([]);
  const [resolviendo, setResolviendo] = useState(false);

  // ── El plan se recalcula solo con cada cambio: no hay un botón de
  //    «previsualizar» que se pueda quedar desincronizado del formulario.
  const plan: Plan | null = useMemo(() => {
    if (!entrada || !formato) return null;
    const lectura = leer(entrada, { formato, mapa });
    return planificar(lectura, {
      estado,
      fx: mercado.fx,
      // Los alias recien resueltos van DELANTE: son mas frescos que el
      // catalogo que se cargo al abrir la app.
      catalogo: [...resueltos, ...mercado.catalogo],
      cuentaId: cuentaId || undefined,
    });
  }, [entrada, formato, mapa, estado, mercado, cuentaId, resueltos]);

  /** Pregunta al servidor por los ISIN que el catalogo no sabe traducir. */
  async function resolverIsines(e: Entrada, f: Formato) {
    try {
      const lectura = leer(e, { formato: f, mapa: e.tabla ? adivinarMapa(e.tabla) : {} });
      const conocidos = new Set(
        mercado.catalogo.map((c) => (c.isin ?? "").toUpperCase()).filter(Boolean),
      );
      const faltan = [
        ...new Set(
          lectura.filas
            .map((x) => (x.isin ?? "").toUpperCase())
            .filter((i) => i && !conocidos.has(i)),
        ),
      ];
      if (faltan.length === 0) return;

      setResolviendo(true);
      // De 40 en 40, que es el tope de la ruta.
      const nuevos: EntradaCatalogo[] = [];
      for (let i = 0; i < faltan.length; i += 40) {
        const r = await fetch("/api/isin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isines: faltan.slice(i, i + 40) }),
        });
        if (!r.ok) break;
        const j = (await r.json()) as {
          resultados?: { isin: string; symbol: string | null; name: string | null }[];
        };
        for (const x of j.resultados ?? []) {
          if (!x.symbol) continue;
          nuevos.push({
            symbol: x.symbol,
            name: x.name,
            isin: x.isin,
            ticker: x.symbol,
            yahoo: x.symbol,
            coingecko: null,
            currency: null,
            cat: null,
            underlying: null,
            retired: false,
          });
        }
      }
      if (nuevos.length) setResueltos(nuevos);
    } catch {
      // Sin conexion con el servidor se importa igual: los valores entran sin
      // cotizacion y se pueden emparejar a mano. Peor seria no importar.
    } finally {
      setResolviendo(false);
    }
  }

  async function tomar(f: File) {
    setError(null);
    setHecho(null);
    try {
      const e = await leerArchivo(f);
      aplicar(e, f.name);
    } catch {
      setError("No se ha podido leer el archivo. ¿Seguro que es un CSV, un Excel o un JSON?");
    }
  }

  function aplicar(e: Entrada, nombre: string) {
    const f = detectar(e);
    setEntrada(e);
    setNombreArchivo(nombre);
    setFormato(f);
    setMapa(e.tabla ? adivinarMapa(e.tabla) : {});
    if (f === "desconocido") {
      setError(
        "No se reconoce el formato. Elige uno a mano abajo, o comprueba que el archivo tenga una fila de cabecera.",
      );
    } else {
      setError(null);
      void resolverIsines(e, f);
    }
  }

  function limpiar() {
    setResueltos([]);
    setEntrada(null);
    setFormato(null);
    setNombreArchivo("");
    setMapa({});
    setError(null);
    setHecho(null);
  }

  // ── Confirmar ─────────────────────────────────────────────────────────
  // El orden importa: primero la cuenta, luego los activos, y sólo al final
  // las operaciones, que necesitan los ids de los dos anteriores.
  async function confirmar() {
    if (!plan || plan.nuevas.length === 0) return;
    setGuardando(true);
    setError(null);
    try {
      let cuenta = cuentaId;
      if (!cuenta && plan.cuentaNueva) {
        const [c] = await insertar<Cuenta>("accounts", [plan.cuentaNueva]);
        cuenta = c.id;
      }

      const creados = plan.activosNuevos.length
        ? await insertar<Activo>("assets", plan.activosNuevos)
        : [];

      // Índice de los recién creados para poder asignar el asset_id.
      const porClave = new Map<string, string>();
      for (const a of creados) {
        if (a.isin) porClave.set(a.isin.toUpperCase(), a.id);
        if (a.ticker) porClave.set(a.ticker.toUpperCase(), a.id);
        porClave.set(a.name.toUpperCase(), a.id);
      }

      const ops = plan.nuevas.map((p) => {
        const clave = (p.fila.isin || p.fila.ticker || p.fila.nombre || "").toUpperCase();
        return {
          ...p.operacion,
          account_id: cuenta || null,
          asset_id: p.activo?.id ?? porClave.get(clave) ?? null,
        };
      });

      await insertar<Operacion>("operations", ops);
      setHecho({ ops: ops.length, activos: creados.length });
      limpiar();
      await recargar();
    } catch (e) {
      setError(
        e instanceof Error
          ? `No se ha podido guardar: ${e.message}`
          : "No se ha podido guardar la importación",
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <Etiqueta>Añadir a la cartera</Etiqueta>
        <h1 className="hero-num mt-1 text-[2.1rem] text-fg0">Carga el archivo de tu bróker.</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-fg2">
          Se leen los movimientos, se casan con tus posiciones y se calcula todo. Antes de guardar
          nada verás exactamente qué va a entrar.
        </p>
      </section>

      {hecho && (
        <Aviso>
          Importadas <strong>{hecho.ops}</strong>{" "}
          {hecho.ops === 1 ? "operación" : "operaciones"}
          {hecho.activos > 0 && (
            <>
              {" "}
              y creados <strong>{hecho.activos}</strong>{" "}
              {hecho.activos === 1 ? "activo nuevo" : "activos nuevos"}
            </>
          )}
          .{" "}
          <button onClick={() => navegar("/")} className="font-bold underline underline-offset-2">
            Ver la cartera
          </button>
        </Aviso>
      )}

      {/* ── 1 · El archivo ──────────────────────────────────────────────── */}
      {!entrada && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setSobre(true);
            }}
            onDragLeave={() => setSobre(false)}
            onDrop={(e) => {
              e.preventDefault();
              setSobre(false);
              const f = e.dataTransfer.files[0];
              if (f) void tomar(f);
            }}
            className={`flex flex-col items-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors ${
              sobre ? "border-blue bg-bg2" : "border-line2"
            }`}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-fg3">
              <path d="M12 16V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" />
            </svg>
            <p className="font-disp text-[15px] font-bold text-fg1">Arrastra tu archivo aquí</p>
            <p className="text-[12px] text-fg2">CSV, TSV, Excel o JSON de cualquier bróker</p>
            <div className="mt-2 flex gap-2">
              <Boton tipo="principal" onClick={() => fileRef.current?.click()}>
                Elegir archivo
              </Boton>
              <Boton tipo="suave" onClick={() => setPegando(true)}>
                Pegar texto
              </Boton>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,.json,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void tomar(f);
                e.target.value = "";
              }}
            />
          </div>

          <section>
            <TituloSeccion nota="Dónde encontrar el archivo en cada app.">
              Cómo sacarlo de tu bróker
            </TituloSeccion>
            <div className="flex flex-col gap-2">
              {AYUDA.map((a) => (
                <details key={a.broker} className="tile px-3.5 py-3">
                  <summary className="cursor-pointer list-none text-[13px] font-bold text-fg0">
                    {a.broker}
                  </summary>
                  <p className="mt-2 text-[12px] leading-relaxed text-fg1">{a.pasos}</p>
                  {a.ojo && <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg2">⚠ {a.ojo}</p>}
                </details>
              ))}
            </div>
          </section>
        </>
      )}

      {error && <Aviso tono="error">{error}</Aviso>}

      {/* ── 2 · Vista previa ────────────────────────────────────────────── */}
      {entrada && (
        <>
          <Tarjeta className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Etiqueta>Archivo</Etiqueta>
                <p className="truncate text-[13px] font-bold text-fg0">{nombreArchivo}</p>
              </div>
              <Boton tipo="suave" onClick={limpiar}>
                Cambiar
              </Boton>
            </div>

            <Selector
              etiqueta="Formato"
              valor={formato ?? "generico-csv"}
              onChange={(f) => setFormato(f as Formato)}
              opciones={FORMATOS.map((f) => ({ valor: f, texto: FORMATO_LBL[f] }))}
            />

            {resolviendo && (
              <p className="text-[12px] text-fg2">
                Buscando el símbolo de cotización de los ISIN que trae el archivo…
              </p>
            )}

            <Selector
              etiqueta="Cuenta destino"
              valor={cuentaId}
              onChange={setCuentaId}
              opciones={[
                {
                  valor: "",
                  texto: plan?.cuentaNueva
                    ? `Crear «${plan.cuentaNueva.broker}»`
                    : "Sin cuenta concreta",
                },
                ...estado.cuentas.map((c) => ({ valor: c.id, texto: c.name })),
              ]}
            />
          </Tarjeta>

          {/* Mapeo manual: sólo cuando hace falta, y ya relleno con lo adivinado */}
          {formato === "generico-csv" && entrada.tabla && (
            <Tarjeta>
              <TituloSeccion nota="Sólo hay que tocar lo que no haya acertado.">
                Qué columna es cada cosa
              </TituloSeccion>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(ETIQUETA_CAMPO) as CampoImport[]).map((c) => (
                  <Selector
                    key={c}
                    etiqueta={ETIQUETA_CAMPO[c]}
                    valor={mapa[c] ?? ""}
                    onChange={(v) => setMapa({ ...mapa, [c]: v || undefined })}
                    opciones={[
                      { valor: "", texto: "— ninguna —" },
                      ...entrada.tabla!.cabeceras.map((h) => ({ valor: h, texto: h })),
                    ]}
                  />
                ))}
              </div>
            </Tarjeta>
          )}

          {plan && <Resumen plan={plan} />}

          {plan && plan.nuevas.length > 0 && (
            <div className="sticky bottom-24 z-20">
              <Boton
                tipo="principal"
                onClick={() => void confirmar()}
                disabled={guardando}
                className="w-full py-3 shadow-e2"
              >
                {guardando
                  ? "Guardando…"
                  : `Importar ${plan.nuevas.length} ${plan.nuevas.length === 1 ? "operación" : "operaciones"}`}
              </Boton>
            </div>
          )}
          {guardando && <Cargando texto="Escribiendo en la cartera…" />}
        </>
      )}

      <Hoja
        abierta={pegando}
        titulo="Pegar los movimientos"
        onCerrar={() => setPegando(false)}
        pie={
          <Boton
            tipo="principal"
            className="w-full"
            disabled={!texto.trim()}
            onClick={() => {
              aplicar(desdeTexto(texto), "texto pegado");
              setPegando(false);
            }}
          >
            Leer
          </Boton>
        }
      >
        <p className="mb-2 text-[12px] text-fg2">
          Pega aquí las líneas de tu extracto, con la fila de cabecera incluida.
        </p>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={10}
          placeholder={"fecha;tipo;isin;cantidad;precio;importe\n05/09/2026;Compra;IE00B4ND3602;2;81,13;162,26"}
          className="w-full rounded-field border border-line2 bg-bg1 p-3 font-mono text-[11px] text-fg0 outline-none focus:border-blue"
        />
      </Hoja>
    </div>
  );
}

// ── Vista previa del plan ─────────────────────────────────────────────────

function Resumen({ plan }: { plan: Plan }) {
  const [verDescartes, setVerDescartes] = useState(false);
  const nada = plan.nuevas.length === 0;

  return (
    <>
      <Tarjeta>
        <TituloSeccion>Lo que va a entrar</TituloSeccion>

        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <Dato n={plan.nuevas.length} t="nuevas" />
          <Dato n={plan.duplicadas.length} t="ya estaban" apagado />
          <Dato n={plan.lectura.descartes.length} t="descartadas" apagado />
        </div>

        {(plan.totalCompras > 0 || plan.totalVentas > 0 || plan.totalCobros > 0) && (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 border-y border-line py-2 text-[12px]">
            {plan.totalCompras > 0 && (
              <span className="text-fg1">
                Compras <strong className="text-fg0">{fe(plan.totalCompras, 0)}</strong>
              </span>
            )}
            {plan.totalVentas > 0 && (
              <span className="text-fg1">
                Ventas <strong className="text-fg0">{fe(plan.totalVentas, 0)}</strong>
              </span>
            )}
            {plan.totalCobros > 0 && (
              <span className="text-fg1">
                Cobros <strong className="text-up">{fe(plan.totalCobros, 0)}</strong>
              </span>
            )}
          </div>
        )}

        {plan.activosNuevos.length > 0 && (
          <Aviso>
            Se crearán {plan.activosNuevos.length}{" "}
            {plan.activosNuevos.length === 1 ? "activo nuevo" : "activos nuevos"}:{" "}
            {plan.activosNuevos.map((a) => a.name).join(", ")}. Revisa después su categoría en la
            cartera si alguno no ha caído donde tocaba.
          </Aviso>
        )}

        {nada && plan.duplicadas.length > 0 && (
          <Aviso>
            Todas las operaciones de este archivo ya estaban importadas. Puedes volver a subirlo
            siempre que quieras: no se duplica nada.
          </Aviso>
        )}

        {nada && plan.duplicadas.length === 0 && (
          <Aviso tono="alerta">
            No se ha reconocido ninguna operación. Prueba a cambiar el formato arriba, o revisa el
            detalle de los descartes.
          </Aviso>
        )}
      </Tarjeta>

      {plan.nuevas.length > 0 && (
        <section>
          <TituloSeccion nota="Las 40 primeras. Se guardan todas.">Detalle</TituloSeccion>
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full min-w-[420px] text-left text-[11.5px]">
              <thead className="bg-bg2 text-fg2">
                <tr>
                  <th className="px-2.5 py-2 font-bold">Fecha</th>
                  <th className="px-2.5 py-2 font-bold">Movimiento</th>
                  <th className="px-2.5 py-2 text-right font-bold">Cantidad</th>
                  <th className="px-2.5 py-2 text-right font-bold">Importe</th>
                </tr>
              </thead>
              <tbody>
                {plan.nuevas.slice(0, 40).map((p, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-2.5 py-2 whitespace-nowrap text-fg2">{fd(p.fila.fecha)}</td>
                    <td className="px-2.5 py-2">
                      <span className="block truncate font-semibold text-fg0">
                        {p.fila.nombre ?? p.fila.isin ?? p.fila.ticker}
                      </span>
                      <span className="text-[10.5px] text-fg2">
                        {OP_LBL[p.fila.tipo]}
                        {p.fila.traspasoInterno && " · traspaso interno"}
                        {p.nuevoActivo && " · activo nuevo"}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 text-right whitespace-nowrap text-fg1">
                      {p.fila.cantidad != null ? fn(p.fila.cantidad, 4) : "—"}
                    </td>
                    <td className="px-2.5 py-2 text-right whitespace-nowrap font-bold text-fg0">
                      {fe(p.operacion.total_eur ?? p.fila.total, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {plan.lectura.descartes.length > 0 && (
        <section>
          <button
            onClick={() => setVerDescartes(!verDescartes)}
            className="text-[12px] font-semibold text-fg2 underline-offset-4 hover:text-fg0 hover:underline"
          >
            {verDescartes ? "Ocultar" : "Ver"} las {plan.lectura.descartes.length} líneas
            descartadas
          </button>
          {verDescartes && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {plan.lectura.descartes.slice(0, 60).map((d, i) => (
                <li key={i} className="tile px-3 py-2">
                  <p className="text-[11.5px] font-semibold text-fg1">
                    Línea {d.linea} · {d.motivo}
                  </p>
                  <p className="truncate font-mono text-[10.5px] text-fg3">{d.crudo}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function Dato({ n, t, apagado }: { n: number; t: string; apagado?: boolean }) {
  return (
    <div className="rounded-tile bg-bg2 py-2">
      <p className={`font-disp text-[19px] font-bold ${apagado ? "text-fg2" : "text-fg0"}`}>{n}</p>
      <p className="text-[10.5px] text-fg2">{t}</p>
    </div>
  );
}
