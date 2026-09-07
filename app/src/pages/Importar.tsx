// ── IMPORTAR ─────────────────────────────────────────────────────────────
// La pantalla que quita el trabajo de teclear cada compra: arrastras el
// archivo que te da el bróker y la cartera se rellena sola.
//
// Tres pasos y ninguna sorpresa: se detecta el formato, se enseña TODO lo que
// va a entrar —incluido lo que se va a descartar y por qué— y sólo entonces se
// escribe. Importar a ciegas un extracto de cinco años es la mejor manera de
// meter cien líneas mal y no enterarse hasta meses después.
//
// El archivo puede llegar por tres caminos, y los tres acaban en el mismo
// sitio:
//
//   · el buzón   compartido desde la app del bróker en el móvil. Es el corto:
//                el archivo ya está aquí cuando abres la cartera.
//   · el selector  arrastrado o elegido, uno o varios a la vez.
//   · pegado     para cuando sólo tienes unas líneas sueltas.

import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDatos } from "../lib/datos";
import { comoArchivo, descartar, marcarImportada, type EntradaBuzon } from "../lib/buzon";
import {
  adivinarMapa,
  desdeTexto,
  detectar,
  efectivoPendiente,
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
import { hayNube } from "../lib/supabase";
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
    pasos: "En la app: Perfil → Extractos → «Exportación de transacción», eliges las fechas y descargas el CSV. En el iPhone, cuando salga la hoja de compartir, elige «Enviar a Cartera» y ya no tienes que hacer nada más aquí.",
    ojo: "Sólo está en la app del móvil, y no lo abras en Excel antes de subirlo: al guardarlo cambia las fechas y los decimales.",
  },
  {
    broker: "Revolut",
    pasos: "En Inversiones → Documentos → «Extracto de cuenta», en formato Excel o CSV.",
    ojo: "Tiene que ser el extracto de cuenta, no el de pérdidas y ganancias ni el de costes: esos no traen los movimientos.",
  },
  {
    broker: "MyInvestor",
    pasos:
      "Sólo desde la web, con ordenador: la app no exporta. El que importa es el de los fondos — Inversiones → Fondos → Operaciones y consultas → Consulta de operaciones → eliges las fechas y descargas el Excel. Ése trae el ISIN, las participaciones y el valor liquidativo de cada compra, que es lo que hace falta para saber cuánto tienes. Si además quieres los ingresos y los intereses de la cuenta, baja también Cuentas → Corriente → Operaciones y consultas → Consulta de operaciones, y al subirlo elige el formato «sólo el dinero».",
    ojo: "El extracto de la cuenta corriente por sí solo NO vale para los fondos: corta el nombre a 30 caracteres y se come las participaciones, así que los fondos entrarían a cero. Y no abras el archivo en Excel antes de subirlo, que al guardarlo cambia fechas y decimales.",
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
  "myinvestor-cuenta",
  "myinvestor-efectivo",
  "myinvestor-json",
  "generico-csv",
  "generico-json",
];

export default function Importar() {
  const { estado, mercado, buzon, insertar, actualizar, recargar, recargarBuzon } = useDatos();
  const navegar = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [entrada, setEntrada] = useState<Entrada | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState("");
  // Los archivos que esperan turno cuando se sueltan varios de golpe. Se
  // procesan de uno en uno a propósito: cada archivo tiene su formato, su
  // cuenta destino y su vista previa, y mezclarlos en una sola pantalla es
  // pedir que se confirme algo que no se ha mirado.
  const [cola, setCola] = useState<File[]>([]);
  // De qué entrada del buzón salió lo que hay cargado, para marcarla como
  // importada al terminar y que deje de aparecer.
  const [origenBuzon, setOrigenBuzon] = useState<string | null>(null);
  const [formato, setFormato] = useState<Formato | null>(null);
  const [mapa, setMapa] = useState<Mapa>({});
  const [cuentaId, setCuentaId] = useState<string>("");
  const [sobre, setSobre] = useState(false);
  const [pegando, setPegando] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState<{ ops: number; activos: number; quedan: number } | null>(
    null,
  );
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

  /** Carga un archivo en la pantalla.
   *
   *  `conservarAviso` existe por el encadenado: al pasar al siguiente archivo
   *  de la cola queremos que siga viéndose el «importadas 12 operaciones» del
   *  anterior, y al elegir uno nuevo a mano, no. */
  async function tomar(f: File, deBuzon: string | null = null, conservarAviso = false) {
    setError(null);
    if (!conservarAviso) setHecho(null);
    setOrigenBuzon(deBuzon);
    try {
      const e = await leerArchivo(f);
      aplicar(e, f.name);
    } catch {
      setError("No se ha podido leer el archivo. ¿Seguro que es un CSV, un Excel o un JSON?");
    }
  }

  /** Varios archivos de una vez: el primero se abre y los demás hacen cola.
   *
   *  Es el caso normal cuando bajas los extractos de los cuatro brókeres el
   *  mismo día, y antes obligaba a repetir todo el paseo cuatro veces. Se
   *  procesan de uno en uno y no en bloque porque cada archivo tiene su
   *  formato y su cuenta destino, y juntarlos sería confirmar a ciegas. */
  function tomarVarios(fs: File[]) {
    if (fs.length === 0) return;
    setCola(fs.slice(1));
    void tomar(fs[0]);
  }

  /** El siguiente de la cola, o la pantalla limpia si no queda ninguno. */
  function siguiente(conservarAviso = false) {
    const [f, ...resto] = cola;
    if (!f) {
      limpiarArchivo();
      return;
    }
    setCola(resto);
    void tomar(f, null, conservarAviso);
  }

  async function abrirDelBuzon(item: EntradaBuzon) {
    await tomar(comoArchivo(item), item.id);
  }

  async function descartarDelBuzon(id: string) {
    try {
      await descartar(id);
      await recargarBuzon();
    } catch {
      setError("No se ha podido descartar el archivo.");
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

  /** Deja la pantalla sin archivo cargado, pero sin tocar el aviso de la
   *  importación anterior. */
  function limpiarArchivo() {
    setResueltos([]);
    setEntrada(null);
    setFormato(null);
    setNombreArchivo("");
    setMapa({});
    setError(null);
    setOrigenBuzon(null);
  }

  /** Empezar de cero: se va también el aviso y la cola. */
  function limpiar() {
    limpiarArchivo();
    setCola([]);
    setHecho(null);
  }

  // ── Confirmar ─────────────────────────────────────────────────────────
  // El orden importa: primero la cuenta, luego los activos, después las
  // operaciones —que necesitan los ids de los dos anteriores— y al final el
  // efectivo, cuyo saldo sale de las operaciones ya escritas.
  async function confirmar() {
    if (!plan) return;
    // Un archivo entero repetido no trae ninguna operación nueva, y aun así
    // puede quedar trabajo: si la cuenta de efectivo no llegó a crearse la
    // primera vez —falló la escritura, o se cerró la pestaña— salir aquí la
    // condenaba a no existir nunca, porque el archivo ya no traería nada
    // nuevo jamás. El saldo se calcula sobre TODAS las operaciones, así que
    // reimportar es exactamente la manera de arreglarlo.
    if (plan.nuevas.length === 0 && !efectivoPendiente(plan)) return;

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

      // ── El efectivo ────────────────────────────────────────────────────
      // Sin esto el patrimonio sale corto: el extracto trae los ingresos y
      // las retiradas, pero si nadie crea la cuenta de liquidez, el dinero
      // parado en el bróker no aparece por ningún lado. El plan ya ha
      // calculado el saldo sobre TODAS las operaciones, no sólo las nuevas,
      // así que reimportar el mismo archivo lo deja igual y no al doble.
      if (plan.efectivo) {
        const { existente, activo, saldo } = plan.efectivo;
        // Los campos se escriben uno a uno en vez de reenviar el objeto del
        // plan: ése lleva dentro la fila existente entera —id, user_id, las
        // marcas de tiempo— y devolverle a la base sus propias columnas es
        // la manera de que una de ellas se quede pegada donde no toca.
        const campos: Partial<Activo> = {
          name: activo.name,
          cat: "liquidez",
          currency: "EUR",
          unit: "€",
          // REGLA: en el efectivo el coste ES el saldo. Un coste a cero
          // convertiría cada ingreso en una plusvalía inventada.
          mode: "manual",
          manual_qty: saldo,
          manual_cost_unit: 1,
          manual_price: 1,
        };
        if (existente) await actualizar<Activo>("assets", existente.id, campos);
        else await insertar<Activo>("assets", [campos]);
      }

      if (origenBuzon) {
        await marcarImportada(origenBuzon, ops.length);
        await recargarBuzon();
      }

      setHecho({ ops: ops.length, activos: creados.length, quedan: cola.length });
      // Limpia el archivo pero NO el aviso de «hecho»: llamar aquí a
      // `limpiar()` entero lo borraba en el mismo lote de React y el mensaje
      // de que había ido bien no llegaba a verse nunca.
      limpiarArchivo();
      siguiente(true);
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
          {hecho.quedan > 0 ? (
            <>
              Quedan <strong>{hecho.quedan}</strong>{" "}
              {hecho.quedan === 1 ? "archivo" : "archivos"} por revisar, abajo.
            </>
          ) : (
            <button onClick={() => navegar("/")} className="font-bold underline underline-offset-2">
              Ver la cartera
            </button>
          )}
        </Aviso>
      )}

      {/* ── 0 · El buzón ────────────────────────────────────────────────── */}
      {/* Lo que has compartido desde el móvil, esperando. Va antes que el
          selector a propósito: si hay algo aquí, es lo que vienes a hacer. */}
      {buzon.length > 0 && (
        <section>
          <TituloSeccion nota="Llegaron desde la app de tu bróker. Nada se ha importado todavía.">
            Te esperan {buzon.length} {buzon.length === 1 ? "archivo" : "archivos"}
          </TituloSeccion>
          <div className="flex flex-col gap-2">
            {buzon.map((b) => (
              <div key={b.id} className="tile flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-fg0">{b.filename}</p>
                  <p className="text-[11px] text-fg2">
                    {haceCuanto(b.created_at)} · {Math.max(1, Math.round(b.bytes / 1024))} KB
                  </p>
                </div>
                <Boton tipo="principal" onClick={() => void abrirDelBuzon(b)}>
                  Revisar
                </Boton>
                <button
                  onClick={() => void descartarDelBuzon(b.id)}
                  aria-label={`Descartar ${b.filename}`}
                  className="shrink-0 rounded-tile px-2 py-1 text-[11px] font-semibold text-fg3 transition-colors hover:bg-bg2 hover:text-dn"
                >
                  Descartar
                </button>
              </div>
            ))}
          </div>
        </section>
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
              tomarVarios([...e.dataTransfer.files]);
            }}
            className={`flex flex-col items-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors ${
              sobre ? "border-blue bg-bg2" : "border-line2"
            }`}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-fg3">
              <path d="M12 16V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" />
            </svg>
            <p className="font-disp text-[15px] font-bold text-fg1">Arrastra tus archivos aquí</p>
            <p className="text-[12px] text-fg2">
              CSV, TSV, Excel o JSON de cualquier bróker. Puedes soltar varios de golpe.
            </p>
            <div className="mt-2 flex gap-2">
              <Boton tipo="principal" onClick={() => fileRef.current?.click()}>
                Elegir archivos
              </Boton>
              <Boton tipo="suave" onClick={() => setPegando(true)}>
                Pegar texto
              </Boton>
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              // Sin `accept`, y no por descuido: en iOS la lista de extensiones
              // deja en gris justo los archivos que se quieren subir. Un CSV
              // que Trade Republic guardó en Archivos llega sin tipo MIME, y
              // Safari lo mide por el tipo, no por el nombre. Es preferible
              // que se pueda elegir un archivo equivocado —y que la pantalla
              // lo diga— a que no se pueda elegir el correcto.
              className="hidden"
              onChange={(e) => {
                tomarVarios([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </div>

          {/* El camino corto, para quien todavía no lo tenga puesto. */}
          {hayNube && (
            <Link
              to="/ajustes"
              className="tile flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-bg2"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-blue"
                aria-hidden
              >
                <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
                <path d="M12 15V8m0 0-2.5 2.5M12 8l2.5 2.5" />
              </svg>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-fg0">
                  Mándalos desde el móvil sin descargar nada
                </span>
                <span className="block text-[11.5px] leading-relaxed text-fg2">
                  En la app del bróker, «Compartir → Enviar a Cartera». Se configura una vez, en
                  Ajustes.
                </span>
              </span>
              <span className="shrink-0 text-fg3">›</span>
            </Link>
          )}

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
                <Etiqueta>
                  {origenBuzon ? "Llegó desde el móvil" : "Archivo"}
                  {cola.length > 0 && ` · quedan ${cola.length} detrás`}
                </Etiqueta>
                <p className="truncate text-[13px] font-bold text-fg0">{nombreArchivo}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {cola.length > 0 && (
                  <Boton tipo="suave" onClick={() => siguiente()}>
                    Saltar
                  </Boton>
                )}
                <Boton tipo="suave" onClick={limpiar}>
                  Cambiar
                </Boton>
              </div>
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

          {/* Un archivo del buzón cuyas operaciones ya estaban todas dentro
              sigue apareciendo como pendiente hasta que alguien lo cierra. Es
              lo que pasa al reenviar el extracto del mes con dos compras
              nuevas y cuarenta viejas: se importan las dos y, a la siguiente,
              el mismo archivo no trae nada. */}
          {plan && plan.nuevas.length === 0 && origenBuzon && (
            <Boton
              tipo="suave"
              className="w-full"
              onClick={() => {
                const id = origenBuzon;
                void (async () => {
                  await marcarImportada(id, 0);
                  await recargarBuzon();
                })();
                siguiente();
              }}
            >
              Entendido, quítalo del buzón
            </Boton>
          )}

          {plan && (plan.nuevas.length > 0 || efectivoPendiente(plan)) && (
            <div className="sticky bottom-24 z-20">
              <Boton
                tipo="principal"
                onClick={() => void confirmar()}
                disabled={guardando}
                className="w-full py-3 shadow-e2"
              >
                {guardando
                  ? "Guardando…"
                  : plan.nuevas.length > 0
                    ? `Importar ${plan.nuevas.length} ${plan.nuevas.length === 1 ? "operación" : "operaciones"}`
                    : "Poner al día el saldo de efectivo"}
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

        {/* El efectivo se escribe al confirmar, así que tiene que verse antes.
            Es la única línea de la importación que no sale de una operación
            del archivo sino de la suma de todas, y por eso es la que más
            sorprende cuando aparece sola en la cartera. */}
        {plan.efectivo && (plan.nuevas.length > 0 || efectivoPendiente(plan)) && (
          <div className="mt-2">
            <Aviso>
              {plan.efectivo.existente ? "Se actualizará" : "Se creará"} la cuenta de efectivo{" "}
              <strong>{plan.efectivo.activo.name}</strong> con un saldo de{" "}
              <strong>{fe(plan.efectivo.saldo, 2)}</strong>, que es lo que suman los ingresos, las
              retiradas, las compras y los cobros del extracto.
            </Aviso>
          </div>
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

/** «hace 3 min», «ayer». Para el buzón vale más que una fecha exacta: lo que
 *  se quiere saber es si esto es lo que acabas de compartir o algo que llevaba
 *  ahí desde la semana pasada. */
function haceCuanto(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!isFinite(min)) return "";
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}

function Dato({ n, t, apagado }: { n: number; t: string; apagado?: boolean }) {
  return (
    <div className="rounded-tile bg-bg2 py-2">
      <p className={`font-disp text-[19px] font-bold ${apagado ? "text-fg2" : "text-fg0"}`}>{n}</p>
      <p className="text-[10.5px] text-fg2">{t}</p>
    </div>
  );
}
