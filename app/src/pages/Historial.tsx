// ── HISTORIAL ────────────────────────────────────────────────────────────
// Todo lo que ha pasado en la cartera, en una sola lista. Aquí aterrizan las
// operaciones importadas y aquí se corrigen.
//
// La segunda pestaña, Posiciones, es donde viven los activos que NO tienen
// histórico: el saldo de una cuenta corriente o un fondo antiguo del que ya no
// queda el extracto. Se declaran a mano y se calculan igual que el resto.

import { useMemo, useState } from "react";
import { useDatos } from "../lib/datos";
import { CAT_LBL, CATEGORIAS, OP_LBL, type Activo, type Operacion, type TipoOperacion } from "../lib/tipos";
import { fd, fe, fn, hoyISO } from "../lib/formato";
import {
  Aviso,
  Boton,
  Campo,
  Etiqueta,
  Hoja,
  Segmentos,
  Selector,
  Tarjeta,
  Vacio,
} from "../components/base";

type Vista = "movimientos" | "posiciones";

export default function Historial() {
  const [vista, setVista] = useState<Vista>("movimientos");

  return (
    <div className="flex flex-col gap-4">
      <section>
        <Etiqueta>Historial</Etiqueta>
        <h1 className="hero-num mt-1 text-[2.1rem] text-fg0">Todo lo que has hecho.</h1>
      </section>

      <Segmentos
        valor={vista}
        onChange={setVista}
        opciones={[
          { valor: "movimientos", texto: "Movimientos" },
          { valor: "posiciones", texto: "Posiciones" },
        ]}
      />

      {vista === "movimientos" ? <Movimientos /> : <Posiciones />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  MOVIMIENTOS
// ════════════════════════════════════════════════════════════════════════

function Movimientos() {
  const { estado, realizadas, borrar } = useDatos();
  const [tipo, setTipo] = useState<TipoOperacion | "todos">("todos");
  const [anio, setAnio] = useState<string>("todos");
  const [cuenta, setCuenta] = useState<string>("todas");
  const [editando, setEditando] = useState<Operacion | null>(null);
  const [nueva, setNueva] = useState(false);

  const activos = useMemo(
    () => new Map(estado.activos.map((a) => [a.id, a])),
    [estado.activos],
  );

  const cuentas = useMemo(
    () => new Map(estado.cuentas.map((c) => [c.id, c])),
    [estado.cuentas],
  );

  /** Lo que se gano o se perdio en cada venta, por id de operacion. */
  const resultados = useMemo(
    () => new Map(realizadas.map((r) => [r.opId, r])),
    [realizadas],
  );

  const anios = useMemo(
    () => [...new Set(estado.operaciones.map((o) => o.date.slice(0, 4)))].sort().reverse(),
    [estado.operaciones],
  );

  const lista = useMemo(
    () =>
      estado.operaciones
        .filter((o) => (tipo === "todos" ? true : o.type === tipo))
        .filter((o) => (anio === "todos" ? true : o.date.startsWith(anio)))
        // «sin-cuenta» son los movimientos apuntados a mano antes de que
        // hubiera ninguna cuenta: si no salieran en ningun filtro, se
        // perderian de vista sin que nadie los borrara.
        .filter((o) =>
          cuenta === "todas" ? true : cuenta === "sin-cuenta" ? !o.account_id : o.account_id === cuenta,
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    [estado.operaciones, tipo, anio, cuenta],
  );

  // Las cifras de cabecera se calculan sobre lo FILTRADO: si miras 2026, los
  // totales tienen que ser los de 2026.
  const totales = useMemo(() => {
    let entrada = 0;
    let salida = 0;
    let cobros = 0;
    let resultado = 0;
    for (const o of lista) {
      const eur = o.total_eur ?? o.total;
      if (o.type === "buy" || o.type === "deposit") entrada += eur;
      else if (o.type === "sell" || o.type === "withdrawal") salida += eur;
      else if (o.type === "dividend" || o.type === "interest") cobros += eur;
      // El resultado de una venta no es lo que cobraste: es lo que cobraste
      // menos lo que te habia costado. Es la cifra que dice si ganaste.
      if (o.type === "sell") resultado += resultados.get(o.id)?.resultado ?? 0;
    }
    return { entrada, salida, cobros, resultado, hayVentas: lista.some((o) => o.type === "sell") };
  }, [lista, resultados]);

  return (
    <>
      {estado.cuentas.length > 0 && (
        <Selector
          valor={cuenta}
          onChange={setCuenta}
          opciones={[
            { valor: "todas", texto: "Todas las plataformas" },
            ...estado.cuentas.map((c) => ({ valor: c.id, texto: c.name || c.broker })),
            ...(estado.operaciones.some((o) => !o.account_id)
              ? [{ valor: "sin-cuenta", texto: "Sin plataforma" }]
              : []),
          ]}
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        <Selector
          valor={tipo}
          onChange={(v) => setTipo(v as TipoOperacion | "todos")}
          opciones={[
            { valor: "todos", texto: "Todos los tipos" },
            ...(Object.keys(OP_LBL) as TipoOperacion[]).map((t) => ({
              valor: t,
              texto: OP_LBL[t],
            })),
          ]}
        />
        <Selector
          valor={anio}
          onChange={setAnio}
          opciones={[
            { valor: "todos", texto: "Todos los años" },
            ...anios.map((a) => ({ valor: a, texto: a })),
          ]}
        />
      </div>

      <Tarjeta className={`grid ${totales.hayVentas ? "grid-cols-4" : "grid-cols-3"} gap-2 text-center`}>
        <Mini t="Invertido" v={fe(totales.entrada, 0)} />
        <Mini t="Recuperado" v={fe(totales.salida, 0)} />
        <Mini t="Cobrado" v={fe(totales.cobros, 0)} tono="up" />
        {totales.hayVentas && (
          <Mini
            t="Resultado"
            v={fe(totales.resultado, 0)}
            tono={totales.resultado >= 0 ? "up" : "dn"}
          />
        )}
      </Tarjeta>

      <Boton tipo="principal" onClick={() => setNueva(true)} className="w-full">
        Apuntar un movimiento
      </Boton>

      {lista.length === 0 ? (
        <Vacio
          titulo="Aquí no hay nada todavía"
          texto="Carga el archivo de tu bróker o apunta el movimiento a mano."
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lista.slice(0, 300).map((o) => (
            <li key={o.id}>
              <button
                onClick={() => setEditando(o)}
                className="tile flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-bg2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-fg0">
                    {/* Un ingreso o unos intereses no pertenecen a ningun
                        valor, y titular esa fila «Sin activo» no dice nada:
                        mejor lo que es. */}
                    {activos.get(o.asset_id ?? "")?.name ?? OP_LBL[o.type]}
                  </span>
                  <span className="text-[11px] text-fg2">
                    {fd(o.date)} · {OP_LBL[o.type]}
                    {o.is_internal_transfer && " · traspaso"}
                    {o.quantity ? ` · ${fn(o.quantity, 4)}` : ""}
                  </span>
                  {/* La plataforma en su propia linea y con marca: con dos
                      brokers en la misma lista, saber de cual viene cada
                      movimiento es la mitad de la informacion. */}
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-fg3">
                    <span className="rounded-full bg-bg3 px-1.5 py-0.5 font-semibold text-fg2">
                      {cuentas.get(o.account_id ?? "")?.name ??
                        cuentas.get(o.account_id ?? "")?.broker ??
                        "Sin plataforma"}
                    </span>
                    {o.source === "import" && <span>importado</span>}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={`block text-[13px] font-bold ${
                      o.type === "dividend" || o.type === "interest"
                        ? "text-up"
                        : o.type === "sell" || o.type === "withdrawal"
                          ? "text-fg1"
                          : "text-fg0"
                    }`}
                  >
                    {fe(o.total_eur ?? o.total, 2)}
                  </span>
                  {/* Lo que de verdad ganaste o perdiste con esa venta: lo
                      cobrado menos lo que te habia costado el lote. El
                      importe de arriba no lo dice — vender 200 EUR puede ser
                      una ganancia o un desastre. */}
                  {o.type === "sell" && resultados.has(o.id) && (
                    <span
                      className={`block text-[11px] font-semibold ${
                        (resultados.get(o.id)?.resultado ?? 0) >= 0 ? "text-up" : "text-dn"
                      }`}
                    >
                      {(resultados.get(o.id)?.resultado ?? 0) >= 0 ? "+" : ""}
                      {fe(resultados.get(o.id)?.resultado ?? 0, 2)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lista.length > 300 && (
        <p className="text-center text-[11px] text-fg2">
          Se muestran los 300 más recientes de {lista.length}.
        </p>
      )}

      <FormOperacion
        abierta={nueva || editando != null}
        operacion={editando}
        onCerrar={() => {
          setNueva(false);
          setEditando(null);
        }}
        onBorrar={
          editando
            ? async () => {
                await borrar("operations", editando.id);
                setEditando(null);
              }
            : undefined
        }
      />
    </>
  );
}

function Mini({ t, v, tono }: { t: string; v: string; tono?: "up" | "dn" }) {
  return (
    <div>
      <Etiqueta>{t}</Etiqueta>
      <p
        className={`font-disp text-[15px] font-bold ${
          tono === "up" ? "text-up" : tono === "dn" ? "text-dn" : "text-fg0"
        }`}
      >
        {v}
      </p>
    </div>
  );
}

// ── Formulario de operación ───────────────────────────────────────────────

function FormOperacion({
  abierta,
  operacion,
  onCerrar,
  onBorrar,
}: {
  abierta: boolean;
  operacion: Operacion | null;
  onCerrar: () => void;
  onBorrar?: () => Promise<void>;
}) {
  const { estado, insertar, actualizar } = useDatos();
  const [tipo, setTipo] = useState<TipoOperacion>("buy");
  const [activoId, setActivoId] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [cantidad, setCantidad] = useState("");
  const [precio, setPrecio] = useState("");
  const [total, setTotal] = useState("");
  const [comision, setComision] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  // Al abrir con una operación existente se rellena una sola vez; después el
  // formulario es del usuario y no se le pisa lo que escriba.
  if (abierta && !listo) {
    setListo(true);
    if (operacion) {
      setTipo(operacion.type);
      setActivoId(operacion.asset_id ?? "");
      setFecha(operacion.date);
      setCantidad(operacion.quantity != null ? String(operacion.quantity) : "");
      setPrecio(operacion.price != null ? String(operacion.price) : "");
      setTotal(String(operacion.total));
      setComision(operacion.fees ? String(operacion.fees) : "");
    } else {
      setTipo("buy");
      setActivoId(estado.activos[0]?.id ?? "");
      setFecha(hoyISO());
      setCantidad("");
      setPrecio("");
      setTotal("");
      setComision("");
    }
    setError(null);
  }
  if (!abierta && listo) setListo(false);

  const necesitaTitulos = tipo === "buy" || tipo === "sell";
  const nq = parseFloat(cantidad.replace(",", "."));
  const np = parseFloat(precio.replace(",", "."));
  // El importe se deduce de cantidad × precio mientras no se escriba a mano:
  // es lo que se sabe de una compra sin tener que calcularlo tú.
  const calculado = isFinite(nq) && isFinite(np) ? nq * np : undefined;
  const importe = total ? parseFloat(total.replace(",", ".")) : calculado;

  async function guardar() {
    setError(null);
    if (!activoId) return setError("Elige un activo.");
    if (!importe || !isFinite(importe) || importe <= 0) return setError("El importe no es válido.");
    if (necesitaTitulos && (!isFinite(nq) || nq <= 0)) return setError("La cantidad no es válida.");

    const activo = estado.activos.find((a) => a.id === activoId);
    const fila: Partial<Operacion> = {
      asset_id: activoId,
      type: tipo,
      date: fecha,
      quantity: isFinite(nq) ? nq : null,
      price: isFinite(np) ? np : null,
      total: Math.abs(importe),
      fees: comision ? Math.abs(parseFloat(comision.replace(",", "."))) || 0 : 0,
      currency: activo?.currency ?? "EUR",
      total_eur: Math.abs(importe),
      source: "manual",
    };

    try {
      if (operacion) await actualizar<Operacion>("operations", operacion.id, fila);
      else await insertar<Operacion>("operations", [fila]);
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    }
  }

  return (
    <Hoja
      abierta={abierta}
      titulo={operacion ? "Editar movimiento" : "Apuntar un movimiento"}
      onCerrar={onCerrar}
      pie={
        <div className="flex gap-2">
          {onBorrar && (
            <Boton tipo="peligro" onClick={() => void onBorrar()}>
              Borrar
            </Boton>
          )}
          <Boton tipo="principal" className="flex-1" onClick={() => void guardar()}>
            Guardar
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Selector
          etiqueta="Qué ha pasado"
          valor={tipo}
          onChange={(v) => setTipo(v as TipoOperacion)}
          opciones={(Object.keys(OP_LBL) as TipoOperacion[]).map((t) => ({
            valor: t,
            texto: OP_LBL[t],
          }))}
        />

        <Selector
          etiqueta="Activo"
          valor={activoId}
          onChange={setActivoId}
          opciones={estado.activos.map((a) => ({ valor: a.id, texto: a.name }))}
        />

        <Campo etiqueta="Fecha" tipo="date" valor={fecha} onChange={setFecha} />

        {necesitaTitulos && (
          <div className="grid grid-cols-2 gap-2">
            <Campo etiqueta="Cantidad" tipo="number" paso="any" valor={cantidad} onChange={setCantidad} />
            <Campo etiqueta="Precio" tipo="number" paso="any" valor={precio} onChange={setPrecio} />
          </div>
        )}

        <Campo
          etiqueta="Importe"
          tipo="number"
          paso="any"
          valor={total}
          onChange={setTotal}
          sufijo="€"
          nota={
            !total && calculado
              ? `Se usará ${fe(calculado)}, calculado de cantidad × precio`
              : "En positivo: el signo lo pone el tipo de movimiento"
          }
        />

        <Campo etiqueta="Comisión" tipo="number" paso="any" valor={comision} onChange={setComision} sufijo="€" />

        {tipo === "dividend" || tipo === "interest" ? (
          <Aviso>
            Los cobros cuentan como ganancia, no como dinero aportado por ti. Es lo que hace que la
            rentabilidad no se falsee al ingresar intereses.
          </Aviso>
        ) : null}

        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Hoja>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  POSICIONES
// ════════════════════════════════════════════════════════════════════════

function Posiciones() {
  const { posiciones, borrar } = useDatos();
  const [editando, setEditando] = useState<Activo | null>(null);
  const [nuevo, setNuevo] = useState(false);

  return (
    <>
      <Boton tipo="principal" onClick={() => setNuevo(true)} className="w-full">
        Añadir un activo o una cuenta
      </Boton>

      {posiciones.length === 0 ? (
        <Vacio titulo="Sin posiciones" texto="Importa un archivo o añade la primera a mano." />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {posiciones.map((p) => (
            <li key={p.activo.id}>
              <button
                onClick={() => setEditando(p.activo)}
                className="tile flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-bg2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-fg0">
                    {p.activo.name}
                  </span>
                  <span className="text-[11px] text-fg2">
                    {CAT_LBL[p.activo.cat] ?? p.activo.cat}
                    {p.activo.ticker ? ` · ${p.activo.ticker}` : ""}
                    {p.activo.mode === "manual" ? " · saldo a mano" : " · desde movimientos"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[13px] font-bold text-fg0">{fe(p.valor, 0)}</span>
                  <span className="text-[10.5px] text-fg2">
                    {fn(p.qty, 4)} {p.activo.unit}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <FormActivo
        abierta={nuevo || editando != null}
        activo={editando}
        onCerrar={() => {
          setNuevo(false);
          setEditando(null);
        }}
        onBorrar={
          editando
            ? async () => {
                await borrar("assets", editando.id);
                setEditando(null);
              }
            : undefined
        }
      />
    </>
  );
}

function FormActivo({
  abierta,
  activo,
  onCerrar,
  onBorrar,
}: {
  abierta: boolean;
  activo: Activo | null;
  onCerrar: () => void;
  onBorrar?: () => Promise<void>;
}) {
  const { insertar, actualizar } = useDatos();
  const [nombre, setNombre] = useState("");
  const [cat, setCat] = useState<string>("accion");
  const [ticker, setTicker] = useState("");
  const [isin, setIsin] = useState("");
  const [unidad, setUnidad] = useState("títulos");
  const [divisa, setDivisa] = useState("EUR");
  const [subyacente, setSubyacente] = useState("");
  const [modo, setModo] = useState<"operations" | "manual">("operations");
  const [qty, setQty] = useState("");
  const [costeUnit, setCosteUnit] = useState("");
  const [precioManual, setPrecioManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  if (abierta && !listo) {
    setListo(true);
    setNombre(activo?.name ?? "");
    setCat(activo?.cat ?? "accion");
    setTicker(activo?.ticker ?? "");
    setIsin(activo?.isin ?? "");
    setUnidad(activo?.unit ?? "títulos");
    setDivisa(activo?.currency ?? "EUR");
    setSubyacente(activo?.underlying ?? "");
    setModo(activo?.mode ?? "operations");
    setQty(activo?.manual_qty != null ? String(activo.manual_qty) : "");
    setCosteUnit(activo?.manual_cost_unit != null ? String(activo.manual_cost_unit) : "");
    setPrecioManual(activo?.manual_price != null ? String(activo.manual_price) : "");
    setError(null);
  }
  if (!abierta && listo) setListo(false);

  const efectivo = cat === "liquidez";
  const n = (s: string) => {
    const v = parseFloat(s.replace(",", "."));
    return isFinite(v) ? v : null;
  };

  async function guardar() {
    setError(null);
    if (!nombre.trim()) return setError("Ponle un nombre.");

    const fila: Partial<Activo> = {
      name: nombre.trim(),
      cat,
      ticker: ticker.trim().toUpperCase() || null,
      isin: isin.trim().toUpperCase() || null,
      unit: efectivo ? "€" : unidad.trim() || "títulos",
      currency: divisa.trim().toUpperCase() || "EUR",
      underlying: subyacente.trim() || null,
      // El efectivo es siempre manual: no hay un histórico de compras de una
      // cuenta corriente, hay un saldo.
      mode: efectivo ? "manual" : modo,
      manual_qty: n(qty),
      manual_cost_unit: efectivo ? 1 : n(costeUnit),
      manual_price: efectivo ? 1 : n(precioManual),
    };

    try {
      if (activo) await actualizar<Activo>("assets", activo.id, fila);
      else await insertar<Activo>("assets", [fila]);
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    }
  }

  return (
    <Hoja
      abierta={abierta}
      titulo={activo ? "Editar" : "Añadir a la cartera"}
      onCerrar={onCerrar}
      pie={
        <div className="flex gap-2">
          {onBorrar && (
            <Boton tipo="peligro" onClick={() => void onBorrar()}>
              Borrar
            </Boton>
          )}
          <Boton tipo="principal" className="flex-1" onClick={() => void guardar()}>
            Guardar
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Campo etiqueta="Nombre" valor={nombre} onChange={setNombre} autoFocus />

        <Selector
          etiqueta="Categoría"
          valor={cat}
          onChange={setCat}
          opciones={[
            ...CATEGORIAS.map((c) => ({ valor: c as string, texto: CAT_LBL[c] ?? c })),
            ...(CATEGORIAS.includes(cat) ? [] : [{ valor: cat, texto: cat }]),
          ]}
        />

        {!efectivo && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Campo etiqueta="Símbolo" valor={ticker} onChange={setTicker} placeholder="IGLN" />
              <Campo etiqueta="ISIN" valor={isin} onChange={setIsin} placeholder="IE00B4ND3602" />
            </div>
            <p className="-mt-1 text-[11px] leading-relaxed text-fg2">
              Con el símbolo o el ISIN correctos, el precio se actualiza solo. Sin ellos, hay que
              apuntarlo a mano.
            </p>

            <Selector
              etiqueta="De dónde sale la posición"
              valor={modo}
              onChange={(v) => setModo(v as "operations" | "manual")}
              opciones={[
                { valor: "operations", texto: "De los movimientos (compras y ventas)" },
                { valor: "manual", texto: "Saldo declarado a mano" },
              ]}
            />
          </>
        )}

        {(modo === "manual" || efectivo) && (
          <div className="grid grid-cols-2 gap-2">
            <Campo
              etiqueta={efectivo ? "Saldo" : "Cantidad"}
              tipo="number"
              paso="any"
              valor={qty}
              onChange={setQty}
              sufijo={efectivo ? "€" : undefined}
            />
            {!efectivo && (
              <Campo
                etiqueta="Coste por unidad"
                tipo="number"
                paso="any"
                valor={costeUnit}
                onChange={setCosteUnit}
              />
            )}
          </div>
        )}

        {!efectivo && (
          <div className="grid grid-cols-2 gap-2">
            <Campo etiqueta="Unidad" valor={unidad} onChange={setUnidad} placeholder="títulos" />
            <Campo etiqueta="Divisa" valor={divisa} onChange={setDivisa} placeholder="EUR" />
          </div>
        )}

        {!efectivo && (
          <Campo
            etiqueta="Subyacente"
            valor={subyacente}
            onChange={setSubyacente}
            placeholder="S&P 500, Oro, Bitcoin…"
            nota="Dos productos distintos sobre lo mismo se suman en la vista por subyacente."
          />
        )}

        {!efectivo && (
          <Campo
            etiqueta="Precio a mano"
            tipo="number"
            paso="any"
            valor={precioManual}
            onChange={setPrecioManual}
            nota="Sólo se usa si no hay precio en el feed."
          />
        )}

        {efectivo && (
          <Aviso>
            En una cuenta de efectivo el coste es siempre el saldo: el dinero parado ni gana ni
            pierde. Los intereses que te pague el banco se apuntan como movimiento, y entonces sí
            cuentan como ganancia.
          </Aviso>
        )}

        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Hoja>
  );
}

