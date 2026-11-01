import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";

const url = process.env.HUB_TEST_DATABASE_URL;
let database: Pool;
let connection: PoolClient;

vi.mock("./db", () => ({
  pool: {
    query: (sql: string, params?: unknown[]) => connection.query(sql, params),
    connect: async () => ({
      query: (sql: string, params?: unknown[]) => connection.query(sql, params),
      release: () => undefined,
    }),
  },
}));

import { observeHubMessage, observeHubReaction } from "./telegram-hub-reactions";
import { countHubReactions } from "./telegram-hub-moderation";

const suite = url ? describe : describe.skip;
suite("Telegram reaction webhook: PostgreSQL integration", () => {
  const chatId = -100700;
  const date = Math.floor(Date.now() / 1000);
  beforeAll(async () => {
    database = new Pool({ connectionString: url, max: 1 });
    connection = await database.connect();
    await connection.query(`
      CREATE TEMP TABLE telegram_hubs (
        id text PRIMARY KEY, chat_id bigint UNIQUE, enabled boolean NOT NULL
      );
      CREATE TEMP TABLE telegram_hub_memberships (
        hub_id text, telegram_user_id text,
        PRIMARY KEY (hub_id, telegram_user_id)
      );
      CREATE TEMP TABLE telegram_hub_message_authors (
        hub_id text, message_id bigint, telegram_user_id text,
        PRIMARY KEY (hub_id, message_id)
      );
      CREATE TEMP TABLE telegram_hub_reactions (
        hub_id text, message_id bigint, message_author_id text,
        reactor_id text, reaction text, event_date bigint,
        telegram_update_id bigint NOT NULL DEFAULT 0,
        updated_at timestamptz DEFAULT now(),
        PRIMARY KEY (hub_id, message_id, reactor_id)
      );
    `);
  });
  beforeEach(async () => {
    await connection.query("TRUNCATE telegram_hub_reactions, telegram_hub_message_authors, telegram_hub_memberships, telegram_hubs");
    await connection.query("INSERT INTO telegram_hubs VALUES ('test_hub',$1,true)", [chatId]);
    await connection.query("INSERT INTO telegram_hub_memberships VALUES ('test_hub','100'),('test_hub','101')");
    expect(await observeHubMessage({message:{chat:{id:chatId},message_id:5,from:{id:100}}})).toBe(true);
  });
  afterAll(async () => {
    if (connection) connection.release();
    if (database) await database.end();
  });
  const update = (updateId: number, reactions: string[], actor = 101) => ({
    update_id: updateId,
    message_reaction: {
      chat: { id: chatId }, message_id: 5, date,
      user: { id: actor },
      new_reaction: reactions.map(emoji => ({type:"emoji",emoji})),
    },
  });
  async function current() {
    return connection.query("SELECT reaction,telegram_update_id FROM telegram_hub_reactions WHERE hub_id='test_hub'");
  }
  it("removes a dislike in the same second and ignores an older delivery", async () => {
    await observeHubReaction(update(1001, ["👎"]));
    await observeHubReaction(update(1002, []));
    await observeHubReaction(update(1001, ["👎"]));
    expect((await current()).rows).toMatchObject([{reaction:null,telegram_update_id:"1002"}]);
    expect((await countHubReactions("test_hub","100")).negative).toBe(0);
  });
  it("handles duplicate delivery without double counting", async () => {
    await observeHubReaction(update(1001, ["👎"]));
    await observeHubReaction(update(1001, ["👎"]));
    expect((await current()).rowCount).toBe(1);
    expect((await countHubReactions("test_hub","100")).negative).toBe(1);
  });
  it("ignores self reactions and unregistered reactors", async () => {
    await observeHubReaction(update(1001, ["👎"],100));
    await observeHubReaction(update(1002, ["👎"],999));
    expect((await current()).rowCount).toBe(0);
  });
  it("recognizes disabled hub messages without recording their authors", async () => {
    await connection.query("UPDATE telegram_hubs SET enabled=false");
    expect(await observeHubMessage({message:{chat:{id:chatId},message_id:6,from:{id:101}}})).toBe(true);
    const result=await connection.query("SELECT 1 FROM telegram_hub_message_authors WHERE message_id=6");
    expect(result.rowCount).toBe(0);
  });
});
