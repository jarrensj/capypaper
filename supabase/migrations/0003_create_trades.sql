-- Every order placed through capypaper, so signed-in users can see what others
-- trade. A row is written when papertrade's relayer accepts the order, then
-- settled from the wallet's account once the order fills or its deadline passes.
create table public.trades (
  intent_id text primary key
    check (intent_id ~ '^0x[0-9a-f]{64}$'),
  wallet_address text not null
    check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  kind text not null
    check (kind in ('open', 'close')),
  instrument_id integer not null,
  is_long boolean not null,
  -- 18-decimal USD.
  margin_raw numeric(78, 0) not null,
  leverage integer not null,
  -- For opens, the position it opened once filled; for closes, the position closed.
  position_id numeric(78, 0),
  -- For opens, in units of 1 / the market's price scale, once filled.
  entry_price_raw bigint,
  status text not null default 'submitted'
    check (status in ('submitted', 'filled', 'not_filled')),
  deadline timestamptz not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check (kind = 'open' or position_id is not null)
);

create index trades_created_at_idx on public.trades (created_at desc);
create index trades_submitted_idx on public.trades (wallet_address) where status = 'submitted';

-- Only the server reads or writes this table; see wallet_sessions.
alter table public.trades enable row level security;
