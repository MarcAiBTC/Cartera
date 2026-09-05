// ── INICIO ───────────────────────────────────────────────────────────────
// Una pantalla, dos niveles. El titular contesta «¿cuánto tengo?» sin pedir
// nada, y las bandas contestan «¿en qué?». La tabla de posiciones sólo aparece
// cuando despliegas una banda: el detalle no puede tapar la respuesta.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useDatos } from "../lib/datos";
import { CAT_COLOR, CAT_LBL } from "../lib/tipos";
import { esLiquidez, movimientoDelDia, type Grupo, type Posicion } from "../lib/cartera";
import { fe, fn, fp, fpc } from "../lib/formato";
import { Delta, Etiqueta, Pastilla, Tarjeta, TituloSeccion, Vacio, Boton } from "../components/base";
import { Tira } from "../components/graficos";

export default function Inicio() {
  const { resumen, categorias, posiciones, estado } = useDatos();
  const [abierta, setAbierta] = useState<string | null>(null);

  const vacia = estado.activos.length === 0;
  const movers = movimientoDelDia(posiciones).slice(0, 3);

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
                  <li key={p.activo.id} className="flex items-center gap-2">
                    <span
                      className="h-6 w-[3px] shrink-0 rounded-full"
                      style={{ background: CAT_COLOR[p.activo.cat] ?? CAT_COLOR.otro }}
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
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          {/* ── El reparto ────────────────────────────────────────────── */}
          <section>
            <TituloSeccion>En qué está</TituloSeccion>
            <Tira
              total={resumen.valor}
              porciones={categorias.map((g) => ({
                clave: g.clave,
                etiqueta: CAT_LBL[g.clave] ?? g.clave,
                valor: g.valor,
                color: CAT_COLOR[g.clave] ?? CAT_COLOR.otro,
              }))}
            />
            <div className="mt-3 flex flex-col gap-2">
              {categorias.map((g) => (
                <Banda
                  key={g.clave}
                  grupo={g}
                  abierta={abierta === g.clave}
                  onAbrir={() => setAbierta(abierta === g.clave ? null : g.clave)}
                />
              ))}
            </div>
          </section>
        </>
      )}
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

function Banda({
  grupo,
  abierta,
  onAbrir,
}: {
  grupo: Grupo;
  abierta: boolean;
  onAbrir: () => void;
}) {
  const color = CAT_COLOR[grupo.clave] ?? CAT_COLOR.otro;
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
          {grupo.clave !== "liquidez" && (
            <span
              className={`text-[11px] font-bold ${
                grupo.ganancia >= 0 ? "text-up" : "text-dn"
              }`}
            >
              {grupo.ganancia >= 0 ? "+" : ""}
              {fe(grupo.ganancia, 0)} ({fp(grupo.gananciaPct)})
            </span>
          )}
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
          {grupo.posiciones.map((p) => (
            <Fila key={p.activo.id} p={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Fila({ p }: { p: Posicion }) {
  const liquidez = esLiquidez(p.activo);
  return (
    <li className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold text-fg0">
          {p.activo.name}
        </span>
        <span className="text-[10.5px] text-fg2">
          {liquidez
            ? "saldo"
            : `${fn(p.qty, 4)} ${p.activo.unit} · coste ${fn(p.costeUnit, 4)}`}
          {p.estado === "sin-precio" && " · sin precio"}
          {p.estado === "viejo" && " · precio antiguo"}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[13px] font-bold text-fg0">{fe(p.valor, 0)}</span>
        {!liquidez && p.ganancia != null && (
          <span className={`text-[10.5px] font-bold ${p.ganancia >= 0 ? "text-up" : "text-dn"}`}>
            {p.ganancia >= 0 ? "+" : ""}
            {fe(p.ganancia, 0)} ({fp(p.gananciaPct)})
          </span>
        )}
      </span>
    </li>
  );
}
