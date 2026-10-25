-- Limit orders placed through capypaper. Papertrade only takes market orders, so
-- capypaper holds each limit order and places it as a market order once the price
-- reaches its limit. For now that only happens while the trader has capypaper open.
create table public.limit_orders (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null
    check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  kind text not null
    check (kind in ('open', 'close')),
  instrument_id integer not null,
  -- For opens, the side to open; for closes, the side of the position.
  is_long boolean not null,
  -- 18-decimal USD. For closes, the position's margin.
  margin_raw numeric(78, 0) not null,
  leverage integer not null,
  -- For closes, the position to close.
  position_id numeric(78, 0),
  -- In units of 1 / the market's price scale. Buys (opening a long, closing a short)
  -- fire once the mid is at or below it, sells once it's at or above.
  limit_price_raw bigint not null
    check (limit_price_raw > 0),
  status text not null default 'pending'
    check (status in ('pending', 'triggered', 'placed', 'failed', 'cancelled')),
  -- The intent ID of the order it placed (see trades).
  intent_id text,
  -- Why it failed, or why capypaper cancelled it.
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'open' or position_id is not null)
);

create index limit_orders_wallet_idx on public.limit_orders (wallet_address, created_at desc);
-- At most one pending limit close per position; a new one replaces it.
create unique index limit_orders_pending_close_idx on public.limit_orders (position_id)
  where kind = 'close' and status = 'pending';

-- Only the server reads or writes this table; see wallet_sessions.
alter table public.limit_orders enable row level security;
