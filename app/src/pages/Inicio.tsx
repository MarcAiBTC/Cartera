// ── INICIO ───────────────────────────────────────────────────────────────
// Una pantalla, dos niveles. El titular contesta «¿cuánto tengo?» sin pedir
// nada, y las posiciones contestan «¿en qué?»: por tipo, en bandas que se
// despliegan, o todas en una lista. Las dos se ordenan igual —tamaño,
// rentabilidad, ganancia, lo de hoy o el nombre— y cada posición se abre en
// una ficha con sus cifras, sus operaciones y un enlace para verla en
// TradingView. Es la forma de getquin: la lista es la cartera, y el detalle
// está a un toque, no encima.

import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useDatos } from "../lib/datos";
import { CAT_COLOR, CAT_LBL, OP_LBL, type Activo } from "../lib/tipos";
import {
  catConocida,
  esLiquidez,
  movimientoDelDia,
  ordenarGrupos,
  ordenarPosiciones,
  type Grupo,
  type OrdenPosiciones,
  type Posicion,
} from "../lib/cartera";
import { enlacesDe } from "../lib/enlaces";
import { fd, fe, fn, fp, fpc, signo } from "../lib/formato";
import {
  Boton,
  Delta,
  Etiqueta,
  Hoja,
  Pastilla,
  Segmentos,
  Tarjeta,
  TituloSeccion,
  Vacio,
} from "../components/base";
import { Tira } from "../components/graficos";

type Vista = "tipo" | "todas";

interface Preferencia {
  vista: Vista;
  orden: OrdenPosiciones;
  asc: boolean;
}

const ORDENES: { valor: OrdenPosiciones; texto: string }[] = [
  { valor: "valor", texto: "Tamaño" },
  { valor: "rentabilidad", texto: "Rentabilidad" },
  { valor: "ganancia", texto: "Ganancia" },
  { valor: "hoy", texto: "Hoy" },
  { valor: "nombre", texto: "Nombre" },
];

// Cómo la dejaste la última vez, en este dispositivo. Si no se puede leer
// —una ventana privada—, la de siempre.
const PREF = "cartera:posiciones";
const PREF_DEF: Preferencia = { vista: "tipo", orden: "valor", asc: false };

function leerPref(): Preferencia {
  try {
    const p = JSON.parse(localStorage.getItem(PREF) ?? "null") as Partial<Preferencia> | null;
    if (!p) return PREF_DEF;
    return {
      vista: p.vista === "todas" ? "todas" : "tipo",
      orden: ORDENES.find((o) => o.valor === p.orden)?.valor ?? "valor",
      asc: p.asc === true,
    };
  } catch {
    return PREF_DEF;
  }
}

export default function Inicio() {
  const { resumen, categorias, posiciones, estado } = useDatos();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [pref, setPrefEstado] = useState(leerPref);
  // Por id y no la posición entera: si los precios se refrescan con la ficha
  // abierta, la ficha tiene que enseñar los nuevos.
  const [fichaId, setFichaId] = useState<string | null>(null);

  const setPref = (cambios: Partial<Preferencia>) =>
    setPrefEstado((p) => {
      const n = { ...p, ...cambios };
      try {
        localStorage.setItem(PREF, JSON.stringify(n));
      } catch {
        /* sin almacenamiento: se olvida al cerrar, nada más */
      }
      return n;
    });

  // Pulsar el orden que ya está le da la vuelta; uno nuevo empieza por lo
  // más grande, salvo el nombre, que empieza por la A.
  const elegirOrden = (o: OrdenPosiciones) =>
    o === pref.orden ? setPref({ asc: !pref.asc }) : setPref({ orden: o, asc: o === "nombre" });

  const grupos = useMemo(
    () => ordenarGrupos(categorias, pref.orden, pref.asc, (k) => CAT_LBL[k] ?? k),
    [categorias, pref.orden, pref.asc],
  );
  const lista = useMemo(
    () => ordenarPosiciones(posiciones, pref.orden, pref.asc),
    [posiciones, pref.orden, pref.asc],
  );
  const ficha = posiciones.find((p) => p.activo.id === fichaId) ?? null;
  const metrica = pref.orden === "hoy" ? "hoy" : "total";

  const vacia = estado.activos.length === 0;
  const movers = movimientoDelDia(posiciones).slice(0, 3);
  // Sólo las que además tienen títulos: una posición cerrada sin precio no le
  // quita nada al patrimonio y avisar de ella sería ruido.
  const mudas = posiciones.filter((p) => p.estado === "sin-precio" && p.qty > 0);

  return (
    <div className="flex flex-col gap-5">
      {/* ── El titular ───────────────────────────────────────────────── */}
      <section>
        <Etiqueta>Patrimonio total</Etiqueta>
        <h1 className="hero-num mt-1 text-fg0">{fe(resumen.valor, 0)}</h1>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Delta valor={resumen.dia} pct={resumen.diaPct} tamano="md" />
          <span className="text-[12px] text-fg2">hoy</span>
        </div>
      </section>

      {vacia ? (
        <Vacio
          titulo="Todavía no hay nada en la cartera"
          texto="La forma rápida de empezar es cargar el archivo de movimientos que te da tu bróker: MyInvestor, Revolut o Trade Republic."
          accion={
            <Link to="/importar">
              <Boton tipo="principal">Cargar un archivo</Boton>
            </Link>
          }
        />
      ) : (
        <>
          {/* ── Cuando el titular de arriba es MENTIRA ──────────────────
              Una posición abierta sin cotización vale cero en el total, y
              nada lo decía: la cartera enseñaba 358 € de un patrimonio de
              3.065 € y parecía sencillamente que la app no funcionaba. Un
              patrimonio incompleto tiene que decir que lo está. */}
          {mudas.length > 0 && (
            <Link to="/historial" className="tile block px-3.5 py-3">
              <p className="text-[13px] font-bold text-fg0">
                {mudas.length === 1
                  ? "Hay una posición sin cotización"
                  : `Hay ${mudas.length} posiciones sin cotización`}
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-fg2">
                Valen 0 € en el total de arriba, así que el patrimonio sale corto:{" "}
                {mudas.map((p) => p.activo.name).join(", ")}. En Historial → Posiciones puedes
                ponerles el símbolo de cotización, o el precio a mano. ›
              </p>
            </Link>
          )}

          {/* ── Las tres cifras que explican el titular ────────────────── */}
          <Tarjeta className="grid grid-cols-3 gap-2">
            <Cifra
              etiqueta="Aportado"
              valor={fe(resumen.aportado, 0)}
              nota="dinero tuyo de fuera"
            />
            <Cifra
              etiqueta="Ganancia"
              valor={fe(resumen.ganancia, 0)}
              tono={resumen.ganancia >= 0 ? "up" : "dn"}
              nota={resumen.gananciaPct != null ? fp(resumen.gananciaPct) : undefined}
            />
            <Cifra etiqueta="Efectivo" valor={fe(resumen.liquidez, 0)} nota="sin invertir" />
          </Tarjeta>

          {/* ── Qué mueve hoy ─────────────────────────────────────────── */}
          {movers.length > 0 && (
            <Tarjeta>
              <TituloSeccion nota="Ordenado por euros, no por porcentaje: un +9% sobre 30 € no mueve una cartera.">
                Qué la mueve hoy
              </TituloSeccion>
              <ul className="flex flex-col gap-2">
                {movers.map((p) => (
                  <li key={p.activo.id}>
                    <button
                      onClick={() => setFichaId(p.activo.id)}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <span
                        className="h-6 w-[3px] shrink-0 rounded-full"
                        style={{ background: CAT_COLOR[catConocida(p.activo.cat)] }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg0">
                        {p.activo.name}
                      </span>
                      <Pastilla pct={p.diaPct} />
                      <span
                        className={`w-[76px] shrink-0 text-right text-[13px] font-bold ${
                          (p.dia ?? 0) >= 0 ? "text-up" : "text-dn"
                        }`}
                      >
                        {(p.dia ?? 0) >= 0 ? "+" : ""}
                        {fe(p.dia, 0)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          {/* ── Las posiciones ────────────────────────────────────────── */}
          <section>
            <TituloSeccion
              nota={`${posiciones.length} ${
                posiciones.length === 1 ? "posición" : "posiciones"
              } · toca una para ver su ficha`}
              extra={
                <Segmentos
                  valor={pref.vista}
                  onChange={(v) => setPref({ vista: v })}
                  opciones={[
                    { valor: "tipo", texto: "Por tipo" },
                    { valor: "todas", texto: "Todas" },
                  ]}
                />
              }
            >
              Tus posiciones
            </TituloSeccion>
            <Tira
              total={resumen.valor}
              porciones={categorias.map((g) => ({
                clave: g.clave,
                etiqueta: CAT_LBL[g.clave] ?? g.clave,
                valor: g.valor,
                color: CAT_COLOR[g.clave] ?? CAT_COLOR.otro,
              }))}
            />

            <Orden orden={pref.orden} asc={pref.asc} onElegir={elegirOrden} />

            {pref.vista === "tipo" ? (
              <div className="mt-2 flex flex-col gap-2">
                {grupos.map((g) => (
                  <Banda
                    key={g.clave}
                    grupo={g}
                    filas={ordenarPosiciones(g.posiciones, pref.orden, pref.asc)}
                    metrica={metrica}
                    total={resumen.valor}
                    abierta={abierta === g.clave}
                    onAbrir={() => setAbierta(abierta === g.clave ? null : g.clave)}
                    onFicha={setFichaId}
                  />
                ))}
              </div>
            ) : (
              <ul className="tile mt-2 overflow-hidden">
                {lista.map((p) => (
                  <Fila
                    key={p.activo.id}
                    p={p}
                    metrica={metrica}
                    total={resumen.valor}
                    onFicha={setFichaId}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Ficha p={ficha} total={resumen.valor} onCerrar={() => setFichaId(null)} />
    </div>
  );
}

function Cifra({
  etiqueta,
  valor,
  nota,
  tono,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
  tono?: "up" | "dn";
}) {
  return (
    <div>
      <Etiqueta>{etiqueta}</Etiqueta>
      <p
        className={`font-disp text-[17px] font-bold tracking-tight ${
          tono === "up" ? "text-up" : tono === "dn" ? "text-dn" : "text-fg0"
        }`}
      >
        {valor}
      </p>
      {nota && <p className="text-[10px] text-fg3">{nota}</p>}
    </div>
  );
}

/** Los órdenes, en píldoras que se deslizan si no caben. */
function Orden({
  orden,
  asc,
  onElegir,
}: {
  orden: OrdenPosiciones;
  asc: boolean;
  onElegir: (o: OrdenPosiciones) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Ordenar las posiciones"
      className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]"
    >
      {ORDENES.map((o) => {
        const activo = o.valor === orden;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={activo}
            aria-label={
              activo ? `${o.texto}, ${asc ? "de menor a mayor" : "de mayor a menor"}` : o.texto
            }
            onClick={() => onElegir(o.valor)}
            className={`shrink-0 rounded-full border px-3 py-1 text-[11.5px] font-bold transition-colors ${
              activo
                ? "border-transparent bg-fg0 text-bg1"
                : "border-line2 bg-bg1 text-fg2 hover:text-fg0"
            }`}
          >
            {o.texto}
            {activo && <span aria-hidden> {asc ? "↑" : "↓"}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Un importe con su porcentaje, en su color. Sin dato, un guion. Por
 *  debajo de 10 €, con céntimos: si no, 47 céntimos de pérdida se leen
 *  «−0 €». */
function Cambio({
  v,
  pct,
  className = "text-[11px]",
}: {
  v: number | null | undefined;
  pct?: number | null;
  className?: string;
}) {
  if (v == null || !isFinite(v)) return <span className={`${className} font-bold text-fg3`}>—</span>;
  const s = signo(v);
  const color = s === "up" ? "text-up" : s === "dn" ? "text-dn" : "text-fg2";
  return (
    <span className={`${className} font-bold ${color}`}>
      {s === "up" ? "+" : ""}
      {fe(v, Math.abs(v) < 10 ? 2 : 0)}
      {pct != null && isFinite(pct) ? ` (${fp(pct)})` : ""}
    </span>
  );
}

function Banda({
  grupo,
  filas,
  metrica,
  total,
  abierta,
  onAbrir,
  onFicha,
}: {
  grupo: Grupo;
  filas: Posicion[];
  metrica: "total" | "hoy";
  total: number;
  abierta: boolean;
  onAbrir: () => void;
  onFicha: (id: string) => void;
}) {
  const color = CAT_COLOR[grupo.clave] ?? CAT_COLOR.otro;
  const baseDia = grupo.valor - grupo.dia;
  return (
    <div className="tile overflow-hidden">
      <button
        onClick={onAbrir}
        aria-expanded={abierta}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-bg2"
      >
        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-fg0">
            {CAT_LBL[grupo.clave] ?? grupo.clave}
          </span>
          <span className="text-[11px] text-fg2">
            {fpc(grupo.peso)} de la cartera · {grupo.posiciones.length}{" "}
            {grupo.posiciones.length === 1 ? "posición" : "posiciones"}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[14px] font-bold text-fg0">{fe(grupo.valor, 0)}</span>
          {/* En el efectivo la ganancia es siempre cero por definición: no se
              enseña un +0,00% que sólo confunde. */}
          {grupo.clave !== "liquidez" &&
            (metrica === "hoy" ? (
              <Cambio v={grupo.dia} pct={baseDia > 0 ? (grupo.dia / baseDia) * 100 : null} />
            ) : (
              <Cambio v={grupo.ganancia} pct={grupo.gananciaPct} />
            ))}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className={`shrink-0 text-fg3 transition-transform duration-200 ${abierta ? "rotate-180" : ""}`}
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {abierta && (
        <ul className="border-t border-line">
          {filas.map((p) => (
            <Fila key={p.activo.id} p={p} metrica={metrica} total={total} onFicha={onFicha} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Las letras del activo en un círculo de su color: lo que en getquin es el
 *  logo. El ticker si es legible; si es un código de Morningstar o un ISIN,
 *  las iniciales del nombre. */
function sigla(a: Activo): string {
  if (esLiquidez(a)) return "€";
  const t = a.ticker?.trim().toUpperCase() ?? "";
  if (t && !t.startsWith("0P") && !/^[A-Z]{2}[A-Z0-9]{9}\d/.test(t)) {
    return t.split(/[.\-=]/)[0].slice(0, 4);
  }
  const palabras = a.name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (
    palabras
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "·"
  );
}

function Sigla({ a }: { a: Activo }) {
  const color = CAT_COLOR[catConocida(a.cat)] ?? CAT_COLOR.otro;
  const s = sigla(a);
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-disp font-bold tracking-tight"
      style={{
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        fontSize: s.length > 3 ? 8.5 : 10.5,
      }}
    >
      {s}
    </span>
  );
}

function Fila({
  p,
  metrica,
  total,
  onFicha,
}: {
  p: Posicion;
  metrica: "total" | "hoy";
  total: number;
  onFicha: (id: string) => void;
}) {
  const liquidez = esLiquidez(p.activo);
  const peso = total > 0 && p.valor != null ? (p.valor / total) * 100 : null;
  return (
    <li className="border-b border-line last:border-0">
      <button
        onClick={() => onFicha(p.activo.id)}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-bg2"
      >
        <Sigla a={p.activo} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-fg0">
            {p.activo.name}
          </span>
          <span className="block truncate text-[10.5px] text-fg2">
            {liquidez ? "saldo" : `${fn(p.qty, 4)} ${p.activo.unit}`}
            {peso != null && ` · ${fpc(peso)}`}
            {p.estado === "sin-precio" && " · sin precio"}
            {p.estado === "viejo" && " · precio antiguo"}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[13px] font-bold text-fg0">{fe(p.valor, 0)}</span>
          {!liquidez &&
            (metrica === "hoy" ? (
              <Cambio v={p.dia} pct={p.diaPct} className="text-[10.5px]" />
            ) : (
              <Cambio v={p.ganancia} pct={p.gananciaPct} className="text-[10.5px]" />
            ))}
        </span>
      </button>
    </li>
  );
}

// ── La ficha de una posición ─────────────────────────────────────────────
// Lo que getquin enseña al tocar un activo, sin salir de la app: cuánto
// vale, cuánto te costó, qué has hecho con él, y dónde verlo en grande.

function Ficha({
  p,
  total,
  onCerrar,
}: {
  p: Posicion | null;
  total: number;
  onCerrar: () => void;
}) {
  const { estado, mercado } = useDatos();
  const enlaces = useMemo(
    () => (p ? enlacesDe(p.activo, mercado.catalogo) : []),
    [p, mercado.catalogo],
  );
  const ops = useMemo(
    () =>
      p
        ? estado.operaciones
            .filter((o) => o.asset_id === p.activo.id)
            .sort((x, y) => y.date.localeCompare(x.date))
        : [],
    [p, estado.operaciones],
  );
  if (!p) return null;

  const a = p.activo;
  const liquidez = esLiquidez(a);
  const peso = total > 0 && p.valor != null ? (p.valor / total) * 100 : null;
  // Un precio de 0,0123 € con dos decimales se lee «0,01».
  const dec = (n: number | null) => (n != null && Math.abs(n) < 10 ? 4 : 2);
  const notaPrecio =
    p.estado === "sin-precio"
      ? "sin cotización"
      : p.estado === "viejo"
        ? "precio antiguo"
        : p.estado === "manual"
          ? "puesto a mano"
          : undefined;

  return (
    <Hoja abierta titulo={a.name} onCerrar={onCerrar}>
      <div className="flex items-center gap-3">
        <Sigla a={a} />
        <p className="min-w-0 text-[11.5px] text-fg2">
          {[CAT_LBL[catConocida(a.cat)] ?? a.cat, a.ticker, a.isin !== a.ticker ? a.isin : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <p className="mt-3 font-disp text-[28px] font-bold tracking-tight text-fg0">
        {fe(p.valor)}
      </p>
      {!liquidez && (
        <p className="text-[12px] text-fg2">
          <Cambio v={p.ganancia} pct={p.gananciaPct} className="text-[13px]" /> desde que la
          compraste
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {liquidez ? (
          <Dato t="Saldo" v={fe(p.valor)} />
        ) : (
          <Dato t="Títulos" v={`${fn(p.qty, 6)} ${a.unit}`} />
        )}
        <Dato t="Peso en la cartera" v={fpc(peso)} />
        {!liquidez && (
          <>
            <Dato t="Precio ahora" v={fe(p.precio, dec(p.precio))} nota={notaPrecio} />
            <Dato t="Coste medio" v={fe(p.costeUnit, dec(p.costeUnit))} />
            <Dato t="Invertido" v={fe(p.coste)} />
            <Dato t="Hoy" v={<Cambio v={p.dia} pct={p.diaPct} className="text-[14px]" />} />
          </>
        )}
      </dl>

      {enlaces.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {enlaces.map((e, i) => (
            <a
              key={e.url}
              href={e.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex-1 whitespace-nowrap rounded-field px-4 py-2.5 text-center text-[13px] font-bold transition-all ${
                i === 0
                  ? "bg-fg0 text-bg1 hover:opacity-90"
                  : "border border-line2 bg-bg1 text-fg0 hover:border-line3"
              }`}
            >
              {e.texto} ↗
            </a>
          ))}
        </div>
      )}

      {ops.length > 0 && (
        <div className="mt-5">
          <Etiqueta>Tus operaciones</Etiqueta>
          <ul className="mt-1.5">
            {ops.slice(0, 8).map((o) => (
              <li
                key={o.id}
                className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-[12px] last:border-0"
              >
                <span className="min-w-0 truncate text-fg1">
                  <span className="tabular-nums text-fg2">{fd(o.date)}</span> · {OP_LBL[o.type]}
                  {o.quantity ? ` · ${fn(Math.abs(o.quantity), 4)}` : ""}
                </span>
                <span className="shrink-0 font-semibold text-fg0">
                  {fe(Math.abs(o.total_eur ?? o.total))}
                </span>
              </li>
            ))}
          </ul>
          {ops.length > 8 && (
            <p className="mt-1 text-[11px] text-fg3">Y {ops.length - 8} más en Historial.</p>
          )}
        </div>
      )}

      <Link to="/historial" className="mt-4 block text-[12px] font-semibold text-blue">
        Editar o borrar en Historial ›
      </Link>
    </Hoja>
  );
}

function Dato({ t, v, nota }: { t: string; v: ReactNode; nota?: string }) {
  return (
    <div>
      <dt className="lbl">{t}</dt>
      <dd className="mt-0.5 text-[14px] font-bold text-fg0">
        {v}
        {nota && <span className="block text-[10.5px] font-normal text-fg3">{nota}</span>}
      </dd>
    </div>
  );
}
