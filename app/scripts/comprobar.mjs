// ── COMPROBAR EL .env ────────────────────────────────────────────────────
// Revisa los cuatro valores antes de que se usen para nada.
//
//   npm run comprobar
//
// Existe por un motivo concreto: la clave pública y la secreta de Supabase son
// dos textos larguísimos que empiezan igual y se distinguen sólo por una
// palabra escondida dentro. Intercambiarlas es el error más fácil de cometer y
// el más difícil de diagnosticar después — la app parecería funcionar y estaría
// mandando al navegador una clave que se salta toda la seguridad.
//
// Aquí se abre cada clave, se mira qué papel dice tener y se avisa. No se
// escribe nada en ninguna parte.

const problemas = [];
const avisos = [];

const v = (nombre) => (process.env[nombre] ?? "").trim();

/** Un JWT son tres trozos separados por puntos; el de en medio es un JSON en
 *  base64 con, entre otras cosas, el papel de la clave. */
function papelDeLaClave(clave) {
  // Formato nuevo de Supabase: el papel va en el propio prefijo.
  if (clave.startsWith("sb_publishable_")) return "anon";
  if (clave.startsWith("sb_secret_")) return "service_role";

  const trozos = clave.split(".");
  if (trozos.length !== 3) return null;
  try {
    const carga = JSON.parse(Buffer.from(trozos[1], "base64url").toString("utf8"));
    return carga.role ?? null;
  } catch {
    return null;
  }
}

console.log("\nComprobando app/.env\n");

// ── 1 · La dirección ─────────────────────────────────────────────────────

const url = v("VITE_SUPABASE_URL") || v("SUPABASE_URL");
if (!url) {
  problemas.push("VITE_SUPABASE_URL está vacía.");
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
  problemas.push(
    `VITE_SUPABASE_URL no tiene la forma esperada.\n` +
      `      Debe ser algo como  https://abcdefghijklm.supabase.co\n` +
      `      Y tienes puesto     ${url}`,
  );
} else {
  console.log(`  ✓ Dirección          ${url}`);
}

// ── 2 y 3 · Las dos claves ───────────────────────────────────────────────

const publica = v("VITE_SUPABASE_ANON_KEY") || v("SUPABASE_ANON_KEY");
const secreta = v("SUPABASE_SERVICE_ROLE_KEY");

const revisarClave = (clave, nombreVar, papelEsperado, etiquetaPantalla) => {
  if (!clave) {
    problemas.push(`${nombreVar} está vacía.`);
    return null;
  }
  const papel = papelDeLaClave(clave);
  if (papel == null) {
    problemas.push(
      `${nombreVar} no parece una clave de Supabase.\n` +
        `      ¿Has copiado la línea entera, sin cortarla?`,
    );
    return null;
  }
  if (papel !== papelEsperado) {
    problemas.push(
      `${nombreVar} lleva la clave equivocada: es la «${papel}».\n` +
        `      Ahí va la que pone «${etiquetaPantalla}» en Supabase.\n` +
        `      Están una debajo de la otra y se parecen mucho: mira la etiqueta, no el texto.`,
    );
    return null;
  }
  console.log(`  ✓ Clave ${papelEsperado === "anon" ? "pública " : "secreta "}      ${clave.slice(0, 12)}…${clave.slice(-6)}`);
  return papel;
};

revisarClave(publica, "VITE_SUPABASE_ANON_KEY", "anon", "anon / publishable");
revisarClave(secreta, "SUPABASE_SERVICE_ROLE_KEY", "service_role", "service_role / secret");

if (publica && secreta && publica === secreta) {
  problemas.push("Has puesto la misma clave en los dos sitios. Tienen que ser distintas.");
}

// ── 4 · La cadena de conexión ────────────────────────────────────────────

const bd = v("DATABASE_URL");
if (!bd) {
  problemas.push("DATABASE_URL está vacía.");
} else if (!bd.startsWith("postgres")) {
  problemas.push(`DATABASE_URL debe empezar por «postgresql://». Tienes: ${bd.slice(0, 30)}…`);
} else if (bd.includes("[YOUR-PASSWORD]") || bd.includes("[TU-CONTRASEÑA]")) {
  problemas.push(
    "DATABASE_URL todavía lleva el hueco [YOUR-PASSWORD].\n" +
      "      Sustitúyelo, corchetes incluidos, por la contraseña de la base de datos\n" +
      "      que Supabase te dio al crear el proyecto.",
  );
} else {
  try {
    const u = new URL(bd);
    if (!u.password) {
      problemas.push("DATABASE_URL no lleva contraseña. Debe ir entre los dos puntos y la arroba.");
    } else {
      console.log(`  ✓ Base de datos      ${u.hostname}:${u.port || 5432}`);
      // El pooler de transacciones (6543) no sirve para crear tablas.
      if (u.port === "6543") {
        avisos.push(
          "DATABASE_URL usa el puerto 6543 («Transaction pooler»), que no admite crear tablas.\n" +
            "      Coge la fila que pone «Session pooler» — termina en :5432.",
        );
      }
    }
  } catch {
    problemas.push("DATABASE_URL está mal formada. ¿Le falta algún trozo al copiarla?");
  }
}

// ── Veredicto ────────────────────────────────────────────────────────────

if (avisos.length > 0) {
  console.log("\nAvisos:");
  for (const a of avisos) console.log(`  ⚠ ${a}`);
}

if (problemas.length > 0) {
  console.log(`\n${problemas.length === 1 ? "Hay algo que corregir" : `Hay ${problemas.length} cosas que corregir`}:\n`);
  for (const p of problemas) console.log(`  ✗ ${p}\n`);
  console.log("Corrige app/.env y vuelve a ejecutar  npm run comprobar\n");
  process.exit(1);
}

console.log("\nTodo correcto. El siguiente paso es:  npm run preparar\n");
