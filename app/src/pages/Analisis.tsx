// ── ANÁLISIS ─────────────────────────────────────────────────────────────
// Cinco bloques y cada uno contesta UNA pregunta concreta, en el orden en que
// uno se las hace:
//
//   1. ¿Cuánto he ganado de verdad?
//   2. ¿Cómo ha ido creciendo frente a lo que puse?
//   3. ¿Cuánto tengo de cada cosa?           (no de cada producto)
//   4. ¿Qué la mueve hoy?
//   5. ¿Lo habría hecho mejor comprando el índice?

import { useEffect, useMemo, useState } from "react";
import { useDatos } from "../lib/datos";
import { CAT_COLOR, SERIE_COLOR } from "../lib/tipos";
import { movimientoDelDia, porSubyacente } from "../lib/cartera";
import { cargarBenchmark, pedirHistorico } from "../lib/precios";
import {
  evolucion,
  frenteAlIndice,
  type Historico,
  type PuntoEvolucion,
  type SerieEur,
} from "../lib/evolucion";
import { fd, fdl, fe, fp, fpc, hoyISO } from "../lib/formato";
import {
  Etiqueta,
  Pastilla,
  Segmentos,
  Tarjeta,
  TituloSeccion,
  Vacio,
} from "../components/base";
import { Comparativa, Serie, Tarta } from "../components/graficos";

export default function Analisis() {
  const { resumen, posiciones, estado, mercado } = useDatos();
  const [conLiquidez, setConLiquidez] = useState<"todo" | "mercado">("todo");
  /** `undefined` mientras se pide; `null` sin cuenta o sin servidor. */
  const [historico, setHistorico] = useState<Historico | null | undefined>(undefined);

  const subyacentes = useMemo(
    () => porSubyacente(posiciones, conLiquidez === "todo", mercado.catalogo),
    [posiciones, conLiquidez, mercado.catalogo],
  );

  // Qué activos hay. Si cambian —una importación—, la historia se vuelve a
  // pedir; si no, vale la del día.
  const firma = useMemo(
    () =>
      estado.activos
        .map((a) => a.ticker ?? a.isin ?? a.id)
        .sort()
        .join(","),
    [estado.activos],
  );
  useEffect(() => {
    let vivo = true;
    void pedirHistorico(firma).then((h) => {
      if (vivo) setHistorico(h);
    });
    return () => {
      vivo = false;
    };
  }, [firma]);

  const puntos = useMemo(
    () =>
      evolucion(estado, historico ?? null, {
        fecha: hoyISO(),
        valor: resumen.valor,
        aportado: resumen.aportado,
      }),
    [estado, historico, resumen.valor, resumen.aportado],
  );
  const serie = useMemo(
    () => puntos.map((p) => ({ fecha: fd(p.fecha), valor: p.valor, base: p.aportado })),
    [puntos],
  );
  // La comparación con el índice empieza aquí, no en el primer ingreso.
  const primeraCompra = useMemo(
    () =>
      estado.operaciones.reduce<string | undefined>(
        (m, o) => (o.type === "buy" && (m == null || o.date < m) ? o.date : m),
        undefined,
      ),
    [estado.operaciones],
  );

  const movers = movimientoDelDia(posiciones);

  if (estado.activos.length === 0) {
    return <Vacio titulo="Sin datos que analizar" texto="Añade posiciones y vuelve por aquí." />;
  }

  const notaSerie =
    historico === undefined
      ? "Calculando con los precios de cada semana…"
      : historico === null
        ? "Sin conexión con el servidor de precios: cada activo se valora al precio de su última operación."
        : `Semana a semana desde tu primera operación${
            puntos[0] ? `, el ${fdl(puntos[0].fecha)}` : ""
          }, con el precio de cada semana. El hueco entre las dos líneas es la ganancia.`;

  return (
    <div className="flex flex-col gap-5">
      {/* 1 · ¿Cuánto he ganado de verdad? */}
      <section>
        <Etiqueta>Ganancia total desde que empezaste</Etiqueta>
        <h1
          className={`hero-num mt-1 ${resumen.ganancia >= 0 ? "text-up" : "text-dn"}`}
        >
          {resumen.ganancia >= 0 ? "+" : ""}
          {fe(resumen.ganancia, 0)}
        </h1>
        <p className="mt-2 text-[13px] text-fg2">
          sobre {fe(resumen.aportado, 0)} aportados ·{" "}
          <strong className={resumen.ganancia >= 0 ? "text-up" : "text-dn"}>
            {fp(resumen.gananciaPct)}
          </strong>
        </p>
      </section>

      <Tarjeta>
        <TituloSeccion nota="La ganancia no es sólo lo que llevas encima: también cuenta lo que ya vendiste y lo que te han pagado.">
          De dónde sale
        </TituloSeccion>
        <ul className="flex flex-col gap-2">
          <Trozo t="Sin vender todavía" v={resumen.latente} />
          <Trozo t="Ventas ya cerradas" v={resumen.realizado} />
          <Trozo t="Dividendos e intereses" v={resumen.cobrado} />
        </ul>
      </Tarjeta>

      {/* 2 · ¿Cómo ha crecido? */}
      <Tarjeta>
        <TituloSeccion nota={notaSerie}>Patrimonio y dinero aportado</TituloSeccion>
        <Serie puntos={serie} />
      </Tarjeta>

      {/* 3 · ¿Cuánto tengo de cada COSA? */}
      <Tarjeta>
        <TituloSeccion
          nota="Dos productos sobre el mismo índice son la misma apuesta: aquí se suman."
          extra={
            <Segmentos
              valor={conLiquidez}
              onChange={setConLiquidez}
              opciones={[
                { valor: "todo", texto: "Todo" },
                { valor: "mercado", texto: "Sin efectivo" },
              ]}
            />
          }
        >
          Cuánto tienes de cada cosa
        </TituloSeccion>
        <Tarta
          titulo={fe(
            subyacentes.reduce((s, g) => s + g.valor, 0),
            0,
          )}
          total={subyacentes.reduce((s, g) => s + g.valor, 0)}
          porciones={subyacentes.slice(0, 6).map((g, i) => ({
            clave: g.clave,
            etiqueta: g.etiqueta,
            valor: g.valor,
            color: SERIE_COLOR[i] ?? CAT_COLOR.otro,
            detalle: fe(g.valor, 0),
          }))}
        />
        {subyacentes.length > 6 && (
          <p className="mt-3 text-[11px] text-fg2">
            Y {subyacentes.length - 6} más, por debajo del{" "}
            {fpc(subyacentes[6]?.peso ?? 0)} cada uno.
          </p>
        )}
      </Tarjeta>

      {/* 4 · ¿Qué la mueve hoy? */}
      <Tarjeta>
        <TituloSeccion nota="Ordenado por euros: lo que de verdad mueve la aguja.">
          Qué la mueve hoy
        </TituloSeccion>
        {movers.length === 0 ? (
          <p className="text-[12px] text-fg2">
            Hoy no se ha movido nada, o todavía no hay cierre anterior fiable con el que comparar.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {movers.slice(0, 8).map((p) => (
              <li key={p.activo.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg0">
                  {p.activo.name}
                </span>
                <Pastilla pct={p.diaPct} />
                <span
                  className={`w-[74px] shrink-0 text-right text-[12.5px] font-bold ${
                    (p.dia ?? 0) >= 0 ? "text-up" : "text-dn"
                  }`}
                >
                  {(p.dia ?? 0) >= 0 ? "+" : ""}
                  {fe(p.dia, Math.abs(p.dia ?? 0) < 10 ? 2 : 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      {/* 5 · Contra el índice */}
      <ContraElIndice
        puntos={puntos}
        historico={historico}
        primeraCompra={primeraCompra}
        sobreAportado={resumen.gananciaPct}
      />
    </div>
  );
}

function Trozo({ t, v }: { t: string; v: number }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="text-[12.5px] text-fg1">{t}</span>
      <span className={`text-[13px] font-bold ${v >= 0 ? "text-up" : "text-dn"}`}>
        {v >= 0 ? "+" : ""}
        {fe(v, 0)}
      </span>
    </li>
  );
}

// ── Contra el S&P 500 ─────────────────────────────────────────────────────
// La pregunta es una: desde mi primera compra hasta hoy, ¿cuánto ha rentado
// mi cartera y cuánto el S&P 500? Las dos se miden igual —por tiempo, como un
// fondo o como getquin—, y se dibujan juntas semana a semana.
//
// Por tiempo y no «ganancia entre aportado»: al lado del índice esa cifra no
// vale, porque el euro metido la semana pasada no ha tenido tiempo de rendir
// nada y la hunde. Y debajo, en euros, la otra pregunta: ¿cuánto tendría si
// cada euro que puse hubiera ido al índice el mismo día?

function ContraElIndice({
  puntos,
  historico,
  primeraCompra,
  sobreAportado,
}: {
  puntos: PuntoEvolucion[];
  historico: Historico | null | undefined;
  primeraCompra: string | undefined;
  sobreAportado: number | null;
}) {
  const [respaldo, setRespaldo] = useState<SerieEur | null>(null);
  // La serie del servidor viene fresca y desde la primera operación; si no
  // la hay, la de la tabla y el feed.
  const propia = historico?.sp500?.length ? historico.sp500 : null;

  useEffect(() => {
    if (propia || historico === undefined) return;
    let vivo = true;
    void cargarBenchmark().then((d) => {
      if (vivo) setRespaldo(d.map((p) => [p.date, p.value]));
    });
    return () => {
      vivo = false;
    };
  }, [propia, historico]);

  const sp = propia ?? respaldo;
  const c = useMemo(
    () => (sp ? frenteAlIndice(puntos, sp, primeraCompra) : null),
    [sp, puntos, primeraCompra],
  );
  const curva = useMemo(
    () => c?.curva.map((p) => ({ fecha: p.fecha, a: p.tuyo, b: p.indice })) ?? [],
    [c],
  );
  const dif = c?.tuyoPct != null ? c.tuyoPct - c.indicePct : null;
  // La serie del servidor es un ETF que reinvierte los dividendos; la de
  // respaldo, el índice de precio. Se dice cuál es: son seis puntos en tres
  // años.
  const esEtf = propia != null && historico?.indice != null;
  // Sin la historia de precios cada activo vale lo de su última operación
  // todas las semanas: la curva sale plana y salta hoy, y su «rentabilidad»
  // no quiere decir nada. Entonces sólo se enseña lo que sí se sabe.
  const sinHistoria = historico === null;

  return (
    <Tarjeta>
      <TituloSeccion
        nota={
          esEtf
            ? "El S&P 500 es un ETF en euros que reinvierte los dividendos (SXR8): lo que de verdad podías haber comprado, con su comisión."
            : "El S&P 500 en euros, sin contar sus dividendos."
        }
      >
        Contra el S&amp;P 500
      </TituloSeccion>

      {!sp ? (
        <p className="text-[12px] text-fg2">Cargando el índice…</p>
      ) : !c ? (
        <p className="text-[12px] text-fg2">
          Para comparar hace falta al menos una compra con fecha.
        </p>
      ) : (
        <>
          <p className="text-[12.5px] text-fg1">
            Desde tu primera compra, el <strong>{fdl(c.desde)}</strong>, hasta hoy:
          </p>
          {sinHistoria ? (
            <p className="mt-2 text-[12.5px] leading-relaxed text-fg1">
              el S&amp;P 500 ha hecho <strong>{fp(c.indicePct)}</strong>. Tu rentabilidad semana a
              semana necesita la historia de precios de tus activos, y ésa sólo llega entrando con
              tu cuenta.
            </p>
          ) : (
          <>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <Etiqueta>Tu cartera</Etiqueta>
              <p
                className={`font-disp text-[22px] font-bold ${
                  dif == null ? "text-fg1" : dif >= 0 ? "text-up" : "text-dn"
                }`}
              >
                {fp(c.tuyoPct)}
              </p>
            </div>
            <div>
              <Etiqueta>S&amp;P 500</Etiqueta>
              <p className="font-disp text-[22px] font-bold text-fg1">{fp(c.indicePct)}</p>
            </div>
          </div>
          {dif != null && (
            <p className="mt-1 text-[12px] text-fg2">
              {Math.abs(dif) < 0.5
                ? "Prácticamente lo mismo que el índice."
                : `${Math.abs(dif).toFixed(1).replace(".", ",")} puntos ${
                    dif > 0 ? "por delante" : "por detrás"
                  } del índice.`}
            </p>
          )}

          <div className="mt-3">
            <Comparativa puntos={curva} nombreA="Tu cartera" nombreB="S&P 500" />
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-fg2">
            Las dos miden cuánto ha rendido cada euro mientras estaba invertido, sin que cuente
            cuándo lo metiste: así se mide un fondo, y así compara getquin con un índice.
            {sobreAportado != null &&
              ` No es la ganancia sobre lo aportado (${fp(sobreAportado)}, arriba del todo): esa baja cuando entra dinero nuevo que aún no ha tenido tiempo de rendir.`}
          </p>
          </>
          )}

          {c.indice != null && c.diferencia != null && (
            <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-fg1">
              En euros: si cada euro que has puesto —{fe(c.aportado, 0)} en total— hubiera ido al
              S&amp;P 500 el día que lo pusiste, hoy tendrías <strong>{fe(c.indice, 0)}</strong>.
              Tienes{" "}
              <strong className={c.diferencia >= 0 ? "text-up" : "text-dn"}>
                {fe(c.tuyo, 0)}
              </strong>
              : {fe(Math.abs(c.diferencia), 0)} {c.diferencia >= 0 ? "más" : "menos"}.
            </p>
          )}

          <p className="mt-2 text-[11px] text-fg3">
            {c.desdeIndice !== c.desde
              ? `La serie del índice empieza el ${fd(c.desdeIndice)}: antes no hay con qué comparar. `
              : ""}
            Último dato del índice: {fd(c.hasta)}.
          </p>
        </>
      )}
    </Tarjeta>
  );
}
