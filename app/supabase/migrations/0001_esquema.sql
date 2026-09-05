-- ════════════════════════════════════════════════════════════════════════
--  Cartera · esquema inicial
--
--  Dos grupos de tablas con reglas opuestas:
--
--  1. Las del usuario (accounts, assets, operations…) llevan user_id y RLS
--     estricta: cada cuenta ve lo suyo y nada más. Marc y Leti son dos
--     usuarios de Supabase distintos, así que el aislamiento es real y no
--     un sufijo en una clave de localStorage.
--
--  2. Las compartidas (prices, fx, catalog, benchmark) no llevan user_id.
--     Son datos públicos de mercado, los escribe el cron con la clave de
--     servicio y todo el mundo los lee. Duplicarlas por usuario sería
--     multiplicar por dos el mismo dato de Yahoo.
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Marca de tiempo de la última edición ────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════
--  DATOS DEL USUARIO
-- ════════════════════════════════════════════════════════════════════════

-- ── Cuentas: dónde está el dinero ───────────────────────────────────────
create table public.accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  broker      text not null,
  currency    text not null default 'EUR',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index accounts_user_idx on public.accounts (user_id);
-- Un bróker, una cuenta. Es lo que permite que al importar un archivo se
-- reutilice la cuenta existente en vez de crear «Revolut» tres veces.
create unique index accounts_user_broker_idx on public.accounts (user_id, broker);

-- ── Activos: la ficha, no la posición ───────────────────────────────────
-- Ojo con `cat`: NO lleva check. La app ya se rompió una vez por asumir que
-- sólo existían cinco categorías, y una restricción aquí volvería a hacer
-- que un valor nuevo reventara la inserción en vez de mostrarse como «otro».
create table public.assets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  name         text not null,
  ticker       text,
  isin         text,
  cat          text not null default 'accion',
  unit         text not null default 'títulos',
  currency     text not null default 'EUR',
  underlying   text,                     -- para el reparto por subyacente
  -- 'operations' = la posición se calcula con FIFO desde operations.
  -- 'manual'     = saldo declarado a mano, para fondos y efectivo sin histórico.
  mode         text not null default 'operations',
  manual_qty        numeric,
  manual_cost_unit  numeric,
  manual_price      numeric,             -- precio a mano cuando no hay feed
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index assets_user_idx on public.assets (user_id);
create index assets_user_isin_idx on public.assets (user_id, isin) where isin is not null;
create index assets_user_ticker_idx on public.assets (user_id, ticker) where ticker is not null;

-- ── Operaciones: la verdad ──────────────────────────────────────────────
-- Todo lo demás (posiciones, coste medio, plusvalías, aportado) se calcula
-- desde aquí. `total` va SIEMPRE en positivo: el signo lo pone `type`, que
-- es lo que evita las sumas con signo equivocado del importador.
create table public.operations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  account_id   uuid references public.accounts on delete set null,
  asset_id     uuid references public.assets on delete cascade,
  type         text not null check (type in (
                 'buy','sell','dividend','interest','deposit','withdrawal','fee','transfer'
               )),
  date         date not null,
  quantity     numeric,
  price        numeric,
  total        numeric not null check (total >= 0),
  fees         numeric not null default 0,
  currency     text not null default 'EUR',
  -- Convertido con el cambio DEL DÍA DE LA OPERACIÓN, no con el de hoy.
  total_eur    numeric,
  -- Un traspaso entre cuentas propias no es dinero nuevo: no cuenta como
  -- aportación. MyInvestor los marca con INTERNAL_TRANSFER_*.
  is_internal_transfer boolean not null default false,
  source       text not null default 'manual' check (source in ('manual','import')),
  source_format text,                    -- 'traderepublic-csv', 'revolut-csv'…
  import_hash  text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index operations_user_date_idx on public.operations (user_id, date desc);
create index operations_asset_idx on public.operations (asset_id);
-- La red que impide que reimportar el mismo archivo duplique el histórico.
create unique index operations_user_hash_idx
  on public.operations (user_id, import_hash)
  where import_hash is not null;

-- ── Fotos diarias del patrimonio ────────────────────────────────────────
create table public.snapshots (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  date       date not null,
  val        numeric not null,          -- valor de mercado
  cost       numeric not null,          -- coste total
  cost_inv   numeric,                   -- coste sin contar la liquidez
  liq        numeric,                   -- efectivo
  auto       boolean not null default false,
  created_at timestamptz not null default now()
);
-- Una foto por día: la de la tarde pisa a la de la mañana.
create unique index snapshots_user_date_idx on public.snapshots (user_id, date);

-- ── Seguimiento sin tenerlo ─────────────────────────────────────────────
create table public.watchlist (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  ticker       text not null,
  name         text,
  note         text,
  target_price numeric,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index watchlist_user_ticker_idx on public.watchlist (user_id, ticker);

-- ── Reparto objetivo ────────────────────────────────────────────────────
-- `key` es una categoría o un subyacente; `weight` el peso deseado en %.
create table public.targets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  key        text not null,
  weight     numeric not null default 0,
  extra      boolean not null default false,   -- añadido a mano, no viene de la cartera
  excluded   boolean not null default false,   -- se queda fuera del reparto
  updated_at timestamptz not null default now()
);
create unique index targets_user_key_idx on public.targets (user_id, key);

-- ── Presupuesto mensual ─────────────────────────────────────────────────
-- Un documento por usuario: la forma de la clave `cf1` de la app anterior
-- cambia a menudo y no compensa desmontarla en columnas.
create table public.cashflow (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ── Preferencias ────────────────────────────────────────────────────────
create table public.settings (
  user_id     uuid primary key default auth.uid() references auth.users on delete cascade,
  display_name text,
  theme       text not null default 'auto',
  tg_base     text not null default 'total',   -- pesos sobre total o sólo mercado
  tg_aporte   numeric not null default 500,
  band_mode   text not null default 'cat',
  expo_base   text not null default 'total',
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════════
--  RLS · lo que aísla a Marc de Leti
-- ════════════════════════════════════════════════════════════════════════

alter table public.accounts   enable row level security;
alter table public.assets     enable row level security;
alter table public.operations enable row level security;
alter table public.snapshots  enable row level security;
alter table public.watchlist  enable row level security;
alter table public.targets    enable row level security;
alter table public.cashflow   enable row level security;
alter table public.settings   enable row level security;

-- Una política por tabla, con `with check` además de `using`: sin el check,
-- un cliente podría escribir filas con el user_id de otro.
do $$
declare t text;
begin
  foreach t in array array[
    'accounts','assets','operations','snapshots','watchlist','targets','cashflow','settings'
  ] loop
    execute format($f$
      create policy %1$I_propias on public.%1$I
        for all to authenticated
        using (user_id = auth.uid())
        with check (user_id = auth.uid());
    $f$, t);
  end loop;
end $$;

-- Triggers de updated_at
do $$
declare t text;
begin
  foreach t in array array[
    'accounts','assets','operations','watchlist','targets','cashflow','settings'
  ] loop
    execute format(
      'create trigger %1$I_touch before update on public.%1$I
         for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════
--  DATOS DE MERCADO · compartidos, sólo lectura para la app
-- ════════════════════════════════════════════════════════════════════════

-- ── Precios ─────────────────────────────────────────────────────────────
-- `prev` es el cierre anterior FIABLE, no el que da Yahoo tal cual: Yahoo
-- mezcla clases de distinta divisa y devuelve velas con close nulo mientras
-- la sesión está abierta. El cron ya filtra ambos casos antes de escribir.
create table public.prices (
  symbol     text primary key,
  eur        numeric not null,           -- precio convertido a euros
  raw        numeric,                    -- precio en su divisa
  currency   text not null default 'EUR',
  prev       numeric,                    -- cierre anterior fiable, en euros
  name       text,
  source     text not null default 'yahoo',
  updated_at timestamptz not null default now()
);

-- ── Divisas ─────────────────────────────────────────────────────────────
create table public.fx (
  currency   text primary key,           -- euros por 1 unidad de esa divisa
  eur_rate   numeric not null,
  updated_at timestamptz not null default now()
);

-- Histórico, para convertir cada operación al cambio de SU día. Convertir
-- una compra de 2023 al dólar de hoy falsea el coste.
create table public.fx_history (
  currency  text not null,
  date      date not null,
  eur_rate  numeric not null,
  primary key (currency, date)
);

-- ── Catálogo de símbolos ────────────────────────────────────────────────
-- Los 519 símbolos verificados contra Yahoo que hoy están embebidos en el
-- index.html, más el alias ISIN → símbolo que usa el importador para saber
-- qué activo es cada línea de un CSV.
create table public.catalog (
  symbol     text primary key,
  name       text,
  isin       text,
  ticker     text,
  yahoo      text,                       -- símbolo real en Yahoo
  coingecko  text,
  currency   text,
  cat        text,
  underlying text,
  retired    boolean not null default false,  -- jubilado: Yahoo ya no lo sirve
  updated_at timestamptz not null default now()
);
create index catalog_isin_idx on public.catalog (isin) where isin is not null;
create index catalog_ticker_idx on public.catalog (ticker) where ticker is not null;

-- ── Referencia de mercado ───────────────────────────────────────────────
create table public.benchmark (
  symbol     text not null,              -- 'SP500_EUR'
  date       date not null,
  value      numeric not null,
  primary key (symbol, date)
);

alter table public.prices     enable row level security;
alter table public.fx         enable row level security;
alter table public.fx_history enable row level security;
alter table public.catalog    enable row level security;
alter table public.benchmark  enable row level security;

-- Lectura para todos (también sin cuenta: el modo local necesita precios).
-- La escritura no tiene política, así que sólo entra por la clave de
-- servicio que usa el cron — la que nunca sale del servidor.
do $$
declare t text;
begin
  foreach t in array array['prices','fx','fx_history','catalog','benchmark'] loop
    execute format($f$
      create policy %1$I_lectura on public.%1$I
        for select to anon, authenticated using (true);
    $f$, t);
  end loop;
end $$;
