// ── CASHFLOW ─────────────────────────────────────────────────────────────
// De arriba abajo: cuánto te sobra cada mes, en qué se reparte y en qué se
// convierte con el tiempo. El detalle mes a mes va al final, plegado: es lo
// que menos se mira y lo que más sitio ocupa.

import { useMemo, useState } from "react";
import { useDatos } from "../lib/datos";
import { fe, fpc } from "../lib/formato";
import { Aviso, Boton, Campo, Etiqueta, Tarjeta, TituloSeccion } from "../components/base";
import { Tira } from "../components/graficos";

interface MesSuelto {
  mes: string;
  ingresos: number;
  gastos: number;
}

interface DatosCashflow {
  ingresos: number;
  gastos: number;
  pctInvertir: number;
  pctLiquidez: number;
  pctReserva: number;
  horizonte: number;
  rentabilidad: number;
  meses: MesSuelto[];
}

const POR_DEFECTO: DatosCashflow = {
  ingresos: 0,
  gastos: 0,
  pctInvertir: 60,
  pctLiquidez: 20,
  pctReserva: 20,
  horizonte: 10,
  rentabilidad: 6,
  meses: [],
};

const COLORES = ["#3653cc", "#0e9e8c", "#d97706"];

export default function Cashflow() {
  const { estado, guardarCashflow } = useDatos();
  const guardado = { ...POR_DEFECTO, ...(estado.cashflow as Partial<DatosCashflow>) };
  const [d, setD] = useState<DatosCashflow>(guardado);
  const [verMeses, setVerMeses] = useState(false);
  const [sucio, setSucio] = useState(false);

  const cambiar = (parte: Partial<DatosCashflow>) => {
    setD({ ...d, ...parte });
    setSucio(true);
  };

  const n = (s: string) => Math.max(0, parseFloat(s.replace(",", ".")) || 0);
  const sobra = d.ingresos - d.gastos;
  const sumaPct = d.pctInvertir + d.pctLiquidez + d.pctReserva;

  const reparto = useMemo(() => {
    const base = Math.max(0, sobra);
    return [
      { clave: "invertir", etiqueta: "A invertir", pct: d.pctInvertir },
      { clave: "liquidez", etiqueta: "A liquidez", pct: d.pctLiquidez },
      { clave: "reserva", etiqueta: "A la reserva", pct: d.pctReserva },
    ].map((r, i) => ({
      ...r,
      valor: sumaPct > 0 ? (base * r.pct) / sumaPct : 0,
      color: COLORES[i],
    }));
  }, [sobra, d.pctInvertir, d.pctLiquidez, d.pctReserva, sumaPct]);

  const aInvertir = reparto[0].valor;

  // Valor futuro de una aportación mensual constante, con interés compuesto
  // mensual. Es la fórmula de siempre; lo único que se añade es no dividir
  // entre cero cuando la rentabilidad es 0.
  const proyeccion = useMemo(() => {
    const meses = Math.round(d.horizonte * 12);
    const i = d.rentabilidad / 100 / 12;
    const aportado = aInvertir * meses;
    const valor = i === 0 ? aportado : aInvertir * ((Math.pow(1 + i, meses) - 1) / i);
    return { aportado, valor, ganancia: valor - aportado, meses };
  }, [aInvertir, d.horizonte, d.rentabilidad]);

  const mediaMeses = useMemo(() => {
    if (d.meses.length === 0) return null;
    const s = d.meses.reduce((a, m) => a + (m.ingresos - m.gastos), 0);
    return s / d.meses.length;
  }, [d.meses]);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <Etiqueta>Cada mes</Etiqueta>
        <h1 className="hero-num mt-1 text-fg0">{fe(sobra, 0)}</h1>
        <p className="mt-2 text-[13px] text-fg2">
          es lo que te sobra en un mes normal
          {mediaMeses != null && ` · media real de tus meses apuntados: ${fe(mediaMeses, 0)}`}
        </p>
      </section>

      <Tarjeta>
        <TituloSeccion>Un mes normal</TituloSeccion>
        <div className="grid grid-cols-2 gap-2">
          <Campo
            etiqueta="Ingresos"
            tipo="number"
            paso="any"
            valor={String(d.ingresos || "")}
            onChange={(v) => cambiar({ ingresos: n(v) })}
            sufijo="€"
          />
          <Campo
            etiqueta="Gastos"
            tipo="number"
            paso="any"
            valor={String(d.gastos || "")}
            onChange={(v) => cambiar({ gastos: n(v) })}
            sufijo="€"
          />
        </div>
      </Tarjeta>

      <Tarjeta>
        <TituloSeccion nota="Los porcentajes se normalizan solos: no hace falta que sumen exactamente 100.">
          En qué se reparte
        </TituloSeccion>

        <Tira total={Math.max(sobra, 1)} porciones={reparto} />

        <div className="mt-3 flex flex-col gap-3">
          {reparto.map((r, i) => (
            <div key={r.clave}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 text-[12.5px] font-semibold text-fg0">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: r.color }} />
                  {r.etiqueta}
                </span>
                <span className="text-[13px] font-bold text-fg0">{fe(r.valor, 0)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={r.pct}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  cambiar(
                    i === 0
                      ? { pctInvertir: v }
                      : i === 1
                        ? { pctLiquidez: v }
                        : { pctReserva: v },
                  );
                }}
                className="w-full accent-[color:var(--blue)]"
              />
              <span className="text-[11px] text-fg2">{fpc(sumaPct > 0 ? (r.pct / sumaPct) * 100 : 0)}</span>
            </div>
          ))}
        </div>
      </Tarjeta>

      <Tarjeta>
        <TituloSeccion nota="Sólo lo que va a inversión, sin contar lo que ya tienes en cartera.">
          En qué se convierte
        </TituloSeccion>

        <div className="grid grid-cols-2 gap-2">
          <Campo
            etiqueta="Durante"
            tipo="number"
            valor={String(d.horizonte)}
            onChange={(v) => cambiar({ horizonte: n(v) })}
            sufijo="años"
          />
          <Campo
            etiqueta="Al"
            tipo="number"
            paso="any"
            valor={String(d.rentabilidad)}
            onChange={(v) => cambiar({ rentabilidad: n(v) })}
            sufijo="% anual"
          />
        </div>

        <div className="mt-4 rounded-tile bg-bg2 p-4 text-center">
          <Etiqueta>Dentro de {d.horizonte} años</Etiqueta>
          <p className="font-disp text-[30px] font-bold tracking-tight text-fg0">
            {fe(proyeccion.valor, 0)}
          </p>
          <p className="mt-1 text-[12px] text-fg2">
            {fe(proyeccion.aportado, 0)} tuyos ·{" "}
            <span className="font-bold text-up">+{fe(proyeccion.ganancia, 0)}</span> de intereses
          </p>
        </div>

        <Aviso tono="info">
          Una proyección no es una promesa: supone que metes {fe(aInvertir, 0)} todos los meses,
          sin fallar uno, y que el mercado da un {fpc(d.rentabilidad)} constante. No lo hace.
        </Aviso>
      </Tarjeta>

      <section>
        <button
          onClick={() => setVerMeses(!verMeses)}
          className="text-[12px] font-semibold text-fg2 underline-offset-4 hover:text-fg0 hover:underline"
        >
          {verMeses ? "Ocultar" : "Ver"} el detalle mes a mes ({d.meses.length})
        </button>

        {verMeses && (
          <div className="mt-3 flex flex-col gap-2">
            {d.meses.map((m, i) => (
              <div key={i} className="tile grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2">
                <input
                  type="month"
                  value={m.mes}
                  onChange={(e) => {
                    const meses = [...d.meses];
                    meses[i] = { ...m, mes: e.target.value };
                    cambiar({ meses });
                  }}
                  className="rounded-[8px] border border-line2 bg-bg1 px-2 py-1 text-[12px] text-fg0 outline-none focus:border-blue"
                />
                <input
                  type="number"
                  value={m.ingresos || ""}
                  placeholder="ingresos"
                  onChange={(e) => {
                    const meses = [...d.meses];
                    meses[i] = { ...m, ingresos: n(e.target.value) };
                    cambiar({ meses });
                  }}
                  className="w-[84px] rounded-[8px] border border-line2 bg-bg1 px-2 py-1 text-right text-[12px] text-fg0 outline-none focus:border-blue"
                />
                <input
                  type="number"
                  value={m.gastos || ""}
                  placeholder="gastos"
                  onChange={(e) => {
                    const meses = [...d.meses];
                    meses[i] = { ...m, gastos: n(e.target.value) };
                    cambiar({ meses });
                  }}
                  className="w-[84px] rounded-[8px] border border-line2 bg-bg1 px-2 py-1 text-right text-[12px] text-fg0 outline-none focus:border-blue"
                />
                <button
                  onClick={() => cambiar({ meses: d.meses.filter((_, j) => j !== i) })}
                  className="rounded-full p-1 text-fg3 hover:bg-bg3 hover:text-dn"
                  aria-label="Quitar el mes"
                >
                  ×
                </button>
              </div>
            ))}
            <Boton
              tipo="suave"
              onClick={() =>
                cambiar({
                  meses: [
                    ...d.meses,
                    { mes: new Date().toISOString().slice(0, 7), ingresos: 0, gastos: 0 },
                  ],
                })
              }
            >
              Añadir un mes
            </Boton>
          </div>
        )}
      </section>

      {sucio && (
        <div className="sticky bottom-24 z-20">
          <Boton
            tipo="principal"
            className="w-full py-3 shadow-e2"
            onClick={() => {
              void guardarCashflow(d as unknown as Record<string, unknown>);
              setSucio(false);
            }}
          >
            Guardar
          </Boton>
        </div>
      )}
    </div>
  );
}
