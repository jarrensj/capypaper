-- Nonce counter for the trades a wallet's session key signs. Papertrade tracks
-- used nonces per wallet in 256-bit bitmap words, so the counter starts at a
-- random word and goes up by one per trade. Null until the first trade.
alter table public.wallet_sessions add column next_nonce bigint;
