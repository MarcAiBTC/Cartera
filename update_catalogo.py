#!/usr/bin/env python3
"""
Actualiza catalogo-precios.json: el cierre diario, en euros, de TODOS los activos
del catálogo de la app.

Por qué existe, además de precios.json:
  precios.json solo cubre los símbolos de simbolos.json (más los que llegan por
  el secret POSICIONES_JSON), es decir, lo que ya tienes en cartera. Un activo
  recién añadido no está ahí, y el navegador no puede cotizarlo por su cuenta:
  Yahoo no manda cabecera CORS y los proxies gratuitos están caídos o son de
  pago (comprobado en agosto de 2026). Sin este archivo, añadir un activo nuevo
  significaba quedarse sin precio hasta que alguien actualizaba el secret.

  Así que este archivo es la red de seguridad: precio de cierre para cualquier
  cosa del catálogo, disponible desde el primer segundo. Va aparte de
  precios.json y con cron diario porque son 500+ símbolos y precios.json se
  commitea cada 15 minutos: mezclarlos multiplicaría por 25 el peso del repo.

La lista de símbolos se lee de index.html, que es donde vive el catálogo. Es la
única fuente: duplicarla en un JSON aparte solo serviría para que se desincronice.
"""
import json, re, time, urllib.request, urllib.parse, datetime, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/json"}
YF_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]


def simbolos_del_catalogo():
    """Extrae los símbolos Yahoo del bloque `const CATALOGO=[…]` de index.html."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    ini = html.find("const CATALOGO=[")
    if ini < 0:
        raise RuntimeError("no encuentro `const CATALOGO=[` en index.html")
    fin = html.find("\n];", ini)
    if fin < 0:
        raise RuntimeError("el bloque CATALOGO no termina en `\\n];`")
    bloque = html[ini:fin]
    # Entradas tipo {s:"NESN.SW",n:"Nestlé",…}. Las criptos llevan s:"" y van por
    # CoinGecko en la propia app, así que se descartan aquí.
    syms = [m.group(1) for m in re.finditer(r'\{s:"([^"]*)"', bloque)]
    syms = [s for s in syms if s]
    if len(syms) < 50:
        raise RuntimeError(f"solo {len(syms)} símbolos: el formato del catálogo ha cambiado")
    # Sin duplicados y en orden estable, para que el diff del commit sea legible
    return sorted(set(syms))


def get_json(url, tries=3, timeout=20):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            last = e
            time.sleep(2.0 * (i + 1))
    raise last


FX = {"EUR": 1.0}


def fx_a_eur(cur):
    """EUR por 1 unidad de divisa. GBp = peniques. None si no se puede saber."""
    if cur in ("GBp", "GBX"):
        base = fx_a_eur("GBP")
        return base / 100.0 if base else None
    if cur in FX:
        return FX[cur]
    try:
        d = get_json(f"https://api.frankfurter.dev/v1/latest?base={cur}&symbols=EUR")
        FX[cur] = float(d["rates"]["EUR"])
    except Exception:
        FX[cur] = None
    return FX[cur]


def cotizar(sym):
    """Último precio y cierre anterior en la divisa nativa del símbolo."""
    path = f"/v8/finance/chart/{urllib.parse.quote(sym)}?range=5d&interval=1d"
    for intento in range(3):
        for host in YF_HOSTS:
            try:
                d = get_json(f"https://{host}{path}", tries=1)
                res = d["chart"]["result"][0]
                m = res["meta"]
                precio = float(m["regularMarketPrice"])
                try:
                    cl = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
                except Exception:
                    cl = []
                prev = float(cl[-2]) if len(cl) >= 2 else None
                return precio, (m.get("currency") or "USD"), prev
            except Exception:
                pass
        time.sleep(3.0 * (intento + 1))     # casi siempre es un 429: respirar
    return None


def main():
    syms = simbolos_del_catalogo()
    salida = ROOT / "catalogo-precios.json"

    # Si un símbolo falla hoy se conserva su último precio conocido: es mejor un
    # cierre de hace dos días que un hueco, sobre todo si es tu única fuente.
    previo = {}
    if salida.exists():
        try:
            previo = json.loads(salida.read_text(encoding="utf-8")).get("precios", {})
        except Exception:
            pass

    precios, fallos = {}, []
    for i, sym in enumerate(syms, 1):
        q = cotizar(sym)
        if q:
            precio, cur, prev = q
            r = fx_a_eur(cur)
            if r:
                e = {"eur": round(precio * r, 6), "cur": cur}
                if prev:
                    e["prev"] = round(prev * r, 6)
                precios[sym] = e
            else:
                fallos.append(f"{sym}: sin cambio para {cur}")
        else:
            fallos.append(f"{sym}: sin cotización")
        if sym not in precios and sym in previo:
            precios[sym] = previo[sym]
        time.sleep(0.25)                    # ~500 símbolos: unos 4-6 min en total
        if i % 50 == 0:
            print(f"  {i}/{len(syms)}…", flush=True)

    out = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc)
                          .replace(microsecond=0).isoformat(),
        "fx": {c: round(v, 6) for c, v in FX.items() if c != "EUR" and v},
        "precios": precios,
    }
    salida.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"OK: {len(precios)}/{len(syms)} precios · {len(fallos)} fallos "
          f"· {salida.stat().st_size // 1024} KB")
    for f in fallos[:20]:
        print("  ⚠", f)
    # Los fallos parciales no tumban el workflow: el archivo conserva lo anterior.
    return 0


if __name__ == "__main__":
    sys.exit(main())
