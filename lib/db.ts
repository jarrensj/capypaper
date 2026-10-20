import "server-only";

import postgres from "postgres";

const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

// Reuse one client across dev hot reloads instead of opening a new pool each time.
// prepare: false because Supabase's transaction pooler doesn't support prepared statements.
export const sql =
  globalForDb.sql ??
  (globalForDb.sql = postgres(process.env.DATABASE_URL ?? "", {
    prepare: false,
  }));
