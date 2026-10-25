-- Traders anyone signed in can copy. Rows are added by hand (Supabase table
-- editor or SQL) rather than from the repo, since wallet addresses stay out of it.
create table public.traders (
  wallet_address text primary key
    check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  display_name text not null
    check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

-- Who copies whom; a row means copying is on. Deleting the copier's wallet
-- session (disconnecting) turns off all of their copying.
create table public.copy_subscriptions (
  copier_wallet text not null
    references public.wallet_sessions (wallet_address) on delete cascade,
  trader_wallet text not null
    references public.traders (wallet_address) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (copier_wallet, trader_wallet),
  check (copier_wallet <> trader_wallet)
);

create index copy_subscriptions_trader_wallet_idx on public.copy_subscriptions (trader_wallet);

-- Only the server reads or writes these tables; see wallet_sessions.
alter table public.traders enable row level security;
alter table public.copy_subscriptions enable row level security;

-- Copies of a listed trader's orders point at the order they copy. A copy
-- papertrade rejects is still logged, with the reason, so the copier can see why.
alter table public.trades
  add column copied_from_intent_id text references public.trades (intent_id),
  add column error text;

alter table public.trades drop constraint trades_status_check;
alter table public.trades add constraint trades_status_check
  check (status in ('submitted', 'filled', 'not_filled', 'rejected'));

create index trades_copied_from_idx on public.trades (copied_from_intent_id)
  where copied_from_intent_id is not null;
