-- ════════════════════════════════════════════════════════════════════════
--  Cartera · buzón de entrada
--
--  El problema que resuelve: en el iPhone, sacar el extracto del bróker y
--  meterlo en la cartera son dos mundos separados. La app de Trade Republic
--  genera el CSV y lo ofrece en la hoja de compartir; para que llegue aquí
--  había que guardarlo en Archivos, abrir Safari, entrar en la cartera y
--  buscarlo. Seis pasos y tres apps.
--
--  Con estas dos tablas el camino es: compartir → «Enviar a Cartera» → listo.
--  El archivo aterriza en el buzón y la próxima vez que abras la app te está
--  esperando, con su vista previa de siempre antes de escribir nada.
--
--  Dos tablas y no una:
--
--   · upload_keys  traduce una clave larga a un usuario. Es lo único que el
--                  Atajo de iOS lleva encima, así que es lo único que se puede
--                  filtrar. Y con ella SÓLO se puede dejar un archivo en el
--                  buzón: no lee la cartera, no escribe operaciones, no borra
--                  nada. Lo peor que hace quien la robe es dejarte basura que
--                  se descarta de un toque.
--
--   · inbox        los archivos que han llegado y todavía no has importado.
--                  Se guarda el archivo CRUDO, no las operaciones ya
--                  interpretadas: la vista previa sigue siendo la que manda, y
--                  si mañana el importador mejora, el mismo archivo se relee
--                  mejor.
-- ════════════════════════════════════════════════════════════════════════

-- ── La clave de subida ──────────────────────────────────────────────────
-- Una por usuario (la clave primaria es el user_id), así que «cambiar la
-- clave» es un upsert y no deja claves viejas vivas por ahí.
create table if not exists public.upload_keys (
  user_id      uuid primary key default auth.uid() references auth.users on delete cascade,
  token        text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  uses         integer not null default 0
);

-- ── El buzón ────────────────────────────────────────────────────────────
-- `content` guarda el archivo tal cual llegó. Texto cuando es CSV o JSON, y
-- base64 cuando es un Excel: meter bytes crudos en una columna de texto los
-- rompe en cuanto aparece un 0x00.
create table if not exists public.inbox (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  filename    text not null,
  content     text not null,
  encoding    text not null default 'text',    -- 'text' | 'base64'
  bytes       integer not null default 0,
  source      text not null default 'atajo',   -- 'atajo' | 'web'
  -- 'nuevo' hasta que lo importas. No se borra al importarlo: saber que ese
  -- archivo ya entró es lo que evita volver a abrirlo por costumbre.
  status      text not null default 'nuevo',   -- 'nuevo' | 'importado' | 'descartado'
  ops         integer,                         -- operaciones que metió, al importarlo
  created_at  timestamptz not null default now(),
  imported_at timestamptz
);

-- El índice que usa la app en cada arranque: «lo mío, pendiente, lo último
-- primero».
create index if not exists inbox_user_estado_idx
  on public.inbox (user_id, status, created_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────
-- La ruta /api/entrada escribe con la clave de servicio, que se salta esto;
-- las políticas son para el navegador, que sólo puede ver lo suyo.
alter table public.upload_keys enable row level security;
alter table public.inbox       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['upload_keys','inbox'] loop
    -- `drop if exists` antes de crear: Postgres no tiene
    -- `create policy if not exists`, y este archivo tiene que poder
    -- ejecutarse dos veces sin quejarse.
    execute format('drop policy if exists %1$I_propias on public.%1$I;', t);
    execute format($f$
      create policy %1$I_propias on public.%1$I
        for all to authenticated
        using (user_id = auth.uid())
        with check (user_id = auth.uid());
    $f$, t);
  end loop;
end $$;
