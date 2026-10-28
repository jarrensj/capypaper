-- Per-wallet settings. Kept apart from wallet_sessions, which loses its row when
-- the wallet disconnects, so settings survive signing out and back in.
create table public.wallet_settings (
  wallet_address text primary key
    check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  -- Where the wallet gets paid when people subscribe to copy its trades. Null
  -- until the wallet sets one.
  payout_address text
    check (payout_address ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only the server, connecting as the database owner, reads or writes this table.
-- With RLS on and no policies, Supabase's anon and authenticated API roles can't.
alter table public.wallet_settings enable row level security;
