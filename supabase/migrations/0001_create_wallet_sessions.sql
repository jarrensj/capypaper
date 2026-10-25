-- One papertrade session key per connected wallet. The server holds the key so it
-- can sign trades for the wallet; papertrade session keys can open and close
-- positions but can't withdraw.
create table public.wallet_sessions (
  wallet_address text primary key
    check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  session_key_address text not null unique
    check (session_key_address ~ '^0x[0-9a-f]{40}$'),
  -- AES-256-GCM, keyed by SESSION_KEY_ENCRYPTION_KEY and bound to wallet_address.
  encrypted_session_key text not null,
  -- When papertrade last confirmed the key expires. Null until the first
  -- registration is confirmed.
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only the server, connecting as the database owner, reads or writes this table.
-- With RLS on and no policies, Supabase's anon and authenticated API roles can't.
alter table public.wallet_sessions enable row level security;
