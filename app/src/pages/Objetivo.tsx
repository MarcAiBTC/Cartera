// ── OBJETIVO ─────────────────────────────────────────────────────────────
// Dos preguntas, en este orden: «¿me he desviado de lo que quería?» y, la que
// de verdad se hace uno todos los meses, «¿dónde meto los próximos 500 €?».
//
// El reparto no es una regla de tres sobre los pesos: se calcula cuánto le
// falta a cada bloque para llegar a su objetivo CONTANDO ya la aportación, y
// se reparte el dinero entre los que van por detrás. Así una sola aportación
// corrige la desviación en vez de agrandarla.

import { useMemo, useState } from "react";
import { useDatos } from "../lib/datos";
import { CAT_COLOR, CAT_LBL, SERIE_COLOR, type Objetivo as ObjetivoFila } from "../lib/tipos";
import { porSubyacente } from "../lib/cartera";
import { fe, fpc } from "../lib/formato";
import {
  Aviso,
  Boton,
  Campo,
  Etiqueta,
  Segmentos,
  Tarjeta,
  TituloSeccion,
  Vacio,
} from "../components/base";
import { BarraObjetivo } from "../components/graficos";

export default function Objetivo() {
  const { categorias, posiciones, resumen, estado, insertar, actualizar, guardarAjustes } =
    useDatos();
  const [base, setBase] = useState<"total" | "inv">(estado.ajustes.tg_base);
  const [aporte, setAporte] = useState(String(estado.ajustes.tg_aporte ?? 500));

  // Por subyacente por defecto: es como se piensa de verdad una cartera —
  // «quiero un 45% en el S&P 500»— y no «un 45% en fondos», que puede
  // significar cosas muy distintas. La vista por categoría sigue estando
  // para quien reparta así.
  const [agrupar, setAgrupar] = useState<"subyacente" | "categoria">("subyacente");

  const grupos = useMemo(() => {
    if (agrupar === "categoria") {
      return base === "total" ? categorias : categorias.filter((g) => g.clave !== "liquidez");
    }
    return porSubyacente(posiciones, base === "total");
  }, [agrupar, base, categorias, posiciones]);

  const total = useMemo(() => grupos.reduce((s, g) => s + g.valor, 0), [grupos]);

  const objetivos = useMemo(() => {
    const m = new Map<string, ObjetivoFila>();
    for (const o of estado.objetivos) m.set(o.key, o);
    return m;
  }, [estado.objetivos]);

  const filas = useMemo(
    () =>
      grupos.map((g) => {
        const o = objetivos.get(g.clave);
        const objetivo = o?.weight ?? 0;
        const actual = total > 0 ? (g.valor / total) * 100 : 0;
        return { ...g, objetivo, actual, desvio: actual - objetivo, excluido: o?.excluded ?? false };
      }),
    [grupos, objetivos, total],
  );

  const sumaObjetivos = filas.reduce((s, f) => s + f.objetivo, 0);

  // ── El reparto ────────────────────────────────────────────────────────
  const importe = Math.max(0, parseFloat(aporte.replace(",", ".")) || 0);
  const reparto = useMemo(() => {
    if (importe <= 0 || sumaObjetivos <= 0) return [];
    const futuro = total + importe;
    const faltas = filas
      .filter((f) => !f.excluido)
      .map((f) => ({ ...f, falta: Math.max(0, (f.objetivo / 100) * futuro - f.valor) }));
    const sumaFaltas = faltas.reduce((s, f) => s + f.falta, 0);
    if (sumaFaltas <= 0) return [];
    return faltas
      .filter((f) => f.falta > 0)
      .map((f) => ({ ...f, euros: (f.falta / sumaFaltas) * importe }))
      .sort((a, b) => b.euros - a.euros);
  }, [filas, importe, total, sumaObjetivos]);

  // Cada categoría tiene su color fijo; los subyacentes van tomando el orden
  // de serie, que está verificado par a par para daltonismo.
  const color = (clave: string, i: number) =>
    agrupar === "categoria"
      ? (CAT_COLOR[clave] ?? CAT_COLOR.otro)
      : (SERIE_COLOR[i] ?? CAT_COLOR.otro);

  async function fijar(clave: string, peso: number) {
    const existente = estado.objetivos.find((o) => o.key === clave);
    if (existente) await actualizar<ObjetivoFila>("targets", existente.id, { weight: peso });
    else await insertar<ObjetivoFila>("targets", [{ key: clave, weight: peso }]);
  }

  if (categorias.length === 0) {
    return <Vacio titulo="Sin cartera que repartir" texto="Añade posiciones y vuelve por aquí." />;
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <Etiqueta>Objetivo</Etiqueta>
        <h1 className="hero-num mt-1 text-[2.1rem] text-fg0">Dónde va el próximo dinero.</h1>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <Segmentos
          valor={agrupar}
          onChange={setAgrupar}
          opciones={[
            {
              valor: "subyacente",
              texto: "Por subyacente",
              titulo: "Dos productos sobre el mismo índice cuentan como uno.",
            },
            { valor: "categoria", texto: "Por clase", titulo: "Fondos, acciones, metales…" },
          ]}
        />
        <Segmentos
          valor={base}
          onChange={(v) => {
            setBase(v);
            void guardarAjustes({ tg_base: v });
          }}
          opciones={[
            { valor: "total", texto: "Con efectivo", titulo: "Los pesos incluyen el efectivo." },
            {
              valor: "inv",
              texto: "Sin efectivo",
              titulo: "El efectivo se queda fuera del reparto.",
            },
          ]}
        />
      </div>

      <Tarjeta>
        <TituloSeccion
          nota={
            sumaObjetivos === 0
              ? "Todavía no has fijado ningún objetivo: escribe el peso que quieres para cada bloque."
              : `Los objetivos suman ${fpc(sumaObjetivos)}.`
          }
        >
          Lo que hay y lo que querías
        </TituloSeccion>

        <ul className="flex flex-col gap-3">
          {filas.map((f) => (
            <li key={f.clave}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-[12.5px] font-semibold text-fg0">
                  {CAT_LBL[f.clave] ?? f.clave}
                </span>
                <span className="flex shrink-0 items-baseline gap-2 text-[12px]">
                  <span className="font-bold text-fg0">{fpc(f.actual)}</span>
                  <span className="text-fg3">de</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={f.objetivo || ""}
                    placeholder="0"
                    onChange={(e) => void fijar(f.clave, Number(e.target.value) || 0)}
                    className="w-[52px] rounded-[8px] border border-line2 bg-bg1 px-1.5 py-0.5 text-right text-[12px] font-bold text-fg1 outline-none focus:border-blue"
                  />
                  <span className="text-fg3">%</span>
                </span>
              </div>
              <BarraObjetivo
                actual={f.actual}
                objetivo={f.objetivo}
                color={color(f.clave, filas.indexOf(f))}
              />
              <p className="mt-1 text-[11px] text-fg2">
                {f.objetivo === 0
                  ? fe(f.valor, 0)
                  : Math.abs(f.desvio) < 0.5
                    ? `${fe(f.valor, 0)} · en su sitio`
                    : f.desvio > 0
                      ? `${fe(f.valor, 0)} · te sobran ${fe((f.desvio / 100) * total, 0)}`
                      : `${fe(f.valor, 0)} · te faltan ${fe((-f.desvio / 100) * total, 0)}`}
              </p>
            </li>
          ))}
        </ul>
      </Tarjeta>

      <Tarjeta>
        <TituloSeccion nota="Se reparte entre los bloques que van por detrás, no a partes iguales.">
          El reparto de la próxima aportación
        </TituloSeccion>

        <Campo
          etiqueta="Cuánto vas a meter"
          tipo="number"
          paso="any"
          valor={aporte}
          onChange={setAporte}
          sufijo="€"
        />

        <div className="mt-3">
          {sumaObjetivos === 0 ? (
            <Aviso>Fija primero los pesos que quieres arriba y aquí saldrá el reparto.</Aviso>
          ) : reparto.length === 0 ? (
            <Aviso>
              Con esa cantidad no hace falta corregir nada: todos los bloques ya están en su peso o
              por encima. Mete el dinero donde quieras, o súbelo hasta que aparezca un reparto.
            </Aviso>
          ) : (
            <ul className="flex flex-col gap-2">
              {reparto.map((r) => (
                <li key={r.clave} className="flex items-center gap-3">
                  <span
                    className="h-7 w-1 shrink-0 rounded-full"
                    style={{ background: color(r.clave, reparto.indexOf(r)) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-fg0">
                      {CAT_LBL[r.clave] ?? r.clave}
                    </span>
                    <span className="text-[11px] text-fg2">
                      {fpc(r.actual)} → {fpc(r.objetivo)}
                    </span>
                  </span>
                  <span className="shrink-0 font-disp text-[16px] font-bold text-fg0">
                    {fe(r.euros, 0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <Boton
            tipo="suave"
            className="w-full"
            onClick={() => void guardarAjustes({ tg_aporte: importe })}
          >
            Recordar {fe(importe, 0)} como aportación habitual
          </Boton>
        </div>
      </Tarjeta>

      <p className="text-center text-[11px] text-fg2">
        Patrimonio considerado: {fe(total, 0)} · efectivo{" "}
        {base === "total" ? "incluido" : "excluido"} ({fe(resumen.liquidez, 0)})
      </p>
    </div>
  );
}
