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
    """Precio y divisa reales del listado en Yahoo."""
    path = f"/v8/finance/chart/{urllib.parse.quote(sym)}?range=5d&interval=1d"
    last = None
    for host in YF_HOSTS:
        try:
            d = get_json(f"https://{host}{path}", tries=2)
            m = d["chart"]["result"][0]["meta"]
            return float(m["regularMarketPrice"]), m.get("currency") or "USD"
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
            p, _ = yf_quote(f"EUR{cur}=X")   # respaldo: cruce de Yahoo (divisa por 1 EUR)
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

    # Cripto por CoinGecko (lote único)
    cg = {s["sym"]: s["cg"] for s in simbolos if s.get("cg")}
    if cg:
        try:
            ids = ",".join(sorted(set(cg.values())))
            d = get_json(f"https://api.coingecko.com/api/v3/simple/price?ids={ids}&vs_currencies=eur")
            for sym, cid in cg.items():
                if d.get(cid, {}).get("eur"):
                    precios[sym] = {"eur": d[cid]["eur"], "cur": "EUR", "src": "coingecko", "ts": now}
        except Exception as e:
            fallos.append(f"coingecko: {e}")

    # Resto por Yahoo
    for s in simbolos:
        sym = s["sym"]
        if sym in precios:
            continue
        try:
            p, cur = yf_quote(sym)
            eur = round(p * fx_to_eur(cur), 6)
            precios[sym] = {"eur": eur, "raw": p, "cur": cur, "src": "yahoo", "ts": now}
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

    out = {"generated_at": now, "fallos": fallos, "alias": alias, "resueltos": resueltos, "precios": precios}
    out_path.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"OK: {len(precios)} precios · {len(fallos)} fallos")
    for f in fallos:
        print("  ⚠", f)
    # No fallar el workflow por fallos parciales: el JSON conserva los últimos valores
    return 0


if __name__ == "__main__":
    sys.exit(main())
