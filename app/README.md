# Cartera

Tu cartera de inversión, en cualquier dispositivo. React + Vite sobre Supabase,
desplegada en Vercel.

Sustituye a la app anterior (`../index.html`), que vivía en un solo navegador y
obligaba a teclear cada compra a mano. Lo que cambia:

- **Se entra con cuenta.** Los datos están en Supabase, no en `localStorage`.
  Lo que apuntas en el móvil está en el portátil.
- **Se carga el archivo del bróker.** Trade Republic, Revolut, MyInvestor y
  cualquier CSV o Excel. La app detecta el formato, enseña qué va a entrar y
  sólo entonces guarda. Se pueden soltar varios de golpe y van en cola.
- **Y el PDF, cuando el CSV no basta.** El extracto de MyInvestor sólo se puede
  bajar en PDF, y es el único archivo suyo que dice qué fondos tienes, con su
  ISIN y sus participaciones: el de movimientos corta el nombre a 30 caracteres
  y se lleva por delante las dos cosas. Se lee sin librerías (`lib/import/pdf.ts`
  reconstruye la tabla a partir de las coordenadas del texto).
- **Y desde el móvil, sin descargar nada.** En la app del bróker: compartir el
  extracto y elegir «Enviar a Cartera». El archivo aterriza en el buzón y está
  esperando la próxima vez que abras la app. Se monta una vez, en Ajustes.
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
npm run comprobar   # revisa que cada clave es la que toca
npm run preparar
```

Crea las tablas y la RLS, comprueba que están las trece, y siembra el catálogo:
los ~528 símbolos verificados que llevaba dentro la app anterior, con su alias
ISIN → símbolo de Yahoo. Ese alias es lo que hace que una compra importada de
Trade Republic —que sólo trae el ISIN— encuentre su precio.

Aplica **todas** las migraciones de `supabase/migrations/` por orden de nombre,
así que si ya tenías la base montada antes del buzón, volver a ejecutarlo es lo
que añade las tablas nuevas. Se puede ejecutar más de una vez sin romper nada.

Si prefieres aplicar el esquema a mano, pega los archivos de
`supabase/migrations/` en el SQL Editor de Supabase, uno detrás de otro y por
orden, y luego lanza sólo `npm run sembrar-catalogo`.

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

## El buzón: mandar el extracto desde el móvil

En el iPhone, sacar el CSV del bróker y meterlo en la cartera eran dos mundos:
la app de Trade Republic lo genera y lo ofrece en la hoja de compartir, y para
que llegara aquí había que guardarlo en Archivos, abrir Safari, entrar en la
cartera y buscarlo. Seis pasos y tres apps, cada mes.

El buzón lo deja en uno. Cómo funciona:

    app del bróker → Compartir → «Enviar a Cartera»   (un Atajo de iOS)
          ↓
    POST /api/entrada?k=CLAVE     guarda el archivo CRUDO en la tabla inbox
          ↓
    la cartera enseña «te esperan 2 archivos», con su marca en la pestaña Añadir
          ↓
    tocas Revisar → la vista previa de siempre → Importar

**No importa nada por su cuenta, a propósito.** El archivo se guarda tal y como
llegó y pasa por la misma vista previa. Que subir sea fácil no es excusa para
que la cartera se llene de operaciones que nadie ha mirado — y guardar el
archivo crudo en vez de las operaciones ya interpretadas significa que, si
mañana mejora un adaptador, el mismo archivo se relee mejor.

**Por qué un Atajo y no el manifiesto.** La web tiene un mecanismo estándar para
esto, el *share target* del manifiesto: se declara y la PWA aparece en la hoja
de compartir del sistema. Android lo implementa; **iOS no**. Con un Atajo se
consigue lo mismo y se configura en dos minutos. Las instrucciones están dentro
de la app, en **Ajustes → Enviar desde el móvil**, porque quien las necesita
está en el móvil y no delante del repositorio.

**La clave.** El Atajo lleva encima un enlace con una clave de 128 bits, y esa
clave tiene **un solo permiso: dejar un archivo en el buzón**. No lee la
cartera, no escribe operaciones y no borra nada. Lo peor que puede hacer quien
la consiga es dejarte basura que se descarta de un toque, y cambiarla es un
botón. Vive en la tabla `upload_keys`, una fila por usuario.

Los topes están en `api/entrada.ts`: 4 MB por archivo y 30 sin importar. El
segundo es contra un Atajo en bucle, no contra ti.

---

## En local

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 107 pruebas del cálculo, los importadores y el buzón
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

### Probar un extracto de verdad

El formato que documenta un bróker y el que exporta no siempre son el mismo, y
la única manera de arreglar un adaptador es pasarle el archivo real. Dos sondas,
ninguna escribe nada:

```bash
# Qué ha entendido de UN archivo: formato, operaciones, posiciones, descartes.
npx vite-node scripts/probar-import.mjs "~/Downloads/Extracto cuenta MyInvestor.pdf"

# La importación ENTERA, varios archivos a la vez, y la cartera que saldría.
npx vite-node scripts/simular-import.mjs --cuadra 3336.49 \
  --valor "FIDELITY PHYSICAL BITCOIN ET=189.79" \
  "~/Downloads/Movimientos_07-09-2025_07-09-2026.xlsx" \
  "~/Downloads/Extracto cuenta MyInvestor.pdf"
```

`simular-import.mjs` llama a las mismas funciones que la pantalla —`leerArchivo`,
`combinar`, `planificar`— y luego repite lo que hace «Confirmar», pero en
memoria: aplica el plan sobre una copia del estado y calcula la cartera con el
motor de verdad. Con `--cuadra` le dices lo que dice el banco y te contesta si
cuadra. Con `--cero`, como si la cartera estuviera vacía.

### MyInvestor: por qué hacen falta dos archivos

Ninguno de los dos vale solo, y esto es el resumen de por qué:

| | PDF «Extracto de cuenta» | Excel de la cuenta corriente |
|---|---|---|
| Qué tienes hoy | sí: ISIN, participaciones, valor | no |
| El saldo real | sí | sí |
| Lo que costó | no (sólo el último mes) | sí, pero sin ISIN ni participaciones |

El Excel corta el concepto a 30 caracteres y con el corte se van el ISIN y las
participaciones, así que por sí solo deja los fondos a cero títulos **y** a cero
euros. Los dos juntos sí: las posiciones y el saldo salen del PDF, y el coste de
sumar las compras del Excel que casan con cada posición.

Y falta una tercera cosa que **no está en ninguno de los dos**: los ETC y los
ETF. Viven en la cuenta de VALORES, y el «Extracto de cuenta» cuadra su
«Posición Integrada» con el efectivo y los fondos de la cuenta de EFECTIVO —
compruébalo con su propio total— así que no salen por ningún lado. Y sus compras
sí están en el Excel, pero sin participaciones, porque el corte a 30 caracteres
se las come.

Ahí no hay nada que deducir, así que la pantalla lo pregunta: sale una casilla
por valor, con lo que te costó al lado, y escribes lo que vale hoy. Con eso el
activo entra con su valor y con SU coste —el de las compras, no el que has
escrito—, así que la ganancia sale bien. En blanco entra a cero, y se avisa.

Un aviso sobre lo que el total NO prueba: que cuadre significa que el archivo
llega hasta ahí, no que sea todo lo que tienes en el banco. Dar por vendido lo
que no salga en la lista borraba 423 € de oro y cripto que estaban ahí.

---

## Cómo está montado

```
src/
  lib/
    cartera.ts      todo el dinero se calcula aquí, y sólo aquí
    import/         un adaptador por bróker + el genérico
    almacen.ts      Supabase o este dispositivo, misma interfaz
    buzon.ts        los archivos que llegan del móvil y la clave de subida
    datos.tsx       el estado cargado y las escrituras
    precios.ts      lectura de precios: Supabase, y el feed como respaldo
  components/       piezas comunes y los tres gráficos, en SVG a mano
  pages/            Inicio · Análisis · Objetivo · Watchlist · Historial ·
                    Cashflow · Fiscal · Importar · Ajustes
api/                los tres crons de Vercel + /api/entrada, el buzón
supabase/           el esquema, una migración por archivo
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
