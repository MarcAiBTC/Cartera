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
import { contraIndice, movimientoDelDia, porSubyacente } from "../lib/cartera";
import { cargarBenchmark, type PuntoBenchmark } from "../lib/precios";
import { fd, fe, fp, fpc } from "../lib/formato";
import {
  Etiqueta,
  Pastilla,
  Segmentos,
  Tarjeta,
  TituloSeccion,
  Vacio,
} from "../components/base";
import { Serie, Tarta } from "../components/graficos";

export default function Analisis() {
  const { resumen, posiciones, estado } = useDatos();
  const [conLiquidez, setConLiquidez] = useState<"todo" | "mercado">("todo");

  const subyacentes = useMemo(
    () => porSubyacente(posiciones, conLiquidez === "todo"),
    [posiciones, conLiquidez],
  );

  const serie = useMemo(
    () =>
      [...estado.snapshots]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((s) => ({
          fecha: fd(s.date),
          valor: s.val,
          // El aportado guardado ya viene corregido; si falta, se deja el
          // coste, que es lo más cercano.
          base: s.cost,
        })),
    [estado.snapshots],
  );

  const movers = movimientoDelDia(posiciones);

  if (estado.activos.length === 0) {
    return <Vacio titulo="Sin datos que analizar" texto="Añade posiciones y vuelve por aquí." />;
  }

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
        <TituloSeccion nota="La línea de puntos es tu dinero; el hueco hasta la línea azul, la ganancia.">
          Patrimonio y dinero aportado
        </TituloSeccion>
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
                  {fe(p.dia, 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      {/* 5 · Contra el índice */}
      <ContraElIndice />
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

function ContraElIndice() {
  const { estado, resumen } = useDatos();
  const [indice, setIndice] = useState<PuntoBenchmark[] | null>(null);

  useEffect(() => {
    let vivo = true;
    void cargarBenchmark().then((d) => {
      if (vivo) setIndice(d);
    });
    return () => {
      vivo = false;
    };
  }, []);

  // Antes esto arrancaba en la primera FOTO guardada de la cartera, que es la
  // primera vez que abriste la app — no el dia que empezaste a invertir. En
  // una cuenta recien importada no hay ninguna foto, asi que la tarjeta ni
  // aparecia teniendo dos anos de operaciones dentro. Ahora arranca en tu
  // primer movimiento de dinero y replica tus aportaciones sobre el indice.
  const c = useMemo(
    () => (indice ? contraIndice(estado.operaciones, indice, resumen.valor) : null),
    [indice, estado.operaciones, resumen.valor],
  );

  if (indice == null) return null;

  return (
    <Tarjeta>
      <TituloSeccion nota="Cada aportacion tuya compra indice al precio de SU dia: es la unica forma de comparar cuando se aporta a plazos. En euros, porque comparar una cartera en euros con un indice en dolares mide sobre todo el dolar.">
        Contra el S&amp;P 500
      </TituloSeccion>

      {!c ? (
        <p className="text-[12px] text-fg2">
          Para comparar hacen falta ingresos con fecha. Importa un extracto que los traiga o
          apuntalos en Historial.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta>Tu cartera</Etiqueta>
              <p className={`font-disp text-[22px] font-bold ${c.tuyo >= c.indice ? "text-up" : "text-dn"}`}>
                {fe(c.tuyo)}
              </p>
              <p className="text-[11.5px] text-fg2">{c.tuyoPct == null ? "" : fp(c.tuyoPct)}</p>
            </div>
            <div>
              <Etiqueta>Si hubieras comprado el indice</Etiqueta>
              <p className="font-disp text-[22px] font-bold text-fg1">{fe(c.indice)}</p>
              <p className="text-[11.5px] text-fg2">{c.indicePct == null ? "" : fp(c.indicePct)}</p>
            </div>
          </div>

          <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-fg1">
            Desde el {fd(c.desde)} has puesto <strong>{fe(c.aportadoNeto)}</strong>.{" "}
            {c.diferencia >= 0 ? (
              <>
                Hoy tienes <strong className="text-up">{fe(c.diferencia)}</strong> mas de lo que
                tendrias comprando el indice con ese mismo dinero y en esas mismas fechas.
              </>
            ) : (
              <>
                Hoy tienes <strong className="text-dn">{fe(Math.abs(c.diferencia))}</strong> menos
                de lo que tendrias comprando el indice con ese mismo dinero y en esas mismas
                fechas. Comprarlo y olvidarte habria salido mejor.
              </>
            )}
          </p>
        </>
      )}
    </Tarjeta>
  );
}
