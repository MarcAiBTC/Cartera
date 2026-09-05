// ── FISCAL ───────────────────────────────────────────────────────────────
// Lo que hay que declarar, por ejercicio. Todo sale del mismo FIFO que calcula
// las posiciones, así que la ganancia realizada de esta pantalla y la del
// resumen no pueden discrepar: son el mismo número.
//
// Aviso que la pantalla repite: esto es una ayuda para preparar la renta, no
// un cálculo fiscal. Las reglas finas (la de los dos meses en valores
// homogéneos, las retenciones en origen, los mínimos) no están aquí.

import { useMemo, useState } from "react";
import { useDatos } from "../lib/datos";
import { caducaEn, porEjercicio } from "../lib/cartera";
import { fd, fe, fn } from "../lib/formato";
import { Aviso, Etiqueta, Segmentos, Tarjeta, TituloSeccion, Vacio } from "../components/base";

export default function Fiscal() {
  const { realizadas, estado } = useDatos();
  const ejercicios = useMemo(
    () => porEjercicio(realizadas, estado.operaciones),
    [realizadas, estado.operaciones],
  );
  const [anio, setAnio] = useState<number | null>(ejercicios[0]?.anio ?? null);

  const activos = useMemo(
    () => new Map(estado.activos.map((a) => [a.id, a.name])),
    [estado.activos],
  );

  if (ejercicios.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <Cabecera />
        <Vacio
          titulo="Todavía no hay nada que declarar"
          texto="Aquí aparecerán las plusvalías y minusvalías en cuanto vendas algo, y los dividendos e intereses que vayas cobrando."
        />
      </div>
    );
  }

  const e = ejercicios.find((x) => x.anio === anio) ?? ejercicios[0];

  // Las pérdidas de años anteriores que aún se pueden compensar. En España,
  // cuatro ejercicios contando desde el siguiente al de la pérdida.
  const pendientes = ejercicios
    .filter((x) => x.neto < 0 && caducaEn(x.anio) >= new Date().getFullYear())
    .map((x) => ({ anio: x.anio, importe: -x.neto, caduca: caducaEn(x.anio) }));

  return (
    <div className="flex flex-col gap-5">
      <Cabecera />

      <Segmentos
        valor={String(e.anio)}
        onChange={(v) => setAnio(Number(v))}
        opciones={ejercicios.slice(0, 4).map((x) => ({ valor: String(x.anio), texto: String(x.anio) }))}
      />

      <section>
        <Etiqueta>Resultado de {e.anio}</Etiqueta>
        <h1 className={`hero-num mt-1 ${e.neto >= 0 ? "text-up" : "text-dn"}`}>
          {e.neto >= 0 ? "+" : ""}
          {fe(e.neto, 0)}
        </h1>
        <p className="mt-2 text-[13px] text-fg2">
          {fe(e.ganancias, 0)} en ganancias · {fe(e.perdidas, 0)} en pérdidas
        </p>
      </section>

      <Tarjeta className="grid grid-cols-2 gap-3">
        <div>
          <Etiqueta>Dividendos</Etiqueta>
          <p className="font-disp text-[19px] font-bold text-fg0">{fe(e.dividendos, 0)}</p>
          <p className="text-[10.5px] text-fg3">rendimientos del capital</p>
        </div>
        <div>
          <Etiqueta>Intereses</Etiqueta>
          <p className="font-disp text-[19px] font-bold text-fg0">{fe(e.intereses, 0)}</p>
          <p className="text-[10.5px] text-fg3">cuentas remuneradas</p>
        </div>
      </Tarjeta>

      {pendientes.length > 0 && (
        <Tarjeta>
          <TituloSeccion nota="Se compensan con ganancias del mismo tipo durante los cuatro ejercicios siguientes.">
            Pérdidas por compensar
          </TituloSeccion>
          <ul className="flex flex-col gap-2">
            {pendientes.map((p) => (
              <li key={p.anio} className="flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] text-fg1">
                  De {p.anio} · hasta el ejercicio {p.caduca}
                </span>
                <span className="text-[13px] font-bold text-dn">{fe(p.importe, 0)}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <section>
        <TituloSeccion nota="Cada venta con el coste del lote más antiguo, que es el método que exige Hacienda.">
          Las ventas de {e.anio}
        </TituloSeccion>

        {e.ventas.length === 0 ? (
          <p className="text-[12px] text-fg2">Ese año no vendiste nada.</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full min-w-[440px] text-left text-[11.5px]">
              <thead className="bg-bg2 text-fg2">
                <tr>
                  <th className="px-2.5 py-2 font-bold">Venta</th>
                  <th className="px-2.5 py-2 text-right font-bold">Cobrado</th>
                  <th className="px-2.5 py-2 text-right font-bold">Coste</th>
                  <th className="px-2.5 py-2 text-right font-bold">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {e.ventas.map((v, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-2.5 py-2">
                      <span className="block truncate font-semibold text-fg0">
                        {activos.get(v.assetId) ?? "Activo borrado"}
                      </span>
                      <span className="text-[10.5px] text-fg2">
                        {fd(v.fecha)} · {fn(v.qty, 4)}
                        {v.fechaCompra && ` · comprado el ${fd(v.fechaCompra)}`}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 text-right whitespace-nowrap text-fg1">
                      {fe(v.ingreso, 0)}
                    </td>
                    <td className="px-2.5 py-2 text-right whitespace-nowrap text-fg1">
                      {fe(v.coste, 0)}
                    </td>
                    <td
                      className={`px-2.5 py-2 text-right font-bold whitespace-nowrap ${
                        v.resultado >= 0 ? "text-up" : "text-dn"
                      }`}
                    >
                      {v.resultado >= 0 ? "+" : ""}
                      {fe(v.resultado, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Aviso>
        Esto es una ayuda para preparar la declaración, no un cálculo fiscal. No contempla la regla
        de los dos meses en valores homogéneos, ni las retenciones en origen de los dividendos
        extranjeros, ni los ajustes de los fondos con traspaso. Contrasta las cifras antes de
        presentarlas.
      </Aviso>
    </div>
  );
}

function Cabecera() {
  return (
    <section>
      <Etiqueta>Fiscal</Etiqueta>
      <h1 className="hero-num mt-1 text-[2.1rem] text-fg0">Lo que toca declarar.</h1>
    </section>
  );
}
