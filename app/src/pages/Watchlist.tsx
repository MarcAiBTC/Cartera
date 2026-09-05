// ── WATCHLIST ────────────────────────────────────────────────────────────
// Activos que miras sin tenerlos. El precio sale del mismo feed que la
// cartera, así que un símbolo que aquí funciona funcionará también cuando lo
// compres: es la forma barata de comprobar que el ticker es el bueno antes de
// meter dinero.

import { useState } from "react";
import { useDatos } from "../lib/datos";
import type { Seguimiento } from "../lib/tipos";
import { fe, fp } from "../lib/formato";
import { cierreFiable } from "../lib/cartera";
import {
  Aviso,
  Boton,
  Campo,
  Etiqueta,
  Hoja,
  Pastilla,
  Vacio,
} from "../components/base";

export default function Watchlist() {
  const { estado, mercado, insertar, borrar } = useDatos();
  const [abierta, setAbierta] = useState(false);
  const [ticker, setTicker] = useState("");
  const [nombre, setNombre] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function anadir() {
    const t = ticker.trim().toUpperCase();
    if (!t) return setError("Escribe un símbolo.");
    if (estado.seguimiento.some((s) => s.ticker === t)) return setError("Ya lo estás siguiendo.");
    try {
      await insertar<Seguimiento>("watchlist", [
        {
          ticker: t,
          name: nombre.trim() || null,
          target_price: objetivo ? parseFloat(objetivo.replace(",", ".")) : null,
        },
      ]);
      setTicker("");
      setNombre("");
      setObjetivo("");
      setError(null);
      setAbierta(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido añadir");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section>
        <Etiqueta>Watchlist</Etiqueta>
        <h1 className="hero-num mt-1 text-[2.1rem] text-fg0">Lo que miras sin tenerlo.</h1>
      </section>

      <Boton tipo="principal" className="w-full" onClick={() => setAbierta(true)}>
        Seguir un activo
      </Boton>

      {estado.seguimiento.length === 0 ? (
        <Vacio
          titulo="Aún no sigues nada"
          texto="Añade las acciones o los ETF que te estés pensando comprar y verás su precio aquí, sin tenerlos en cartera."
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {estado.seguimiento.map((s) => {
            const p = mercado.precios[s.ticker.toUpperCase()];
            const prev = cierreFiable(p?.eur ?? null, p?.prev ?? null);
            const dia = p && prev ? ((p.eur - prev) / prev) * 100 : null;
            const lejos =
              s.target_price != null && p ? ((p.eur - s.target_price) / s.target_price) * 100 : null;

            return (
              <li key={s.id} className="tile flex flex-col gap-1 px-3.5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-disp text-[14px] font-bold text-fg0">{s.ticker}</p>
                    {s.name && <p className="truncate text-[11px] text-fg2">{s.name}</p>}
                  </div>
                  <button
                    onClick={() => void borrar("watchlist", s.id)}
                    className="shrink-0 rounded-full p-1 text-fg3 transition-colors hover:bg-bg3 hover:text-dn"
                    aria-label={`Dejar de seguir ${s.ticker}`}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                {p ? (
                  <>
                    <p className="flex items-baseline gap-2">
                      <span className="font-disp text-[18px] font-bold text-fg0">{fe(p.eur)}</span>
                      {dia != null && <Pastilla pct={dia} />}
                    </p>
                    {s.target_price != null && (
                      <p className="text-[11px] text-fg2">
                        Objetivo {fe(s.target_price)} ·{" "}
                        <span className={lejos != null && lejos <= 0 ? "font-bold text-up" : ""}>
                          {lejos != null && lejos <= 0
                            ? "ya está por debajo"
                            : `${fp(lejos)} por encima`}
                        </span>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[11.5px] text-fg2">
                    Sin precio. El símbolo tiene que ser el de Yahoo Finance, con su sufijo de
                    mercado si lo lleva (por ejemplo <code className="font-mono">IGLN.L</code>).
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Hoja
        abierta={abierta}
        titulo="Seguir un activo"
        onCerrar={() => setAbierta(false)}
        pie={
          <Boton tipo="principal" className="w-full" onClick={() => void anadir()}>
            Añadir
          </Boton>
        }
      >
        <div className="flex flex-col gap-3">
          <Campo
            etiqueta="Símbolo"
            valor={ticker}
            onChange={setTicker}
            autoFocus
            placeholder="AAPL, IGLN.L, BTC…"
            nota="El de Yahoo Finance, con el sufijo del mercado si lo tiene."
          />
          <Campo etiqueta="Nombre" valor={nombre} onChange={setNombre} placeholder="Opcional" />
          <Campo
            etiqueta="Precio al que comprarías"
            tipo="number"
            paso="any"
            valor={objetivo}
            onChange={setObjetivo}
            sufijo="€"
            nota="Opcional. Te dice cuánto le falta para llegar."
          />
          {error && <Aviso tono="error">{error}</Aviso>}
        </div>
      </Hoja>
    </div>
  );
}
