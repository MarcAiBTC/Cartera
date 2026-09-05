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

  const comparacion = useMemo(() => {
    if (!indice || indice.length < 2) return null;
    const snaps = [...estado.snapshots].sort((a, b) => a.date.localeCompare(b.date));
    if (snaps.length < 2) return null;

    const desde = snaps[0].date;
    // El índice del día de arranque, o el primero posterior si ese día no
    // cotizó.
    const iDesde = indice.find((p) => p.date >= desde);
    const iHasta = indice[indice.length - 1];
    if (!iDesde || !iHasta || iDesde.value <= 0) return null;

    const indicePct = ((iHasta.value - iDesde.value) / iDesde.value) * 100;
    // La cartera se mide sobre lo aportado, no sobre el coste: si no, cada
    // aportación nueva contaría como si hubiera perdido dinero.
    const carteraPct = resumen.gananciaPct;
    if (carteraPct == null) return null;

    return { desde, indicePct, carteraPct, diferencia: carteraPct - indicePct };
  }, [indice, estado.snapshots, resumen.gananciaPct]);

  if (indice == null) return null;

  return (
    <Tarjeta>
      <TituloSeccion nota="El índice, en euros: comparar una cartera en euros con uno en dólares mide sobre todo el dólar.">
        Contra el S&amp;P 500
      </TituloSeccion>

      {!comparacion ? (
        <p className="text-[12px] text-fg2">
          Hacen falta al menos dos días guardados de tu cartera para poder comparar. Se guardan
          solos según vayas usando la app.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta>Tu cartera</Etiqueta>
              <p
                className={`font-disp text-[22px] font-bold ${
                  comparacion.carteraPct >= 0 ? "text-up" : "text-dn"
                }`}
              >
                {fp(comparacion.carteraPct)}
              </p>
            </div>
            <div>
              <Etiqueta>S&amp;P 500</Etiqueta>
              <p className="font-disp text-[22px] font-bold text-fg1">
                {fp(comparacion.indicePct)}
              </p>
            </div>
          </div>
          <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-fg1">
            {comparacion.diferencia >= 0 ? (
              <>
                Vas <strong className="text-up">{fp(comparacion.diferencia)}</strong> por delante
                del índice desde {fd(comparacion.desde)}.
              </>
            ) : (
              <>
                Vas <strong className="text-dn">{fp(comparacion.diferencia)}</strong> por detrás
                del índice desde {fd(comparacion.desde)}. Comprarlo y olvidarte habría salido
                mejor.
              </>
            )}
          </p>
        </>
      )}
    </Tarjeta>
  );
}
