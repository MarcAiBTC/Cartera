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
  combinar,
  desdeTexto,
  detectar,
  efectivoPendiente,
  ETIQUETA_CAMPO,
  FORMATO_LBL,
  FORMATO_NOTA,
  leer,
  leerArchivo,
  planificar,
  posicionesPendientes,
  type CampoImport,
  type Entrada,
  type Formato,
  type Lectura,
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
      "Hacen falta DOS archivos, y los dos sólo desde la web, con ordenador: la app no exporta. Primero el PDF «Extracto de cuenta» —Perfil → Documentos y extractos—, que es el que dice qué fondos tienes, con su ISIN, sus participaciones y el saldo de la cuenta. Y después el Excel de movimientos —Cuentas → Corriente → Operaciones y consultas → Consulta de operaciones—, eligiendo el rango de fechas MÁS LARGO que te deje, que es de donde sale lo que te costó cada cosa.",
    ojo: "El Excel por sí solo no vale: corta el nombre del fondo a 30 caracteres y con él se van el ISIN y las participaciones, así que los fondos entran a cero euros. Por eso hace falta el PDF. Y no abras ninguno de los dos en Excel antes de subirlos, que al guardarlos cambia fechas y decimales.",
  },
  {
    broker: "Cualquier otro",
    pasos: "Un CSV, TSV o Excel con una fila por movimiento. Si alguna columna no se reconoce, la eliges a mano.",
  },
];

/** Los formatos que puede tener un archivo, según lo que se haya podido sacar
 *  de él. Ofrecer los nueve siempre era la manera de que alguien eligiera
 *  «Trade Republic · CSV» para un PDF y se quedara mirando una pantalla vacía:
 *  un PDF no es una tabla y ningún lector de tabla va a saber leerlo. */
function formatosDe(e: Entrada): Formato[] {
  if (e.pdf) return ["myinvestor-extracto"];
  if (e.json !== undefined) return ["myinvestor-json", "generico-json"];
  return [
    "traderepublic-csv",
    "revolut-csv",
    "myinvestor-cuenta",
    "myinvestor-efectivo",
    "myinvestor-tabla",
    "generico-csv",
  ];
}

/** Un archivo ya leído y esperando a que se confirme la importación. */
interface Cargado {
  id: string;
  nombre: string;
  entrada: Entrada;
  formato: Formato;
  mapa: Mapa;
  /** De qué entrada del buzón salió, para marcarla al terminar */
  buzon?: string;
}

/** Qué aporta este archivo, en una línea. Es lo que deja ver de un vistazo que
 *  faltan las posiciones, o que se ha subido dos veces el mismo. */
function queTrae(l: Lectura): string {
  const partes: string[] = [];
  if (l.filas.length) partes.push(`${l.filas.length} movimientos`);
  if (l.posiciones?.length) partes.push(`${l.posiciones.length} posiciones`);
  if (l.saldo != null) partes.push(`saldo ${fe(l.saldo, 2)}`);
  if (partes.length === 0) return "no se ha reconocido nada dentro";
  return partes.join(" · ");
}

export default function Importar() {
  const { estado, mercado, buzon, insertar, actualizar, recargar, recargarBuzon } = useDatos();
  const navegar = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  /** Un número por archivo cargado, para poder identificarlos sin depender del
   *  nombre: se puede subir dos veces el mismo. */
  const contador = useRef(0);

  // Todos los archivos cargados a la vez, y una sola importación con lo que
  // digan entre todos. Antes iban en cola, de uno en uno, y con MyInvestor eso
  // no puede funcionar: el Excel trae las compras y el PDF las participaciones,
  // y por separado el primero deja los fondos a cero y el segundo no sabe
  // todavía lo que costaron.
  const [archivos, setArchivos] = useState<Cargado[]>([]);
  // Qué activo de la cartera es cada posición del extracto, cuando lo dice una
  // persona. Sólo hace falta con dos clases del mismo fondo, donde el parecido
  // de los nombres empata y elegir por él sería jugárselo a cara o cruz.
  const [emparejamientos, setEmparejamientos] = useState<Record<string, string>>({});
  // Cuánto vale hoy, en euros, un valor del que el extracto no dice nada. Hay
  // dinero que ningún archivo de MyInvestor sabe contar —los ETC y los ETF
  // viven en la cuenta de valores, que el extracto de posición no cubre, y sus
  // compras vienen sin participaciones— y la única salida honesta es
  // preguntarlo en vez de dejarlo entrar valiendo cero.
  const [valores, setValores] = useState<Record<string, number>>({});
  const [cuentaId, setCuentaId] = useState<string>("");
  const [sobre, setSobre] = useState(false);
  const [pegando, setPegando] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState<{
    ops: number;
    activos: number;
    posiciones: number;
  } | null>(null);
  // Alias ISIN -> simbolo que ha resuelto el servidor para ESTE archivo. El
  // catalogo solo trae el alias de los simbolos curados a mano, y todos los
  // brokers europeos exportan ISIN: sin esto, cada valor importado nace sin
  // cotizacion. Yahoo no se puede consultar desde aqui (no manda CORS), asi
  // que lo hace /api/isin.
  const [resueltos, setResueltos] = useState<EntradaCatalogo[]>([]);
  const [resolviendo, setResolviendo] = useState(false);

  /** Lo que ha entendido de cada archivo, por separado. Se enseña archivo por
   *  archivo para que se vea de dónde sale cada cosa. */
  const lecturas: Lectura[] = useMemo(
    () => archivos.map((a) => leer(a.entrada, { formato: a.formato, mapa: a.mapa })),
    [archivos],
  );

  // ── El plan se recalcula solo con cada cambio: no hay un botón de
  //    «previsualizar» que se pueda quedar desincronizado del formulario.
  const plan: Plan | null = useMemo(() => {
    if (archivos.length === 0) return null;
    return planificar(combinar(lecturas), {
      estado,
      fx: mercado.fx,
      // Los alias recien resueltos van DELANTE: son mas frescos que el
      // catalogo que se cargo al abrir la app.
      catalogo: [...resueltos, ...mercado.catalogo],
      cuentaId: cuentaId || undefined,
      emparejamientos,
      valores,
    });
  }, [archivos, lecturas, estado, mercado, cuentaId, resueltos, emparejamientos, valores]);

  /** El archivo que falta. Con MyInvestor hacen falta dos y ninguno de los dos
   *  vale solo, así que decirlo aquí ahorra la importación a medias y el
   *  «pues sigue sin salir» de después. */
  const falta = useMemo(() => {
    const fs = archivos.map((a) => a.formato);
    const movimientos = fs.some((f) => f.startsWith("myinvestor-") && f !== "myinvestor-extracto");
    const posicion = fs.includes("myinvestor-extracto");
    if (posicion && !movimientos) {
      return "Con esto sabremos qué fondos tienes y cuánto valen, pero no lo que te costaron. Añade también el Excel de movimientos de la cuenta corriente y se importa todo de una vez.";
    }
    if (movimientos && !posicion && !fs.includes("myinvestor-tabla")) {
      return "Falta el PDF «Extracto de cuenta» de MyInvestor. Sin él los fondos entran sin ISIN y sin participaciones, o sea a cero euros. Añádelo aquí y se importa todo junto.";
    }
    return null;
  }, [archivos]);

  /** Los activos que pueden ser una de las posiciones del extracto: los que
   *  han tenido movimiento en la cuenta destino. Una acción comprada en otro
   *  bróker no puede ser el fondo del que habla este PDF. */
  const candidatos = useMemo(() => {
    if (!plan?.posiciones.length) return [];
    const cuenta =
      cuentaId || estado.cuentas.find((c) => c.broker === plan.lectura.broker)?.id;
    const suyos = new Set(
      estado.operaciones.filter((o) => o.account_id === cuenta && o.asset_id).map((o) => o.asset_id),
    );
    return estado.activos.filter(
      (a) => !a.archived && a.cat !== "liquidez" && (!cuenta || suyos.has(a.id)),
    );
  }, [plan, estado, cuentaId]);

  /** Pregunta al servidor por los ISIN que el catalogo no sabe traducir. */
  async function resolverIsines(e: Entrada, f: Formato) {
    try {
      const lectura = leer(e, { formato: f, mapa: e.tabla ? adivinarMapa(e.tabla) : {} });
      const conocidos = new Set(
        mercado.catalogo.map((c) => (c.isin ?? "").toUpperCase()).filter(Boolean),
      );
      const faltan = [
        ...new Set(
          [
            ...lectura.filas.map((x) => x.isin),
            // Los de las posiciones también, y sobre todo: un extracto de
            // MyInvestor no trae ninguna operación con ISIN, y son justo esos
            // fondos los que estaban sin cotización.
            ...(lectura.posiciones ?? []).map((p) => p.isin),
          ]
            .map((i) => (i ?? "").toUpperCase())
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

  /** Añade archivos a la importación. Todos juntos, no en cola: con
   *  MyInvestor hacen falta dos y sólo tienen sentido sumados. */
  async function tomarVarios(fs: File[], deBuzon?: string) {
    if (fs.length === 0) return;
    setError(null);
    setHecho(null);
    setEmparejamientos({});
    setValores({});

    const nuevos: Cargado[] = [];
    const fallos: string[] = [];
    for (const f of fs) {
      try {
        const e = await leerArchivo(f);
        nuevos.push({
          id: `a${(contador.current += 1)}`,
          nombre: f.name,
          entrada: e,
          formato: detectar(e),
          mapa: e.tabla ? adivinarMapa(e.tabla) : {},
          buzon: deBuzon,
        });
      } catch {
        fallos.push(f.name);
      }
    }

    if (fallos.length) {
      setError(
        `No se ha podido leer ${fallos.join(", ")}. ¿Seguro que es un CSV, un Excel, un PDF o un JSON?`,
      );
    }
    if (nuevos.length === 0) return;

    setArchivos((previos) => [...previos, ...nuevos]);
    for (const n of nuevos) {
      if (n.formato !== "desconocido") void resolverIsines(n.entrada, n.formato);
    }
  }

  function quitarArchivo(id: string) {
    setArchivos((previos) => previos.filter((a) => a.id !== id));
    setEmparejamientos({});
    setValores({});
  }

  function cambiarFormato(id: string, f: Formato) {
    setArchivos((previos) => previos.map((a) => (a.id === id ? { ...a, formato: f } : a)));
    setEmparejamientos({});
    setValores({});
  }

  function cambiarMapa(id: string, m: Mapa) {
    setArchivos((previos) => previos.map((a) => (a.id === id ? { ...a, mapa: m } : a)));
  }

  async function abrirDelBuzon(item: EntradaBuzon) {
    await tomarVarios([comoArchivo(item)], item.id);
  }

  async function descartarDelBuzon(id: string) {
    try {
      await descartar(id);
      await recargarBuzon();
    } catch {
      setError("No se ha podido descartar el archivo.");
    }
  }

  /** Empezar de cero. */
  function limpiar() {
    setArchivos([]);
    setResueltos([]);
    setEmparejamientos({});
    setValores({});
    setError(null);
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
    if (plan.nuevas.length === 0 && !efectivoPendiente(plan) && !posicionesPendientes(plan)) return;

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

      // ── Las posiciones ─────────────────────────────────────────────────
      // Un extracto de posición no cuenta lo que hiciste sino lo que tienes, y
      // por eso va ANTES de las operaciones: el fondo que crea el PDF con su
      // ISIN es el mismo al que tienen que caer las compras del Excel, y hasta
      // que no se escribe no tiene id al que apuntar.
      /** Activo que se archiva → activo que se queda con sus operaciones. */
      const redirigir = new Map<string, string>();
      let posiciones = 0;

      for (const p of plan.posiciones) {
        if (p.aldia) {
          // Aunque no haya nada que cambiar en el activo, las compras nuevas de
          // este fondo tienen que saber a dónde van.
          if (p.activo) for (const k of p.claves) porClave.set(k, p.activo.id);
          continue;
        }

        let id: string;
        if (p.activo) {
          await actualizar<Activo>("assets", p.activo.id, p.campos);
          id = p.activo.id;
        } else {
          const [a] = await insertar<Activo>("assets", [p.campos]);
          id = a.id;
        }
        for (const k of p.claves) porClave.set(k, id);

        // El mismo fondo con el nombre cortado de dos maneras eran dos activos.
        // El que se queda es uno; al otro se le mudan las operaciones y se
        // archiva —no se borra—, que es lo que deja el coste bien la próxima
        // vez que se importe.
        for (const o of p.reasignar) {
          await actualizar<Operacion>("operations", o.id, { asset_id: id });
        }
        for (const a of p.absorbidos) {
          redirigir.set(a.id, id);
          await actualizar<Activo>("assets", a.id, { archived: true });
        }
        posiciones++;
      }

      const ops = plan.nuevas.map((p) => {
        const clave = (p.fila.isin || p.fila.ticker || p.fila.nombre || "").toUpperCase();
        const suyo = p.activo ? (redirigir.get(p.activo.id) ?? p.activo.id) : undefined;
        return {
          ...p.operacion,
          account_id: cuenta || null,
          asset_id: porClave.get(clave) ?? suyo ?? null,
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

      const delBuzon = archivos.map((a) => a.buzon).filter((b): b is string => Boolean(b));
      if (delBuzon.length) {
        for (const b of delBuzon) await marcarImportada(b, ops.length);
        await recargarBuzon();
      }

      // El aviso se pone DESPUÉS de vaciar los archivos: en el mismo lote de
      // React, limpiar lo borraba y el mensaje de que había ido bien no
      // llegaba a verse nunca.
      setArchivos([]);
      setResueltos([]);
      setEmparejamientos({});
      setValores({});
      setHecho({ ops: ops.length, activos: creados.length, posiciones });
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
          {hecho.posiciones > 0 && (
            <>
              . Puestas al día <strong>{hecho.posiciones}</strong>{" "}
              {hecho.posiciones === 1 ? "posición" : "posiciones"}
            </>
          )}
          .{" "}
          <button onClick={() => navegar("/")} className="font-bold underline underline-offset-2">
            Ver la cartera
          </button>
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
      {archivos.length === 0 && (
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
              CSV, TSV, Excel, PDF o JSON de cualquier bróker. Puedes soltar varios de golpe.
            </p>
            <div className="mt-2 flex gap-2">
              <Boton tipo="principal" onClick={() => fileRef.current?.click()}>
                Elegir archivos
              </Boton>
              <Boton tipo="suave" onClick={() => setPegando(true)}>
                Pegar texto
              </Boton>
            </div>
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

      {/* El selector de archivos vive fuera de todo: hace falta también con la
          vista previa abierta, para poder añadir el segundo archivo sin
          deshacer lo que ya se ha leído del primero. */}
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
          void tomarVarios([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />

      {error && <Aviso tono="error">{error}</Aviso>}

      {/* ── 2 · Vista previa ────────────────────────────────────────────── */}
      {archivos.length > 0 && (
        <>
          {/* ── Los archivos ───────────────────────────────────────────────
              Uno por línea, con lo que ha reconocido en cada uno y de qué tipo
              lo ha tomado. El desplegable sólo ofrece lo que ese archivo puede
              ser: para un PDF, un formato; para una tabla, seis. */}
          <Tarjeta className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Etiqueta>
                  {archivos.length === 1 ? "Un archivo" : `${archivos.length} archivos juntos`}
                </Etiqueta>
                <p className="text-[13px] font-bold text-fg0">
                  {archivos.length === 1
                    ? "Esto es lo que se ha leído"
                    : "Se importan todos de una vez, sumados"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Boton tipo="suave" onClick={() => fileRef.current?.click()}>
                  Añadir otro
                </Boton>
                <Boton tipo="suave" onClick={limpiar}>
                  Quitar todos
                </Boton>
              </div>
            </div>

            {archivos.map((a, i) => {
              const l = lecturas[i];
              const opciones = formatosDe(a.entrada);
              return (
                <div key={a.id} className="tile flex flex-col gap-2 px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-bold text-fg0">
                        {a.buzon && "📱 "}
                        {a.nombre}
                      </p>
                      <p className="text-[11px] text-fg2">{queTrae(l)}</p>
                    </div>
                    <button
                      onClick={() => quitarArchivo(a.id)}
                      className="shrink-0 text-[11.5px] font-semibold text-fg2 underline-offset-4 hover:text-fg0 hover:underline"
                    >
                      Quitar
                    </button>
                  </div>

                  {a.formato === "desconocido" ? (
                    <Aviso tono="alerta">
                      {a.entrada.pdf
                        ? a.entrada.pdf.length === 0
                          ? "Este PDF no tiene texto dentro: será una foto o un escaneo. Bájalo otra vez desde la web del banco."
                          : "Es un PDF, pero no es el extracto de posición de MyInvestor. De momento es el único PDF que se sabe leer."
                        : "No se reconoce el contenido. Elige abajo qué es, o comprueba que el archivo tenga una fila de cabecera."}
                    </Aviso>
                  ) : null}

                  <Selector
                    etiqueta="Qué es este archivo"
                    valor={a.formato}
                    onChange={(f) => cambiarFormato(a.id, f as Formato)}
                    opciones={[
                      ...(a.formato === "desconocido"
                        ? [{ valor: "desconocido", texto: "— elige qué es —" }]
                        : []),
                      ...opciones.map((f) => ({ valor: f, texto: FORMATO_LBL[f] })),
                    ]}
                  />
                  {a.formato !== "desconocido" && (
                    <p className="text-[11px] leading-relaxed text-fg2">
                      {FORMATO_NOTA[a.formato]}
                    </p>
                  )}

                  {/* Mapeo manual: sólo cuando hace falta, y ya relleno con lo
                      que se haya adivinado. */}
                  {a.formato === "generico-csv" && a.entrada.tabla && (
                    <details className="mt-1">
                      <summary className="cursor-pointer list-none text-[11.5px] font-semibold text-fg2">
                        Qué columna es cada cosa
                      </summary>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {(Object.keys(ETIQUETA_CAMPO) as CampoImport[]).map((c) => (
                          <Selector
                            key={c}
                            etiqueta={ETIQUETA_CAMPO[c]}
                            valor={a.mapa[c] ?? ""}
                            onChange={(v) => cambiarMapa(a.id, { ...a.mapa, [c]: v || undefined })}
                            opciones={[
                              { valor: "", texto: "— ninguna —" },
                              ...a.entrada.tabla!.cabeceras.map((h) => ({ valor: h, texto: h })),
                            ]}
                          />
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}

            {falta && <Aviso>{falta}</Aviso>}

            {resolviendo && (
              <p className="text-[12px] text-fg2">
                Buscando el símbolo de cotización de los ISIN que traen los archivos…
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

          {plan && (
            <Resumen
              plan={plan}
              candidatos={candidatos}
              emparejamientos={emparejamientos}
              onEmparejar={(isin, valor) =>
                setEmparejamientos((m) => {
                  const nuevo = { ...m };
                  if (valor === AUTO) delete nuevo[isin];
                  else nuevo[isin] = valor;
                  return nuevo;
                })
              }
              valores={valores}
              onValor={(clave, texto) =>
                setValores((m) => {
                  const nuevo = { ...m };
                  const n = Number(texto.replace(",", "."));
                  // La casilla vacía no es un cero: es «no lo sé». Un cero sí
                  // se respeta, que es como se dice «esto ya no vale nada».
                  if (texto.trim() === "" || !isFinite(n) || n < 0) delete nuevo[clave];
                  else nuevo[clave] = n;
                  return nuevo;
                })
              }
            />
          )}

          {/* Un archivo del buzón cuyas operaciones ya estaban todas dentro
              sigue apareciendo como pendiente hasta que alguien lo cierra. Es
              lo que pasa al reenviar el extracto del mes con dos compras
              nuevas y cuarenta viejas: se importan las dos y, a la siguiente,
              el mismo archivo no trae nada. */}
          {plan &&
            plan.nuevas.length === 0 &&
            !efectivoPendiente(plan) &&
            !posicionesPendientes(plan) &&
            archivos.some((a) => a.buzon) && (
              <Boton
                tipo="suave"
                className="w-full"
                onClick={() => {
                  const ids = archivos.map((a) => a.buzon).filter((b): b is string => Boolean(b));
                  void (async () => {
                    for (const id of ids) await marcarImportada(id, 0);
                    await recargarBuzon();
                    limpiar();
                  })();
                }}
              >
                Entendido, quítalo del buzón
              </Boton>
            )}

          {plan &&
            (plan.nuevas.length > 0 || efectivoPendiente(plan) || posicionesPendientes(plan)) && (
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
                      : posicionesPendientes(plan)
                        ? "Poner al día las posiciones"
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
              const e = desdeTexto(texto);
              setArchivos((previos) => [
                ...previos,
                {
                  id: `a${(contador.current += 1)}`,
                  nombre: "texto pegado",
                  entrada: e,
                  formato: detectar(e),
                  mapa: e.tabla ? adivinarMapa(e.tabla) : {},
                },
              ]);
              setPegando(false);
              setTexto("");
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

/** Valor del selector que significa «déjalo como lo hayas adivinado». */
const AUTO = "auto";

function Resumen({
  plan,
  candidatos,
  emparejamientos,
  onEmparejar,
  valores,
  onValor,
}: {
  plan: Plan;
  candidatos: Activo[];
  emparejamientos: Record<string, string>;
  onEmparejar(isin: string, valor: string): void;
  valores: Record<string, number>;
  onValor(clave: string, texto: string): void;
}) {
  const [verDescartes, setVerDescartes] = useState(false);
  // Un extracto de posición no trae operaciones y no por eso está vacío.
  const nada = plan.nuevas.length === 0 && plan.posiciones.length === 0;
  /** Alguno de los archivos trae compras. Cambia lo que hay que decirle a
   *  alguien de un fondo sin coste: si no las trae, que suba el Excel; si las
   *  trae, que ese fondo no está en ellas — y pedirle otra vez el archivo que
   *  acaba de subir es la manera de que deje de leer los avisos. */
  const hayCompras = plan.lectura.filas.some((f) => f.tipo === "buy");
  /** Claves de los valores que el extracto no cubre, para señalarlos en el
   *  detalle: entran, pero valiendo cero mientras nadie diga lo que valen. */
  const sinCubrir = new Map(plan.sinCubrir.map((c) => [c.clave, c]));

  return (
    <>
      <Tarjeta>
        <TituloSeccion>Lo que va a entrar</TituloSeccion>

        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <Dato n={plan.nuevas.length} t="nuevas" />
          <Dato n={plan.duplicadas.length} t="ya estaban" apagado />
          <Dato n={plan.descartes.length} t="descartadas" apagado />
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

        {/* Lo que compraste y el extracto no cubre. Va aquí arriba y no
            escondido entre los descartes porque es dinero de verdad: 423 € de
            oro y cripto que sin esto entran valiendo cero. */}
        {plan.sinCubrir.some((c) => c.valor == null) && (
          <div className="mt-2">
            <Aviso tono="alerta">
              El extracto no dice nada de{" "}
              <strong>
                {plan.sinCubrir.filter((c) => c.valor == null).map((c) => c.nombre).join(", ")}
              </strong>
              , y por sus compras tampoco se saben las participaciones.{" "}
              {plan.extractoCuadra ? (
                <>
                  Su «Posición Integrada» cuadra con el efectivo y esos{" "}
                  {plan.posiciones.length} fondos y con nada más, así que este PDF sólo cubre la
                  cuenta de efectivo: lo que tengas en la de valores —los ETC y los ETF— no sale
                  aquí.{" "}
                </>
              ) : null}
              Dinos cuánto valen hoy, que lo pone en la app del banco, y entran bien. Si los
              dejas en blanco entran valiendo cero.
            </Aviso>
          </div>
        )}

        {plan.sinCubrir.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {plan.sinCubrir.map((c) => (
              <div key={c.clave} className="tile flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-bold text-fg0">{c.nombre}</p>
                  <p className="text-[11px] text-fg2">
                    {c.ops} {c.ops === 1 ? "compra" : "compras"} · te costaron {fe(c.euros, 2)}
                    {c.titulos != null && c.titulos > 0 && <> · {fn(c.titulos, 4)} títulos</>}
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-fg2">Vale hoy</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={valores[c.clave] ?? ""}
                    onChange={(e) => onValor(c.clave, e.target.value)}
                    placeholder="€"
                    aria-label={`Cuánto vale hoy ${c.nombre}`}
                    className="w-24 rounded-field border border-line2 bg-bg1 px-2 py-1 text-right text-[12.5px] font-bold text-fg0"
                  />
                </label>
              </div>
            ))}
          </div>
        )}

        {/* El efectivo se escribe al confirmar, así que tiene que verse antes.
            Es la única línea de la importación que no sale de una operación
            del archivo sino de la suma de todas, y por eso es la que más
            sorprende cuando aparece sola en la cartera. */}
        {plan.efectivo &&
          (plan.nuevas.length > 0 || efectivoPendiente(plan) || posicionesPendientes(plan)) && (
            <div className="mt-2">
              <Aviso>
                {plan.efectivo.existente ? "Se actualizará" : "Se creará"} la cuenta de efectivo{" "}
                <strong>{plan.efectivo.activo.name}</strong> con un saldo de{" "}
                <strong>{fe(plan.efectivo.saldo, 2)}</strong>
                {plan.efectivo.declarado ? (
                  <>
                    , que es el que dice el propio extracto. Sumando sólo los movimientos
                    importados saldrían {fe(plan.efectivo.calculado, 2)}: la diferencia es el
                    dinero que ya había en la cuenta antes de la primera línea del archivo.
                  </>
                ) : (
                  <>
                    , que es lo que suman los ingresos, las retiradas, las compras y los cobros del
                    extracto.
                  </>
                )}
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

      {/* ── Las posiciones ──────────────────────────────────────────────
          Lo que el extracto dice que TIENES, que es distinto de lo que has
          hecho. Se enseña activo por activo porque aquí es donde el
          importador tiene que adivinar —el banco corta los nombres— y una
          equivocación aquí se lleva por delante la posición entera. */}
      {plan.posiciones.length > 0 && (
        <section>
          <TituloSeccion nota="Lo que el banco dice que tienes hoy. Comprueba que cada uno cae en el activo que toca.">
            Tus posiciones, según el extracto
          </TituloSeccion>
          <div className="flex flex-col gap-2">
            {plan.posiciones.map((p) => {
              const valorEur = p.posicion.valor;
              const cortoDeCoste = p.coste > 0 && p.coste < valorEur * 0.75;
              return (
                <div key={p.posicion.isin} className="tile flex flex-col gap-2 px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold text-fg0">
                        {p.posicion.nombre}
                      </p>
                      <p className="font-mono text-[10.5px] text-fg3">{p.posicion.isin}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[13px] font-bold text-fg0">
                        {fn(p.posicion.valor, 2)} {p.posicion.divisa}
                      </p>
                      <p className="text-[10.5px] text-fg2">
                        {fn(p.posicion.titulos, 5)} títulos
                      </p>
                    </div>
                  </div>

                  {p.aldia ? (
                    <p className="text-[11.5px] text-fg2">
                      Ya está así en la cartera: no hay nada que cambiar.
                    </p>
                  ) : (
                    <>
                      <Selector
                        etiqueta="En tu cartera es"
                        valor={emparejamientos[p.posicion.isin] ?? AUTO}
                        onChange={(v) => onEmparejar(p.posicion.isin, v)}
                        opciones={[
                          {
                            valor: AUTO,
                            texto: p.activo
                              ? `Automático · ${p.activo.name}`
                              : "Automático · crear uno nuevo",
                          },
                          { valor: "", texto: "Crear un activo nuevo" },
                          ...candidatos.map((a) => ({ valor: a.id, texto: a.name })),
                        ]}
                      />
                      {p.dudoso && (
                        <Aviso tono="alerta">
                          Ojo con éste: hay activos tuyos que se parecen igual a dos posiciones
                          distintas —pasa con las dos clases del mismo fondo, la de euros y la de
                          dólares— y por el nombre no hay manera de saberlo. Mira arriba que sea el
                          que tú crees.
                        </Aviso>
                      )}
                      {p.absorbidos.length > 0 && (
                        <p className="text-[11.5px] leading-relaxed text-fg1">
                          Se juntará con{" "}
                          <strong>{p.absorbidos.map((a) => a.name).join(", ")}</strong>: es el
                          mismo fondo con el nombre cortado de otra manera. Se archiva y sus
                          compras cuentan aquí.
                        </p>
                      )}
                      <p className="text-[11.5px] leading-relaxed text-fg2">
                        {p.coste > 0 ? (
                          <>
                            Coste según tus operaciones: <strong>{fe(p.coste, 2)}</strong>.
                            {cortoDeCoste && (
                              <>
                                {" "}
                                Es bastante menos de lo que vale hoy, así que probablemente
                                compraste antes de la ventana del Excel que subiste. Baja otro con
                                un rango de fechas más largo y la ganancia saldrá bien.
                              </>
                            )}
                          </>
                        ) : hayCompras ? (
                          <>
                            Ninguna de las compras que traes casa con este fondo: o lo compraste
                            antes del rango de fechas que bajaste, o llegó por un traspaso de otro
                            fondo, que MyInvestor no apunta en la cuenta corriente. Se apunta con
                            un coste igual a lo que vale hoy, así que aparecerá sin ganancia ni
                            pérdida.
                          </>
                        ) : (
                          <>
                            No hay ninguna compra importada de este fondo, así que se apunta con un
                            coste igual a lo que vale hoy: aparecerá sin ganancia ni pérdida hasta
                            que importes el Excel de movimientos.
                          </>
                        )}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Al revés: activos tuyos de los que el extracto no dice nada. O
              los vendiste, o los traspasaste, o están en otro sitio del banco
              que este extracto no lista. En cualquiera de los tres casos van a
              quedarse en la cartera valiendo cero, y más vale saberlo. */}
          {(() => {
            const casados = new Set(
              plan.posiciones.flatMap((p) => [p.activo?.id, ...p.absorbidos.map((a) => a.id)]),
            );
            const huerfanos = candidatos.filter((a) => !casados.has(a.id));
            if (huerfanos.length === 0) return null;
            return (
              <div className="mt-2">
                <Aviso>
                  El extracto no dice nada de{" "}
                  <strong>{huerfanos.map((a) => a.name).join(", ")}</strong>.{" "}
                  O los vendiste, o los traspasaste, o están en una parte del banco que este
                  extracto no cubre — el de MyInvestor sólo cuadra la cuenta de efectivo, no la
                  de valores. Si los vendiste o los traspasaste, archívalos desde su ficha; si los
                  sigues teniendo, ponles a mano lo que valen: tal cual están cuentan cero en tu
                  cartera.
                </Aviso>
              </div>
            );
          })()}
        </section>
      )}

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
                        {p.nuevoActivo &&
                          (() => {
                            const s = sinCubrir.get(
                              (p.fila.isin || p.fila.ticker || p.fila.nombre || "").toUpperCase(),
                            );
                            if (!s) return " · activo nuevo";
                            return s.valor != null
                              ? ` · activo nuevo · lo valoras en ${fe(s.valor, 2)}`
                              : " · activo nuevo · el extracto no lo cubre";
                          })()}
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

      {plan.descartes.length > 0 && (
        <section>
          <button
            onClick={() => setVerDescartes(!verDescartes)}
            className="text-[12px] font-semibold text-fg2 underline-offset-4 hover:text-fg0 hover:underline"
          >
            {verDescartes ? "Ocultar" : "Ver"} las {plan.descartes.length} líneas
            descartadas
          </button>
          {verDescartes && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {plan.descartes.slice(0, 60).map((d, i) => (
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
