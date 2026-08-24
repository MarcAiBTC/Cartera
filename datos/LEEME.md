# datos/

Carteras que publica la propia app para el informe diario por correo.

Cada fichero `cartera-<perfil>.enc.json` lleva:

- `perfil` y `actualizado` en claro — sirven para saber de quién es y de cuándo,
  y no dicen nada del dinero.
- `enc` — la cartera completa cifrada con **AES-GCM 256**, con la clave derivada
  por PBKDF2-SHA256 (210 000 vueltas) de la contraseña del informe.

Este repositorio es **público**, por eso el contenido nunca va en claro. La
contraseña vive en dos sitios y en ninguno más: el `localStorage` del navegador
donde usas la app y el secret `CARTERA_PASS` de GitHub Actions. Si la pierdes,
estos ficheros no se pueden recuperar — basta con volver a publicar desde la app
con una contraseña nueva y cambiar el secret.

Los escribe el botón **«Informe diario»** de la app (o solos, unos segundos
después de cada cambio). Los lee `scripts/informe_diario.mjs`.
