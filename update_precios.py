#!/usr/bin/env python3
"""
Actualiza precios.json con los precios en EUR de todos los símbolos de simbolos.json.
Fuentes: Yahoo Finance (chart v8), CoinGecko (cripto), Frankfurter/BCE (divisas).
Se ejecuta desde GitHub Actions; no necesita claves ni servicios de pago.
Si un símbolo falla, conserva su último precio conocido del precios.json anterior.
"""
import json, time, urllib.request, urllib.parse, datetime, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/json"}
YF_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]


def get_json(url, tries=3, timeout=15):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def yf_quote(sym):
    """Precio, divisa, cierre anterior y serie de cierres diarios (1 mes) en Yahoo."""
    path = f"/v8/finance/chart/{urllib.parse.quote(sym)}?range=1mo&interval=1d"
    last = None
    for host in YF_HOSTS:
        try:
            d = get_json(f"https://{host}{path}", tries=2)
            res = d["chart"]["result"][0]
            m = res["meta"]
            price = float(m["regularMarketPrice"])
            cur = m.get("currency") or "USD"
            try:
                closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
            except Exception:
                closes = []
            # En fondos (símbolos 0P…) regularMarketPrice se queda a veces rezagado
            # un día: el VL nuevo solo aparece en la serie de cierres. Si el gráfico
            # trae un cierre más nuevo que la fecha del precio, manda ese cierre.
            # (En acciones en sesión no salta: el último cierre nunca es posterior
            # a la hora del último cruce.)
            ts_list = res.get("timestamp") or []
            mkt_ts = m.get("regularMarketTime") or 0
            if closes and ts_list and mkt_ts and ts_list[-1] > mkt_ts and closes[-1]:
                price = float(closes[-1])
            # Cierre anterior: el penúltimo de la serie diaria (el último es la sesión
            # en curso). OJO: chartPreviousClose NO sirve — con range=1mo es el cierre
            # de hace un mes y rompía la variación diaria de toda la cartera.
            prev = m.get("regularMarketPreviousClose")
            if len(closes) >= 2:
                prev = closes[-2]
            prev = float(prev) if prev else None
            return price, cur, prev, closes
        except Exception as e:
            last = e
    raise last


FX = {"EUR": 1.0}


def fx_to_eur(cur):
    """EUR por 1 unidad de divisa. GBp = peniques."""
    if cur in ("GBp", "GBX"):
        return fx_to_eur("GBP") / 100.0
    if cur not in FX:
        try:
            d = get_json(f"https://api.frankfurter.app/latest?from={cur}&to=EUR")
            FX[cur] = float(d["rates"]["EUR"])
        except Exception:
            p = yf_quote(f"EUR{cur}=X")[0]   # respaldo: cruce de Yahoo (divisa por 1 EUR)
            FX[cur] = 1.0 / p
    return FX[cur]


def yf_resolve(query):
    """Resuelve ISIN/ticker → símbolo Yahoo, prefiriendo listados europeos."""
    path = f"/v1/finance/search?q={urllib.parse.quote(query)}&quotesCount=8&newsCount=0"
    last = None
    for host in YF_HOSTS:
        try:
            d = get_json(f"https://{host}{path}", tries=2)
            qs = [x for x in d.get("quotes", []) if x.get("symbol")]
            if not qs:
                return None
            def score(x):
                suf = x["symbol"].split(".")[1] if "." in x["symbol"] else ""
                s = 4 if suf in ("MI","DE","PA","AS","MC","IR") else 2 if suf in ("F","SG","BD","VI","SW","L") else 0
                return s + (1 if x.get("quoteType") == "MUTUALFUND" else 0)
            return max(qs, key=score)["symbol"]
        except Exception as e:
            last = e
    raise last


def main():
    simbolos = json.loads((ROOT / "simbolos.json").read_text())
    out_path = ROOT / "precios.json"
    previo, resueltos = {}, {}
    if out_path.exists():
        try:
            j = json.loads(out_path.read_text())
            previo = j.get("precios", {})
            resueltos = j.get("resueltos", {})
        except Exception:
            pass

    # Resolver símbolos pendientes (sym vacío) por ISIN, con caché entre ejecuciones
    for s in simbolos:
        if not s.get("sym"):
            key = (s.get("isin") or s.get("ticker") or "").upper()
            if not key:
                continue
            if key in resueltos:
                s["sym"] = resueltos[key]
            else:
                try:
                    sym = yf_resolve(key)
                    if sym:
                        s["sym"] = resueltos[key] = sym
                        print(f"  resuelto {key} → {sym}")
                except Exception as e:
                    print(f"  ⚠ sin resolver {key}: {e}")
    simbolos = [s for s in simbolos if s.get("sym")]

    precios, fallos = {}, []
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

    # Cripto por CoinGecko. El PRECIO va por simple/price (endpoint probado y barato)
    # con el cambio 24h para derivar el cierre anterior. La sparkline 7d se intenta
    # aparte: si falla, los precios no se ven afectados.
    cg = {s["sym"]: s["cg"] for s in simbolos if s.get("cg")}
    if cg:
        ids = ",".join(sorted(set(cg.values())))
        try:
            d = get_json(f"https://api.coingecko.com/api/v3/simple/price?ids={ids}&vs_currencies=eur&include_24hr_change=true")
            for sym, cid in cg.items():
                info = d.get(cid, {})
                eur = info.get("eur")
                if not eur:
                    continue
                entry = {"eur": eur, "cur": "EUR", "src": "coingecko", "ts": now}
                chg = info.get("eur_24h_change")
                if chg is not None:
                    entry["prev"] = round(eur / (1 + chg / 100.0), 6)
                precios[sym] = entry
        except Exception as e:
            fallos.append(f"coingecko: {e}")
        try:  # sparkline 7d, best-effort
            d2 = get_json(f"https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&ids={ids}&sparkline=true")
            by_id = {c["id"]: c for c in d2}
            for sym, cid in cg.items():
                if sym not in precios:
                    continue
                sp = (by_id.get(cid, {}).get("sparkline_in_7d") or {}).get("price") or []
                if sp:
                    step = max(1, len(sp) // 30)              # 168 horas → ~30 puntos
                    precios[sym]["spark"] = [round(x, 6) for x in sp[::step]][-30:]
        except Exception as e:
            fallos.append(f"coingecko spark: {e}")
        for sym in cg:                                        # conservar último conocido
            if sym not in precios and sym in previo:
                precios[sym] = previo[sym]

    # Resto por Yahoo
    for s in simbolos:
        sym = s["sym"]
        if sym in precios:
            continue
        try:
            p, cur, prev, closes = yf_quote(sym)
            r = fx_to_eur(cur)
            eur = round(p * r, 6)
            entry = {"eur": eur, "raw": p, "cur": cur, "src": "yahoo", "ts": now}
            if prev:
                entry["prev"] = round(prev * r, 6)
            if closes:
                entry["spark"] = [round(c * r, 6) for c in closes[-30:]]
            precios[sym] = entry
            time.sleep(0.4)   # sin ráfagas: Yahoo penaliza el exceso
        except Exception as e:
            fallos.append(f"{sym}: {e}")
            if sym in previo:                # conservar último precio conocido
                precios[sym] = previo[sym]

    # Alias por ISIN y ticker para que la app pueda casar por cualquiera de los tres
    alias = {}
    for s in simbolos:
        if s["sym"] in precios:
            for k in (s.get("isin"), s.get("ticker")):
                if k:
                    alias[k.upper()] = s["sym"]

    # Tipos de cambio (EUR por 1 unidad): la app los usa para posiciones en USD.
    # USD siempre incluido; el resto son las divisas que aparecieron al cotizar.
    try:
        fx_to_eur("USD")
    except Exception as e:
        fallos.append(f"fx USD: {e}")
    fx = {c: round(r, 6) for c, r in FX.items() if c != "EUR"}

    out = {"generated_at": now, "fallos": fallos, "alias": alias, "fx": fx, "resueltos": resueltos, "precios": precios}
    out_path.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"OK: {len(precios)} precios · {len(fallos)} fallos")
    for f in fallos:
        print("  ⚠", f)
    # No fallar el workflow por fallos parciales: el JSON conserva los últimos valores
    return 0


if __name__ == "__main__":
    sys.exit(main())
