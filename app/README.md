# Cartera

Tu cartera de inversión, en cualquier dispositivo. React + Vite sobre Supabase,
desplegada en Vercel.

Sustituye a la app anterior (`../index.html`), que vivía en un solo navegador y
obligaba a teclear cada compra a mano. Lo que cambia:

- **Se entra con cuenta.** Los datos están en Supabase, no en `localStorage`.
  Lo que apuntas en el móvil está en el portátil.
- **Se carga el archivo del bróker.** Trade Republic, Revolut, MyInvestor y
  cualquier CSV o Excel. La app detecta el formato, enseña qué va a entrar y
  sólo entonces guarda.
- **Los precios los trae el servidor.** Un cron de Vercel llama a Yahoo y a
  CoinGecko y escribe en Supabase. Desde el navegador no se puede: Yahoo no
  manda cabeceras CORS y ningún proxy público aguanta.

---

## Montarlo desde cero

### 1 · Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com) (el plan gratuito
   sobra para dos carteras).
2. El esquema lo aplica `npm run preparar` en el paso 3. Si prefieres hacerlo
   aquí, pega entero `supabase/migrations/0001_esquema.sql` en el **SQL
   Editor** y ejecútalo.
3. En **Authentication → Providers**, deja activo *Email*. Si quieres el botón
   de Google, activa también *Google* y pon
   `https://TU-APP.vercel.app` en las URL de redirección.
4. Apunta de **Project Settings → API**: la URL, la clave `anon` y la clave
   `service_role`.

> La clave `anon` es pública por diseño y va en el navegador. La `service_role`
> **salta la RLS**: si se filtra, cualquiera puede leer y escribir todas las
> carteras. Sólo en las variables de entorno de Vercel.

### 2 · Vercel

1. Importa el repositorio y pon **Root Directory** en `app`.
2. Variables de entorno (las tienes explicadas en `.env.example`):

   | Variable | Dónde llega | Para qué |
   |---|---|---|
   | `VITE_SUPABASE_URL` | navegador | conectar con tu proyecto |
   | `VITE_SUPABASE_ANON_KEY` | navegador | idem |
   | `SUPABASE_URL` | servidor | los crons |
   | `SUPABASE_SERVICE_ROLE_KEY` | servidor | escribir precios saltando la RLS |
   | `CRON_SECRET` | servidor | que sólo Vercel dispare los crons |

3. Despliega. `vercel.json` deja programados los tres crons, **todos diarios**.

> El plan Hobby de Vercel sólo admite crons diarios: un `*/15` en `vercel.json`
> hace fallar el despliegue con *«Hobby accounts are limited to daily cron
> jobs»*. El ritmo de 15 minutos lo pone la Action
> `.github/workflows/precios-supabase.yml`, que llama a `/api/precios` con el
> `CRON_SECRET`. Necesita dos secretos en GitHub: `VERCEL_APP_URL` (sin barra
> final) y `CRON_SECRET`, el mismo que en Vercel. De propina, esas llamadas
> mantienen despierto el proyecto de Supabase, que en el plan gratuito se pausa
> tras una semana sin actividad.

### 3 · Preparar la base de datos

Rellena `app/.env` (el archivo ya está creado con los huecos y una explicación
de dónde sale cada valor; git lo ignora) y ejecuta:

```bash
npm run preparar
```

Crea las tablas y la RLS, comprueba que están las trece, y siembra el catálogo:
los ~528 símbolos verificados que llevaba dentro la app anterior, con su alias
ISIN → símbolo de Yahoo. Ese alias es lo que hace que una compra importada de
Trade Republic —que sólo trae el ISIN— encuentre su precio.

Se puede ejecutar más de una vez sin romper nada. Si prefieres aplicar el
esquema a mano, pega `supabase/migrations/0001_esquema.sql` en el SQL Editor de
Supabase y luego lanza sólo `npm run sembrar-catalogo`.

### 4 · Migrar la cartera de la app anterior

Exporta el JSON desde la app vieja (o usa uno de los backups que ya hay) y
súbelo con la cuenta de cada persona. Se ejecuta una vez para Marc y otra para
Leti:

```bash
npm run migrar -- ../../Cartera_Marc_2026-08-10.json --seco     # ver qué haría
npm run migrar -- ../../Cartera_Marc_2026-08-10.json \
  --email tu@correo --clave ***
```

**Comprueba antes de darla por buena** que el patrimonio, el coste, el aportado
y la ganancia coinciden con la app anterior. El script imprime las tres cifras
que hacen falta para cuadrar.

---

## En local

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 30 pruebas del cálculo y de los importadores
npm run build
```

Sin variables de entorno la app arranca igual, en modo **«sólo en este
dispositivo»**: guarda en `localStorage` y lee los precios del feed del
repositorio antiguo. Sirve para probarla sin montar nada.

### Mirar las pantallas

```bash
npm run build && cp scripts/sembrar-demo.html dist/ && npm run preview
SEMBRAR=http://localhost:4173/sembrar-demo.html \
  npm run captura -- http://localhost:4173/analisis analisis.png 430 0
```

`scripts/captura.mjs` habla con Chrome por su protocolo de depuración en vez de
usar `--screenshot` a secas: en Windows la ventana tiene una anchura mínima de
unos 500 px, así que la página se maqueta a 500 y la captura se recorta a 430.
Parece un desbordamiento horizontal que no existe.

---

## Cómo está montado

```
src/
  lib/
    cartera.ts      todo el dinero se calcula aquí, y sólo aquí
    import/         un adaptador por bróker + el genérico
    almacen.ts      Supabase o este dispositivo, misma interfaz
    datos.tsx       el estado cargado y las escrituras
    precios.ts      lectura de precios: Supabase, y el feed como respaldo
  components/       piezas comunes y los tres gráficos, en SVG a mano
  pages/            Inicio · Análisis · Objetivo · Watchlist · Historial ·
                    Cashflow · Fiscal · Importar · Ajustes
api/                los tres crons de Vercel
supabase/           el esquema
```

### Tres reglas que no se pueden perder

Están escritas en `src/lib/cartera.ts` y probadas en `test/cartera.test.ts`.
Cada una viene de un error real:

1. **En el efectivo, el coste es siempre el saldo.** El dinero parado ni gana
   ni pierde. Cuando el coste de una cuenta se guardaba a 0, meter 730 € los
   contaba como plusvalía.
2. **Aportado ≠ coste.** Vender con beneficio o cobrar intereses sube el coste
   sin que entre un euro de fuera. Hay que restar lo realizado y lo cobrado.
3. **Una categoría desconocida no rompe nada.** Cualquier `cat` que no sea de
   las cinco de siempre se agrupa como «otro».

Y una cuarta, en los precios: **el cierre anterior tiene que ser fiable.** Yahoo
mezcla clases de distinta divisa y devuelve la vela del día en curso con
`close: null`. Sin filtrar las dos cosas, la variación diaria salta sola.

---

## Qué hace cada cron

| Ruta | Cuándo | Quién lo dispara | Qué escribe |
|---|---|---|---|
| `/api/precios` | cada 15 min, 6–22 h L-V | GitHub Actions | `prices`, `fx` |
| `/api/precios` | a diario | cron de Vercel (respaldo) | `prices`, `fx` |
| `/api/catalogo` | a diario | cron de Vercel | `fx`, `fx_history`, jubila símbolos muertos |
| `/api/benchmark` | a diario | cron de Vercel | `benchmark` (S&P 500 en euros), `fx_history` |

Un símbolo que falla no borra su precio anterior: se queda el último bueno y el
fallo sale en la respuesta del cron. Es preferible un precio de hace una hora a
un hueco en la cartera.
