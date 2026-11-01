type TestPostgresPool = {
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<unknown>;
    release(): void;
  }>;
};

const PGCRYPTO_LOCK = [42067, 1] as const;

/** Serialize first-time shared extension setup before isolated schemas run migrations. */
export async function ensureTestPgcrypto(database: TestPostgresPool): Promise<void> {
  const client = await database.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [...PGCRYPTO_LOCK]);
    locked = true;
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock($1, $2)", [...PGCRYPTO_LOCK]);
    } finally {
      client.release();
    }
  }
}
