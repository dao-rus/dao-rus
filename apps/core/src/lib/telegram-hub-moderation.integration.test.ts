import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";

// Run only against a disposable PostgreSQL database. Never use production DATABASE_URL.
const url = process.env.HUB_TEST_DATABASE_URL;
let connection: PoolClient;
let database: Pool;

vi.mock("./db", () => ({
  pool: { query: (sql: string, params?: unknown[]) => connection.query(sql, params) },
}));

import { countHubReactions } from "./telegram-hub-moderation";

const suite = url ? describe : describe.skip;
suite("hub moderation: PostgreSQL integration", () => {
  const now = new Date("2026-11-01T12:00:00.000Z");
  const epoch = Math.floor(now.getTime() / 1000);
  beforeAll(async () => {
    database = new Pool({ connectionString: url, max: 1 });
    connection = await database.connect();
    // TEMP tables shadow the production names for this one connection.
    // No application tables or existing rows are touched.
    await connection.query(`
      CREATE TEMP TABLE telegram_hub_memberships (
        hub_id text NOT NULL, telegram_user_id text NOT NULL,
        PRIMARY KEY (hub_id, telegram_user_id)
      );
      CREATE TEMP TABLE telegram_hub_reactions (
        hub_id text NOT NULL, message_id bigint NOT NULL,
        message_author_id text NOT NULL, reactor_id text NOT NULL,
        reaction text, event_date bigint NOT NULL,
        PRIMARY KEY (hub_id, message_id, reactor_id)
      );
    `);
  });
  beforeEach(async () => {
    await connection.query("TRUNCATE telegram_hub_reactions, telegram_hub_memberships");
    await connection.query(`
      INSERT INTO telegram_hub_memberships(hub_id,telegram_user_id)
      VALUES ('test_hub','100'),('test_hub','101'),('test_hub','102'),('test_hub','103')
    `);
  });
  afterAll(async () => {
    if (connection) connection.release();
    if (database) await database.end();
  });

  async function reaction(message: number, actor: string, emoji: string | null, date = epoch) {
    await connection.query(`
      INSERT INTO telegram_hub_reactions
        (hub_id,message_id,message_author_id,reactor_id,reaction,event_date)
      VALUES ('test_hub',$1,'100',$2,$3,$4)
    `, [message, actor, emoji, date]);
  }

  it("counts one voter once across multiple messages", async () => {
    await reaction(1, "101", "👎");
    await reaction(2, "101", "👎");
    await reaction(3, "102", "👎");
    const counts = await countHubReactions("test_hub", "100", now);
    expect(counts.negative).toBe(2);
    expect(counts.warningThresholdReached).toBe(false);
  });

  it("ignores withdrawn, expired, self and nonmember reactions", async () => {
    await reaction(1, "101", null);
    await reaction(2, "102", "👎", epoch - 86_401);
    await reaction(3, "100", "👎");
    await reaction(4, "999", "👎");
    await reaction(5, "103", "👍");
    const counts = await countHubReactions("test_hub", "100", now);
    expect(counts.negative).toBe(0);
    expect(counts.positive).toBe(1);
  });

  it("excludes a target who is not in the hub membership registry", async () => {
    await reaction(1, "101", "👎");
    await connection.query(
      "DELETE FROM telegram_hub_memberships WHERE hub_id='test_hub' AND telegram_user_id='100'",
    );
    expect((await countHubReactions("test_hub", "100", now)).negative).toBe(0);
  });
});
